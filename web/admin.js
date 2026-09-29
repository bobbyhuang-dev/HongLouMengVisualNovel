import { api, formatTime, renderBoard } from './competition-common.js';

const PRIMARY = 'https://hongloumeng.bobbyhuang.dev/admin';
const POLL_MS = 2000;
const HOST_PREFIX = 'hlm-room-host:';

const params = new URLSearchParams(location.search);
const roomCode = (params.get('room') || '').trim();
const boardView = params.get('view') === 'board';

const state = { room: null };
let offset = 0;
let clockUnsynced = false;
let polling = false;
let inFlight = false;
let timer = 0;
let clockTimer = 0;
let acting = false;
let probing = false;
let booted = false;
let lastOk = 0;
let lastErr = '';
let summaryKey = '';
let confirmOpener = null;
let pendingAction = '';

const $ = (id) => document.getElementById(id);

function storageGet(key) {
  try { return localStorage.getItem(key); }
  catch { return null; }
}

function storageSet(key, value) {
  try {
    localStorage.setItem(key, value);
    return true;
  } catch {
    return false;
  }
}


function validCode(code) {
  return /^\d{6}$/.test(code);
}

function spaced(code) {
  return code.slice(0, 3) + ' ' + code.slice(3);
}

function hostToken() {
  if (boardView || !validCode(roomCode)) return '';
  return storageGet(HOST_PREFIX + roomCode) || '';
}

function isPrimaryHost() {
  return location.hostname === 'hongloumeng.bobbyhuang.dev';
}

function isStaticMirror() {
  return location.protocol === 'file:' || /(^|\.)github\.io$/i.test(location.hostname);
}

function assertPublic(url) {
  const keys = Array.from(url.searchParams.keys());
  if (keys.some((key) => /token|key|secret/i.test(key)) || /token|joinKey|hostToken/i.test(url.href)) {
    throw new Error('公开链接被污染，已停止生成');
  }
  return url;
}

function adminUrl(code, projection) {
  const url = new URL('/admin', location.origin);
  if (code) url.searchParams.set('room', code);
  if (projection) url.searchParams.set('view', 'board');
  return assertPublic(url);
}

function joinUrl(code) {
  const url = new URL('/', location.origin);
  url.searchParams.set('room', code);
  return assertPublic(url);
}

function primaryUrl() {
  const url = new URL(PRIMARY);
  if (validCode(roomCode)) url.searchParams.set('room', roomCode);
  if (boardView) url.searchParams.set('view', 'board');
  return url.toString();
}

function roomPath(code, suffix) {
  return '/api/rooms/' + encodeURIComponent(code) + (suffix || '');
}

function setText(id, value) {
  const node = $(id);
  if (node) node.textContent = value == null ? '' : String(value);
}

function show(id) {
  for (const node of document.querySelectorAll('.view')) node.hidden = true;
  const node = $(id);
  if (node) node.hidden = false;
  document.body.dataset.view = id;
  const titles = {
    'view-gate': '备用镜像',
    'view-down': '服务不可用',
    'view-bad': '房间号无效',
    'view-missing': '找不到房间',
    'view-entry': '主持比赛',
    'view-host': '主持比赛',
    'view-board': '投影记分板',
  };
  const title = titles[id] || '主持比赛';
  setText('title', title);
  document.title = title + ' · 红楼抉择';
  const board = id === 'view-board';
  $('privacy').hidden = board;
  $('privacy-short').hidden = !board;
  summaryKey = '';
}

function showBanner(message) {
  lastErr = message || '';
  const banner = $('banner');
  banner.hidden = !lastErr;
  setText('banner-text', lastErr);
  document.body.classList.toggle('is-stale', !!(lastErr && lastOk));
  paintAge();
}

function paintAge() {
  if (!lastErr || !lastOk) {
    setText('banner-age', lastErr && !lastOk ? '还没有成功读到房间数据。' : '');
    return;
  }
  const sec = Math.max(0, Math.round((Date.now() - lastOk) / 1000));
  setText('banner-age', '显示的是 ' + sec + ' 秒前的数据，可能已过期。');
}

