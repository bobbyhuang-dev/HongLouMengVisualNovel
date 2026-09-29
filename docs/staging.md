# 立绘演出

人物不再是一张定格的画：每人有几种表情/姿态，剧本里写明动作，运行时还会自动呼吸、摆动、眨眼、说话、转身相向。

## 三层

| 层 | 谁负责 | 内容 |
|---|---|---|
| 表情 / 姿态 | 剧本 `changeFigureDiff` | 换成同一人物的差分立绘，引擎做交叉淡化；差分已对齐到基础立绘，头不会跳 |
| 动作 | 剧本 `setAnimation`、`-enter` / `-exit` | 点头、欠身、一惊、甩手、走进走出等，见下表 |
| 待机 | `web/stage-life.js` 自动 | 呼吸、按性情摆动、眨眼、说话口型、说话人前倾高亮、左右对站时转身相向 |

## 差分立绘

文件名 `<角色>_<差分>.webp`，描述在 `tools/sprite_variants.json`。

| 角色 | 差分 |
|---|---|
| 空空道人 kongkong | smile 含笑捻须 · ask 捧书发问 |
| 贾宝玉 baoyu | smile 见了妹妹 · angry 摔玉 · timid 见了父亲 · proud 题额得意 · tearful 秦钟临终 |
| 林黛玉 daiyu | sneer 冷笑 · smile 打趣 · tearful 拭泪 |
| 薛宝钗 baochai | smile 温言提点 · shy 摸金锁含羞 · stern 喝住丫头 |
| 王熙凤 fengjie | smile 笑脸迎人 · scheme 暗中算计 · stern 发号施令 · troubled 惊梦 |
| 刘姥姥 laolao | plead 赔笑求告 · joy 千恩万谢 |
| 贾雨村 yucun | ponder 踌躇 · sly 得计 · earnest 厉色驳论 |
| 警幻仙姑 jinghuan | point 指示册页 |
| 贾瑞 jiarui | leer 涎脸 |
| 秦可卿 keqing | sorrow 托梦叮嘱 |
| 净虚 jingxu | wheedle 撺掇 |
| 贾政 jiazheng | scold 呵斥 · nod 微微点头 |
| 贾元春 yuanchun | tearful 省亲垂泪 |
| 史湘云 xiangyun | laugh 大笑 · pout 嗔怪 |
| 冷子兴 lengzixing | gossip 眉飞色舞 |
| 贾蔷 jiaqiang | sly 以扇掩口调拨 |
| 茗烟 mingyan | fierce 撒野骂人 |
| 璜大奶奶 jinshi | angry 气冲冲 · fawn 盛气全消、赔笑 |
| 秦钟 qinzhong | ill 病危 |
| 袭人 xiren | firm 故作决绝 · smile 温言规劝 |
| 贾环 jiahuan | cry 哭闹 |
| 莺儿 yinger | pout 委屈嘟囔 |
| 北静王 beijingwang | （仅基础立绘） |

```
changeFigureDiff:daiyu_sneer.webp -next;          ; 中间位
changeFigureDiff:baoyu_angry.webp -left -next;    ; 左边位
```

差分只能替换已在台上的立绘；人物尚未上场时直接用 `changeFigure:daiyu_sneer.webp`。

## 动作

`setAnimation:<名称> -target=fig-left|fig-center|fig-right -next;`

| 名称 | 动作 | 名称 | 动作 |
|---|---|---|---|
| nod | 点头两下 | shake-head | 摇头 |
| bow | 欠身行礼 | startle | 一惊 |
| tremble | 发抖 | sob | 抽噎 |
| laugh | 笑得发颤 | fling | 蓄力一摔 |
| slump | 颓然低头 | turn-away / turn-back | 拂袖转身 / 回身（配 `-keep` 保持） |
| approach-left / -right | 朝左 / 右凑近一步再退回 | recoil-left / -right | 往左 / 右退半步 |
| lunge-left / -right | 朝左 / 右猛扑一下（抢着争辩） | scuffle | 推搡扭打 |
| expire | 颓然下沉、渐渐消散（临终，配 `-keep` 保持消失） | | |

进出场（写在 `changeFigure` 上）：

| 参数 | 效果 |
|---|---|
| `-enter=walk-in-left` / `walk-in-right` | 从画外一步一顿走到站位 |
| `-enter=rush-in-left` / `rush-in-right` | 从画外冲进来（茗烟闯学堂） |
| `-exit=walk-out-left` / `walk-out-right` | 转身走出画面 |
| `-enter=dream-in` / `-exit=dream-out` | 梦中浮现 / 消散（太虚幻境、石上） |
| `-enter=ghost-in` | 半透明浮现（秦可卿托梦） |

注意：入场动画还没播完时对同一位置执行 `setAnimation`，入场会直接跳到终点。动作放到入场后的下一句台词再写。

## 待机（stage-life.js）

- **性情**：`TEMPER` 为每人设摆幅、快慢——黛玉弱柳扶风慢摇，湘云、贾瑞动得快，贾政几乎不动，刘姥姥带老人的细颤，秦可卿、警幻整个人微微飘浮。
- **心情**：`MOOD` 按差分名调整——`tearful` 抽噎、`angry` 气得发抖、`laugh` 笑得发颤、`timid` 缩着。
- **朝向**：`tools/prepare_art.py` 的 `FACING` 记录每张原画脸朝哪边；站左边的人自动面朝右、站右边的面朝左，换边时有转身动作。
- **说话**：对话框署名对应台上的人时，此人朝对方微微前倾、口型按字数开合，其他人稍暗。署名到立绘的对应在 `SPEAKERS`。
- **眨眼**：每 3–6 秒一次，偶尔连眨两下。

## 美术流程

```sh
pip install pillow numpy
python tools/prepare_art.py
```

1. 差分：按 `tools/sprite_variants.json` 让图像模型从 `art/sprites/<角色>.png` 改画出 `art/sprites/<角色>_<差分>.png`。用 fal.ai 的 gpt-image-2.5-sunburst，透明背景，1024×1536：`python3 tools/fal_image.py "改图指令" -i art/sprites/<角色>.png -o art/sprites/<角色>_<差分>.png --size 1024x1536 --background transparent`（`FAL_KEY` 放环境变量或仓库根目录 `.env`）。
2. 对齐：`prepare_art.py` 首次遇到新差分时按剪影求缩放和平移，缓存在 `art/sprites/registration.json`。重画某个差分后删掉它的条目。
3. 眨眼、说话：取每张立绘的头部特写（`sprite_align.head_crop`），让模型只闭眼 / 只张嘴，存为 `art/sprites/face/<立绘>.blink.png`、`.talk.png`。`prepare_art.py` 只抠出与原图不同的那一小块作为贴片；如果模型改动了脸部以外的地方，会打印 `skip` 并跳过，重新生成即可。原画本来就张着嘴的，`talk` 改成「闭嘴」，运行时效果一样是开合。
4. 输出：`web/game/figure/*.webp`、`web/game/figure/face/*.webp`、`web/game/figure/life.json`（朝向与贴片位置）。
