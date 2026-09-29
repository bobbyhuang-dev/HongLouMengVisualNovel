"""生成站点图标到 web/icons/：favicon.svg、favicon.ico、apple-touch-icon.png、PWA 图标（含 maskable）。

图形是一枚「玦」——带缺口的玉环，落在胭脂红底上：
  · 玦与「抉」同音，缺口就是抉择；
  · 红底绿玉取自第十七回宝玉给怡红院题的「红香绿玉」（第十八回元春改作「怡红快绿」），也暗合通灵宝玉；
  · 16px 下仍是一个大剪影，不依赖任何字体。

SVG 与各尺寸位图都由下面这组常量画出，改配色或形状只改本文件、重跑即可：

    pip install pillow numpy
    python tools/make_icons.py
"""

import math
from pathlib import Path

import numpy as np
from PIL import Image, ImageFilter

ROOT = Path(__file__).resolve().parent.parent
OUT = ROOT / "web" / "icons"

G = 512  # 设计网格边长，下面所有坐标都以它为准
CORNER = 112  # 底的圆角半径（favicon 与 any 图标；maskable 与 apple-touch 铺满，由系统裁切）
RED = ("#B33840", "#8A222E")  # 胭脂红底，自上而下略深
JADE = [(0.0, "#F0F9F1"), (0.5, "#B8DDC5"), (1.0, "#79B394")]  # 玉色，自左上到右下
JADE_AXIS = (113, 76, 399, 436)  # 玉色渐变轴的起点与终点 (x0, y0, x1, y1)，设计网格坐标
SHADOW = ("#4A0D16", 0.45, 12, 9)  # 玉环投影：颜色、不透明度、下移、模糊 σ
C = G / 2  # 玉环圆心
R_OUT, R_IN = 188, 64  # 外径、孔径；外径占 36.7%，在 maskable 的 40% 安全圈内
GAP_HALF, GAP_ANGLE = 28, -45  # 缺口半宽、缺口方向（度，屏幕坐标，-45 即右上）


def _rgb(hex_color: str) -> np.ndarray:
    return np.array([int(hex_color[i : i + 2], 16) for i in (1, 3, 5)], dtype=np.float32)


def _ramp(t: np.ndarray, stops: list[tuple[float, str]]) -> np.ndarray:
    """分段线性渐变，t 取 0–1，返回 (..., 3)。"""
    pos = [p for p, _ in stops]
    cols = np.stack([_rgb(c) for _, c in stops])
    return np.stack([np.interp(t, pos, cols[:, i]) for i in range(3)], axis=-1)


def _ring(x: np.ndarray, y: np.ndarray) -> np.ndarray:
    """玦：圆环减去一道沿 GAP_ANGLE 方向、两壁平行的缺口。"""
    dx, dy = x - C, y - C
    d2 = dx * dx + dy * dy
    a = math.radians(GAP_ANGLE)
    along = dx * math.cos(a) + dy * math.sin(a)
    across = dy * math.cos(a) - dx * math.sin(a)
    gap = (along > 0) & (np.abs(across) < GAP_HALF)
    return (d2 <= R_OUT**2) & (d2 >= R_IN**2) & ~gap


def _tile(x: np.ndarray, y: np.ndarray) -> np.ndarray:
    qx = np.maximum(np.abs(x - C) - (G / 2 - CORNER), 0)
    qy = np.maximum(np.abs(y - C) - (G / 2 - CORNER), 0)
    return qx * qx + qy * qy <= CORNER**2