function noteServerNow(ms) {
  if (typeof ms === 'number' && Number.isFinite(ms)) {
    offset = ms - Date.now();
    clockUnsynced = false;
    return;
  }
  clockUnsynced = true;
}

function deadlineLeft(room) {
  if (!room || room.status !== 'running' || typeof room.deadlineAt !== 'number') return null;
  return room.deadlineAt - (Date.now() + offset);
}

function clockParts(room) {
  if (!room) return { time: '——', label: '正在读取房间', low: false, final: false };
  if (room.status === 'waiting') return { time: formatTime(15 * 60 * 1000), label: '尚未开始 · 限时 15 分钟', low: false, final: false };
  if (room.status === 'finished') return { time: '已结束', label: '已收卷 · 名次已确定', low: false, final: true };
  const left = deadlineLeft(room);
  if (left == null) return { time: '——', label: '缺少服务器截止时间', low: false, final: false };
  const sec = Math.max(0, Math.floor(left / 1000));
  let label = sec <= 0 ? '时间到 · 等待服务器收卷' : '剩余时间 · 按服务器时钟';
  if (clockUnsynced && sec > 0) label = '剩余时间（未能校准服务器，仅供参考）';
  return { time: formatTime(sec * 1000), label, low: sec > 0 && sec <= 60, final: false };
}

function paintClock() {
  const painted = clockParts(state.room);
  for (const node of document.querySelectorAll('[data-clock]')) {
    node.textContent = painted.time;
    node.classList.toggle('is-low', painted.low);
    node.classList.toggle('is-final', painted.final);
    const label = $(node.getAttribute('data-clock-label'));
    if (label) label.textContent = painted.label;
  }
  paintAge();
  paintSummary(painted);
}

function paintSummary(painted) {
  const room = state.room;
  if (!room) return;
  const left = deadlineLeft(room);
  const sec = left == null ? null : Math.max(0, Math.floor(left / 1000));
  let key = room.status + ':' + (room.players ? room.players.length : 0);
  if (sec != null) key += sec <= 10 ? ':s' + sec : sec <= 60 ? ':under60' : ':m' + Math.ceil(sec / 60);
  if (key === summaryKey) return;
  summaryKey = key;
  const bits = [room.name || '竞赛', painted.label];
  if (room.status === 'running') bits.push('实时成绩，名次未定');
  if (room.status === 'finished') bits.push('最终排名');
  bits.push((room.players ? room.players.length : 0) + ' 人');
  setText('live-summary', bits.join('，'));
}

function startClock() {
  clearInterval(clockTimer);
  paintClock();
  clockTimer = setInterval(paintClock, 200);
}

function stopClock() {
  clearInterval(clockTimer);
}

function counts(players) {
  let done = 0;
  for (const player of players) if (player.status === 'completed') done += 1;
  return { done, open: players.length - done, total: players.length };
}

function badgeText(room) {
  if (!room) return '读取中';
  if (room.status === 'finished') return '最终排名';
  if (room.status === 'running') return '实时 · 名次未定';
  if (room.status === 'waiting') return '等待加入';
  return '读取中';
}

function setBadge(id, room) {
  const node = $(id);
  node.textContent = badgeText(room);
  node.classList.toggle('is-final', !!(room && room.status === 'finished'));
  node.classList.toggle('is-wait', !!(room && room.status === 'waiting'));
}

function statusText(player, room) {
  const status = player && player.status;
  if (room && room.status === 'finished' && status !== 'completed') return '未完成';
  if (status === 'waiting') return '等待中';
  if (status === 'playing') return '作答中';
  if (status === 'completed') return '已完成';
  if (status === 'timeout') return '未完成';
  return '状态未知';
}

