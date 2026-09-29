# 红楼抉择

《红楼梦》第 1–20 回剧情分支视觉小说。玩家化身宝玉、黛玉、宝钗、凤姐、贾雨村、秦可卿、袭人、秦钟等人，在每回一处、共 20 个关键时刻做出选择，按「还原原著」的程度计分；单局约 13–14 分钟（课堂 15 分钟截止），浏览器打开即玩，免登录。

- 游戏主页：https://hongloumeng.bobbyhuang.dev/ （自由游玩与「加入比赛」都在主页）
- 主持入口：https://hongloumeng.bobbyhuang.dev/admin （创建房间、主持比赛、打开投影计分板）
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
| `web/hud.js` | 自由游玩的「积分 · 用时」浮层，按剧本标记计时 |
| `web/lockdown.js` | 比赛限制：隐藏存档/读档/快速存读档和「回想」，屏蔽滚轮上滑打开回想（防止读档重选、翻历史记录答「石上回顾」） |
| `web/competition-home.js`、`competition-home.css` | 原游戏主页内的加入比赛面板、候场、参赛记录与计分板 |
| `web/admin.html`、`admin.js`、`admin.css` | `/admin` 主持入口：创建房间、开始/结束、二维码与只读投影模式 |
| `web/competition-common.js` | 主页面板与主持入口共用的 API 请求、用时格式和公开成绩表 |
| `web/competition-game.js`、`competition-game.css` | 正式比赛身份、逐题提交、服务端积分与统一计时；刷新续玩，不可重开覆盖成绩 |
| `server/` | Cloudflare Worker API、SQLite Durable Object 房间、从剧本解析的计分规则、截止与并列排名 |
| `art/` | AI 生成的原始 PNG：`sprites/` 立绘及表情差分（`<角色>_<差分>.png`），`sprites/face/` 眨眼与说话改图，`backgrounds/` 背景、`style-samples/` 画风样稿 |
| `tools/prepare_art.py` | `art/` → `web/game/figure|background/*.webp`（立绘统一身高、差分对齐到基础立绘、抠出眨眼/说话贴片，背景裁成 2560×1440）；几何工具在 `tools/sprite_align.py`，差分描述在 `tools/sprite_variants.json` |
| `tools/scene_budget.py` | 估算单局时长：沿剧本走「全部还原」「全部选错」两条路，按阅读速度折算，改剧本后跑一次 |
| `tools/build_site.py` | `web/` → `dist/`，并把引擎的三套中文字体按剧本用字子集化（38 MB → 约 0.7 MB） |
| `tools/make_icons.py` | 生成 `web/icons/`：`favicon.svg`、`favicon.ico`（16/32/48 各自渲染）、`apple-touch-icon.png`、PWA 图标（含 maskable）。图形是一枚「玦」——带缺口的玉环落在胭脂红底上，全部由脚本里的几何常量画出，改形状/配色后重跑（需要 pillow、numpy） |

## 本地运行

完整比赛需要 Node.js、npm 和 uv（构建时自动提供 Python 字体依赖）：

```sh
npm ci
npm run dev   # 玩家 http://localhost:8787/；主持 http://localhost:8787/admin
```

本地房间保存在 `.wrangler/`，与线上房间隔离。只看自由游玩可用静态服务器：

```sh
python3 -m http.server 8000 --directory web   # 打开 http://localhost:8000/
```

WebGAL 需要通过 http 访问，直接双击 `index.html` 打不开。

## 主持一场比赛

