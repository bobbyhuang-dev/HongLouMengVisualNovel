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

## 服饰重设计（2026-09）

本轮重做 **20 / 23 个角色、20 张基础立绘和 37 张表情／动作差分**。空空道人、警幻仙姑、净虚的原设计未改。全套新服饰通过 **fal.ai `gpt-image-2.5-sunburst`、`quality=max`、原生 2048×3072 透明 PNG** 生成，再完成构图配准、头部合成与脸部贴片处理；没有把 sub2api 对照样图混入游戏。

参考 [`12图/`](12图/) 的工笔人物画，重在连续衣片、合理襟口和袖型、布料垂坠、主仆与身份差异，去掉碎裂裙摆、焦黑边缘和不必要的飘带。画作是设计参考，不是服装考古图录；本轮属于结合原著的游戏服饰改编，不宣称是单一朝代的严格复原。宝钗配色参考[第八回的服饰描写](https://zh.wikisource.org/zh-hans/紅樓夢/第008回)。

| 角色 | 服饰与保留物件 |
|---|---|
| 贾宝玉 | 大红窄箭袖袍、石青长褂、宫绦；保留通灵玉与摔玉动作 |
| 林黛玉 | 浅青右衽长袄、浅粉裙，克制兰纹；保留手帕与拭泪动作 |
| 薛宝钗 | 蜜合色棉袄、玫瑰紫比肩褂、葱黄裙；保留金锁 |
| 王熙凤 | 大红窄袖袄、石青褂、翡翠绿裙，保留细金纹与手帕 |
| 刘姥姥 | 褪色靛蓝棉袄、深灰下装、布扣与缝补，旧而不碎烂 |
| 贾雨村 | 深青圆领官袍、直身衣片、朴素腰带，不臆定具体品级补子 |
| 贾瑞 | 蓝灰书生袍、窄白领边、布带，宽直袖而非层叠喇叭袖 |
| 秦可卿 | 淡藕灰／浅紫闭襟长袄、浅色裙，保留托梦告诫姿态 |
| 贾政 | 素净蓝灰直身长袍，保留侧身与呵斥、点头动作 |
| 贾元春 | 金色宫袍、规整凤纹、窄红色下层，保留冠饰与省亲拭泪 |
| 史湘云 | 珊瑚红短袄、浅色缘边、灰绿裙，保留大笑与叉腰姿态 |
| 冷子兴 | 棕色长袍、深灰褂，保留酒杯与说话手势 |
| 贾蔷 | 浅青暗纹直身袍、窄深绿腰带，保留折扇 |
| 茗烟 | 靛蓝短衣、束脚裤、布鞋，保留举拳与指人动作 |
| 璜大奶奶 | 暗粉紫素袄、深蓝灰裙，去掉不合身份的金饰与奢华缘边 |
| 秦钟 | 淡紫书生袍；`ill` 单独保留素白中衣与灰色夹被，不与常服混用 |
| 袭人 | 旧玫瑰色素袄、灰绿裙、布扣，以实用衣着区别于小姐 |
| 贾环 | 暗赭橄榄色童袍、素领袖与腰带，不用皇家纹样 |
| 莺儿 | 柔黄短袄、苔绿裙、布扣；不佩宝钗的金锁 |
| 北静王 | 月白蟒纹袍、玉饰腰带，保留胸前念珠 |

衣服更换后同步更新了 **114 张脸部改图源文件**：贾瑞 `leer` 的眨眼／口型、秦钟 `ill` 的口型重新生成，其余按新几何关系重映射。保留旧头部时先对齐整体身高与头顶位置，并限制回贴区域，避免把旧衣领、近脸手势重叠粘进新服饰。

验收使用实际 WebGAL 舞台逐张加载 57 张新图，走完 37 次 `changeFigureDiff`，观察到全部新图的眨眼和说话口型；完整导出包含 64 张游戏立绘和 128 张脸部贴片。临时验收剧本只在浏览器请求中替换，未改正式剧情。

- [20 人服饰总览](../art/style-samples/costume-redesign/contact-sheet.jpg)
- [生成参数、请求编号与资产清单](../art/style-samples/costume-redesign/manifest.json)
- [舞台验收截图（双侧站位）](../art/style-samples/costume-redesign/runtime-review.jpg)
- [fal.ai / sub2api 单图对照留样](../art/style-samples/costume-redesign/baochai-provider-comparison.jpg)（sub2api 当次实际返回 1024×1536、工具回报 `medium`，未用于游戏）

## 美术流程

```sh
pip install pillow numpy
python tools/prepare_art.py
```

1. 差分：按 `tools/sprite_variants.json` 从 `art/sprites/<角色>.png` 改画。使用 fal.ai sunburst、`max` 质量、透明背景，并与该角色基础图保持相同画布尺寸。本轮 20 个角色为 2048×3072；未重画的三个角色仍为 1024×1536。例如：`python3 tools/fal_image.py "改图指令" -i art/sprites/baochai.png -o art/sprites/baochai_smile.png -m sunburst --quality max --size 2048x3072 --background transparent`（`FAL_KEY` 放环境变量或仓库根目录 `.env`）。重做服饰时同时输入原差分和已确认的新基础图，分别锁定动作与服装，不用基础姿势替代差分动作。
2. 对齐：`prepare_art.py` 首次遇到新差分时按剪影求缩放和平移，缓存在 `art/sprites/registration.json`。重画差分后删掉对应条目；基础图构图改变时，其全部差分也需重新对齐。本轮先配准到原构图，再保留原头部，因此画布扩大两倍后保持缩放值不变、将平移坐标乘二；不能直接把旧平移值用于更大的画布。
3. 眨眼、说话：用 `sprite_align.head_crop` 取得 1024×1024 头部特写，让模型只闭眼／只改变嘴形，存为 `art/sprites/face/<立绘>.blink.png`、`.talk.png`。改画立绘后必须按新的头部裁切重新映射或生成贴片，不能盲用旧坐标。`prepare_art.py` 只提取局部改动；出现 `skip` 时检查并重做对应改图，不放宽验证阈值。原画已经张嘴时，`talk` 改成闭嘴，效果仍是开合。
4. 输出：`web/game/figure/*.webp` 为 1280×1440 **无损 WebP**，脸部贴片也无损导出；`web/game/figure/life.json` 记录朝向与贴片位置。背景维持原有有损导出设置。