function rosterLine(player, room) {
  const answered = Number(player && player.answered);
  const n = Number.isFinite(answered) ? answered : 0;
  const main = Math.min(20, Math.max(0, n));
  const review = Math.min(3, Math.max(0, n - 20));
  const score = Number(player && player.score);
  return [
    player.nickname || '（空昵称）',
    '积分 ' + (Number.isFinite(score) ? score : '—') + '/53',
    '正篇 ' + main + '/20',
    '回顾 ' + review + '/3',
    statusText(player, room),
  ].join(' · ');
}

function sortPlayers(players, final) {
  return players.slice().sort((a, b) => {
    if (final) {
      const ra = a.rank == null ? 1e9 : Number(a.rank);
      const rb = b.rank == null ? 1e9 : Number(b.rank);
      if (ra !== rb) return ra - rb;
    }
    const score = (Number(b.score) || 0) - (Number(a.score) || 0);
    if (score) return score;
    const elapsed = (Number(a.elapsedMs) || 0) - (Number(b.elapsedMs) || 0);
    if (elapsed) return elapsed;
    return String(a.nickname || '').localeCompare(String(b.nickname || ''), 'zh');
  });
}

function renderRoster(players, room) {
  const list = $('host-roster');
  list.replaceChildren();
  if (!players.length) {
    const li = document.createElement('li');
    li.textContent = '还没有人加入';
    list.append(li);
    return;
  }
  for (const player of players) {
    const li = document.createElement('li');
    li.textContent = rosterLine(player, room);
    list.append(li);
  }
}

function renderHost() {
  const room = state.room;
  const token = hostToken();
  const code = room && validCode(room.code) ? room.code : roomCode;
  setText('host-code', validCode(code) ? spaced(code) : '------');
  $('host-code').setAttribute('aria-label', '房间号 ' + code);
  if (room) setText('subtitle', (room.name || '竞赛') + ' · 主持');
  setText('host-recovery', token
    ? '已从本浏览器恢复主持人凭证。刷新此页不会丢失；链接里没有凭证，换浏览器则不能主持。'
    : '这台浏览器没有房间 ' + code + ' 的主持人凭证。凭证不会出现在链接里，只能在创建房间的那台浏览器恢复。你可以打开记分板，但不能开始或结束比赛。');
  const join = joinUrl(code);
  const board = adminUrl(code, true);
  $('join-url').value = join.href;
  $('join-link').href = join.pathname + join.search;
  $('join-link').textContent = '主站加入页 ' + join.pathname + join.search;
  const open = $('open-board');
  open.href = board.pathname + board.search;
  const qr = $('qr');
  const src = roomPath(code, '/qr') + '?origin=' + encodeURIComponent(location.origin);
  if (qr.getAttribute('src') !== src) {
    qr.hidden = false;
    $('qr-fallback').hidden = true;
    qr.alt = '加入房间 ' + code + ' 的二维码，指向主站';
    qr.src = src;
  }
  setBadge('host-badge', room);
  const players = room && room.players ? room.players : [];
  const tally = counts(players);
  setText('host-count', room ? ('已加入 ' + tally.total + ' 人 · 已完成 ' + tally.done + ' · 未完成 ' + tally.open) : '正在读取名单');
  const start = $('start-btn');
  const waiting = !!(room && room.status === 'waiting');
  start.hidden = !!(room && room.status !== 'waiting');
  start.disabled = !token || !waiting || players.length < 1 || acting;
  setText('start-hint', !token
    ? '没有主持人凭证，不能开始或结束。'
    : !room
      ? '正在读取房间…'
      : waiting && players.length < 1
        ? '至少有一位同学在主站加入后才能开始。'
        : waiting
          ? '开始后服务器计时 15 分钟。同学留在主站进入游戏。'
          : room.status === 'running'
            ? '结束会立刻收卷。未完成的同学留在最终榜上。'
            : '比赛已结束。');
  $('end-btn').hidden = !(room && room.status === 'running');
  $('end-btn').disabled = !token || acting;
  renderRoster(sortPlayers(players, !!(room && room.status === 'finished')), room);
}

