import { api, formatTime, renderBoard } from './competition-common.js';

// 房间是原游戏上的面板，不另开玩家页面，也不加载第二个 WebGAL。
const matchRoom = document.documentElement.dataset.matchRoom || '';
const homePath = new URL('./', location.href).pathname;
const params = new URLSearchParams(location.search);
const requestedRoom = params.get('room') || '';
const playerPrefix = 'hlm-room-player:';
const mirror = location.protocol === 'file:' || /(^|\.)github\.io$/i.test(location.hostname);
const tools = document.createElement('nav');
tools.id = 'hlm-home-tools';
tools.setAttribute('aria-label', '课堂比赛');
tools.innerHTML = '<button type="button">加入比赛</button>';
const dialog = document.createElement('dialog');
dialog.id = 'hlm-room-dialog';
dialog.setAttribute('aria-labelledby', 'home-room-title');
dialog.innerHTML = `
  <header class="home-room-header">
    <div><p class="home-room-kicker">红楼抉择 · 单人同场竞技</p><h2 id="home-room-title">加入比赛</h2></div>
    <button type="button" class="home-room-close" aria-label="关闭比赛面板，返回游戏">返回游戏</button>
  </header>
  <div class="home-room-content">
    <p id="home-room-error" class="home-room-error" role="alert" hidden></p>
    <div id="home-room-unavailable" class="home-room-notice" hidden>
      <p>当前站点无法提供比赛服务。自由游玩不受影响，参加课堂比赛请打开主站。</p>
      <a id="home-room-primary" href="https://hongloumeng.bobbyhuang.dev/">打开主站</a>
    </div>
    <form id="home-room-join" novalidate>
      <p class="home-room-intro">输入主持人给出的房间码，和大家一起还原《红楼梦》。</p>
      <div class="home-room-fields">
        <label>房间码<input id="home-room-code" name="room" inputmode="numeric" autocomplete="off" maxlength="6" pattern="[0-9]{6}" placeholder="六位数字" required></label>
        <label>你的昵称<input id="home-room-nickname" name="nickname" autocomplete="off" maxlength="40" placeholder="本场唯一，最多 20 个字" required></label>
      </div>
      <button type="submit" class="home-room-primary">加入比赛</button>
    </form>
    <section id="home-room-session" hidden>
      <div class="home-room-heading"><div><p id="home-room-code-label" class="home-room-kicker"></p><h3 id="home-room-name"></h3></div><span id="home-room-status" class="home-room-badge"></span></div>
      <div class="home-room-clock"><span id="home-room-clock-label"></span><strong id="home-room-clock">15:00</strong></div>
      <p id="home-room-identity"></p>
      <div id="home-room-result" class="home-room-result" hidden><strong id="home-room-score"></strong><p id="home-room-result-detail"></p></div>
      <p id="home-room-message" class="home-room-notice"></p>
      <div class="home-room-actions"><button type="button" id="home-room-enter" class="home-room-primary" hidden>进入比赛</button><button type="button" id="home-room-show-board">查看本场计分板</button><button type="button" id="home-room-refresh">刷新房间</button></div>
      <div id="home-room-roster-wrap"><h4 id="home-room-count">已加入</h4><ul id="home-room-roster"></ul></div>
    </section>
    <section id="home-room-board" hidden>
      <h3 id="home-room-board-title">本场计分板</h3>
      <p class="home-room-intro">积分优先，同分比用时；完全相同则并列。正式名次以全场结束后的结果为准。</p>
      <div class="home-room-board-scroll"><table><caption id="home-room-board-caption">公开成绩</caption><thead><tr><th scope="col">名次</th><th scope="col">昵称</th><th scope="col">正篇</th><th scope="col">回顾</th><th scope="col">积分</th><th scope="col">还原</th><th scope="col">用时</th><th scope="col">称号</th><th scope="col">状态</th></tr></thead><tbody id="home-room-board-body"></tbody></table></div>
      <p id="home-room-board-empty" hidden>还没有玩家加入。</p>
    </section>
    <button type="button" id="home-room-other" hidden>加入其他房间</button>
    <section id="home-room-saved" hidden><h3>本机参赛记录</h3><ul id="home-room-saved-list"></ul></section>
    <p class="home-room-privacy">无需注册，请使用昵称。身份与续玩进度保存在本浏览器，请勿清除本站数据或中途换浏览器。比赛限时 15 分钟，断网不暂停计时。</p>
  </div>`;
