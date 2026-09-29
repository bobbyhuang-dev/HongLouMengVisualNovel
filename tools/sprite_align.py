"""立绘差分的几何工具：差分对齐到基础立绘、定位头部、从改图里抠出眨眼/说话补丁。

图像模型改图时会整张重画，画面有轻微的缩放、平移。所以：
- 表情差分（art/sprites/<角色>_<差分>.png）先按剪影对齐到基础立绘，切换表情时人物不会跳动；
- 眨眼、说话是在头部特写上改的（art/sprites/face/<立绘>.<blink|talk>.png），先对齐回原图，
  再只取与原图差异集中的那一小块（眼睛或嘴），羽化边缘后作为贴片。
"""

import json
from dataclasses import dataclass
from pathlib import Path

import numpy as np
from PIL import Image, ImageFilter

ROOT = Path(__file__).resolve().parent.parent
SPRITES = ROOT / "art" / "sprites"
FACE_DIR = SPRITES / "face"
REGISTRATION = SPRITES / "registration.json"
FACE_SIZE = 1024  # 头部特写送去改图时的边长

DIFF_THRESHOLD = 0.10  # 灰度差超过它算「改过的像素」
MAX_PATCH = 0.55  # 补丁宽高不超过头部方框边长的这个比例：眼睛或嘴不会更大
MAX_STRAY = 0.03  # 头部方框内、补丁以外被改动像素的比例上限，超出说明模型重画了整张脸


# ---------- 通用 ----------


def load(path: Path) -> Image.Image:
    return Image.open(path).convert("RGBA")


def to_arr(im: Image.Image) -> np.ndarray:
    return np.asarray(im, dtype=np.float32) / 255


def gray(a: np.ndarray) -> np.ndarray:
    # 透明处当作中灰：否则深色头发和透明背景几乎同值，对齐会偏向缩小
    return a[..., :3].mean(-1) * a[..., 3] + 0.6 * (1 - a[..., 3])


def affine(im: Image.Image, s: float, dx: float, dy: float, cx: float, cy: float, box=None) -> Image.Image:
    """绕 (cx, cy) 缩放 s 倍再平移 (dx, dy)；给了 box 就只输出这一块。"""
    a = 1 / s
    ox, oy = (box[0], box[1]) if box else (0, 0)
    size = (box[2] - box[0], box[3] - box[1]) if box else im.size
    c = cx - (dx + cx) * a + ox * a
    f = cy - (dy + cy) * a + oy * a
    return im.transform(size, Image.AFFINE, (a, 0, c, 0, a, f), Image.BICUBIC)


def search(score, s0, dx0, dy0, span_s, step_s, span_d, step_d):
    """网格搜索使 score 最小的 (s, dx, dy)。"""
    best = None
    for s in np.arange(s0 - span_s, s0 + span_s + 1e-9, step_s):
        for dx in np.arange(dx0 - span_d, dx0 + span_d + 1e-9, step_d):
            for dy in np.arange(dy0 - span_d, dy0 + span_d + 1e-9, step_d):
                e = score(s, dx, dy)
                if best is None or e < best[0]:
                    best = (e, float(s), float(dx), float(dy))
    return best[1:]


def trimmed_mse(a: np.ndarray, b: np.ndarray, keep: float) -> float:
    """只看最吻合的 keep 比例像素：改过的眼睛、嘴、手势不参与对齐。"""
    err = ((a - b) ** 2).ravel()
    n = int(err.size * keep)
    return float(np.partition(err, n)[:n].mean())


# ---------- 表情差分对齐 ----------