1. 在 `/admin` 填房间名称，点击「创建并主持」。投屏二维码或分享六位房间码；加入链接是 `/?room=房间码`，不把主持链接发给玩家。
2. 玩家在游戏主页点击「加入比赛」，或扫码直接打开主页的房间面板，填写本场唯一昵称后候场。每人一台设备、一份正式成绩，没有独立的玩家比赛页面。
3. 主持人核对名单，打开「投影记分板」，点击并确认「开始比赛」。玩家仍在原主页进入正式游戏。服务器统一开始 15 分钟计时，包含开场和加载时间；开赛后不再接受新身份。
4. 玩家逐题提交答案，游戏内点「计分板」即可打开本场成绩面板，不跳转网页。成绩约每 2 秒更新；主持人也可投屏 `/admin?room=房间码&view=board`，该模式只读取公开成绩。通关后固定用时并加一次完成基础分。
5. 到 15 分钟自动收卷，也可由主持人确认提前结束。未完成者保留已提交积分；正常截止用时为 15:00，提前结束则取全场实际经过时间。最终按积分降序、整秒用时升序排名，完全相同则并列（1、1、3）。

主持人和玩家凭证仅保存在创建/加入时的浏览器；公开链接不带凭证。刷新后回原房间，正式游戏点「继续游戏」续玩。不要清除本站数据或换浏览器；不同比赛与自由游玩的存档互相隔离。断网时暂停提交但不停表，以截止前服务器确认的答案为准。

正式游戏地址仍是 `/?room=房间码&play=1`，沿用同一个 WebGAL 页面。页面启动时按参赛身份隔离存档；`/play/房间码/玩家ID/` 仅是资源命名空间，不提供独立游戏页面。

这是课堂记分工具，不是强防作弊考试系统：服务器重算分数、拒绝改答和重复加分，但免注册身份不能证明“一人只能报名一次”，静态剧本也可被查看。主持人仍需核对名单并巡场；建议使用昵称，不收集真实姓名或学号。

## 修改剧本后

剧本是 WebGAL 脚本（[语法文档](https://docs.openwebgal.com/)），每行以英文分号结尾；台词里只用中文标点，英文的 `:` `;` `|` 会被当成语法符号。

```sh
pip install pillow numpy fonttools brotli
python tools/prepare_art.py   # 改了 art/ 里的图才需要
python tools/build_site.py    # 生成 dist/，重新收集字体用字
```

## 部署

主站通过 Cloudflare Worker + Static Assets 发布到 https://hongloumeng.bobbyhuang.dev/。`wrangler.jsonc` 配置 `ASSETS`、`ROOMS` 和 SQLite Durable Object 迁移；首次部署会创建房间存储，不需另建数据库。本机首次部署先安装依赖并登录：

```sh
npm ci
npx wrangler login
npm run deploy
```

GitHub Pages 仍作为**仅自由游玩的静态备用镜像**：推送到 `main` 后，GitHub Actions 自动构建 `dist/` 并发布到 https://bobbyhuang-dev.github.io/HongLouMengVisualNovel/（`.github/workflows/pages.yml`）；不会自动更新 Cloudflare 主站。镜像的比赛入口会引导至主站，不能创建本地假房间。

部署主站时必须保留 `server/index.ts`、`ROOMS` 和 `run_worker_first` 配置，不要用仅静态资源发布替代完整 Worker。发布后检查主页的「加入比赛」、`/admin`、`/api/questions`（应返回 23 道题），并实际创建房间走一遍主页参赛流程，不能只检查静态首页。

若本站出现 `ERR_CONNECTION_CLOSED`，而其他网络能打开，检查 Surge 等广告拦截规则：`DOMAIN-KEYWORD,umeng` 会误匹配 `hongloumeng`。在拦截规则之前添加精确放行 `DOMAIN,hongloumeng.bobbyhuang.dev,Proxy`（`Proxy` 为本机可用代理策略），然后重载配置，不必关闭整个广告拦截。

## 许可

- 引擎：[WebGAL](https://github.com/OpenWebGAL/WebGAL)，MPL-2.0。
- 字体：思源宋体、资源圆体（SIL OFL 1.1），OPPOSans（随 WebGAL 分发）。
- 原著文本为公有领域；立绘与背景由 AI 生成。
