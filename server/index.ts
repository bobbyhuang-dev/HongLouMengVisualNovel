import qrcode from "qrcode-generator";
import { publicQuestions } from "./scenes";
import { CompetitionRoom, type ApiResult } from "./room";

export { CompetitionRoom };

interface Env {
  ROOMS: DurableObjectNamespace<CompetitionRoom>;
  ASSETS: Fetcher;
}

const PLAY = /^\/play\/(\d{6})\/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})(\/.*)?$/i;

class HttpError extends Error {
  constructor(readonly status: number, message: string) {
    super(message);
  }
}

function json(body: unknown, status = 200, extra?: HeadersInit): Response {
  const headers = new Headers(extra);
  headers.set("content-type", "application/json; charset=utf-8");
  headers.set("cache-control", "no-store");
  headers.set("x-content-type-options", "nosniff");
  return new Response(JSON.stringify(body), { status, headers });
}

function fail(status: number, error: string, extra?: HeadersInit): Response {
  return json({ error }, status, extra);
}

function methodNotAllowed(allow: string): Response {
  return fail(405, "方法不被允许", { allow });
}

function textNotFound(): Response {
  return new Response("Not Found", {
    status: 404,
    headers: { "content-type": "text/plain; charset=utf-8", "cache-control": "no-store" },
  });
}

function fromResult<T>(result: ApiResult<T>): Response {
  if (!result.ok) return fail(result.status, result.error);
  return json(result.data);
}

function bearer(request: Request): string | null {
  const header = request.headers.get("authorization");
  if (!header) return null;
  const match = /^Bearer\s+(\S+)$/i.exec(header);
  if (!match || match[1].length > 256) return null;
  return match[1];
}

async function readJson(request: Request): Promise<Record<string, unknown>> {
  const text = await request.text();
  if (text.length > 4096) throw new HttpError(400, "请求格式不正确");
  if (!text.trim()) return {};
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch {
    throw new HttpError(400, "请求格式不正确");
  }
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new HttpError(400, "请求格式不正确");
  return value as Record<string, unknown>;
}

function randomCode(): string {
  const buf = new Uint32Array(1);
  crypto.getRandomValues(buf);
  return String(buf[0] % 1_000_000).padStart(6, "0");
}

function roomStub(env: Env, code: string): DurableObjectStub<CompetitionRoom> {
  return env.ROOMS.get(env.ROOMS.idFromName(code));
}

