// 常驻「积分 · 用时」浮层。
// WebGAL 的表达式求值是沙箱化的，脚本里拿不到时间，所以计时放在引擎外：
// 监听对话框文字，看到【计时开始】开始计时，看到【计时结束】定格；
// 积分从剧本输出的「当前积分：N」「总积分：N」中读取。
(() => {
  const START = '【计时开始】';
  const END = '【计时结束】';
  const SCORE_RE = /(?:当前积分|总积分)[：:]\s*(\d+)/;
  const KEY = 'hlm-hud';

  const load = () => {
    try {
      return JSON.parse(localStorage.getItem(KEY)) ?? {};
    } catch {
      return {};
    }
  };
  let state = { phase: 'idle', t0: 0, t1: 0, score: 0, sawTitle: false, ...load() };
  const save = () => localStorage.setItem(KEY, JSON.stringify(state));

  const hud = document.createElement('div');
  hud.id = 'hlm-hud';
  hud.innerHTML = '<span class="hlm-score"></span><span class="hlm-sep">·</span><span class="hlm-time"></span>';
  const style = document.createElement('style');
  style.textContent = `
    #hlm-hud {
      position: fixed; top: 12px; right: 16px; z-index: 2147483647;
      display: none; gap: .5em; align-items: baseline;
      padding: .35em .9em; border-radius: 999px;
      background: rgba(30, 27, 24, .72); color: #f3ede2;
      border: 1px solid rgba(243, 237, 226, .35);
      font: 600 clamp(14px, 1.6vw, 22px)/1.2 "资源圆体", "PingFang SC", "Microsoft YaHei", sans-serif;
      letter-spacing: .05em; pointer-events: none; user-select: none;
      font-variant-numeric: tabular-nums;
    }
    #hlm-hud.finished {
      top: 50%; right: 50%; transform: translate(50%, -50%) translateY(-28vh);
      font-size: clamp(22px, 3vw, 44px); background: rgba(120, 28, 36, .88);
      border-color: rgba(255, 220, 160, .7);
    }
    #hlm-hud .hlm-sep { opacity: .6; }
  `;

  const fmt = (ms) => {
    const s = Math.max(0, Math.floor(ms / 1000));
    return `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`;
  };

  const render = () => {
    // 模板会把 Title_main 换成随机的 css-xxxx 类名，只有内联的标题背景图是稳定的
    const onTitle = !!document.querySelector('#root [style*="background/title.webp"]');
    if (onTitle && state.phase === 'running' && !state.sawTitle) {
      state.sawTitle = true;
      save();
    }
    const visible = state.phase !== 'idle' && !onTitle;
    hud.style.display = visible ? 'flex' : 'none';
    if (!visible) return;
    const finished = state.phase === 'finished';
    hud.classList.toggle('finished', finished);
    hud.querySelector('.hlm-score').textContent = `积分 ${state.score}`;
    hud.querySelector('.hlm-time').textContent = `${finished ? '用时' : '⏱'} ${fmt((finished ? state.t1 : Date.now()) - state.t0)}`;
  };

  // 对话框里每段文字渲染三层（描边、填充、占位），只取占位层 _zhanwei_ 自身的文本节点，得到一份原文。
  const dialogueText = () => {
    const box = document.getElementById('textBoxMain');
    if (!box) return '';
    let out = '';
    const walker = document.createTreeWalker(box, NodeFilter.SHOW_TEXT);
    for (let node = walker.nextNode(); node; node = walker.nextNode()) {
      if (node.parentElement?.matches('[class*="_zhanwei_"]')) out += node.data;
    }
    return out;
  };

  const inspect = () => {
    const text = dialogueText();
    if (!text) return;
    // 回到标题再开新局会重新出现开始标记，重新计时；刷新或关掉页面后「继续游戏」不会出现开始标记，计时延续。
    if (text.includes(START) && (state.phase !== 'running' || state.sawTitle)) {
      state = { phase: 'running', t0: Date.now(), t1: 0, score: 0, sawTitle: false };
      save();
    }
    if (state.phase !== 'running') return;
    const m = text.match(SCORE_RE);
    if (m && Number(m[1]) !== state.score) {
      state.score = Number(m[1]);
      save();
    }
    if (text.includes(END)) {
      state.phase = 'finished';
      state.t1 = Date.now();
      save();
    }
  };

  let queued = false;
  const onMutate = () => {
    if (queued) return;
    queued = true;
    requestAnimationFrame(() => {
      queued = false;
      inspect();
      render();
    });
  };

  const mount = () => {
    document.head.appendChild(style);
    document.body.appendChild(hud);
    new MutationObserver(onMutate).observe(document.body, { childList: true, subtree: true, characterData: true });
    setInterval(render, 500);
    render();
  };
  if (document.body) mount();
  else document.addEventListener('DOMContentLoaded', mount);
})();
