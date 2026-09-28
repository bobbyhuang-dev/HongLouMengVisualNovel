"""把 art/ 下的原始 PNG 转成引擎用的 WebP。

用法（需要 Pillow）：python tools/prepare_art.py

立绘：WebGAL 会把立绘等比缩放到舞台高度（1440）并底部对齐，所以原图里留白多少会直接变成
屏幕上的大小差异。这里先按不透明区域裁切，再按角色身高系数统一放大：头顶留 40px，
下半身超出画布的部分被裁掉（对话框本来就会挡住腿部）。
背景：等比缩放并居中裁切到 2560x1440。
"""

from pathlib import Path

from PIL import Image

ROOT = Path(__file__).resolve().parent.parent
SPRITES_IN = ROOT / "art" / "sprites"
BACKGROUNDS_IN = ROOT / "art" / "backgrounds"
FIGURE_OUT = ROOT / "web" / "game" / "figure"
BACKGROUND_OUT = ROOT / "web" / "game" / "background"

STAGE_H = 1440
CANVAS_W = 1280  # 两个立绘分站左右时各占半个舞台（2560 / 2）
FULL_BODY_H = 1800  # 身高系数为 1 的角色，全身高度放大到这么高
TOP_MARGIN = 40

# 相对身高：成年男子 1.0；成年女子、少年略矮；刘姥姥弯腰驼背。
HEIGHT = {
    "jiazheng": 1.0,
    "yucun": 1.0,
    "kongkong": 1.0,
    "jiarui": 0.99,
    "fengjie": 0.96,
    "keqing": 0.96,
    "yuanchun": 0.96,
    "jinghuan": 0.97,
    "jingxu": 0.93,
    "baoyu": 0.95,
    "baochai": 0.94,
    "daiyu": 0.93,
    "xiangyun": 0.9,
    "laolao": 0.86,
}

BG_SIZE = (2560, 1440)


def prepare_sprite(src: Path) -> None:
    name = src.stem
    k = HEIGHT[name]
    im = Image.open(src).convert("RGBA")
    # 去掉几乎透明的边缘杂点后再求包围盒
    alpha = im.getchannel("A").point(lambda a: 255 if a > 8 else 0)
    im = im.crop(alpha.getbbox())
    scale = FULL_BODY_H * k / im.height
    im = im.resize((round(im.width * scale), round(im.height * scale)), Image.LANCZOS)
    if im.width > CANVAS_W:  # 飘带、拂尘等特别宽的立绘，左右对称裁掉
        cut = (im.width - CANVAS_W) // 2
        im = im.crop((cut, 0, cut + CANVAS_W, im.height))
    top = TOP_MARGIN + round((1 - k) * FULL_BODY_H)
    # 超出画布底部的部分（小腿以下）不参与合成
    im = im.crop((0, 0, im.width, min(im.height, STAGE_H - top)))
    canvas = Image.new("RGBA", (CANVAS_W, STAGE_H), (0, 0, 0, 0))
    canvas.alpha_composite(im, ((CANVAS_W - im.width) // 2, top))
    out = FIGURE_OUT / f"{name}.webp"
    canvas.save(out, "WEBP", quality=86, method=6)
    print(f"figure  {out.relative_to(ROOT)}  {out.stat().st_size // 1024} KB")


def prepare_background(src: Path) -> None:
    im = Image.open(src).convert("RGB")
    tw, th = BG_SIZE
    scale = max(tw / im.width, th / im.height)
    im = im.resize((round(im.width * scale), round(im.height * scale)), Image.LANCZOS)
    left, top = (im.width - tw) // 2, (im.height - th) // 2
    im = im.crop((left, top, left + tw, top + th))
    out = BACKGROUND_OUT / f"{src.stem}.webp"
    im.save(out, "WEBP", quality=82, method=6)
    print(f"bg      {out.relative_to(ROOT)}  {out.stat().st_size // 1024} KB")


def main() -> None:
    FIGURE_OUT.mkdir(parents=True, exist_ok=True)
    BACKGROUND_OUT.mkdir(parents=True, exist_ok=True)
    for src in sorted(SPRITES_IN.glob("*.png")):
        prepare_sprite(src)
    for src in sorted(BACKGROUNDS_IN.glob("*.png")):
        prepare_background(src)


if __name__ == "__main__":
    main()