function qrSvg(payload: string): string {
  const qr = qrcode(0, "M");
  qr.addData(payload);
  qr.make();
  const svg = qr.createSvgTag({ cellSize: 4, margin: 8 });
  if (/<script|javascript:/i.test(svg) || /href\s*=\s*["']https?:/i.test(svg)) {
    throw new HttpError(500, "二维码生成失败");
  }
  return svg;
}

async function createRoom(request: Request, env: Env): Promise<Response> {
  const body = await readJson(request);
  for (let attempt = 0; attempt < 12; attempt++) {
    const code = randomCode();
    const result = await roomStub(env, code).create(body.name, code);
    if (result.ok) return json(result.data);
    if (!result.retry) return fail(result.status, result.error);
  }
  return fail(503, "房间创建失败，请重试");
}

async function handleApi(request: Request, env: Env, url: URL): Promise<Response> {
  const path = url.pathname.replace(/\/+$/, "") || "/";
  if (path === "/api/questions") {
    if (request.method !== "GET") return methodNotAllowed("GET");
    return json({ questions: publicQuestions() });
  }
  if (path === "/api/rooms") {
    if (request.method !== "POST") return methodNotAllowed("POST");
    return createRoom(request, env);
  }

  const match = /^\/api\/rooms\/([^/]+)(?:\/([^/]+))?$/.exec(path);
  if (!match) return fail(404, "接口不存在");
  const code = match[1];
  const action = match[2];
  if (!/^\d{6}$/.test(code)) return fail(400, "房间码必须是 6 位数字");
  const stub = roomStub(env, code);

  if (!action) {
    if (request.method !== "GET") return methodNotAllowed("GET");
    return fromResult(await stub.getRoom());
  }
  if (action === "qr") {
    if (request.method !== "GET") return methodNotAllowed("GET");
    const room = await stub.getRoom();
    if (!room.ok) return fail(room.status, room.error);
    // Wrangler 本地开发会把 request.url 改写为路由域名；扫码入口应与浏览器地址一致。
    let origin: URL;
    try {
      origin = new URL(url.searchParams.get("origin") || url.origin);
    } catch {
      return fail(400, "加入地址无效");
    }
    if (!["http:", "https:"].includes(origin.protocol) || origin.username || origin.password) return fail(400, "加入地址无效");
    const svg = qrSvg(`${origin.origin}/?room=${code}`);
    return new Response(svg, {
      status: 200,
      headers: {
        "content-type": "image/svg+xml; charset=utf-8",
        "cache-control": "no-store",
        "x-content-type-options": "nosniff",
      },
    });
  }
  if (action === "join") {
    if (request.method !== "POST") return methodNotAllowed("POST");
    const body = await readJson(request);
    return fromResult(await stub.join(body.nickname, body.joinKey));
  }
  if (action === "start" || action === "end") {
    if (request.method !== "POST") return methodNotAllowed("POST");
    if (!request.headers.get("authorization")) return fail(401, "缺少凭证");
    await readJson(request);
    const token = bearer(request);
    return fromResult(action === "start" ? await stub.start(token) : await stub.end(token));
  }
  if (action === "me") {
    if (request.method !== "GET") return methodNotAllowed("GET");
    if (!request.headers.get("authorization")) return fail(401, "缺少凭证");
    return fromResult(await stub.me(bearer(request)));
  }
  if (action === "answer") {
    if (request.method !== "POST") return methodNotAllowed("POST");
    if (!request.headers.get("authorization")) return fail(401, "缺少凭证");
    const body = await readJson(request);
    return fromResult(await stub.answer(bearer(request), body.questionId, body.choice));
  }
  if (action === "finish") {
    if (request.method !== "POST") return methodNotAllowed("POST");
    if (!request.headers.get("authorization")) return fail(401, "缺少凭证");
    await readJson(request);
    return fromResult(await stub.finish(bearer(request)));
  }
  return fail(404, "接口不存在");
}

function safeAssetPath(rest: string): string | null {
  const safe: string[] = [];
  for (const part of rest.split("/")) {
    if (part === "" || part === ".") continue;
    if (part === ".." || part.includes("\\") || part.includes("\0")) return null;
    safe.push(part);
  }
  return safe.length === 0 ? "/" : `/${safe.join("/")}`;
}

async function fetchAsset(request: Request, pathname: string, env: Env): Promise<Response> {
  const url = new URL(request.url);
  url.pathname = pathname;
  url.search = "";
  let response = await env.ASSETS.fetch(new Request(url, { method: "GET" }));
  if (response.status < 300 || response.status >= 400) return response;
  const location = response.headers.get("location");
  if (!location) return textNotFound();
  const next = new URL(location, url);
  if (next.origin !== url.origin) return textNotFound();
  response = await env.ASSETS.fetch(new Request(next, { method: "GET" }));
  if (response.status >= 300 && response.status < 400) return textNotFound();
  return response;
}

async function namespacedConfig(request: Request, code: string, playerId: string, env: Env): Promise<Response> {
  const asset = await fetchAsset(request, "/game/config.txt", env);
  if (!asset.ok) return asset;
  const text = await asset.text();
  const keyLine = `Game_key:hlm-room-${code}-${playerId};`;
  const rewritten = /^Game_key:[^\r\n]*/m.test(text)
    ? text.replace(/^Game_key:[^\r\n]*/m, keyLine)
    : `${keyLine}\n${text}`;
  const headers = new Headers(asset.headers);
  headers.set("content-type", asset.headers.get("content-type") || "text/plain; charset=utf-8");
  headers.set("cache-control", "no-store");
  headers.delete("etag");
  headers.delete("last-modified");
  return new Response(rewritten, { status: 200, headers });
}

async function handlePlay(request: Request, env: Env, url: URL): Promise<Response> {
  if (request.method !== "GET" && request.method !== "HEAD") return methodNotAllowed("GET");
  const match = PLAY.exec(url.pathname);
  if (!match) return textNotFound();
  const code = match[1];
  const playerId = match[2];
  const assetPath = safeAssetPath(match[3] ?? "");
  // /play is an asset namespace. Formal play stays on /?room=CODE&play=1; do not serve index.html here.
  if (!assetPath || assetPath === "/" || assetPath === "/index.html") return textNotFound();
  if (assetPath === "/game/config.txt") return namespacedConfig(request, code, playerId, env);
  return fetchAsset(request, assetPath, env);
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    try {
      if (url.pathname === "/api" || url.pathname.startsWith("/api/")) return await handleApi(request, env, url);
      if (url.pathname === "/play" || url.pathname.startsWith("/play/")) return await handlePlay(request, env, url);
      return env.ASSETS.fetch(request);
    } catch (error) {
      if (error instanceof HttpError) return fail(error.status, error.message);
      return fail(500, "服务器内部错误");
    }
  },
};
