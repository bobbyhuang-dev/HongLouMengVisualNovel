"""把 web/ 构建成可部署的 dist/：复制全部文件，并把引擎自带的三套中文字体子集化为 WOFF2。

引擎原版字体共约 38 MB，首屏要加载其中两套（约 25 MB）。子集只保留剧本、引擎界面和 HUD
实际用到的字符，每套降到几百 KB。剧本改动后重新运行即可，字符集每次都从源文件重新收集。

用法（需要 fonttools、brotli）：python tools/build_site.py
"""

import re
import shutil
from pathlib import Path

from fontTools import subset

ROOT = Path(__file__).resolve().parent.parent
SRC = ROOT / "web"
DIST = ROOT / "dist"

# 用来收集字符的文件：剧本、配置、HUD、页面、引擎代码（含界面文案）
CHARSET_SOURCES = [
    *sorted((SRC / "game" / "scene").glob("*.txt")),
    SRC / "game" / "config.txt",
    *sorted(SRC.glob("*.js")),
    *sorted(SRC.glob("*.html")),
    SRC / "manifest.json",
    *sorted((SRC / "assets").glob("*.js")),
]

# 兜底：ASCII、常用标点、全角符号、数字，避免引擎运行时拼出的文字缺字
EXTRA_RANGES = [
    (0x20, 0x7E),
    (0x2000, 0x206F),  # 通用标点（—、…、“” 等）
    (0x3000, 0x303F),  # CJK 标点（「」、。等）
    (0xFF00, 0xFFEF),  # 全角字符
]


def collect_charset() -> str:
    chars = set()
    for path in CHARSET_SOURCES:
        chars.update(path.read_text(encoding="utf-8", errors="ignore"))
    for lo, hi in EXTRA_RANGES:
        chars.update(map(chr, range(lo, hi + 1)))
    return "".join(sorted(c for c in chars if c.isprintable() or c == " "))


def subset_font(ttf: Path, text: str) -> Path:
    out = ttf.with_suffix(".woff2")
    options = subset.Options()
    options.flavor = "woff2"
    options.hinting = False
    options.desubroutinize = True
    options.layout_features = ["*"]
    font = subset.load_font(str(ttf), options)
    subsetter = subset.Subsetter(options)
    subsetter.populate(text=text)
    subsetter.subset(font)
    subset.save_font(font, str(out), options)
    ttf.unlink()
    return out


def main() -> None:
    if DIST.exists():
        shutil.rmtree(DIST)
    shutil.copytree(SRC, DIST)

    text = collect_charset()
    print(f"charset: {len(text)} chars")

    assets = DIST / "assets"
    renamed = {}
    for ttf in sorted(assets.glob("*.ttf")):
        before = ttf.stat().st_size
        woff2 = subset_font(ttf, text)
        renamed[ttf.name] = woff2.name
        print(f"{ttf.name}: {before / 1e6:.1f} MB -> {woff2.name}: {woff2.stat().st_size / 1e3:.0f} KB")

    # 引擎 CSS 里的 @font-face 指向 .ttf，改成子集后的 .woff2
    for css in assets.glob("*.css"):
        s = css.read_text(encoding="utf-8")
        for old, new in renamed.items():
            s = s.replace(f'url(./{old}) format("truetype")', f'url(./{new}) format("woff2")')
        css.write_text(s, encoding="utf-8")
        leftovers = re.findall(r"url\(\./[^)]+\.ttf\)", s)
        if leftovers:
            raise SystemExit(f"{css.name} still references {leftovers}")

    # GitHub Pages 默认跑 Jekyll，会忽略下划线开头的文件；关掉它
    (DIST / ".nojekyll").touch()
    total = sum(p.stat().st_size for p in DIST.rglob("*") if p.is_file())
    print(f"dist: {total / 1e6:.1f} MB")


if __name__ == "__main__":
    main()
