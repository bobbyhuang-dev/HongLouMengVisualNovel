import { DurableObject } from "cloudflare:workers";
import {
  acceptsNewAnswer,
  awardsCompletionBase,
  competitionRanks,
  deadlineAtFrom,
  elapsedMs,
  shouldFinalizeAtDeadline,
  type PlayerStatus,
  type RoomStatus,
} from "./clock";
import { QUESTION_COUNT, QUESTIONS, scoreAnswers, titleFor } from "./scenes";

export type PublicPlayer = {
  id: string;
  nickname: string;
  score: number;
  hits: number;
  answered: number;
  status: PlayerStatus;
  finishedAt: number | null;
  elapsedMs: number;
  title: string;
  rank: number | null;
};

export type PrivatePlayer = PublicPlayer & { answers: string[] };

export type PublicRoom = {
  code: string;
  name: string;
  status: RoomStatus;
  startedAt: number | null;
  deadlineAt: number | null;
  endedAt: number | null;
  serverNow: number;
  players: PublicPlayer[];
};

export type ApiResult<T> =
  | { ok: true; data: T }
  | { ok: false; status: number; error: string; retry?: boolean };

type RoomRow = {
  code: string;
  name: string;
  status: RoomStatus;
  host_token: string;
  started_at: number | null;
  deadline_at: number | null;
  ended_at: number | null;
  created_at: number;
};

type PlayerRow = {
  id: string;
  nickname: string;
  nickname_key: string;
  join_key: string;
  player_token: string;
  status: PlayerStatus;
  base_awarded: number;
  finished_at: number | null;
  created_at: number;
};

type AnswerRow = {
  player_id: string;
  q_index: number;
  question_id: string;
  choice: string;
};

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

function fail(status: number, error: string, retry?: boolean): ApiResult<never> {
  return retry ? { ok: false, status, error, retry } : { ok: false, status, error };
}

function normalizeNickname(raw: unknown): { display: string; key: string } | { error: string } {
  if (typeof raw !== "string") return { error: "请填写昵称" };
  if (raw.length > 80) return { error: "昵称最多 20 个字" };
  const display = raw.normalize("NFKC").trim().replace(/\s+/g, " ");
  if (!display) return { error: "请填写昵称" };
  if ([...display].length > 20) return { error: "昵称最多 20 个字" };
  return { display, key: display.toLowerCase() };
}

function normalizeRoomName(raw: unknown): { name: string } | { error: string } {
  if (typeof raw !== "string") return { error: "请填写房间名" };
  if (raw.length > 200) return { error: "房间名最多 60 个字" };
  const name = raw.normalize("NFKC").trim();
  if (!name) return { error: "请填写房间名" };
  if ([...name].length > 60) return { error: "房间名最多 60 个字" };
  return { name };
}

function normalizeUuid(raw: unknown): string | null {
  if (typeof raw !== "string" || raw.length > 80) return null;
  const value = raw.trim().toLowerCase();
  return UUID.test(value) ? value : null;
}

function secretsEqual(left: string, right: string): boolean {
  const encoder = new TextEncoder();
  const a = encoder.encode(left);
  const b = encoder.encode(right);
  const length = Math.max(a.length, b.length, 1);
  let diff = a.length ^ b.length;
  for (let index = 0; index < length; index++) diff |= (a[index] ?? 0) ^ (b[index] ?? 0);
  return diff === 0;
}

function secret(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/, "");
}

function asStatus(value: unknown): RoomStatus {
  return value === "running" || value === "finished" ? value : "waiting";
}

function asPlayerStatus(value: unknown): PlayerStatus {
  if (value === "playing" || value === "completed" || value === "timeout") return value;
  return "waiting";
}

function visibleStatus(roomStatus: RoomStatus, playerStatus: PlayerStatus): PlayerStatus {
  if (playerStatus === "completed") return "completed";
  if (roomStatus === "finished") return "timeout";
  if (roomStatus === "running") return "playing";
  return "waiting";
}

export class CompetitionRoom extends DurableObject {
  constructor(ctx: DurableObjectState, env: unknown) {
    super(ctx, env);
    ctx.blockConcurrencyWhile(async () => {
      this.ensureSchema();
    });
  }