def _mask(im: Image.Image, k: int) -> np.ndarray:
    return np.asarray(im.getchannel("A").resize((im.width // k, im.height // k), Image.BILINEAR)) > 128


def register(base: Image.Image, var: Image.Image) -> tuple[float, float, float]:
    """剪影 IoU 最大的 (s, dx, dy)：affine(var, s, dx, dy, w/2, h/2) 与 base 重合。"""
    k = 4
    mb = _mask(base, k)
    v_small = var.resize((var.width // k, var.height // k), Image.BILINEAR)
    cx, cy = v_small.width / 2, v_small.height / 2

    def score(s, dx, dy):
        w = np.asarray(affine(v_small, s, dx, dy, cx, cy).getchannel("A")) > 128
        return -(w & mb).sum() / max((w | mb).sum(), 1)

    s, dx, dy = search(score, 1.0, 0, 0, 0.15, 0.02, 24, 3)
    s, dx, dy = search(score, s, dx, dy, 0.02, 0.005, 3, 1)
    return s, dx * k, dy * k


def registration() -> dict[str, list[float]]:
    """所有差分相对基础立绘的对齐参数，缓存在 art/sprites/registration.json（重新生成差分后删掉对应条目）。"""
    cache = json.loads(REGISTRATION.read_text()) if REGISTRATION.exists() else {}
    changed = False
    for path in sorted(SPRITES.glob("*_*.png")):
        if path.stem in cache:
            continue
        base = load(SPRITES / f"{base_name(path.stem)}.png")
        cache[path.stem] = [round(v, 4) for v in register(base, load(path))]
        print(f"register {path.stem}: s={cache[path.stem][0]} d=({cache[path.stem][1]}, {cache[path.stem][2]})")
        changed = True
    if changed:
        REGISTRATION.write_text(json.dumps(cache, indent=1, sort_keys=True) + "\n")
    return cache


def base_name(stem: str) -> str:
    return stem.split("_")[0]


# ---------- 头部 ----------


def base_head_box(base: Image.Image) -> tuple[int, int, int, int]:
    """基础立绘的头部方框：人物顶部往下、以头顶剪影中线为中心的正方形。"""
    a = np.asarray(base.getchannel("A")) > 128
    ys = np.nonzero(a.any(1))[0]
    top, height = int(ys[0]), int(ys[-1] - ys[0])
    band = a[top : top + int(height * 0.12)]
    cx = int(np.median(np.nonzero(band)[1]))
    side = int(height * 0.25)
    y0 = max(top - int(height * 0.01), 0)
    return (cx - side // 2, y0, cx - side // 2 + side, y0 + side)


def head_box(stem: str, reg: dict[str, list[float]]) -> tuple[int, int, int, int]:
    """任一立绘的头部方框。差分的头部位置由基础立绘的方框经对齐参数反推，再放大一圈防止歪头出框。"""
    base = load(SPRITES / f"{base_name(stem)}.png")
    x0, y0, x1, y1 = base_head_box(base)
    if stem not in reg:
        return (x0, y0, x1, y1)
    s, dx, dy = reg[stem]
    cx, cy = base.width / 2, base.height / 2
    inv = lambda x, c, d: (x - d - c) / s + c  # noqa: E731
    x0, x1 = inv(x0, cx, dx), inv(x1, cx, dx)
    y0, y1 = inv(y0, cy, dy), inv(y1, cy, dy)
    side = (x1 - x0) * 1.15
    mx, my = (x0 + x1) / 2, (y0 + y1) / 2
    return (round(mx - side / 2), round(my - side / 2), round(mx + side / 2), round(my + side / 2))


def head_crop(stem: str, reg) -> Image.Image:
    """送去改图的头部特写（越界部分透明），放大到 FACE_SIZE 见方。"""
    return load(SPRITES / f"{stem}.png").crop(head_box(stem, reg)).resize((FACE_SIZE, FACE_SIZE), Image.LANCZOS)


# ---------- 眨眼 / 说话补丁 ----------


@dataclass
class Patch:
    box: tuple[int, int, int, int]  # 补丁在该立绘原图中的位置
    image: Image.Image  # RGBA，边缘已羽化
    stray: float
    side: int

    @property
    def ok(self) -> bool:
        w, h = self.box[2] - self.box[0], self.box[3] - self.box[1]
        visible = bool(np.asarray(self.image.getchannel("A")).max() > 2)
        return visible and self.stray <= MAX_STRAY and 0 < max(w, h) <= self.side * MAX_PATCH


def _largest_cluster(mask: np.ndarray, cell: int) -> tuple[int, int, int, int]:
    """改动像素按网格计数，取最大连通块的包围盒（两只眼睛隔得开，允许隔两格也算连通）。"""
    h, w = mask.shape
    gh, gw = h // cell, w // cell
    grid = mask[: gh * cell, : gw * cell].reshape(gh, cell, gw, cell).mean((1, 3)) > 0.08
    seen = np.zeros_like(grid)
    best: list[tuple[int, int]] = []
    for y, x in zip(*np.nonzero(grid)):
        if seen[y, x]:
            continue
        stack, cells = [(y, x)], []
        seen[y, x] = True
        while stack:
            cy, cx = stack.pop()
            cells.append((cy, cx))
            for ny in range(max(cy - 2, 0), min(cy + 3, gh)):
                for nx in range(max(cx - 2, 0), min(cx + 3, gw)):
                    if grid[ny, nx] and not seen[ny, nx]:
                        seen[ny, nx] = True
                        stack.append((ny, nx))
        if len(cells) > len(best):
            best = cells
    if not best:
        return (0, 0, 0, 0)
    ys, xs = [c[0] for c in best], [c[1] for c in best]
    return (min(xs) * cell, min(ys) * cell, (max(xs) + 1) * cell, (max(ys) + 1) * cell)


def extract(stem: str, kind: str, reg) -> Patch:
    """把 art/sprites/face/<stem>.<kind>.png 对齐回头部特写，抠出改动的那一块，返回原图坐标下的补丁。"""
    box = head_box(stem, reg)
    side = box[2] - box[0]
    ref = head_crop(stem, reg)  # FACE_SIZE 见方
    edit = load(FACE_DIR / f"{stem}.{kind}.png").resize(ref.size, Image.LANCZOS)
    c = FACE_SIZE / 2

    g_ref = gray(to_arr(ref))
    fine = lambda s, dx, dy: trimmed_mse(gray(to_arr(affine(edit, s, dx, dy, c, c))), g_ref, 0.85)  # noqa: E731
    if trimmed_mse(gray(to_arr(edit)), g_ref, 0.85) < 2e-4:  # 改图通常逐像素对齐，直接用
        s, dx, dy = 1.0, 0.0, 0.0
    else:
        k = 4
        r_small, e_small = ref.resize((FACE_SIZE // k,) * 2, Image.BILINEAR), edit.resize((FACE_SIZE // k,) * 2, Image.BILINEAR)
        g_small = gray(to_arr(r_small))
        s, dx, dy = search(
            lambda s, dx, dy: trimmed_mse(gray(to_arr(affine(e_small, s, dx / k, dy / k, c / k, c / k))), g_small, 0.85),
            1.0, 0, 0, 0.08, 0.01, 48, 4,
        )
        s, dx, dy = search(fine, s, dx, dy, 0.01, 0.0025, 4, 1)
    aligned = affine(edit, s, dx, dy, c, c)

    # 只比较两图都不透明的内部：剪影边缘的抗锯齿每次重画都不同，不算改动
    solid = lambda im: np.asarray(im.getchannel("A").filter(ImageFilter.MinFilter(25))) > 200  # noqa: E731
    body = solid(ref) & solid(aligned)
    b = to_arr(ref.filter(ImageFilter.GaussianBlur(3)))
    a = to_arr(aligned.filter(ImageFilter.GaussianBlur(3)))
    changed = (np.abs(gray(a) - gray(b)) > DIFF_THRESHOLD) & body
    x0, y0, x1, y1 = _largest_cluster(changed, 32)
    pad = 40
    pbox = (max(x0 - pad, 0), max(y0 - pad, 0), min(x1 + pad, FACE_SIZE), min(y1 + pad, FACE_SIZE))
    inside = np.zeros_like(changed)
    inside[pbox[1] : pbox[3], pbox[0] : pbox[2]] = True
    stray = float((changed & ~inside).sum() / max(body.sum(), 1))

    feather = Image.fromarray((changed & inside).astype(np.uint8) * 255)
    feather = feather.filter(ImageFilter.MaxFilter(31)).filter(ImageFilter.GaussianBlur(14))
    out = np.asarray(aligned, dtype=np.float32).copy()
    out[..., 3] = np.minimum(out[..., 3], np.asarray(ref.getchannel("A"), dtype=np.float32)) * (np.asarray(feather, dtype=np.float32) / 255)
    full = Image.fromarray(out.round().astype(np.uint8), "RGBA").crop(pbox)

    # 头部特写坐标 → 原图坐标
    k = side / FACE_SIZE
    obox = (box[0] + round(pbox[0] * k), box[1] + round(pbox[1] * k), box[0] + round(pbox[2] * k), box[1] + round(pbox[3] * k))
    image = full.resize((obox[2] - obox[0], obox[3] - obox[1]), Image.LANCZOS)
    return Patch(obox, image, stray, side)
