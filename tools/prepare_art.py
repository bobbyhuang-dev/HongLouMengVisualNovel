"""把 art/ 下的原始 PNG 转成引擎用的 WebP，并生成立绘的动态数据。

用法（需要 Pillow、numpy）：python tools/prepare_art.py

立绘：WebGAL 会把立绘等比缩放到舞台高度（1440）并底部对齐，所以原图里留白多少会直接变成
屏幕上的大小差异。这里先按不透明区域裁切，再按角色身高系数统一放大：头顶留 40px，
下半身超出画布的部分被裁掉（对话框本来就会挡住腿部）。

表情差分 <角色>_<差分>.png 先对齐到基础立绘（sprite_align.registration），再套用基础立绘的
裁切与缩放，所以切换表情时人物的位置和大小不变。

眨眼、说话贴片 art/sprites/face/<立绘>.<blink|talk>.png 抠出后同样换算到舞台坐标，输出到
web/game/figure/face/；位置与每张立绘的天然朝向写进 web/game/figure/life.json，
由 web/stage-life.js 在运行时使用。

背景：等比缩放并居中裁切到 2560x1440。生成原图只有约 1.5K 宽，放大后再轻度锐化，补回线条的清晰度。
"""

import json
from pathlib import Path

from PIL import Image, ImageFilter

import sprite_align as sa

ROOT = sa.ROOT
BACKGROUNDS_IN = ROOT / "art" / "backgrounds"
FIGURE_OUT = ROOT / "web" / "game" / "figure"
FACE_OUT = FIGURE_OUT / "face"
BACKGROUND_OUT = ROOT / "web" / "game" / "background"

STAGE_H = 1440
CANVAS_W = 1280  # 两个立绘分站左右时各占半个舞台（2560 / 2）
FULL_BODY_H = 1600  # 身高系数为 1 的角色，全身高度放大到这么高；再大人物会塞满画面
TOP_MARGIN = 40

# 相对身高：成年男子 1.0；成年女子、少年略矮；刘姥姥弯腰驼背。
HEIGHT = {
    "jiazheng": 1.0,
    "yucun": 1.0,
    "kongkong": 1.0,
    "lengzixing": 1.0,
    "beijingwang": 1.0,
    "jiarui": 0.99,
    "jiaqiang": 0.97,
    "fengjie": 0.96,
    "keqing": 0.96,
    "yuanchun": 0.96,
    "jinghuan": 0.97,
    "jinshi": 0.95,
    "jingxu": 0.93,
    "baoyu": 0.95,
    "baochai": 0.94,
    "daiyu": 0.93,
    "xiren": 0.93,
    "qinzhong": 0.91,
    "xiangyun": 0.9,
    "mingyan": 0.88,
    "yinger": 0.88,
    "jiahuan": 0.86,
    "laolao": 0.86,
}

# 原图里脸朝向：R 朝画面右侧，L 朝左侧，C 正面。站在左边的人要面朝右、右边的人要面朝左，
# stage-life.js 据此决定是否镜像。未列出的差分沿用基础立绘的朝向。
FACING = {
    "baochai": "R",
    "baoyu": "R",
    "beijingwang": "R",
    "daiyu": "R",
    "daiyu_tearful": "C",
    "fengjie": "R",
    "jiahuan": "R",
    "jiaqiang": "R",
    "jiarui": "R",
    "jiazheng": "L",
    "jinghuan": "C",
    "jingxu": "R",
    "jinshi": "R",
    "keqing": "R",
    "kongkong": "L",
    "kongkong_smile": "C",
    "laolao": "R",
    "lengzixing": "R",
    "mingyan": "R",
    "qinzhong": "R",
    "xiangyun": "C",
    "xiangyun_laugh": "R",
    "xiangyun_pout": "R",
    "xiren": "R",
    "yinger": "R",
    "yuanchun": "R",
    "yucun": "R",
}

BG_SIZE = (2560, 1440)


def stage_params(base: Image.Image, k: float):
    """基础立绘 → 舞台画布的裁切、缩放、摆放参数。差分共用同一组参数。"""
    alpha = base.getchannel("A").point(lambda a: 255 if a > 8 else 0)  # 去掉几乎透明的边缘杂点
    bbox = alpha.getbbox()
    scale = FULL_BODY_H * k / (bbox[3] - bbox[1])
    w = round((bbox[2] - bbox[0]) * scale)
    top = TOP_MARGIN + round((1 - k) * FULL_BODY_H)
    left = (CANVAS_W - w) // 2  # 飘带、拂尘等特别宽的立绘会超出画布，左右对称裁掉
    return bbox, scale, left, top