  async create(rawName: unknown, code: string): Promise<ApiResult<{ room: PublicRoom; hostToken: string }>> {
    const name = normalizeRoomName(rawName);
    if ("error" in name) return fail(400, name.error);
    if (!/^\d{6}$/.test(code)) return fail(500, "服务器内部错误");
    if (this.ctx.id.name && this.ctx.id.name !== code) return fail(500, "服务器内部错误");
    if (this.roomRow()) return fail(409, "房间码冲突", true);
    const now = Date.now();
    const hostToken = secret();
    this.ctx.storage.sql.exec(
      `INSERT INTO room (code, name, status, host_token, started_at, deadline_at, ended_at, created_at)
       VALUES (?, ?, 'waiting', ?, NULL, NULL, NULL, ?)`,
      code,
      name.name,
      hostToken,
      now,
    );
    const view = this.snapshot(now);
    return { ok: true, data: { room: view.room, hostToken } };
  }

  async getRoom(): Promise<ApiResult<{ room: PublicRoom }>> {
    const now = Date.now();
    this.closeIfDeadline(now);
    if (!this.roomRow()) return fail(404, "房间不存在");
    return { ok: true, data: { room: this.snapshot(now).room } };
  }

  async join(rawNickname: unknown, rawJoinKey: unknown): Promise<ApiResult<{
    room: PublicRoom;
    player: { id: string; nickname: string };
    playerToken: string;
  }>> {
    const now = Date.now();
    this.closeIfDeadline(now);
    const room = this.roomRow();
    if (!room) return fail(404, "房间不存在");
    const nickname = normalizeNickname(rawNickname);
    if ("error" in nickname) return fail(400, nickname.error);
    const joinKey = normalizeUuid(rawJoinKey);
    if (!joinKey) return fail(400, "加入密钥无效");

    const byKey = this.playerByJoinKey(joinKey);
    if (byKey) {
      if (byKey.nickname_key !== nickname.key) return fail(409, "加入密钥已绑定其他昵称");
      return {
        ok: true,
        data: {
          room: this.snapshot(now).room,
          player: { id: byKey.id, nickname: byKey.nickname },
          playerToken: byKey.player_token,
        },
      };
    }
    if (this.playerByNickname(nickname.key)) return fail(409, "这个昵称已经被使用了");
    if (room.status === "running") return fail(409, "比赛已经开始，不能加入");
    if (room.status === "finished") return fail(409, "比赛已结束，不能加入");

    const id = crypto.randomUUID();
    const playerToken = secret();
    this.ctx.storage.sql.exec(
      `INSERT INTO players
        (id, nickname, nickname_key, join_key, player_token, status, base_awarded, finished_at, created_at)
       VALUES (?, ?, ?, ?, ?, 'waiting', 0, NULL, ?)`,
      id,
      nickname.display,
      nickname.key,
      joinKey,
      playerToken,
      now,
    );
    return {
      ok: true,
      data: {
        room: this.snapshot(now).room,
        player: { id, nickname: nickname.display },
        playerToken,
      },
    };
  }

  async start(token: string | null): Promise<ApiResult<{ room: PublicRoom }>> {
    const now = Date.now();
    this.closeIfDeadline(now);
    const auth = this.requireHost(token);
    if (auth) return auth;
    const room = this.roomRow();
    if (!room) return fail(404, "房间不存在");
    if (room.status === "finished") return fail(409, "比赛已结束");
    if (room.status === "running") {
      if (room.deadline_at != null && room.deadline_at > now) await this.ctx.storage.setAlarm(room.deadline_at);
      return { ok: true, data: { room: this.snapshot(now).room } };
    }
    const count = this.ctx.storage.sql.exec("SELECT COUNT(*) AS n FROM players").one().n;
    if (Number(count) < 1) return fail(409, "至少需要一名玩家才能开始");
    const deadlineAt = deadlineAtFrom(now);
    this.ctx.storage.transactionSync(() => {
      this.ctx.storage.sql.exec(
        "UPDATE room SET status = 'running', started_at = ?, deadline_at = ? WHERE status = 'waiting'",
        now,
        deadlineAt,
      );
      this.ctx.storage.sql.exec("UPDATE players SET status = 'playing' WHERE status = 'waiting'");
    });
    await this.ctx.storage.setAlarm(deadlineAt);
    return { ok: true, data: { room: this.snapshot(now).room } };
  }

