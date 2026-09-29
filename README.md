# 红楼抉择

《红楼梦》第 1–20 回剧情分支视觉小说。玩家化身宝玉、黛玉、宝钗、凤姐、贾雨村、秦可卿、袭人、秦钟等人，在每回一处、共 20 个关键时刻做出选择，按「还原原著」的程度计分；单局约 13–14 分钟（课堂 15 分钟截止），浏览器打开即玩，免登录。

- 在线游玩：https://bobbyhuang-dev.github.io/HongLouMengVisualNovel/
- 规则说明书（课堂讲解/打印用）：[docs/rules.md](docs/rules.md)
- 策划案（节点清单、积分设计）：[docs/game-design.md](docs/game-design.md)
- 前二十回详细总结与引文核对（剧情范围、剧本引文底本）：[docs/红楼梦前20回详细总结与引文核对.md](docs/红楼梦前20回详细总结与引文核对.md)
- 通行本原文摘录（对照用）：[docs/sources/excerpts.md](docs/sources/excerpts.md)
- 立绘演出（表情差分、动作、待机动态）：[docs/staging.md](docs/staging.md)

## 目录

| 路径 | 内容 |
|---|---|
| `web/` | 可直接运行的游戏：WebGAL 4.6.5 引擎 + `web/game/`（剧本、立绘、背景、配置、界面模板） |
| `web/game/scene/` | 剧本：`start` 开场 → `act1`–`act4` 四幕 → `review` 石上回顾 → `ending` 结算；`hit`/`pw`/`miss`/`review_*` 是计分子场景 |
| `web/stage-life.js` | 立绘待机动态：呼吸、按性情摆动、眨眼、说话口型、说话人前倾、左右对站转身相向（数据来自 `web/game/figure/life.json`） |
| `web/hud.js` | 右上角「积分 · 用时」浮层（引擎表达式拿不到时间，计时在引擎外做） |
| `web/lockdown.js` | 比赛限制：隐藏存档/读档/快速存读档和「回想」，屏蔽滚轮上滑打开回想（防止读档重选、翻历史记录答「石上回顾」） |
| `art/` | AI 生成的原始 PNG：`sprites/` 立绘及表情差分（`<角色>_<差分>.png`），`sprites/face/` 眨眼与说话改图，`backgrounds/` 背景、`style-samples/` 画风样稿 |
| `tools/prepare_art.py` | `art/` → `web/game/figure|background/*.webp`（立绘统一身高、差分对齐到基础立绘、抠出眨眼/说话贴片，背景裁成 2560×1440）；几何工具在 `tools/sprite_align.py`，差分描述在 `tools/sprite_variants.json` |
| `tools/scene_budget.py` | 估算单局时长：沿剧本走「全部还原」「全部选错」两条路，按阅读速度折算，改剧本后跑一次 |
| `tools/build_site.py` | `web/` → `dist/`，并把引擎的三套中文字体按剧本用字子集化（38 MB → 约 0.7 MB） |

## 本地运行

```sh
python3 -m http.server 8000 --directory web   # 打开 http://localhost:8000/
```

WebGAL 需要通过 http 访问，直接双击 `index.html` 打不开。

## 修改剧本后

剧本是 WebGAL 脚本（[语法文档](https://docs.openwebgal.com/)），每行以英文分号结尾；台词里只用中文标点，英文的 `:` `;` `|` 会被当成语法符号。

```sh
pip install pillow numpy fonttools brotli
python tools/prepare_art.py   # 改了 art/ 里的图才需要
python tools/build_site.py    # 生成 dist/，重新收集字体用字
```

推送到 `main` 后，GitHub Actions 自动构建 `dist/` 并发布到 GitHub Pages（`.github/workflows/pages.yml`）。

## 许可

- 引擎：[WebGAL](https://github.com/OpenWebGAL/WebGAL)，MPL-2.0。
- 字体：思源宋体、资源圆体（SIL OFL 1.1），OPPOSans（随 WebGAL 分发）。
- 原著文本为公有领域；立绘与背景由 AI 生成。