document.body.append(tools, dialog);

const codeInput = dialog.querySelector('#home-room-code');
const nicknameInput = dialog.querySelector('#home-room-nickname');
const form = dialog.querySelector('form');
const errorBox = dialog.querySelector('#home-room-error');
let code = '';
let room = null;
let player = null;
let identity = null;
let version = 0;
let inFlight = false;
let joining = false;
let autoEnter = false;
let boardRequested = false;
let unavailable = mirror;
let serverTime = 0;
let serverAnchor = 0;
let pollTimer = 0;
let navigating = false;

function showError(message) {
  errorBox.textContent = message;
  errorBox.hidden = !message;
}

function readIdentity(roomCode) {
  try {
    const value = JSON.parse(localStorage.getItem(playerPrefix + roomCode));
    return value && typeof value.id === 'string' && typeof value.token === 'string' ? value : null;
  } catch { return null; }
}

function renderSaved() {
  const list = dialog.querySelector('#home-room-saved-list');
  list.replaceChildren();
  if (!matchRoom) {
    try {
      const keys = Object.keys(localStorage).filter((key) => /^hlm-room-player:\d{6}$/.test(key)).reverse().slice(0, 20);
      for (const key of keys) {
        const savedCode = key.slice(playerPrefix.length);
        const saved = readIdentity(savedCode);
        if (!saved || savedCode === code) continue;
        const item = document.createElement('li');
        const button = document.createElement('button');
        button.type = 'button';
        button.textContent = `${saved.nickname} · ${savedCode}`;
        button.addEventListener('click', () => { void openRoom(savedCode); });
        item.append(button);
        list.append(item);
      }
    } catch { /* 不影响免存档的自由游玩；加入时会明确检查存储是否可写。 */ }
  }
  dialog.querySelector('#home-room-saved').hidden = !list.childElementCount;
}

function renderClock() {
  if (!room) return;
  let label = '尚未开赛 · 全场限时';
  let value = '15:00';
  if (room.status === 'running') {
    const left = room.deadlineAt - (serverTime + performance.now() - serverAnchor);
    label = left > 0 ? '全场剩余时间' : '时间到 · 等待服务器收卷';
    value = formatTime(left);
  } else if (room.status === 'finished') {
    label = '已收卷 · 最终名次已确定';
    value = '已结束';
  }
  dialog.querySelector('#home-room-clock-label').textContent = label;
  dialog.querySelector('#home-room-clock').textContent = value;
}