  async end(token: string | null): Promise<ApiResult<{ room: PublicRoom }>> {
    const now = Date.now();
    this.closeIfDeadline(now);
    const auth = this.requireHost(token);
    if (auth) return auth;
    const room = this.roomRow();
    if (!room) return fail(404, "房间不存在");
    if (room.status === "waiting") return fail(409, "比赛尚未开始");
    if (room.status === "running") {
      this.finalize(now, "manual");
      await this.ctx.storage.deleteAlarm();
    }
    return { ok: true, data: { room: this.snapshot(now).room } };
  }

  async me(token: string | null): Promise<ApiResult<{ room: PublicRoom; player: PrivatePlayer }>> {
    const now = Date.now();
    this.closeIfDeadline(now);
    const player = this.requirePlayer(token);
    if ("ok" in player) return player;
    return { ok: true, data: this.privateView(now, player.id) };
  }

  async answer(
    token: string | null,
    questionId: unknown,
    choice: unknown,
  ): Promise<ApiResult<{ room: PublicRoom; player: PrivatePlayer }>> {
    const now = Date.now();
    this.closeIfDeadline(now);
    const player = this.requirePlayer(token);
    if ("ok" in player) return player;
    if (typeof questionId !== "string" || typeof choice !== "string") return fail(400, "请求格式不正确");
    const question = QUESTIONS.find((item) => item.id === questionId);
    if (!question) return fail(400, "题目不存在");
    if (!question.options.some((option) => option.label === choice)) return fail(400, "选项无效");

    const existing = this.answersFor(player.id);
    const prior = existing.find((answer) => answer.question_id === questionId);
    if (prior) {
      if (prior.choice !== choice) return fail(409, "不能更改已提交的答案");
      return { ok: true, data: this.privateView(now, player.id) };
    }
    const next = QUESTIONS[existing.length];
    if (!next || next.id !== questionId) return fail(409, "请按顺序作答");

    const room = this.roomRow();
    if (!room) return fail(404, "房间不存在");
    if (room.status === "waiting") return fail(409, "比赛尚未开始");
    if (!acceptsNewAnswer(now, room.status, room.deadline_at) || player.status === "completed" || player.status === "timeout") {
      return fail(409, "答题已截止");
    }

    try {
      this.ctx.storage.sql.exec(
        "INSERT INTO answers (player_id, q_index, question_id, choice) VALUES (?, ?, ?, ?)",
        player.id,
        existing.length,
        questionId,
        choice,
      );
    } catch (error) {
      const message = error instanceof Error ? error.message : "";
      if (!/unique/i.test(message)) throw error;
      const stored = this.answersFor(player.id).find((answer) => answer.question_id === questionId);
      if (stored?.choice === choice) return { ok: true, data: this.privateView(now, player.id) };
      return fail(409, "不能更改已提交的答案");
    }
    return { ok: true, data: this.privateView(now, player.id) };
  }

  async finish(token: string | null): Promise<ApiResult<{ room: PublicRoom; player: PrivatePlayer }>> {
    const now = Date.now();
    this.closeIfDeadline(now);
    const player = this.requirePlayer(token);
    if ("ok" in player) return player;
    const room = this.roomRow();
    if (!room) return fail(404, "房间不存在");
    if (player.status === "completed" || player.base_awarded) {
      return { ok: true, data: this.privateView(now, player.id) };
    }
    if (room.status === "waiting") return fail(409, "比赛尚未开始");
    const answered = this.answersFor(player.id).length;
    if (answered < QUESTION_COUNT) return fail(409, "请先答完所有题目");
    const award = awardsCompletionBase({
      now,
      roomStatus: room.status,
      deadlineAt: room.deadline_at,
      answered,
      questionCount: QUESTION_COUNT,
      alreadyAwarded: player.base_awarded === 1,
    });
    if (award) {
      this.ctx.storage.sql.exec(
        "UPDATE players SET status = 'completed', base_awarded = 1, finished_at = ? WHERE id = ? AND base_awarded = 0",
        now,
        player.id,
      );
    }
    return { ok: true, data: this.privateView(now, player.id) };
  }