def _coverage(n: int, inside) -> np.ndarray:
    """inside(x, y) 在设计网格坐标上的布尔形状，超采样后降到 n×n 的覆盖率。"""
    k = max(4, -(-1024 // n))
    c = (np.arange(n * k, dtype=np.float32) + 0.5) * (G / (n * k))
    x, y = np.meshgrid(c, c)
    return inside(x, y).astype(np.float32).reshape(n, k, n, k).mean(axis=(1, 3))


def render(n: int, *, bleed: bool = False) -> Image.Image:
    """n×n 图标。bleed=True 铺满整张（RGB），否则是带圆角、四角透明的底（RGBA）。"""
    c = (np.arange(n, dtype=np.float32) + 0.5) * (G / n)
    x, y = np.meshgrid(c, c)
    rgb = _ramp(y / G, [(0.0, RED[0]), (1.0, RED[1])])

    shadow_color, shadow_alpha, shadow_dy, shadow_sigma = SHADOW
    shadow = _coverage(n, lambda x, y: _ring(x, y - shadow_dy))
    shadow = Image.fromarray((shadow * 255).round().astype(np.uint8))
    shadow = np.asarray(shadow.filter(ImageFilter.GaussianBlur(shadow_sigma * n / G)), dtype=np.float32) / 255
    a = (shadow * shadow_alpha)[..., None]
    rgb = rgb * (1 - a) + _rgb(shadow_color) * a

    x0, y0, x1, y1 = JADE_AXIS
    t = ((x - x0) * (x1 - x0) + (y - y0) * (y1 - y0)) / ((x1 - x0) ** 2 + (y1 - y0) ** 2)
    a = _coverage(n, _ring)[..., None]
    rgb = rgb * (1 - a) + _ramp(np.clip(t, 0, 1), JADE) * a

    rgb = rgb.round().clip(0, 255).astype(np.uint8)
    if bleed:
        return Image.fromarray(rgb, "RGB")
    alpha = (_coverage(n, _tile) * 255).round().astype(np.uint8)
    return Image.fromarray(np.dstack([rgb, alpha]), "RGBA")


def _ring_path() -> str:
    """与 _ring 同一形状的 SVG 路径：外弧、缺口一壁、内弧（反向）、缺口另一壁。"""
    a = math.radians(GAP_ANGLE)
    d, n = (math.cos(a), math.sin(a)), (-math.sin(a), math.cos(a))

    def p(radius: float, side: int) -> str:
        rho = math.sqrt(radius**2 - GAP_HALF**2)  # 缺口壁与圆的交点
        return f"{C + rho * d[0] + side * GAP_HALF * n[0]:.2f} {C + rho * d[1] + side * GAP_HALF * n[1]:.2f}"

    return (
        f"M{p(R_OUT, 1)}A{R_OUT} {R_OUT} 0 1 1 {p(R_OUT, -1)}"
        f"L{p(R_IN, -1)}A{R_IN} {R_IN} 0 1 0 {p(R_IN, 1)}Z"
    )


def svg() -> str:
    x0, y0, x1, y1 = JADE_AXIS
    stops = "".join(f'<stop offset="{p:g}" stop-color="{c}"/>' for p, c in JADE)
    shadow_color, shadow_alpha, shadow_dy, shadow_sigma = SHADOW
    ring = _ring_path()
    return (
        f'<svg xmlns="http://www.w3.org/2000/svg" width="{G}" height="{G}" viewBox="0 0 {G} {G}">'
        f'<defs><linearGradient id="r" x1="0" y1="0" x2="0" y2="1">'
        f'<stop offset="0" stop-color="{RED[0]}"/><stop offset="1" stop-color="{RED[1]}"/></linearGradient>'
        f'<linearGradient id="j" gradientUnits="userSpaceOnUse" x1="{x0:g}" y1="{y0:g}" x2="{x1:g}" y2="{y1:g}">{stops}</linearGradient>'
        f'<filter id="s" x="-20%" y="-20%" width="140%" height="140%"><feGaussianBlur stdDeviation="{shadow_sigma}"/></filter></defs>'
        f'<rect width="{G}" height="{G}" rx="{CORNER}" fill="url(#r)"/>'
        f'<path d="{ring}" transform="translate(0 {shadow_dy})" fill="{shadow_color}" opacity="{shadow_alpha}" filter="url(#s)"/>'
        f'<path d="{ring}" fill="url(#j)"/></svg>\n'
    )


def main() -> None:
    OUT.mkdir(parents=True, exist_ok=True)
    (OUT / "favicon.svg").write_text(svg(), encoding="utf-8")

    # ICO 每个尺寸单独渲染，不让 Pillow 从大图缩小
    frames = [render(s) for s in (16, 32, 48)]
    frames[-1].save(OUT / "favicon.ico", sizes=[(f.width, f.height) for f in frames], append_images=frames[:-1])

    render(180, bleed=True).save(OUT / "apple-touch-icon.png", optimize=True)
    for s in (192, 512):
        render(s).save(OUT / f"icon-{s}.png", optimize=True)
        render(s, bleed=True).save(OUT / f"icon-{s}-maskable.png", optimize=True)

    for path in sorted(OUT.iterdir()):
        print(f"{path.relative_to(ROOT)}  {path.stat().st_size / 1e3:.1f} KB")


if __name__ == "__main__":
    main()