def to_stage(im: Image.Image, params, reg_entry=None) -> Image.Image:
    """按基础立绘的参数把原图坐标系里的图层（整张立绘或贴片）放到 1280×1440 的舞台画布上。

    差分给出 reg_entry = (s, dx, dy)：先绕原图中心缩放 s 倍再平移 (dx, dy) 对齐到基础立绘。两步合成
    一次仿射，不经过原图大小的中间画布——否则对齐时被推出原图边界的部分（如头顶）会被裁掉。
    """
    bbox, scale, left, top = params
    x0, y0 = bbox[0], bbox[1]
    s, dx, dy = reg_entry or (1.0, 0.0, 0.0)
    cx, cy = im.width / 2, im.height / 2
    a = 1 / (scale * s)
    # 画布像素 (X, Y) ← 基础立绘坐标 (x0 + (X - left) / scale, …) ← 差分原图 (cx + (xb - dx - cx) / s, …)；
    # 画布以下的部分被裁掉
    c = cx + (x0 - left / scale - dx - cx) / s
    f = cy + (y0 - top / scale - dy - cy) / s
    premul = im.convert("RGBa")
    out = premul.transform((CANVAS_W, STAGE_H), Image.AFFINE, (a, 0, c, 0, a, f), Image.BICUBIC)
    return out.convert("RGBA")


def save_webp(im: Image.Image, out: Path, quality: int, *, lossless: bool) -> None:
    im.save(out, "WEBP", quality=quality, lossless=lossless, method=6)
    print(f"{out.relative_to(ROOT)}  {out.stat().st_size // 1024} KB")


def prepare_figures() -> None:
    reg = sa.registration()
    FIGURE_OUT.mkdir(parents=True, exist_ok=True)
    FACE_OUT.mkdir(parents=True, exist_ok=True)
    for old in [*FIGURE_OUT.glob("*.webp"), *FACE_OUT.glob("*.webp")]:
        old.unlink()

    stems = sorted(p.stem for p in sa.SPRITES.glob("*.png"))
    params = {}
    life = {"facing": {}, "patches": {}}
    for stem in stems:
        key = sa.base_name(stem)
        if key not in params:
            params[key] = stage_params(sa.load(sa.SPRITES / f"{key}.png"), HEIGHT[key])
        raw = sa.load(sa.SPRITES / f"{stem}.png")
        save_webp(to_stage(raw, params[key], reg.get(stem)), FIGURE_OUT / f"{stem}.webp", 100, lossless=True)
        life["facing"][stem] = FACING.get(stem, FACING[key])

        for kind in ("blink", "talk"):
            if not (sa.FACE_DIR / f"{stem}.{kind}.png").exists():
                continue
            patch = sa.extract(stem, kind, reg)
            if not patch.ok:
                print(f"  skip {stem}.{kind}: 改图改动了脸部以外的地方（stray={patch.stray:.3f}），需重新生成")
                continue
            layer = Image.new("RGBA", raw.size, (0, 0, 0, 0))
            layer.paste(patch.image, patch.box[:2])
            staged = to_stage(layer, params[key], reg.get(stem))
            box = staged.getchannel("A").point(lambda a: 255 if a > 2 else 0).getbbox()
            if box is None:
                continue
            save_webp(staged.crop(box), FACE_OUT / f"{stem}.{kind}.webp", 100, lossless=True)
            life["patches"].setdefault(stem, {})[kind] = list(box[:2])

    (FIGURE_OUT / "life.json").write_text(json.dumps(life, ensure_ascii=False, sort_keys=True) + "\n")
    print(f"figure/life.json  {len(life['facing'])} 张立绘，{len(life['patches'])} 张有脸部贴片")


def prepare_background(src: Path) -> None:
    im = Image.open(src).convert("RGB")
    tw, th = BG_SIZE
    scale = max(tw / im.width, th / im.height)
    im = im.resize((round(im.width * scale), round(im.height * scale)), Image.LANCZOS)
    left, top = (im.width - tw) // 2, (im.height - th) // 2
    im = im.crop((left, top, left + tw, top + th)).filter(ImageFilter.UnsharpMask(radius=1.6, percent=60, threshold=2))
    save_webp(im, BACKGROUND_OUT / f"{src.stem}.webp", 82, lossless=False)


def main() -> None:
    prepare_figures()
    BACKGROUND_OUT.mkdir(parents=True, exist_ok=True)
    for src in sorted(BACKGROUNDS_IN.glob("*.png")):
        prepare_background(src)


if __name__ == "__main__":
    main()