  async alarm(): Promise<void> {
    const now = Date.now();
    const room = this.roomRow();
    if (!room || room.status !== "running" || room.deadline_at == null) return;
    if (now >= room.deadline_at) {
      this.finalize(room.deadline_at, "deadline");
      return;
    }
    await this.ctx.storage.setAlarm(room.deadline_at);
  }

  private ensureSchema(): void {
    this.ctx.storage.sql.exec(`CREATE TABLE IF NOT EXISTS room (
      code TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      status TEXT NOT NULL,
      host_token TEXT NOT NULL,
      started_at INTEGER,
      deadline_at INTEGER,
      ended_at INTEGER,
      created_at INTEGER NOT NULL
    )`);
    this.ctx.storage.sql.exec(`CREATE TABLE IF NOT EXISTS players (
      id TEXT PRIMARY KEY,
      nickname TEXT NOT NULL,
      nickname_key TEXT NOT NULL UNIQUE,
      join_key TEXT NOT NULL UNIQUE,
      player_token TEXT NOT NULL UNIQUE,
      status TEXT NOT NULL,
      base_awarded INTEGER NOT NULL DEFAULT 0,
      finished_at INTEGER,
      created_at INTEGER NOT NULL
    )`);
    this.ctx.storage.sql.exec(`CREATE TABLE IF NOT EXISTS answers (
      player_id TEXT NOT NULL,
      q_index INTEGER NOT NULL,
      question_id TEXT NOT NULL,
      choice TEXT NOT NULL,
      PRIMARY KEY (player_id, q_index)
    )`);
    this.ctx.storage.sql.exec(
      "CREATE UNIQUE INDEX IF NOT EXISTS answers_player_question ON answers (player_id, question_id)",
    );
  }

  private roomRow(): RoomRow | null {
    const row = this.ctx.storage.sql.exec(
      "SELECT code, name, status, host_token, started_at, deadline_at, ended_at, created_at FROM room LIMIT 1",
    ).toArray()[0];
    if (!row) return null;
    return {
      code: String(row.code),
      name: String(row.name),
      status: asStatus(row.status),
      host_token: String(row.host_token),
      started_at: row.started_at == null ? null : Number(row.started_at),
      deadline_at: row.deadline_at == null ? null : Number(row.deadline_at),
      ended_at: row.ended_at == null ? null : Number(row.ended_at),
      created_at: Number(row.created_at),
    };
  }

  private playerRows(): PlayerRow[] {
    return this.ctx.storage.sql.exec(
      `SELECT id, nickname, nickname_key, join_key, player_token, status, base_awarded, finished_at, created_at
       FROM players ORDER BY created_at, id`,
    ).toArray().map((row) => ({
      id: String(row.id),
      nickname: String(row.nickname),
      nickname_key: String(row.nickname_key),
      join_key: String(row.join_key),
      player_token: String(row.player_token),
      status: asPlayerStatus(row.status),
      base_awarded: Number(row.base_awarded) || 0,
      finished_at: row.finished_at == null ? null : Number(row.finished_at),
      created_at: Number(row.created_at),
    }));
  }

  private playerByJoinKey(joinKey: string): PlayerRow | null {
    return this.playerRows().find((player) => player.join_key === joinKey) ?? null;
  }

  private playerByNickname(key: string): PlayerRow | null {
    return this.playerRows().find((player) => player.nickname_key === key) ?? null;
  }

  private answersFor(playerId: string): AnswerRow[] {
    return this.ctx.storage.sql.exec(
      "SELECT player_id, q_index, question_id, choice FROM answers WHERE player_id = ? ORDER BY q_index",
      playerId,
    ).toArray().map((row) => ({
      player_id: String(row.player_id),
      q_index: Number(row.q_index),
      question_id: String(row.question_id),
      choice: String(row.choice),
    }));
  }

  private allAnswers(): Map<string, string[]> {
    const grouped = new Map<string, { index: number; choice: string }[]>();
    for (const row of this.ctx.storage.sql.exec(
      "SELECT player_id, q_index, choice FROM answers ORDER BY q_index",
    ).toArray()) {
      const id = String(row.player_id);
      const list = grouped.get(id) ?? [];
      list.push({ index: Number(row.q_index), choice: String(row.choice) });
      grouped.set(id, list);
    }
    const choices = new Map<string, string[]>();
    for (const [id, list] of grouped) {
      list.sort((a, b) => a.index - b.index);
      choices.set(id, list.map((item) => item.choice));
    }
    return choices;
  }