function render() {
  const primary = new URL('https://hongloumeng.bobbyhuang.dev/');
  if (/^\d{6}$/.test(codeInput.value)) primary.searchParams.set('room', codeInput.value);
  dialog.querySelector('#home-room-primary').href = primary.href;
  dialog.querySelector('#home-room-unavailable').hidden = !unavailable;
  form.hidden = unavailable || !!identity || !!matchRoom;
  dialog.querySelector('#home-room-other').hidden = !code || !!matchRoom;
  dialog.querySelector('#home-room-session').hidden = !room;
  dialog.querySelector('form button').disabled = joining;
  dialog.querySelector('#home-room-title').textContent = identity || matchRoom ? '我的比赛' : '加入比赛';
  dialog.querySelector('#home-room-board').hidden = !room || (!boardRequested && room.status !== 'finished');
  if (!room) return;
  dialog.querySelector('#home-room-code-label').textContent = `房间 ${room.code}`;
  dialog.querySelector('#home-room-name').textContent = room.name;
  dialog.querySelector('#home-room-status').textContent = room.status === 'waiting' ? '等待开赛' : room.status === 'running' ? '比赛进行中' : '最终成绩';
  dialog.querySelector('#home-room-identity').textContent = player ? `参赛昵称：${player.nickname}` : '尚未加入此房间';
  const message = dialog.querySelector('#home-room-message');
  if (room.status === 'waiting') message.textContent = player ? '你已就位。主持人开赛后，将在本网站进入正式游戏。' : '填写昵称加入，等待主持人统一开赛。';
  else if (player?.status === 'completed') message.textContent = room.status === 'finished' ? '正式成绩已锁定，可在下方查看最终排名。' : '你的成绩已记录，等待全场结束后确定名次。';
  else if (room.status === 'finished') message.textContent = '比赛已结束。未完成的玩家也已按截止前的有效积分计入排名。';
  else message.textContent = player ? '服务器已开始计时。已提交的答案不可修改，刷新后可继续原进度。' : '比赛已开始，不能再报名；可以查看公开计分板。';
  const enter = dialog.querySelector('#home-room-enter');
  enter.hidden = !player || room.status !== 'running' || player.status !== 'playing';
  enter.textContent = matchRoom === code ? '继续游戏' : player?.answered > 0 ? '返回本场游戏' : '进入比赛';
  dialog.querySelector('#home-room-result').hidden = !player || room.status === 'waiting';
  if (player) {
    dialog.querySelector('#home-room-score').textContent = `${player.score} / 53 分`;
    dialog.querySelector('#home-room-result-detail').textContent = `还原 ${player.hits}/20 · 用时 ${formatTime(player.elapsedMs)} · ${player.title}${player.rank == null ? '' : ` · 第 ${player.rank} 名`}`;
  }
  dialog.querySelector('#home-room-roster-wrap').hidden = room.status !== 'waiting';
  dialog.querySelector('#home-room-count').textContent = `已加入 ${room.players.length} 人`;
  const roster = dialog.querySelector('#home-room-roster');
  const names = room.players.map((entry) => entry.nickname);
  if (roster.textContent !== names.join('')) {
    roster.replaceChildren(...names.map((name) => {
      const item = document.createElement('li');
      item.textContent = name;
      return item;
    }));
  }
  dialog.querySelector('#home-room-board-title').textContent = room.status === 'finished' ? '最终计分板' : '本场实时计分板';
  dialog.querySelector('#home-room-board-caption').textContent = `${room.name} · ${room.players.length} 人`;
  dialog.querySelector('#home-room-board-empty').hidden = room.players.length > 0;
  renderBoard(dialog.querySelector('#home-room-board-body'), room);
  renderClock();
}

function enterGame() {
  if (!player || room?.status !== 'running' || player.status !== 'playing' || navigating) return;
  if (matchRoom === code) { dialog.close(); return; }
  navigating = true;
  const target = new URL(homePath, location.origin);
  target.searchParams.set('room', code);
  target.searchParams.set('play', '1');
  location.assign(target.href);
}

function apply(data) {
  room = data.room;
  player = data.player ? { ...room.players.find((entry) => entry.id === data.player.id), ...data.player } : identity ? room.players.find((entry) => entry.id === identity.id) : null;
  serverTime = room.serverNow;
  serverAnchor = performance.now();
  unavailable = false;
  showError('');
  if (room.status === 'waiting' && player && !boardRequested && !matchRoom) autoEnter = true;
  render();
  if (autoEnter && room.status === 'running' && player?.status === 'playing' && !matchRoom) enterGame();
}

async function refresh() {
  if (!code || inFlight || joining || mirror || navigating) return;
  inFlight = true;
  const selectedVersion = version;
  try {
    const suffix = identity ? '/me' : '';
    const data = await api(`/api/rooms/${code}${suffix}`, { token: identity?.token });
    if (selectedVersion === version) apply(data);
  } catch (error) {
    if (selectedVersion === version) {
      unavailable = !!error.missing;
      showError(error.message);
      render();
    }
  } finally {
    inFlight = false;
    clearTimeout(pollTimer);
    if (code && !unavailable) pollTimer = setTimeout(() => { void refresh(); }, 2000);
  }
}

async function openRoom(nextCode = '', view = 'room') {
  const selected = matchRoom || nextCode;
  boardRequested = view === 'board';
  autoEnter = false;
  if (!dialog.open) dialog.showModal();
  if (selected && !/^\d{6}$/.test(selected)) {
    codeInput.value = selected;
    showError('房间码应为六位数字，请核对后再加入。');
    render();
    return;
  }
  if (selected !== code) {
    clearTimeout(pollTimer);
    version++;
    code = selected;
    room = null;
    player = null;
    identity = readIdentity(code);
    codeInput.value = code;
    if (identity) nicknameInput.value = identity.nickname;
  }
  showError('');
  renderSaved();
  render();
  if (code) await refresh();
  else codeInput.focus();
}