function renderProjection() {
  const room = state.room;
  if (!room) return;
  setText('subtitle', (room.name || '竞赛') + ' · ' + spaced(room.code || roomCode));
  setBadge('board-badge', room);
  const players = room.players || [];
  const tally = counts(players);
  setText('board-counts', tally.total + ' 人 · 已完成 ' + tally.done + ' · 未完成 ' + tally.open);
  setText('board-caption', (room.name || '竞赛') + ' · 房间 ' + (room.code || roomCode) + ' · ' + badgeText(room));
  setText('board-note', room.status === 'finished'
    ? '最终排名：先比积分，再比用时；完全相同则并列，下一名次跳过。未完成的条目已结算，仍留在榜上。用时按秒向下取整。'
    : room.status === 'running'
      ? '这是实时成绩，顺序只供观赛，名次要等结束后才确定。未完成的同学也会留在最终榜上。'
      : '尚未开赛。开始后这里显示实时成绩，结束后显示最终名次。');
  renderBoard($('board-body'), room);
  $('board-empty').hidden = players.length > 0;
}

function renderSaved() {
  const list = $('saved-list');
  list.replaceChildren();
  const codes = [];
  try {
    for (let i = 0; i < localStorage.length && codes.length < 20; i += 1) {
      const key = localStorage.key(i);
      if (!key || !key.startsWith(HOST_PREFIX)) continue;
      const code = key.slice(HOST_PREFIX.length);
      if (!validCode(code) || !storageGet(key)) continue;
      codes.push(code);
    }
  } catch {
    codes.length = 0;
  }
  codes.sort();
  for (const code of codes) {
    const li = document.createElement('li');
    const a = document.createElement('a');
    const url = adminUrl(code, false);
    a.href = url.pathname + url.search;
    a.textContent = '继续主持 ' + spaced(code);
    li.append(a);
    list.append(li);
  }
  $('saved').hidden = codes.length === 0;
}

function applyRoom(data) {
  const room = data && data.room;
  if (!room || typeof room !== 'object' || !Array.isArray(room.players)) {
    throw new Error('房间数据不完整');
  }
  if (validCode(roomCode) && String(room.code) !== roomCode) {
    throw new Error('房间号与服务器不一致，已停止刷新');
  }
  noteServerNow(room.serverNow);
  state.room = room;
  lastOk = Date.now();
  showBanner('');
  if (document.body.dataset.view === 'view-host') renderHost();
  if (document.body.dataset.view === 'view-board') renderProjection();
  paintClock();
}

function stopPoll() {
  polling = false;
  clearTimeout(timer);
}

function arm(delay) {
  clearTimeout(timer);
  if (!polling || document.hidden) return;
  timer = setTimeout(() => { void tick(); }, delay);
}

async function tick() {
  if (!polling || document.hidden || inFlight) return;
  inFlight = true;
  try {
    await refresh();
  } catch (err) {
    handlePollError(err);
  } finally {
    inFlight = false;
    arm(POLL_MS);
  }
}

function requestRefresh() {
  clearTimeout(timer);
  if (inFlight || !polling) return;
  void tick();
}

async function refresh() {
  applyRoom(await api(roomPath(roomCode)));
}

function handlePollError(err) {
  if (err && err.status === 404) {
    stopPoll();
    stopClock();
    setText('missing-text', '没有房间 ' + roomCode + '。请核对 6 位房间号。');
    show('view-missing');
    return;
  }
  const message = (err && err.message) || '刷新失败';
  showBanner(lastOk ? '刷新失败：' + message : message);
}

function startPoll() {
  polling = true;
  startClock();
  requestRefresh();
}

function fieldError(input, message) {
  input.setAttribute('aria-invalid', message ? 'true' : 'false');
  if (message) input.focus();
}

function validateRoomName(raw) {
  const name = String(raw || '').normalize('NFKC').replace(/[\u0000-\u001f\u007f]/g, '').trim().replace(/\s+/g, ' ');
  if (!name) return { error: '请填写房间名称' };
  if ([...name].length > 60) return { error: '房间名称最多 60 个字' };
  return { name };
}