  private requireHost(token: string | null): ApiResult<never> | null {
    if (!token) return fail(401, "缺少凭证");
    const room = this.roomRow();
    if (!room) return fail(404, "房间不存在");
    if (!secretsEqual(token, room.host_token)) return fail(401, "凭证无效");
    return null;
  }

  private requirePlayer(token: string | null): PlayerRow | ApiResult<never> {
    if (!token) return fail(401, "缺少凭证");
    if (!this.roomRow()) return fail(404, "房间不存在");
    const player = this.playerRows().find((item) => secretsEqual(token, item.player_token));
    if (!player) return fail(401, "凭证无效");
    return player;
  }

  private closeIfDeadline(now: number): void {
    const room = this.roomRow();
    if (!room || !shouldFinalizeAtDeadline(now, room.status, room.deadline_at)) return;
    this.finalize(room.deadline_at ?? now, "deadline");
  }

  private finalize(endedAt: number, kind: "deadline" | "manual"): void {
    const stamp = kind === "deadline" ? endedAt : Math.min(endedAt, (this.roomRow()?.deadline_at ?? endedAt));
    this.ctx.storage.transactionSync(() => {
      this.ctx.storage.sql.exec(
        "UPDATE room SET status = 'finished', ended_at = ? WHERE status = 'running'",
        stamp,
      );
      this.ctx.storage.sql.exec("UPDATE players SET status = 'timeout' WHERE status != 'completed'");
    });
  }

  private snapshot(now: number): { room: PublicRoom; byId: Map<string, PrivatePlayer> } {
    const room = this.roomRow();
    if (!room) throw new Error("房间不存在");
    const answers = this.allAnswers();
    const views = this.playerRows().map((player) => {
      const choices = answers.get(player.id) ?? [];
      const scored = scoreAnswers(choices, player.base_awarded === 1 || player.status === "completed");
      const status = visibleStatus(room.status, player.status);
      const finishedAt = status === "completed" ? player.finished_at : null;
      const elapsed = elapsedMs({
        now,
        roomStatus: room.status,
        startedAt: room.started_at,
        deadlineAt: room.deadline_at,
        endedAt: room.ended_at,
        playerStatus: status,
        finishedAt,
      });
      return {
        createdAt: player.created_at,
        player: {
          id: player.id,
          nickname: player.nickname,
          score: scored.score,
          hits: scored.hits,
          answered: scored.answered,
          status,
          finishedAt,
          elapsedMs: elapsed,
          title: titleFor(scored.score),
          rank: null as number | null,
        },
        answers: choices,
      };
    });
    if (room.status === "finished") {
      views.sort((a, b) => {
        if (b.player.score !== a.player.score) return b.player.score - a.player.score;
        if (a.player.elapsedMs !== b.player.elapsedMs) return a.player.elapsedMs - b.player.elapsedMs;
        return a.createdAt - b.createdAt;
      });
      const ranks = competitionRanks(views.map((view) => view.player));
      views.forEach((view, index) => {
        view.player.rank = ranks[index];
      });
    }
    const byId = new Map<string, PrivatePlayer>();
    const players = views.map((view) => {
      const player = view.player;
      byId.set(player.id, { ...player, answers: view.answers });
      return {
        id: player.id,
        nickname: player.nickname,
        score: player.score,
        hits: player.hits,
        answered: player.answered,
        status: player.status,
        finishedAt: player.finishedAt,
        elapsedMs: player.elapsedMs,
        title: player.title,
        rank: player.rank,
      };
    });
    return {
      room: {
        code: room.code,
        name: room.name,
        status: room.status,
        startedAt: room.started_at,
        deadlineAt: room.deadline_at,
        endedAt: room.ended_at,
        serverNow: now,
        players,
      },
      byId,
    };
  }

  private privateView(now: number, playerId: string): { room: PublicRoom; player: PrivatePlayer } {
    const view = this.snapshot(now);
    const player = view.byId.get(playerId);
    if (!player) throw new Error("选手不存在");
    return { room: view.room, player };
  }
}

