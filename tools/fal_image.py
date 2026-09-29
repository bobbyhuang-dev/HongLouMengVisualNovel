#!/usr/bin/env python3
"""用 fal.ai 上的 GPT Image 2.5 生成/改图。

    python3 tools/fal_image.py "提示词" -o art/xxx.png
    python3 tools/fal_image.py "改图指令" -i art/sprites/daiyu.png -o art/sprites/daiyu_new.png \
        --size 1024x1536 --background transparent

有 -i 走 edit 端点，否则走 text-to-image。默认模型 sunburst。
FAL_KEY 从环境变量读取，没有则读仓库根目录 .env（已 gitignore）。
"""

import argparse
import base64
import json
import mimetypes
import os
import sys
import time
import urllib.error
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
PRESETS = {"square_hd", "square", "portrait_4_3", "portrait_16_9", "landscape_4_3", "landscape_16_9", "auto"}


def load_key() -> str:
    key = os.environ.get("FAL_KEY")
    env_file = ROOT / ".env"
    if not key and env_file.exists():
        for line in env_file.read_text().splitlines():
            name, sep, value = line.partition("=")
            if sep and name.strip() == "FAL_KEY":
                key = value.strip().strip("'\"")
    if not key:
        sys.exit("缺少 FAL_KEY：export FAL_KEY=... 或写入仓库根目录 .env")
    return key


def request(method: str, url: str, key: str, body: dict | None = None) -> dict:
    data = json.dumps(body).encode() if body is not None else None
    req = urllib.request.Request(url, data=data, method=method, headers={
        "Authorization": f"Key {key}",
        "Content-Type": "application/json",
    })
    try:
        with urllib.request.urlopen(req, timeout=120) as resp:
            return json.load(resp)
    except urllib.error.HTTPError as e:
        sys.exit(f"fal {method} {url} -> HTTP {e.code}: {e.read().decode(errors='replace')}")


def data_uri(path: str) -> str:
    mime = mimetypes.guess_type(path)[0] or "image/png"
    return f"data:{mime};base64,{base64.b64encode(Path(path).read_bytes()).decode()}"


def parse_size(size: str):
    if size in PRESETS:
        return size
    w, sep, h = size.lower().partition("x")
    if not sep:
        sys.exit(f"--size 需为 {sorted(PRESETS)} 之一或 WIDTHxHEIGHT")
    return {"width": int(w), "height": int(h)}


def output_paths(output: str, count: int, fmt: str) -> list[Path]:
    base = Path(output) if output else Path(f"fal-{int(time.time())}.{fmt}")
    if count == 1:
        return [base]
    return [base.with_name(f"{base.stem}_{i + 1}{base.suffix}") for i in range(count)]


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("prompt")
    ap.add_argument("-i", "--input", action="append", default=[], help="参考/待改图片，可多次，最多 16 张")
    ap.add_argument("-o", "--output", default="", help="输出路径；多张时自动加 _1 _2 后缀")
    ap.add_argument("-m", "--model", choices=["sunburst", "flare"], default="sunburst")
    ap.add_argument("--size", default=None, help="预设名或 WIDTHxHEIGHT（16 的倍数，最长边 ≤3840）")
    ap.add_argument("--quality", choices=["auto", "low", "medium", "high", "xhigh", "max"], default="high")
    ap.add_argument("--background", choices=["auto", "transparent", "opaque"], default="auto")
    ap.add_argument("--format", choices=["png", "jpeg", "webp"], default="png")
    ap.add_argument("-n", "--num", type=int, default=1)
    args = ap.parse_args()

    key = load_key()
    endpoint = f"openai/gpt-image-2.5/{args.model}/" + ("edit" if args.input else "text-to-image")
    body = {
        "prompt": args.prompt,
        "quality": args.quality,
        "background": args.background,
        "output_format": args.format,
        "num_images": args.num,
    }
    if args.size:
        body["image_size"] = parse_size(args.size)
    if args.input:
        body["image_urls"] = [data_uri(p) for p in args.input]

    start = time.time()
    job = request("POST", f"https://queue.fal.run/{endpoint}", key, body)
    print(f"{endpoint} 已提交 request_id={job['request_id']}", file=sys.stderr)
    while True:
        status = request("GET", job["status_url"], key)
        if status["status"] == "COMPLETED":
            break
        time.sleep(2)
    result = request("GET", job["response_url"], key)

    images = result.get("images") or []
    if not images:
        sys.exit(f"fal 未返回图片：{json.dumps(result, ensure_ascii=False)}")
    for img, path in zip(images, output_paths(args.output, len(images), args.format)):
        path.parent.mkdir(parents=True, exist_ok=True)
        with urllib.request.urlopen(img["url"], timeout=120) as resp:
            path.write_bytes(resp.read())
        print(path)
    print(f"用时 {time.time() - start:.1f}s", file=sys.stderr)


if __name__ == "__main__":
    main()
