// 比赛只接管参赛身份、提交和计时；剧情与分支仍由原 WebGAL 引擎运行。
(() => {
  const code = document.documentElement.dataset.matchRoom || '';
  const id = document.documentElement.dataset.matchPlayer || '';
  if (!/^\d{6}$/.test(code) || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id)) return;
  const onTitle = () => !!document.querySelector('#root [style*="background/title.webp"]');
  const begunKey = `hlm-room-begun:${code}:${id}`;
  let identity;
  let begun = false;
  try {
    identity = JSON.parse(localStorage.getItem(`hlm-room-player:${code}`));
    begun = localStorage.getItem(begunKey) === 'true';
  } catch { /* 下方显示身份无法恢复，不另建一个正式身份。 */ }

  const bar = document.createElement('aside');
  bar.id = 'hlm-match-bar';
  bar.innerHTML = '<span class="match-identity"></span><strong class="match-score"></strong><span class="match-clock"></span><button type="button" class="match-board">计分板</button>';
  const gate = document.createElement('section');
  gate.id = 'hlm-match-gate';
  gate.setAttribute('role', 'dialog');
  gate.setAttribute('aria-modal', 'true');
  gate.setAttribute('aria-labelledby', 'hlm-match-heading');
  gate.innerHTML = '<div class="match-card"><p class="match-eyebrow">红楼抉择 · 正式比赛</p><h1 id="hlm-match-heading"></h1><p class="match-message" role="status"></p><div class="match-actions"><button type="button" class="match-retry">重新连接</button><button type="button" class="match-epilogue">继续阅读结尾</button><button type="button" class="match-room">返回比赛房间</button></div></div>';
  const note = document.createElement('p');
  note.id = 'hlm-match-note';
  note.setAttribute('role', 'status');
  document.body.append(bar, gate, note);
  for (const element of [bar, gate]) element.addEventListener('click', (event) => event.stopPropagation());

  let room = null;
  let player = null;
  let questions = [];
  let anchor = 0;
  let serverNow = 0;
  let syncing = false;
  let submitting = false;
  let finishing = false;
  let error = '';
  let fatal = '';
  let passingChoice = null;
  let readingEnding = false;
  let revision = 0;
  const now = () => serverNow + performance.now() - anchor;
  const fmt = (ms) => {
    const seconds = Math.max(0, Math.floor(ms / 1000));
    return `${String(Math.floor(seconds / 60)).padStart(2, '0')}:${String(seconds % 60).padStart(2, '0')}`;
  };
  const active = () => room?.status === 'running' && player?.status === 'playing' && now() < room.deadlineAt;
  const blocked = () => !!fatal || !!error || !room || (!active() && !(readingEnding && player?.status === 'completed'));
  const setText = (element, value) => { if (element.textContent !== value) element.textContent = value; };
  const stop = (event) => { event.preventDefault(); event.stopImmediatePropagation(); };

  function render() {
    let heading = '正在连接比赛';
    let message = '核对参赛身份与服务器计时，请稍候。';
    if (fatal || error) {
      heading = fatal ? '无法进入正式比赛' : '比赛连接中断';
      message = fatal || `${error} 已确认的答案不会丢失；连接恢复前暂停操作，比赛计时仍继续。`;
    } else if (room?.status === 'waiting') {
      heading = '等待主持人开赛';
      message = `${player.nickname}，你已加入房间 ${code}。主持人开赛后即可开始。`;
    } else if (player?.status === 'completed') {
      heading = '正式成绩已记录';
      message = `${player.score} / 53 分 · 还原 ${player.hits} / 20 · 用时 ${fmt(player.elapsedMs)} · ${player.title}。${room.status === 'finished' ? `最终名次：第 ${player.rank} 名。` : '全场结束后确定最终名次。'}`;
    } else if (room?.status === 'finished') {
      heading = '比赛已结束';
      message = `截止成绩：${player.score} / 53 分 · 还原 ${player.hits} / 20 · 用时 ${fmt(player.elapsedMs)}。未完成也已计入排行榜。`;
    } else if (room && now() >= room.deadlineAt) {
      heading = '已到截止时间';
      message = '停止作答，正在确认服务器结算。只计入截止前已提交的答案。';
    }
    gate.hidden = !blocked();
    setText(gate.querySelector('h1'), heading);
    setText(gate.querySelector('.match-message'), message);
    gate.querySelector('.match-retry').hidden = !error || !!fatal;
    gate.querySelector('.match-epilogue').hidden = !!error || !!fatal || player?.status !== 'completed';
    for (const element of [document.getElementById('root'), document.querySelector('.html-body__title-enter')]) {
      if (element) element.inert = blocked();
    }
    if (!room) return;
    setText(bar.querySelector('.match-identity'), `${code} · ${player.nickname}`);
    setText(bar.querySelector('.match-score'), `积分 ${player.score} / 53`);
    const elapsed = ['completed', 'timeout'].includes(player.status) ? player.elapsedMs : Math.min(900000, Math.max(0, now() - (room.startedAt ?? now())));
    setText(bar.querySelector('.match-clock'), `用时 ${fmt(elapsed)} / 15:00`);
    if (submitting) setText(note, '正在提交本题，确认后继续剧情……');
    else if (finishing) setText(note, '正在记录正式成绩……');
    else if (onTitle()) setText(note, begun ? '点击「继续游戏」恢复本场进度；计时不会重置。' : '主持人已开赛。点击「开始游戏」进入本场比赛。');
    else if (!document.querySelector('#chooseContainer')?.textContent.trim()) setText(note, '正式比赛 · 每题选择提交后不可修改');
  }

  async function request(path, body) {
    const response = await fetch(`/api/rooms/${code}/${path}`, {
      method: body === undefined ? 'GET' : 'POST',
      headers: { Authorization: `Bearer ${identity.token}`, ...(body === undefined ? {} : { 'Content-Type': 'application/json' }) },
      body: body === undefined ? undefined : JSON.stringify(body),
      cache: 'no-store',
    });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || '服务器未确认此次操作');
    return data;
  }

  function apply(data) {
    room = data.room;
    player = data.player;
    serverNow = room.serverNow;
    anchor = performance.now();
    error = '';
    revision++;
    render();
  }

  function choiceState() {
    const container = document.getElementById('chooseContainer');
    if (!container) return null;
    // WebGAL 的选项是三个末级 div；用整组选项文本匹配题目，不依赖模板生成的 CSS 类名。
    const elements = [...container.querySelectorAll('div')].filter((element) => !element.childElementCount && element.textContent.trim());
    const index = questions.findIndex((question) => question.options.length === elements.length && question.options.every((option, i) => option.text === elements[i].textContent.trim()));
    return index < 0 ? null : { question: questions[index], index, elements };
  }

  function dialogueText() {
    const box = document.getElementById('textBoxMain');
    if (!box) return '';
    const walker = document.createTreeWalker(box, NodeFilter.SHOW_TEXT);
    let text = '';
    for (let node = walker.nextNode(); node; node = walker.nextNode()) {
      if (node.parentElement?.matches('[class*="_zhanwei_"]')) text += node.data;
    }
    return text;
  }

  async function finish() {
    if (finishing || submitting || !active() || player.answered !== 23) return;
    finishing = true;
    render();
    try { apply(await request('finish', {})); }
    catch (cause) { error = cause.message; }
    finally { finishing = false; render(); }
  }

  function inspect() {
    if (!player) return;
    const choices = choiceState();
    if (choices) {
      const accepted = player.answers[choices.index];
      choices.elements.forEach((element, index) => {
        const disabled = !!accepted && choices.question.options[index].label !== accepted;
        element.setAttribute('role', 'button');
        element.tabIndex = disabled ? -1 : 0;
        element.setAttribute('aria-disabled', String(disabled));
        element.classList.toggle('hlm-answer-locked', disabled);
      });
      if (!submitting) setText(note, accepted ? '这道题已提交；续玩只能继续原来的选择。' : '请选择一项；服务器确认后继续剧情。');
    }
    if (!error && dialogueText().includes('【计时结束】')) void finish();
    render();
  }

  async function sync() {
    if (syncing || submitting || finishing || fatal) return;
    syncing = true;
    const startedRevision = revision;
    try {
      if (!questions.length) {
        const response = await fetch('/api/questions', { cache: 'no-store' });
        if (!response.ok) throw new Error('无法加载比赛题目');
        questions = (await response.json()).questions;
      }
      const data = await request('me');
      if (data.player.id !== id) throw new Error('此参赛链接与本浏览器保存的身份不符');
      if (revision === startedRevision && !submitting && !finishing) apply(data);
      inspect();
    } catch (cause) { error = cause.message; render(); }
    finally { syncing = false; }
  }

  document.addEventListener('click', async (event) => {
    const target = event.target instanceof Element ? event.target : null;
    if (!target || target.closest('#hlm-match-gate, #hlm-match-bar, #hlm-room-dialog')) return;
    if (passingChoice && (target === passingChoice || passingChoice.contains(target))) return;
    if (blocked() || submitting || finishing) { stop(event); return; }
    const container = target.closest('#chooseContainer');
    if (container) {
      stop(event);
      if (!active()) return;
      const choices = choiceState();
      const index = choices?.elements.findIndex((element) => element === target || element.contains(target));
      if (!choices || index < 0) return;
      const choice = choices.question.options[index].label;
      const accepted = player.answers[choices.index];
      if (accepted && accepted !== choice) { setText(note, '本题已有正式答案，不能重新选择。'); return; }
      submitting = true;
      render();
      try {
        apply(await request('answer', { questionId: choices.question.id, choice }));
        const element = choices.elements[index];
        if (active() && element.isConnected) {
          passingChoice = element;
          element.click();
          passingChoice = null;
        }
      } catch (cause) { error = cause.message; }
      finally { passingChoice = null; submitting = false; inspect(); }
      return;
    }
    if (onTitle() && target.textContent.replaceAll('开始游戏', '').trim() === '' && target.textContent.includes('开始游戏')) {
      if (begun) { stop(event); return; }
      try { localStorage.setItem(begunKey, 'true'); begun = true; }
      catch { stop(event); fatal = '浏览器无法保存续玩身份，请开启本网站的本地存储后刷新。'; render(); }
    }
  }, true);

  const eventElement = (event) => event.target instanceof Element ? event.target : event.target?.parentElement ?? null;
  document.addEventListener('keydown', (event) => {
    if (eventElement(event)?.closest('#hlm-match-gate, #hlm-match-bar, #hlm-room-dialog')) return;
    if (blocked() || submitting || finishing) { stop(event); return; }
    if (['Enter', ' '].includes(event.key) && event.target.closest?.('#chooseContainer')) {
      stop(event);
      event.target.click();
    }
  }, true);
  document.addEventListener('wheel', (event) => {
    if (eventElement(event)?.closest('#hlm-room-dialog')) return;
    if (blocked() || submitting || finishing) stop(event);
  }, { capture: true, passive: false });
  gate.querySelector('.match-retry').addEventListener('click', () => { void sync(); });
  gate.querySelector('.match-epilogue').addEventListener('click', () => { readingEnding = true; render(); });
  const openRoom = (view) => window.dispatchEvent(new CustomEvent('hlm:open-room', { detail: { code, view } }));
  bar.querySelector('.match-board').addEventListener('click', () => openRoom('board'));
  gate.querySelector('.match-room').addEventListener('click', () => openRoom('room'));

  let queued = false;
  new MutationObserver(() => {
    if (queued) return;
    queued = true;
    requestAnimationFrame(() => { queued = false; inspect(); });
  }).observe(document.getElementById('root'), { childList: true, subtree: true, characterData: true });
  if (!identity?.token || identity.id !== id) fatal = '本浏览器没有这个参赛身份。请回到比赛房间加入，并始终使用同一个浏览器续玩。';
  render();
  if (!fatal) {
    void sync();
    setInterval(() => { void sync(); }, 2000);
    setInterval(render, 250);
    document.addEventListener('visibilitychange', () => { if (!document.hidden) void sync(); });
  }
})();