form.addEventListener('submit', async (event) => {
  event.preventDefault();
  if (joining) return;
  const nextCode = codeInput.value.trim();
  const nickname = nicknameInput.value.normalize('NFKC').trim().replace(/\s+/g, ' ');
  if (!/^\d{6}$/.test(nextCode)) { showError('请输入六位数字房间码。'); codeInput.focus(); return; }
  const saved = readIdentity(nextCode);
  if (saved) { await openRoom(nextCode); return; }
  if (!nickname || [...nickname].length > 20) { showError('昵称应为 1–20 个字。'); nicknameInput.focus(); return; }
  version++;
  const joinVersion = version;
  code = nextCode;
  identity = null;
  room = null;
  player = null;
  joining = true;
  render();
  showError('');
  try {
    const keyName = `hlm-room-join:${code}`;
    const pendingName = `hlm-room-join-name:${code}`;
    let joinKey = localStorage.getItem(keyName);
    if (!joinKey || (localStorage.getItem(pendingName) && localStorage.getItem(pendingName) !== nickname)) joinKey = crypto.randomUUID();
    // 先保存请求身份；丢失响应后使用同一个昵称可恢复同一参赛席位。
    localStorage.setItem(keyName, joinKey);
    localStorage.setItem(pendingName, nickname);
    const data = await api(`/api/rooms/${code}/join`, { body: { nickname, joinKey } });
    if (joinVersion !== version) return;
    const joinedIdentity = { id: data.player.id, nickname: data.player.nickname, token: data.playerToken };
    localStorage.setItem(playerPrefix + code, JSON.stringify(joinedIdentity));
    identity = joinedIdentity;
    const target = new URL(homePath, location.origin);
    target.searchParams.set('room', code);
    history.replaceState(null, '', target.href);
    autoEnter = true;
    apply(data);
    renderSaved();
  } catch (error) {
    if (joinVersion === version) {
      unavailable = !!error.missing;
      showError(error.name === 'QuotaExceededError' || error.name === 'SecurityError' ? '无法保存参赛身份，请允许本站使用本地存储后重试。' : error.message);
    }
  } finally {
    joining = false;
    render();
    if (identity && !navigating) void refresh();
  }
});

tools.querySelector('button').addEventListener('click', () => { void openRoom(code); });
dialog.querySelector('.home-room-close').addEventListener('click', () => dialog.close());
// 原引擎用 Escape 的 keyup 切换紧急回避页；关面板的同一次按键不应传给它。
let closingWithEscape = false;
dialog.addEventListener('cancel', (event) => {
  event.preventDefault();
  closingWithEscape = true;
  dialog.close();
});
document.addEventListener('keyup', (event) => {
  if (closingWithEscape && event.code === 'Escape') {
    closingWithEscape = false;
    event.stopImmediatePropagation();
  }
}, true);
dialog.querySelector('#home-room-enter').addEventListener('click', enterGame);
dialog.querySelector('#home-room-refresh').addEventListener('click', () => { void refresh(); });
dialog.querySelector('#home-room-other').addEventListener('click', () => {
  history.replaceState(null, '', homePath);
  void openRoom();
});
dialog.querySelector('#home-room-show-board').addEventListener('click', () => {
  boardRequested = true;
  render();
  dialog.querySelector('#home-room-board').scrollIntoView({ block: 'start', behavior: 'smooth' });
});
for (const type of ['click', 'keydown', 'keyup', 'wheel', 'contextmenu']) {
  dialog.addEventListener(type, (event) => event.stopPropagation());
}
tools.addEventListener('click', (event) => event.stopPropagation());
window.addEventListener('hlm:open-room', (event) => {
  void openRoom(event.detail?.code || matchRoom || code, event.detail?.view || 'room');
});
document.addEventListener('visibilitychange', () => { if (!document.hidden && code) void refresh(); });

function updateEntry() {
  const title = document.querySelector('#root [style*="background/title.webp"]');
  const splash = document.querySelector('.html-body__title-enter');
  tools.hidden = !!matchRoom || (!title && (!splash || getComputedStyle(splash).display === 'none'));
}
new MutationObserver(updateEntry).observe(document.getElementById('root'), { childList: true, subtree: true });
updateEntry();
setInterval(() => { if (dialog.open) renderClock(); }, 500);
if (params.get('play') === '1' && !matchRoom) {
  await openRoom(requestedRoom);
  showError('本浏览器没有这个参赛身份，请使用原浏览器续玩，或填写房间码加入。');
} else if (requestedRoom && !matchRoom) void openRoom(requestedRoom);
