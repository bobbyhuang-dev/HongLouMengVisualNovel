// 让立绘「活」起来：呼吸、随性情摆动、眨眼、说话时口型开合、说话人前倾高亮、两人对站时自动转身相向。
//
// 引擎只负责换立绘、换表情（changeFigureDiff）和剧本里写明的动作（setAnimation / setTransform）；
// 这里在引擎外逐帧叠加「待机」层，所以不影响存档、回放和引擎自己的变换。
// 做法：给每个立绘的 Sprite 挂一个形变滤镜（脚底不动，越往上摆幅越大），
// 眨眼/说话的脸部贴片作为 Sprite 的子节点，随立绘一起形变。
// 数据来自 tools/prepare_art.py 生成的 game/figure/life.json：每张立绘朝向与脸部贴片位置。
(() => {
  const LIFE_URL = './game/figure/life.json';
  const FACE_DIR = './game/figure/face/';

  // 台词署名 → 立绘文件名前缀
  const SPEAKERS = {
    空空道人: 'kongkong',
    贾宝玉: 'baoyu',
    林黛玉: 'daiyu',
    薛宝钗: 'baochai',
    王熙凤: 'fengjie',
    刘姥姥: 'laolao',
    贾雨村: 'yucun',
    警幻仙姑: 'jinghuan',
    贾瑞: 'jiarui',
    秦可卿: 'keqing',
    净虚: 'jingxu',
    贾政: 'jiazheng',
    贾元春: 'yuanchun',
    史湘云: 'xiangyun',
    冷子兴: 'lengzixing',
    贾蔷: 'jiaqiang',
    茗烟: 'mingyan',
    璜大奶奶: 'jinshi',
    北静王: 'beijingwang',
    秦钟: 'qinzhong',
    袭人: 'xiren',
    贾环: 'jiahuan',
    莺儿: 'yinger',
  };

  // 性情：sway 上身摆幅（占身高比例）、swaySpeed 摆动角速度、breath 呼吸起伏、breathSpeed、
  // shiver 细颤（老迈、抽泣）、float 整体飘浮（梦中、仙界）
  const TEMPER = {
    daiyu: { sway: 0.0045, swaySpeed: 0.45, breath: 0.004, breathSpeed: 1.7 }, // 弱柳扶风
    baoyu: { sway: 0.005, swaySpeed: 0.9, breath: 0.004, breathSpeed: 2.2 },
    baochai: { sway: 0.0025, swaySpeed: 0.45, breath: 0.003, breathSpeed: 1.7 }, // 端庄
    fengjie: { sway: 0.004, swaySpeed: 0.75, breath: 0.004, breathSpeed: 2.1 },
    laolao: { sway: 0.005, swaySpeed: 1.1, breath: 0.005, breathSpeed: 2.6, shiver: 0.0008 },
    jiazheng: { sway: 0.0015, swaySpeed: 0.35, breath: 0.003, breathSpeed: 1.7 }, // 板正
    yucun: { sway: 0.0025, swaySpeed: 0.6, breath: 0.0035, breathSpeed: 2.0 },
    jiarui: { sway: 0.006, swaySpeed: 1.25, breath: 0.004, breathSpeed: 2.4 }, // 猴急
    keqing: { sway: 0.006, swaySpeed: 0.35, breath: 0.003, breathSpeed: 1.4, float: 0.006 }, // 托梦
    jinghuan: { sway: 0.005, swaySpeed: 0.4, breath: 0.003, breathSpeed: 1.5, float: 0.005 }, // 仙姑
    jingxu: { sway: 0.003, swaySpeed: 0.7, breath: 0.0035, breathSpeed: 2.0 },
    kongkong: { sway: 0.003, swaySpeed: 0.5, breath: 0.0035, breathSpeed: 1.8 },
    yuanchun: { sway: 0.002, swaySpeed: 0.4, breath: 0.003, breathSpeed: 1.6 }, // 贵妃仪态
    xiangyun: { sway: 0.006, swaySpeed: 1.2, breath: 0.0045, breathSpeed: 2.4 }, // 憨直活泼
    lengzixing: { sway: 0.004, swaySpeed: 0.85, breath: 0.004, breathSpeed: 2.1 }, // 酒肆闲谈
    jiaqiang: { sway: 0.004, swaySpeed: 0.6, breath: 0.0035, breathSpeed: 1.9 }, // 懒散自恃
    mingyan: { sway: 0.0065, swaySpeed: 1.35, breath: 0.0045, breathSpeed: 2.5 }, // 愣头书童
    jinshi: { sway: 0.0035, swaySpeed: 0.8, breath: 0.004, breathSpeed: 2.1 },
    beijingwang: { sway: 0.0018, swaySpeed: 0.4, breath: 0.003, breathSpeed: 1.6 }, // 王爷仪态
    qinzhong: { sway: 0.004, swaySpeed: 0.5, breath: 0.0035, breathSpeed: 1.8 }, // 腼腆
    xiren: { sway: 0.0025, swaySpeed: 0.5, breath: 0.003, breathSpeed: 1.8 }, // 温柔稳重
    jiahuan: { sway: 0.0045, swaySpeed: 1.0, breath: 0.004, breathSpeed: 2.2 },
    yinger: { sway: 0.0055, swaySpeed: 1.15, breath: 0.004, breathSpeed: 2.3 }, // 伶俐
  };
  const DEFAULT_TEMPER = { sway: 0.003, swaySpeed: 0.6, breath: 0.0035, breathSpeed: 2.0 };

  // 表情差分对待机的影响：乘在性情上，shiver/float 取较大者
  const MOOD = {
    tearful: { breathSpeed: 1.6, breath: 1.4, shiver: 0.0012 }, // 抽噎
    sorrow: { breathSpeed: 0.8, sway: 0.8 },
    angry: { breathSpeed: 1.7, breath: 1.6, sway: 0.5, shiver: 0.0007 }, // 气得发抖
    stern: { breathSpeed: 1.2, sway: 0.4 },
    scold: { breathSpeed: 1.4, breath: 1.4, sway: 0.5 },
    laugh: { breathSpeed: 2.2, breath: 1.8, sway: 1.5, swaySpeed: 1.6 }, // 笑得发颤
    joy: { breathSpeed: 1.5, breath: 1.4, sway: 1.3, swaySpeed: 1.4 },
    smile: { sway: 1.15 },
    timid: { sway: 0.5, breath: 0.8, shiver: 0.0005 },
    plead: { sway: 0.7, swaySpeed: 1.3 },
    shy: { sway: 0.6, swaySpeed: 0.8 },
    troubled: { breathSpeed: 1.4, breath: 1.3 },
    leer: { sway: 1.3, swaySpeed: 1.3 },
    wheedle: { sway: 1.2, swaySpeed: 1.2 },
    scheme: { sway: 0.7, swaySpeed: 0.8 },
    ponder: { sway: 0.6, swaySpeed: 0.7 },
    gossip: { sway: 1.3, swaySpeed: 1.3 },
    earnest: { sway: 0.5, breath: 1.2 },
    sly: { sway: 0.7, swaySpeed: 0.8 },
    fierce: { breathSpeed: 1.8, breath: 1.6, sway: 1.2, swaySpeed: 1.5 },
    fawn: { sway: 0.8, swaySpeed: 1.2 },
    ill: { breathSpeed: 0.7, breath: 0.6, sway: 0.4, swaySpeed: 0.5, shiver: 0.0006 }, // 奄奄一息
    firm: { sway: 0.5 },
    cry: { breathSpeed: 1.7, breath: 1.5, shiver: 0.0012 },
    pout: { sway: 1.1 },
  };

  // 上表是各人之间的相对幅度；整体幅度由下面的增益统一放大（头顶位移约为身高的 1%，720p 下 5–10 像素）
  const SWAY_GAIN = 3;
  const BREATH_GAIN = 1.5;
  const SHIVER_GAIN = 2.5;
  const LEAN = 0.022; // 说话人朝对方前倾（头顶水平位移占身高比例）
  const DIM = 0.8; // 旁听者亮度
  const TURN_MS = 260; // 转身时长
  const MS_PER_CHAR = 45; // 口型开合持续：按字数估算打字时长

  const FRAG = `
    precision highp float;
    varying vec2 vTextureCoord;
    uniform sampler2D uSampler;
    uniform vec4 inputSize;
    uniform vec4 outputFrame;
    uniform vec4 inputClamp;
    uniform vec4 uRect;
    uniform float uTime;
    uniform float uSway;
    uniform float uSwaySpeed;
    uniform float uBreath;
    uniform float uBreathSpeed;
    uniform float uShiver;
    uniform float uFloat;
    uniform float uLean;
    uniform float uLight;

    void main(void) {
      vec2 world = vTextureCoord * inputSize.xy + outputFrame.xy;
      vec2 p = (world - uRect.xy) / uRect.zw;
      float h = clamp(1.0 - p.y, 0.0, 1.0);           // 离画面底边（腿部）的高度
      float t = uTime;
      float breath = uBreath * (0.5 + 0.5 * sin(t * uBreathSpeed));
      float hs = h / (1.0 + breath);                     // 以底边为基准向上舒张
      float sway = uSway * (0.7 * sin(t * uSwaySpeed) + 0.3 * sin(t * uSwaySpeed * 0.43 + 1.3));
      float head = uSway * 0.5 * sin(t * uSwaySpeed * 1.7 + 0.7);
      float shiver = uShiver * sin(t * 31.0) * (0.6 + 0.4 * sin(t * 4.7));
      float dx = (sway + uLean) * h * h + head * pow(h, 6.0) + shiver * h;
      float bob = uFloat * sin(t * 1.1);
      vec2 src = vec2(p.x - dx * uRect.w / uRect.z, 1.0 - hs + bob);
      vec2 coord = (uRect.xy + src * uRect.zw - outputFrame.xy) / inputSize.xy;
      coord = clamp(coord, inputClamp.xy, inputClamp.zw);
      vec4 c = texture2D(uSampler, coord);
      gl_FragColor = vec4(c.rgb * uLight, c.a);
    }`;

  let life = { facing: {}, patches: {} };
  fetch(LIFE_URL)
    .then((r) => r.json())
    .then((j) => (life = j))
    .catch(() => {});

  const states = new WeakMap(); // Sprite → 状态
  const t0 = performance.now();

  // ---------- 台词：谁在说、说多久 ----------
  let speaker = '';
  let talkUntil = 0;
  let lastLine = '';
  const readLine = () => {
    const box = document.getElementById('textBoxMain');
    if (!box) return;
    // 引擎把每个字渲染成三层（描边、填充、占位），只取占位层 _zhanwei_ 的文本；署名的字带 showname 类
    let text = '';
    let name = '';
    const walker = document.createTreeWalker(box, NodeFilter.SHOW_TEXT);
    for (let node = walker.nextNode(); node; node = walker.nextNode()) {
      const el = node.parentElement;
      if (!el?.matches('[class*="_zhanwei_"]')) continue;
      if (el.matches('[class*="showname"]')) name += node.data;
      else text += node.data;
    }
    name = name.trim();
    const line = `${name}|${text}`;
    if (line === lastLine) return;
    lastLine = line;
    // 署名在对话框里渲染了两份（正文和描边层），按前缀匹配
    const who = Object.keys(SPEAKERS).find((k) => name.startsWith(k));
    speaker = who ? SPEAKERS[who] : '';
    talkUntil = speaker ? performance.now() + Math.min(300 + text.length * MS_PER_CHAR, 6000) : 0;
  };
  // 点击跳过打字时引擎会一次性显示全文，口型随之停下
  const onClick = () => {
    if (performance.now() < talkUntil) talkUntil = Math.min(talkUntil, performance.now() + 250);
  };

  // ---------- 每个立绘的状态 ----------
  const stemOf = (url) => (url ?? '').split('/').pop().replace(/\.[^.]+$/, '');

  const patchSprite = (stem, kind) => {
    const box = life.patches[stem]?.[kind];
    if (!box) return null;
    const s = PIXI.Sprite.from(`${FACE_DIR}${stem}.${kind}.webp`);
    s.visible = false;
    s.__box = box;
    return s;
  };

  const attach = (sprite, stem) => {
    let st = states.get(sprite);
    if (!st) {
      const filter = new PIXI.Filter(undefined, FRAG, {
        uRect: new Float32Array(4),
        uTime: 0,
        uSway: 0,
        uSwaySpeed: 1,
        uBreath: 0,
        uBreathSpeed: 1,
        uShiver: 0,
        uFloat: 0,
        uLean: 0,
        uLight: 1,
      });
      filter.padding = 0;
      st = {
        filter,
        stem: '',
        phase: Math.random() * 100,
        light: 1,
        lean: 0,
        turn: null, // 当前朝向系数：1 原样，-1 镜像
        nextBlink: performance.now() + 800 + Math.random() * 2500,
        blinkEnd: 0,
        mouthFlip: 0,
        mouthOpen: false,
      };
      states.set(sprite, st);
    }
    if (st.stem !== stem) {
      st.stem = stem;
      for (const p of [st.blink, st.talk]) if (p) sprite.removeChild(p).destroy();
      st.talk = patchSprite(stem, 'talk');
      st.blink = patchSprite(stem, 'blink');
      const { width, height } = sprite.texture.orig;
      for (const p of [st.talk, st.blink]) {
        if (!p) continue;
        p.position.set(p.__box[0] - width / 2, p.__box[1] - height / 2);
        sprite.addChild(p);
      }
      const [key, mood] = stem.split('_');
      const base = { ...DEFAULT_TEMPER, ...TEMPER[key] };
      const m = MOOD[mood] ?? {};
      st.key = key;
      st.idle = {
        sway: base.sway * (m.sway ?? 1) * SWAY_GAIN,
        swaySpeed: base.swaySpeed * (m.swaySpeed ?? 1),
        breath: base.breath * (m.breath ?? 1) * BREATH_GAIN,
        breathSpeed: base.breathSpeed * (m.breathSpeed ?? 1),
        shiver: Math.max(base.shiver ?? 0, m.shiver ?? 0) * SHIVER_GAIN,
        float: base.float ?? 0,
      };
    }
    return st;
  };

  // 站位决定朝向：左边的人面朝右、右边的人面朝左；画面中央只有一人时保持原样
  const wantMirror = (obj, stem) => {
    const natural = life.facing[stem] ?? 'C';
    if (natural === 'C') return false;
    if (obj.key === 'fig-left') return natural === 'L';
    if (obj.key === 'fig-right') return natural === 'R';
    return false;
  };

  const lerp = (a, b, k) => a + (b - a) * k;

  let lastFrame = performance.now();
  const frame = () => {
    requestAnimationFrame(frame);
    const now = performance.now();
    const dt = Math.min(now - lastFrame, 100);
    lastFrame = now;
    const stage = window.PIXIapp;
    const app = stage?.currentApp;
    if (!app || document.hidden) return;
    const figures = stage.figureObjects.filter((o) => o.sourceType === 'img' && o.pixiContainer?.children[0] instanceof PIXI.Sprite);
    if (!figures.length) return;
    readLine();
    const speakerOnStage = figures.some((o) => stemOf(o.sourceUrl).split('_')[0] === speaker);
    const res = app.renderer.resolution;
    const t = (now - t0) / 1000;

    for (const obj of figures) {
      const sprite = obj.pixiContainer.children[0];
      const stem = stemOf(obj.sourceUrl);
      const st = attach(sprite, stem);
      const f = st.filter;
      if (!sprite.filters?.includes(f)) sprite.filters = [...(sprite.filters ?? []), f];
      f.resolution = res;

      // 朝向：换边或刚上场时转身（先压扁再展开）
      const target = wantMirror(obj, stem) ? -1 : 1;
      if (st.turn === null) st.turn = target;
      else if (st.turn !== target) st.turn = Math.sign(target - st.turn) * Math.min(Math.abs(target - st.turn), (2 * dt) / TURN_MS) + st.turn;
      const mag = Math.abs(sprite.scale.y); // 立绘等比缩放，scale.y 从不改动
      sprite.scale.x = mag * (Math.abs(st.turn) < 0.02 ? 0.02 * target : st.turn);

      // 说话人：前倾、高亮、口型；旁听者：略暗
      const speaking = st.key === speaker;
      const center = app.screen.width / 2;
      const b = sprite.getBounds(true);
      const side = b.x + b.width / 2 < center - 1 ? 1 : b.x + b.width / 2 > center + 1 ? -1 : 0;
      st.lean = lerp(st.lean, speaking ? LEAN * side : 0, Math.min(dt / 250, 1));
      st.light = lerp(st.light, speakerOnStage && !speaking ? DIM : 1, Math.min(dt / 200, 1));

      const u = f.uniforms;
      u.uRect[0] = b.x;
      u.uRect[1] = b.y;
      u.uRect[2] = b.width;
      u.uRect[3] = b.height;
      u.uTime = t + st.phase;
      u.uSway = st.idle.sway;
      u.uSwaySpeed = st.idle.swaySpeed;
      u.uBreath = st.idle.breath;
      u.uBreathSpeed = st.idle.breathSpeed;
      u.uShiver = st.idle.shiver;
      u.uFloat = st.idle.float;
      u.uLean = st.lean;
      u.uLight = st.light;

      // 眨眼：3–6 秒一次，偶尔连眨两下
      const hideFace = obj.isDiffBlending || obj.isExiting;
      if (st.blink) {
        if (now >= st.nextBlink) {
          st.blinkEnd = now + 110;
          st.nextBlink = now + (Math.random() < 0.2 ? 260 : 2800 + Math.random() * 3200);
        }
        st.blink.visible = !hideFace && now < st.blinkEnd;
      }
      // 口型：打字期间不规则开合
      if (st.talk) {
        const talking = speaking && now < talkUntil;
        if (!talking) st.mouthOpen = false;
        else if (now >= st.mouthFlip) {
          st.mouthOpen = !st.mouthOpen;
          st.mouthFlip = now + (st.mouthOpen ? 90 + Math.random() * 110 : 60 + Math.random() * 90);
        }
        st.talk.visible = !hideFace && st.mouthOpen;
      }
    }
    stage.requestRender();
  };

  const mount = () => {
    document.addEventListener('pointerdown', onClick, true);
    requestAnimationFrame(frame);
  };
  if (document.body) mount();
  else document.addEventListener('DOMContentLoaded', mount);
})();