async function probe() {
  if (isStaticMirror()) return 'mirror';
  try {
    await api('/api/questions');
    return 'ok';
  } catch (err) {
    if (err && err.missing) return isPrimaryHost() ? 'absent' : 'mirror';
    if (!err || err.status === undefined) return isPrimaryHost() ? 'down' : 'mirror';
    return 'ok';
  }
}

function showPrimary(kind) {
  const url = primaryUrl();
  if (kind === 'mirror') {
    setText('gate-lead', '此备用镜像只支持自由游玩。主持课堂竞赛，请打开主站：');
    $('primary-link').href = url;
    $('primary-link').textContent = url;
    setText('primary-url', url);
    show('view-gate');
    return;
  }
  setText('down-lead', kind === 'absent'
    ? '主站竞赛服务尚未启用，暂时无法创建房间。请稍后重试：'
    : '连不上竞赛服务。请检查网络后重试，或打开主站：');
  $('down-link').href = url;
  $('down-link').textContent = url;
  setText('down-url', url);
  show('view-down');
}

async function boot() {
  if (probing) return;
  probing = true;
  stopPoll();
  stopClock();
  showBanner('');
  setText('subtitle', '正在检查竞赛服务…');
  try {
    const mode = await probe();
    if (mode !== 'ok') {
      showPrimary(mode);
      return;
    }
    if (roomCode && !validCode(roomCode)) {
      show('view-bad');
      return;
    }
    if (!roomCode) {
      setText('subtitle', boardView
        ? '投影记分板需要 6 位房间号。先创建房间，再打开投影。'
        : '创建房间，同学在主站加入');
      show('view-entry');
      renderSaved();
      $('create-name').focus();
      return;
    }
    if (boardView) {
      show('view-board');
      setText('subtitle', '房间 ' + spaced(roomCode));
      startPoll();
      return;
    }
    show('view-host');
    renderHost();
    startPoll();
  } finally {
    probing = false;
    booted = true;
  }
}

function openConfirm(action) {
  pendingAction = action;
  const start = action === 'start';
  setText('confirm-title', start ? '开始比赛？' : '提前结束比赛？');
  const ok = $('confirm-ok');
  ok.textContent = start ? '确认开始' : '确认结束';
  ok.classList.toggle('btn-danger', !start);
  ok.classList.toggle('btn-primary', start);
  setText('confirm-cancel', start ? '取消' : '继续比赛');
  const left = deadlineLeft(state.room);
  const sec = left == null ? null : Math.max(0, Math.floor(left / 1000));
  setText('confirm-text', start
    ? '开始后服务器计时 15 分钟，同学在主站进入游戏。开赛后不能再加入。'
    : sec && sec > 0
      ? '还剩 ' + formatTime(sec * 1000) + '。提前结束会立刻收卷，未完成的同学按当前进度结算，用时记到结束时刻，不能再作答，但仍会出现在最终榜上。'
      : '确认结束比赛？未完成的同学会按规则结算，并留在最终榜上。');
  setText('confirm-error', '');
  const dialog = $('confirm-dialog');
  if (!dialog.showModal) {
    const fallback = start
      ? '确定开始比赛？服务器将计时 15 分钟，开赛后不能再加入。'
      : '确定提前结束比赛？未完成的同学将按当前进度结算，并留在最终榜上。';
    if (window.confirm(fallback)) void runConfirm();
    else pendingAction = '';
    return;
  }
  confirmOpener = document.activeElement;
  dialog.showModal();
  $('confirm-cancel').focus();
}

