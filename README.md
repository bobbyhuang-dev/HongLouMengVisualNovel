# 红楼抉择

《红楼梦》第 1–20 回剧情分支视觉小说。玩家化身宝玉、黛玉、宝钗、凤姐、贾雨村等人，在 13 个关键时刻做出选择，按「还原原著」的程度计分；单局约 10 分钟，浏览器打开即玩，免登录。

- 在线游玩：https://bobbyhuang-dev.github.io/HongLouMengVisualNovel/
- 规则说明书（课堂讲解/打印用）：[docs/rules.md](docs/rules.md)
- 策划案（节点清单、积分设计）：[docs/game-design.md](docs/game-design.md)
- 前二十回梗概：[docs/story-outline.md](docs/story-outline.md)
- 原著引文依据：[docs/sources/excerpts.md](docs/sources/excerpts.md)

## 目录

| 路径 | 内容 |
|---|---|
| `web/` | 可直接运行的游戏：WebGAL 4.6.5 引擎 + `web/game/`（剧本、立绘、背景、配置、界面模板） |
| `web/game/scene/` | 剧本：`start` 开场 → `act1`–`act4` 四幕 → `review` 石上回顾 → `ending` 结算；`hit`/`miss`/`review_*` 是计分子场景 |
| `web/hud.js` | 右上角「积分 · 用时」浮层（引擎表达式拿不到时间，计时在引擎外做） |
| `art/` | AI 生成的原始 PNG：`sprites/` 立绘、`backgrounds/` 背景、`style-samples/` 画风样稿 |
| `tools/prepare_art.py` | `art/` → `web/game/figure|background/*.webp`（立绘统一身高、背景裁成 2560×1440） |
| `tools/build_site.py` | `web/` → `dist/`，并把引擎的三套中文字体按剧本用字子集化（38 MB → 约 0.7 MB） |

## 本地运行

```sh
python3 -m http.server 8000 --directory web   # 打开 http://localhost:8000/
```

WebGAL 需要通过 http 访问，直接双击 `index.html` 打不开。

## 修改剧本后

剧本是 WebGAL 脚本（[语法文档](https://docs.openwebgal.com/)），每行以英文分号结尾；台词里只用中文标点，英文的 `:` `;` `|` 会被当成语法符号。

```sh
pip install pillow fonttools brotli
python tools/prepare_art.py   # 改了 art/ 里的图才需要
python tools/build_site.py    # 生成 dist/，重新收集字体用字
```

推送到 `main` 后，GitHub Actions 自动构建 `dist/` 并发布到 GitHub Pages（`.github/workflows/pages.yml`）。

## 许可

- 引擎：[WebGAL](https://github.com/OpenWebGAL/WebGAL)，MPL-2.0。
- 字体：思源宋体、资源圆体（SIL OFL 1.1），OPPOSans（随 WebGAL 分发）。
- 原著文本为公有领域；立绘与背景由 AI 生成。
