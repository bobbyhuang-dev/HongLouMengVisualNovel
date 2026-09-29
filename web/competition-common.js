// 主站房间面板与主持入口共用的 API、时间口径和公开成绩表。
export async function api(path, { body, token } = {}) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 8000);
  try {
    const response = await fetch(path, {
      method: body === undefined ? 'GET' : 'POST',
      headers: {
        accept: 'application/json',
        ...(body === undefined ? {} : { 'content-type': 'application/json' }),
        ...(token ? { authorization: `Bearer ${token}` } : {}),
      },
      body: body === undefined ? undefined : JSON.stringify(body),
      cache: 'no-store',
      signal: controller.signal,
    });
    let data;
    try { data = await response.json(); }
    catch (cause) {
      if (controller.signal.aborted) throw cause;
      const error = new Error('此站点未提供比赛服务，请到主站参加比赛。');
      error.status = response.status;
      error.missing = true;
      throw error;
    }
    if (!response.ok) {
      const error = new Error(data.error || `比赛请求失败（${response.status}）`);
      error.status = response.status;
      throw error;
    }
    return data;
  } catch (error) {
    if (error.status !== undefined || error.missing) throw error;
    throw new Error(controller.signal.aborted ? '连接超时，请重试。' : '网络连接失败，请检查网络后重试。');
  } finally {
    clearTimeout(timeout);
  }
}

export function formatTime(ms) {
  const seconds = Math.max(0, Math.min(900, Math.floor(Number(ms) / 1000) || 0));
  return `${String(Math.floor(seconds / 60)).padStart(2, '0')}:${String(seconds % 60).padStart(2, '0')}`;
}

const boardRows = new WeakMap();
const columns = [
  ['名次', 'c-rank'], ['昵称', 'c-nick'], ['正篇', 'c-main-text'],
  ['回顾', 'c-review-text'], ['积分', 'c-score'], ['还原', 'c-hits'],
  ['用时', 'c-time'], ['称号', 'c-title'], ['状态', 'c-status'],
];

export function renderBoard(body, room) {
  let rows = boardRows.get(body);
  if (!rows) { rows = new Map(); boardRows.set(body, rows); }
  const final = room.status === 'finished';
  const players = final ? room.players : [...room.players].sort((a, b) => b.score - a.score || a.elapsedMs - b.elapsedMs);
  const seen = new Set();
  players.forEach((player, index) => {
    seen.add(player.id);
    let row = rows.get(player.id);
    if (!row) {
      const element = document.createElement('tr');
      element.dataset.id = player.id;
      const cells = columns.map(([label, className], column) => {
        const cell = document.createElement(column === 1 ? 'th' : 'td');
        if (column === 1) cell.scope = 'row';
        cell.dataset.label = label;
        cell.className = className;
        element.append(cell);
        return cell;
      });
      row = { element, cells };
      rows.set(player.id, row);
    }
    const status = player.status === 'completed' ? '已完成' : final || player.status === 'timeout' ? '未完成' : player.status === 'waiting' ? '等待中' : '作答中';
    const values = [
      final ? player.rank ?? '—' : '—', player.nickname,
      `${Math.min(20, player.answered)}/20`, `${Math.max(0, player.answered - 20)}/3`,
      `${player.score}/53`, `${player.hits}/20`, formatTime(player.elapsedMs), player.title, status,
    ];
    values.forEach((value, column) => {
      const text = String(value);
      if (row.cells[column].textContent !== text) row.cells[column].textContent = text;
    });
    row.element.classList.toggle('is-lead', final && player.rank === 1);
    row.element.classList.toggle('is-unfinished', final && player.status !== 'completed');
    row.element.classList.toggle('is-completed', player.status === 'completed');
    if (body.children[index] !== row.element) body.insertBefore(row.element, body.children[index] ?? null);
  });
  for (const [id, row] of rows) {
    if (!seen.has(id)) { row.element.remove(); rows.delete(id); }
  }
}