async function runConfirm() {
  const action = pendingAction;
  const button = $('confirm-ok');
  if (!action || acting) return;
  const token = hostToken();
  if (!token) {
    const message = '没有主持人凭证，无法操作。请用创建房间的同一浏览器。';
    if ($('confirm-dialog').open) setText('confirm-error', message);
    else setText('host-error', message);
    pendingAction = '';
    return;
  }
  acting = true;
  button.disabled = true;
  renderHost();
  try {
    applyRoom(await api(roomPath(roomCode, action === 'start' ? '/start' : '/end'), { body: {}, token }));
    setText('host-error', '');
    pendingAction = '';
    if ($('confirm-dialog').open) $('confirm-dialog').close();
  } catch (err) {
    const message = (err && err.message) || '操作失败';
    if ($('confirm-dialog').open) setText('confirm-error', message);
    else setText('host-error', message);
  } finally {
    acting = false;
    button.disabled = false;
    if (document.body.dataset.view === 'view-host') renderHost();
  }
}

async function createRoom() {
  const parsed = validateRoomName($('create-name').value);
  setText('create-error', '');
  fieldError($('create-name'), '');
  if (parsed.error) {
    setText('create-error', parsed.error);
    fieldError($('create-name'), parsed.error);
    return;
  }
  const button = $('create-form').querySelector('button');
  button.disabled = true;
  try {
    const data = await api('/api/rooms', { body: { name: parsed.name } });
    if (!data || !data.room || !validCode(data.room.code) || typeof data.hostToken !== 'string' || !data.hostToken) {
      throw new Error('服务器没有返回主持人凭证。请不要重复创建，先检查网络后再试。');
    }
    if (!storageSet(HOST_PREFIX + data.room.code, data.hostToken)) {
      throw new Error('房间已创建，但这台浏览器不能保存主持人凭证，因此无法主持。请允许本站保存数据后再创建。');
    }
    location.assign(adminUrl(data.room.code, false).href);
  } catch (err) {
    setText('create-error', err.message || '创建失败');
  } finally {
    button.disabled = false;
  }
}

async function copyText(value, ok) {
  if (!value) {
    setText('copy-status', '没有可复制的内容');
    return;
  }
  try {
    await navigator.clipboard.writeText(value);
    setText('copy-status', ok);
    return;
  } catch {
    /* 继续用选区复制 */
  }
  const area = document.createElement('textarea');
  area.value = value;
  area.setAttribute('readonly', '');
  document.body.append(area);
  area.select();
  let copied = false;
  try { copied = document.execCommand('copy'); }
  catch { copied = false; }
  area.remove();
  setText('copy-status', copied ? ok : '复制失败，请手动选择上面的链接');
}

function bind() {
  $('create-form').addEventListener('submit', (event) => {
    event.preventDefault();
    void createRoom();
  });
  $('start-btn').addEventListener('click', () => openConfirm('start'));
  $('end-btn').addEventListener('click', () => openConfirm('end'));
  $('confirm-cancel').addEventListener('click', () => {
    pendingAction = '';
    $('confirm-dialog').close();
  });
  $('confirm-ok').addEventListener('click', () => { void runConfirm(); });
  $('confirm-dialog').addEventListener('close', () => {
    pendingAction = '';
    const opener = confirmOpener;
    confirmOpener = null;
    if (opener && opener.isConnected && !opener.hidden && opener.focus) opener.focus();
  });
  $('copy-join').addEventListener('click', () => { void copyText($('join-url').value, '已复制主站加入链接'); });
  $('copy-code').addEventListener('click', () => { void copyText(roomCode, '已复制房间号'); });
  $('join-url').addEventListener('focus', () => $('join-url').select());
  $('banner-retry').addEventListener('click', requestRefresh);
  $('retry-probe').addEventListener('click', () => { void boot(); });
  $('qr').addEventListener('error', () => {
    $('qr').hidden = true;
    $('qr-fallback').hidden = false;
    setText('qr-fallback', '二维码没能加载。请让同学在主站输入房间号，或复制加入链接。');
  });
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) {
      clearTimeout(timer);
      stopClock();
      return;
    }
    if (polling) {
      startClock();
      requestRefresh();
    }
  });
  window.addEventListener('pageshow', (event) => {
    if (!booted || !event.persisted) return;
    if (polling) {
      startClock();
      requestRefresh();
    }
  });
}

bind();
void boot();
