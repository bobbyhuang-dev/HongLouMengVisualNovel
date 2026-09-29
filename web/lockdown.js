// 比赛版界面限制：WebGAL 模板管不到底栏和标题菜单的按钮，这里在引擎外处理。
// - 隐藏存档/读档/快速存读档：否则选错后读档重选，还原题形同虚设。
// - 隐藏「回想」并屏蔽滚轮上滑（引擎默认上滑打开回想）：否则「石上回顾」可以翻历史记录找答案。
// 「继续游戏」保留：刷新页面后要靠它接着玩。
(() => {
  const HIDDEN_BAR = new Set(['回想', '快速存档', '快速读档', '存档', '读档']);
  const HIDDEN_TITLE = new Set(['读取存档']);
  const code = document.documentElement.dataset.matchRoom || '';
  const player = document.documentElement.dataset.matchPlayer || '';
  const formal = /^\d{6}$/.test(code) && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(player);
  if (formal) {
    // 正式比赛不可通过菜单重开、导入存档或清空本地进度。
    HIDDEN_BAR.add('标题');
    HIDDEN_BAR.add('选项');
    HIDDEN_TITLE.add('游戏选项');
    HIDDEN_TITLE.add('退出游戏');
  }

  const hide = (el) => {
    if (el && el.style.display !== 'none') el.style.display = 'none';
  };

  const sweep = () => {
    if (formal && localStorage.getItem(`hlm-room-begun:${code}:${player}`) === 'true') HIDDEN_TITLE.add('开始游戏');
    for (const label of document.querySelectorAll('#root [class*="_button_text_"]')) {
      if (HIDDEN_BAR.has(label.textContent.trim())) hide(label.closest('[class*="_singleButton_"]'));
    }
    // 标题菜单的类名是随机的 css-xxxx，按文字找到叶子节点，再上溯到按钮列表的直接子元素
    for (const leaf of document.querySelectorAll('#root span, #root div')) {
      if (leaf.childElementCount || !HIDDEN_TITLE.has(leaf.textContent.trim())) continue;
      let item = leaf;
      while (item.parentElement && item.parentElement.childElementCount < 3) item = item.parentElement;
      hide(item);
    }
  };

  window.addEventListener(
    'wheel',
    (e) => {
      const node = e.target instanceof Element ? e.target : e.target?.parentElement;
      if (node?.closest('#hlm-room-dialog')) return;
      if (e.deltaY < 0) e.stopPropagation();
    },
    { capture: true },
  );

  let queued = false;
  const onMutate = () => {
    if (queued) return;
    queued = true;
    requestAnimationFrame(() => {
      queued = false;
      sweep();
    });
  };
  const mount = () => {
    new MutationObserver(onMutate).observe(document.body, { childList: true, subtree: true });
    sweep();
  };
  if (document.body) mount();
  else document.addEventListener('DOMContentLoaded', mount);
})();
