// world-engine-ui.js — 完整 UI 面板
window.WORLD_ENGINE_UI = (function() {
  const core = window.WORLD_ENGINE_CORE;
  const evolution = window.WORLD_ENGINE_EVOLUTION;

  let panelElement = null;
  let panelBodyElement = null;
  let panelVisible = false;
  let _engineFace = 'world';
  const _engineFaceOrder = [];
  const _engineFaceRegistry = new Map();
  let _memorySettingsOpen = false;
  let _memoryView = 'home';
  let _memorySelectedNavView = null;
  let _memoryEditingPerson = null;
  let _memoryEditingEntity = null;
  let _memoryEditingSmall = null;
  let _memoryEditingBig = null;
  const _memoryCollapsedRecords = new Set();
  const _memorySeenRecords = new Set();
  let _memoryCollapseScope = '';
  let _memoryRunningLabel = '';
  let _panelFlipping = false;
  let isEvolving = false;
  let editingEvent = null;
  let editingFaction = null;
  let editingWind = null;
  let editingTrend = null;
  let editingDigest = null;
  let editingEnemy = null;
  let editingInfluence = null;
  let editingRI = null;
  // 秘密编辑器统一态：{ scope, list:'action'|'asset', index, view:'action'|'asset' }
  //   list  = 条目当前所在的桶；index = 在该桶里的下标
  //   view  = 当前显示的表单类型（切下拉只改 view，不动数据；转换延到保存）
  let editingSecret = null;
  let listPagerCounter = 0;
  const listPageState = {};
  const sectionCollapsed = { 'checkpoint-section': true, 'set-filter': true };
  const expandedWorldbookGroups = new Set();
  // 世界书缓存（模块级，跨 refresh() 存活）
  let _wbCachedEntries = null;
  let _wbCachedSelectedIds = null;
  let _wbCachedOverrides = null;
  let _wbCachedChatId = null;
  let _wbCachedScope = null;
  let _wbScrollTop = 0;

  // 引擎面扩展点：新增引擎按注册顺序进入“下一界面”循环。
  // 可提供 render/bind、主题/版本、设置、运行状态、球体 class 与卫星按钮动作等钩子。
  function registerEngineFace(definition) {
    const face = definition && typeof definition === 'object' ? definition : {};
    const id = String(face.id || '').trim();
    if (!id) throw new Error('An engine view must provide an id');
    const existed = _engineFaceRegistry.has(id);
    _engineFaceRegistry.set(id, { id, label: id, ...face });
    if (!existed) _engineFaceOrder.push(id);
    if (panelElement) updateEngineFaceChrome();
    return id;
  }

  function callEngineFace(face, hook, fallback, ...args) {
    try {
      return typeof face?.[hook] === 'function' ? face[hook](...args) : fallback;
    } catch (error) {
      console.error(`[${face?.label || face?.id || 'Engine'}] UI ${hook} failed (isolated)`, error);
      return fallback;
    }
  }

  const ENGINE_ACTION_FAILED = Symbol('engine-action-failed');
  function callEngineFaceAction(face, hook, ...args) {
    const report = error => {
      console.error(`[${face?.label || face?.id || 'Engine'}] UI ${hook} failed (isolated)`, error);
      showToast(`${face?.label || 'Engine'} action failed: ${error?.message || error}`, true);
      return ENGINE_ACTION_FAILED;
    };
    try {
      if (typeof face?.[hook] !== 'function') return ENGINE_ACTION_FAILED;
      const result = face[hook](...args);
      return result && typeof result.then === 'function' ? result.catch(report) : result;
    } catch (error) {
      return report(error);
    }
  }

  function ensureBuiltinEngineFaces() {
    if (_engineFaceRegistry.has('world')) return;
    registerEngineFace({
      id: 'world', label: 'World Engine',
      getTheme: () => getStoredTheme(),
      getVersion: () => window.WORLD_ENGINE_VERSION,
      getSettings: () => window.WORLD_ENGINE_API?.getSettings(true) || {},
      setEnabled: enabled => {
        const api = window.WORLD_ENGINE_API;
        const current = api?.getSettings?.(true) || {};
        window.WORLD_ENGINE_STORE.setItem('world_engine_settings', JSON.stringify({ ...current, engineEnabled: enabled }));
        api?.getSettings?.(true);
        window.WORLD_ENGINE?.applyInjection?.();
      },
      isRunning: () => Boolean(_evolving),
      showForward: true,
      forward: () => runManualEvolve('forward', 'state'),
      redo: () => runManualEvolve('redo', 'checkpoint'),
      abort: () => evolution.abort()
    });
    registerEngineFace({
      id: 'memory', label: 'Memory Engine', ballClass: 'we-ball-memory-face', panelClass: 'we-memory-face',
      getTheme: () => getStoredMemoryTheme(),
      getVersion: () => window.MEMORY_ENGINE_SETTINGS?.VERSION,
      getSettings: () => window.MEMORY_ENGINE_SETTINGS?.getSettings(true) || {},
      setEnabled: enabled => {
        window.MEMORY_ENGINE_SETTINGS?.patchSettings({ engineEnabled: enabled });
        window.MEMORY_ENGINE?.applyInjection?.();
      },
      isRunning: () => Boolean(window.MEMORY_ENGINE?.isRunning?.()),
      getRunningLabel: () => window.MEMORY_ENGINE?.getRunningLabel?.() || _memoryRunningLabel,
      render: () => renderMemoryView(),
      bind: () => bindMemoryView(),
      openSettings: () => { _memorySettingsOpen = !_memorySettingsOpen; },
      isSettingsOpen: () => _memorySettingsOpen,
      onSettingsTab: key => { _memorySettingsTab = key; },
      refreshDebug: () => refreshMemoryDebugRender(),
      showForward: true,
      forwardTitle: 'Extract memories manually',
      forward: () => runMemoryExtract(),
      redo: () => runMemoryReextract(),
      abort: () => window.MEMORY_ENGINE?.abort?.()
    });
  }

  function getEngineFace(id) {
    ensureBuiltinEngineFaces();
    return _engineFaceRegistry.get(id || _engineFace) || _engineFaceRegistry.get('world');
  }

  function getNextEngineFace() {
    ensureBuiltinEngineFaces();
    const index = Math.max(0, _engineFaceOrder.indexOf(_engineFace));
    return getEngineFace(_engineFaceOrder[(index + 1) % _engineFaceOrder.length]);
  }

  // 六套纯 CSS 变量主题。写在 <html> 上，面板、悬浮球和顶部状态条同步换色。
  const WE_THEME_KEY = 'we-theme';
  const MEMORY_THEME_KEY = 'memory-engine-theme';
  const MEMORY_THEME_NIGHT_MIGRATION_KEY = 'memory-engine-theme-night-default-v1';
  const WE_THEMES = [
    { id: 'default', name: 'Jade · Default' },
    { id: 'night', name: 'Late Night · Near Black' },
    { id: 'deepsea', name: 'Deep Sea · Dark Blue' },
    { id: 'plum', name: 'Night Bloom · Dark Purple' },
    { id: 'paper', name: 'Cloud White · Fresh' },
    { id: 'sakura', name: 'Early Cherry · Light Pink' }
  ];
  const MECHANICS_DEFAULT_FIELDS = {
    regional: {
      'we-local-ri-chance': 3,
      'we-local-ri-duration': 5,
      'we-local-ri-cooldown': 5
    },
    distant: {
      'we-local-distant-threshold': 10,
      'we-local-distant-chance': 20,
      'we-local-distant-cooldown': 5,
      'we-local-distant-event-percent': 50
    },
    near: {
      'we-local-near-chance': 20,
      'we-local-near-cooldown': 5,
      'we-local-near-event-percent': 50
    },
    dice: {
      'we-local-dice-mod': 0,
      'we-local-setback-ratio': 40,
      'we-local-progress-fail-base': 2,
      'we-local-conflict-fail-base': 6
    },
    winddecay: {
      'we-local-wind-rumor-base': 25,
      'we-local-wind-rumor-grace': 1,
      'we-local-wind-rumor-linear': 5,
      'we-local-wind-rumor-quadratic': 3,
      'we-local-wind-sentiment-base': 8,
      'we-local-wind-sentiment-grace': 5,
      'we-local-wind-sentiment-linear': 2,
      'we-local-wind-sentiment-quadratic': 1,
      'we-local-wind-report-base': 20,
      'we-local-wind-report-grace': 2,
      'we-local-wind-report-linear': 4,
      'we-local-wind-report-quadratic': 2,
      'we-local-wind-announcement-base': 10,
      'we-local-wind-announcement-grace': 4,
      'we-local-wind-announcement-linear': 3,
      'we-local-wind-announcement-quadratic': 1
    },
    retention: {
      'we-local-terminal-base': 2,
      'we-local-terminal-level': 2,
      'we-local-influence-keep': 8,
      'we-local-enemy-keep': 20,
      'we-local-ledger-keep': 20,
      'we-local-cap-events': 16,
      'we-local-cap-factions': 15,
      'we-local-cap-winds': 12,
      'we-local-cap-trends': 4,
      'we-local-cap-influence': 12,
      'we-local-cap-enemies': 8,
      'we-local-cap-econ': 8,
      'we-local-cap-blackbox': 12
    }
  };

  function normalizeTheme(id) {
    return WE_THEMES.some(theme => theme.id === id) ? id : 'default';
  }

  function getStoredTheme() {
    try { return normalizeTheme(localStorage.getItem(WE_THEME_KEY) || 'default'); }
    catch (e) { return 'default'; }
  }

  function getStoredMemoryTheme() {
    try {
      let stored = localStorage.getItem(MEMORY_THEME_KEY);
      if (!localStorage.getItem(MEMORY_THEME_NIGHT_MIGRATION_KEY)) {
        if (!stored || stored === 'default') {
          stored = 'night';
          localStorage.setItem(MEMORY_THEME_KEY, stored);
        }
        localStorage.setItem(MEMORY_THEME_NIGHT_MIGRATION_KEY, '1');
      }
      return normalizeTheme(stored || 'night');
    }
    catch (e) { return 'night'; }
  }

  function applyTheme(id) {
    const theme = normalizeTheme(id);
    const root = document.documentElement;
    if (!root) return;
    if (theme === 'default') root.removeAttribute('data-we-theme');
    else root.setAttribute('data-we-theme', theme);
  }

  function setTheme(id) {
    const theme = normalizeTheme(id);
    applyTheme(theme);
    try { localStorage.setItem(WE_THEME_KEY, theme); } catch (e) {}
  }

  function setMemoryTheme(id) {
    const theme = normalizeTheme(id);
    applyTheme(theme);
    try { localStorage.setItem(MEMORY_THEME_KEY, theme); } catch (e) {}
  }

  function applyEngineFaceTheme() {
    const face = getEngineFace();
    applyTheme(callEngineFace(face, 'getTheme', getStoredTheme()));
  }

  // 模块加载时立即恢复主题，避免面板和悬浮球先闪默认色。
  applyTheme(getStoredTheme());

  function h(str) {
    if (!str) return '';
    return String(str).replace(/[&<>"']/g, m => ({
      '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;'
    }[m] || m));
  }

  /** 渲染用户可见文本：将 {{user}} 替换为当前角色名，并转义 HTML */
  function u(text) {
    return h(core.renderUserName(text));
  }

  function showToast(msg, isError, duration) {
    const id = 'we-toast';
    let el = document.getElementById(id);
    if (el) el.remove();
    el = document.createElement('div');
    el.id = id;
    el.className = 'we-toast' + (isError ? ' error' : '');
    el.textContent = msg;
    document.body.appendChild(el);
    if (duration !== 0) setTimeout(() => el.remove(), duration || 3000);
  }

  // 各分页小标题的随附古文（去 cp- 前缀后查表；设置页等不在表中则无）
  const SECTION_MOTTOS = {
    trends: 'Great tides form little by little',
    regional: 'Alarm in one place startles all four sides',
    ledger: 'Every trifle has its origin',
    events: 'Pull one hair and the whole body moves',
    winds: 'The wind rises from the tips of the duckweed',
    influence: 'Tug the branch and the leaves stir',
    reputation: 'A name follows you like a shadow',
    factions: 'Under a great tree, the grass takes no frost',
    enemies: 'Foes rejoice, friends grieve',
    economy: 'Food is the people\'s root; goods are their means',
    blackbox: 'Walls have ears; foes lie in wait'
  };

  function sectionHeader(title, sectionId) {
    const collapsed = sectionCollapsed[sectionId] || false;
    const motto = SECTION_MOTTOS[sectionId.replace(/^cp-/, '')];
    const mottoHtml = motto ? `<span class="we-section-motto">— ${motto}</span>` : '';
    return `<span class="we-section-toggle" data-section="${sectionId}">
      <span class="we-section-arrow" id="we-section-arrow-${sectionId}">${collapsed ? '▶' : '▼'}</span>${title}${mottoHtml}
    </span>`;
  }

  function sectionBody(sectionId, content) {
    const collapsed = sectionCollapsed[sectionId] || false;
    return `<div class="we-section-body" id="we-section-body-${sectionId}" style="${collapsed ? 'display:none' : ''}">${content}</div>`;
  }

  function buildPanel() {
    if (document.getElementById('we-panel')) return;

    const panel = document.createElement('div');
    panel.id = 'we-panel';
    panel.innerHTML = `
      <div class="we-panel-header">
        <div class="we-header-info">
          <div class="we-header-top">
            <button class="we-panel-title we-engine-face-toggle" type="button" title="Switch to the Memory Engine" aria-label="Switch to the Memory Engine">World Engine</button>
            <span class="we-panel-version" id="we-panel-version"></span><!-- [FIX] version number -->
            <span class="we-header-round" id="we-header-round"></span>
          </div>
          <div class="we-header-mood" id="we-header-mood">
            <span class="we-header-dot"></span>
            <span class="we-header-mood-text"></span>
          </div>
        </div>
        <div class="we-panel-corner-actions">
          <button class="we-panel-close">✕</button>
          <button class="we-panel-settings" id="we-btn-settings-open" title="Settings"><i class="fa-solid fa-gear"></i></button>
        </div>
      </div>
      <div class="we-panel-body" id="we-panel-body">
        <div class="we-loading">Loading...</div>
      </div>
    `;
    document.body.appendChild(panel);
    panelElement = panel;
    panelBodyElement = panel.querySelector('#we-panel-body');

    // [FIX] 显示扩展版本号（来自 manifest.json，读不到则隐藏）
    const verEl = panel.querySelector('#we-panel-version');
    if (verEl) {
      const v = window.WORLD_ENGINE_VERSION;
      if (v) verEl.textContent = 'v' + v;
      else verEl.style.display = 'none';
    }

    panel.querySelector('.we-panel-close').onclick = () => hidePanel();
    panel.querySelector('.we-engine-face-toggle').onclick = (event) => {
      event.stopPropagation();
      advanceEngineFace();
    };
    initDrag(panel, panel.querySelector('.we-panel-header'));

    document.addEventListener('keydown', function(e) {
      if (e.key === 'Escape' && panelVisible) hidePanel();
    });
  }

  // 当前视图：'home' | 'situation' | 'events' | 'relations' | 'resources' | 'settings'
  let _currentView = 'home';

  function renderMemoryView() {
    if (_memorySettingsOpen) return renderMemorySettingsView();
    if (_memoryView === 'home') return renderMemoryHomeView();
    return renderMemorySubView(_memoryView);
  }

  function memoryProgressCircle(radius, progress, color, width, className) {
    const circumference = 2 * Math.PI * radius;
    const ratio = Math.max(0, Math.min(1, Number(progress) || 0));
    const dash = (circumference * ratio).toFixed(1);
    return `<circle class="${className}" cx="80" cy="80" r="${radius}" fill="none" stroke="${color}" stroke-width="${width}"
      stroke-linecap="round" stroke-dasharray="${dash} ${(circumference - circumference * ratio).toFixed(1)}"
      transform="rotate(-90 80 80)"/>`;
  }

  function renderMemoryCore(state, settings) {
    const eventMemory = state?.event_memory || {};
    const smallSummaries = Array.isArray(eventMemory.small_summaries) ? eventMemory.small_summaries : [];
    const bigSummaries = Array.isArray(eventMemory.big_summaries) ? eventMemory.big_summaries : [];
    const cursor = Math.max(0, Math.min(smallSummaries.length, parseInt(eventMemory.big_summary_cursor) || 0));
    const bigTarget = Math.max(1, parseInt(settings.bigSummaryEveryX) || 5);
    const pendingSmall = Math.max(0, smallSummaries.length - cursor);
    const bigProgress = Math.min(1, pendingSmall / bigTarget);
    const bigRemaining = Math.max(0, bigTarget - pendingSmall);
    const entityCount = ['organization', 'object', 'ability', 'location']
      .reduce((sum, type) => sum + (Array.isArray(state?.entity_memory?.[type]) ? state.entity_memory[type].length : 0), 0);
    const stats = [
      ['Characters', Array.isArray(state?.personal_memory) ? state.personal_memory.length : 0],
      ['Entities', entityCount],
      ['Notes', smallSummaries.length],
      ['Overview', bigSummaries.length]
    ].map(([label, value]) => `<div class="we-core-stat"><div class="we-core-stat-k">${label}</div><div class="we-core-stat-v">${value}</div></div>`).join('');
    const centerMain = bigRemaining > 0 ? bigRemaining : 'Pending';
    const centerUnit = bigRemaining > 0 ? '<span>rounds</span>' : '';

    return `<div class="we-section we-core-section we-memory-core-section">
      <div class="we-core" title="${bigRemaining > 0 ? `${bigRemaining} rounds until the next overview` : 'Overview pending'}">
        <div class="we-core-ring we-memory-core-ring">
          <svg viewBox="0 0 160 160" width="160" height="160" aria-hidden="true">
            <circle cx="80" cy="80" r="64" fill="none" stroke="color-mix(in srgb, var(--we-accent) 18%, transparent)" stroke-width="6"/>
            ${memoryProgressCircle(64, bigProgress, 'var(--we-accent)', 6, 'we-memory-big-progress')}
          </svg>
          <div class="we-core-center">
            <div class="we-core-title">Memory thread</div>
            <div class="we-core-sub">Next overview</div>
            <div class="we-core-pct we-memory-core-value">${centerMain}${centerUnit}</div>
          </div>
        </div>
        <div class="we-core-stats">${stats}</div>
      </div>
    </div>`;
  }

  function renderMemoryHomeView() {
    const state = window.MEMORY_ENGINE_DATA?.loadState?.() || {};
    const settings = window.MEMORY_ENGINE_SETTINGS?.getSettings?.(true) || {};
    const rows = [
      { view: 'people', label: 'Characters', sub: 'Character memories · aliases · time', poem: 'Knowing others is wisdom' },
      { view: 'entities', label: 'Entities', sub: 'Organizations · objects · abilities · locations', poem: 'A name is the guest of reality' },
      { view: 'minutes', label: 'Notes', sub: 'Stage notes · message ranges', poem: 'A chronicler must grasp the essentials' },
      { view: 'overview', label: 'Overview', sub: 'Stage overviews · the big picture', poem: 'Lift the headrope and every mesh opens' }
    ];
    const nav = rows.map((row, index) => {
      const selected = _memorySelectedNavView === row.view ? ' we-nav-row--selected' : '';
      const topLine = index === 0 ? '<div class="we-nav-line we-nav-line-hidden"></div>' : '<div class="we-nav-line"></div>';
      const bottomLine = index === rows.length - 1 ? '<div class="we-nav-line we-nav-line-hidden"></div>' : '<div class="we-nav-line"></div>';
      return `<div class="we-nav-row we-memory-nav-row${selected}" data-memory-view="${row.view}">
        <div class="we-nav-label">${row.label}</div>
        <div class="we-nav-track">${topLine}<div class="we-nav-dot"></div>${bottomLine}</div>
        <div class="we-nav-content"><span class="we-nav-sub">${row.sub}</span><span class="we-nav-poem">${row.poem}</span></div>
        <i class="fa-solid fa-chevron-right we-nav-arrow"></i>
      </div>`;
    }).join('');
    return '<div class="we-memory-home">'
      + renderMemoryCore(state, settings)
      + '<div class="we-nav-list we-memory-nav-list">' + nav + '</div>'
      + '</div>';
  }

  const MEMORY_VIEW_META = {
    people: { title: 'Characters', poem: 'Knowing others is wisdom' },
    entities: { title: 'Entities', poem: 'A name is the guest of reality' },
    minutes: { title: 'Notes', poem: 'A chronicler must grasp the essentials' },
    overview: { title: 'Overview', poem: 'Lift the headrope and every mesh opens' }
  };
  const MEMORY_ENTITY_LABELS = { organization: 'Organization', object: 'Object', ability: 'Ability', location: 'Location' };

  function renderMemoryEntryRow(time, content, kind, knownBy) {
    const placeholder = kind === 'history' ? 'Event content' : 'Character memories';
    return `<div class="we-memory-entry-edit" data-memory-entry-row>
      <input class="we-memory-entry-time" type="text" value="${h(time || '')}" placeholder="Time (optional)">
      <textarea class="we-memory-entry-content" rows="2" placeholder="${placeholder}">${h(content || '')}</textarea>
      ${kind === 'memory' ? `<input class="we-memory-entry-known-by" type="text" value="${h((knownBy || []).join(' / '))}" placeholder="Who knows (separate with /; the holder need not be listed)">` : ''}
      <button class="we-icon-btn we-memory-remove-entry" type="button" title="Remove this entry"><i class="fa-solid fa-xmark"></i></button>
    </div>`;
  }

  function memoryKnownBy(state, person, time, memory) {
    return (state?.personal_memory || []).filter(knower => knower.id !== person?.id && (knower.names || []).some(name =>
      (state?.knowledge_index?.[String(name).trim().toLocaleLowerCase()] || []).some(record =>
        record.ownerId === person?.id && String(record.time || '') === String(time || '') && String(record.memory || '') === String(memory || '')
      )
    )).map(knower => knower.names?.[0] || knower.id);
  }

  function memoryRecordToggle(key, defaultCollapsed = true) {
    ensureMemoryRecordDefault(key, defaultCollapsed);
    const collapsed = _memoryCollapsedRecords.has(key);
    return `<button class="we-icon-btn we-memory-toggle-record" type="button" data-memory-collapse-key="${h(key)}" title="${collapsed ? 'Expand' : 'Collapse'}" aria-expanded="${collapsed ? 'false' : 'true'}"><i class="fa-solid fa-chevron-${collapsed ? 'right' : 'down'}"></i></button>`;
  }

  function memoryRecordClass(key, extra, defaultCollapsed = true) {
    ensureMemoryRecordDefault(key, defaultCollapsed);
    return `we-memory-record${extra ? ` ${extra}` : ''}${_memoryCollapsedRecords.has(key) ? ' is-collapsed' : ''}`;
  }

  function memoryRecordBody(key, content, defaultCollapsed = true) {
    ensureMemoryRecordDefault(key, defaultCollapsed);
    return `<div class="we-memory-record-body"${_memoryCollapsedRecords.has(key) ? ' hidden' : ''}>${content}</div>`;
  }

  function ensureMemoryRecordDefault(key, defaultCollapsed = true) {
    if (!key || _memorySeenRecords.has(key)) return;
    _memorySeenRecords.add(key);
    if (defaultCollapsed) _memoryCollapsedRecords.add(key);
  }

  function expandMemoryRecord(key) {
    if (!key) return;
    _memorySeenRecords.add(key);
    _memoryCollapsedRecords.delete(key);
  }

  function renderMemoryPersonEditor(person, isNew, state) {
    const entries = Object.entries(person?.memory || {}).flatMap(([time, memories]) =>
      (Array.isArray(memories) ? memories : []).map(memory => renderMemoryEntryRow(time, memory, 'memory', memoryKnownBy(state, person, time, memory)))
    ).join('');
    return `<div class="we-memory-editor" data-person-editor data-person-id="${h(person?.id || '')}" data-new="${isNew ? 'true' : 'false'}">
      <div class="we-input-group"><label>Name and aliases (separate with /)</label><input class="we-memory-person-names" type="text" value="${h((person?.names || []).join(' / '))}" placeholder="e.g. Elias Crane / Crane"></div>
      <div class="we-memory-editor-label">Character memories</div>
      <div class="we-memory-entry-list">${entries || '<div class="we-memory-entry-empty">No memories yet; add one below</div>'}</div>
      <button class="we-btn we-memory-add-entry" type="button" data-entry-kind="memory"><i class="fa-solid fa-plus"></i> Add memory</button>
      <div class="we-memory-editor-actions"><button class="we-btn we-memory-cancel-edit" type="button">Cancel</button><button class="we-btn we-btn-primary we-memory-save-person" type="button">Save</button></div>
    </div>`;
  }

  function renderMemoryPeople(state) {
    const people = Array.isArray(state.personal_memory) ? state.personal_memory : [];
    const draft = _memoryEditingPerson === '__new__'
      ? `<div class="we-memory-record we-memory-record-new">${renderMemoryPersonEditor({ id: '', names: [], memory: {} }, true, state)}</div>` : '';
    const cards = people.map(person => {
      const editing = _memoryEditingPerson === person.id;
      const collapseKey = `person:${person.id}`;
      const entries = Object.entries(person.memory || {}).flatMap(([time, memories]) =>
        (Array.isArray(memories) ? memories : []).map(memory => {
          const knownBy = memoryKnownBy(state, person, time, memory);
          return `<div class="we-memory-line"><span class="we-memory-line-time">${h(time || 'Time unknown')}</span><div class="we-memory-line-main"><div class="we-memory-line-content">${h(memory)}</div><div class="we-memory-line-known">Known by: ${h(knownBy.length ? knownBy.join(' · ') : 'Only the holder')}</div></div></div>`;
        })
      ).join('');
      return `<div class="${memoryRecordClass(collapseKey)}" data-person-id="${h(person.id)}">
        <div class="we-memory-record-head" data-memory-collapse-key="${h(collapseKey)}" role="button" tabindex="0"><div><div class="we-memory-record-title">${h(person.names?.[0] || 'Unnamed character')}</div><div class="we-memory-record-meta">${h((person.names || []).slice(1).join(' · ') || person.id)}</div></div>
          <div class="we-memory-record-actions">${memoryRecordToggle(collapseKey)}<button class="we-icon-btn we-memory-edit-person" type="button" title="Edit"><i class="fa-solid fa-pen"></i></button><button class="we-icon-btn we-memory-delete-person" type="button" title="Delete"><i class="fa-solid fa-trash"></i></button></div>
        </div>
        ${memoryRecordBody(collapseKey, editing ? renderMemoryPersonEditor(person, false, state) : (entries || '<div class="we-empty">No character memories yet</div>'))}
      </div>`;
    }).join('');
    return `<div class="we-memory-page-actions"><button class="we-btn we-btn-primary" id="we-memory-add-person" type="button"><i class="fa-solid fa-plus"></i> New character</button></div>${draft}${cards || '<div class="we-empty">No characters yet; click "New character" to add one by hand.</div>'}`;
  }

  function renderMemoryEntityEditor(entity, type, isNew) {
    const history = (Array.isArray(entity?.history) ? entity.history : [])
      .map(entry => renderMemoryEntryRow(entry.time, entry.event, 'history')).join('');
    const options = Object.entries(MEMORY_ENTITY_LABELS).map(([value, label]) => `<option value="${value}" ${value === type ? 'selected' : ''}>${label}</option>`).join('');
    return `<div class="we-memory-editor" data-entity-editor data-entity-id="${h(entity?.id || '')}" data-original-type="${h(type || 'organization')}" data-new="${isNew ? 'true' : 'false'}">
      <div class="we-memory-form-grid"><div class="we-input-group"><label>Type</label><select class="we-memory-entity-type">${options}</select></div><div class="we-input-group"><label>Name</label><input class="we-memory-entity-name" type="text" value="${h(entity?.name || '')}" placeholder="Entity name"></div></div>
      <div class="we-input-group"><label>Aliases (separate with /)</label><input class="we-memory-entity-aliases" type="text" value="${h((entity?.aliases || []).join(' / '))}" placeholder="e.g. Tidebreaker / the Old Sea Blade"></div>
      <div class="we-input-group"><label>Current description</label><textarea class="we-memory-entity-description" rows="3" placeholder="The entity's current state and traits">${h(entity?.description || '')}</textarea></div>
      <div class="we-memory-editor-label">History</div>
      <div class="we-memory-entry-list">${history || '<div class="we-memory-entry-empty">No history yet; add one below</div>'}</div>
      <button class="we-btn we-memory-add-entry" type="button" data-entry-kind="history"><i class="fa-solid fa-plus"></i> Add history</button>
      <div class="we-memory-editor-actions"><button class="we-btn we-memory-cancel-edit" type="button">Cancel</button><button class="we-btn we-btn-primary we-memory-save-entity" type="button">Save</button></div>
    </div>`;
  }

  function renderMemoryEntities(state) {
    const draft = _memoryEditingEntity === '__new__'
      ? `<div class="we-memory-record we-memory-record-new">${renderMemoryEntityEditor({ id: '', name: '', description: '', history: [] }, 'organization', true)}</div>` : '';
    const groups = Object.entries(MEMORY_ENTITY_LABELS).map(([type, label]) => {
      const entities = Array.isArray(state.entity_memory?.[type]) ? state.entity_memory[type] : [];
      const cards = entities.map(entity => {
        const key = `${type}:${entity.id}`;
        const collapseKey = `entity:${key}`;
        const history = (Array.isArray(entity.history) ? entity.history : []).map(entry =>
          `<div class="we-memory-line"><span class="we-memory-line-time">${h(entry.time || 'Time unknown')}</span><div class="we-memory-line-main"><div class="we-memory-line-content">${h(entry.event)}</div></div></div>`
        ).join('');
        return `<div class="${memoryRecordClass(collapseKey)}" data-entity-id="${h(entity.id)}" data-entity-type="${type}">
          <div class="we-memory-record-head" data-memory-collapse-key="${h(collapseKey)}" role="button" tabindex="0"><div><div class="we-memory-record-title"><span class="we-memory-type-badge">${label}</span>${h(entity.name || 'Unnamed entity')}</div><div class="we-memory-record-meta">${h((entity.aliases || []).join(' · ') || entity.id)}</div></div>
            <div class="we-memory-record-actions">${memoryRecordToggle(collapseKey)}<button class="we-icon-btn we-memory-edit-entity" type="button" title="Edit"><i class="fa-solid fa-pen"></i></button><button class="we-icon-btn we-memory-delete-entity" type="button" title="Delete"><i class="fa-solid fa-trash"></i></button></div>
          </div>
          ${memoryRecordBody(collapseKey, _memoryEditingEntity === key ? renderMemoryEntityEditor(entity, type, false) : `<div class="we-memory-description">${h(entity.description || 'No description')}</div>${history}`)}
        </div>`;
      }).join('');
      const categoryKey = `entity-category:${type}`;
      return `<div class="${memoryRecordClass(categoryKey, 'we-memory-entity-group')}" data-entity-category="${type}">
        <div class="we-memory-record-head" data-memory-collapse-key="${h(categoryKey)}" role="button" tabindex="0"><div><div class="we-memory-record-title"><span class="we-memory-type-badge">${label}</span>${label}</div><div class="we-memory-record-meta">${entities.length} items</div></div>
          <div class="we-memory-record-actions">${memoryRecordToggle(categoryKey)}</div>
        </div>
        ${memoryRecordBody(categoryKey, cards || `<div class="we-empty">No ${label} yet</div>`)}
      </div>`;
    }).join('');
    return `<div class="we-memory-page-actions"><button class="we-btn we-btn-primary" id="we-memory-add-entity" type="button"><i class="fa-solid fa-plus"></i> New entity</button></div>${draft}${groups}`;
  }

  function renderMemoryMinutes(state) {
    const eventMemory = state.event_memory || {};
    const items = Array.isArray(eventMemory.small_summaries) ? eventMemory.small_summaries : [];
    const cursor = Math.max(0, Math.min(items.length, parseInt(eventMemory.big_summary_cursor) || 0));
    const editor = (item, isNew) => `<div class="we-memory-editor">
      <div class="we-memory-form-grid"><div class="we-input-group"><label>Start message</label><input class="we-memory-small-start" type="number" min="0" value="${h(String(item.startLayer ?? 0))}"></div><div class="we-input-group"><label>End message</label><input class="we-memory-small-end" type="number" min="0" value="${h(String(item.endLayer ?? 0))}"></div></div>
      <div class="we-input-group"><label>Note content</label><textarea class="we-memory-small-content" rows="6">${h(item.content || '')}</textarea><div class="we-hint">The API aims for 40–150 words, and longer notes are kept in full; notes added by hand are only appended as unfiled and never change existing overviews.</div></div>
      <div class="we-memory-editor-actions"><button class="we-btn we-memory-cancel-edit" type="button">Cancel</button><button class="we-btn we-btn-primary we-memory-save-small" data-new="${isNew ? 'true' : 'false'}" type="button">Save</button></div>
    </div>`;
    const draft = _memoryEditingSmall === '__new__'
      ? `<div class="we-memory-record we-memory-record-new" data-small-id="__new__">${editor({ startLayer: eventMemory.small_summary_layer ?? 0, endLayer: eventMemory.small_summary_layer ?? 0, content: '' }, true)}</div>` : '';
    const cards = items.map((item, index) => {
      const collapseKey = `small:${item.id}`;
      const defaultCollapsed = index !== items.length - 1;
      return `<div class="${memoryRecordClass(collapseKey, '', defaultCollapsed)}" data-small-id="${h(item.id)}">
      <div class="we-memory-record-head" data-memory-collapse-key="${h(collapseKey)}" role="button" tabindex="0"><div><div class="we-memory-record-title">Messages ${h(String(item.startLayer))}–${h(String(item.endLayer))}</div><div class="we-memory-record-meta">${index < cursor ? 'Filed into overview' : 'Waiting to be filed'} · ${h(item.id)}</div></div>
        <div class="we-memory-record-actions">${memoryRecordToggle(collapseKey, defaultCollapsed)}<button class="we-icon-btn we-memory-edit-small" type="button" title="Edit"><i class="fa-solid fa-pen"></i></button><button class="we-icon-btn we-memory-delete-small" type="button" title="Delete"><i class="fa-solid fa-trash"></i></button></div>
      </div>
      ${memoryRecordBody(collapseKey, _memoryEditingSmall === item.id ? editor(item, false) : `<div class="we-memory-summary-text">${h(item.content || '(empty)')}</div>`, defaultCollapsed)}
    </div>`;
    }).join('');
    const countHint = items.length > 1 ? `<div class="we-hint">${items.length} notes in total; the latest is expanded by default.</div>` : '';
    return `<div class="we-memory-page-actions"><button class="we-btn we-btn-primary" id="we-memory-add-small" type="button"><i class="fa-solid fa-plus"></i> New note</button></div>${countHint}${draft}${cards || '<div class="we-empty">No notes generated yet; you can add one by hand.</div>'}`;
  }

  function renderMemoryOverview(state) {
    const items = Array.isArray(state.event_memory?.big_summaries) ? state.event_memory.big_summaries : [];
    const editor = (big, isNew) => `<div class="we-memory-editor">
      <div class="we-memory-form-grid"><div class="we-input-group"><label>Start message</label><input class="we-memory-big-start" type="number" min="0" value="${h(String(big.startLayer ?? 0))}"></div><div class="we-input-group"><label>End message</label><input class="we-memory-big-end" type="number" min="0" value="${h(String(big.endLayer ?? 0))}"></div></div>
      <div class="we-input-group"><label>Overview content</label><textarea class="we-memory-big-content" rows="10">${h(big.content || '')}</textarea><div class="we-hint">The API aims for at least 350 words and at most half the word count of this batch of notes; if that half is under 350, both limits are 350 words. Longer overviews are kept in full; deleting an overview does not move the notes cursor back.</div></div>
      <div class="we-memory-editor-actions"><button class="we-btn we-memory-cancel-edit" type="button">Cancel</button><button class="we-btn we-btn-primary we-memory-save-big" data-new="${isNew ? 'true' : 'false'}" type="button">Save</button></div>
    </div>`;
    const draft = _memoryEditingBig === '__new__'
      ? `<div class="we-memory-record we-memory-record-new" data-big-id="__new__">${editor({ startLayer: 0, endLayer: 0, content: '' }, true)}</div>` : '';
    const cards = items.map((big, index) => {
      const collapseKey = `big:${big.id}`;
      const defaultCollapsed = index !== items.length - 1;
      return `<div class="${memoryRecordClass(collapseKey, 'we-memory-overview-record', defaultCollapsed)}" data-big-id="${h(big.id)}">
      <div class="we-memory-record-head" data-memory-collapse-key="${h(collapseKey)}" role="button" tabindex="0"><div><div class="we-memory-record-title">Overview ${index + 1}</div><div class="we-memory-record-meta">Messages ${h(String(big.startLayer))}–${h(String(big.endLayer))} · ${h(big.id)}</div></div>
        <div class="we-memory-record-actions">${memoryRecordToggle(collapseKey, defaultCollapsed)}<button class="we-icon-btn we-memory-edit-big" type="button" title="Edit"><i class="fa-solid fa-pen"></i></button><button class="we-icon-btn we-memory-delete-big" type="button" title="Delete"><i class="fa-solid fa-trash"></i></button></div>
      </div>
      ${memoryRecordBody(collapseKey, _memoryEditingBig === big.id ? editor(big, false) : `<div class="we-memory-summary-text">${h(big.content || '(empty)')}</div>`, defaultCollapsed)}
    </div>`;
    }).join('');
    const countHint = items.length > 1 ? `<div class="we-hint">${items.length} overviews in total; the latest is expanded by default.</div>` : '';
    return `<div class="we-memory-page-actions"><button class="we-btn we-btn-primary" id="we-memory-add-big" type="button"><i class="fa-solid fa-plus"></i> New overview</button></div>${countHint}${draft}${cards || '<div class="we-empty">No overviews generated yet; you can add one by hand.</div>'}`;
  }

  function renderMemorySubView(view) {
    const scope = String(window.WORLD_ENGINE_CORE?.getChatId?.() || 'default');
    if (_memoryCollapseScope !== scope) {
      _memoryCollapseScope = scope;
      _memoryCollapsedRecords.clear();
      _memorySeenRecords.clear();
    }
    const state = window.MEMORY_ENGINE_DATA?.loadState?.() || {};
    const meta = MEMORY_VIEW_META[view] || { title: view, poem: '' };
    const content = view === 'people' ? renderMemoryPeople(state)
      : view === 'entities' ? renderMemoryEntities(state)
      : view === 'minutes' ? renderMemoryMinutes(state)
      : renderMemoryOverview(state);
    return `<div class="we-sub-topbar"><button class="we-icon-btn" id="we-memory-btn-back" type="button" title="Back"><i class="fa-solid fa-arrow-left"></i></button><span class="we-sub-title">${meta.title}</span><span class="we-memory-sub-poem">${meta.poem}</span></div><div class="we-memory-subview">${content}</div>`;
  }

  function clearMemoryEditing() {
    _memoryEditingPerson = null;
    _memoryEditingEntity = null;
    _memoryEditingSmall = null;
    _memoryEditingBig = null;
  }

  function nextMemoryUiId(items, prefix) {
    const pattern = new RegExp(`^${prefix}_(\\d+)$`);
    const max = (items || []).reduce((number, item) => {
      const match = pattern.exec(String(item?.id || ''));
      return Math.max(number, match ? Number(match[1]) : 0);
    }, 0);
    return `${prefix}_${String(max + 1).padStart(6, '0')}`;
  }

  function saveEditedMemoryState(state, message, afterRepair) {
    if (window.MEMORY_ENGINE?.isRunning?.()) {
      showToast('A memory task is running; data cannot be changed right now', true);
      return false;
    }
    const previousState = window.MEMORY_ENGINE_DATA?.loadState?.();
    window.MEMORY_ENGINE?.repairStateIndexes?.(state, previousState);
    if (typeof afterRepair === 'function') afterRepair(state);
    window.MEMORY_ENGINE?.commitManualState?.(state, previousState);
    window.MEMORY_ENGINE_DATA?.saveState?.(state);
    window.WORLD_ENGINE_CHATCACHE?.forScope?.('memory')?.afterEvolution?.();
    window.MEMORY_ENGINE?.applyInjection?.();
    showToast(message || 'Memory data saved');
    return true;
  }

  function readMemoryEntryRows(editor) {
    return Array.from(editor?.querySelectorAll?.('[data-memory-entry-row]') || []).map(row => ({
      time: String(row.querySelector('.we-memory-entry-time')?.value || '').trim(),
      content: String(row.querySelector('.we-memory-entry-content')?.value || '').trim(),
      known_by: Array.from(new Set(String(row.querySelector('.we-memory-entry-known-by')?.value || '')
        .split(/[\/／,，\n]/).map(value => value.trim()).filter(Boolean)))
    })).filter(entry => entry.content);
  }

  function bindMemoryView() {
    const back = document.getElementById('we-memory-btn-back');
    if (back) back.onclick = () => { clearMemoryEditing(); _memoryView = 'home'; _memorySelectedNavView = null; refresh(); };
    const settingsBack = document.getElementById('we-memory-settings-back');
    if (settingsBack) settingsBack.onclick = () => { _memorySettingsOpen = false; clearMemoryEditing(); refresh(); };

    document.querySelectorAll('.we-memory-nav-row[data-memory-view]').forEach(row => {
      row.onclick = () => {
        const view = row.dataset.memoryView;
        if (_memorySelectedNavView === view) {
          _memorySelectedNavView = null;
          _memoryView = view;
        } else {
          _memorySelectedNavView = view;
        }
        refresh();
      };
    });

    const toggleMemoryRecord = (key, card) => {
      if (!key || !card) return;
      const body = card.querySelector(':scope > .we-memory-record-body');
      const button = card.querySelector(':scope > .we-memory-record-head .we-memory-toggle-record');
      const collapse = !_memoryCollapsedRecords.has(key);
      if (collapse) _memoryCollapsedRecords.add(key); else _memoryCollapsedRecords.delete(key);
      card.classList.toggle('is-collapsed', collapse);
      if (body) body.hidden = collapse;
      if (button) {
        button.title = collapse ? 'Expand' : 'Collapse';
        button.setAttribute('aria-expanded', collapse ? 'false' : 'true');
        const icon = button.querySelector('i');
        if (icon) icon.className = `fa-solid fa-chevron-${collapse ? 'right' : 'down'}`;
      }
    };
    document.querySelectorAll('.we-memory-toggle-record').forEach(button => {
      button.onclick = event => {
        event.stopPropagation();
        toggleMemoryRecord(button.dataset.memoryCollapseKey, button.closest('.we-memory-record'));
      };
    });
    document.querySelectorAll('.we-memory-record-head[data-memory-collapse-key]').forEach(head => {
      const activate = event => {
        if (event.target.closest('button, input, textarea, select, a')) return;
        toggleMemoryRecord(head.dataset.memoryCollapseKey, head.closest('.we-memory-record'));
      };
      head.onclick = activate;
      head.onkeydown = event => {
        if (event.key !== 'Enter' && event.key !== ' ') return;
        event.preventDefault();
        activate(event);
      };
    });

    const addPerson = document.getElementById('we-memory-add-person');
    if (addPerson) addPerson.onclick = () => { clearMemoryEditing(); _memoryEditingPerson = '__new__'; refresh(); };
    document.querySelectorAll('.we-memory-edit-person').forEach(button => {
      button.onclick = () => {
        const id = button.closest('[data-person-id]')?.dataset.personId || null;
        if (id) expandMemoryRecord(`person:${id}`);
        clearMemoryEditing(); _memoryEditingPerson = id; refresh();
      };
    });
    document.querySelectorAll('.we-memory-delete-person').forEach(button => {
      button.onclick = () => {
        const id = button.closest('[data-person-id]')?.dataset.personId;
        const state = window.MEMORY_ENGINE_DATA?.loadState?.();
        const person = state?.personal_memory?.find(item => item.id === id);
        if (!person || !confirm(`Delete character "${person.names?.[0] || id}" and all their memories?`)) return;
        state.personal_memory = state.personal_memory.filter(item => item.id !== id);
        if (saveEditedMemoryState(state, 'Character deleted')) { clearMemoryEditing(); refresh(); }
      };
    });
    document.querySelectorAll('.we-memory-save-person').forEach(button => {
      button.onclick = () => {
        const editor = button.closest('[data-person-editor]');
        const state = window.MEMORY_ENGINE_DATA?.loadState?.();
        if (!editor || !state) return;
        const names = Array.from(new Set(String(editor.querySelector('.we-memory-person-names')?.value || '')
          .split(/[\/／,，\n]/).map(value => value.trim()).filter(Boolean)));
        if (!names.length) { showToast('A character needs at least one name', true); return; }
        const id = editor.dataset.new === 'true'
          ? nextMemoryUiId(state.personal_memory, 'char') : editor.dataset.personId;
        const duplicated = state.personal_memory.some(item => item.id !== id && (item.names || []).some(name =>
          names.some(candidate => candidate.toLocaleLowerCase() === String(name).trim().toLocaleLowerCase())
        ));
        if (duplicated) { showToast('That name or alias is already used by another character', true); return; }
        const entries = readMemoryEntryRows(editor);
        if (entries.some(entry => Array.from(entry.content).length > 300)) { showToast('A single character memory cannot exceed 300 characters', true); return; }
        const memory = {};
        for (const entry of entries) {
          if (!Array.isArray(memory[entry.time])) memory[entry.time] = [];
          if (!memory[entry.time].includes(entry.content)) memory[entry.time].push(entry.content);
        }
        const person = { id, names, memory };
        const index = state.personal_memory.findIndex(item => item.id === id);
        if (index >= 0) state.personal_memory[index] = person; else state.personal_memory.push(person);
        if (saveEditedMemoryState(state, 'Character memories saved', repaired =>
          window.MEMORY_ENGINE?.replaceKnownByRecords?.(repaired, id, entries.map(entry => ({
            time: entry.time, memory: entry.content, known_by: entry.known_by
          })))
        )) { clearMemoryEditing(); refresh(); }
      };
    });

    const addEntity = document.getElementById('we-memory-add-entity');
    if (addEntity) addEntity.onclick = () => { clearMemoryEditing(); _memoryEditingEntity = '__new__'; refresh(); };
    document.querySelectorAll('.we-memory-edit-entity').forEach(button => {
      button.onclick = () => {
        const card = button.closest('[data-entity-id]');
        const key = card ? `${card.dataset.entityType}:${card.dataset.entityId}` : null;
        if (key) {
          expandMemoryRecord(`entity-category:${card.dataset.entityType}`);
          expandMemoryRecord(`entity:${key}`);
        }
        clearMemoryEditing();
        _memoryEditingEntity = key;
        refresh();
      };
    });
    document.querySelectorAll('.we-memory-delete-entity').forEach(button => {
      button.onclick = () => {
        const card = button.closest('[data-entity-id]'), type = card?.dataset.entityType, id = card?.dataset.entityId;
        const state = window.MEMORY_ENGINE_DATA?.loadState?.();
        const entity = state?.entity_memory?.[type]?.find(item => item.id === id);
        if (!entity || !confirm(`Delete ${MEMORY_ENTITY_LABELS[type] || 'Entities'} "${entity.name || id}" and its whole history?`)) return;
        state.entity_memory[type] = state.entity_memory[type].filter(item => item.id !== id);
        if (saveEditedMemoryState(state, 'Entity deleted')) { clearMemoryEditing(); refresh(); }
      };
    });
    document.querySelectorAll('.we-memory-save-entity').forEach(button => {
      button.onclick = () => {
        const editor = button.closest('[data-entity-editor]');
        const state = window.MEMORY_ENGINE_DATA?.loadState?.();
        if (!editor || !state) return;
        const oldType = editor.dataset.originalType;
        const type = editor.querySelector('.we-memory-entity-type')?.value;
        const name = String(editor.querySelector('.we-memory-entity-name')?.value || '').trim();
        const aliases = Array.from(new Set(String(editor.querySelector('.we-memory-entity-aliases')?.value || '')
          .split(/[\/／,，\n]/).map(value => value.trim()).filter(Boolean)))
          .filter(alias => alias.toLocaleLowerCase() !== name.toLocaleLowerCase());
        if (!MEMORY_ENTITY_LABELS[type] || !name) { showToast('Choose a type and enter an entity name', true); return; }
        const oldId = editor.dataset.entityId;
        const incomingNames = [name, ...aliases].map(value => value.toLocaleLowerCase());
        const duplicate = (state.entity_memory?.[type] || []).some(item => item.id !== oldId
          && [item.name, ...(item.aliases || [])].some(existing => incomingNames.includes(String(existing || '').trim().toLocaleLowerCase())));
        if (duplicate) { showToast('That name or alias is already used by another entity of the same type', true); return; }
        const prefix = { organization: 'org', object: 'obj', ability: 'ability', location: 'location' }[type];
        let id = oldId;
        if (editor.dataset.new === 'true' || oldType !== type) id = nextMemoryUiId(state.entity_memory?.[type], prefix);
        const entity = {
          id, name, aliases,
          description: String(editor.querySelector('.we-memory-entity-description')?.value || '').trim(),
          history: readMemoryEntryRows(editor).map(entry => ({ time: entry.time, event: entry.content }))
        };
        if (editor.dataset.new !== 'true') state.entity_memory[oldType] = state.entity_memory[oldType].filter(item => item.id !== oldId);
        state.entity_memory[type].push(entity);
        if (saveEditedMemoryState(state, 'Entity memory saved')) { clearMemoryEditing(); refresh(); }
      };
    });

    document.querySelectorAll('.we-memory-add-entry').forEach(button => {
      button.onclick = () => {
        const editor = button.closest('.we-memory-editor');
        const list = editor?.querySelector('.we-memory-entry-list');
        if (!list) return;
        list.querySelector('.we-memory-entry-empty')?.remove();
        list.insertAdjacentHTML('beforeend', renderMemoryEntryRow('', '', button.dataset.entryKind));
        bindMemoryEntryRemoveButtons(list);
      };
    });
    bindMemoryEntryRemoveButtons(panelBodyElement);
    document.querySelectorAll('.we-memory-cancel-edit').forEach(button => {
      button.onclick = () => { clearMemoryEditing(); refresh(); };
    });

    const addSmall = document.getElementById('we-memory-add-small');
    if (addSmall) addSmall.onclick = () => { clearMemoryEditing(); _memoryEditingSmall = '__new__'; refresh(); };
    document.querySelectorAll('.we-memory-edit-small').forEach(button => {
      button.onclick = () => {
        const id = button.closest('[data-small-id]')?.dataset.smallId || null;
        if (id) expandMemoryRecord(`small:${id}`);
        clearMemoryEditing(); _memoryEditingSmall = id; refresh();
      };
    });
    document.querySelectorAll('.we-memory-delete-small').forEach(button => {
      button.onclick = () => {
        const id = button.closest('[data-small-id]')?.dataset.smallId;
        const state = window.MEMORY_ENGINE_DATA?.loadState?.(), items = state?.event_memory?.small_summaries || [];
        const index = items.findIndex(item => item.id === id);
        if (index < 0 || !confirm(`Delete this note?${index < (parseInt(state.event_memory.big_summary_cursor) || 0) ? ' It has been filed into an overview; the existing overview text will not update automatically.' : ''}`)) return;
        items.splice(index, 1);
        if (index < (parseInt(state.event_memory.big_summary_cursor) || 0)) state.event_memory.big_summary_cursor--;
        if (saveEditedMemoryState(state, 'Note deleted')) { clearMemoryEditing(); refresh(); }
      };
    });
    document.querySelectorAll('.we-memory-save-small').forEach(button => {
      button.onclick = () => {
        const card = button.closest('[data-small-id]'), id = card?.dataset.smallId;
        const content = String(card?.querySelector('.we-memory-small-content')?.value || '').trim();
        const startLayer = Math.max(0, parseInt(card?.querySelector('.we-memory-small-start')?.value) || 0);
        const endLayer = Math.max(startLayer, parseInt(card?.querySelector('.we-memory-small-end')?.value) || startLayer);
        if (!content) { showToast('Note content cannot be empty', true); return; }
        const state = window.MEMORY_ENGINE_DATA?.loadState?.(), items = state?.event_memory?.small_summaries || [];
        if (button.dataset.new === 'true') {
          items.push({ id: nextMemoryUiId(items, 'small'), startLayer, endLayer, content });
          if (saveEditedMemoryState(state, 'Note added')) { clearMemoryEditing(); refresh(); }
          return;
        }
        const index = items.findIndex(item => item.id === id);
        if (index < 0) return;
        items[index] = { ...items[index], startLayer, endLayer, content };
        if (saveEditedMemoryState(state, 'Note updated')) { clearMemoryEditing(); refresh(); }
      };
    });
    const addBig = document.getElementById('we-memory-add-big');
    if (addBig) addBig.onclick = () => { clearMemoryEditing(); _memoryEditingBig = '__new__'; refresh(); };
    document.querySelectorAll('.we-memory-edit-big').forEach(button => {
      button.onclick = () => {
        const id = button.closest('[data-big-id]')?.dataset.bigId || null;
        if (id) expandMemoryRecord(`big:${id}`);
        clearMemoryEditing(); _memoryEditingBig = id; refresh();
      };
    });
    document.querySelectorAll('.we-memory-delete-big').forEach(button => {
      button.onclick = () => {
        const id = button.closest('[data-big-id]')?.dataset.bigId;
        const state = window.MEMORY_ENGINE_DATA?.loadState?.(), items = state?.event_memory?.big_summaries || [];
        const index = items.findIndex(item => item.id === id);
        if (index < 0 || !confirm('Delete this overview? Its notes will stay "filed", and the system will not regenerate it automatically.')) return;
        items.splice(index, 1);
        if (saveEditedMemoryState(state, 'Overview deleted')) { clearMemoryEditing(); refresh(); }
      };
    });
    document.querySelectorAll('.we-memory-save-big').forEach(button => {
      button.onclick = () => {
        const card = button.closest('[data-big-id]'), id = card?.dataset.bigId;
        const content = String(card?.querySelector('.we-memory-big-content')?.value || '').trim();
        const startLayer = Math.max(0, parseInt(card?.querySelector('.we-memory-big-start')?.value) || 0);
        const endLayer = Math.max(startLayer, parseInt(card?.querySelector('.we-memory-big-end')?.value) || startLayer);
        if (!content) { showToast('Overview content cannot be empty', true); return; }
        const state = window.MEMORY_ENGINE_DATA?.loadState?.();
        const items = state?.event_memory?.big_summaries || [];
        if (button.dataset.new === 'true') {
          items.push({ id: nextMemoryUiId(items, 'big'), startLayer, endLayer, content });
          if (saveEditedMemoryState(state, 'Overview added')) { clearMemoryEditing(); refresh(); }
          return;
        }
        const item = state?.event_memory?.big_summaries?.find(big => big.id === id);
        if (!item) return;
        Object.assign(item, { startLayer, endLayer, content });
        if (saveEditedMemoryState(state, 'Overview updated')) { clearMemoryEditing(); refresh(); }
      };
    });
  }

  function bindMemoryEntryRemoveButtons(root) {
    root?.querySelectorAll?.('.we-memory-remove-entry').forEach(button => {
      button.onclick = () => button.closest('[data-memory-entry-row]')?.remove();
    });
  }

  const MEMORY_SETTINGS_TABS = [
    { key: 'common', label: 'Common' },
    { key: 'link', label: 'Linking' },
    { key: 'advanced', label: 'Advanced' },
    { key: 'mechanics', label: 'Local mechanics' },
    { key: 'archive', label: 'Saves' },
    { key: 'worldbook', label: 'World Info' },
    { key: 'debug', label: 'Debug' },
    { key: 'about', label: 'About' }
  ];

  function renderMemoryDebug() {
    const engine = window.MEMORY_ENGINE;
    const dbg = engine?.getLastDebug?.() || null;
    const sentPrompt = typeof dbg?.prompt === 'string' ? dbg.prompt
      : (typeof dbg?.requestPrompt === 'string' ? dbg.requestPrompt : '');
    const apiResult = typeof dbg?.rawResult === 'string' ? dbg.rawResult
      : (typeof dbg?.apiResponse === 'string' ? dbg.apiResponse
        : (typeof dbg?.response === 'string' ? dbg.response : ''));
    const card = (title, meta, content, emptyText) => {
      const hasContent = content !== null && content !== undefined && content !== '';
      const shown = typeof content === 'string' ? content : (hasContent ? JSON.stringify(content, null, 2) : '');
      return '<div class="we-prompt-seg-card">'
        + '<div class="we-prompt-seg-head" data-we-seg-toggle>'
        + '<span class="we-prompt-seg-arrow">▶</span>'
        + '<span class="we-prompt-seg-label">' + h(title) + '</span>'
        + '<span class="we-prompt-seg-meta">' + h(meta || (hasContent ? shown.length + ' chars' : 'None yet')) + '</span>'
        + '</div>'
        + '<div class="we-prompt-seg-body" style="display:none;">'
        + (hasContent ? '<pre class="we-prompt-seg-pre">' + h(shown) + '</pre>' : '<div class="we-prompt-seg-empty">' + h(emptyText) + '</div>')
        + '</div></div>';
    };
    return '<div class="we-prompt-debug">'
      + '<div class="we-prompt-debug-summary">Only the most recent actual run is shown; the built-in memory prompts are not shown in settings and cannot be edited.</div>'
      + renderInjectInspector('memory')
      + card('Actual prompt sent to the memory background API', sentPrompt ? sentPrompt.length + ' chars' : 'None yet', sentPrompt, 'After running character/entity and note extraction or generating an overview, shows the full prompt that was actually sent.')
      + card('Raw response from the memory background API', apiResult ? apiResult.length + ' chars' : 'None yet', apiResult, 'After running memory extraction, shows the background API\'s raw response.')
      + '<div style="display:flex;gap:6px;margin-top:8px;"><button class="we-btn" id="we-memory-export-prompt" style="flex:1;">Export full prompt</button><button class="we-btn" id="we-memory-export-raw-result" style="flex:1;">Export API response</button></div>'
      + '</div>';
  }

  function renderMemoryCheckpointSection() {
    const data = window.MEMORY_ENGINE_DATA;
    const checkpoint = data?.loadCheckpoint?.() || null;
    const count = Array.isArray(checkpoint?.personal_memory) ? checkpoint.personal_memory.length : 0;
    const entityCount = ['organization', 'object', 'ability', 'location']
      .reduce((sum, type) => sum + (Array.isArray(checkpoint?.entity_memory?.[type]) ? checkpoint.entity_memory[type].length : 0), 0);
    const smallSummaryCount = Array.isArray(checkpoint?.event_memory?.small_summaries)
      ? checkpoint.event_memory.small_summaries.length : 0;
    const bigSummaries = Array.isArray(checkpoint?.event_memory?.big_summaries) ? checkpoint.event_memory.big_summaries : [];
    const bigSummaryContent = bigSummaries.length
      ? '<div class="we-chatcache-list">' + bigSummaries.map(item =>
          '<div class="we-prompt-seg-card"><div class="we-prompt-seg-head"><span class="we-prompt-seg-label">Messages '
          + h(item.startLayer) + '-' + h(item.endLayer) + '</span></div><div class="we-prompt-seg-body" style="display:block;"><pre class="we-prompt-seg-pre">'
          + h(item.content) + '</pre></div></div>'
        ).join('') + '</div>'
      : '<div class="we-empty">No overviews yet</div>';
    const smallSummaryContent = smallSummaryCount
      ? '<div class="we-chatcache-list">' + checkpoint.event_memory.small_summaries.map(item =>
          '<div class="we-prompt-seg-card"><div class="we-prompt-seg-head"><span class="we-prompt-seg-label">Messages '
          + h(item.startLayer) + '-' + h(item.endLayer) + '</span></div><div class="we-prompt-seg-body" style="display:block;"><pre class="we-prompt-seg-pre">'
          + h(item.content) + '</pre></div></div>'
        ).join('') + '</div>'
      : '<div class="we-empty">No notes yet</div>';
    const content = checkpoint
      ? '<div class="we-hint">Includes ' + count + ' characters, ' + entityCount + ' world entities, ' + smallSummaryCount + ' notes and ' + bigSummaries.length + ' overviews</div>'
        + '<div class="we-section" style="margin-top:10px;"><div class="we-section-title">' + sectionHeader('Overview · ' + bigSummaries.length + ' items', 'memory-checkpoint-big-summary') + '</div>' + sectionBody('memory-checkpoint-big-summary', bigSummaryContent) + '</div>'
        + '<div class="we-section" style="margin-top:10px;"><div class="we-section-title">' + sectionHeader('Notes · ' + smallSummaryCount + ' items', 'memory-checkpoint-small-summaries') + '</div>' + sectionBody('memory-checkpoint-small-summaries', smallSummaryContent) + '</div>'
        + '<div class="we-section" style="margin-top:10px;"><div class="we-section-title">' + sectionHeader('Full JSON', 'memory-checkpoint-json') + '</div>' + sectionBody('memory-checkpoint-json', '<pre class="we-prompt-seg-pre">' + h(JSON.stringify(checkpoint, null, 2)) + '</pre>') + '</div>'
      : '<div class="we-empty">No checkpoint yet</div>';
    return '<div class="we-section" style="margin-top:16px;"><div class="we-section-title">'
      + sectionHeader(checkpoint ? 'Checkpoint - round ' + count + ' characters / ' + entityCount + ' entities' : 'Checkpoint', 'memory-checkpoint-section')
      + '</div>' + sectionBody('memory-checkpoint-section', content) + '</div>';
  }

  function renderMemorySnapshotRows() {
    const list = window.WORLD_ENGINE_CHATCACHE?.forScope?.('memory')?.listSnapshots?.() || [];
    if (!list.length) return '<div class="we-empty">No memory saves yet</div>';
    return list.map(item => {
      let time = '';
      try { time = new Date(item.createdAt).toLocaleString(); } catch (error) {}
      const count = Number(item.characters) || 0;
      const entityCount = Number(item.entities) || 0;
      return '<div class="we-snapshot-row" data-memory-snap-id="' + u(item.id) + '">'
        + '<div class="we-snapshot-main"><div class="we-snapshot-name"><span class="we-snapshot-badge' + (item.auto ? ' is-auto' : '') + '">' + (item.auto ? 'Auto' : 'Manual') + '</span>' + h(item.name) + '</div>'
        + '<div class="we-snapshot-meta">Round ' + (item.round || 0) + ' · ' + count + ' characters · ' + entityCount + ' entities' + (time ? ' · ' + h(time) : '') + '</div></div>'
        + '<div class="we-snapshot-actions">'
        + '<button class="we-icon-btn" data-memory-snap-action="restore" title="Restore"><i class="fa-solid fa-rotate-left"></i></button>'
        + '<button class="we-icon-btn" data-memory-snap-action="rename" title="Rename"><i class="fa-solid fa-pen"></i></button>'
        + '<button class="we-icon-btn" data-memory-snap-action="export" title="Export"><i class="fa-solid fa-download"></i></button>'
        + '<button class="we-icon-btn" data-memory-snap-action="delete" title="Delete"><i class="fa-solid fa-trash"></i></button>'
        + '</div></div>';
    }).join('');
  }

  function bindFilterControls(scope) {
    const memoryScope = scope === 'memory';
    const id = suffix => memoryScope ? 'we-memory-' + suffix : 'we-' + suffix;
    const textarea = document.getElementById(id('filter-regex'));
    if (!textarea) return;
    const tagsBox = document.getElementById(id('filter-tags'));
    const addInput = document.getElementById(id('filter-add-input'));
    const SIMPLE = /^<([a-zA-Z_][\w-]*)>[\s\S]*?<\/\1>(?:\\n\?)?$/;
    const SCAN = /<([a-zA-Z_][\w-]*)/g;
    let tags = [];

    function parse(raw) {
      const selected = [], advanced = [];
      for (const line of String(raw || '').split('\n')) {
        const match = line.match(SIMPLE);
        if (match) { if (!selected.includes(match[1])) selected.push(match[1]); }
        else if (line.trim()) advanced.push(line);
      }
      return { selected, advanced };
    }
    function syncTextarea() {
      const advanced = parse(textarea.value).advanced;
      const generated = tags.filter(item => item.checked).map(item => `<${item.name}>[\\s\\S]*?</${item.name}>\\n?`);
      textarea.value = generated.concat(advanced).join('\n');
    }
    function renderTags() {
      if (!tagsBox) return;
      tagsBox.innerHTML = '';
      for (const item of tags) {
        const chip = document.createElement('label');
        chip.style.cssText = 'display:inline-flex;align-items:center;gap:3px;padding:2px 6px;border:1px solid var(--we-border,#3a3a3a);border-radius:3px;font-size:12px;cursor:pointer;';
        const checkbox = document.createElement('input');
        checkbox.type = 'checkbox'; checkbox.checked = item.checked;
        checkbox.onchange = () => { item.checked = checkbox.checked; syncTextarea(); };
        const name = document.createElement('span'); name.textContent = item.name;
        const remove = document.createElement('span');
        remove.textContent = '✕'; remove.style.cssText = 'color:var(--we-text3);cursor:pointer;margin-left:2px;';
        remove.onclick = event => { event.preventDefault(); tags = tags.filter(entry => entry.name !== item.name); renderTags(); syncTextarea(); };
        chip.append(checkbox, name, remove); tagsBox.appendChild(chip);
      }
    }
    function syncTags() {
      const selected = parse(textarea.value).selected;
      const set = new Set(selected);
      tags.forEach(item => { item.checked = set.has(item.name); });
      selected.forEach(name => { if (!tags.some(item => item.name === name)) tags.push({ name, checked: true }); });
      renderTags();
    }
    function addTag(name) {
      name = String(name || '').trim();
      if (!name) return;
      if (!/^[a-zA-Z_][\w-]*$/.test(name)) { showToast('Invalid tag name (only letters, digits, underscores and hyphens)', true); return; }
      if (!tags.some(item => item.name === name)) tags.push({ name, checked: true });
      if (addInput) addInput.value = '';
      renderTags(); syncTextarea();
    }
    document.getElementById(id('btn-filter-add'))?.addEventListener('click', () => addTag(addInput?.value));
    addInput?.addEventListener('keydown', event => { if (event.key === 'Enter') { event.preventDefault(); addTag(addInput.value); } });
    document.getElementById(id('btn-filter-scan'))?.addEventListener('click', () => {
      let text = '';
      try {
        const chat = SillyTavern.getContext()?.chat || [];
        for (let i = chat.length - 1; i >= 0; i--) if (chat[i] && !chat[i].is_user && String(chat[i].mes || '').trim()) { text = String(chat[i].mes); break; }
      } catch (error) {}
      if (!text) { showToast('No AI reply found', true); return; }
      const found = []; let match; SCAN.lastIndex = 0;
      while ((match = SCAN.exec(text)) !== null) if (!found.includes(match[1])) found.push(match[1]);
      if (!found.length) { showToast('No tags found in the latest AI reply', true); return; }
      found.forEach(name => { if (!tags.some(item => item.name === name)) tags.push({ name, checked: true }); });
      renderTags(); syncTextarea(); showToast(`Found ${found.length} tags`);
    });
    document.getElementById(id('btn-filter-test'))?.addEventListener('click', () => {
      const core = window.WORLD_ENGINE_CORE;
      const status = document.getElementById(id('filter-status'));
      if (!textarea.value.trim()) { showToast('No regex entered', true); if (status) status.textContent = '(no regex entered)'; return; }
      const validated = core?.validateFilterRegex?.(textarea.value);
      if (!validated) { showToast('core module unavailable', true); return; }
      if (validated.bad.length) {
        if (status) status.textContent = `Test aborted — ⚠️ ${validated.ok} working / ${validated.bad.length} failed:
` + validated.bad.map(item => `Line ${item.line} "${item.raw}" is invalid: ${item.reason}`).join('\n');
        showToast(`${validated.bad.length} regexes are invalid; fix them first`, true); return;
      }
      let sample = '';
      try {
        const chat = SillyTavern.getContext()?.chat || [];
        for (let i = chat.length - 1; i >= 0; i--) if (String(chat[i]?.mes || '').trim()) { sample = String(chat[i].mes); break; }
      } catch (error) {}
      if (!sample) { showToast('The current chat has no text to test', true); return; }
      let work = sample, removed = 0;
      for (const entry of validated.entries) {
        const regex = new RegExp(entry.pattern, entry.flags); let match, count = 0;
        while ((match = regex.exec(work)) !== null) { count++; if (match.index === regex.lastIndex) regex.lastIndex++; }
        work = work.replace(regex, ''); removed += count;
      }
      if (status) status.textContent = `Removed ${removed} matches.
Before: ${sample.slice(0, 60)}${sample.length > 60 ? '…' : ''}
After: ${work.slice(0, 60)}${work.length > 60 ? '…' : ''}`;
      showToast(`Removed ${removed} matches`);
    });
    let timer;
    textarea.addEventListener('input', () => { clearTimeout(timer); timer = setTimeout(syncTags, 300); });
    syncTags();
  }

  function renderMemorySettingsView() {
    const settings = window.MEMORY_ENGINE_SETTINGS?.getSettings(true) || {};
    const extra = renderSettingsAfterCheckpoint({ scope: 'memory' });
    const sec = (id, title, body) =>
      '<div class="we-section"><div class="we-section-title">' + sectionHeader(title, id) + '</div>'
      + sectionBody(id, body) + '</div>';
    const mode = settings.evolveMode === 'manual' ? 'manual' : 'auto';
    const bigSummaryEveryX = Math.max(1, parseInt(settings.bigSummaryEveryX) || 5);
    const bigSummaryInjectLimit = Math.max(1, parseInt(settings.bigSummaryInjectLimit) || 3);
    const hideCoveredRawText = settings.hideCoveredRawText !== false;
    const recentRawRounds = Math.max(0, parseInt(settings.recentRawRounds) || 0);
    const referenceRawRounds = Math.max(0, parseInt(settings.referenceRawRounds) || 0);
    const referenceSmallSummaryCount = Math.max(0, parseInt(settings.referenceSmallSummaryCount) || 0);
    const referenceBigSummaryCount = Math.max(0, parseInt(settings.referenceBigSummaryCount) || 0);
    const worldEngineMemoryLimit = Math.max(1, parseInt(settings.worldEngineMemoryLimit) || 5);
    const searchDepth = Math.max(1, parseInt(settings.searchDepth) || 5);
    const maxPerCharacter = Math.max(1, parseInt(settings.maxPerCharacter) || 20);
    const backfillBatch = Math.max(1, parseInt(settings.backfillBatchSize) || 5);
    const backfillEnd = Math.max(0, parseInt(settings.backfillEndLayer) || 0);
    const backfillRetries = Math.max(0, parseInt(settings.backfillRetries) || 0);
    const summaryBackfillSmallEveryX = Math.max(1, parseInt(settings.summaryBackfillSmallEveryX) || 5);
    const summaryBackfillBigEveryX = Math.max(1, parseInt(settings.summaryBackfillBigEveryX) || 5);
    const apiTemperature = Number.isFinite(Number(settings.temperature)) ? Math.max(0, Number(settings.temperature)) : 0.2;
    const apiMaxTokens = Math.max(1, parseInt(settings.maxTokens) || 65000);
    const apiTimeoutSec = Math.max(0, Math.round((Number(settings.apiTimeoutMs) || 120000) / 1000));

    const apiBody = `
      <div class="we-input-group">
        <label>Connection</label>
        <select id="we-connection-mode" style="width:100%;">
          <option value="direct" ${settings.connectionMode !== 'proxy' ? 'selected' : ''}>Direct (default)</option>
          <option value="proxy" ${settings.connectionMode === 'proxy' ? 'selected' : ''}>Through the SillyTavern proxy (fixes CORS)</option>
        </select>
      </div>
      <div class="we-input-group">
        <label>Memory Engine API URL (OpenAI-compatible)</label>
        <input type="text" id="we-api-url" value="${u(settings.apiUrl || '')}" placeholder="https://api.openai.com/v1">
      </div>
      <div class="we-input-group">
        <label>Memory Engine API key</label>
        <input type="password" id="we-api-key" value="${u(settings.apiKey || '')}">
      </div>
      <div class="we-input-group" style="display:flex;gap:6px;align-items:end;">
        <div style="flex:1;">
          <label>Model</label>
          <input type="text" id="we-model" value="${u(settings.model || 'gpt-3.5-turbo')}" placeholder="Model name" style="width:100%;">
        </div>
        <button class="we-btn" id="we-fetch-models" style="white-space:nowrap;flex-shrink:0;">Fetch list</button>
      </div>
      <div class="we-input-group">
        <select id="we-model-list" style="display:none;width:100%;margin-top:4px;"><option value="">-- Choose a model --</option></select>
      </div>
      <div class="we-input-group" style="display:flex;gap:6px;">
        <div style="flex:1;"><label>Temperature</label><input type="number" id="we-temperature" min="0" step="0.1" value="${apiTemperature}" style="width:100%;"></div>
        <div style="flex:1;"><label>Max output tokens</label><input type="number" id="we-max-tokens" min="1" step="1" value="${apiMaxTokens}" style="width:100%;"></div>
      </div>
      <div class="we-input-group">
        <label>Request timeout (seconds)</label>
        <input type="number" id="we-api-timeout-sec" min="0" step="1" value="${apiTimeoutSec}" style="width:100%;">
        <div style="font-size:11px;color:var(--we-text3);margin-top:3px;">This only configures the Memory Engine; the request code is shared with the World Engine, but neither overrides the other's settings.</div>
      </div>`;

    const modeBody = `
      <div class="we-input-group">
        <label style="display:flex;align-items:center;gap:8px;cursor:pointer;">
          <input type="checkbox" id="we-memory-engine-enabled" ${settings.engineEnabled !== false ? 'checked' : ''}>
          Enable Memory Engine
        </label>
        <div style="font-size:11px;color:var(--we-text3);margin-top:3px;">When off, memory extraction and injection stop; the World Engine is not affected.</div>
      </div>
      <div class="we-input-group">
        <label style="display:flex;align-items:center;gap:8px;cursor:pointer;">
          <input type="checkbox" id="we-memory-first-layer-ai-opening" ${settings.firstLayerIsAiOpening !== false ? 'checked' : ''}>
          First message is the AI greeting
        </label>
        <div style="font-size:11px;color:var(--we-text3);margin-top:3px;">On by default: message 0 is left out of character/entity extraction, notes and batch refills; when off, message 0 is processed like normal conversation.</div>
      </div>
      <div class="we-input-group">
        <label>Memory evolution mode</label>
        <select id="we-memory-evolve-mode" style="width:100%;">
          <option value="auto" ${mode === 'auto' ? 'selected' : ''}>Auto · extract every round</option>
          <option value="manual" ${mode === 'manual' ? 'selected' : ''}>Manual (memory evolution only when triggered by hand)</option>
        </select>
      </div>
      <div style="font-size:11px;color:var(--we-text3);margin-bottom:8px;">Characters, entities and notes are always processed one round at a time and combined into one API request. Rerolls do not count as new rounds.</div>
      <div class="we-input-group">
        <label>Overview filing</label>
        <div style="font-size:11px;color:var(--we-text3);margin-top:3px;">Each round generates one note aiming for 40–150 words; every X unfiled notes generate an overview on their own. An overview aims for at least 350 words and at most half the word count of this batch of notes; if that half is under 350, both limits are 350 words. Text over the target is still saved in full, and past overviews are never overwritten.</div>
      </div>
      <div class="we-input-group">
        <label>Rounds between overviews (X)</label>
        <input type="number" id="we-memory-big-summary-every" min="1" step="1" value="${bigSummaryEveryX}" style="width:100%;">
      </div>
      <div style="display:flex;gap:6px;flex-wrap:wrap;">
        <button class="we-btn we-btn-primary" id="we-memory-run-now" type="button"><i class="fa-solid fa-brain"></i> Extract this round's memories</button>
        <button class="we-btn" id="we-memory-big-summary-now" type="button"><i class="fa-solid fa-book-open"></i> Generate overview</button>
      </div>
      <div class="we-hint" id="we-memory-task-status" style="margin-top:8px;">${_memoryRunningLabel ? 'Running' + h(_memoryRunningLabel) : 'No memory task is running'}</div>`;

    const injectBody = `
      <div class="we-input-group">
        <label style="display:flex;align-items:center;gap:8px;cursor:pointer;">
          <input type="checkbox" id="we-memory-inject" ${settings.injectIntoPrompt !== false ? 'checked' : ''}>
          Inject memory info
        </label>
        <div style="font-size:11px;color:var(--we-text3);margin-top:3px;">Injects the latest Y overviews and unfiled notes; old story text covered by valid notes or overviews is hidden automatically, but the recent rounds set in "Local mechanics" always keep their original text; it also scans the last N messages for character and entity names and injects related character and entity memories as needed.</div>
      </div>
      <div class="we-input-group" style="display:flex;gap:6px;">
        <div style="flex:1;">
          <label>Messages to scan for names (N)</label>
          <input type="number" id="we-memory-search-depth" min="1" step="1" value="${searchDepth}" style="width:100%;">
        </div>
        <div style="flex:1;">
          <label>Max injected per entry</label>
          <input type="number" id="we-memory-max-per-character" min="1" step="1" value="${maxPerCharacter}" style="width:100%;">
        </div>
      </div>
      <div class="we-input-group">
        <label>Max latest overviews injected (Y)</label>
        <input type="number" id="we-memory-big-summary-inject-limit" min="1" step="1" value="${bigSummaryInjectLimit}" style="width:100%;">
        <div style="font-size:11px;color:var(--we-text3);margin-top:3px;">Only limits the number of overviews; unfiled notes are still all injected. Past overviews stored locally and in JSON are never deleted or truncated.</div>
      </div>
      <div style="font-size:11px;color:var(--we-text3);">Character and entity history is drawn with 1d10000 exponential weighting: newer records are more likely to be chosen, and the oldest still keep a non-zero chance.</div>`;

    const mechanicsBody = `
      <div class="we-input-group">
        <label style="display:flex;align-items:center;gap:8px;cursor:pointer;">
          <input type="checkbox" id="we-memory-hide-covered-raw" ${hideCoveredRawText ? 'checked' : ''}>
          Hide story text
        </label>
        <div style="font-size:11px;color:var(--we-text3);margin-top:3px;">When on, only old story text clearly covered by valid notes or overviews is hidden; turn it off and save to restore and keep all text, and "Recent rounds of text to keep" below no longer applies.</div>
      </div>
      <div class="we-input-group">
        <label>Recent rounds of text to keep</label>
        <input type="number" id="we-memory-recent-raw-rounds" min="0" step="1" value="${recentRawRounds}" style="width:100%;" ${hideCoveredRawText ? '' : 'disabled'}>
        <div style="font-size:11px;color:var(--we-text3);margin-top:3px;">User and AI text from this many recent AI turns is never hidden; 0 keeps nothing extra. Earlier text is hidden only when the source range of a valid note or overview clearly covers it.</div>
      </div>
      <div class="we-input-group">
        <label>Evolution aid · extra recent rounds of text</label>
        <input type="number" id="we-memory-reference-raw-rounds" min="0" step="1" value="${referenceRawRounds}" style="width:100%;">
        <div style="font-size:11px;color:var(--we-text3);margin-top:3px;">Characters, entities and notes are still extracted from the latest round only; the older text here is only a reference for characters, references, causes and existing state, and is not stored again.</div>
      </div>
      <div class="we-input-group">
        <label>Evolution aid · extra notes before the text</label>
        <input type="number" id="we-memory-reference-small-count" min="0" step="1" value="${referenceSmallSummaryCount}" style="width:100%;">
        <div style="font-size:11px;color:var(--we-text3);margin-top:3px;">Takes non-overlapping notes going back from the start of the reference text; 0 adds no notes.</div>
      </div>
      <div class="we-input-group">
        <label>Evolution aid · extra overviews before the notes</label>
        <input type="number" id="we-memory-reference-big-count" min="0" step="1" value="${referenceBigSummaryCount}" style="width:100%;">
        <div style="font-size:11px;color:var(--we-text3);margin-top:3px;">Takes non-overlapping overviews going back from before the chosen notes; 0 adds no overviews. The reference order is fixed: "overviews → notes → text → this round".</div>
      </div>`;

    const linkBody = `
      <div class="we-input-group">
        <label style="display:flex;align-items:center;gap:8px;cursor:pointer;">
          <input type="checkbox" id="we-memory-inject-world-engine" ${settings.injectIntoWorldEngine === true ? 'checked' : ''}>
          Provide memories to the World Engine
        </label>
        <div style="font-size:11px;color:var(--we-text3);margin-top:3px;">During world evolution, scans the full world state for character names, aliases and entity names and provides only the matching character/entity memories; notes and overviews are not provided. Memory Engine errors never interrupt world evolution.</div>
      </div>
      <div class="we-input-group">
        <label>Max injected per matching entry in world evolution (X)</label>
        <input type="number" id="we-memory-world-engine-limit" min="1" step="1" value="${worldEngineMemoryLimit}" style="width:100%;">
      </div>`;

    const backfillBody = `
      <div style="font-size:11px;color:var(--we-text3);margin-bottom:6px;">The two refills are independent: a character/entity refill does not clear notes and overviews; a notes and overview refill does not rewrite characters and entities.</div>
      <div style="display:flex;gap:6px;flex-wrap:wrap;">
        <div class="we-input-group" style="flex:1;min-width:90px;margin-bottom:0;"><label>Messages per character/entity batch</label>
          <input type="number" id="we-memory-backfill-batch" min="1" step="1" value="${backfillBatch}"></div>
        <div class="we-input-group" style="flex:1;min-width:90px;margin-bottom:0;"><label>End message (0 = all)</label>
          <input type="number" id="we-memory-backfill-end" min="0" step="1" value="${backfillEnd}"></div>
        <div class="we-input-group" style="flex:1;min-width:90px;margin-bottom:0;"><label>Fault retries per batch</label>
          <input type="number" id="we-memory-backfill-retries" min="0" step="1" value="${backfillRetries}"></div>
      </div>
      <div style="display:flex;gap:6px;flex-wrap:wrap;margin-top:6px;">
        <div class="we-input-group" style="flex:1;min-width:120px;margin-bottom:0;"><label>Notes backfill: every X AI messages</label>
          <input type="number" id="we-memory-summary-backfill-small-every" min="1" step="1" value="${summaryBackfillSmallEveryX}"></div>
        <div class="we-input-group" style="flex:1;min-width:120px;margin-bottom:0;"><label>Overview backfill: every Y notes</label>
          <input type="number" id="we-memory-summary-backfill-big-every" min="1" step="1" value="${summaryBackfillBigEveryX}"></div>
      </div>
      <div class="we-hint" id="we-memory-person-backfill-status" style="margin:6px 0;"></div>
      <div style="display:flex;gap:6px;flex-wrap:wrap;margin:6px 0;">
        <button class="we-btn we-btn-primary" id="we-memory-backfill-start">▶ Refill characters and entities</button>
        <button class="we-btn we-btn-primary" id="we-memory-summary-backfill-start">▶ Refill notes and overviews</button>
        <button class="we-btn" id="we-memory-backfill-stop">■ Stop</button>
      </div>
      <div class="we-hint" id="we-memory-summary-backfill-status" style="margin:6px 0;"></div>`;

    const memoryTheme = getStoredMemoryTheme();
    const memoryThemeOptions = WE_THEMES.map(theme =>
      `<option value="${theme.id}" ${theme.id === memoryTheme ? 'selected' : ''}>${theme.name}</option>`
    ).join('');
    const displayBody = `
      <div class="we-input-group">
        <label>Memory Engine color theme</label>
        <select id="we-memory-theme-select" style="width:100%;">${memoryThemeOptions}</select>
        <div style="font-size:11px;color:var(--we-text3);margin-top:3px;">Only affects the Memory Engine and is remembered separately; switching back to the World Engine restores its own colors.</div>
      </div>`;

    const retryBody = `
      <div class="we-input-group">
        <label>Memory API fault auto-retries</label>
        <input type="number" id="we-memory-api-auto-retries" min="0" step="1" value="${Math.max(0, parseInt(settings.apiAutoRetries) || 0)}" style="width:100%;">
        <div style="font-size:11px;color:var(--we-text3);margin-top:3px;">Retries only on faults such as connection, HTTP, timeout, empty response or unrepairable JSON; content exceeding the prompt's length or count limits is not an error.</div>
      </div>`;

    const blacklistBody = `
      <div class="we-input-group">
        <label>Character and entity name blacklist</label>
        <textarea id="we-memory-name-blacklist" rows="5" style="width:100%;resize:vertical;" placeholder="One name per line">${h(settings.nameBlacklist || '')}</textarea>
        <div style="font-size:11px;color:var(--we-text3);margin-top:3px;">When any name of a character or an entity's name in the API response is on the blacklist, only that character or entity's data is ignored; the rest of the same response is processed normally. Matching ignores case and leading/trailing spaces.</div>
      </div>`;

    const filterBody = `
      <div class="we-input-group">
        <label>One regex per line; matches are removed before the text is fed to the memory background</label>
        <div style="margin-bottom:8px;border:1px solid var(--we-border,#3a3a3a);border-radius:4px;padding:6px;">
          <div style="font-size:12px;color:var(--we-text2);margin-bottom:4px;">Simple mode: tick tags to generate removal regexes automatically</div>
          <div style="display:flex;gap:6px;flex-wrap:wrap;align-items:center;margin-bottom:4px;">
            <button class="we-btn" id="we-memory-btn-filter-scan" type="button">🔍 Scan this chat's tags</button>
            <input type="text" id="we-memory-filter-add-input" placeholder="Add a tag name by hand (e.g. thinking)" style="flex:1;min-width:140px;">
            <button class="we-btn" id="we-memory-btn-filter-add" type="button">+ Add</button>
          </div>
          <div id="we-memory-filter-tags" style="display:flex;flex-wrap:wrap;gap:4px;min-height:4px;"></div>
          <div style="font-size:11px;color:var(--we-text3);margin-top:3px;">Generated regexes don't always work — tags with attributes, with ~, nested, or with broken closing tags may fail to match. If one doesn't work, edit the box below and write it by hand. Unticked tags are not saved.</div>
        </div>
        <textarea id="we-memory-filter-regex" rows="4" style="width:100%;resize:vertical;" placeholder="One per line; plain patterns or /pattern/flags literals are supported.">${h(settings.filterRegex || '')}</textarea>
        <div style="display:flex;gap:6px;flex-wrap:wrap;margin:6px 0 4px;">
          <button class="we-btn" id="we-memory-btn-filter-test" type="button">▶ Test regex</button>
        </div>
        <div class="we-hint" id="we-memory-filter-status" style="margin:0 0 4px;white-space:pre-wrap;"></div>
        <div style="font-size:11px;color:var(--we-text3);margin-top:3px;">One per line; plain patterns (global g by default) or /pattern/flags literals are supported; blank lines are ignored. Only affects the text fed to the memory background, not the chat itself.</div>
      </div>`;

    const toneBody = `
      <div class="we-input-group">
        <label>Memory Engine additional prompt</label>
        <textarea id="we-memory-tone-prompt" rows="5" style="width:100%;resize:vertical;" placeholder="Optional; only appended to memory extraction requests">${h(settings.tonePrompt || '')}</textarea>
        <div style="font-size:11px;color:var(--we-text3);margin-top:3px;">This is an advanced runtime setting; the built-in memory prompt itself is not editable, and there is no prompt preset editor.</div>
      </div>`;

    const archiveBody = `
      <div class="we-input-group">
        <label style="display:flex;align-items:center;gap:8px;cursor:pointer;">
          <input type="checkbox" id="we-memory-sync-to-chat" ${settings.syncToChat === true ? 'checked' : ''}>
          Live cross-device sync (stored in the current chat)
        </label>
        <div style="font-size:11px;color:var(--we-text3);margin-top:3px;">When on, this chat's character and entity memories are continuously written into the SillyTavern chat file and sync across devices with it; open the same chat on another device to pick up where you left off. API keys are <b>not</b> synced, and World Engine saves are not read or written.</div>
      </div>
      <div class="we-input-group">
        <label style="display:flex;align-items:center;gap:8px;cursor:pointer;">
          <input type="checkbox" id="we-memory-auto-backup" ${settings.autoBackup === true ? 'checked' : ''}>
          Rolling auto backup (saves one each time memory advances, keeps the latest 3)
        </label>
        <div style="font-size:11px;color:var(--we-text3);margin-top:3px;">Guards against accidental deletes and edits. Auto backups and named saves are stored in this chat and visible across devices.</div>
      </div>
      <div class="we-hint" id="we-memory-archive-status" style="margin:4px 0;"></div>
      <div style="display:flex;gap:6px;flex-wrap:wrap;margin:6px 0;">
        <button class="we-btn we-btn-primary" id="we-memory-snapshot-save">New named save</button>
        <button class="we-btn" id="we-memory-snapshot-import">Import save</button>
        <input type="file" id="we-memory-snapshot-import-file" accept=".json,application/json" style="display:none;">
      </div>
      <div class="we-chatcache-list" id="we-memory-snapshot-list">${renderMemorySnapshotRows()}</div>`;

    const dataBody = `
      <div style="display:flex;gap:6px;flex-wrap:wrap;">
        <button class="we-btn" id="we-memory-export-data">Export all memory JSON</button>
        <button class="we-btn" id="we-memory-import-data">Import JSON</button>
        <input type="file" id="we-memory-import-data-file" accept=".json,application/json" style="display:none;">
      </div>
      <div style="font-size:11px;color:var(--we-text3);margin-top:5px;">A full export contains both <b>state (the latest current data)</b> and <b>checkpoint (the old checkpoint from before a re-run)</b>, each labeled with its counts of characters, entities, notes and overviews; character memories keep known_by for every entry.</div>`;

    const memoryVersion = window.MEMORY_ENGINE_SETTINGS?.VERSION || '0.1.0';
    const memoryAboutBody = `
      <div class="we-about-current"><span class="we-changelog-cur">Memory Engine v${h(memoryVersion)}</span></div>
      <div class="we-section" style="margin-top:10px;">
        <div class="we-section-title">Memory Engine 1.1</div>
        <div style="font-size:12px;color:var(--we-text2);line-height:1.7;">
          A standalone memory system for long conversations. Character memories keep track of who knows what, entity memories maintain the current state and history of organizations, objects, abilities and locations; notes record stage events round by round, and overviews compress several notes into the long-term thread.
        </div>
      </div>
      <div class="we-section" style="margin-top:10px;">
        <div class="we-section-title">v1.1.2 · Fixed overviews and notes being injected twice</div>
        <ul class="we-changelog-items">
          <li>Once overviews exceed the injection limit, notes already filed by older overviews no longer re-enter the prompt; only truly unfiled notes are injected as recent events.</li>
        </ul>
      </div>
      <div class="we-section" style="margin-top:10px;">
        <div class="we-section-title">v1.1.1 · Memory panel and extraction stability</div>
        <ul class="we-changelog-items">
          <li>Character and entity memories are collapsed by default, and entities are grouped by organization, object, ability and location; notes and overviews expand the latest one by default.</li>
          <li>Entities support aliases, kept through extraction, merging and panel editing.</li>
          <li>Fixed the output structure constraints of combined memory requests; parsing and saving errors after a successful API call no longer wrongly retry the whole request.</li>
          <li>Status messages for world evolution and the memory link now show strictly in sequence: the world stage finishes before the memory stage starts.</li>
        </ul>
      </div>
      <div class="we-section" style="margin-top:10px;">
        <div class="we-section-title">v1.1.0 · Context and story text management</div>
        <ul class="we-changelog-items">
          <li>Routine extraction still files only the latest round, and can separately add recent text, earlier notes and overviews as read-only reference; by default it references 1 round of text, 5 notes and 1 overview.</li>
          <li>Added a "Hide story text" master switch; when off, all text is kept; when on, old text is hidden according to "Recent rounds of text to keep" and what valid summaries cover.</li>
          <li>Notes and overviews keep the API's full response with no local truncation; the API's default max output is now 65000, and old 4096 settings are migrated automatically.</li>
          <li>Characters, entities, notes and overviews can all be collapsed; the panel refreshes automatically after the API response is parsed and saved.</li>
        </ul>
      </div>
      <div class="we-section" style="margin-top:10px;">
        <div class="we-section-title">v1.0.0 · Release</div>
        <div style="font-size:12px;color:var(--we-text2);line-height:1.7;">
          Characters, entities, notes and overviews can all be viewed and edited in the panel, with full JSON import/export and separate saves. You can choose to provide the World Engine with the latest memories of matching characters and entities; this mode never sends notes or overviews into world evolution.
        </div>
      </div>`;

    const memoryWorldbookBody = `
      <div class="we-input-group">
        <label style="display:flex;align-items:center;gap:8px;cursor:pointer;">
          <input type="checkbox" id="we-memory-worldbook-enabled" ${settings.worldbookEnabled === true ? 'checked' : ''}>
          Enable Memory World Info
        </label>
        <div style="font-size:11px;color:var(--we-text3);margin-top:3px;">Off by default. When on, the World Info entries selected below are used as reference for characters and background; World Info content is never taken directly as new memories.</div>
      </div>`;

    const worldbook = String(extra.worldbook || '')
      .replace(/Evolution World Info/g, 'Memory World Info')
      .replace(/injected into the evolution/g, 'injected into memory extraction');
    const panelContent = {
      common: sec('set-memory-api', 'Memory Engine API', apiBody)
        + sec('set-memory-evolve', 'Memory extraction and event filing', modeBody)
        + sec('set-memory-inject', 'Memory injection', injectBody),
      mechanics: sec('set-memory-mechanics', 'Story text retention and evolution reference', mechanicsBody),
      link: sec('set-memory-link', 'Link to the World Engine', linkBody),
      advanced: sec('set-memory-retry', 'API auto-retry', retryBody)
        + sec('set-memory-blacklist', 'Character and entity blacklist', blacklistBody)
        + sec('set-memory-backfill', 'Batch refill of memory evolution', backfillBody)
        + sec('set-memory-filter', 'Input filter', filterBody)
        + sec('set-memory-display', 'Display', displayBody)
        + sec('set-memory-tone', 'Additional prompt', toneBody),
      archive: sec('set-memory-archive', 'Memory cache and saves', archiveBody)
        + sec('set-memory-data', 'Memory data import/export', dataBody)
        + renderMemoryCheckpointSection(),
      worldbook: sec('set-memory-worldbook-enabled', 'World Info master switch', memoryWorldbookBody) + worldbook,
      debug: sec('set-memory-debug', 'Memory evolution debug', '<button class="we-btn" id="we-memory-export-diag" style="width:100%;margin-bottom:8px;">Export diagnostics bundle</button><div id="we-memory-debug-render">' + renderMemoryDebug() + '</div>'),
      about: memoryAboutBody
    };

    if (!MEMORY_SETTINGS_TABS.some(tab => tab.key === _memorySettingsTab)) _memorySettingsTab = 'common';
    const tabBar = '<div class="we-settings-tabs-shell">'
      + '<button class="we-settings-tab-scroll" data-dir="-1" title="Scroll left"><i class="fa-solid fa-chevron-left"></i></button>'
      + '<div class="we-settings-tabs" id="we-settings-tabs">'
      + MEMORY_SETTINGS_TABS.map(tab =>
          '<button class="we-settings-tab' + (tab.key === _memorySettingsTab ? ' we-settings-tab--active' : '')
          + '" data-tab="' + tab.key + '">' + tab.label + '</button>').join('')
      + '</div>'
      + '<button class="we-settings-tab-scroll" data-dir="1" title="Scroll right"><i class="fa-solid fa-chevron-right"></i></button>'
      + '</div>';
    const panels = MEMORY_SETTINGS_TABS.map(tab =>
      '<div class="we-settings-panel" data-tab="' + tab.key + '"'
      + (tab.key === _memorySettingsTab ? '' : ' style="display:none;"') + '>'
      + (panelContent[tab.key] || '') + '</div>').join('');

    return '<div class="we-sub-topbar"><button class="we-icon-btn" id="we-memory-settings-back" type="button" title="Back"><i class="fa-solid fa-arrow-left"></i></button><span class="we-sub-title">Settings</span></div>'
      + tabBar + panels
      + '<div class="we-settings-save-actions we-settings-save-sticky">'
      + '<button class="we-btn" id="we-save-memory-settings">Save settings</button>'
      + '</div>';
  }

  function updateEngineFaceChrome() {
    if (!panelElement) return;
    const face = getEngineFace();
    for (const registered of _engineFaceRegistry.values()) {
      if (registered.panelClass) panelElement.classList.remove(registered.panelClass);
    }
    if (face.panelClass) panelElement.classList.add(face.panelClass);
    const title = panelElement.querySelector('.we-engine-face-toggle');
    if (title) {
      const next = getNextEngineFace();
      title.textContent = face.label;
      title.title = 'Switch to the next view: ' + next.label;
      title.setAttribute('aria-label', title.title);
    }
    const settings = panelElement.querySelector('#we-btn-settings-open');
    if (settings) {
      settings.classList.toggle('is-active', Boolean(callEngineFace(face, 'isSettingsOpen', false)));
      settings.title = face.label + 'Settings';
    }
    const version = panelElement.querySelector('#we-panel-version');
    if (version) {
      const value = callEngineFace(face, 'getVersion', '');
      version.textContent = value ? 'v' + value : '';
      version.style.display = value ? '' : 'none';
    }
    syncBallFace();
  }

  function advanceEngineFace() {
    switchEngineFace(getNextEngineFace().id);
  }

  function switchEngineFace(targetId) {
    if (!panelElement || _panelFlipping) return;
    const target = getEngineFace(targetId);
    if (!target || target.id === _engineFace) return;
    _panelFlipping = true;
    panelElement.classList.add('we-panel-flip-out');
    window.setTimeout(() => {
      _engineFace = target.id;
      applyEngineFaceTheme();
      syncBallFace();
      panelElement.classList.remove('we-panel-flip-out');
      panelElement.classList.add('we-panel-flip-in');
      refresh();
      // 先把新的一面放到另一侧，再让浏览器补完后半程翻转。
      void panelElement.offsetWidth;
      panelElement.classList.remove('we-panel-flip-in');
      window.setTimeout(() => { _panelFlipping = false; }, 220);
    }, 180);
  }
  // 显示模式：'mask'=遮蔽（主页+分页）｜'expand'=展开（所有 section 平铺）
  function isExpandMode() {
    const s = window.WORLD_ENGINE_API
      ? window.WORLD_ENGINE_API.getSettings()
      : JSON.parse(window.WORLD_ENGINE_STORE.getItem('world_engine_settings') || '{}');
    return s.displayMode === 'expand';
  }
  // 主页导航：单击选中的行（再次单击才进入）
  let _selectedNavView = null;
  // 推演进行中标志 + 本次推演的显示基底：
  //   'checkpoint' = 重新推演（喂存档点 B，面板显示 B）
  //   'state'      = 向前推演（喂当前状态 A，面板显示 A）
  // 推演期间新结果还没写回，靠这俩决定面板显示哪份，等写回再翻新。
  let _evolving = false;
  let _evolvingScope = 'state';
  // 最近一次实际注入正文的状态桶；普通刷新必须跟随它，不能重新按瞬时楼层猜测。
  let _injectedScope = null;

  /**
   * 计算此刻实际注入正文的那一份世界状态（与 world-engine.js
   * applyInjectionForCurrentRound 用同一条楼层判断）：
   *   对话层数 < 当前状态层数 且有存档点 → 注入/显示存档点（重 roll 回退）
   *   否则 → 注入/显示当前状态
   * 返回的 scope 同时决定编辑写回哪个存储桶。
   */
  function getActiveInjected(state, checkpoint) {
    // 推演进行中：新结果还没写回，按本次推演的基底显示——
    //   重新推演（_evolvingScope='checkpoint'）→ 显示存档点 B；
    //   向前推演（_evolvingScope='state'）   → 显示当前状态 A。
    if (_evolving) {
      if (_evolvingScope === 'checkpoint' && checkpoint) {
        return { state: checkpoint, scope: 'checkpoint', layer: getCheckpointLayer(checkpoint) };
      }
      return { state: state, scope: 'state', layer: Number.isFinite(Number(state.chatLayer)) ? Number(state.chatLayer) : getChatLayer() };
    }
    if (_injectedScope === 'checkpoint' && checkpoint) {
      return { state: checkpoint, scope: 'checkpoint', layer: getCheckpointLayer(checkpoint) };
    }
    if (_injectedScope === 'state') {
      return { state: state, scope: 'state', layer: Number.isFinite(Number(state.chatLayer)) ? Number(state.chatLayer) : getChatLayer() };
    }
    const chatLayer = core.getChatLayer();
    const stateLayer = Number.isFinite(Number(state.chatLayer)) ? Number(state.chatLayer) : chatLayer;
    if (chatLayer < stateLayer && checkpoint) {
      return { state: checkpoint, scope: 'checkpoint', layer: getCheckpointLayer(checkpoint) };
    }
    return { state: state, scope: 'state', layer: Number.isFinite(Number(state.chatLayer)) ? Number(state.chatLayer) : getChatLayer() };
  }

  // 按当前显示/编辑的存储桶读写：scope==='checkpoint' 读写存档点，其余读写主状态。
  // 面板可能正在显示存档点（重 roll 回退）或设置页的存档点小节，此时所有编辑必须
  // 写回存档点而非主状态，否则“数据变了、界面不动 / 点了没反应”（与风声同源的毛病）。
  function loadScopedState(scope) {
    return scope === 'checkpoint' ? core.restoreCheckpoint() : core.loadState();
  }
  function saveScopedState(scope, scopedState) {
    if (scope === 'checkpoint') core.saveCheckpoint(scopedState);
    else core.saveState(scopedState);
  }

  function isEditingPanelContent() {
    if (editingEvent || editingFaction || editingWind || editingTrend || editingDigest ||
        editingEnemy || editingInfluence || editingRI || editingSecret || _memoryEditingPerson ||
        _memoryEditingEntity || _memoryEditingSmall || _memoryEditingBig) return true;

    // 经济信号等少数内容使用 contentEditable 行内编辑，不经过上面的编辑状态变量。
    const active = document.activeElement;
    return !!(active && panelBodyElement && panelBodyElement.contains(active) && active.isContentEditable);
  }

  function refresh(auto) {
    if (!panelElement || !panelVisible) return;
    updateEngineFaceChrome();
    const currentFace = getEngineFace();
    // 后台自动刷新会整块重建 DOM。所有引擎的设置页或编辑状态都必须在进入
    // 各自 render 分支前拦截；否则非 world 界面会绕过保护，每 30 秒重绘一次。
    // 保存、取消等主动调用 refresh()（auto=false）仍会正常刷新。
    const settingsOpen = currentFace.id === 'world'
      ? _currentView === 'settings'
      : Boolean(callEngineFace(currentFace, 'isSettingsOpen', false));
    if (auto && (settingsOpen || isEditingPanelContent())) return;
    if (currentFace.id !== 'world') {
      if (panelBodyElement) panelBodyElement.innerHTML = callEngineFace(
        currentFace,
        'render',
        '<div class="we-empty">This engine view failed to load or has no renderer yet; other engines are not affected.</div>'
      );
      if (currentFace.id === 'memory') updateMemoryPanelHeader();
      bindEvents(null);
      callEngineFace(currentFace, 'bind', undefined, panelBodyElement);
      return;
    }
    const body = panelBodyElement;
    if (!body) return;
    listPagerCounter = 0;

    const state = core.loadState();
    const checkpoint = core.restoreCheckpoint();
    const cpLayer = getCheckpointLayer(checkpoint);
    const active = getActiveInjected(state, checkpoint);
    const s = active.state;

    const _wbListEl = document.getElementById('we-worldbook-list');
    if (_wbListEl) _wbScrollTop = _wbListEl.scrollTop;

    if (_currentView === 'home') {
      body.innerHTML = isExpandMode()
        ? renderHomeViewExpanded(s, active.layer, active.scope)
        : renderHomeView(s, active.layer, active.scope);
    } else if (_currentView === 'settings') {
      body.innerHTML = renderSettingsView(checkpoint, cpLayer);
    } else {
      body.innerHTML = renderSubView(_currentView, s, active.layer, active.scope);
    }

    updatePanelHeader(s, active.layer);
    bindEvents(state);
  }

  /**
   * 世界稳定度（纯 UI 现算，只读，不写存档/不进 prompt/不返 API）
   * 稳定度 = clamp(100 - 世界压力, 0, 100)
   */
  function localSettingNumber(key, fallback, min, max) {
    const settings = window.WORLD_ENGINE_API && window.WORLD_ENGINE_API.getSettings ? window.WORLD_ENGINE_API.getSettings() : {};
    const n = Number(settings[key]);
    let v = Number.isFinite(n) ? n : fallback;
    if (min !== undefined) v = Math.max(min, v);
    if (max !== undefined) v = Math.min(max, v);
    return v;
  }

  function localTerminalKeepRounds(event) {
    const base = Math.round(localSettingNumber('localTerminalBaseKeepRounds', 2, 0));
    const perLevel = Math.round(localSettingNumber('localTerminalLevelKeepRounds', 2, 0));
    return Math.max(1, base + (Number(event && event.level) || 1) * perLevel);
  }

  function localEventMaxFails(event) {
    const level = Number(event && event.level) || 1;
    const progressBase = Math.round(localSettingNumber('localProgressFailBase', 2, 0));
    const conflictBase = Math.round(localSettingNumber('localConflictFailBase', 6, 1));
    return event && event.type === 'progress' ? progressBase + level : Math.max(1, conflictBase - level);
  }

  function computeWorldStability(state) {
    state = state || {};
    const round = Number(state.round) || 0;
    const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));

    // 事件链：仅 Lv3/4，单条封顶 60
    const CONFLICT_BASE = { 'Brewing':0, 'Escalating':1, 'Imminent':2, 'Erupted':4, 'Dissipated':0 };
    const PROGRESS_BASE = { 'Preparing':0, 'Underway':1, 'Critical':2, 'Completed':-2, 'Failed':0 };
    let eventP = 0;
    for (const e of (state.events || [])) {
      const level = Number(e.level) || 1;
      if (level < 3) continue;
      const isProgress = e.type === 'progress';
      const base = isProgress ? PROGRESS_BASE : CONFLICT_BASE;
      const keepTotal = localTerminalKeepRounds(e);
      const remainFactor = () => {
        if (e._terminalSince === undefined) return 1;
        return clamp((keepTotal - (round - e._terminalSince)) / keepTotal, 0, 1);
      };
      let p;
      if (e.stage === 'Erupted') p = 4 * level * 0.5 * remainFactor();
      else if (e.stage === 'Completed') p = -2 * remainFactor();        // 不乘 level
      else if (e.stage === 'Dissipated' || e.stage === 'Failed') p = 0;
      else p = (base[e.stage] || 0) * level * 0.5;
      if (e.stall) p *= 0.65;
      eventP += clamp(p, -60, 60);
    }

    // 风声：仅 Lv3/4，总封顶 25
    const WIND_BASE = { rumor:0.5, announcement:1, report:1.5, sentiment:2 };
    let windP = 0;
    for (const w of (state.winds || [])) {
      const level = Number(w.level) || 1;
      if (level < 3) continue;
      windP += (WIND_BASE[w.type] || 0) * level;
    }
    windP = Math.min(windP, 25);

    // 天下大势：每条持续中 +6，总封顶 20
    let trendP = 0;
    for (const t of (state.worldTrends || [])) if (t.status !== 'Ended') trendP += 6;
    trendP = Math.min(trendP, 20);

    // 势力：关系值 × 状态系数，总封顶 35
    const REL = { 'Blood pact':-1.5, 'Ally':-1, 'Friendly':-0.5, 'Neutral':0, 'Cold':0.5, 'Hostile':1, 'Sworn enemy':1.5 };
    const STAT = { 'Ascendant':1.25, 'Stable':1, 'Infighting':0.75, 'Beleaguered':0.5, 'Declining':0.25, 'Collapsing':0 };
    let factionP = 0;
    for (const f of (state.factions || [])) {
      const rel = REL[f.relation] !== undefined ? REL[f.relation] : 0;
      const st = STAT[f.status] !== undefined ? STAT[f.status] : 1;
      factionP += rel * st;
    }
    factionP = clamp(factionP, -35, 35);

    // 经济：只看 climate
    const CLIMATE = { 'Booming':-2, 'Steady':0, 'Recession':1, 'Turbulent':2 };
    const econP = CLIMATE[(state.economy || {}).climate] || 0;

    // 区域突发：激活 +5
    const regionP = (state.regionalIncident && state.regionalIncident.active) ? 5 : 0;

    // 仇敌、黑盒：按设定不计入世界稳定度

    const pressure = eventP + windP + trendP + factionP + econP + regionP;
    const stability = Number(clamp(100 - pressure, 0, 100).toFixed(1));
    const tier =
      stability >= 90 ? 'Peace reigns' :
      stability >= 70 ? 'Undercurrents' :
      stability >= 45 ? 'Tensions high' :
      stability >= 20 ? 'Turmoil' : 'On the brink';

    const r1 = v => Number(v.toFixed(1));
    return {
      stability, tier, pressure: r1(pressure),
      breakdown: {
        'Events': r1(eventP), 'News': r1(windP), 'Trends': r1(trendP), 'Factions': r1(factionP),
        'Economy': r1(econP), 'Region': r1(regionP)
      }
    };
  }

  const STABILITY_TIER_COLOR = {
    'Peace reigns': '#69b68e', 'Undercurrents': '#58b8a9', 'Tensions high': '#d0aa58',
    'Turmoil': '#d98a3d', 'On the brink': '#ff0000'
  };

  // 稳定度档位 → 头部小字（诗句）
  const STABILITY_TIER_MOOD = {
    'Peace reigns': 'The sea lies still, not a wave stirs', 'Undercurrents': 'Dark water carries the fallen petals', 'Tensions high': 'Clouds race and the wind turns cruel',
    'Turmoil': 'Heaven and earth bear open wounds', 'On the brink': 'The world\'s axis tilts, about to break'
  };

  /** 刷新头部的「第X轮 + 稳定度小字」 */
  function updatePanelHeader(state, layer) {
    const roundEl = document.getElementById('we-header-round');
    if (roundEl) {
      const layerText = (layer !== undefined && layer !== null && layer !== '-') ? ' · message ' + layer + ' ' : '';
      roundEl.textContent = 'Round ' + ((state && state.round) || 0) + ' ' + layerText;
    }
    const moodEl = document.getElementById('we-header-mood');
    if (moodEl) {
      const stab = computeWorldStability(state || {});
      const color = STABILITY_TIER_COLOR[stab.tier] || '#58b8a9';
      const text = STABILITY_TIER_MOOD[stab.tier] || '';
      const dot = moodEl.querySelector('.we-header-dot');
      const txt = moodEl.querySelector('.we-header-mood-text');
      if (dot) { dot.style.background = color; dot.style.boxShadow = '0 0 6px ' + color; }
      if (txt) { txt.textContent = text; txt.style.color = color; }
    }
  }

  const VIEW_TITLES = {
    situation: 'Situation', events: 'Events', relations: 'Relations', resources: 'Resources', settings: 'Settings'
  };

  function renderSection(title, id, content) {
    return '<div class="we-section" id="we-sec-' + id + '"><div class="we-section-title">' + sectionHeader(title, id) + '</div>' + sectionBody(id, content) + '</div>';
  }

  function renderWorldDigest(s, scope) {
    const isEditing = editingDigest?.scope === scope;
    const editor = isEditing
      ? '<div class="we-event-editor we-digest-editor" data-digest-scope="' + h(scope) + '">'
        + '<button class="we-event-editor-close we-digest-editor-close" title="Cancel">✕</button>'
        + '<textarea class="we-digest-edit-text" rows="6">' + h(s.worldDigest || '') + '</textarea>'
        + '<div class="we-event-editor-footer"><button class="we-btn we-btn-primary we-digest-editor-save">Save</button></div>'
        + '</div>'
      : '<div class="we-digest">' + u(s.worldDigest) + '</div>';

    return '<div class="we-section we-digest-card" id="we-sec-digest">'
      + '<div class="we-section-title">World digest</div>'
      + editor
      + '<div class="we-event-actions">'
      + '<button class="we-icon-btn we-digest-edit" data-digest-scope="' + h(scope) + '" title="Edit"><i class="fa-solid fa-pen"></i></button>'
      + '</div></div>';
  }

  function renderHomeView(s, layer, scope) {
    const stab = computeWorldStability(s);
    const tierColor = STABILITY_TIER_COLOR[stab.tier] || '#58b8a9';

    const rows = [
      { view: 'situation', label: 'Situation', sub: 'World trends · regional incidents · ledger', poem: 'All under heaven gather and answer' },
      { view: 'events',    label: 'Events', sub: 'Event chains · news · influence chains',     poem: 'Meet each thing as it comes' },
      { view: 'relations', label: 'Relations', sub: 'Reputation · factions · enemy roster',       poem: 'Like voices answer, like spirits seek each other' },
      { view: 'resources', label: 'Resources', sub: 'Economy · secrets',               poem: 'The earth hides endless treasure' },
    ];

    const navRows = rows.map((r, i) => {
      const topLine = i === 0 ? '<div class="we-nav-line we-nav-line-hidden"></div>' : '<div class="we-nav-line"></div>';
      const botLine = i === rows.length - 1 ? '<div class="we-nav-line we-nav-line-hidden"></div>' : '<div class="we-nav-line"></div>';
      const sel = _selectedNavView === r.view ? ' we-nav-row--selected' : '';
      return '<div class="we-nav-row' + sel + '" data-view="' + r.view + '">'
        + '<div class="we-nav-label">' + r.label + '</div>'
        + '<div class="we-nav-track">' + topLine + '<div class="we-nav-dot"></div>' + botLine + '</div>'
        + '<div class="we-nav-content"><span class="we-nav-sub">' + r.sub + '</span><span class="we-nav-poem">' + r.poem + '</span></div>'
        + '<i class="fa-solid fa-chevron-right we-nav-arrow"></i>'
        + '</div>';
    }).join('');

    return renderWorldCore(s)
      + '<div class="we-nav-list" style="--we-tier-color:' + tierColor + ';">' + navRows + '</div>'
      + renderWorldDigest(s, scope);
  }

  /** 展开模式主页：世界核心 + 世界摘要 + 所有 section 平铺（如存档点） */
  function renderHomeViewExpanded(s, layer, scope) {
    return renderWorldCore(s)
      + renderWorldDigest(s, scope)
      + renderSection('World trends', 'trends', renderWorldTrends(s.worldTrends, scope))
      + renderSection('Regional incidents', 'regional', renderRegionalIncident(s.regionalIncident, scope))
      + renderSection('Event chains', 'events', renderEventList(s.events, scope))
      + renderSection('News', 'winds', renderWindList(s.winds, scope))
      + renderSection('Influence chains', 'influence', renderInfluenceChain(s.influenceChain, scope))
      + renderSection('Reputation', 'reputation', renderReputation(s.reputation, scope))
      + renderSection('Factions', 'factions', renderFactionList(s.factions, scope))
      + renderSection('Enemy roster', 'enemies', renderEnemies(s.enemies, scope))
      + renderSection('Economy', 'economy', renderEconomy(s.economy, scope))
      + renderSection('Secrets', 'blackbox', renderBlackbox(s.blackbox, scope))
      + renderSection('Event ledger', 'ledger', renderLedger(s.memories));
  }

  function renderSubView(viewKey, s, layer, scope) {
    let content = '';
    if (viewKey === 'situation') {
      content = renderSection('World trends', 'trends', renderWorldTrends(s.worldTrends, scope))
        + renderSection('Regional incidents', 'regional', renderRegionalIncident(s.regionalIncident, scope))
        + renderSection('Event ledger', 'ledger', renderLedger(s.memories));
    } else if (viewKey === 'events') {
      content = renderSection('Event chains', 'events', renderEventList(s.events, scope))
        + renderSection('News', 'winds', renderWindList(s.winds, scope))
        + renderSection('Influence chains', 'influence', renderInfluenceChain(s.influenceChain, scope));
    } else if (viewKey === 'relations') {
      content = renderSection('Reputation', 'reputation', renderReputation(s.reputation, scope))
        + renderSection('Factions', 'factions', renderFactionList(s.factions, scope))
        + renderSection('Enemy roster', 'enemies', renderEnemies(s.enemies, scope));
    } else if (viewKey === 'resources') {
      content = renderSection('Economy', 'economy', renderEconomy(s.economy, scope))
        + renderSection('Secrets', 'blackbox', renderBlackbox(s.blackbox, scope));
    }
    return '<div class="we-sub-topbar">'
      + '<button class="we-icon-btn" id="we-btn-back" title="Back"><i class="fa-solid fa-arrow-left"></i></button>'
      + '<span class="we-sub-title">' + (VIEW_TITLES[viewKey] || viewKey) + '</span>'
      + '</div>' + content;
  }

  /** 存档点小标题：青色默认小字 + 「- N轮 - M层」 */
  function checkpointTitle(checkpoint, cpLayer) {
    if (!checkpoint) return 'Checkpoint';
    const round = checkpoint.round || 0;
    const layer = (cpLayer === undefined || cpLayer === null) ? '-' : cpLayer;
    return 'Checkpoint - round ' + round + ' - message ' + layer + ' ';
  }

  // 更新日志（纯数据；与渲染解耦。新版本发布时在数组头部加一项即可）。
  //   version —— 版本选择条按钮文案 + 与 manifest 当前版本高亮匹配；
  //   date    —— 可选，日期不确定的留月份/年份；
  //   items   —— 该版本改动条目（每条一行，渲染时走 h() 转义）。
  const CHANGELOG = [
    { version: '3.0.2', date: '2026-07-19', items: ['Relaxed the early creation conditions for event chains: planning, probing, the start of an investigation or a conflict first appearing, once concrete signs show, can enter an event chain for ongoing observation before it matures.', 'Relaxed where news starts spreading: once a clear information topic is publicly released, overheard or retold by others, passed on through channels or discussed in a small circle, it can be created, without first needing to affect other lasting state.', 'Kept merging, deduplication and valid spreading boundaries for events and news, so the looser admission does not produce duplicate entries or leak private information.'] },
    { version: '3.0.1', date: '2026-07-16', items: ['Fixed event-chain titles and Lv.2 level text being close to the background color and hard to read in the light Cloud White and Early Cherry themes.', 'Event level, type, stage, evolution result, final-outcome stamp and countdown now adapt their contrast in light themes; dark themes keep the original colors.'] },
    { version: '3.0.0', date: '2026-07-14', items: ['World Engine reaches the 3.0 release: still centered on independent world-state evolution, layered injection, local event mechanics, an editable panel and per-chat saves.', 'Memory Engine 1.0 is officially integrated: characters, entities, notes and overviews keep separate data and failure boundaries, and can feed matching up-to-date character and entity memories to world evolution on demand.', 'Automatic notes count new rounds from the current message when the chat is first opened; past conversation is filed only by the notes and overview batch refill.'] },
    { version: '2.5.4', date: '2026-07-14', items: ['Memory Engine tasks now use the top status banner: characters/entities, notes and overviews show started, complete, failed or stopped whether run automatically or by hand.'] },
    { version: '2.5.3', date: '2026-07-14', items: ['Added processing cursors under the Memory Engine title: the message reached by character/entity processing, the message reached by notes, and the number of notes merged into overviews; unprocessed ones show 0, with no new stored fields.'] },
    { version: '2.5.2', date: '2026-07-14', items: ['Added "First message is the AI greeting" to world and memory settings, on by default; when on, automatic summaries and batch refills skip message 0; when off, the first message is processed like any other.', 'Memory data editors now use dark input boxes with white text for better readability in every theme.'] },
    { version: '2.5.1', date: '2026-07-13', items: ['Added the local "nearby random event" mechanic: by chance, generates one event chain or news item with a clear causal link to the current conversation, the protagonist, their region or matters in progress; the result automatically becomes a regular event/wind object.', 'Nearby developments support adjusting the trigger chance, cooldown after success and the event chain / news ratio; the type is preselected locally, and on an invalid return or API error it keeps the same type and forces generation again, with a minimum cooldown of 1. Nearby, distant and regional events can each be completed in the same round.', 'Simplified and relaxed the rules for creating and merging event chains: removed excessive admission conditions such as "at least two possible futures", and identifies the same main matter by core goal, main parties and continuous process; steps, obstacles, partial results and aftermath of an existing matter keep the original id, and only new matters that can develop on their own across rounds get a new event chain.'] },
    { version: '2.5.0', date: '2026-07-12', items: ['Added the local "distant random event" mechanic: once the event ledger reaches an adjustable threshold, it triggers by chance, takes the newest quarter of the ledger and fills up to half with random older records, and asks the evolution API to generate one distant event chain or news item with no direct link to the protagonist or the existing ledger.', 'Distant developments are preselected locally as an event chain or news at an adjustable ratio (50% each by default); a temporary marker confirms successful generation before the official ID is assigned; on an invalid return or API error the same type and ledger sample are kept and generation is forced again, followed by an adjustable cooldown after success.', 'Story injection gained an "Inject all levels" option: when on, event chains and news of Lv1–Lv4 are all injected; when off, the high-level filter stays, and low-level events are still injected once they reach Erupted/Completed.', 'Regional incident type descriptions now use more neutral, cross-genre wording, removing words tied to a historical Chinese setting such as imperial highways, salt shops and village militia, and require the concrete form to fit the current setting, era, technology, geography and social system.', 'Fixed errors when a cooldown is set to 0: distant event cooldown, cooldown after a regional incident fades and regional incident duration are all limited to a minimum of 1.'] },
    { version: '2.4.2', date: '2026-07-12', items: ['World-state injection and story behavior rules now use more neutral, cross-genre wording and match the current World Engine mechanics.', 'Added 6 color themes; the panel, top status and floating ball change color together; the four sections of local mechanics each gained their own reset to defaults.', 'Advanced settings gained an API error auto-retry count: retries on empty responses, garbled text, parse failures, HTTP errors, timeouts and network errors; off by default.'] },
    { version: '2.4.1', date: '2026-07-11', items: ['Added "Local mechanics" settings: regional incidents, event dice, news fading and retention limits are split into four collapsible sections with the key formulas written right in the settings, and parameters such as event eruption, advance/setback, fading and retention rounds can be adjusted.', 'Injection settings gained a maximum number of injected characters, so the length of the world-state injection can be controlled by model context and SillyTavern setup, keeping an oversized state from crowding out the prompt.'] },
    { version: '2.4.0', date: '2026-07-10', items: ['Merged the world-state improvements from the test branch into the main line: persistent entities gained stable ids, so events, factions, world trends, news, enemies and other objects are less likely to be wrongly merged or polluted with duplicates when renamed, rerolled, restored from a save or copied.', 'Refined admission for world-state modules and the evolution prompt rules: tightened the creation/update conditions for reputation, economy, enemies, the information black box, regional incidents, knowledge boundaries and more, reducing causeless updates, panel leaks and over-saving.'] },
    { version: '2.3.22', date: '2026-07-10', items: ['Added an "API request parameters" structured log to the console: each evolution prints the connection mode, target URL, model, temperature, max_tokens, timeout in seconds, message count and prompt character count, so the actual request parameters can be checked; the log never prints the API key or the full prompt text.'] },
    { version: '2.3.21', date: '2026-07-10', items: ['The API settings page gained three options: temperature, max output tokens and request timeout (seconds); evolution requests no longer hard-code 0.7 / 8000 and read the user\'s settings instead.', 'Stronger protection against unresponsive APIs: the timeout now covers the whole process of reading response headers and body, so a half-open server response or a stuck body no longer leaves it stuck at "Evolving"; fetching the model list is also aborted by the same timeout.'] },
    { version: '2.3.20', date: '2026-07-09', items: ['The back bar and section titles of sub-pages now stick to the top, so you can go back directly from anywhere in a long list.', 'The world digest gained an inline edit entry: click the digest card to show an edit button, then change and save it; no copy or delete actions are offered.', 'Fixed content snapping back while editing events, factions, news, trends, the world digest and so on: background auto-refresh pauses during editing so rebuilding the panel cannot overwrite unsaved input; it refreshes normally after saving or canceling.'] },
    { version: '2.3.19', date: '2026-06-29', items: ['Fixed "injected the checkpoint (an old round\'s world state) without a reroll": v2.3.18 detected rerolls with a plain numeric check state.chatLayer===chatLayer, but SillyTavern emits GENERATION_STARTED **before** the user message is pushed into chat — so when sending a message in a new round, chatLayer still == the previous round\'s state.chatLayer, it was mistaken for a reroll, and the previous round\'s checkpoint was injected (happening every round when combined with dual-generation plugins such as database extensions). Reroll detection now uses SillyTavern\'s native type (only type=swipe/regenerate of GENERATION_STARTED is a real reroll) instead of inferring from message numbers; dryRun (warm-up / token-counting generations from database-type plugins) is always skipped, ending "injected again after the story was generated".', 'Better injection self-check viewer (read-only): every entry in "Actual message chain sent" (system/user/assistant alike) can now be clicked to expand its full content instead of only showing its length, making it easy to check the full prompt sent to the model. The diagnostics bundle still only exports role + length (no text, to avoid bloat and leaking chat context).'] },
    { version: '2.3.18', date: '2026-06-29', items: ['Fixed the evolution round going backward on reroll (decoupled reroll from redo): automatic evolution mixed up "reroll (swipe/regenerate the same message)" with redo (restore the base from the checkpoint and evolve again) → after a reroll the round was stuck at the checkpoint\'s round instead of the current one. The evolve base is now chosen three ways — forward (new round / evolve from current) / redo (manual satellite button, back to the checkpoint) / automatic reroll (no mode passed and not a new round → don\'t restore the checkpoint, evolve on the current state, round stays the current one).', 'Fixed reroll injection taking the wrong branch (decoupled injection detection from event timing): the v2.3.17 _pendingReroll gate depended on the timing of SillyTavern\'s swipe events and was easily cleared early by GENERATION_ENDED or hit by dual-generation plugins → rerolls injected the current round\'s state instead of the checkpoint. (Note: the plain numeric check that v2.3.18 switched to had a new regression, fully fixed by the type check in v2.3.19.)', 'Removed the _pendingReroll gate (introduced in v2.3.17, now completely unnecessary); the code is simpler'] },
    { version: '2.3.17', date: '2026-06-28', items: ['Fixed world-state injection "working only sometimes" alongside plugins that disturb message numbers or generate twice (such as database-type SillyTavern helper scripts): the root cause was that the v2.3.14 "don\'t inject on a same-message reroll" guard check fingerprint==chatLayer was too aggressive — the fingerprint is pinned to the current message at evolution time, so when the first generation of a new round (the one that actually produces story text) had just started and the new user message had not landed yet, chatLayer still happened to == fingerprint, it was mistaken for a reroll and the injection was removed, so the real story text got no world state. The guard now has a "real swipe gate": it may only trigger after actually receiving SillyTavern\'s native MESSAGE_SWIPED event (_pendingReroll=true), so ordinary new generations without a swipe event inject the current state as usual; and when it does trigger, it now injects the checkpoint (the world state from before this message\'s text) instead of nothing, closer to the intent of "rerolls inject the checkpoint" (it falls back to no injection only when there is no checkpoint). The check uses native SillyTavern events, works with any plugin and has no plugin-specific special cases'] },
    { version: '2.3.16', date: '2026-06-28', items: ['Added an "injection self-check" (top of the debug card, read-only): many users reported "injection doesn\'t work" with no way to tell — the root cause is that registerInjection succeeding only means "calling the SillyTavern API didn\'t error", and never proves the world state actually made it into the text sent to the model. It now subscribes to SillyTavern\'s prompt-assembled events (chat completion chat_completion_prompt_ready / text completion generate_after_combine_prompts), reads the prompt chain SillyTavern actually built after injection, shows it split by role, and judges this round in plain words: ✅ reached the prompt / ❌ registered but missing from the prompt (a real failure) / ⏸ skipped by design (injection off, or a same-message reroll) / — not generated yet. It is purely read-only and split into its own module: it does not change the injection logic, does not touch eventData, ignores token-counting warm-up rounds, and has zero effect on evolution; the diagnostics bundle also captures this snapshot'] },
    { version: '2.3.15', date: '2026-06-25', items: ['Fixed automatic evolution silently freezing: evolution API requests had no timeout, so if one fell into a network black hole (proxy not responding / upstream neither returning nor erroring), fetch hung forever, evolution\'s _isRunning never reset, and every later automatic evolution triggered by GENERATION_ENDED was silently skipped by the isRunning() guard until the user switched chats once; added apiTimeoutMs (120s by default, 0 = no timeout); a timeout is handled as an evolution failure so finally resets normally and the status bar reports a clear timeout reason (user aborts / chat switches still use the original AbortError and show "Aborted")'] },
    { version: '2.3.14', date: '2026-06-23', items: ['Fixed redo inflating the round: clicking the "Redo" satellite button added +1 to round unconditionally (before the isNew check), so redo also raised the round, contrary to the comment "redo keeps the round"; round++ now lives inside if(isNew), so only forward / automatic new rounds raise it', 'Fixed redo silently degrading without a checkpoint: after the first evolution there is no checkpoint, and clicking redo used to skip the whole block → silently degrading into "evolve on the current state" + round++, a fake redo (one free round with no notice); now with mode==="redo" and no checkpoint it returns false and reports "No checkpoint, so redo is not possible; use \'Advance\' for at least one round", no longer a fake forward', 'Fixed same-message rerolls injecting the old world state: rerolling the same message (chatLayer==stateLayer) used to go to else and inject "the current state evolved from the old text", interfering with the new text being rewritten; applyInjectionForCurrentRound now has an "already evolved on this message → don\'t inject" branch, using the fingerprint (updated only on truly new rounds, more faithful than chatLayer) to call unregisterInjection, so the new text isn\'t skewed by the old world state', 'Added a fourth satellite on the left of the little globe (floating ball), a "plug" master switch: turns evolution and injection off/on in one click (linked to the two existing settings evolveMode + injectIntoPrompt, no new fields; off = switch to manual evolution + injection off, on = switch to automatic evolution + injection on; manual mode already blocks the pending autoEvolveTimer, so no extra master-switch handling is needed)'] },
    { version: '2.3.13', date: '2026-06-22', items: ['Fixed an automatic evolution deadlock: in an empty chat with syncToChat on (never evolved), after the first AI message the status line got stuck at "Round 0/1" and never evolved automatically', 'Fixed APIs with custom version prefixes such as Volcano Ark (/api/v3, /api/coding/v3) being unable to fetch models: URL normalization no longer forces /v1; users fill in the full version prefix, and a format hint was added next to the URL box', 'chatcache cross-device sync guard: when the cloud copy lacks checkpoint/fingerprint, the local anchors are no longer deleted along with exact, avoiding falling into the deadlock again'] },
    { version: '2.3.12', date: '2026-06-22', items: ['Added an "About" tab: a built-in changelog where you can pick a version from a dropdown to see past changes', 'Regex filter "simple mode": tick tags to generate removal regexes automatically'] },
    { version: '2.3.11', date: '2026-06-22', items: ['Regex filter supports /pattern/flags syntax, validation on save, and a new test button'] },
    { version: '2.3.10', date: '2026-06-21', items: ['Code-review fixes for the engine preset system (performance and stutter)', 'The diagnostics bundle now also captures the preset system and prompt segments'] },
    { version: '2.3.9',  date: '2026-06',    items: ['Engine preset system: the hard-coded segments of the evolution prompt can be edited, saved and switched'] },
    { version: '2.3.8',  date: '2026-06',    items: ['Fully transparent segmented view of the evolution prompt (read-only)'] },
    { version: '2.3.7',  date: '2026-06',    items: ['Added the "Through the SillyTavern proxy" connection mode, bypassing third-party APIs\' CORS'] },
    { version: '2.3.6',  date: '2026-06',    items: ['Settings page split into tabs'] },
    { version: '2.3.5',  date: '2026-06',    items: ['One-click diagnostics bundle export'] },
    { version: '2.3.4',  date: '2026-06',    items: ['Extension version shown next to the panel title'] },
    { version: '2.2.0',  date: '2026',       items: ['SillyTavern cache and saves: cross-device sync + loss-proof saves'] }
  ];

  // [FIX] 选项卡定义：label + 包含哪些片段。仅归类现有 section，不新增/不删功能。
  const SETTINGS_TABS = [
    { key: 'common',    label: 'Common' },
    { key: 'link',      label: 'Linking' },
    { key: 'advanced',  label: 'Advanced' },
    { key: 'mechanics', label: 'Local mechanics' },
    { key: 'archive',   label: 'Saves' },
    { key: 'worldbook', label: 'World Info' },
    { key: 'debug',     label: 'Debug' },
    { key: 'about',     label: 'About' }
  ];
  let _settingsTab = 'common';
  let _memorySettingsTab = 'common';

  function renderSettingsView(checkpoint, cpLayer) {
    const cpContent = checkpoint
      ? renderCheckpointSections(checkpoint, cpLayer)
      : '<div class="we-empty">No checkpoint yet</div>';
    const form = renderSettingsForm();              // {api,evolve,backfill,filter,display,chatcache,inject}
    const extra = renderSettingsAfterCheckpoint();  // {worldbook,data,tone}

    // 存档点 section（原样，移入「存档」卡）
    const checkpointSection = '<div class="we-section" style="margin-top:16px;"><div class="we-section-title">'
      + sectionHeader(checkpointTitle(checkpoint, cpLayer), 'checkpoint-section') + '</div>'
      + sectionBody('checkpoint-section', cpContent) + '</div>';

    // 调试 section（原样，含诊断包按钮 + renderDebug，移入「调试」卡）
    const debugSection = '<div class="we-section we-debug-section">'
      + '<div class="we-section-title"><span class="we-debug-toggle" title="Expand or collapse debug info"><span class="we-toggle-arrow">▶</span>Debug</span></div>'
      + '<div id="we-debug-body" style="display:none;">'
      + '<button class="we-btn" id="we-export-diag" style="width:100%;margin-bottom:8px;">Export diagnostics bundle</button><!-- [FIX] diagnostics bundle: always exportable, whether or not evolution has run -->'
      + '<div id="we-debug-render">' + renderDebug() + '</div>'
      // [MAP] 引擎预设管理：与 PR#12 只读分段展示同处调试卡，把 4 个硬编码段升级为可编辑+预设化。
      // 独立锚点 #we-preset-manage，局部刷新；保存走独立 storage key，不进 we-save-settings。
      + '<div class="we-preset-section">'
      + '<div class="we-section-title">Engine presets (editable evolution prompt segments)</div>'
      + '<div id="we-preset-manage">' + renderPresetManage() + '</div>'
      + '</div>'
      + '</div></div>';

    // 各选项卡承载的片段（每个 section 恰好出现一次，零重复）
    const panelContent = {
      common:    form.api + form.evolve + form.inject,
      link:      form.link,
      advanced:  form.retry + form.backfill + form.filter + form.display + extra.tone,
      mechanics: form.mechanics,
      archive:   form.chatcache + extra.data + checkpointSection,
      worldbook: extra.worldbook,
      debug:     debugSection,
      about:     renderAbout()
    };

    const tabBar = '<div class="we-settings-tabs-shell">'
      + '<button class="we-settings-tab-scroll" data-dir="-1" title="Scroll left"><i class="fa-solid fa-chevron-left"></i></button>'
      + '<div class="we-settings-tabs" id="we-settings-tabs">'
      + SETTINGS_TABS.map(t =>
          '<button class="we-settings-tab' + (t.key === _settingsTab ? ' we-settings-tab--active' : '')
          + '" data-tab="' + t.key + '">' + t.label + '</button>').join('')
      + '</div>'
      + '<button class="we-settings-tab-scroll" data-dir="1" title="Scroll right"><i class="fa-solid fa-chevron-right"></i></button>'
      + '</div>';

    const panels = SETTINGS_TABS.map(t =>
      '<div class="we-settings-panel" data-tab="' + t.key + '"'
      + (t.key === _settingsTab ? '' : ' style="display:none;"') + '>'
      + (panelContent[t.key] || '') + '</div>').join('');

    return '<div class="we-sub-topbar">'
      + '<button class="we-icon-btn" id="we-btn-back" title="Back"><i class="fa-solid fa-arrow-left"></i></button>'
      + '<span class="we-sub-title">Settings</span>'
      + '</div>'
      + tabBar
      + panels
      // 保存/重置：底部常驻（sticky），任何选项卡都能一键保存全部设置
      + '<div class="we-settings-save-actions we-settings-save-sticky">'
      + '<button class="we-btn" id="we-save-settings">Save settings</button>'
      + '<button class="we-btn we-btn-danger" id="we-reset-world">Reset world</button>'
      + '</div>';
  }

  // 「关于」选项卡：当前版本徽标 + 更新日志（下拉选择版本 + 每版本独立面板，纯 CSS 显隐切换）。
  //   数据来自 CHANGELOG 常量（与渲染解耦）；版本下拉复用 #we-preset-select 范式——
  //   点击弹出原生可滚动列表，版本再多也不撑爆布局。默认选中第一项（最新版）。
  function renderAbout() {
    if (!CHANGELOG.length) return '<div class="we-empty">No changelog yet</div>';
    const cur = window.WORLD_ENGINE_VERSION;
    const curBadge = cur ? '<span class="we-changelog-cur">Current version v' + h(cur) + '</span>' : '';

    const optHtml = CHANGELOG.map(function (c, i) {
      const label = 'v' + c.version + (c.date ? ' (' + c.date + ')' : '');
      return '<option value="' + h(c.version) + '"' + (i === 0 ? ' selected' : '') + '>' + h(label) + '</option>';
    }).join('');
    const verBar = '<div class="we-changelog-row">'
      + '<label class="we-changelog-row-label">View version</label>'
      + '<select id="we-changelog-select" class="we-changelog-select">' + optHtml + '</select>'
      + '</div>';

    const panels = CHANGELOG.map(function (c, i) {
      const head = '<div class="we-changelog-head">v' + h(c.version)
        + (c.date ? ' <span class="we-changelog-date">' + h(c.date) + '</span>' : '') + '</div>';
      const items = '<ul class="we-changelog-items">'
        + (c.items || []).map(function (it) { return '<li>' + h(it) + '</li>'; }).join('')
        + '</ul>';
      return '<div class="we-changelog-panel" data-ver="' + h(c.version) + '"'
        + (i === 0 ? '' : ' style="display:none;"') + '>' + head + items + '</div>';
    }).join('');

    return '<div class="we-section">'
      + '<div class="we-changelog-top">' + curBadge + '</div>'
      + verBar
      + panels
      + '</div>';
  }

  function renderCheckpointSections(s, layer) {
    return renderSection('World trends', 'cp-trends', renderWorldTrends(s.worldTrends, 'checkpoint'))
      + renderSection('Event chains', 'cp-events', renderEventList(s.events, 'checkpoint'))
      + renderSection('Factions', 'cp-factions', renderFactionList(s.factions, 'checkpoint'))
      + renderSection('News', 'cp-winds', renderWindList(s.winds, 'checkpoint'))
      + renderSection('Reputation', 'cp-reputation', renderReputation(s.reputation, 'checkpoint'))
      + renderSection('Economy', 'cp-economy', renderEconomy(s.economy, 'checkpoint'))
      + renderSection('Enemy roster', 'cp-enemies', renderEnemies(s.enemies, 'checkpoint'))
      + renderSection('Influence chains', 'cp-influence', renderInfluenceChain(s.influenceChain, 'checkpoint'))
      + renderSection('Regional incidents', 'cp-regional', renderRegionalIncident(s.regionalIncident, 'checkpoint'))
      + renderSection('Secrets', 'cp-blackbox', renderBlackbox(s.blackbox, 'checkpoint'))
      + renderSection('Event ledger', 'cp-ledger', renderLedger(s.memories));
  }

  /** 世界核心：环形稳定度仪表 + 四格关键计数 */
  function renderWorldCore(s) {
    const stab = computeWorldStability(s);
    const tierColor = STABILITY_TIER_COLOR[stab.tier] || '#58b8a9';
    const detail = Object.entries(stab.breakdown)
      .filter(([, v]) => v !== 0)
      .map(([k, v]) => `${k} ${v > 0 ? '+' : ''}${v}`).join('  ') || 'No sources of pressure';

    const R = 66, C = 2 * Math.PI * R;
    const pct = Math.max(0, Math.min(1, stab.stability / 100));
    const dash = (pct * C).toFixed(1);
    const theta = (pct * 360 - 90) * Math.PI / 180;       // 从正上方起、顺时针
    const dotX = (80 + R * Math.cos(theta)).toFixed(1);
    const dotY = (80 + R * Math.sin(theta)).toFixed(1);
    const dashNum = Number(dash);

    function arcPoint(angleDeg) {
      const rad = angleDeg * Math.PI / 180;
      return {
        x: 80 + R * Math.cos(rad),
        y: 80 + R * Math.sin(rad)
      };
    }

    function arcPath(startDeg, endDeg) {
      const a = arcPoint(startDeg);
      const b = arcPoint(endDeg);
      const largeArc = Math.abs(endDeg - startDeg) > 180 ? 1 : 0;
      return `M ${a.x.toFixed(2)} ${a.y.toFixed(2)} A ${R} ${R} 0 ${largeArc} 1 ${b.x.toFixed(2)} ${b.y.toFixed(2)}`;
    }

    const tailDeg = Math.min(36, pct * 360);
    const tailSegs = 36;
    let tailGlow = '';

    for (let i = 0; i < tailSegs; i++) {
      const t1 = i / tailSegs;
      const t2 = (i + 1) / tailSegs;

      const startDeg = -90 + pct * 360 - tailDeg + t1 * tailDeg;
      const endDeg = -90 + pct * 360 - tailDeg + t2 * tailDeg;

      const alpha = Math.pow(t2, 2.2) * 0.72;

      tailGlow += `
        <path d="${arcPath(startDeg, endDeg)}"
          fill="none"
          stroke="#ffffff"
          stroke-width="6"
          stroke-linecap="butt"
          opacity="${alpha.toFixed(3)}"/>
      `;
    }

    const stats = [
      ['Events', (s.events || []).length],
      ['Factions', (s.factions || []).length],
      ['News', (s.winds || []).length],
      ['Trends', (s.worldTrends || []).length],
    ].map(([k, v]) => `<div class="we-core-stat"><div class="we-core-stat-k">${k}</div><div class="we-core-stat-v">${v}</div></div>`).join('');

    return `
      <div class="we-section we-core-section">
        <div class="we-core" title="Pressure by source (only Lv3/4 counted): ${detail}  |  pressure ${stab.pressure}">
          <div class="we-core-ring">
            <svg viewBox="0 0 160 160" width="160" height="160">
              <defs>
                <filter id="weCoreDotGlow" x="-80%" y="-80%" width="260%" height="260%">
                  <feGaussianBlur stdDeviation="3.2"/>
                </filter>
              </defs>

              <circle cx="80" cy="80" r="${R}" fill="none" stroke="rgba(255,255,255,0.08)" stroke-width="6"/>

              <circle cx="80" cy="80" r="${R}" fill="none" stroke="${tierColor}" stroke-width="6"
                stroke-linecap="round"
                stroke-dasharray="${dash} ${(C - pct * C).toFixed(1)}"
                transform="rotate(-90 80 80)"/>

              ${tailGlow}

              <circle class="we-core-dot-glow" cx="${dotX}" cy="${dotY}" r="8" fill="#ffffff" opacity="0.14" filter="url(#weCoreDotGlow)"/>
              <circle cx="${dotX}" cy="${dotY}" r="4.6" fill="#e8fffb" opacity="0.70"/>
              <circle class="we-core-dot-core" cx="${dotX}" cy="${dotY}" r="2.5" fill="#ffffff" opacity="0.95"/>
            </svg>
            <div class="we-core-center">
              <div class="we-core-title">World core</div>
              <div class="we-core-sub">Stability</div>
              <div class="we-core-pct" style="color:${tierColor};">${stab.stability.toFixed(1)}<span>%</span></div>
              <div class="we-core-tier" style="color:${tierColor};">${stab.tier}</div>
            </div>
          </div>
          <div class="we-core-stats">${stats}</div>
        </div>
      </div>`;
  }

  /** 获取存档点的对话层数 */
  function getCheckpointLayer(cp) {
    if (!cp) return '-';
    return Number.isFinite(Number(cp.chatLayer)) ? Number(cp.chatLayer) : '-';
  }

  function renderPagedList(items, key, renderItem, perPage = 4) {
    const rid = `we-list-${key}-${++listPagerCounter}`;
    const totalPages = Math.ceil(items.length / perPage);
    const currentPage = Math.min(totalPages, Math.max(1, listPageState[rid] || 1));
    listPageState[rid] = currentPage;
    const pager = totalPages > 1
      ? `<div class="we-list-pager">
          <span class="we-list-arrow" data-rid="${rid}" data-dir="-1">◀</span>
          <span class="we-list-page"><span class="we-list-cur">${currentPage}</span>/${totalPages}</span>
          <span class="we-list-arrow" data-rid="${rid}" data-dir="1">▶</span>
        </div>`
      : '';
    return pager + `<div class="we-paged-list" data-rid="${rid}">` + items.map((item, index) => {
      const page = Math.floor(index / perPage) + 1;
      return `<div class="we-page-item" data-page="${page}" style="${page !== currentPage ? 'display:none;' : ''}">${renderItem(item, index)}</div>`;
    }).join('') + '</div>';
  }

  function renderEventList(events, scope) {
    if (!events || !events.length) return '<div class="we-empty">No event chains yet</div>';
    const curRound = (core.loadState() || {}).round || 0;
    return renderPagedList(events, 'events-' + scope, (e, eventIndex) => {
      const stageColors = {
        'Brewing':'#d6b85a',
        'Escalating':'#d98a3d',
        'Imminent':'#cf5f3f',
        'Erupted':'#b93f3f',
        'Dissipated':'#888888',
        'Preparing':'#7de9d9',
        'Underway':'#58e8b3',
        'Critical':'#2a8a5d',
        'Completed':'#1b5e3b',
        'Failed':'#888888',
        'Stalled':'#6688aa'
      };
      const levelColors = {
        1: '#c0c0c0',
        2: '#f2f2f2',
        3: '#c9a45c',
        4: '#df7cff'
      };
      const color = stageColors[e.stage] || '#888';
      const levelColor = levelColors[e.level] || '#9aa6b2';
      let extras = '';
      const terminalStages = e.type === 'progress' ? ['Completed', 'Failed'] : ['Erupted', 'Dissipated'];
      const isTerminal = terminalStages.includes(e.stage);
      if (e.consecutiveFails > 0 && !isTerminal) {
        const maxFails = localEventMaxFails(e);
        extras += ` <span class="we-badge" style="background:#6662;color:#888;">${e.consecutiveFails}/${maxFails}</span>`;
      }
      if (e.stall && !isTerminal) {
        extras += ' <span class="we-badge" style="background:#6688aa22;color:#6688aa;">Stalled</span>';
      }
      let metaExtra = '';
      if (e.evolveResult && !isTerminal) {
        const resultColors = { 'Success':'#7a9a7a', 'Hold':'#b8a070', 'Setback':'#c46a6a' };
        const color = resultColors[e.evolveResult] || '#888';
        metaExtra = ` <span class="we-badge we-event-result-badge" style="--event-result:${color};">${e.evolveResult}</span>`;
      }
      // 阶段进度条
      let progressHtml = '';
      if (!isTerminal) {
        const pct = Math.round((e.stageRound / 9) * 100);

        const progressMotionClass = {
          'Success': 'we-event-progress-success',
          'Hold': 'we-event-progress-hold',
          'Setback': 'we-event-progress-fail'
        }[e.evolveResult] || '';

        progressHtml = `<div class="we-event-progress ${progressMotionClass}">
          <div style="width:${pct}%;background:${color};"></div>
        </div>`;
      }
      const typeName = e.type === 'progress' ? 'progress' : 'conflict';
      const typeColor = e.type === 'progress' ? '#57b7a8' : '#cf5f3f';
      // 正面终局倒计时徽标（已爆发/已完成，保留 2+level*2 轮后自动清退）
      let countdownHtml = '';
      const POSITIVE_TERMINALS = ['Erupted', 'Completed'];
      if (POSITIVE_TERMINALS.includes(e.stage) && e._terminalSince !== undefined) {
        const keepRounds = localTerminalKeepRounds(e);
        const left = keepRounds - (curRound - e._terminalSince) + 1;
        if (left >= 1) {
          const cdColor = e.stage === 'Completed' ? '#58e8b3' : '#e07465';
          countdownHtml = ` <span class="we-badge we-event-countdown" style="--event-countdown:${cdColor};" title="This event is cleared automatically in ${left} rounds"><i class="fa-regular fa-clock"></i>${left} rounds left</span>`;
        }
      }
      const terminalStamp = {
        'Completed': { text: 'Done', color: '#58e8b3' },
        'Erupted': { text: 'Erupted', color: '#e07465' },
        'Dissipated': { text: 'Faded', color: '#a6a6ad' },
        'Failed': { text: 'Failed', color: '#c08aaa' }
      }[e.stage];
      const isEditing = editingEvent?.scope === scope && editingEvent?.index === eventIndex;
      // 颜色作为 CSS 变量下放，描边/底色/光效全交由样式层处理（不再内联左色条）
      const itemStyle = `--event-accent:${color};--event-type:${typeColor};--event-level:${levelColor};`;
      const stageClassMap = {
        'Brewing': 'we-stage-sprout', 'Escalating': 'we-stage-ferment', 'Imminent': 'we-stage-loom',
        'Erupted': 'we-stage-erupt', 'Dissipated': 'we-stage-fade',
        'Completed': 'we-stage-done', 'Failed': 'we-stage-failed',
      };
      const stageClass = stageClassMap[e.stage] || '';
      const itemClass = (isTerminal ? 'we-event-item we-event-item-terminal' : 'we-event-item') + (stageClass ? ' ' + stageClass : '');
      const metaStyle = isTerminal
        ? 'style="color:var(--we-text2);"'
        : '';
      const stageBadge = isTerminal ? '' : ` <span class="we-badge we-event-stage-badge">${e.stage}</span>`;
      const metaText = isTerminal
        ? (e.desc ? u(e.desc) : '')
        : `${e.stageRound||1}/9 ${e.desc ? '— '+u(e.desc) : ''}${metaExtra}`;
      const stampHtml = isTerminal && terminalStamp
        ? `<div class="we-event-stamp" style="--event-stamp:${terminalStamp.color};">${terminalStamp.text}</div>`
        : '';
      const actionHtml = isEditing ? '' : `
        <div class="we-event-actions">
          <button class="we-icon-btn we-event-delete" data-event-scope="${scope}" data-event-index="${eventIndex}" title="Delete event"><i class="fa-solid fa-trash-can"></i></button>
          <button class="we-icon-btn we-event-copy" data-event-scope="${scope}" data-event-index="${eventIndex}" title="Copy event"><i class="fa-solid fa-copy"></i></button>
          <button class="we-icon-btn we-event-edit" data-event-scope="${scope}" data-event-index="${eventIndex}" title="Edit event"><i class="fa-solid fa-pen"></i></button>
        </div>`;
      const editHtml = isEditing ? renderEventEditor(e, scope, eventIndex) : '';
      return `<div class="${itemClass}" style="${itemStyle}">
        ${stampHtml}
        <div class="we-event-name"><span class="we-event-title">${u(e.name)}</span> <span class="we-badge we-event-level-badge">Lv.${e.level||'?'}</span> <span class="we-badge we-event-type-badge">${typeName}</span>${countdownHtml}${stageBadge}${extras}</div>
        ${metaText ? `<div class="we-event-meta" ${metaStyle}>${metaText}</div>` : ''}
        ${editHtml}
        ${actionHtml}
        ${progressHtml}
      </div>`;
    });
  }

  function renderEventEditor(event, scope, eventIndex) {
    const stages = event.type === 'progress'
      ? ['Preparing', 'Underway', 'Critical', 'Completed', 'Failed']
      : ['Brewing', 'Escalating', 'Imminent', 'Erupted', 'Dissipated'];
    const levelOptions = [1, 2, 3, 4].map(level =>
      `<option value="${level}" ${Number(event.level) === level ? 'selected' : ''}>Lv.${level}</option>`
    ).join('');
    const typeOptions = [
      ['conflict', 'conflict'],
      ['progress', 'progress']
    ].map(([type, label]) =>
      `<option value="${type}" ${event.type === type ? 'selected' : ''}>${label}</option>`
    ).join('');
    const stageOptions = stages.map(stage =>
      `<option value="${stage}" ${event.stage === stage ? 'selected' : ''}>${stage}</option>`
    ).join('');

    // 正面终局倒计时：默认值取当前剩余，非终局事件留空
    const POSITIVE_TERMINALS = ['Erupted', 'Completed'];
    const keepRounds = localTerminalKeepRounds(event);
    let leftValue = '';
    if (POSITIVE_TERMINALS.includes(event.stage)) {
      const curRound = (core.loadState() || {}).round || 0;
      const left = event._terminalSince !== undefined
        ? keepRounds - (curRound - event._terminalSince) + 1
        : keepRounds;
      leftValue = Math.min(keepRounds, Math.max(1, left));
    }

    return `
      <div class="we-event-editor" data-event-scope="${scope}" data-event-index="${eventIndex}">
        <button class="we-event-editor-close" title="Cancel edit"><i class="fa-solid fa-xmark"></i></button>
        <div class="we-event-editor-grid">
          <label class="we-event-editor-wide">Event name<input class="we-event-edit-name" type="text" value="${u(event.name || '')}"></label>
          <label>Level<select class="we-event-edit-level">${levelOptions}</select></label>
          <label>Type<select class="we-event-edit-type">${typeOptions}</select></label>
          <label>Stage<select class="we-event-edit-stage">${stageOptions}</select></label>
          <label>Stage progress<input class="we-event-edit-round" type="number" min="1" max="9" value="${event.stageRound || 1}"></label>
          <label title="Only applies to positive final outcomes (Erupted/Completed), cleared automatically when it runs out; leave empty for non-final">Rounds left<input class="we-event-edit-left" type="number" min="1" placeholder="Final only" value="${leftValue}"></label>
          <label class="we-event-editor-wide">Description<textarea class="we-event-edit-desc" rows="3">${u(event.desc || '')}</textarea></label>
        </div>
        <div class="we-event-editor-footer">
          <button class="we-btn we-btn-primary we-event-editor-save"><i class="fa-solid fa-floppy-disk"></i> Save</button>
        </div>
      </div>`;
  }

  function renderFactionList(factions, scope) {
    if (!factions || !factions.length) return '<div class="we-empty">No factions yet</div>';
    return renderPagedList(factions, 'factions', (f, factionIndex) => {
      const relationColors = {
        'Blood pact':'#2563eb', 'Ally':'#0ea5e9', 'Friendly':'#06b6d4', 'Neutral':'#94a3b8',
        'Cold':'#f59e0b', 'Tense':'#f59e0b', 'Hostile':'#ef4444', 'Sworn enemy':'#991b1b'
      };
      const statusColors = { 'Ascendant':'#d0aa58', 'Stable':'#69b68e', 'Infighting':'#cf5f3f', 'Beleaguered':'#70a8d2', 'Declining':'#a6a6ad', 'Collapsing':'#888888' };
      const relColor = relationColors[f.relation] || '#888';
      const stColor = statusColors[f.status] || '#888';

      const isEditing = editingFaction && editingFaction.scope === scope && editingFaction.index === factionIndex;

      let pillarsHtml = '';
      if (f.powerPillars && f.powerPillars.length) {
        pillarsHtml = '<div class="we-faction-meta">Pillars of power: ' + f.powerPillars.map(p => '<span class="we-pillar-tag">' + u(p) + '</span>').join('') + '</div>';
      }

      const actionHtml = isEditing ? '' : `
        <div class="we-event-actions">
          <button class="we-icon-btn we-faction-delete" data-faction-scope="${scope}" data-faction-index="${factionIndex}" title="Delete faction"><i class="fa-solid fa-trash-can"></i></button>
          <button class="we-icon-btn we-faction-copy" data-faction-scope="${scope}" data-faction-index="${factionIndex}" title="Copy faction"><i class="fa-solid fa-copy"></i></button>
          <button class="we-icon-btn we-faction-edit" data-faction-scope="${scope}" data-faction-index="${factionIndex}" title="Edit faction"><i class="fa-solid fa-pen"></i></button>
        </div>`;
      const editHtml = isEditing ? renderFactionEditor(f, factionIndex, scope) : '';

      return `<div class="we-faction-item">
        <div class="we-faction-name">${u(f.name)}</div>
        <div class="we-faction-tags">
          <span class="we-tag" style="border-color:${stColor};color:${stColor};">${f.status||'Stable'}</span>
          <span class="we-tag" style="border-color:${relColor};color:${relColor};">${f.relation||'Neutral'}</span>
          ${f.scope ? '<span class="we-tag">' + u(f.scope) + '</span>' : ''}
        </div>
        ${f.currentGoal ? `<div class="we-faction-goal">${u(f.currentGoal)}</div>` : ''}
        ${f.core_person ? `<div class="we-faction-meta">Core person: ${u(f.core_person)}</div>` : ''}
        ${pillarsHtml}
        ${actionHtml}
        ${editHtml}
      </div>`;
    });
  }

  function renderFactionEditor(f, index, scope) {
    const statusOptions = ['Ascendant','Stable','Infighting','Beleaguered','Declining','Collapsing'].map(s =>
      `<option value="${s}" ${f.status === s ? 'selected' : ''}>${s}</option>`).join('');
    const relationOptions = ['Blood pact','Ally','Friendly','Neutral','Cold','Hostile','Sworn enemy'].map(r =>
      `<option value="${r}" ${f.relation === r ? 'selected' : ''}>${r}</option>`).join('');
    const pillars = [];
    for (let i = 0; i < 3; i++) pillars.push(f.powerPillars?.[i] || '');

    return `
      <div class="we-event-editor" data-faction-scope="${scope}" data-faction-index="${index}">
        <button class="we-event-editor-close we-faction-editor-close"><i class="fa-solid fa-xmark"></i></button>
        <div class="we-event-editor-grid">
          <label class="we-event-editor-wide">Faction name<input class="we-faction-edit-name" type="text" value="${u(f.name||'')}"></label>
          <label>Fortune<select class="we-faction-edit-status">${statusOptions}</select></label>
          <label>Relation<select class="we-faction-edit-relation">${relationOptions}</select></label>
          <label>Scope<input class="we-faction-edit-scope" type="text" value="${u(f.scope||'')}"></label>
          <label>Goal<input class="we-faction-edit-goal" type="text" value="${u(f.currentGoal||'')}"></label>
          <label>Core person<input class="we-faction-edit-core" type="text" value="${u(f.core_person||'')}"></label>
          ${[0,1,2].map(i => `<label>Pillar of power ${i+1}<input class="we-faction-edit-pillar" data-pillar-idx="${i}" type="text" value="${u(pillars[i])}" maxlength="28" placeholder="Up to 3 words"></label>`).join('')}
        </div>
        <div class="we-event-editor-footer">
          <button class="we-btn we-btn-primary we-faction-editor-save"><i class="fa-solid fa-floppy-disk"></i> Save</button>
        </div>
      </div>`;
  }

  function renderWorldTrends(trends, scope) {
    if (!trends || !trends.length) return '<div class="we-empty">No world trends yet</div>';
    return renderPagedList(trends, 'world-trends', (trend, trendIndex) => {
      const ended = trend.status === 'Ended';
      const color = ended ? '#888888' : '#c9a45c';
      const isEditing = editingTrend?.scope === scope && editingTrend?.index === trendIndex;
      const actionHtml = isEditing ? '' : `
        <div class="we-event-actions">
          <button class="we-icon-btn we-trend-delete" data-trend-scope="${scope}" data-trend-index="${trendIndex}" title="Delete world trend"><i class="fa-solid fa-trash-can"></i></button>
          <button class="we-icon-btn we-trend-copy" data-trend-scope="${scope}" data-trend-index="${trendIndex}" title="Copy world trend"><i class="fa-solid fa-copy"></i></button>
          <button class="we-icon-btn we-trend-edit" data-trend-scope="${scope}" data-trend-index="${trendIndex}" title="Edit world trend"><i class="fa-solid fa-pen"></i></button>
        </div>`;
      const editHtml = isEditing ? renderTrendEditor(trend, scope, trendIndex) : '';
      return `<div class="we-trend-item${ended ? ' we-trend-ended' : ''}" style="border-left-color:${color};">
        ${actionHtml}
        <div class="we-trend-header">
          <span class="we-trend-name">${u(trend.name)}</span>
          <span class="we-badge" style="background:${color}22;color:${color};">${u(trend.status || 'Ongoing')}</span>
        </div>
        <div class="we-trend-scope">${u(trend.scope || 'Everywhere')}</div>
        <div class="we-trend-description">${u(trend.description || '?')}</div>
        <div class="we-trend-source"><span>Source</span>${u(trend.source || '?')}</div>
        ${editHtml}
      </div>`;
    });
  }

  function renderTrendEditor(trend, scope, index) {
    const statusOptions = ['Ongoing', 'Ended'].map(s =>
      `<option value="${s}" ${trend.status === s ? 'selected' : ''}>${s}</option>`).join('');
    return `
      <div class="we-event-editor" data-trend-scope="${scope}" data-trend-index="${index}">
        <button class="we-event-editor-close we-trend-editor-close"><i class="fa-solid fa-xmark"></i></button>
        <div class="we-event-editor-grid">
          <label class="we-event-editor-wide">Trend name<input class="we-trend-edit-name" type="text" value="${u(trend.name||'')}"></label>
          <label>Status<select class="we-trend-edit-status">${statusOptions}</select></label>
          <label>Scope<input class="we-trend-edit-scope" type="text" value="${u(trend.scope||'')}"></label>
          <label>Source<input class="we-trend-edit-source" type="text" value="${u(trend.source||'')}"></label>
          <label class="we-event-editor-wide">Description<textarea class="we-trend-edit-desc" rows="3">${u(trend.description||'')}</textarea></label>
        </div>
        <div class="we-event-editor-footer">
          <button class="we-btn we-btn-primary we-trend-editor-save"><i class="fa-solid fa-floppy-disk"></i> Save</button>
        </div>
      </div>`;
  }

  function renderWindList(winds, scope) {
    if (!winds || !winds.length) return '<div class="we-empty">No news yet</div>';
    const typeNames = { announcement:'Announcement', report:'Report', rumor:'Rumor', sentiment:'Sentiment' };
    const typeColors = { announcement:'#c94b4b', report:'#4a8ab5', rumor:'#9178a0', sentiment:'#c17a35' };
    return renderPagedList(winds, 'winds', (w, windIndex) => {
      const typeColor = typeColors[w.type] || '#888';
      // 等级徽章：Lv1/2 中性灰，Lv3/4 取类型本色（与风声四态配色统一）
      const levelColor = (w.level >= 3) ? typeColor : (w.level === 2 ? '#7a828c' : '#5a6270');
      const isEditing = editingWind && editingWind.scope === scope && editingWind.index === windIndex;

      const actionHtml = isEditing ? '' : `
        <div class="we-event-actions">
          <button class="we-icon-btn we-wind-delete" data-wind-scope="${scope}" data-wind-index="${windIndex}" title="Delete news"><i class="fa-solid fa-trash-can"></i></button>
          <button class="we-icon-btn we-wind-copy" data-wind-scope="${scope}" data-wind-index="${windIndex}" title="Copy news"><i class="fa-solid fa-copy"></i></button>
          <button class="we-icon-btn we-wind-edit" data-wind-scope="${scope}" data-wind-index="${windIndex}" title="Edit news"><i class="fa-solid fa-pen"></i></button>
        </div>`;
      const editHtml = isEditing ? renderWindEditor(w, windIndex, scope) : '';

      const windTypeClass = { announcement:'we-wind-announcement', report:'we-wind-report', rumor:'we-wind-rumor', sentiment:'we-wind-sentiment' }[w.type] || '';
      const windLvClass = 'we-wind-lv' + (w.level || 1);
      let html = '<div class="we-wind-item ' + windTypeClass + ' ' + windLvClass + '" style="--wind-accent:' + typeColor + ';--wind-level-color:' + levelColor + ';">';
      // Lv4 专属装饰元素：公告双冲击环 / 流言双焦点多圈涟漪
      if (w.level === 4) {
        if (w.type === 'announcement') {
          html += '<span class="we-wind-ring"></span><span class="we-wind-ring we-wind-ring2"></span>';
        } else if (w.type === 'rumor') {
          html += '<span class="we-wind-rp we-rp-a1"></span><span class="we-wind-rp we-rp-a2"></span><span class="we-wind-rp we-rp-a3"></span><span class="we-wind-rp we-rp-b1"></span><span class="we-wind-rp we-rp-b2"></span>';
        }
      }
      html += '<div class="we-wind-header">';
      html += '<span class="we-wind-topic">' + u(w.topic || 'Untitled news') + '</span>';
      html += '<span class="we-badge" style="background:' + typeColor + '22;color:' + typeColor + ';">' + (typeNames[w.type] || 'News') + '</span>';
      html += '<span class="we-badge" style="background:' + levelColor + '22;color:' + levelColor + ';">Lv.' + (w.level || 1) + '</span>';
      html += '</div>';
      html += '<div class="we-wind-field we-wind-content"><span class="we-wind-label">Content</span><span>' + u(w.content || '?') + '</span></div>';
      html += '<div class="we-wind-field"><span class="we-wind-label">Scope</span><span>' + u(w.scope || '?') + '</span></div>';
      html += '<div class="we-wind-field"><span class="we-wind-label">Source</span><span>' + u(w.source || '?') + '</span></div>';
      html += editHtml;
      html += actionHtml;
      html += '</div>';
      return html;
    });
  }

  function renderWindEditor(w, index, scope) {
    const typeOptions = [['announcement','Announcement'],['report','Report'],['rumor','Rumor'],['sentiment','Sentiment']].map(([v,label]) =>
      `<option value="${v}" ${w.type === v ? 'selected' : ''}>${label}</option>`).join('');
    const levelOptions = [1,2,3,4].map(l =>
      `<option value="${l}" ${w.level === l ? 'selected' : ''}>Lv.${l}</option>`).join('');

    return `
      <div class="we-event-editor" data-wind-index="${index}" data-wind-scope="${scope}">
        <button class="we-event-editor-close we-wind-editor-close"><i class="fa-solid fa-xmark"></i></button>
        <div class="we-event-editor-grid">
          <label class="we-event-editor-wide">Topic<input class="we-wind-edit-topic" type="text" value="${u(w.topic||'')}"></label>
          <label>Type<select class="we-wind-edit-type">${typeOptions}</select></label>
          <label>Level<select class="we-wind-edit-level">${levelOptions}</select></label>
          <label>Scope<input class="we-wind-edit-scope" type="text" value="${u(w.scope||'')}"></label>
          <label>Source<input class="we-wind-edit-source" type="text" value="${u(w.source||'')}"></label>
          <label class="we-event-editor-wide">Content<textarea class="we-wind-edit-content" rows="3">${u(w.content||'')}</textarea></label>
        </div>
        <div class="we-event-editor-footer">
          <button class="we-btn we-btn-primary we-wind-editor-save"><i class="fa-solid fa-floppy-disk"></i> Save</button>
        </div>
      </div>`;
  }

  function renderReputation(rep, scope) {
    if (!rep) return '<div class="we-empty">No reputation data yet</div>';
    const levels = ['Reviled','Notorious','Unknown','Respected','Revered'];
    const levelColors = { 'Reviled':'#e05555', 'Notorious':'#d97a5a', 'Unknown':'#7a8a9a', 'Respected':'#6cae8e', 'Revered':'#c9a45c' };
    const legacyMap = { 'Somewhat known':'Respected' };
    const dimLabels = { authority:'Halls of power', common:'Streets', shadow:'Underworld', circuit:'Peers' };
    // 各维度 × 各等级的随附古文（出处略）
    const quotes = {
      authority: { 'Reviled':'Loathed above and below like a foe', 'Notorious':'Everyone in office speaks ill of them', 'Unknown':'Lost among minor officials, unnoticed', 'Respected':'Ministers all regard them with awe', 'Revered':'The realm longs to see their bearing' },
      common:    { 'Reviled':'Passers-by point and warn each other', 'Notorious':'Even the town\'s rogues are ashamed of them', 'Unknown':'They walk the market unrecognized', 'Respected':'The neighborhood calls them an elder', 'Revered':'Children and porters all know their name' },
      shadow:    { 'Reviled':'Even the outlaws won\'t take them in', 'Notorious':'Hearing of them, heroes sneer', 'Unknown':'Drifting among fishers and woodcutters, unasked', 'Respected':'Many heroes of the wilds rally to them', 'Revered':'All within the four seas call them a hero' },
      circuit:   { 'Reviled':'Peers are ashamed to stand with them', 'Notorious':'Friends rebuke them to their face', 'Unknown':'They walk alone, with no one to talk to', 'Respected':'Fellow disciples hail them as leader', 'Revered':'Our kind look up to them like a mountain' }
    };
    return '<div class="we-rep-grid">' + Object.entries(rep).filter(([k]) => k !== 'lastChange').map(([key, rawVal]) => {
      const val = legacyMap[rawVal] || rawVal;
      const cn = dimLabels[key] || key;
      const idx = levels.indexOf(val);
      const color = levelColors[val] || '#888';
      const quote = (quotes[key] && quotes[key][val]) || '';
      const dotsHtml = levels.map((l, i) => {
        const active = i <= idx ? ' we-rep-dot-active' : '';
        const dotColor = i <= idx ? color : '#444';
        return `<span class="we-rep-dot${active}" style="background:${dotColor};" data-rep-scope="${scope || 'state'}" data-dim="${key}" data-level="${l}" title="${l}"></span>`;
      }).join('');
      return `<div class="we-rep-row">
        <span class="we-rep-dim">${cn}</span>
        <div class="we-rep-dots">${dotsHtml}</div>
        <span class="we-rep-quote" style="color:${color}">${quote}</span>
      </div>`;
    }).join('') + '</div>';
  }

  function renderEconomy(econ, scope) {
    if (!econ) return '<div class="we-empty">No economic data yet</div>';
    const sc = scope || 'state';
    const climates = ['Booming','Steady','Recession','Turbulent'];
    const climateColors = { 'Booming': '#3ecf8e', 'Steady': '#7a8a9a', 'Recession': '#d9a34a', 'Turbulent': '#e05555' };
    const climateBg = { 'Booming': 'rgba(62,207,142,0.08)', 'Steady': 'rgba(122,138,154,0.06)', 'Recession': 'rgba(217,163,74,0.08)', 'Turbulent': 'rgba(224,85,85,0.08)' };
    const climate = econ.climate || 'Steady';
    const cColor = climateColors[climate] || '#7a8a9a';
    let html = '<div class="we-climate-bar" style="background:' + (climateBg[climate]||'rgba(122,138,154,0.06)') + ';">';
    html += '<span class="we-climate-dot" style="background:' + cColor + ';box-shadow:0 0 8px ' + cColor + '88;"></span>';
    html += '<span class="we-climate-label" style="color:' + cColor + '">' + climate + '</span>';
    html += '<div class="we-climate-btns">';
    for (const c of climates) {
      html += '<span class="we-climate-btn' + (c === climate ? ' we-climate-btn-on' : '') + '" style="' + (c === climate ? ('color:'+(climateColors[c]||'#7a8a9a')+';border-color:'+(climateColors[c]||'#7a8a9a')) : '') + '" data-climate-scope="' + sc + '" data-climate="' + c + '">' + c + '</span>';
    }
    html += '</div></div>';
    if (econ.signals?.length) {
      html += renderPagedList(econ.signals, 'economy-signals', (s, i) =>
        '<div class="we-signal-item" data-sig-scope="' + sc + '">' +
        '<span class="we-signal-summary">' + u(s.summary||s) + '</span>' +
        '<span class="we-signal-scope">' + u(s.scope||'?') + '</span>' +
        '<span class="we-signal-del" data-sig-scope="' + sc + '" data-sigidx="' + i + '" title="Delete signal">✕</span>' +
        '</div>'
      );
    } else {
      html += '<div class="we-empty" style="margin-top:4px;">No market signals yet</div>';
    }
    html += '<div class="we-signal-add" data-sig-scope="' + sc + '"><i class="fa-solid fa-plus"></i> Add signal</div>';
    return html;
  }

  function renderEnemies(enemiesList, scope) {
    if (!enemiesList || !enemiesList.length) return '<div class="we-empty">No enemies yet</div>';
    return renderPagedList(enemiesList, 'enemies', (en, enemyIndex) => {
      const isEditing = editingEnemy?.scope === scope && editingEnemy?.index === enemyIndex;
      const actionHtml = isEditing ? '' : `
        <div class="we-event-actions">
          <button class="we-icon-btn we-enemy-delete" data-enemy-scope="${scope}" data-enemy-index="${enemyIndex}" title="Delete enemy"><i class="fa-solid fa-trash-can"></i></button>
          <button class="we-icon-btn we-enemy-copy" data-enemy-scope="${scope}" data-enemy-index="${enemyIndex}" title="Copy enemy"><i class="fa-solid fa-copy"></i></button>
          <button class="we-icon-btn we-enemy-edit" data-enemy-scope="${scope}" data-enemy-index="${enemyIndex}" title="Edit enemy"><i class="fa-solid fa-pen"></i></button>
        </div>`;
      const editHtml = isEditing ? renderEnemyEditor(en, enemyIndex, scope) : '';
      return `<div class="we-blood-item">
        ${actionHtml}
        <div class="we-blood-title">${u(en.name)} <span class="we-badge we-badge-danger">${en.status||'Tracking'}</span><span class="we-badge" style="background:var(--we-purple);font-size:10px;">${en.type==='blood'?'Blood feud':'Grudge'}</span></div>
        <div class="we-blood-meta">Reason: ${u(en.reason||'?')}</div>
        ${editHtml}
      </div>`;
    });
  }

  function renderEnemyEditor(en, index, scope) {
    const typeOptions = [['blood','Blood feud'],['grudge','Grudge']].map(([v,label]) =>
      `<option value="${v}" ${en.type === v ? 'selected' : ''}>${label}</option>`).join('');
    const statusOptions = ['Tracking','Plotting','Striking','Resolved'].map(s =>
      `<option value="${s}" ${en.status === s ? 'selected' : ''}>${s}</option>`).join('');
    return `
      <div class="we-event-editor" data-enemy-scope="${scope}" data-enemy-index="${index}">
        <button class="we-event-editor-close we-enemy-editor-close"><i class="fa-solid fa-xmark"></i></button>
        <div class="we-event-editor-grid">
          <label class="we-event-editor-wide">Enemy name<input class="we-enemy-edit-name" type="text" value="${u(en.name||'')}"></label>
          <label>Type<select class="we-enemy-edit-type">${typeOptions}</select></label>
          <label>Status<select class="we-enemy-edit-status">${statusOptions}</select></label>
          <label class="we-event-editor-wide">Reason<textarea class="we-enemy-edit-reason" rows="2">${u(en.reason||'')}</textarea></label>
        </div>
        <div class="we-event-editor-footer">
          <button class="we-btn we-btn-primary we-enemy-editor-save"><i class="fa-solid fa-floppy-disk"></i> Save</button>
        </div>
      </div>`;
  }

  function renderInfluenceChain(chain, scope) {
    if (!chain || !chain.length) return '<div class="we-empty">No influence chains yet</div>';
    return renderPagedList(chain, 'influence', (item, infIndex) => {
      const isEditing = editingInfluence?.scope === scope && editingInfluence?.index === infIndex;
      const actionHtml = isEditing ? '' : `
        <div class="we-event-actions">
          <button class="we-icon-btn we-influence-delete" data-influence-scope="${scope}" data-influence-index="${infIndex}" title="Delete influence chain"><i class="fa-solid fa-trash-can"></i></button>
          <button class="we-icon-btn we-influence-copy" data-influence-scope="${scope}" data-influence-index="${infIndex}" title="Copy influence chain"><i class="fa-solid fa-copy"></i></button>
          <button class="we-icon-btn we-influence-edit" data-influence-scope="${scope}" data-influence-index="${infIndex}" title="Edit influence chain"><i class="fa-solid fa-pen"></i></button>
        </div>`;
      const editHtml = isEditing ? renderInfluenceEditor(item, infIndex, scope) : '';
      return `<div class="we-influence-item">
        ${actionHtml}
        <div class="we-influence-step we-influence-trigger">
          <span class="we-influence-label">Trigger</span>
          <span class="we-influence-text">${u(item.trigger)}</span>
        </div>
        <div class="we-influence-step we-influence-impact">
          <span class="we-influence-label">Direct impact</span>
          <span class="we-influence-text">${u(item.impact)}</span>
        </div>
        ${item.fallout ? `<div class="we-influence-step we-influence-fallout">
          <span class="we-influence-label">Aftermath</span>
          <span class="we-influence-text">${u(item.fallout)}</span>
        </div>` : ''}
        ${editHtml}
      </div>`;
    });
  }

  function renderInfluenceEditor(item, index, scope) {
    return `
      <div class="we-event-editor" data-influence-index="${index}" data-influence-scope="${scope}">
        <button class="we-event-editor-close we-influence-editor-close"><i class="fa-solid fa-xmark"></i></button>
        <div class="we-event-editor-grid">
          <label class="we-event-editor-wide">Trigger<textarea class="we-influence-edit-trigger" rows="2">${u(item.trigger||'')}</textarea></label>
          <label class="we-event-editor-wide">Direct impact<textarea class="we-influence-edit-impact" rows="2">${u(item.impact||'')}</textarea></label>
          <label class="we-event-editor-wide">Aftermath<textarea class="we-influence-edit-fallout" rows="2">${u(item.fallout||'')}</textarea></label>
        </div>
        <div class="we-event-editor-footer">
          <button class="we-btn we-btn-primary we-influence-editor-save"><i class="fa-solid fa-floppy-disk"></i> Save</button>
        </div>
      </div>`;
  }

  function getRegionalIncidentTypeLabel(type) {
    const labels = {
      banditry: 'Banditry and raids',
      fire: 'Great fire',
      massacre: 'Atrocious murders',
      flood: 'Flood',
      infrastructure: 'Road and waterworks failure',
      plague: 'Epidemic',
      famine: 'Famine and grain shortage',
      riot: 'Riots',
      rebellion: 'Popular uprising',
      military: 'Military upheaval',
      earthquake: 'Earthquake and landslide',
      storm: 'Storm and blizzard',
      other: 'Other'
    };
    return labels[type] || 'Other';
  }

  function renderRegionalIncident(ri, scope) {
    if (!ri) return '<div class="we-empty">No regional incident check has run yet</div>';
    const isEditing = editingRI?.active === true && editingRI?.scope === scope;
    const actionHtml = isEditing ? '' : `
      <div class="we-event-actions">
        <button class="we-icon-btn we-ri-delete" data-ri-scope="${scope}" title="Clear regional incident"><i class="fa-solid fa-trash-can"></i></button>
        <button class="we-icon-btn we-ri-copy" data-ri-scope="${scope}" title="Copy regional incident"><i class="fa-solid fa-copy"></i></button>
        <button class="we-icon-btn we-ri-edit" data-ri-scope="${scope}" title="Edit regional incident"><i class="fa-solid fa-pen"></i></button>
      </div>`;
    const editHtml = isEditing ? renderRIEditor(ri, scope) : '';

    if (ri.active) {
      return `<div class="we-accident-item we-regional-incident-item we-accident-triggered">
        ${actionHtml}
        ${u(ri.title)}<br>
        <span style="font-size:11px;color:var(--we-text3);">Type: ${u(getRegionalIncidentTypeLabel(ri.type))} | Scope: ${u(ri.scope||'?')} | Left: ${ri.duration||0} rounds</span><br>
        <span style="font-size:11px;color:var(--we-text2);">${u(ri.impact||'')}</span>
        ${editHtml}
      </div>`;
    }
    if (ri.title && ri.title.includes('retry')) {
      return `<div class="we-accident-item we-regional-incident-item" style="border-left:3px solid var(--we-gold);">
        ${actionHtml}
        ${u(ri.title)} (type: ${u(getRegionalIncidentTypeLabel(ri.type))})
        ${editHtml}
      </div>`;
    }
    if (ri.cooldown > 0) {
      return `<div class="we-accident-item we-regional-incident-item">${actionHtml}No regional incident this round (cooldown: ${ri.cooldown} rounds left)${editHtml}</div>`;
    }
    return `<div class="we-accident-item we-regional-incident-item">${actionHtml}No regional incident this round${editHtml}</div>`;
  }

  function renderRIEditor(ri, scope) {
    const types = ['banditry','fire','massacre','flood','infrastructure','plague','famine','riot','rebellion','military','earthquake','storm'];
    if (ri.type && !types.includes(ri.type)) types.push(ri.type);
    const typeOptions = types.map(t =>
      `<option value="${t}" ${ri.type === t ? 'selected' : ''}>${u(getRegionalIncidentTypeLabel(t))}</option>`).join('');
    return `
      <div class="we-event-editor" data-ri-edit="1" data-ri-scope="${scope}">
        <button class="we-event-editor-close we-ri-editor-close"><i class="fa-solid fa-xmark"></i></button>
        <div class="we-event-editor-grid">
          <label>Status<select class="we-ri-edit-active">
            <option value="true" ${ri.active ? 'selected' : ''}>Active, show the incident</option>
            <option value="false" ${!ri.active ? 'selected' : ''}>Inactive</option>
          </select></label>
          <label class="we-event-editor-wide">Title<input class="we-ri-edit-title" type="text" value="${u(ri.title||'')}"></label>
          <label>Type<select class="we-ri-edit-type">${typeOptions}</select></label>
          <label>Scope<input class="we-ri-edit-scope" type="text" value="${u(ri.scope||'')}"></label>
          <label>Rounds left<input class="we-ri-edit-duration" type="number" min="0" max="99" value="${ri.duration||0}"></label>
          <label>Cooldown<input class="we-ri-edit-cooldown" type="number" min="0" max="99" value="${ri.cooldown||0}"></label>
          <label class="we-event-editor-wide">Impact<textarea class="we-ri-edit-impact" rows="3">${u(ri.impact||'')}</textarea></label>
        </div>
        <div class="we-event-editor-footer">
          <button class="we-btn we-btn-primary we-ri-editor-save"><i class="fa-solid fa-floppy-disk"></i> Save</button>
        </div>
      </div>`;
  }

  const SECRET_STATUS_COLOR = { 'Active': 'var(--we-green)', 'Stale': 'var(--we-text3)', 'Exposed': 'var(--we-red)', 'Void': 'var(--we-text3)' };

  function isEditingSecret(scope, list, index) {
    return editingSecret && editingSecret.scope === scope && editingSecret.list === list && editingSecret.index === index;
  }

  function renderBlackbox(blackbox, scope) {
    if (!blackbox) return '<div class="we-empty">No black-box information yet</div>';
    let html = '';
    const actions = blackbox.secretActions || [];
    const assets = blackbox.secretAssets || [];

    if (actions.length) {
      html += '<div class="we-secret-group-label we-secret-action">Secret actions</div>';
      html += renderPagedList(actions, 'secret-actions', (raw, idx) => {
        const a = (typeof raw === 'string') ? { action: raw } : raw;
        if (isEditingSecret(scope, 'action', idx)) return renderSecretEditor(a, 'action', idx, scope);
        return `<div class="we-secret-card we-secret-action">
          <div class="we-secret-ops">
            <button class="we-icon-btn we-secret-edit" data-secret-scope="${scope}" data-secret-list="action" data-secret-index="${idx}" title="Edit"><i class="fa-solid fa-pen"></i></button>
            <button class="we-icon-btn we-secret-copy" data-secret-scope="${scope}" data-secret-list="action" data-secret-index="${idx}" title="Copy"><i class="fa-solid fa-copy"></i></button>
            <button class="we-icon-btn we-secret-del" data-secret-scope="${scope}" data-secret-list="action" data-secret-index="${idx}" title="Delete"><i class="fa-solid fa-trash-can"></i></button>
          </div>
          <div class="we-secret-body">
            <div class="we-secret-title">${u(a.action || 'Unnamed action')}</div>
            <div class="we-secret-meta">Known by · ${u(a.witnesses || 'None')}</div>
          </div>
        </div>`;
      });
    }

    if (assets.length) {
      html += '<div class="we-secret-group-label we-secret-asset">Secret assets</div>';
      html += renderPagedList(assets, 'secret-assets', (raw, idx) => {
        const a = (typeof raw === 'string') ? { name: raw } : raw;
        if (isEditingSecret(scope, 'asset', idx)) return renderSecretEditor(a, 'asset', idx, scope);
        const expo = Math.min(100, Math.max(0, Number(a.exposure) || 0));
        const status = a.status || 'Active';
        const stColor = SECRET_STATUS_COLOR[status] || 'var(--we-text3)';
        return `<div class="we-secret-card we-secret-asset">
          <div class="we-secret-ops">
            <button class="we-icon-btn we-secret-edit" data-secret-scope="${scope}" data-secret-list="asset" data-secret-index="${idx}" title="Edit"><i class="fa-solid fa-pen"></i></button>
            <button class="we-icon-btn we-secret-copy" data-secret-scope="${scope}" data-secret-list="asset" data-secret-index="${idx}" title="Copy"><i class="fa-solid fa-copy"></i></button>
            <button class="we-icon-btn we-secret-del" data-secret-scope="${scope}" data-secret-list="asset" data-secret-index="${idx}" title="Delete"><i class="fa-solid fa-trash-can"></i></button>
          </div>
          <div class="we-secret-body">
            <div class="we-secret-title">${u(a.name || 'Unnamed asset')}<span class="we-secret-status" style="color:${stColor};border-color:${stColor};">${u(status)}</span></div>
            <div class="we-secret-expo">
              <div class="we-secret-expo-track"><div class="we-secret-expo-fill" style="width:${expo}%;"></div></div>
              <span class="we-secret-expo-num">Exposure ${expo}%</span>
            </div>
          </div>
        </div>`;
      });
    }

    if (!html) html = '<div class="we-empty">No hidden information</div>';
    return html;
  }

  /** 秘密统一编辑器：顶部「类型」下拉只切表单(view)，转换延到保存才落库 */
  function renderSecretEditor(a, list, index, scope, view) {
    view = view || (editingSecret && editingSecret.view) || list;
    const typeSelect = `<label>Type<select class="we-secret-type">
        <option value="action" ${view === 'action' ? 'selected' : ''}>Secret action</option>
        <option value="asset" ${view === 'asset' ? 'selected' : ''}>Secret asset</option>
      </select></label>`;
    // 跨类型预填：行为↔资产 标题字段互通（action.action ↔ asset.name）
    const titleText = u(a.action || a.name || '');
    let fields;
    if (view === 'action') {
      fields = `${typeSelect}
        <label class="we-event-editor-wide">Action description<textarea class="we-secret-f-action" rows="2">${titleText}</textarea></label>
        <label class="we-event-editor-wide">Witnesses<input class="we-secret-f-witnesses" type="text" value="${u(a.witnesses || 'None')}"></label>`;
    } else {
      const statusOptions = ['Active','Stale','Exposed','Void'].map(s =>
        `<option value="${s}" ${a.status === s ? 'selected' : ''}>${s}</option>`).join('');
      fields = `${typeSelect}
        <label class="we-event-editor-wide">Asset name<input class="we-secret-f-name" type="text" value="${titleText}"></label>
        <label>Exposure<input class="we-secret-f-exposure" type="number" min="0" max="100" value="${Number(a.exposure) || 0}"></label>
        <label>Status<select class="we-secret-f-status">${statusOptions}</select></label>`;
    }
    return `
      <div class="we-event-editor we-secret-editor" data-secret-scope="${scope}" data-secret-list="${list}" data-secret-index="${index}" data-secret-view="${view}">
        <button class="we-event-editor-close we-secret-editor-close"><i class="fa-solid fa-xmark"></i></button>
        <div class="we-event-editor-grid">${fields}</div>
        <div class="we-event-editor-footer">
          <button class="we-btn we-btn-primary we-secret-save"><i class="fa-solid fa-floppy-disk"></i> Save</button>
        </div>
      </div>`;
  }

  function renderLedger(memories) {
    const entries = (memories || []).filter(m => m.type === 'ledger').reverse();
    if (!entries.length) return '<div class="we-empty">No major events recorded yet</div>';
    return renderPagedList(entries, 'ledger', entry => {
      const lines = [];
      for (const c of (entry.changes || [])) {
        if (c.type === 'event_new') {
          const tn = { conflict: 'conflict', progress: 'progress' }[c.eventType] || c.eventType;
          lines.push(`[New Lv${c.level} ${tn}] ${u(c.name)} - ${u(c.stage)} - ${u(c.desc||'')}`);
        } else if (c.type === 'event_advance') {
          lines.push(`[Advanced] ${u(c.name)}(Lv${c.level}) ${u(c.fromStage)}->${u(c.toStage)} - ${u(c.desc||'')}`);
        } else if (c.type === 'event_terminal') {
          const transition = c.fromStage ? `${u(c.fromStage)}->${u(c.stage||c.toStage)}` : u(c.stage||c.toStage);
          lines.push(`[Ended] ${u(c.name)}(Lv${c.level}) ${transition} - ${u(c.desc||'')}`);
        } else if (c.type === 'wind_new') {
          lines.push(`[New Lv${c.level} news] ${u(c.topic)} - ${u(c.content||'')}`);
        }
      }
      return `<div class="we-ledger-item">
        <span class="we-ledger-round">Round ${entry.round}</span>
        <div class="we-ledger-changes">${lines.map(l => `<div class="we-ledger-line">${l}</div>`).join('')}</div>
      </div>`;
    });
  }

  // [FIX] 推演 prompt 分段卡片折叠绑定（模块级，供装配 + 局部刷新复用）。事件委托。
  function bindPromptSegToggle(root) {
    if (!root) return;
    root.addEventListener('click', function(e) {
      const head = e.target.closest('[data-we-seg-toggle]');
      if (!head) return;
      const card = head.parentElement;
      const body = card && card.querySelector('.we-prompt-seg-body');
      const arrow = head.querySelector('.we-prompt-seg-arrow');
      if (!body) return;
      const isHidden = body.style.display === 'none';
      body.style.display = isHidden ? 'block' : 'none';
      if (arrow) arrow.textContent = isHidden ? '▼' : '▶';
    });
  }

  // [FIX] 局部刷新调试卡的 renderDebug 部分：只替换 #we-debug-render 内容并重绑段折叠，
  // 不动其它选项卡 DOM（保护用户在其它 tab 未保存的输入）。切到调试 tab 时调。
  function refreshDebugRender() {
    const box = document.getElementById('we-debug-render');
    if (!box) return;
    box.innerHTML = renderDebug();
    bindPromptSegToggle(box.querySelector('.we-prompt-debug'));
    // 导出按钮在 renderDebug 输出内，重绑
    const exportPromptBtn = document.getElementById('we-export-prompt');
    if (exportPromptBtn) {
      exportPromptBtn.onclick = () => {
        const evo = window.WORLD_ENGINE_EVOLUTION;
        if (!evo || !evo.getLastDebug) return;
        const dbg = evo.getLastDebug();
        if (!dbg.prompt) { showToast('No prompt to export', true); return; }
        const blob = new Blob([dbg.prompt], { type: 'text/plain;charset=utf-8' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a'); a.href = url; a.download = 'prompt-' + Date.now() + '.txt'; a.click();
        URL.revokeObjectURL(url);
        showToast('Prompt exported');
      };
    }
    const exportRawBtn = document.getElementById('we-export-raw-result');
    if (exportRawBtn) {
      exportRawBtn.onclick = () => {
        const evo = window.WORLD_ENGINE_EVOLUTION;
        if (!evo || !evo.getLastDebug) return;
        const dbg = evo.getLastDebug();
        if (!dbg.rawResult) { showToast('No API response to export', true); return; }
        const blob = new Blob([dbg.rawResult], { type: 'text/plain;charset=utf-8' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a'); a.href = url; a.download = 'api-raw-' + Date.now() + '.txt'; a.click();
        URL.revokeObjectURL(url);
        showToast('API response exported');
      };
    }
  }

  function updateMemoryPanelHeader() {
    const state = window.MEMORY_ENGINE_DATA?.loadState?.() || {};
    const eventMemory = state.event_memory || {};
    const memoryLayer = Number.isFinite(Number(state.chatLayer)) ? Math.max(0, Number(state.chatLayer)) : 0;
    const summaryLayer = Number.isFinite(Number(eventMemory.small_summary_layer))
      ? Math.max(0, Number(eventMemory.small_summary_layer)) : 0;
    const overviewCount = Array.isArray(eventMemory.big_summaries) ? eventMemory.big_summaries.length : 0;
    const roundEl = document.getElementById('we-header-round');
    if (roundEl) roundEl.textContent = '';
    const moodEl = document.getElementById('we-header-mood');
    if (!moodEl) return;
    const dot = moodEl.querySelector('.we-header-dot');
    const text = moodEl.querySelector('.we-header-mood-text');
    if (dot) {
      dot.style.background = 'var(--we-accent)';
      dot.style.boxShadow = '0 0 6px var(--we-accent)';
    }
    if (text) {
      text.textContent = `Memory: msg ${memoryLayer} · Notes: msg ${summaryLayer} · Filed: ${overviewCount} notes`;
      text.style.color = 'var(--we-text2)';
    }
  }

  function refreshMemoryDebugRender() {
    const box = document.getElementById('we-memory-debug-render');
    if (!box) return;
    box.innerHTML = renderMemoryDebug();
    bindPromptSegToggle(box.querySelector('.we-prompt-debug'));
    bindMemoryDebugExportButtons();
  }

  function bindMemoryDebugExportButtons() {
    const download = (content, filename) => {
      const blob = new Blob([content], { type: 'text/plain;charset=utf-8' });
      const url = URL.createObjectURL(blob), anchor = document.createElement('a');
      anchor.href = url; anchor.download = filename; anchor.click(); URL.revokeObjectURL(url);
    };
    const debug = () => window.MEMORY_ENGINE?.getLastDebug?.() || {};
    const promptButton = document.getElementById('we-memory-export-prompt');
    if (promptButton) promptButton.onclick = () => {
      const value = debug().prompt || debug().requestPrompt || '';
      if (!value) { showToast('No memory prompt to export', true); return; }
      download(value, 'memory-prompt-' + Date.now() + '.txt'); showToast('Memory prompt exported');
    };
    const resultButton = document.getElementById('we-memory-export-raw-result');
    if (resultButton) resultButton.onclick = () => {
      const current = debug();
      const value = current.rawResult || current.apiResponse || current.response || '';
      if (!value) { showToast('No memory API response to export', true); return; }
      download(typeof value === 'string' ? value : JSON.stringify(value, null, 2), 'memory-api-raw-' + Date.now() + '.txt'); showToast('Memory API response exported');
    };
  }

  // ═══════════════════════════════════════════════════════════
  // [MAP] 引擎预设管理 UI（与 PR#12 只读分段展示同处调试卡）
  // 把推演 prompt 的 4 个硬编码段（①引擎角色/②因果10步/⑦JSON输出说明/⑧JSON示例）
  // 升级为可编辑、可保存、可切换、可导入导出的预设。保存走独立 storage key，
  // 不进 we-save-settings、不进 world_engine_settings。
  // ═══════════════════════════════════════════════════════════
  function getPresetMod() {
    return (window.WORLD_ENGINE_PRESET && typeof window.WORLD_ENGINE_PRESET.getAllPresets === 'function')
      ? window.WORLD_ENGINE_PRESET : null;
  }

  // 生成预设管理 HTML（选择器 + 操作按钮 + 4 段可编辑折叠卡 + 提示）。
  // 每段 textarea 初值 = 当前生效文本（有覆写用覆写，否则默认硬编码原文）。
  function renderPresetManage() {
    const P = getPresetMod();
    if (!P) return '<div class="we-empty">Preset system not loaded</div>';

    const all = P.getAllPresets();
    const activeId = P.getActivePresetId();
    const active = P.getActivePreset();
    const overridden = P.getOverriddenSegKeys();
    const keys = P.EDITABLE_SEG_KEYS;
    const labels = P.SEG_LABELS;

    const optHtml = all.map(p =>
      '<option value="' + h(p.id) + '"' + (p.id === activeId ? ' selected' : '') + '>'
      + h(p.name) + (p.builtin ? ' (built-in)' : '') + '</option>').join('');

    const segCards = keys.map(k => {
      const text = P.getSegmentDisplayText(k) || '';
      const isOver = overridden.indexOf(k) >= 0;
      const meta = isOver ? 'Customized' : 'Default (unchanged)';
      return '<div class="we-prompt-seg-card we-preset-seg-card' + (isOver ? ' we-preset-seg-card-over' : '') + '">'
        + '<div class="we-prompt-seg-head" data-we-preset-toggle>'
        + '<span class="we-prompt-seg-arrow">▶</span>'
        + '<span class="we-prompt-seg-label">' + h(labels[k] || k) + '</span>'
        + '<span class="we-prompt-seg-meta">' + meta + '</span>'
        + '</div>'
        + '<div class="we-prompt-seg-body we-preset-seg-body" style="display:none;">'
        + '<textarea class="we-preset-textarea" data-we-preset-seg="' + h(k) + '" rows="14" spellcheck="false" placeholder="Leave empty to use the built-in default text">'
        + h(text) + '</textarea>'
        + '<div class="we-preset-seg-hint">Save it empty to fall back to the default text. Changing ⑦⑧ may break evolution parsing, at your own risk. You can keep {{user}}.</div>'
        + '</div>'
        + '</div>';
    }).join('');

    const builtinActive = !!(active && active.builtin);

    return '<div class="we-preset-manage">'
      + '<div class="we-preset-row">'
      + '<label class="we-preset-select-label">Current preset</label>'
      + '<select id="we-preset-select" class="we-preset-select">' + optHtml + '</select>'
      + '</div>'
      + '<div class="we-preset-active-desc">' + h(active && active.description || '') + '</div>'
      + '<div class="we-preset-actions">'
      + '<button class="we-btn we-btn-primary" id="we-preset-save">Save</button>'
      + '<button class="we-btn" id="we-preset-saveas">Save as</button>'
      + (builtinActive ? '' : '<button class="we-btn we-btn-danger" id="we-preset-delete">Delete</button>')
      + '<button class="we-btn" id="we-preset-export">Export</button>'
      + '<button class="we-btn" id="we-preset-import">Import</button>'
      + '<input type="file" id="we-preset-import-file" accept=".json,application/json" style="display:none;">'
      + '</div>'
      + '<div class="we-preset-hint">'
      + 'Here you edit the hard-coded prompt segments the world evolution engine sends to the evolution AI. Changing them changes how evolution itself behaves, '
      + 'at your own risk. The built-in "Default" preset cannot be deleted; clicking "Save" while editing a built-in preset asks you to save a copy.'
      + '</div>'
      + '<div class="we-prompt-seg-list">' + segCards + '</div>'
      + '</div>';
  }

  // [FIX] 局部刷新预设管理：只替换 #we-preset-manage 内容并重绑事件，不动其它 tab 输入。
  function refreshPresetManage() {
    const box = document.getElementById('we-preset-manage');
    if (!box) return;
    box.innerHTML = renderPresetManage();
    bindPresetEvents(box);
  }

  // 收集 4 个 textarea 的当前文本 → segments 对象（空串→null 表示回退默认）。
  function collectPresetSegmentsFromDOM() {
    const P = getPresetMod();
    if (!P) return {};
    const out = {};
    P.EDITABLE_SEG_KEYS.forEach(k => {
      const ta = document.querySelector('.we-preset-textarea[data-we-preset-seg="' + cssEscape(k) + '"]');
      if (!ta) { out[k] = null; return; }
      const v = ta.value;
      out[k] = (v == null || v.trim() === '') ? null : v;
    });
    return out;
  }

  // 简单的属性值转义（用于 querySelector 选择器里拼 seg key，key 全是固定小写带连字符，安全兜底）。
  function cssEscape(s) {
    return String(s).replace(/["\\]/g, '\\$&');
  }

  // 绑定预设管理事件（选择器切换 + 保存/另存/删除/导入/导出 + 段折叠委托）。
  function bindPresetEvents(root) {
    const P = getPresetMod();
    if (!P) return;
    root = root || document.getElementById('we-preset-manage');
    if (!root) return;

    // 段折叠（事件委托，独立 data-attr，不与 bindPromptSegToggle 的 data-we-seg-toggle 冲突）。
    // [FIX] 委托只需绑一次：refreshPresetManage 每次只换 root.innerHTML（子节点全新），
    // root 节点本身不变，委托靠冒泡一直有效。用守卫避免每次刷新都 addEventListener 导致
    // 监听累积（点 10 次保存就会在同一个 root 上叠 10 层 click，折叠头点一次触发 10 次）。
    if (!root.__wePresetDelegated) {
      root.__wePresetDelegated = true;
      root.addEventListener('click', function (e) {
        const head = e.target.closest('[data-we-preset-toggle]');
        if (!head) return;
        const card = head.parentElement;
        const body = card && card.querySelector('.we-preset-seg-body');
        const arrow = head.querySelector('.we-prompt-seg-arrow');
        if (!body) return;
        const isHidden = body.style.display === 'none';
        body.style.display = isHidden ? 'block' : 'none';
        if (arrow) arrow.textContent = isHidden ? '▼' : '▶';
      });
    }

    // 切换预设
    const sel = root.querySelector('#we-preset-select');
    if (sel) {
      sel.onchange = () => {
        const id = sel.value;
        P.setActivePreset(id);
        showToast('Preset switched');
        refreshPresetManage();
      };
    }

    // 保存：内置预设 → 提示另存为副本；自定义 → 更新当前。
    const saveBtn = root.querySelector('#we-preset-save');
    if (saveBtn) {
      saveBtn.onclick = () => {
        const activeId = P.getActivePresetId();
        const active = P.getActivePreset();
        const segs = collectPresetSegmentsFromDOM();
        if (active && active.builtin) {
          // 内置预设不可覆盖：走另存为副本流程
          const name = prompt('This is a built-in preset; saving creates a new copy. Enter a name for the new preset:', active.name + ' copy');
          if (name == null) return;
          const np = P.saveAsCustomPreset({ name: name || (active.name + ' copy'), description: active.description, segments: segs });
          P.setActivePreset(np.id);
          showToast('Saved as new preset: ' + np.name);
          refreshPresetManage();
          return;
        }
        P.saveCustomPreset({ id: activeId, name: active.name, description: active.description, segments: segs });
        showToast('Preset saved');
        refreshPresetManage();
      };
    }

    // 另存为：强制新 id
    const saveAsBtn = root.querySelector('#we-preset-saveas');
    if (saveAsBtn) {
      saveAsBtn.onclick = () => {
        const active = P.getActivePreset();
        const segs = collectPresetSegmentsFromDOM();
        const name = prompt('Enter a name for the new preset:', active.name + ' copy');
        if (name == null) return;
        const np = P.saveAsCustomPreset({ name: name || (active.name + ' copy'), description: active.description, segments: segs });
        P.setActivePreset(np.id);
        showToast('Saved as new preset: ' + np.name);
        refreshPresetManage();
      };
    }

    // 删除：仅自定义
    const delBtn = root.querySelector('#we-preset-delete');
    if (delBtn) {
      delBtn.onclick = () => {
        const activeId = P.getActivePresetId();
        const active = P.getActivePreset();
        if (!active || active.builtin) { showToast('Built-in presets cannot be deleted', true); return; }
        if (!confirm('Delete preset "' + active.name + '"? This cannot be undone.')) return;
        P.deleteCustomPreset(activeId);
        showToast('Preset deleted');
        refreshPresetManage();
      };
    }

    // 导出当前预设
    const expBtn = root.querySelector('#we-preset-export');
    if (expBtn) {
      expBtn.onclick = () => {
        const json = P.exportPreset(P.getActivePresetId());
        if (!json) { showToast('No preset to export', true); return; }
        const name = (P.getActivePreset().name || 'preset').replace(/[\\/:*?"<>|]/g, '_');
        setupDownload(json, 'world-engine-preset-' + name + '-' + Date.now() + '.json');
        showToast('Preset exported');
      };
    }

    // 导入：触发文件选择
    const impBtn = root.querySelector('#we-preset-import');
    const impFile = root.querySelector('#we-preset-import-file');
    if (impBtn && impFile) {
      impBtn.onclick = () => impFile.click();
      impFile.onchange = () => {
        const f = impFile.files && impFile.files[0];
        if (!f) return;
        const reader = new FileReader();
        reader.onload = () => {
          try {
            const np = P.importPreset(String(reader.result || ''));
            showToast('Imported preset: ' + np.name);
            refreshPresetManage();
          } catch (e) {
            showToast('Import failed: ' + (e && e.message || e), true);
          }
        };
        reader.onerror = () => showToast('Failed to read the file', true);
        reader.readAsText(f, 'utf-8');
        // 清空 value 以便重复选同一文件
        impFile.value = '';
      };
    }
  }


  // ── 注入自检卡（只读）：读 WORLD_ENGINE_INJECT_INSPECTOR 最后一份快照，
  //    用大白话+role 分好的消息链回答「世界状态到底有没有真进发给大模型的 prompt」。
  //    数据全来自 inspector 只读快照；本函数纯拼 HTML，不触发任何副作用。
  //    返回的是 .we-prompt-debug 内部片段（折叠头复用 data-we-seg-toggle，由 bindPromptSegToggle 统一接管）。
  function renderInjectInspector(scope) {
    const memoryScope = scope === 'memory';
    const engine = window.MEMORY_ENGINE;
    const insp = window.WORLD_ENGINE_INJECT_INSPECTOR;
    const snap = insp?.getLastSnapshot?.(memoryScope ? 'memory' : 'world')
      || (memoryScope ? engine?.getLastInjectionDebug?.() : null)
      || (memoryScope ? engine?.getLastDebug?.()?.injection : null)
      || null;
    const status = snap ? snap.status : 'NOT_YET';
    const fallbackText = memoryScope ? {
      NOT_YET: 'Not generated yet; no memory injection record',
      SKIPPED_DISABLED: 'Not injected this round: memory injection is off',
      SKIPPED_REROLL: 'Not injected this round by design: reroll of the same message',
      SKIPPED_OTHER: 'Not injected this round: no related memories matched',
      SUCCESS: '✅ This round\'s memory info reached the story prompt',
      MISSING: '❌ Registered but missing from the final prompt'
    } : {};
    const text = insp?.statusText ? insp.statusText(status, memoryScope ? 'memory' : 'world') : (fallbackText[status] || fallbackText.NOT_YET || '');
    const subject = memoryScope ? 'Character memories' : 'world state';

    const palette = {
      SUCCESS:          { icon: '✅', color: '#3fb950', bg: 'rgba(63,185,80,0.10)' },
      MISSING:          { icon: '❌', color: '#f85149', bg: 'rgba(248,81,73,0.10)' },
      SKIPPED_DISABLED: { icon: '⏸', color: 'var(--we-text3)', bg: 'rgba(128,128,128,0.08)' },
      SKIPPED_REROLL:   { icon: '⏸', color: 'var(--we-text3)', bg: 'rgba(128,128,128,0.08)' },
      SKIPPED_OTHER:    { icon: '⏸', color: 'var(--we-text3)', bg: 'rgba(128,128,128,0.08)' },
      NOT_YET:          { icon: '—', color: 'var(--we-text3)', bg: 'rgba(128,128,128,0.08)' },
    };
    const p = palette[status] || palette.NOT_YET;

    let html = '<div class="we-inject-inspector" style="border:1px solid var(--we-border);border-radius:8px;padding:10px;margin-bottom:12px;background:' + p.bg + ';">';
    html += '<div style="font-weight:600;color:' + p.color + ';margin-bottom:4px;">' + p.icon + ' injection self-check · ' + h(text) + '</div>';

    if (!snap) {
      html += '<div style="font-size:11px;color:var(--we-text3);">After you send a message to trigger generation, this shows whether "' + subject + '" actually made it into the story prompt sent to the model.</div>';
      return html + '</div>';
    }

    // 元信息行
    const apiLabel = snap.apiType === 'chat' ? 'Chat Completion' : 'Text Completion';
    let when = '';
    try { when = snap.ts ? new Date(snap.ts).toLocaleTimeString() : ''; } catch (e) {}
    html += '<div style="font-size:11px;color:var(--we-text3);margin-bottom:6px;">'
      + 'API: ' + apiLabel + ' · round: ' + (snap.round != null ? h(String(snap.round)) : '?')
      + ' · registered: ' + (snap.registeredAtSend ? 'yes' : 'no')
      + ' · in prompt: ' + (snap.landed ? 'yes' : 'no')
      + (when ? ' · ' + h(when) : '')
      + '</div>';

    // role 徽标
    const roleColor = { system: '#a371f7', user: '#58a6ff', assistant: '#3fb950', tool: '#d29922' };
    const roleBadge = (role) => {
      const c = roleColor[role] || 'var(--we-text3)';
      return '<span style="display:inline-block;min-width:62px;text-align:center;font-size:10px;padding:1px 6px;border-radius:4px;border:1px solid ' + c + ';color:' + c + ';">' + h(role || '?') + '</span>';
    };

    if (snap.apiType === 'chat' && Array.isArray(snap.messages)) {
      html += '<div style="font-size:11px;color:var(--we-text2);margin-bottom:4px;">Actual message chain sent (' + h(String(snap.messageCount)) + ' messages, split by role; click any to expand its full content):</div>';
      html += snap.messages.map((m) => {
        const meta = (m.length != null ? m.length + ' chars' : '');
        const hasBody = (m.content != null && m.content.length > 0);
        if (m.isOurs) {
          // 本扩展注入那条：可折叠，展开看完整注入内容。
          const body = '<pre class="we-prompt-seg-pre">' + u(m.content || snap.ourContent || '') + '</pre>';
          return '<div class="we-prompt-seg-card" style="margin:3px 0;">'
            + '<div class="we-prompt-seg-head" data-we-seg-toggle style="display:flex;align-items:center;gap:6px;">'
            + '<span class="we-prompt-seg-arrow">▶</span>'
            + roleBadge(m.role)
            + '<span class="we-prompt-seg-label" style="color:#3fb950;">✅ Contains this extension\'s injection</span>'
            + '<span class="we-prompt-seg-meta">' + meta + '</span>'
            + '</div>'
            + '<div class="we-prompt-seg-body" style="display:none;">' + body + '</div>'
            + '</div>';
        }
        // 其它消息：也可折叠展开看完整内容（只读，不写任何存储）
        if (hasBody) {
          const body = '<pre class="we-prompt-seg-pre">' + u(m.content) + '</pre>';
          return '<div class="we-prompt-seg-card" style="margin:3px 0;">'
            + '<div class="we-prompt-seg-head" data-we-seg-toggle style="display:flex;align-items:center;gap:6px;">'
            + '<span class="we-prompt-seg-arrow">▶</span>'
            + roleBadge(m.role)
            + '<span class="we-prompt-seg-meta">' + meta + '</span>'
            + '</div>'
            + '<div class="we-prompt-seg-body" style="display:none;">' + body + '</div>'
            + '</div>';
        }
        // 空内容：只读一行
        return '<div style="display:flex;align-items:center;gap:6px;padding:2px 0;font-size:11px;color:var(--we-text3);">'
          + roleBadge(m.role)
          + '<span>' + meta + '</span>'
          + '</div>';
      }).join('');
    } else if (snap.apiType === 'text') {
      html += '<div style="font-size:11px;color:var(--we-text2);margin-bottom:4px;">Text Completion prompt: ' + h(String(snap.promptLength || 0)) + ' chars (flattened into one string, no roles):</div>';
      if (snap.landed && snap.ourExcerpt) {
        const body = '<pre class="we-prompt-seg-pre">' + u(snap.ourExcerpt) + '</pre>';
        html += '<div class="we-prompt-seg-card" style="margin:3px 0;">'
          + '<div class="we-prompt-seg-head" data-we-seg-toggle style="display:flex;align-items:center;gap:6px;">'
          + '<span class="we-prompt-seg-arrow">▶</span>'
          + '<span class="we-prompt-seg-label" style="color:#3fb950;">✅ Excerpt where the sentinel matched</span>'
          + '</div>'
          + '<div class="we-prompt-seg-body" style="display:none;">' + body + '</div>'
          + '</div>';
      }
    }

    return html + '</div>';
  }

  // [FIX] renderDebug：推演 prompt 全透明分段展示（只读，不改可编辑）。
  // 把推演 API 收到的整块 prompt 按 10 段拆开折叠展示 + AI 返回 JSON 高亮，只看最新一轮。
  // 数据源 evo.getLastDebug().segments（evolution.js 拼装侧镜像，与实际发出 prompt 字节级一致）。
  function renderDebug() {
    // 注入自检卡独立于推演数据：每次生成都会更新，故即便尚未推演也要先展示它。
    //   整块仍包在 .we-prompt-debug 里，复用 bindPromptSegToggle 的单一委托接管折叠。
    const injectCard = renderInjectInspector();
    const evo = window.WORLD_ENGINE_EVOLUTION;
    const wrap = (inner) => '<div class="we-prompt-debug">' + injectCard + inner + '</div>';
    if (!evo || !evo.getLastDebug) return wrap('<div class="we-empty">Debug data unavailable</div>');
    const dbg = evo.getLastDebug();
    if (!dbg || !dbg.prompt) return wrap('<div class="we-empty">No evolution yet, so no debug data</div>');

    const segments = Array.isArray(dbg.segments) ? dbg.segments : [];
    const totalLen = dbg.prompt.length || 0;
    // 段占比微条：每段宽度按字数占比
    const barHtml = segments.length
      ? '<div class="we-prompt-seg-bar">' + segments.map(seg => {
          const len = (seg.content || '').length;
          const pct = totalLen ? (len / totalLen * 100) : 0;
          return '<span class="we-prompt-seg-bar-cell" style="width:' + pct.toFixed(2) + '%" title="' + u(seg.label) + ' ' + len + ' chars"></span>';
        }).join('') + '</div>'
      : '';

    // 尝试把 content 里第一个 JSON 对象 pretty-print（用于状态段/示例段高亮）
    const tryPrettyJson = (text) => {
      if (!text) return null;
      const api = window.WORLD_ENGINE_API;
      // 直接 JSON.parse 失败则用 api.parseJSON 容错
      let obj = null;
      try { obj = JSON.parse(text); } catch (e) {
        if (api && api.parseJSON) { try { obj = api.parseJSON(text); } catch (e2) {} }
      }
      if (obj === null || typeof obj !== 'object') return null;
      try { return JSON.stringify(obj, null, 2); } catch (e) { return null; }
    };

    // 单段折叠卡片
    const segCard = (idx, seg) => {
      const content = seg.content || '';
      const len = content.length;
      const pct = totalLen ? (len / totalLen * 100).toFixed(1) : '0.0';
      const isEmpty = len === 0;
      // 状态段/示例段尝试 JSON 高亮
      let bodyHtml;
      if (isEmpty) {
        bodyHtml = '<div class="we-prompt-seg-empty">Not enabled this round</div>';
      } else {
        const pretty = tryPrettyJson(content);
        const shown = pretty !== null ? pretty : content;
        bodyHtml = '<pre class="we-prompt-seg-pre' + (pretty !== null ? ' we-prompt-seg-pre-json' : '') + '">' + u(shown) + '</pre>';
      }
      return '<div class="we-prompt-seg-card" data-we-seg-key="' + u(seg.key) + '">'
        + '<div class="we-prompt-seg-head" data-we-seg-toggle>'
        + '<span class="we-prompt-seg-arrow">▶</span>'
        + '<span class="we-prompt-seg-label">' + u(seg.label) + '</span>'
        + '<span class="we-prompt-seg-meta">' + (isEmpty ? 'empty' : (len + ' chars · ' + pct + '%')) + '</span>'
        + '</div>'
        + '<div class="we-prompt-seg-body" style="display:none;">' + bodyHtml + '</div>'
        + '</div>';
    };

    // AI 返回卡
    const rawResult = dbg.rawResult || '';
    const rawLen = rawResult.length;
    const parsedJson = tryPrettyJson(rawResult);
    const rawBodyHtml = rawLen
      ? (parsedJson !== null
          ? '<pre class="we-prompt-seg-pre we-prompt-seg-pre-json">' + u(parsedJson) + '</pre>'
          : '<pre class="we-prompt-seg-pre">' + u(rawResult) + '</pre>')
      : '<div class="we-prompt-seg-empty">No API response</div>';
    const rawCard = '<div class="we-prompt-seg-card we-prompt-seg-card-raw">'
      + '<div class="we-prompt-seg-head" data-we-seg-toggle>'
      + '<span class="we-prompt-seg-arrow">▶</span>'
      + '<span class="we-prompt-seg-label">AI response (raw evolution API result)</span>'
      + '<span class="we-prompt-seg-meta">' + (rawLen ? (rawLen + ' chars' + (parsedJson !== null ? ' · JSON parsed' : ' · could not be parsed as JSON')) : 'empty') + '</span>'
      + '</div>'
      + '<div class="we-prompt-seg-body" style="display:none;">' + rawBodyHtml + '</div>'
      + '</div>';

    return ''
      + '<div class="we-prompt-debug">'
      + injectCard
      + '<div class="we-prompt-debug-summary">Prompt sent to the evolution API: ' + totalLen + ' chars in ' + segments.length + ' segments (read-only view, identical to the bytes actually sent)</div>'
      + barHtml
      + '<div class="we-prompt-seg-list">' + segments.map((seg, i) => segCard(i, seg)).join('') + '</div>'
      + rawCard
      + '<div style="display:flex;gap:6px;margin-top:8px;">'
      + '<button class="we-btn" id="we-export-prompt" style="flex:1;">Export full prompt</button>'
      + '<button class="we-btn" id="we-export-raw-result" style="flex:1;">Export API response</button>'
      + '</div>'
      + '</div>';
  }

  function renderSettingsForm() {
    const settings = window.WORLD_ENGINE_API
      ? window.WORLD_ENGINE_API.getSettings(true)
      : JSON.parse(window.WORLD_ENGINE_STORE.getItem('world_engine_settings') || '{}');
    const mode = (settings.evolveMode === 'manual' || settings.evolveMode === 'time') ? settings.evolveMode : 'auto';
    const everyX = Math.max(1, parseInt(settings.evolveEveryX) || 1);
    const readRounds = Math.min(everyX, Math.max(1, parseInt(settings.evolveReadRounds) || 1));
    const manualReadRounds = Math.max(1, parseInt(settings.manualReadRounds) || 1);
    // 按时间模式的当前值
    const _stForTime = core.hasState() ? core.loadState() : null;
    const _cpForTime = core.restoreCheckpoint();
    const stTimeVal = (_stForTime && _stForTime.time != null) ? _stForTime.time : '';
    const cpTimeVal = (_cpForTime && _cpForTime.time != null) ? _cpForTime.time : '';
    const lastDayVal = (core.getLastStoryDay && core.getLastStoryDay() != null) ? core.getLastStoryDay() : '';
    const tv = (k, d) => (settings[k] != null && settings[k] !== '') ? settings[k] : d;
    const apiTemperature = Number.isFinite(Number(settings.temperature)) ? Math.max(0, Number(settings.temperature)) : 0.7;
    const apiMaxTokens = Math.max(1, parseInt(settings.maxTokens) || 65000);
    const apiTimeoutMs = Number.isFinite(Number(settings.apiTimeoutMs)) ? Number(settings.apiTimeoutMs) : 120000;
    const apiTimeoutSec = Math.max(0, Math.round(apiTimeoutMs / 1000));
    const injectMaxChars = Number.isFinite(Number(settings.injectMaxChars)) ? Math.max(0, Math.floor(Number(settings.injectMaxChars))) : 18000;

    const sec = (id, title, body) =>
      '<div class="we-section"><div class="we-section-title">' + sectionHeader(title, id) + '</div>' +
      sectionBody(id, body) + '</div>';

    const apiBody = `
      <div class="we-input-group">
        <label>Connection</label>
        <select id="we-connection-mode" style="width:100%;">
          <option value="direct" ${settings.connectionMode !== 'proxy' ? 'selected' : ''}>Direct (default)</option>
          <option value="proxy" ${settings.connectionMode === 'proxy' ? 'selected' : ''}>Through the SillyTavern proxy (fixes CORS)</option>
        </select>
        <div style="font-size:11px;color:#888;margin-top:3px;">If it can't connect or the console shows a CORS error, switch to "Through the SillyTavern proxy" so the SillyTavern server forwards the request.</div>
      </div>
      <div class="we-input-group">
        <label>API URL (OpenAI-compatible)</label>
        <input type="text" id="we-api-url" value="${u(settings.apiUrl||'')}" placeholder="https://api.openai.com/v1">
        <div style="font-size:11px;color:#888;margin-top:3px;">Fill it in up to the version prefix; /chat/completions is optional (added automatically). Examples: OpenAI <span style="color:#aaa;">https://api.openai.com/v1</span>; Volcano Ark <span style="color:#aaa;">https://ark.cn-beijing.volces.com/api/v3</span> (or <span style="color:#aaa;">.../api/coding/v3</span>). Always include your own version prefix.</div>
      </div>
      <div class="we-input-group">
        <label>API Key</label>
        <input type="password" id="we-api-key" value="${u(settings.apiKey||'')}">
      </div>
      <div class="we-input-group" style="display:flex;gap:6px;align-items:end;">
        <div style="flex:1;">
          <label>Model</label>
          <input type="text" id="we-model" value="${u(settings.model||'gpt-3.5-turbo')}" placeholder="Model name" style="width:100%;">
        </div>
        <button class="we-btn" id="we-fetch-models" style="white-space:nowrap;flex-shrink:0;">Fetch list</button>
      </div>
      <div class="we-input-group">
        <select id="we-model-list" style="display:none;width:100%;margin-top:4px;">
          <option value="">-- Choose a model --</option>
        </select>
      </div>
      <div class="we-input-group" style="display:flex;gap:6px;">
        <div style="flex:1;">
          <label>Temperature</label>
          <input type="number" id="we-temperature" min="0" step="0.1" value="${apiTemperature}" style="width:100%;">
        </div>
        <div style="flex:1;">
          <label>Max output tokens</label>
          <input type="number" id="we-max-tokens" min="1" step="1" value="${apiMaxTokens}" style="width:100%;">
        </div>
      </div>
      <div class="we-input-group">
        <label>Request timeout (seconds)</label>
        <input type="number" id="we-api-timeout-sec" min="0" step="1" value="${apiTimeoutSec}" style="width:100%;">
        <div style="font-size:11px;color:var(--we-text3);margin-top:3px;">If no complete response arrives within this time, the request is aborted and the "Evolving" state is cleared. 0 = no timeout.</div>
      </div>`;

    const evolveBody = `
      <div class="we-input-group">
        <label style="display:flex;align-items:center;gap:8px;cursor:pointer;">
          <input type="checkbox" id="we-world-engine-enabled" ${settings.engineEnabled !== false ? 'checked' : ''}>
          Enable World Engine
        </label>
        <div style="font-size:11px;color:var(--we-text3);margin-top:3px;">When off, world evolution and world-state injection stop; the Memory Engine is not affected.</div>
      </div>
      <div class="we-input-group">
        <label style="display:flex;align-items:center;gap:8px;cursor:pointer;">
          <input type="checkbox" id="we-first-layer-ai-opening" ${settings.firstLayerIsAiOpening !== false ? 'checked' : ''}>
          First message is the AI greeting
        </label>
        <div style="font-size:11px;color:var(--we-text3);margin-top:3px;">On by default: batch refill skips message 0; when off, message 0 is refilled like normal conversation.</div>
      </div>
      <div class="we-input-group">
        <label>Evolution mode</label>
        <select id="we-evolve-mode" style="width:100%;">
          <option value="auto" ${mode === 'auto' ? 'selected' : ''}>Auto · by round (evolve every X rounds)</option>
          <option value="time" ${mode === 'time' ? 'selected' : ''}>Auto · by time (when the story date has moved N days)</option>
          <option value="manual" ${mode === 'manual' ? 'selected' : ''}>Manual (only when you click "Evolve manually")</option>
        </select>
      </div>
      <div class="we-input-group" id="we-evolve-everyx-group" style="${mode === 'auto' ? '' : 'display:none;'}">
        <label>Evolve every how many rounds (X)</label>
        <input type="number" id="we-evolve-everyx" min="1" step="1" value="${everyX}" style="width:100%;">
        <div style="font-size:11px;color:var(--we-text3);margin-top:3px;">1 = evolve every round; 3 = evolve once every 3 rounds forward. Rerolls don't count as rounds.</div>
      </div>
      <div class="we-input-group" id="we-evolve-readrounds-group" style="${mode === 'auto' ? '' : 'display:none;'}">
        <label>Recent rounds of conversation read per evolution (a)</label>
        <input type="number" id="we-evolve-readrounds" min="1" max="${everyX}" step="1" value="${readRounds}" style="width:100%;">
        <div style="font-size:11px;color:var(--we-text3);margin-top:3px;">Feeds the "user input + AI output" of the last a rounds before the current message to background evolution. Minimum 1, at most X (rounds per evolution). Default 1 = only the latest round.</div>
      </div>
      <div class="we-input-group" id="we-manual-readrounds-group" style="${mode === 'manual' ? '' : 'display:none;'}">
        <label>Recent rounds read by manual evolution</label>
        <input type="number" id="we-manual-readrounds" min="1" step="1" value="${manualReadRounds}" style="width:100%;">
        <div style="font-size:11px;color:var(--we-text3);margin-top:3px;">When you click "Advance" or "Redo", feeds the "user input + AI output" of this many rounds before the current message to background evolution. Default 1 = only the latest round.</div>
      </div>
      <div id="we-evolve-time-group" style="${mode === 'time' ? '' : 'display:none;'}">
        <div class="we-input-group" style="display:flex;gap:6px;">
          <div style="flex:1;"><label>Use the first N characters of the text</label><input type="number" id="we-time-front" min="0" step="1" value="${tv('evolveTimeFront', 0)}" style="width:100%;"></div>
          <div style="flex:1;"><label>Use the last N characters of the text</label><input type="number" id="we-time-back" min="0" step="1" value="${tv('evolveTimeBack', 80)}" style="width:100%;"></div>
        </div>
        <div class="we-input-group">
          <label>Date regex (6 boxes: 1/3/5 capture numbers → capture groups, 2/4/6 are units or labels)</label>
          <div style="display:flex;gap:4px;flex-wrap:wrap;">
            <input type="text" id="we-time-re1" value="${u(tv('evolveTimeRe1',''))}" placeholder="Box 1, e.g. \\d+ or [a-z]+" style="flex:1 1 30%;">
            <input type="text" id="we-time-re2" value="${u(tv('evolveTimeRe2',''))}" placeholder="Box 2 unit, e.g. Year or Day\\s*" style="flex:1 1 18%;">
            <input type="text" id="we-time-re3" value="${u(tv('evolveTimeRe3',''))}" placeholder="Box 3" style="flex:1 1 30%;">
            <input type="text" id="we-time-re4" value="${u(tv('evolveTimeRe4',''))}" placeholder="Box 4, e.g. Month" style="flex:1 1 18%;">
            <input type="text" id="we-time-re5" value="${u(tv('evolveTimeRe5',''))}" placeholder="Box 5" style="flex:1 1 30%;">
            <input type="text" id="we-time-re6" value="${u(tv('evolveTimeRe6',''))}" placeholder="Box 6, e.g. Day" style="flex:1 1 18%;">
          </div>
          <div style="font-size:11px;color:var(--we-text3);margin-top:3px;">Leave a box empty to skip it. Number words are converted automatically (Chinese, and English such as three, twenty-first or 21st); if several dates match, the last one is used. For English formats like "Day 12", put the label in the box before the number (e.g. box 2 = Day\\s* and box 3 = \\d+).</div>
        </div>
        <div class="we-input-group" style="display:flex;gap:6px;">
          <div style="flex:1;"><label>Multiplier A (box 1)</label><input type="number" id="we-time-mul1" step="any" value="${tv('evolveTimeMul1',360)}" style="width:100%;"></div>
          <div style="flex:1;"><label>Multiplier B (box 3)</label><input type="number" id="we-time-mul2" step="any" value="${tv('evolveTimeMul2',30)}" style="width:100%;"></div>
          <div style="flex:1;"><label>Multiplier C (box 5)</label><input type="number" id="we-time-mul3" step="any" value="${tv('evolveTimeMul3',1)}" style="width:100%;"></div>
        </div>
        <div class="we-input-group">
          <label>Evolve every N days</label>
          <input type="number" id="we-time-threshold" min="1" step="1" value="${tv('evolveTimeThreshold',1)}" style="width:100%;">
        </div>
        <div class="we-input-group">
          <label>Read at most the last X rounds of conversation</label>
          <input type="number" id="we-time-maxrounds" min="1" step="1" value="${tv('evolveTimeMaxRounds',10)}" style="width:100%;">
          <div style="font-size:11px;color:var(--we-text3);margin-top:3px;">Reads as many rounds as have passed since the last evolution; above X it reads only the last X, a cap that keeps the prompt from growing too long.</div>
        </div>
        <div class="we-input-group" style="border-top:1px solid var(--we-border,#3a3a3a);padding-top:8px;">
          <label>Current state time (total days)</label>
          <input type="number" id="we-time-state" step="any" value="${stTimeVal}" placeholder="state.time; empty = not written" style="width:100%;">
        </div>
        <div class="we-input-group">
          <label>Checkpoint time (total days)</label>
          <input type="number" id="we-time-checkpoint" step="any" value="${cpTimeVal}" placeholder="checkpoint.time; empty = not written" style="width:100%;">
        </div>
        <div class="we-input-group">
          <label>This round's conversation time (total days)</label>
          <input type="number" id="we-time-current" step="any" value="${lastDayVal}" placeholder="Saving checks whether to evolve" style="width:100%;">
          <div style="font-size:11px;color:var(--we-text3);margin-top:3px;">After saving: subtracts the base time, and evolves at once if N days have passed. The three time boxes are only written when they have a value; if you enter a wrong one, close and reopen the extension and fill it in again.</div>
        </div>
      </div>`;

    const filterBody = `
      <div class="we-input-group">
        <label>One regex per line; matches are removed before the text is fed to the background</label>
        <div style="margin-bottom:8px;border:1px solid var(--we-border,#3a3a3a);border-radius:4px;padding:6px;">
          <div style="font-size:12px;color:var(--we-text2);margin-bottom:4px;">Simple mode: tick tags to generate removal regexes automatically</div>
          <div style="display:flex;gap:6px;flex-wrap:wrap;align-items:center;margin-bottom:4px;">
            <button class="we-btn" id="we-btn-filter-scan" type="button">🔍 Scan this chat's tags</button>
            <input type="text" id="we-filter-add-input" placeholder="Add a tag name by hand (e.g. thinking)" style="flex:1;min-width:140px;">
            <button class="we-btn" id="we-btn-filter-add" type="button">+ Add</button>
          </div>
          <div id="we-filter-tags" style="display:flex;flex-wrap:wrap;gap:4px;min-height:4px;"></div>
          <div style="font-size:11px;color:var(--we-text3);margin-top:3px;">Generated regexes don't always work — tags with attributes (like &lt;wlog time&gt;), with ~ (like &lt;konatan_planning~&gt;), nested, or with broken closing tags may fail to match. If one doesn't work, edit the box below and write it by hand. Unticked tags are not saved.</div>
        </div>
        <textarea id="we-filter-regex" rows="4" style="width:100%;resize:vertical;" placeholder="One per line; plain patterns or /pattern/flags literals are supported. Examples:
<details>[\\s\\S]*?</details>\\n?
/&lt;think&gt;[\\s\\S]*?&lt;\\/think&gt;/g">${u(tv('evolveFilterRegex',''))}</textarea>
        <div style="display:flex;gap:6px;flex-wrap:wrap;margin:6px 0 4px;">
          <button class="we-btn" id="we-btn-filter-test" type="button">▶ Test regex</button>
        </div>
        <div class="we-hint" id="we-filter-status" style="margin:0 0 4px;white-space:pre-wrap;"></div>
        <div style="font-size:11px;color:var(--we-text3);margin-top:3px;">One per line; plain patterns (global g by default) or /pattern/flags literals (like /.../gi) are supported; blank lines are ignored. Only affects the text fed to background evolution, not the chat itself or date capture. Each line is validated on save, and the test button runs them on the latest message.</div>
      </div>`;

    const injectBody = `
      <div class="we-input-group">
        <label style="display:flex;align-items:center;gap:8px;cursor:pointer;">
          <input type="checkbox" id="we-inject-into-prompt" ${settings.injectIntoPrompt !== false ? 'checked' : ''}>
          Inject into the story prompt
        </label>
        <div style="font-size:11px;color:var(--we-text3);margin-top:3px;">When off, neither the current state nor the checkpoint is injected into the chat prompt.</div>
      </div>
      <div class="we-input-group">
        <label>Max characters injected into the story prompt</label>
        <input type="number" id="we-inject-max-chars" min="0" step="100" value="${injectMaxChars}" style="width:100%;">
        <div style="font-size:11px;color:var(--we-text3);margin-top:3px;">Limits the length of the world state injected into the story prompt. Default 18000; 0 = no limit.</div>
      </div>
      <div class="we-input-group">
        <label style="display:flex;align-items:center;gap:8px;cursor:pointer;">
          <input type="checkbox" id="we-inject-all-levels" ${settings.injectAllLevels === true ? 'checked' : ''}>
          Inject all levels
        </label>
        <div style="font-size:11px;color:var(--we-text3);margin-top:3px;">When ticked, event chains and news of Lv1–Lv4 are all injected; when unticked, only Lv3/4 news is injected, and event chains of Lv3/4 plus Lv1/2 events that have Erupted or Completed.</div>
      </div>`;

    const linkBody = `
      <div class="we-input-group">
        <label style="display:flex;align-items:center;gap:8px;cursor:pointer;">
          <input type="checkbox" id="we-memory-link-enabled" ${settings.memoryLinkEnabled === true ? 'checked' : ''}>
          Link to the Memory Engine after world evolution
        </label>
        <div style="font-size:11px;color:var(--we-text3);margin-top:3px;">When on, this round's world API output is handed to the memory API to update characters and entities, and the world digest is added as a note. A reroll of the same message only undoes old results carrying the link marker; ordinary memories and existing notes are not affected.</div>
        <button class="we-btn we-btn-primary" id="we-memory-link-now" type="button" style="width:100%;margin-top:8px;"><i class="fa-solid fa-link"></i> Link the current world info now</button>
        <div style="font-size:11px;color:var(--we-text3);margin-top:3px;">Hands the current world state to the Memory Engine right away and adds the current world digest as a note; running it again on the same message replaces the previous link result.</div>
      </div>`;

    const displayMode = settings.displayMode === 'expand' ? 'expand' : 'mask';
    const currentTheme = getStoredTheme();
    const themeOptions = WE_THEMES.map(theme =>
      `<option value="${theme.id}" ${theme.id === currentTheme ? 'selected' : ''}>${theme.name}</option>`
    ).join('');
    const displayBody = `
      <div class="we-input-group">
        <label>Color theme</label>
        <select id="we-theme-select" style="width:100%;">${themeOptions}</select>
        <div style="font-size:11px;color:var(--we-text3);margin-top:3px;">Applied instantly and remembered. Dark: Jade, Late Night, Deep Sea, Night Bloom; light: Cloud White, Early Cherry.</div>
      </div>
      <div class="we-input-group">
        <label>Home display mode</label>
        <select id="we-display-mode" style="width:100%;">
          <option value="mask" ${displayMode === 'mask' ? 'selected' : ''}>Covered (home page + open sections)</option>
          <option value="expand" ${displayMode === 'expand' ? 'selected' : ''}>Expanded (everything laid out)</option>
        </select>
        <div style="font-size:11px;color:var(--we-text3);margin-top:3px;">In expanded mode every section is laid out below the world digest, with no need to open pages.</div>
      </div>`;

    // 酒馆缓存与存档：存进当前聊天的 chat_metadata（随聊天文件保存到酒馆服务器，跨设备同步）。
    // 列表与状态在 bindEvents → setupChatcacheSection() 里动态填充。
    const chatcacheBody = `
      <div class="we-input-group">
        <label style="display:flex;align-items:center;gap:8px;cursor:pointer;">
          <input type="checkbox" id="we-sync-to-chat" ${settings.syncToChat === true ? 'checked' : ''}>
          Live cross-device sync (stored in the current chat)
        </label>
        <div style="font-size:11px;color:var(--we-text3);margin-top:3px;">When on, this chat's world state is continuously written into the SillyTavern chat file and syncs across devices with it; open the same chat on another device to pick up where you left off (on conflict, the newer version wins).<b>Does not</b>sync API keys or other global settings.</div>
      </div>
      <div class="we-input-group">
        <label style="display:flex;align-items:center;gap:8px;cursor:pointer;">
          <input type="checkbox" id="we-auto-backup" ${settings.autoBackup === true ? 'checked' : ''}>
          Rolling auto backup (saves one each time the round advances, keeps the latest ${'3'})
        </label>
        <div style="font-size:11px;color:var(--we-text3);margin-top:3px;">Guards against accidental deletes and edits. Auto backups and named saves are stored in this chat and visible across devices.</div>
      </div>
      <div class="we-hint" id="we-chatcache-status" style="margin:4px 0;"></div>
      <div style="display:flex;gap:6px;flex-wrap:wrap;margin:6px 0;">
        <button class="we-btn we-btn-primary" id="we-chatcache-save">New named save</button>
        <button class="we-btn" id="we-chatcache-import">Import save</button>
        <input type="file" id="we-chatcache-import-file" accept=".json" style="display:none;">
      </div>
      <div class="we-chatcache-list" id="we-chatcache-snapshots"><div class="we-empty">No saves yet</div></div>`;

    // 批量重填世界推演：从第 1 个 AI 楼层分批推到指定楼层（清空重来）。
    const bf = (k, d) => { const v = settings[k]; return (v === undefined || v === null || v === '') ? d : v; };
    const apiAutoRetries = Math.max(0, parseInt(settings.apiAutoRetries) || 0);
    const backfillBody = `
      <div style="font-size:11px;color:var(--we-text3);margin-bottom:6px;">Starting from the first AI message, <b>in batches</b> re-evolves the world state up to the chosen message. Each batch only feeds that batch's messages, but the world state builds up batch by batch and stays coherent. <b>It clears the current world state and starts over</b> (a backup snapshot is saved automatically first).</div>
      <div style="display:flex;gap:6px;flex-wrap:wrap;">
        <div class="we-input-group" style="flex:1;min-width:90px;margin-bottom:0;"><label>AI messages per batch</label>
          <input type="number" id="we-backfill-batch" min="1" step="1" value="${bf('backfillBatchSize', 5)}"></div>
        <div class="we-input-group" style="flex:1;min-width:90px;margin-bottom:0;"><label>End message (0 = all)</label>
          <input type="number" id="we-backfill-end" min="0" step="1" value="${bf('backfillEndLayer', 0)}"></div>
        <div class="we-input-group" style="flex:1;min-width:90px;margin-bottom:0;"><label>Fault retries per batch</label>
          <input type="number" id="we-backfill-retries" min="0" step="1" value="${bf('backfillRetries', 2)}"></div>
      </div>
      <div class="we-hint" id="we-backfill-status" style="margin:6px 0;"></div>
      <div style="display:flex;gap:6px;flex-wrap:wrap;margin:6px 0;">
        <button class="we-btn we-btn-primary" id="we-backfill-start">▶ Start world evolution refill</button>
        <button class="we-btn" id="we-backfill-stop">■ Stop</button>
      </div>`;

    // [FIX] 选项卡化：返回按 section 分好的片段字典，由 renderSettingsView 归入各选项卡。
    //   每个 sec(...) 调用、body 内容、字段 id 与原先一字不改，只是不再直接拼成一串。
    const mech = (k, d) => { const v = settings[k]; return (v === undefined || v === null || v === '') ? d : v; };
    const numInput = (id, key, label, d, min, step) =>
      '<div class="we-input-group" style="flex:1;min-width:112px;margin-bottom:0;"><label>' + label + '</label>'
      + '<input type="number" id="' + id + '" min="' + min + '" step="' + step + '" value="' + mech(key, d) + '"></div>';
    const compactNumInput = (id, key, label, d, min, step) =>
      '<div class="we-input-group" style="flex:1 1 0;min-width:0;margin-bottom:0;"><label>' + label + '</label>'
      + '<input type="number" id="' + id + '" min="' + min + '" step="' + step + '" value="' + mech(key, d) + '"></div>';
    const wideNumInput = (id, key, label, d, min, step) =>
      '<div class="we-input-group" style="width:100%;margin-bottom:0;"><label>' + label + '</label>'
      + '<input type="number" id="' + id + '" min="' + min + '" step="' + step + '" value="' + mech(key, d) + '"></div>';
    const mechanicsResetButton = (group) =>
      '<div style="display:flex;justify-content:flex-end;margin-bottom:8px;">'
      + '<button class="we-btn" type="button" data-we-mechanics-reset="' + group + '"><i class="fa-solid fa-arrow-rotate-left"></i> Reset to defaults</button>'
      + '</div>';
    const regionalBody = `
      ${mechanicsResetButton('regional')}
      <div style="font-size:12px;color:var(--we-text2);line-height:1.6;margin-bottom:10px;">
        Regional incidents are purely local dice: the local system first decides whether one happens, then hands the incident type and constraints to the evolution model to write as a world change.
        The higher the chance, the more often background shocks like distant disasters, public-order incidents and broken transport links happen.
      </div>
      <div class="we-input-group">
        <label>Regional incident parameters</label>
        <div style="display:flex;gap:6px;flex-wrap:wrap;">
          ${numInput('we-local-ri-chance', 'localRegionalIncidentChancePercent', 'Trigger chance %', 3, 0, '0.1')}
          ${numInput('we-local-ri-duration', 'localRegionalIncidentDuration', 'Duration (rounds)', 5, 1, '1')}
          ${numInput('we-local-ri-cooldown', 'localRegionalIncidentCooldown', 'Cooldown after fading', 5, 1, '1')}
        </div>
      </div>`;

    const distantBody = `
      ${mechanicsResetButton('distant')}
      <div style="font-size:12px;color:var(--we-text2);line-height:1.6;margin-bottom:10px;">
        Generates one distant event chain or news item (Lv2/Lv3) with no direct link to the protagonist or the existing ledger.<br>
        Ledger threshold: how many rounds of ledger must build up before it is enabled; trigger chance: the chance of a hit on each eligible round; cooldown after success: rounds without dice after a successful generation; event chain share: the chance a hit generates an event chain, with the rest generating news.
      </div>
      <div class="we-input-group">
        <label>Distant random event parameters</label>
        <div style="display:flex;gap:6px;flex-wrap:nowrap;">
          ${compactNumInput('we-local-distant-threshold', 'localDistantEventLedgerThreshold', 'Ledger threshold', 10, 1, '1')}
          ${compactNumInput('we-local-distant-chance', 'localDistantEventChancePercent', 'Trigger chance %', 20, 0, '0.1')}
          ${compactNumInput('we-local-distant-cooldown', 'localDistantEventCooldown', 'Cooldown after success', 5, 1, '1')}
          ${compactNumInput('we-local-distant-event-percent', 'localDistantEventEventPercent', 'Event chain share %', 50, 0, '0.1')}
        </div>
      </div>`;

    const nearBody = `
      ${mechanicsResetButton('near')}
      <div style="font-size:12px;color:var(--we-text2);line-height:1.6;margin-bottom:10px;">
        Generates one nearby event chain or news item (Lv2/Lv3) with a clear causal link to the current conversation, the protagonist or their region.<br>
        Trigger chance: the chance of a hit on each eligible round; cooldown after success: rounds without dice after a successful generation; event chain share: the chance a hit generates an event chain, with the rest generating news.
      </div>
      <div class="we-input-group">
        <label>Nearby random event parameters</label>
        <div style="display:flex;gap:6px;flex-wrap:wrap;">
          ${numInput('we-local-near-chance', 'localNearEventChancePercent', 'Trigger chance %', 20, 0, '0.1')}
          ${numInput('we-local-near-cooldown', 'localNearEventCooldown', 'Cooldown after success', 5, 1, '1')}
          ${numInput('we-local-near-event-percent', 'localNearEventEventPercent', 'Event chain share %', 50, 0, '0.1')}
        </div>
      </div>`;

    const retryBody = `
      <div class="we-input-group">
        <label>API fault auto-retries (X)</label>
        <input type="number" id="we-api-auto-retries" min="0" step="1" value="${apiAutoRetries}" style="width:100%;">
        <div style="font-size:11px;color:var(--we-text3);margin-top:3px;">Retries only on faults such as connection, HTTP, timeout, empty response or unrepairable JSON; content exceeding the prompt's length or count limits is not an error.</div>
      </div>`;

    const diceBody = `
      ${mechanicsResetButton('dice')}
      <div style="font-size:12px;color:var(--we-text2);line-height:1.65;margin-bottom:10px;">
        Each event chain rolls 1d100 per round. Let stage progress r = current step / 9.<br>
        Target T = stage base - 200 × r × (1 - r) + Lv modifier - global advance modifier.<br>
        If roll &gt; T: advance one step; if roll &lt; T × setback factor: go back one step; otherwise hold.<br>
        Conflict Lv modifier = -(Lv - 1) × 10; the higher the Lv, the easier it erupts. Progress Lv modifier = +(Lv - 1) × 10; the higher the Lv, the harder it completes.
      </div>
      <div class="we-input-group">
        <label>Event dice formula parameters</label>
        <div style="margin-bottom:6px;">
          ${wideNumInput('we-local-dice-mod', 'localEventDiceModifier', 'Global advance modifier', 0, -100, '1')}
        </div>
        <div style="display:flex;gap:6px;flex-wrap:wrap;">
          ${numInput('we-local-setback-ratio', 'localEventSetbackRatioPercent', 'Setback factor %', 40, 0, '1')}
          ${numInput('we-local-progress-fail-base', 'localProgressFailBase', 'Progress floor A', 2, 0, '1')}
          ${numInput('we-local-conflict-fail-base', 'localConflictFailBase', 'Conflict floor B', 6, 1, '1')}
        </div>
        <div style="font-size:11px;color:var(--we-text3);margin-top:3px;">
          Floor formula: progress max consecutive failures = A + Lv; conflict max consecutive failures = max(1, B - Lv). On reaching the limit it is forced to advance one step.
        </div>
      </div>`;

    const winddecayBody = `
      ${mechanicsResetButton('winddecay')}
      <div style="font-size:12px;color:var(--we-text2);line-height:1.65;margin-bottom:10px;">
        When a news item is not updated with the same ID this round, its quiet rounds +1. While quiet rounds ≤ grace, fading is not checked.<br>
        After grace: n = quiet rounds - grace - 1.<br>
        Fade chance P = clamp(base + linear × n + quadratic × n² - (Lv - 1) × 10, 5, 95).<br>
        Roll 1d100; if roll ≤ P, the news fades. The higher the Lv, the less likely it fades.
      </div>
      <div class="we-input-group">
        <label>News fading formula parameters</label>
        ${['Rumor:Rumor:25:1:5:3','Sentiment:Sentiment:8:5:2:1','Report:Report:20:2:4:2','Announcement:Announcement:10:4:3:1'].map(row => {
          const p = row.split(':');
          return '<div style="display:flex;gap:6px;flex-wrap:wrap;margin-bottom:6px;">'
            + '<div style="width:42px;color:var(--we-text2);font-size:12px;align-self:center;">' + p[1] + '</div>'
            + numInput('we-local-wind-' + p[0].toLowerCase() + '-base', 'localWind' + p[0] + 'Base', 'base', p[2], 0, '1')
            + numInput('we-local-wind-' + p[0].toLowerCase() + '-grace', 'localWind' + p[0] + 'Grace', 'grace', p[3], 0, '1')
            + numInput('we-local-wind-' + p[0].toLowerCase() + '-linear', 'localWind' + p[0] + 'Linear', 'linear', p[4], 0, '1')
            + numInput('we-local-wind-' + p[0].toLowerCase() + '-quadratic', 'localWind' + p[0] + 'Quadratic', 'quadratic', p[5], 0, '1')
            + '</div>';
        }).join('')}
      </div>`;

    const retentionBody = `
      ${mechanicsResetButton('retention')}
      <div style="font-size:12px;color:var(--we-text2);line-height:1.65;margin-bottom:10px;">
        This controls "how long things stay in the panel" and "how many of each kind are kept".<br>
        Rounds kept for positive final events (Erupted / Completed) = base retention + Lv × extra retention per level.<br>
        Negative final events (Dissipated / Failed) are cleared the next round; influence chains, resolved enemies and the ledger are each cleared by their own retention rounds.
      </div>
      <div class="we-input-group">
        <label>Retention rounds</label>
        <div style="display:flex;gap:6px;flex-wrap:wrap;">
          ${numInput('we-local-terminal-base', 'localTerminalBaseKeepRounds', 'Base retention for final events', 2, 0, '1')}
          ${numInput('we-local-terminal-level', 'localTerminalLevelKeepRounds', 'Extra retention per level', 2, 0, '1')}
          ${numInput('we-local-influence-keep', 'localInfluenceKeepRounds', 'Influence chain retention', 8, 1, '1')}
          ${numInput('we-local-enemy-keep', 'localEnemyTerminalKeepRounds', 'Resolved enemy retention', 20, 1, '1')}
          ${numInput('we-local-ledger-keep', 'localLedgerKeepRounds', 'Ledger retention (rounds)', 20, 1, '1')}
        </div>
      </div>
      <div class="we-input-group">
        <label>Capacity limits</label>
        <div style="display:flex;gap:6px;flex-wrap:wrap;">
          ${numInput('we-local-cap-events', 'localCapEvents', 'Event limit', 16, 1, '1')}
          ${numInput('we-local-cap-factions', 'localCapFactions', 'Faction limit', 15, 1, '1')}
          ${numInput('we-local-cap-winds', 'localCapWinds', 'News limit', 12, 1, '1')}
          ${numInput('we-local-cap-trends', 'localCapWorldTrends', 'Trend limit', 4, 1, '1')}
          ${numInput('we-local-cap-influence', 'localCapInfluence', 'Influence chain limit', 12, 1, '1')}
          ${numInput('we-local-cap-enemies', 'localCapEnemies', 'Enemy limit', 8, 1, '1')}
          ${numInput('we-local-cap-econ', 'localCapEconomySignals', 'Economic signal limit', 8, 1, '1')}
          ${numInput('we-local-cap-blackbox', 'localCapBlackbox', 'Black box total limit', 12, 1, '1')}
        </div>
      </div>`;

    return {
      api: sec('set-api', 'API configuration', apiBody),
      evolve: sec('set-evolve', 'Evolution mode', evolveBody),
      backfill: sec('set-backfill', 'Batch refill of world evolution', backfillBody),
      retry: sec('set-api-retry', 'API auto-retry', retryBody),
      mechanics: sec('set-regional', 'Regional incidents', regionalBody)
        + sec('set-near', 'Nearby random events', nearBody)
        + sec('set-distant', 'Distant random events', distantBody)
        + sec('set-dice', 'Event dice', diceBody)
        + sec('set-winddecay', 'News fading', winddecayBody)
        + sec('set-retention', 'Retention limits', retentionBody),
      filter: sec('set-filter', 'Input/output filter', filterBody),
      display: sec('set-display', 'Display', displayBody),
      chatcache: sec('set-chatcache', 'SillyTavern cache and saves', chatcacheBody),
      inject: sec('set-inject', 'Story injection', injectBody),
      link: sec('set-world-memory-link', 'World → Memory', linkBody)
    };
  }

  function renderSettingsAfterCheckpoint(options) {
    const memoryScope = options?.scope === 'memory';
    const settings = memoryScope
      ? (window.MEMORY_ENGINE_SETTINGS?.getSettings() || {})
      : ((window.WORLD_ENGINE_API && window.WORLD_ENGINE_API.getSettings) ? window.WORLD_ENGINE_API.getSettings() : {});
    const sec = (id, title, body) =>
      '<div class="we-section"><div class="we-section-title">' + sectionHeader(title, id) + '</div>' +
      sectionBody(id, body) + '</div>';
    const worldbookBody = `
      <div class="we-worldbook-settings">
        <div class="we-input-group">
          <label style="display:flex;align-items:center;gap:8px;cursor:pointer;">
            <input type="checkbox" id="we-worldbook-trigger" ${settings.worldbookTrigger === true ? 'checked' : ''}>
            Enable blue/green triggers (follow SillyTavern World Info)
          </label>
          <div style="font-size:11px;color:var(--we-text3);margin-top:3px;">When off: all selected entries are injected into the evolution (current behavior). When on: 🔵 constant entries are always injected, and 🟢 keyword entries only when recent conversation hits their keywords; each entry can be overridden on its own. Keyword scanning is done by this extension itself, independent of SillyTavern.</div>
        </div>
        <div class="we-worldbook-header">
          <div><div class="we-worldbook-summary" id="we-worldbook-summary">Reading the current chat's World Info...</div></div>
          <button class="we-icon-btn" id="we-worldbook-reload" title="Reload the current chat's World Info"><i class="fa-solid fa-rotate"></i></button>
        </div>
        <div class="we-worldbook-toolbar">
          <button class="we-btn" id="we-worldbook-select-all">Select all</button>
          <button class="we-btn" id="we-worldbook-clear-all">Deselect all</button>
          <button class="we-btn we-btn-primary" id="we-worldbook-save">Save World Info selection</button>
        </div>
        <div class="we-worldbook-list" id="we-worldbook-list"><div class="we-empty">Reading...</div></div>
      </div>`;
    const dataBody = `
      <div style="display:flex;gap:6px;flex-wrap:wrap;">
        <button class="we-btn" id="we-export-data">Export JSON</button>
        <button class="we-btn" id="we-import-data">Import JSON</button>
        <input type="file" id="we-import-file" accept=".json" style="display:none;">
      </div>`;
    const toneBody = `
      <div style="display:flex;gap:6px;flex-wrap:wrap;">
        <button class="we-btn" id="we-tone-import">Import</button>
        <button class="we-btn" id="we-tone-export">Export</button>
        <button class="we-btn" id="we-tone-clear">Clear</button>
        <input type="file" id="we-tone-file" accept=".txt" style="display:none;">
      </div>
      <div class="we-hint" id="we-tone-status" style="margin-top:6px;"></div>`;
    // [FIX] 选项卡化：同样返回片段字典
    return {
      worldbook: sec('set-worldbook', memoryScope ? 'Memory World Info' : 'Evolution World Info', worldbookBody),
      data: sec('set-data', 'Data import/export', dataBody),
      tone: sec('set-tone', 'Additional prompt', toneBody)
    };
  }

  function bindEvents(state) {
    const themeSelect = document.getElementById('we-theme-select');
    if (themeSelect) themeSelect.onchange = () => setTheme(themeSelect.value);
    const memoryThemeSelect = document.getElementById('we-memory-theme-select');
    if (memoryThemeSelect) memoryThemeSelect.onchange = () => setMemoryTheme(memoryThemeSelect.value);

    document.querySelectorAll('[data-we-mechanics-reset]').forEach(button => {
      button.onclick = () => {
        const group = button.dataset.weMechanicsReset;
        const defaults = MECHANICS_DEFAULT_FIELDS[group];
        if (!defaults) return;
        for (const [id, value] of Object.entries(defaults)) {
          const input = document.getElementById(id);
          if (input) value === null ? input.value = '' : input.value = String(value);
        }
        showToast('This section\'s defaults were restored; they take effect after you click "Save settings"');
      };
    });

    document.querySelectorAll('.we-event-delete').forEach(button => {
      button.onclick = () => {
        const scope = button.dataset.eventScope;
        const index = Number(button.dataset.eventIndex);
        const scopedState = loadScopedState(scope);
        const event = scopedState?.events?.[index];
        if (!event || !confirm(`Delete event "${event.name}"?`)) return;
        scopedState.events.splice(index, 1);
        editingEvent = null;
        saveScopedState(scope, scopedState);
        showToast('Event deleted');
        refresh();
      };
    });

    document.querySelectorAll('.we-event-copy').forEach(button => {
      button.onclick = () => {
        const scope = button.dataset.eventScope;
        const index = Number(button.dataset.eventIndex);
        const scopedState = loadScopedState(scope);
        const event = scopedState?.events?.[index];
        if (!event) return;
        const copy = JSON.parse(JSON.stringify(event));
        delete copy.id;
        delete copy.evolveResult;
        core.ensureEventFields(copy);
        core.assignEntityId(scopedState.events, copy, core.ENTITY_ID_PREFIXES.events);
        scopedState.events.push(copy);
        saveScopedState(scope, scopedState);
        showToast('Event copied to the end of the list');
        refresh();
      };
    });

    document.querySelectorAll('.we-event-edit').forEach(button => {
      button.onclick = () => {
        editingEvent = {
          scope: button.dataset.eventScope,
          index: Number(button.dataset.eventIndex)
        };
        refresh();
      };
    });

    document.querySelectorAll('.we-event-editor-close').forEach(button => {
      button.onclick = () => {
        editingEvent = null;
        refresh();
      };
    });

    document.querySelectorAll('.we-event-edit-type').forEach(select => {
      select.onchange = () => {
        const stageSelect = select.closest('.we-event-editor').querySelector('.we-event-edit-stage');
        const stages = select.value === 'progress'
          ? ['Preparing', 'Underway', 'Critical', 'Completed', 'Failed']
          : ['Brewing', 'Escalating', 'Imminent', 'Erupted', 'Dissipated'];
        stageSelect.innerHTML = stages.map(stage => `<option value="${stage}">${stage}</option>`).join('');
      };
    });

    document.querySelectorAll('.we-event-editor-save').forEach(button => {
      button.onclick = () => {
        const editor = button.closest('.we-event-editor');
        const scope = editor.dataset.eventScope;
        const index = Number(editor.dataset.eventIndex);
        const scopedState = loadScopedState(scope);
        const event = scopedState?.events?.[index];
        if (!event) return;

        const name = editor.querySelector('.we-event-edit-name').value.trim();
        if (!name) {
          showToast('Event name cannot be empty', true);
          return;
        }
        event.name = name;
        event.level = Number(editor.querySelector('.we-event-edit-level').value);
        event.type = editor.querySelector('.we-event-edit-type').value;
        event.stage = editor.querySelector('.we-event-edit-stage').value;
        event.stageRound = Math.min(9, Math.max(1, Number(editor.querySelector('.we-event-edit-round').value) || 1));
        event.desc = editor.querySelector('.we-event-edit-desc').value.trim();
        event.consecutiveFails = 0;
        delete event.evolveResult;

        // 剩余轮数 → 反推 _terminalSince（仅正面终局）
        const POSITIVE_TERMINALS = ['Erupted', 'Completed'];
        if (POSITIVE_TERMINALS.includes(event.stage)) {
          const K = localTerminalKeepRounds(event);
          const curRound = scopedState.round || 0;
          let left = Number(editor.querySelector('.we-event-edit-left').value);
          left = Number.isFinite(left) && left >= 1 ? Math.min(K, left) : K;
          event._terminalSince = curRound - K + left - 1;
        } else {
          delete event._terminalSince;
        }
        core.ensureEventFields(event);
        saveScopedState(scope, scopedState);
        editingEvent = null;
        showToast('Event changes saved');
        refresh();
      };
    });

    // 势力编辑器事件
    document.querySelectorAll('.we-faction-edit').forEach(button => {
      button.onclick = () => {
        editingFaction = { scope: button.dataset.factionScope, index: Number(button.dataset.factionIndex) };
        refresh();
      };
    });
    document.querySelectorAll('.we-faction-editor-close').forEach(button => {
      button.onclick = () => { editingFaction = null; refresh(); };
    });
    document.querySelectorAll('.we-faction-editor-save').forEach(button => {
      button.onclick = () => {
        const editor = button.closest('.we-event-editor');
        const scope = editor.dataset.factionScope;
        const index = Number(editor.dataset.factionIndex);
        const state = loadScopedState(scope);
        const faction = state.factions?.[index];
        if (!faction) return;
        const name = editor.querySelector('.we-faction-edit-name').value.trim();
        if (!name) { showToast('Faction name cannot be empty', true); return; }
        faction.name = name;
        faction.status = editor.querySelector('.we-faction-edit-status').value;
        faction.relation = editor.querySelector('.we-faction-edit-relation').value;
        faction.scope = editor.querySelector('.we-faction-edit-scope').value.trim();
        faction.currentGoal = editor.querySelector('.we-faction-edit-goal').value.trim();
        faction.core_person = editor.querySelector('.we-faction-edit-core').value.trim();
        const pillars = [];
        editor.querySelectorAll('.we-faction-edit-pillar').forEach(input => {
          const v = core.clipPillar(input.value);
          if (v) pillars.push(v);
        });
        faction.powerPillars = pillars;
        saveScopedState(scope, state);
        editingFaction = null;
        showToast('Faction changes saved');
        refresh();
      };
    });
    document.querySelectorAll('.we-faction-delete').forEach(button => {
      button.onclick = () => {
        const scope = button.dataset.factionScope;
        const index = Number(button.dataset.factionIndex);
        const state = loadScopedState(scope);
        const faction = state.factions?.[index];
        if (!faction || !confirm(`Delete faction "${faction.name}"?`)) return;
        state.factions.splice(index, 1);
        saveScopedState(scope, state);
        showToast('Faction deleted');
        refresh();
      };
    });
    document.querySelectorAll('.we-faction-copy').forEach(button => {
      button.onclick = () => {
        const scope = button.dataset.factionScope;
        const index = Number(button.dataset.factionIndex);
        const state = loadScopedState(scope);
        const faction = state.factions?.[index];
        if (!faction) return;
        const copy = JSON.parse(JSON.stringify(faction));
        delete copy.id;
        core.assignEntityId(state.factions, copy, core.ENTITY_ID_PREFIXES.factions);
        state.factions.splice(index + 1, 0, copy);
        saveScopedState(scope, state);
        showToast('Faction copied');
        refresh();
      };
    });

    // 风声编辑器事件
    document.querySelectorAll('.we-wind-edit').forEach(button => {
      button.onclick = () => {
        editingWind = { scope: button.dataset.windScope, index: Number(button.dataset.windIndex) };
        refresh();
      };
    });
    document.querySelectorAll('.we-wind-editor-close').forEach(button => {
      button.onclick = () => { editingWind = null; refresh(); };
    });
    document.querySelectorAll('.we-wind-editor-save').forEach(button => {
      button.onclick = () => {
        const editor = button.closest('.we-event-editor');
        const scope = editor.dataset.windScope;
        const index = Number(editor.dataset.windIndex);
        const scopedState = loadScopedState(scope);
        const wind = scopedState.winds?.[index];
        if (!wind) return;
        const topic = editor.querySelector('.we-wind-edit-topic').value.trim();
        if (!topic) { showToast('News topic cannot be empty', true); return; }
        wind.topic = topic;
        wind.type = editor.querySelector('.we-wind-edit-type').value;
        wind.level = Number(editor.querySelector('.we-wind-edit-level').value);
        wind.scope = editor.querySelector('.we-wind-edit-scope').value.trim();
        wind.source = editor.querySelector('.we-wind-edit-source').value.trim();
        wind.content = editor.querySelector('.we-wind-edit-content').value.trim();
        wind.quietRounds = 0;
        saveScopedState(scope, scopedState);
        editingWind = null;
        showToast('News changes saved');
        refresh();
      };
    });
    document.querySelectorAll('.we-wind-delete').forEach(button => {
      button.onclick = () => {
        const scope = button.dataset.windScope;
        const index = Number(button.dataset.windIndex);
        const scopedState = loadScopedState(scope);
        const wind = scopedState.winds?.[index];
        if (!wind || !confirm(`Delete news "${wind.topic}"?`)) return;
        scopedState.winds.splice(index, 1);
        saveScopedState(scope, scopedState);
        showToast('News deleted');
        refresh();
      };
    });
    document.querySelectorAll('.we-wind-copy').forEach(button => {
      button.onclick = () => {
        const scope = button.dataset.windScope;
        const index = Number(button.dataset.windIndex);
        const scopedState = loadScopedState(scope);
        const wind = scopedState.winds?.[index];
        if (!wind) return;
        const copy = JSON.parse(JSON.stringify(wind));
        delete copy.id;
        copy.quietRounds = 0;
        core.assignEntityId(scopedState.winds, copy, core.ENTITY_ID_PREFIXES.winds);
        scopedState.winds.push(copy);
        saveScopedState(scope, scopedState);
        showToast('News copied');
        refresh();
      };
    });

    // ===== 天下大势编辑器事件 =====
    document.querySelectorAll('.we-trend-edit').forEach(button => {
      button.onclick = () => {
        editingTrend = { scope: button.dataset.trendScope, index: Number(button.dataset.trendIndex) };
        refresh();
      };
    });
    document.querySelectorAll('.we-trend-editor-close').forEach(button => {
      button.onclick = () => { editingTrend = null; refresh(); };
    });
    document.querySelectorAll('.we-trend-editor-save').forEach(button => {
      button.onclick = () => {
        const editor = button.closest('.we-event-editor');
        const scope = editor.dataset.trendScope;
        const index = Number(editor.dataset.trendIndex);
        const scopedState = loadScopedState(scope);
        const trend = scopedState?.worldTrends?.[index];
        if (!trend) return;
        const name = editor.querySelector('.we-trend-edit-name').value.trim();
        if (!name) { showToast('Trend name cannot be empty', true); return; }
        trend.name = name;
        trend.status = editor.querySelector('.we-trend-edit-status').value;
        trend.scope = editor.querySelector('.we-trend-edit-scope').value.trim();
        trend.source = editor.querySelector('.we-trend-edit-source').value.trim();
        trend.description = editor.querySelector('.we-trend-edit-desc').value.trim();
        saveScopedState(scope, scopedState);
        editingTrend = null;
        showToast('World trend changes saved');
        refresh();
      };
    });
    document.querySelectorAll('.we-trend-delete').forEach(button => {
      button.onclick = () => {
        const scope = button.dataset.trendScope;
        const index = Number(button.dataset.trendIndex);
        const scopedState = loadScopedState(scope);
        const trend = scopedState?.worldTrends?.[index];
        if (!trend || !confirm(`Delete trend "${trend.name}"?`)) return;
        scopedState.worldTrends.splice(index, 1);
        saveScopedState(scope, scopedState);
        showToast('World trend deleted');
        refresh();
      };
    });
    document.querySelectorAll('.we-trend-copy').forEach(button => {
      button.onclick = () => {
        const scope = button.dataset.trendScope;
        const index = Number(button.dataset.trendIndex);
        const scopedState = loadScopedState(scope);
        const trend = scopedState?.worldTrends?.[index];
        if (!trend) return;
        const copy = JSON.parse(JSON.stringify(trend));
        delete copy.id;
        core.assignEntityId(scopedState.worldTrends, copy, core.ENTITY_ID_PREFIXES.worldTrends);
        scopedState.worldTrends.push(copy);
        saveScopedState(scope, scopedState);
        showToast('World trend copied');
        refresh();
      };
    });

    // ===== 仇敌编辑器事件 =====
    document.querySelectorAll('.we-enemy-edit').forEach(button => {
      button.onclick = () => {
        editingEnemy = { scope: button.dataset.enemyScope, index: Number(button.dataset.enemyIndex) };
        refresh();
      };
    });
    document.querySelectorAll('.we-enemy-editor-close').forEach(button => {
      button.onclick = () => { editingEnemy = null; refresh(); };
    });
    document.querySelectorAll('.we-enemy-editor-save').forEach(button => {
      button.onclick = () => {
        const editor = button.closest('.we-event-editor');
        const scope = editor.dataset.enemyScope;
        const index = Number(editor.dataset.enemyIndex);
        const state = loadScopedState(scope);
        const enemy = state.enemies?.[index];
        if (!enemy) return;
        const name = editor.querySelector('.we-enemy-edit-name').value.trim();
        if (!name) { showToast('Enemy name cannot be empty', true); return; }
        enemy.name = name;
        enemy.type = editor.querySelector('.we-enemy-edit-type').value;
        enemy.status = editor.querySelector('.we-enemy-edit-status').value;
        enemy.reason = editor.querySelector('.we-enemy-edit-reason').value.trim();
        saveScopedState(scope, state);
        editingEnemy = null;
        showToast('Enemy changes saved');
        refresh();
      };
    });
    document.querySelectorAll('.we-enemy-delete').forEach(button => {
      button.onclick = () => {
        const scope = button.dataset.enemyScope;
        const index = Number(button.dataset.enemyIndex);
        const state = loadScopedState(scope);
        const enemy = state.enemies?.[index];
        if (!enemy || !confirm(`Delete enemy "${enemy.name}"?`)) return;
        state.enemies.splice(index, 1);
        saveScopedState(scope, state);
        showToast('Enemy deleted');
        refresh();
      };
    });
    document.querySelectorAll('.we-enemy-copy').forEach(button => {
      button.onclick = () => {
        const scope = button.dataset.enemyScope;
        const index = Number(button.dataset.enemyIndex);
        const state = loadScopedState(scope);
        const enemy = state.enemies?.[index];
        if (!enemy) return;
        const copy = JSON.parse(JSON.stringify(enemy));
        delete copy.id;
        core.assignEntityId(state.enemies, copy, core.ENTITY_ID_PREFIXES.enemies);
        state.enemies.splice(index + 1, 0, copy);
        saveScopedState(scope, state);
        showToast('Enemy copied');
        refresh();
      };
    });

    // ===== 影响链编辑器事件 =====
    document.querySelectorAll('.we-influence-edit').forEach(button => {
      button.onclick = () => {
        editingInfluence = { scope: button.dataset.influenceScope, index: Number(button.dataset.influenceIndex) };
        refresh();
      };
    });
    document.querySelectorAll('.we-influence-editor-close').forEach(button => {
      button.onclick = () => { editingInfluence = null; refresh(); };
    });
    document.querySelectorAll('.we-influence-editor-save').forEach(button => {
      button.onclick = () => {
        const editor = button.closest('.we-event-editor');
        const scope = editor.dataset.influenceScope;
        const index = Number(editor.dataset.influenceIndex);
        const scopedState = loadScopedState(scope);
        const inf = scopedState.influenceChain?.[index];
        if (!inf) return;
        const trigger = editor.querySelector('.we-influence-edit-trigger').value.trim();
        const impact = editor.querySelector('.we-influence-edit-impact').value.trim();
        if (!trigger || !impact) { showToast('Trigger and direct impact cannot be empty', true); return; }
        inf.trigger = trigger;
        inf.impact = impact;
        inf.fallout = editor.querySelector('.we-influence-edit-fallout').value.trim();
        saveScopedState(scope, scopedState);
        editingInfluence = null;
        showToast('Influence chain changes saved');
        refresh();
      };
    });
    document.querySelectorAll('.we-influence-delete').forEach(button => {
      button.onclick = () => {
        const scope = button.dataset.influenceScope;
        const index = Number(button.dataset.influenceIndex);
        const scopedState = loadScopedState(scope);
        const inf = scopedState.influenceChain?.[index];
        if (!inf || !confirm(`Delete influence chain "${inf.trigger}"?`)) return;
        scopedState.influenceChain.splice(index, 1);
        saveScopedState(scope, scopedState);
        showToast('Influence chain deleted');
        refresh();
      };
    });
    document.querySelectorAll('.we-influence-copy').forEach(button => {
      button.onclick = () => {
        const scope = button.dataset.influenceScope;
        const index = Number(button.dataset.influenceIndex);
        const scopedState = loadScopedState(scope);
        const inf = scopedState.influenceChain?.[index];
        if (!inf) return;
        const copy = JSON.parse(JSON.stringify(inf));
        copy._createdRound = Number(scopedState.round) || 0;
        scopedState.influenceChain.push(copy);
        saveScopedState(scope, scopedState);
        showToast('Influence chain copied');
        refresh();
      };
    });

    // ===== 区域事件编辑器事件 =====
    document.querySelectorAll('.we-ri-edit').forEach(button => {
      button.onclick = () => {
        editingRI = { active: true, scope: button.dataset.riScope };
        refresh();
      };
    });
    document.querySelectorAll('.we-ri-editor-close').forEach(button => {
      button.onclick = () => { editingRI = null; refresh(); };
    });
    document.querySelectorAll('.we-ri-editor-save').forEach(button => {
      button.onclick = () => {
        const editor = button.closest('.we-event-editor');
        const scope = editor.dataset.riScope;
        const state = loadScopedState(scope);
        if (!state.regionalIncident) {
          state.regionalIncident = { active: false, title: '', type: '', scope: '', impact: '', duration: 0, cooldown: 0, _retry: false, _retryType: '' };
        }
        const ri = state.regionalIncident;
        ri.active = editor.querySelector('.we-ri-edit-active').value === 'true';
        ri.title = editor.querySelector('.we-ri-edit-title').value.trim();
        ri.type = editor.querySelector('.we-ri-edit-type').value;
        ri.scope = editor.querySelector('.we-ri-edit-scope').value.trim();
        ri.duration = Math.max(0, Number(editor.querySelector('.we-ri-edit-duration').value) || 0);
        ri.cooldown = Math.max(0, Number(editor.querySelector('.we-ri-edit-cooldown').value) || 0);
        ri.impact = editor.querySelector('.we-ri-edit-impact').value.trim();
        saveScopedState(scope, state);
        editingRI = null;
        showToast('Regional incident changes saved');
        refresh();
      };
    });
    document.querySelectorAll('.we-ri-delete').forEach(button => {
      button.onclick = () => {
        const scope = button.dataset.riScope;
        const state = loadScopedState(scope);
        if (!state.regionalIncident) return;
        if (!confirm('Clear the regional incident?')) return;
        state.regionalIncident = { active: false, title: '', type: '', scope: '', impact: '', cooldown: state.regionalIncident.cooldown || 0, _retry: false, _retryType: '' };
        saveScopedState(scope, state);
        showToast('Regional incident cleared');
        refresh();
      };
    });
    document.querySelectorAll('.we-ri-copy').forEach(button => {
      button.onclick = () => {
        const scope = button.dataset.riScope;
        const state = loadScopedState(scope);
        if (!state.regionalIncident) return;
        const copy = JSON.parse(JSON.stringify(state.regionalIncident));
        copy._retry = false;
        copy._retryType = '';
        copy.cooldown = 0;
        state.regionalIncident = copy;
        saveScopedState(scope, state);
        showToast('Regional incident copied (cooldown reset)');
        refresh();
      };
    });

    // ===== 秘密（隐秘行为/资产）统一编辑器事件 =====
    const SECRET_ARR = { action: 'secretActions', asset: 'secretAssets' };

    document.querySelectorAll('.we-secret-edit').forEach(button => {
      button.onclick = () => {
        const list = button.dataset.secretList;
        editingSecret = { scope: button.dataset.secretScope, list, index: Number(button.dataset.secretIndex), view: list };
        refresh();
      };
    });
    document.querySelectorAll('.we-secret-editor-close').forEach(button => {
      button.onclick = () => { editingSecret = null; refresh(); };
    });
    // 类型下拉：仅切换显示的表单(view)，不动数据、不保存
    document.querySelectorAll('.we-secret-type').forEach(select => {
      select.onchange = () => {
        if (editingSecret) { editingSecret.view = select.value; refresh(); }
      };
    });
    document.querySelectorAll('.we-secret-save').forEach(button => {
      button.onclick = () => {
        const editor = button.closest('.we-secret-editor');
        const scope = editor.dataset.secretScope;
        const list = editor.dataset.secretList;            // 条目当前所在桶
        const index = Number(editor.dataset.secretIndex);
        const view = editor.dataset.secretView;            // 目标类型（可能与 list 不同）
        const state = loadScopedState(scope);
        state.blackbox = state.blackbox || {};
        const srcArr = state.blackbox[SECRET_ARR[list]];
        if (!srcArr || srcArr[index] === undefined) return;

        // 按 view 读取表单，组装目标条目
        let item, okMsg;
        if (view === 'action') {
          const action = editor.querySelector('.we-secret-f-action').value.trim();
          if (!action) { showToast('Action description cannot be empty', true); return; }
          item = { action, witnesses: editor.querySelector('.we-secret-f-witnesses').value.trim() || 'None' };
        } else {
          const name = editor.querySelector('.we-secret-f-name').value.trim();
          if (!name) { showToast('Asset name cannot be empty', true); return; }
          item = {
            name,
            exposure: Math.min(100, Math.max(0, Number(editor.querySelector('.we-secret-f-exposure').value) || 0)),
            status: editor.querySelector('.we-secret-f-status').value
          };
        }

        if (view === list) {
          srcArr[index] = item;                            // 原地更新
          okMsg = view === 'action' ? 'Secret action saved' : 'Secret asset saved';
        } else {
          srcArr.splice(index, 1);                         // 从旧桶移除
          const arrKey = SECRET_ARR[view];
          if (!Array.isArray(state.blackbox[arrKey])) state.blackbox[arrKey] = [];
          state.blackbox[arrKey].push(item);               // 落入新桶 = 真正的类型转换
          okMsg = view === 'action' ? 'Converted to a secret action' : 'Converted to a secret asset';
        }
        saveScopedState(scope, state);
        editingSecret = null;
        showToast(okMsg);
        refresh();
      };
    });
    document.querySelectorAll('.we-secret-del').forEach(button => {
      button.onclick = () => {
        const scope = button.dataset.secretScope;
        const list = button.dataset.secretList;
        const index = Number(button.dataset.secretIndex);
        const state = loadScopedState(scope);
        const arr = state.blackbox?.[SECRET_ARR[list]];
        if (!arr || arr[index] === undefined) return;
        if (!confirm(list === 'action' ? 'Delete the secret action?' : 'Delete the secret asset?')) return;
        arr.splice(index, 1);
        saveScopedState(scope, state);
        showToast('Deleted');
        refresh();
      };
    });
    document.querySelectorAll('.we-secret-copy').forEach(button => {
      button.onclick = () => {
        const scope = button.dataset.secretScope;
        const list = button.dataset.secretList;
        const index = Number(button.dataset.secretIndex);
        const state = loadScopedState(scope);
        const arr = state.blackbox?.[SECRET_ARR[list]];
        if (!arr || arr[index] === undefined) return;
        arr.splice(index + 1, 0, JSON.parse(JSON.stringify(arr[index])));  // 就近插入
        saveScopedState(scope, state);
        showToast('Copied');
        refresh();
      };
    });

    // ===== 世界摘要编辑器事件（仅编辑，不提供复制或删除） =====
    document.querySelectorAll('.we-digest-edit').forEach(button => {
      button.onclick = () => {
        editingDigest = { scope: button.dataset.digestScope || 'state' };
        refresh();
      };
    });
    document.querySelectorAll('.we-digest-editor-close').forEach(button => {
      button.onclick = () => { editingDigest = null; refresh(); };
    });
    document.querySelectorAll('.we-digest-editor-save').forEach(button => {
      button.onclick = () => {
        const editor = button.closest('.we-digest-editor');
        if (!editor) return;
        const scope = editor.dataset.digestScope || 'state';
        const scopedState = loadScopedState(scope);
        const value = editor.querySelector('.we-digest-edit-text')?.value.trim() || '';
        scopedState.worldDigest = value;
        saveScopedState(scope, scopedState);
        editingDigest = null;
        showToast('World digest saved');
        refresh();
      };
    });

    // ===== 导航事件 =====
    const backBtn = document.getElementById('we-btn-back');
    if (backBtn) backBtn.onclick = () => { _currentView = 'home'; refresh(); };

    const settingsOpenBtn = document.getElementById('we-btn-settings-open');
    if (settingsOpenBtn) settingsOpenBtn.onclick = () => {
      const face = getEngineFace();
      if (typeof face.openSettings === 'function') face.openSettings();
      else if (face.id === 'world') _currentView = 'settings';
      refresh();
    };

    document.querySelectorAll('.we-nav-row[data-view]').forEach(row => {
      row.onclick = () => {
        if (_selectedNavView === row.dataset.view) {
          // 二次点击：进入分页
          _selectedNavView = null;
          _currentView = row.dataset.view;
          refresh();
        } else {
          // 首次点击：选中该行
          _selectedNavView = row.dataset.view;
          refresh();
        }
      };
    });

    // 点击导航列表以外的地方取消选中
    const panelBody = panelBodyElement;
    if (panelBody) {
      panelBody.onclick = (e) => {
        if (_currentView === 'home' && _selectedNavView && !e.target.closest('.we-nav-row')) {
          _selectedNavView = null;
          refresh();
        }
      };
    }

    // ===== 区块折叠/展开事件 =====
    document.querySelectorAll('.we-section-toggle').forEach(toggle => {
      toggle.onclick = () => {
        const sectionId = toggle.dataset.section;
        sectionCollapsed[sectionId] = !sectionCollapsed[sectionId];
        const body = document.getElementById('we-section-body-' + sectionId);
        const arrow = document.getElementById('we-section-arrow-' + sectionId);
        if (body) body.style.display = sectionCollapsed[sectionId] ? 'none' : '';
        if (arrow) arrow.textContent = sectionCollapsed[sectionId] ? '▶' : '▼';
      };
    });

    // [FIX] 设置页选项卡切换：纯 CSS 显隐，不重新渲染（保护输入内容 + 字段常驻 DOM 保证保存不丢）
    document.querySelectorAll('.we-settings-tab').forEach(tab => {
      tab.onclick = () => {
        const key = tab.dataset.tab;
        const face = getEngineFace();
        if (typeof face.onSettingsTab === 'function') face.onSettingsTab(key);
        else _settingsTab = key;
        document.querySelectorAll('.we-settings-tab').forEach(t =>
          t.classList.toggle('we-settings-tab--active', t.dataset.tab === key));
        document.querySelectorAll('.we-settings-panel').forEach(p =>
          p.style.display = (p.dataset.tab === key) ? '' : 'none');
        tab.scrollIntoView({ behavior: 'smooth', block: 'nearest', inline: 'center' });
        // [FIX] 切到调试 tab 时，局部刷新 renderDebug 拉最新一轮推演数据（不动其它 tab 输入）
        if (key === 'debug') {
          if (typeof face.refreshDebug === 'function') face.refreshDebug();
          else { refreshDebugRender(); refreshPresetManage(); }
        }
      };
    });

    // 「关于」卡内的版本下拉切换：复用 #we-preset-select 范式（点击弹出原生可滚动列表）。
    //   纯 CSS 显隐、不重渲染、不触碰其它 tab。
    const settingsTabs = document.getElementById('we-settings-tabs');
    const updateSettingsTabScroll = () => {
      if (!settingsTabs) return;
      const shell = settingsTabs.closest('.we-settings-tabs-shell');
      if (!shell) return;
      const max = Math.max(0, settingsTabs.scrollWidth - settingsTabs.clientWidth);
      shell.classList.toggle('is-left-shadow', settingsTabs.scrollLeft > 2);
      shell.classList.toggle('is-right-shadow', settingsTabs.scrollLeft < max - 2);
      shell.querySelectorAll('.we-settings-tab-scroll').forEach(btn => {
        const dir = Number(btn.dataset.dir) || 1;
        btn.disabled = max <= 2 || (dir < 0 ? settingsTabs.scrollLeft <= 2 : settingsTabs.scrollLeft >= max - 2);
      });
    };
    if (settingsTabs) {
      settingsTabs.addEventListener('scroll', updateSettingsTabScroll, { passive: true });
      const activeTab = settingsTabs.querySelector('.we-settings-tab--active');
      if (activeTab) activeTab.scrollIntoView({ block: 'nearest', inline: 'center' });
      document.querySelectorAll('.we-settings-tab-scroll').forEach(btn => {
        btn.onclick = () => {
          const dir = Number(btn.dataset.dir) || 1;
          settingsTabs.scrollBy({ left: dir * Math.max(120, settingsTabs.clientWidth * 0.65), behavior: 'smooth' });
        };
      });
      setTimeout(updateSettingsTabScroll, 0);
    }

    const clSel = document.getElementById('we-changelog-select');
    if (clSel) {
      clSel.onchange = () => {
        const ver = clSel.value;
        document.querySelectorAll('.we-changelog-panel').forEach(p =>
          p.style.display = (p.dataset.ver === ver) ? '' : 'none');
      };
    }

    const refreshBtn = document.getElementById('we-btn-refresh');
    if (refreshBtn) refreshBtn.onclick = () => refresh();

    // 旧版内联绑定保留一个版本作兼容参考，但运行时统一走 bindFilterControls(scope)。
    if (false) {
    // —— 正则过滤：状态行渲染 + 测试按钮 ——
    // 把 core.validateFilterRegex 的结果写成 we-hint 状态行（复用 chatcache/backfill 的 we-hint 范式）。
    function renderFilterStatus(v, prefix) {
      const el = document.getElementById('we-filter-status');
      if (!el) return;
      const pfx = prefix || '';
      if (!v || (!v.ok && !v.bad.length)) { el.textContent = pfx + '(no regex entered)'; return; }
      if (!v.bad.length) { el.textContent = pfx + `✅ All ${v.ok} work`; return; }
      let s = pfx + `⚠️ ${v.ok} working / ${v.bad.length} failed:`;
      for (const b of v.bad) s += `
Line ${b.line} "${b.raw}" is invalid: ${b.reason}`;
      el.textContent = s;
    }

    const testBtn = document.getElementById('we-btn-filter-test');
    if (testBtn) {
      testBtn.onclick = () => {
        const core = window.WORLD_ENGINE_CORE;
        const raw = (document.getElementById('we-filter-regex')?.value) || '';
        if (!raw.trim()) { showToast('No regex entered', true); renderFilterStatus(null); return; }
        if (!core || !core.validateFilterRegex) { showToast('core module unavailable', true); return; }
        const v = core.validateFilterRegex(raw);
        if (v.bad.length) { renderFilterStatus(v, 'Test aborted — '); showToast(`${v.bad.length} regexes are invalid; fix them first`, true); return; }
        // 取最近一条非空对话文本（不限 user/ai，沿用 manualEvolve 取 chat 的范式）
        let sample = '';
        try {
          const ctx = SillyTavern.getContext();
          const chat = (ctx && ctx.chat) || [];
          for (let i = chat.length - 1; i >= 0; i--) {
            const t = chat[i] && String(chat[i].mes || '').trim();
            if (t) { sample = String(chat[i].mes); break; }
          }
        } catch (e) {}
        if (!sample) { showToast('The current chat has no text to test', true); return; }
        // 跑过滤 + 按顺序累计删除处数（与 filterDialogue 同序：每条在前一条的结果上 replace）
        let removed = 0, work = sample;
        for (const e of v.entries) {
          try {
            const re = new RegExp(e.pattern, e.flags);
            let m, n = 0;
            while ((m = re.exec(work)) !== null) { n++; if (m.index === re.lastIndex) re.lastIndex++; }
            work = work.replace(re, '');
            removed += n;
          } catch (err) { /* 不会进入 */ }
        }
        const filtered = work;
        const before = sample.slice(0, 60), after = filtered.slice(0, 60);
        const el = document.getElementById('we-filter-status');
        if (el) el.textContent = `Removed ${removed} matches.
Before: ${before}${sample.length > 60 ? '…' : ''}
After: ${after}${filtered.length > 60 ? '…' : ''}`;
        showToast(`Removed ${removed} matches`);
      };
    }

    // —— 正则过滤「简单模式」：勾选标签自动生成 <tag>[\s\S]*?</tag>\n? ——
    // 解耦：底层仍是 #we-filter-regex 文本框(evolveFilterRegex 字段)为唯一真相源。
    //   勾选 ↔ 文本框双向同步；非 <tag> 形式的行(用户手写杂项)原样保留，不进勾选清单。
    // 反解析只认标准 <tag>...</tag> 形式；带 ~? / 带属性 / /pat/g / 纯 pattern 杂项 → 视为高级手写，保留。
    const SIMPLE_TAG_LINE = /^<([a-zA-Z_][\w-]*)>[\s\S]*?<\/\1>(?:\\n\?)?$/;
    const SCAN_TAG_RE = /<([a-zA-Z_][\w-]*)/g;

    // 当前标签清单：{ name, checked }[]。无状态派生物，从 textarea 反解析 + 扫描/手动添加累积。
    let _filterTags = [];

    // 从 textarea 反解析出标准 <tag> 形式的勾选标签（非标准行视为高级手写，返回 tags + 保留的杂项行）
    function parseTextareaTags(raw) {
      const tags = [];
      const advanced = [];
      for (const line of String(raw || '').split('\n')) {
        const m = line.match(SIMPLE_TAG_LINE);
        if (m) { if (!tags.includes(m[1])) tags.push(m[1]); }
        else if (line.trim()) advanced.push(line);
      }
      return { tags, advanced };
    }

    // 勾选标签 → 生成标准模板行；与高级手写行合并写回 textarea
    function writeTextareaFromTags(checkedTags, advancedLines) {
      const tagLines = checkedTags.map(t => `<${t}>[\\s\\S]*?</${t}>\\n?`);
      const all = tagLines.concat(advancedLines);
      const ta = document.getElementById('we-filter-regex');
      if (ta) ta.value = all.join('\n');
    }

    // 渲染勾选清单 chip 列表
    function renderFilterTags() {
      const box = document.getElementById('we-filter-tags');
      if (!box) return;
      box.innerHTML = '';
      for (const t of _filterTags) {
        const chip = document.createElement('label');
        chip.style.cssText = 'display:inline-flex;align-items:center;gap:3px;padding:2px 6px;border:1px solid var(--we-border,#3a3a3a);border-radius:3px;font-size:12px;cursor:pointer;';
        const cb = document.createElement('input');
        cb.type = 'checkbox'; cb.checked = !!t.checked;
        cb.onchange = () => {
          t.checked = cb.checked;
          syncTextareaFromTags();
        };
        const name = document.createElement('span'); name.textContent = t.name;
        const del = document.createElement('span');
        del.textContent = '✕'; del.style.cssText = 'color:var(--we-text3);cursor:pointer;margin-left:2px;';
        del.onclick = (e) => { e.preventDefault(); _filterTags = _filterTags.filter(x => x.name !== t.name); renderFilterTags(); syncTextareaFromTags(); };
        chip.appendChild(cb); chip.appendChild(name); chip.appendChild(del);
        box.appendChild(chip);
      }
    }

    // 勾选变化 → 写回 textarea（保留高级手写行）
    function syncTextareaFromTags() {
      const ta = document.getElementById('we-filter-regex');
      const raw = ta ? ta.value : '';
      const { advanced } = parseTextareaTags(raw);
      const checked = _filterTags.filter(t => t.checked).map(t => t.name);
      writeTextareaFromTags(checked, advanced);
    }

    // textarea 手改 → 反解析更新勾选清单（保留清单里已有的非标准标签的勾选态）
    let _taSyncTimer = null;
    function syncTagsFromTextarea() {
      const ta = document.getElementById('we-filter-regex');
      if (!ta) return;
      const { tags } = parseTextareaTags(ta.value);
      // tags 是 textarea 里标准 <tag> 行对应的标签名（视为已勾选）
      const tagSet = new Set(tags);
      // 已在清单里的：按 textarea 是否还认它更新 checked；不在清单里的标准标签：加进去（勾选）
      for (const t of _filterTags) t.checked = tagSet.has(t.name);
      for (const name of tags) {
        if (!_filterTags.some(t => t.name === name)) _filterTags.push({ name, checked: true });
      }
      renderFilterTags();
    }

    // 扫描最新一条 AI 回复，提取其中出现的 <xxx 标签名
    function scanTagsFromLastAI() {
      let text = '';
      try {
        const ctx = SillyTavern.getContext();
        const chat = (ctx && ctx.chat) || [];
        for (let i = chat.length - 1; i >= 0; i--) {
          const m = chat[i];
          if (m && !m.is_user && String(m.mes || '').trim()) { text = String(m.mes); break; }
        }
      } catch (e) {}
      if (!text) { showToast('No AI reply found', true); return; }
      const found = [];
      let m;
      SCAN_TAG_RE.lastIndex = 0;
      while ((m = SCAN_TAG_RE.exec(text)) !== null) {
        const name = m[1];
        if (name && !found.includes(name)) found.push(name);
      }
      if (!found.length) { showToast('No tags found in the latest AI reply', true); return; }
      // 合并进清单：已有的保留勾选态，新发现的默认勾选
      for (const name of found) {
        if (!_filterTags.some(t => t.name === name)) _filterTags.push({ name, checked: true });
      }
      renderFilterTags();
      syncTextareaFromTags();
      showToast(`Found ${found.length} tags`);
    }

    // 绑定：扫描按钮
    const scanBtn = document.getElementById('we-btn-filter-scan');
    if (scanBtn) scanBtn.onclick = scanTagsFromLastAI;

    // 绑定：手动添加
    const addBtn = document.getElementById('we-btn-filter-add');
    const addInput = document.getElementById('we-filter-add-input');
    function doAddTag() {
      const v = (addInput && addInput.value || '').trim();
      if (!v) return;
      if (!/^[a-zA-Z_][\w-]*$/.test(v)) { showToast('Invalid tag name (only letters, digits, underscores and hyphens)', true); return; }
      if (!_filterTags.some(t => t.name === v)) _filterTags.push({ name: v, checked: true });
      if (addInput) addInput.value = '';
      renderFilterTags();
      syncTextareaFromTags();
    }
    if (addBtn) addBtn.onclick = doAddTag;
    if (addInput) addInput.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); doAddTag(); } });

    // 绑定：textarea 手改 → 反解析更新勾选（防抖）
    const filterTa = document.getElementById('we-filter-regex');
    if (filterTa) filterTa.addEventListener('input', () => {
      clearTimeout(_taSyncTimer);
      _taSyncTimer = setTimeout(syncTagsFromTextarea, 300);
    });

    // 初始化：打开设置页时从已存字段反解析出勾选状态
    syncTagsFromTextarea();
    }
    bindFilterControls('world');
    bindFilterControls('memory');

    const memoryLinkNow = document.getElementById('we-memory-link-now');
    if (memoryLinkNow) {
      memoryLinkNow.onclick = async () => {
        memoryLinkNow.disabled = true;
        try {
          const ok = await window.WORLD_ENGINE?.manualMemoryLink?.();
          showToast(ok ? 'Manual link complete; the world digest was added as a note' : 'Manual link did not finish', !ok);
        } catch (error) {
          showToast('Manual link failed: ' + (error?.message || error), true);
        } finally {
          memoryLinkNow.disabled = false;
        }
      };
    }

    const memoryHideCoveredRaw = document.getElementById('we-memory-hide-covered-raw');
    const memoryRecentRawRounds = document.getElementById('we-memory-recent-raw-rounds');
    if (memoryHideCoveredRaw && memoryRecentRawRounds) {
      const syncRawRetentionAvailability = () => {
        memoryRecentRawRounds.disabled = !memoryHideCoveredRaw.checked;
      };
      memoryHideCoveredRaw.onchange = syncRawRetentionAvailability;
      syncRawRetentionAvailability();
    }

    const memorySaveBtn = document.getElementById('we-save-memory-settings');
    if (memorySaveBtn) {
      memorySaveBtn.onclick = () => {
        const gv = id => document.getElementById(id)?.value;
        const memoryCurrent = window.MEMORY_ENGINE_SETTINGS?.getSettings(true) || {};
        const temperatureRaw = parseFloat(gv('we-temperature'));
        const timeoutSecRaw = parseFloat(gv('we-api-timeout-sec'));
        const memorySettings = {
          ...memoryCurrent,
          engineEnabled: document.getElementById('we-memory-engine-enabled')?.checked !== false,
          firstLayerIsAiOpening: document.getElementById('we-memory-first-layer-ai-opening')?.checked !== false,
          apiUrl: gv('we-api-url') || '',
          apiKey: gv('we-api-key') || '',
          model: gv('we-model') || 'gpt-3.5-turbo',
          temperature: Number.isFinite(temperatureRaw) ? Math.max(0, temperatureRaw) : 0.2,
          maxTokens: Math.max(1, parseInt(gv('we-max-tokens')) || 65000),
          apiTimeoutMs: Number.isFinite(timeoutSecRaw) ? Math.max(0, Math.round(timeoutSecRaw * 1000)) : 120000,
          connectionMode: document.getElementById('we-connection-mode')?.value === 'proxy' ? 'proxy' : 'direct',
          evolveMode: gv('we-memory-evolve-mode') === 'manual' ? 'manual' : 'auto',
          evolveEveryX: 1,
          evolveReadRounds: 1,
          manualReadRounds: 1,
          smallSummaryEveryX: 1,
          bigSummaryEveryX: Math.max(1, parseInt(gv('we-memory-big-summary-every')) || 5),
          bigSummaryInjectLimit: Math.max(1, parseInt(gv('we-memory-big-summary-inject-limit')) || 3),
          hideCoveredRawText: document.getElementById('we-memory-hide-covered-raw')?.checked !== false,
          recentRawRounds: Math.max(0, parseInt(gv('we-memory-recent-raw-rounds')) || 0),
          referenceRawRounds: Math.max(0, parseInt(gv('we-memory-reference-raw-rounds')) || 0),
          referenceSmallSummaryCount: Math.max(0, parseInt(gv('we-memory-reference-small-count')) || 0),
          referenceBigSummaryCount: Math.max(0, parseInt(gv('we-memory-reference-big-count')) || 0),
          injectIntoPrompt: document.getElementById('we-memory-inject')?.checked !== false,
          injectIntoWorldEngine: document.getElementById('we-memory-inject-world-engine')?.checked === true,
          worldEngineMemoryLimit: Math.max(1, parseInt(gv('we-memory-world-engine-limit')) || 5),
          searchDepth: Math.max(1, parseInt(gv('we-memory-search-depth')) || 5),
          maxPerCharacter: Math.max(1, parseInt(gv('we-memory-max-per-character')) || 20),
          apiAutoRetries: Math.max(0, parseInt(gv('we-memory-api-auto-retries')) || 0),
          nameBlacklist: gv('we-memory-name-blacklist') || '',
          filterRegex: gv('we-memory-filter-regex') || '',
          tonePrompt: gv('we-memory-tone-prompt') || '',
          worldbookEnabled: document.getElementById('we-memory-worldbook-enabled')?.checked === true,
          worldbookTrigger: document.getElementById('we-worldbook-trigger')?.checked === true,
          syncToChat: document.getElementById('we-memory-sync-to-chat')?.checked === true,
          autoBackup: document.getElementById('we-memory-auto-backup')?.checked === true,
          backfillBatchSize: Math.max(1, parseInt(gv('we-memory-backfill-batch')) || 5),
          summaryBackfillSmallEveryX: Math.max(1, parseInt(gv('we-memory-summary-backfill-small-every')) || 5),
          summaryBackfillBigEveryX: Math.max(1, parseInt(gv('we-memory-summary-backfill-big-every')) || 5),
          backfillEndLayer: Math.max(0, parseInt(gv('we-memory-backfill-end')) || 0),
          backfillRetries: Math.max(0, parseInt(gv('we-memory-backfill-retries')) || 0)
        };
        window.MEMORY_ENGINE_SETTINGS?.saveSettings(memorySettings);
        window.MEMORY_ENGINE?.applyInjection?.();
        showToast('Settings saved');
      };
    }

    const memoryData = window.MEMORY_ENGINE_DATA;
    const memoryCache = window.WORLD_ENGINE_CHATCACHE?.forScope?.('memory');
    const memoryExportData = document.getElementById('we-memory-export-data');
    if (memoryExportData) memoryExportData.onclick = () => {
      if (!memoryData) { showToast('Memory data module not loaded', true); return; }
      setupDownload(JSON.stringify(memoryData.exportData(), null, 2), 'memory-engine-data-' + Date.now() + '.json');
      showToast('Exported all memory data (latest state and checkpoint are labeled separately)');
    };
    const memoryImportData = document.getElementById('we-memory-import-data');
    const memoryImportDataFile = document.getElementById('we-memory-import-data-file');
    if (memoryImportData && memoryImportDataFile) {
      memoryImportData.onclick = () => memoryImportDataFile.click();
      memoryImportDataFile.onchange = async () => {
        const file = memoryImportDataFile.files?.[0];
        if (!file) return;
        try {
          const imported = memoryData.importData(JSON.parse(await file.text()));
          window.WORLD_ENGINE_CHATCACHE?.forScope?.('memory')?.afterEvolution?.();
          window.MEMORY_ENGINE?.applyInjection?.();
          showToast(`Memory data imported; progress now continues from message ${Math.max(0, Number(imported?.chatLayer) || 0)}`);
          refresh();
        } catch (error) {
          showToast('Failed to import memory data: ' + (error?.message || error), true);
        } finally {
          memoryImportDataFile.value = '';
        }
      };
    }

    const memorySnapshotSave = document.getElementById('we-memory-snapshot-save');
    if (memorySnapshotSave) memorySnapshotSave.onclick = () => {
      const name = prompt('Name this memory save:', 'Memory save ' + new Date().toLocaleString());
      if (name == null) return;
      if (memoryCache?.createSnapshot?.(name)) { showToast('Memory save created'); refresh(); }
      else showToast('Save failed (the current chat has no memory data or cannot be written)', true);
    };
    const memorySnapshotImport = document.getElementById('we-memory-snapshot-import');
    const memorySnapshotImportFile = document.getElementById('we-memory-snapshot-import-file');
    if (memorySnapshotImport && memorySnapshotImportFile) {
      memorySnapshotImport.onclick = () => memorySnapshotImportFile.click();
      memorySnapshotImportFile.onchange = async () => {
        const file = memorySnapshotImportFile.files?.[0];
        if (!file) return;
        try {
          if (memoryCache?.importSnapshot?.(JSON.parse(await file.text()))) { showToast('Memory save imported'); refresh(); }
          else showToast('Not a valid memory save file', true);
        } catch (error) {
          showToast('Failed to import memory save: ' + (error?.message || error), true);
        } finally {
          memorySnapshotImportFile.value = '';
        }
      };
    }
    document.querySelectorAll('[data-memory-snap-action]').forEach(button => {
      button.onclick = () => {
        const row = button.closest('[data-memory-snap-id]');
        const id = row?.dataset.memorySnapId;
        const item = memoryCache?.listSnapshots?.().find(entry => entry.id === id);
        if (!id || !item) return;
        const action = button.dataset.memorySnapAction;
        if (action === 'restore') {
          if (!confirm('Restore memory save "' + item.name + '"? Current memory data will be replaced.')) return;
          if (memoryCache.restoreSnapshot(id)) { showToast('Memory save restored'); refresh(); }
          else showToast('Restore failed', true);
        } else if (action === 'rename') {
          const name = prompt('New save name:', item.name);
          if (name == null) return;
          if (memoryCache.renameSnapshot(id, name)) { showToast('Renamed'); refresh(); }
        } else if (action === 'export') {
          const exported = memoryCache.exportSnapshot(id);
          if (exported) setupDownload(JSON.stringify(exported, null, 2), 'memory-snapshot-' + Date.now() + '.json');
        } else if (action === 'delete') {
          if (!confirm('Delete memory save "' + item.name + '"?')) return;
          if (memoryCache.deleteSnapshot(id)) { showToast('Deleted'); refresh(); }
        }
      };
    });

    const memoryArchiveStatus = document.getElementById('we-memory-archive-status');
    if (memoryArchiveStatus && memoryCache?.getStatus) {
      const status = memoryCache.getStatus();
      if (!status.usable) memoryArchiveStatus.textContent = 'No chat available (open a character or group chat first).';
      else if (!status.apiAvailable) memoryArchiveStatus.textContent = 'This SillyTavern version cannot write chat_metadata, so the SillyTavern cache is unavailable.';
      else memoryArchiveStatus.textContent = `Live sync ${status.syncEnabled ? 'on' : 'off'} · local revision ${status.localRev} / cloud ${status.liveRev} · ${status.snapshotCount} saves`;
    }
    const memorySyncBox = document.getElementById('we-memory-sync-to-chat');
    if (memorySyncBox) memorySyncBox.onchange = () => {
      window.MEMORY_ENGINE_SETTINGS?.patchSettings({ syncToChat: memorySyncBox.checked });
      if (memorySyncBox.checked) memoryCache?.pushLiveNow?.();
      showToast(memorySyncBox.checked ? 'Memory cross-device sync turned on' : 'Memory cross-device sync turned off');
      refresh();
    };
    const memoryAutoBackupBox = document.getElementById('we-memory-auto-backup');
    if (memoryAutoBackupBox) memoryAutoBackupBox.onchange = () => {
      window.MEMORY_ENGINE_SETTINGS?.patchSettings({ autoBackup: memoryAutoBackupBox.checked });
      showToast(memoryAutoBackupBox.checked ? 'Memory auto backup turned on' : 'Memory auto backup turned off');
    };

    const memoryBackfillStart = document.getElementById('we-memory-backfill-start');
    if (memoryBackfillStart) {
      memoryBackfillStart.onclick = async () => {
        if (window.MEMORY_ENGINE && typeof window.MEMORY_ENGINE.backfill === 'function') {
          try { await window.MEMORY_ENGINE.backfill(); }
          catch (error) { showToast(`Memory refill failed: ${error?.message || error}`, true); }
          return;
        }
        showToast('Memory Engine not loaded yet', true);
      };
    }
    const memoryRunNow = document.getElementById('we-memory-run-now');
    if (memoryRunNow) {
      memoryRunNow.onclick = async () => {
        memoryRunNow.disabled = true;
        try { await runMemoryExtract(); }
        finally { memoryRunNow.disabled = false; }
      };
    }
    const memoryBigSummaryNow = document.getElementById('we-memory-big-summary-now');
    if (memoryBigSummaryNow) {
      memoryBigSummaryNow.onclick = async () => {
        memoryBigSummaryNow.disabled = true;
        try {
          await window.MEMORY_ENGINE?.manualBigSummary?.();
          showToast('Overview complete');
          refresh();
        } catch (error) { showToast(`Overview failed: ${error?.message || error}`, true); }
        finally { memoryBigSummaryNow.disabled = false; }
      };
    }
    const memorySummaryBackfillStart = document.getElementById('we-memory-summary-backfill-start');
    if (memorySummaryBackfillStart) {
      memorySummaryBackfillStart.onclick = async () => {
        memorySummaryBackfillStart.disabled = true;
        try { await window.MEMORY_ENGINE?.backfillSummaries?.(); }
        catch (error) { showToast(`Notes and overview refill failed: ${error?.message || error}`, true); }
        finally { memorySummaryBackfillStart.disabled = false; }
      };
    }
    const memoryBackfillStop = document.getElementById('we-memory-backfill-stop');
    if (memoryBackfillStop) {
      memoryBackfillStop.onclick = () => {
        if (window.MEMORY_ENGINE && typeof window.MEMORY_ENGINE.stopBackfill === 'function') {
          window.MEMORY_ENGINE.stopBackfill();
          return;
        }
        showToast('No memory refill task is running');
      };
    }

    const saveBtn = document.getElementById('we-save-settings');
    if (saveBtn) {
      saveBtn.onclick = () => {
        const _modeRaw = document.getElementById('we-evolve-mode')?.value;
        const gv = id => document.getElementById(id)?.value;
        const temperatureRaw = parseFloat(gv('we-temperature'));
        const timeoutSecRaw = parseFloat(gv('we-api-timeout-sec'));
        const ns = {
          ...(window.WORLD_ENGINE_API ? window.WORLD_ENGINE_API.getSettings(true) : {}),
          engineEnabled: document.getElementById('we-world-engine-enabled')?.checked !== false,
          firstLayerIsAiOpening: document.getElementById('we-first-layer-ai-opening')?.checked !== false,
          apiUrl: document.getElementById('we-api-url')?.value || '',
          apiKey: document.getElementById('we-api-key')?.value || '',
          model: document.getElementById('we-model')?.value || 'gpt-3.5-turbo',
          temperature: Number.isFinite(temperatureRaw) ? Math.max(0, temperatureRaw) : 0.7,
          maxTokens: Math.max(1, parseInt(gv('we-max-tokens')) || 65000),
          apiAutoRetries: Math.max(0, parseInt(gv('we-api-auto-retries')) || 0),
          apiTimeoutMs: Number.isFinite(timeoutSecRaw) ? Math.max(0, Math.round(timeoutSecRaw * 1000)) : 120000,
          connectionMode: document.getElementById('we-connection-mode')?.value === 'proxy' ? 'proxy' : 'direct',
          injectIntoPrompt: document.getElementById('we-inject-into-prompt')?.checked !== false,
          injectMaxChars: Math.max(0, parseInt(gv('we-inject-max-chars')) || 0),
          injectAllLevels: document.getElementById('we-inject-all-levels')?.checked === true,
          memoryLinkEnabled: document.getElementById('we-memory-link-enabled')?.checked === true,
          syncToChat: document.getElementById('we-sync-to-chat')?.checked === true,
          autoBackup: document.getElementById('we-auto-backup')?.checked === true,
          evolveMode: (_modeRaw === 'manual' || _modeRaw === 'time') ? _modeRaw : 'auto',
          evolveEveryX: Math.max(1, parseInt(document.getElementById('we-evolve-everyx')?.value) || 1),
          evolveReadRounds: Math.max(1, parseInt(document.getElementById('we-evolve-readrounds')?.value) || 1),
          manualReadRounds: Math.max(1, parseInt(document.getElementById('we-manual-readrounds')?.value) || 1),
          evolveFilterRegex: gv('we-filter-regex') || '',
          displayMode: document.getElementById('we-display-mode')?.value === 'expand' ? 'expand' : 'mask',
          // 按时间模式
          evolveTimeFront: Math.max(0, parseInt(gv('we-time-front')) || 0),
          evolveTimeBack: Math.max(0, parseInt(gv('we-time-back')) || 0),
          evolveTimeRe1: gv('we-time-re1') || '', evolveTimeRe2: gv('we-time-re2') || '',
          evolveTimeRe3: gv('we-time-re3') || '', evolveTimeRe4: gv('we-time-re4') || '',
          evolveTimeRe5: gv('we-time-re5') || '', evolveTimeRe6: gv('we-time-re6') || '',
          evolveTimeMul1: parseFloat(gv('we-time-mul1')) || 0,
          evolveTimeMul2: parseFloat(gv('we-time-mul2')) || 0,
          evolveTimeMul3: parseFloat(gv('we-time-mul3')) || 0,
          evolveTimeThreshold: Math.max(1, parseInt(gv('we-time-threshold')) || 1),
          evolveTimeMaxRounds: Math.max(1, parseInt(gv('we-time-maxrounds')) || 10),
          localRegionalIncidentChancePercent: Math.min(100, Math.max(0, parseFloat(gv('we-local-ri-chance')) || 0)),
          localRegionalIncidentDuration: Math.max(1, parseInt(gv('we-local-ri-duration')) || 5),
          localRegionalIncidentCooldown: Math.max(1, parseInt(gv('we-local-ri-cooldown')) || 1),
          localDistantEventLedgerThreshold: Math.max(1, parseInt(gv('we-local-distant-threshold')) || 10),
          localDistantEventChancePercent: Math.min(100, Math.max(0, parseFloat(gv('we-local-distant-chance')) || 0)),
          localDistantEventCooldown: Math.max(1, parseInt(gv('we-local-distant-cooldown')) || 1),
          localDistantEventEventPercent: Math.min(100, Math.max(0, parseFloat(gv('we-local-distant-event-percent')) || 0)),
          localNearEventChancePercent: Math.min(100, Math.max(0, parseFloat(gv('we-local-near-chance')) || 0)),
          localNearEventCooldown: Math.max(1, parseInt(gv('we-local-near-cooldown')) || 1),
          localNearEventEventPercent: Math.min(100, Math.max(0, parseFloat(gv('we-local-near-event-percent')) || 0)),
          localEventDiceModifier: Math.min(100, Math.max(-100, parseInt(gv('we-local-dice-mod')) || 0)),
          localEventSetbackRatioPercent: Math.min(100, Math.max(0, parseFloat(gv('we-local-setback-ratio')) || 0)),
          localProgressFailBase: Math.max(0, parseInt(gv('we-local-progress-fail-base')) || 0),
          localConflictFailBase: Math.max(1, parseInt(gv('we-local-conflict-fail-base')) || 6),
          localTerminalBaseKeepRounds: Math.max(0, parseInt(gv('we-local-terminal-base')) || 0),
          localTerminalLevelKeepRounds: Math.max(0, parseInt(gv('we-local-terminal-level')) || 0),
          localInfluenceKeepRounds: Math.max(1, parseInt(gv('we-local-influence-keep')) || 8),
          localEnemyTerminalKeepRounds: Math.max(1, parseInt(gv('we-local-enemy-keep')) || 20),
          localLedgerKeepRounds: Math.max(1, parseInt(gv('we-local-ledger-keep')) || 20),
          localCapEvents: Math.max(1, parseInt(gv('we-local-cap-events')) || 16),
          localCapFactions: Math.max(1, parseInt(gv('we-local-cap-factions')) || 15),
          localCapWinds: Math.max(1, parseInt(gv('we-local-cap-winds')) || 12),
          localCapWorldTrends: Math.max(1, parseInt(gv('we-local-cap-trends')) || 4),
          localCapInfluence: Math.max(1, parseInt(gv('we-local-cap-influence')) || 12),
          localCapEnemies: Math.max(1, parseInt(gv('we-local-cap-enemies')) || 8),
          localCapEconomySignals: Math.max(1, parseInt(gv('we-local-cap-econ')) || 8),
          localCapBlackbox: Math.max(1, parseInt(gv('we-local-cap-blackbox')) || 12),
          localWindAnnouncementBase: Math.min(95, Math.max(0, parseFloat(gv('we-local-wind-announcement-base')) || 0)),
          localWindAnnouncementGrace: Math.max(0, parseInt(gv('we-local-wind-announcement-grace')) || 0),
          localWindAnnouncementLinear: Math.max(0, parseFloat(gv('we-local-wind-announcement-linear')) || 0),
          localWindAnnouncementQuadratic: Math.max(0, parseFloat(gv('we-local-wind-announcement-quadratic')) || 0),
          localWindReportBase: Math.min(95, Math.max(0, parseFloat(gv('we-local-wind-report-base')) || 0)),
          localWindReportGrace: Math.max(0, parseInt(gv('we-local-wind-report-grace')) || 0),
          localWindReportLinear: Math.max(0, parseFloat(gv('we-local-wind-report-linear')) || 0),
          localWindReportQuadratic: Math.max(0, parseFloat(gv('we-local-wind-report-quadratic')) || 0),
          localWindRumorBase: Math.min(95, Math.max(0, parseFloat(gv('we-local-wind-rumor-base')) || 0)),
          localWindRumorGrace: Math.max(0, parseInt(gv('we-local-wind-rumor-grace')) || 0),
          localWindRumorLinear: Math.max(0, parseFloat(gv('we-local-wind-rumor-linear')) || 0),
          localWindRumorQuadratic: Math.max(0, parseFloat(gv('we-local-wind-rumor-quadratic')) || 0),
          localWindSentimentBase: Math.min(95, Math.max(0, parseFloat(gv('we-local-wind-sentiment-base')) || 0)),
          localWindSentimentGrace: Math.max(0, parseInt(gv('we-local-wind-sentiment-grace')) || 0),
          localWindSentimentLinear: Math.max(0, parseFloat(gv('we-local-wind-sentiment-linear')) || 0),
          localWindSentimentQuadratic: Math.max(0, parseFloat(gv('we-local-wind-sentiment-quadratic')) || 0)
        };
        // a 不得超过 X（每次推演的轮数）
        ns.evolveReadRounds = Math.min(ns.evolveReadRounds, ns.evolveEveryX);
        window.WORLD_ENGINE_STORE.setItem('world_engine_settings', JSON.stringify(ns));
        if (window.WORLD_ENGINE_API) window.WORLD_ENGINE_API.getSettings(true);

        // [FIX] 保存后校验正则过滤：复用 core.validateFilterRegex。非法条目不阻止保存（与现有数值 clamp 范式一致），
        //   但在状态行展示生效/失败+原因，按是否有失败调整下方 toast。
        let _filterBad = 0;
        try {
          const _core = window.WORLD_ENGINE_CORE;
          if (_core && _core.validateFilterRegex) {
            const _v = _core.validateFilterRegex(ns.evolveFilterRegex);
            renderFilterStatus(_v, 'Saved: ');
            _filterBad = _v.bad.length;
          }
        } catch (e) { /* 校验失败不影响保存 */ }

        // 按时间模式：三个时间框「有值才写」，本轮对话时间写入后触发判断
        if (ns.evolveMode === 'time') {
          const stIn = gv('we-time-state');
          if (stIn != null && stIn !== '') {
            const s2 = core.loadState();
            if (s2) { s2.time = Number(stIn); core.saveState(s2); }
          }
          const cpIn = gv('we-time-checkpoint');
          if (cpIn != null && cpIn !== '') {
            const cp2 = core.restoreCheckpoint();
            if (cp2) { cp2.time = Number(cpIn); core.saveCheckpoint(cp2); }
          }
          const curIn = gv('we-time-current');
          if (curIn != null && curIn !== '') {
            window.WORLD_ENGINE?.manualTimeEvolve?.(Number(curIn));
          }
        }

        window.WORLD_ENGINE?.applyInjection?.();
        showToast(_filterBad > 0 ? `Saved, but ${_filterBad} regexes are invalid` : 'Settings saved', _filterBad > 0);
      };
    }

    // 推演模式切换：按轮显示 X/a，按时间显示时间组，手动显示手动读取轮数
    const evolveModeSel = document.getElementById('we-evolve-mode');
    if (evolveModeSel) {
      evolveModeSel.onchange = () => {
        const v = evolveModeSel.value;
        const roundShow = v === 'auto' ? '' : 'none';
        const manualShow = v === 'manual' ? '' : 'none';
        const timeShow = v === 'time' ? '' : 'none';
        const g1 = document.getElementById('we-evolve-everyx-group');
        if (g1) g1.style.display = roundShow;
        const g2 = document.getElementById('we-evolve-readrounds-group');
        if (g2) g2.style.display = roundShow;
        const g3 = document.getElementById('we-manual-readrounds-group');
        if (g3) g3.style.display = manualShow;
        const g4 = document.getElementById('we-evolve-time-group');
        if (g4) g4.style.display = timeShow;
      };
    }

    const worldbookList = document.getElementById('we-worldbook-list');
    if (worldbookList) {
      const worldbook = window.WORLD_ENGINE_WORLDBOOK;
      const worldbookScope = _engineFace;
      const summary = document.getElementById('we-worldbook-summary');
      const reloadBtn = document.getElementById('we-worldbook-reload');
      const selectAllBtn = document.getElementById('we-worldbook-select-all');
      const clearAllBtn = document.getElementById('we-worldbook-clear-all');
      const saveWorldbookBtn = document.getElementById('we-worldbook-save');

      function updateWorldbookSummary() {
        const checkboxes = [...worldbookList.querySelectorAll('.we-worldbook-entry-check')];
        const selected = checkboxes.filter(checkbox => checkbox.checked);
        const chars = selected.reduce((total, checkbox) => total + Number(checkbox.dataset.chars || 0), 0);
        if (summary) summary.textContent = `${selected.length}/${checkboxes.length} selected, about ${chars} characters`;
      }

      async function loadWorldbookEntries() {
        if (!worldbook) {
          worldbookList.innerHTML = '<div class="we-empty">World Info module not loaded</div>';
          return;
        }
        worldbookList.innerHTML = '<div class="we-empty">Reading the current chat\'s World Info...</div>';
        if (reloadBtn) reloadBtn.disabled = true;
        try {
          const entries = await worldbook.loadCurrentEntries();
          const currentChatId = worldbook.getChatId ? worldbook.getChatId() : (window.WORLD_ENGINE_CORE?.getChatId?.() || 'default');
          // 用 hasSelection() 区分"从未保存"与"保存了空数组"，避免刷新后误触发自动全选
          const isFirstVisit = worldbook.hasSelection ? !worldbook.hasSelection(worldbookScope) : false;
          const savedIds = worldbook.getSelectedIds(worldbookScope);
          _wbCachedEntries = entries;
          _wbCachedChatId = currentChatId;
          _wbCachedScope = worldbookScope;
          _wbCachedOverrides = worldbook.getOverrides ? { ...worldbook.getOverrides(worldbookScope) } : {};
          // 首次进入该聊天（存储中无记录）则自动全选启用条目
          if (isFirstVisit && entries.length) {
            const allIds = entries.filter(e => !e.disabled).map(e => e.id);
            worldbook.saveSelectedIds(allIds, worldbookScope);
            _wbCachedSelectedIds = new Set(allIds);
            showToast(`Automatically selected all ${allIds.length} World Info entries`);
          } else {
            const enabledIds = new Set(entries.filter(e => !e.disabled).map(e => e.id));
            const validSavedIds = savedIds.filter(id => enabledIds.has(id));
            _wbCachedSelectedIds = new Set(validSavedIds);
            // 仅在有匹配条目时才回写，防止刷新后 entry.world 尚未加载导致 ID 全部不匹配、
            // 误将保存记录清空为 []（清空后下次开面板会误触发自动全选）
            if (validSavedIds.length > 0 && validSavedIds.length !== savedIds.length) {
              worldbook.saveSelectedIds(validSavedIds, worldbookScope);
            }
          }
          renderWorldbookList();
        } catch(error) {
          worldbookList.innerHTML = `<div class="we-empty">Failed to read: ${u(error.message)}</div>`;
          if (summary) summary.textContent = 'Failed to read';
          _wbCachedEntries = null;
          _wbCachedSelectedIds = null;
          _wbCachedOverrides = null;
          _wbCachedChatId = null;
          _wbCachedScope = null;
        } finally {
          if (reloadBtn) reloadBtn.disabled = false;
        }
      }

      function renderWorldbookList() {
        const entries = _wbCachedEntries;
        const selectedIds = _wbCachedSelectedIds || new Set();
        const overrides = _wbCachedOverrides || {};
        const triggerOn = worldbookScope === 'memory'
          ? window.MEMORY_ENGINE_SETTINGS?.getSettings()?.worldbookTrigger === true
          : !!(window.WORLD_ENGINE_WORLDBOOK?.triggerEnabled?.());
        if (!entries || !entries.length) {
          worldbookList.innerHTML = '<div class="we-empty">The current chat has no readable World Info entries</div>';
          if (summary) summary.textContent = '0 available';
          return;
        }
        const groups = new Map();
        for (const entry of entries) {
          if (!groups.has(entry.world)) groups.set(entry.world, []);
          groups.get(entry.world).push(entry);
        }
        worldbookList.innerHTML = [...groups.entries()].map(([world, worldEntries]) => {
          const expanded = expandedWorldbookGroups.has(world);
          return `
          <div class="we-worldbook-group" data-worldbook-group="${u(world)}">
            <div class="we-worldbook-group-header">
              <span>${expanded ? '▼' : '▶'}</span>
              <div class="we-worldbook-group-title">
                <div>${u(world)} <span>${worldEntries.length} entries</span></div>
              </div>
              <div class="we-worldbook-group-actions">
                <button type="button" data-worldbook-group-action="select">Select all</button>
                <button type="button" data-worldbook-group-action="clear">Deselect all</button>
              </div>
            </div>
            <div class="we-worldbook-group-body" style="${expanded ? '' : 'display:none;'}">
            ${worldEntries.map(entry => {
              const keys = entry.keys || [];
              const badge = entry.constant ? '🔵' : (entry.vectorized ? '🔗' : (keys.length ? '🟢' : '⚪'));
              const keyHint = keys.length ? ' · keywords: ' + keys.slice(0, 5).join(', ') + (keys.length > 5 ? '…' : '') : '';
              const ov = overrides[entry.id] || 'auto';
              const overrideSel = (triggerOn && !entry.disabled) ? `
                <select class="we-wb-override" data-entry-id="${u(entry.id)}" title="How this entry triggers">
                  <option value="auto"${ov === 'auto' ? ' selected' : ''}>Follow SillyTavern</option>
                  <option value="const"${ov === 'const' ? ' selected' : ''}>Force constant</option>
                  <option value="key"${ov === 'key' ? ' selected' : ''}>Force keywords</option>
                  <option value="off"${ov === 'off' ? ' selected' : ''}>Off</option>
                </select>` : '';
              return `
              <div class="we-worldbook-entry${entry.disabled ? ' is-disabled' : ''}">
                <label class="we-wb-entry-main">
                  <input class="we-worldbook-entry-check" type="checkbox" value="${u(entry.id)}" data-chars="${entry.content.length}" ${selectedIds.has(entry.id) && !entry.disabled ? 'checked' : ''} ${entry.disabled ? 'disabled' : ''}>
                  <span>
                    <strong>${badge} ${u(entry.title)}</strong>
                    <small>${entry.content.length} characters${u(keyHint)}${entry.disabled ? ' · disabled in World Info' : ''}</small>
                  </span>
                </label>${overrideSel}
              </div>`;
            }).join('')}
            </div>
          </div>`;
        }).join('');
          worldbookList.querySelectorAll('.we-worldbook-entry-check').forEach(checkbox => {
            checkbox.onchange = () => {
              _wbCachedSelectedIds = new Set([...worldbookList.querySelectorAll('.we-worldbook-entry-check:checked')].map(cb => cb.value));
              updateWorldbookSummary();
            };
          });
          worldbookList.querySelectorAll('.we-wb-override').forEach(sel => {
            sel.onchange = () => {
              const id = sel.dataset.entryId;
              if (!id) return;
              if (!_wbCachedOverrides) _wbCachedOverrides = {};
              if (sel.value === 'auto') delete _wbCachedOverrides[id];
              else _wbCachedOverrides[id] = sel.value;
            };
          });
          worldbookList.querySelectorAll('.we-worldbook-group-header').forEach(header => {
            header.onclick = () => {
              const body = header.nextElementSibling;
              const arrow = header.querySelector('span');
              if (body) {
                const isHidden = body.style.display === 'none';
                body.style.display = isHidden ? '' : 'none';
                if (arrow) arrow.textContent = isHidden ? '▼' : '▶';
                const world = header.closest('.we-worldbook-group')?.dataset.worldbookGroup;
                if (world) {
                  if (isHidden) expandedWorldbookGroups.add(world);
                  else expandedWorldbookGroups.delete(world);
                }
              }
            };
          });
          worldbookList.querySelectorAll('[data-worldbook-group-action]').forEach(button => {
            button.onclick = (e) => {
              e.stopPropagation();
              const group = button.closest('.we-worldbook-group');
              if (!group) return;
              const checked = button.dataset.worldbookGroupAction === 'select';
              group.querySelectorAll('.we-worldbook-entry-check:not(:disabled)').forEach(checkbox => {
                checkbox.checked = checked;
                checkbox.onchange();
              });
            };
          });
          updateWorldbookSummary();
          // 恢复滚动位置（refresh() 重建 DOM 后补回）
          if (_wbScrollTop) worldbookList.scrollTop = _wbScrollTop;
      }

      if (reloadBtn) reloadBtn.onclick = () => { _wbCachedEntries = null; _wbCachedChatId = null; _wbCachedScope = null; loadWorldbookEntries(); };
      if (selectAllBtn) selectAllBtn.onclick = () => {
        worldbookList.querySelectorAll('.we-worldbook-entry-check:not(:disabled)').forEach(checkbox => {
          checkbox.checked = true;
          checkbox.onchange();
        });
      };
      if (clearAllBtn) clearAllBtn.onclick = () => {
        worldbookList.querySelectorAll('.we-worldbook-entry-check').forEach(checkbox => {
          checkbox.checked = false;
          checkbox.onchange();
        });
      };
      if (saveWorldbookBtn) saveWorldbookBtn.onclick = () => {
        const ids = [..._wbCachedSelectedIds];
        if (worldbook.saveSelection) worldbook.saveSelection(ids, _wbCachedOverrides || {}, worldbookScope);
        else worldbook.saveSelectedIds(ids, worldbookScope);
        showToast(`Saved ${_wbCachedSelectedIds.size} ${worldbookScope === 'memory' ? 'memory' : 'background'} World Info entries`);
        updateWorldbookSummary();
      };
      const triggerBox = document.getElementById('we-worldbook-trigger');
      if (triggerBox) triggerBox.onchange = () => {
        if (worldbookScope === 'memory') {
          window.MEMORY_ENGINE_SETTINGS?.patchSettings({ worldbookTrigger: triggerBox.checked });
        } else {
          const wapi = window.WORLD_ENGINE_API;
          const cur = wapi && wapi.getSettings ? wapi.getSettings(true) : {};
          window.WORLD_ENGINE_STORE.setItem('world_engine_settings', JSON.stringify({ ...cur, worldbookTrigger: triggerBox.checked }));
          if (wapi && wapi.getSettings) wapi.getSettings(true);
        }
        showToast(triggerBox.checked ? 'Blue/green triggers turned on' : 'Blue/green triggers turned off (all selected entries are injected again)');
        renderWorldbookList(); // 重渲染以显示/隐藏每条的触发覆写下拉
      };
      // refresh() 重建 DOM 时，如果 chatId 未变且已有缓存，直接渲染，避免勾选丢失
      const currentChatIdNow = worldbook.getChatId ? worldbook.getChatId() : (window.WORLD_ENGINE_CORE?.getChatId?.() || 'default');
      if (_wbCachedEntries && _wbCachedChatId === currentChatIdNow && _wbCachedScope === worldbookScope) {
        renderWorldbookList();
      } else {
        loadWorldbookEntries();
      }
    }

    const resetBtn = document.getElementById('we-reset-world');
    if (resetBtn) {
      resetBtn.onclick = () => {
        if (confirm('Reset all world state and memories for the current chat? This cannot be undone!')) {
          core.clearState();
          core.clearCheckpoint();
          core.saveFingerprint(String(core.getChatLayer()));
          showToast('World reset');
          refresh();
        }
      };
    }

    const settingsToggle = document.querySelector('.we-settings-toggle');
    if (settingsToggle) {
      settingsToggle.onclick = () => {
        const body = document.getElementById('we-settings-body');
        const arrow = settingsToggle.querySelector('.we-toggle-arrow');
        if (body) {
          const isHidden = body.style.display === 'none';
          body.style.display = isHidden ? 'block' : 'none';
          if (arrow) arrow.textContent = isHidden ? '▼' : '▶';
        }
      };
    }

    const debugToggle = document.querySelector('.we-debug-toggle');
    if (debugToggle) {
      debugToggle.onclick = () => {
        const body = document.getElementById('we-debug-body');
        const arrow = debugToggle.querySelector('.we-toggle-arrow');
        if (body) {
          const isHidden = body.style.display === 'none';
          body.style.display = isHidden ? 'block' : 'none';
          if (arrow) arrow.textContent = isHidden ? '▼' : '▶';
          if (!isHidden) { refreshDebugRender(); refreshPresetManage(); } // [FIX] 局部刷新调试卡数据，不动其它 tab 输入
        }
      };
    }

    const fetchBtn = document.getElementById('we-fetch-models');
    if (fetchBtn) {
      fetchBtn.onclick = async () => {
        const api = window.WORLD_ENGINE_API;
        if (!api) { showToast('API module not loaded', true); return; }
        const requestScope = _engineFace;
        const modelListElement = document.getElementById('we-model-list');
        const apiPatch = {
          apiUrl: document.getElementById('we-api-url')?.value || '',
          apiKey: document.getElementById('we-api-key')?.value || '',
          model: document.getElementById('we-model')?.value || '',
          temperature: Number.isFinite(parseFloat(document.getElementById('we-temperature')?.value))
            ? Math.max(0, parseFloat(document.getElementById('we-temperature')?.value))
            : (requestScope === 'memory' ? 0.2 : 0.7),
          maxTokens: Math.max(1, parseInt(document.getElementById('we-max-tokens')?.value) || 65000),
          apiTimeoutMs: Number.isFinite(parseFloat(document.getElementById('we-api-timeout-sec')?.value)) ? Math.max(0, Math.round(parseFloat(document.getElementById('we-api-timeout-sec')?.value) * 1000)) : 120000,
          connectionMode: document.getElementById('we-connection-mode')?.value === 'proxy' ? 'proxy' : 'direct'
        };
        let requestSettings;
        if (requestScope === 'memory') {
          requestSettings = window.MEMORY_ENGINE_SETTINGS?.patchSettings(apiPatch) || apiPatch;
        } else {
          const worldSettings = {
            ...(api.getSettings ? api.getSettings(true) : {}),
            ...apiPatch,
            injectIntoPrompt: document.getElementById('we-inject-into-prompt')?.checked !== false,
            injectMaxChars: Math.max(0, parseInt(document.getElementById('we-inject-max-chars')?.value) || 0),
            injectAllLevels: document.getElementById('we-inject-all-levels')?.checked === true
          };
          window.WORLD_ENGINE_STORE.setItem('world_engine_settings', JSON.stringify(worldSettings));
          if (api.getSettings) api.getSettings(true);
          requestSettings = worldSettings;
        }
        fetchBtn.disabled = true;
        fetchBtn.textContent = 'Fetching...';
        try {
          const models = await api.fetchModelList(requestSettings);
          const select = modelListElement;
          if (select) {
            select.innerHTML = '<option value="">-- Choose a model --</option>' +
              models.map(m => '<option value="' + u(m) + '">' + u(m) + '</option>').join('');
            select.style.display = 'block';
            select.onchange = () => {
              const modelInput = document.getElementById('we-model');
              if (modelInput) modelInput.value = select.value;
            };
          }
          showToast('Fetched ' + models.length + ' models');
        } catch(e) {
          showToast('' + e.message, true);
        }
        fetchBtn.disabled = false;
        fetchBtn.innerHTML = 'Fetch list';
      };
    }

    const exportBtn = document.getElementById('we-export-data');
    if (exportBtn) {
      exportBtn.onclick = () => {
        const s = core.loadState();
        const checkpoint = core.restoreCheckpoint();
        const clean = core.getCleanExport(s);
        const cleanCheckpoint = checkpoint ? core.getCleanExport(checkpoint) : null;
        const exportData = {
          version: '1.2',
          exportedAt: new Date().toISOString(),
          chatId: core.getChatId(),
          state: clean,
          checkpoint: cleanCheckpoint,
          fingerprint: core.loadFingerprint()
        };
        const blob = new Blob([JSON.stringify(exportData, null, 2)], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = 'world-engine-' + core.getChatId() + '-' + Date.now() + '.json';
        a.click();
        URL.revokeObjectURL(url);
        showToast('Exported');
      };
    }

    const importBtn = document.getElementById('we-import-data');
    const importFile = document.getElementById('we-import-file');
    if (importBtn && importFile) {
      importBtn.onclick = () => importFile.click();
      importFile.onchange = (e) => {
        const file = e.target.files[0];
        if (!file) return;
        const reader = new FileReader();
        reader.onload = (ev) => {
          try {
            const data = JSON.parse(ev.target.result);
            const isRegionalIncident = data && typeof data === 'object' &&
              Object.prototype.hasOwnProperty.call(data, 'active') &&
              Object.prototype.hasOwnProperty.call(data, 'title') &&
              Object.prototype.hasOwnProperty.call(data, 'impact');
            if (isRegionalIncident) {
              const state = core.loadState();
              state.regionalIncident = {
                active: data.active === true || data.active === 'true',
                title: String(data.title || ''),
                type: String(data.type || 'other'),
                scope: String(data.scope || ''),
                impact: String(data.impact || ''),
                cooldown: Math.max(0, Number(data.cooldown) || 0),
                _retry: data._retry === true || data._retry === 'true',
                _retryType: String(data._retryType || '')
              };
              core.saveState(state);
              showToast('Regional incident imported');
              refresh();
              return;
            }
            if (data.version !== '1.2') { showToast('Unsupported save format version', true); return; }
            if (!data.state) { showToast('Invalid import file', true); return; }
            const s = data.state;
            if (s.round === undefined) { showToast('Missing round field', true); return; }
            core.importState(s);
            if (Object.prototype.hasOwnProperty.call(data, 'checkpoint')) {
              if (data.checkpoint) {
                data.checkpoint.chatLayer = core.getChatLayer();
                core.saveCheckpoint(data.checkpoint);
              }
              else core.clearCheckpoint();
            }
            core.saveFingerprint(String(core.getChatLayer()));
            showToast('Import succeeded! Round ' + s.round + ', ' + (s.memories||[]).filter(m=>m.type==='ledger').length + ' rounds of ledger');
            refresh();
          } catch(err) {
            showToast('Parse failed: ' + err.message, true);
          }
        };
        reader.readAsText(file);
        importFile.value = '';
      };
    }

    // ===== 附加提示词 导入 / 导出 / 清除 =====
    function getTonePrompt() {
      return (window.WORLD_ENGINE_API?.getSettings(true)?.tonePrompt || '');
    }
    function saveTonePrompt(text) {
      const wapi = window.WORLD_ENGINE_API;
      const cur = wapi && wapi.getSettings ? wapi.getSettings(true) : {};
      window.WORLD_ENGINE_STORE.setItem('world_engine_settings', JSON.stringify({ ...cur, tonePrompt: text }));
      if (wapi && wapi.getSettings) wapi.getSettings(true);
    }
    function updateToneStatus() {
      const el = document.getElementById('we-tone-status');
      if (!el) return;
      const t = getTonePrompt().trim();
      el.textContent = t ? `Additional prompt set (${t.length} chars)` : 'No additional prompt set';
    }
    updateToneStatus();

    const toneImportBtn = document.getElementById('we-tone-import');
    const toneFile = document.getElementById('we-tone-file');
    if (toneImportBtn && toneFile) {
      toneImportBtn.onclick = () => toneFile.click();
      toneFile.onchange = (e) => {
        const file = e.target.files[0];
        if (!file) return;
        const reader = new FileReader();
        reader.onload = (ev) => {
          const text = String(ev.target.result || '').trim();
          if (!text) { showToast('File is empty', true); return; }
          saveTonePrompt(text);
          updateToneStatus();
          showToast('Additional prompt imported');
        };
        reader.readAsText(file);
        toneFile.value = '';
      };
    }

    const toneExportBtn = document.getElementById('we-tone-export');
    if (toneExportBtn) {
      toneExportBtn.onclick = () => {
        const t = getTonePrompt();
        if (!t.trim()) { showToast('No additional prompt to export', true); return; }
        const blob = new Blob([t], { type: 'text/plain;charset=utf-8' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = 'world-engine-tone-' + Date.now() + '.txt';
        a.click();
        URL.revokeObjectURL(url);
        showToast('Additional prompt exported');
      };
    }

    const toneClearBtn = document.getElementById('we-tone-clear');
    if (toneClearBtn) {
      toneClearBtn.onclick = () => {
        if (!getTonePrompt().trim()) { showToast('No additional prompt', true); return; }
        saveTonePrompt('');
        updateToneStatus();
        showToast('Additional prompt cleared');
      };
    }

    // ===== 酒馆缓存与存档 =====
    (function setupChatcacheSection() {
      const cc = window.WORLD_ENGINE_CHATCACHE;
      const listEl = document.getElementById('we-chatcache-snapshots');
      if (!cc || !listEl) return; // 不在设置页或模块缺失

      const statusEl = document.getElementById('we-chatcache-status');
      const fmtTime = (ms) => {
        if (!ms) return '';
        const d = new Date(ms), p = n => String(n).padStart(2, '0');
        return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
      };

      function render() {
        const st = cc.getStatus();
        if (statusEl) {
          if (!st.usable) statusEl.textContent = 'No chat available (open a character or group chat first).';
          else if (!st.apiAvailable) statusEl.textContent = 'This SillyTavern version cannot write chat_metadata, so the SillyTavern cache is unavailable.';
          else statusEl.textContent = `Live sync ${st.syncEnabled ? 'on' : 'off'} · local revision ${st.localRev} / cloud ${st.liveRev} · ${st.snapshotCount} saves`;
        }
        const snaps = cc.listSnapshots();
        if (!snaps.length) { listEl.innerHTML = '<div class="we-empty">No saves yet</div>'; return; }
        listEl.innerHTML = snaps.map(s => `
          <div class="we-snapshot-row" data-snap-id="${u(s.id)}">
            <div class="we-snapshot-main">
              <div class="we-snapshot-name"><span class="we-snapshot-badge${s.auto ? ' is-auto' : ''}">${s.auto ? 'Auto' : 'Manual'}</span>${u(s.name)}</div>
              <div class="we-snapshot-meta">Round ${s.round || 0} · ${fmtTime(s.createdAt)}</div>
            </div>
            <div class="we-snapshot-actions">
              <button class="we-icon-btn" data-snap-action="restore" title="Restore to the current chat"><i class="fa-solid fa-rotate-left"></i></button>
              <button class="we-icon-btn" data-snap-action="rename" title="Rename"><i class="fa-solid fa-pen"></i></button>
              <button class="we-icon-btn" data-snap-action="export" title="Export JSON"><i class="fa-solid fa-download"></i></button>
              <button class="we-icon-btn" data-snap-action="delete" title="Delete"><i class="fa-solid fa-trash"></i></button>
            </div>
          </div>`).join('');
        listEl.querySelectorAll('[data-snap-action]').forEach(btn => {
          btn.onclick = () => {
            const row = btn.closest('.we-snapshot-row');
            const id = row && row.dataset.snapId;
            if (!id) return;
            const action = btn.dataset.snapAction;
            const snap = cc.listSnapshots().find(s => s.id === id);
            if (action === 'restore') {
              if (!confirm(`Restore save "${snap ? snap.name : id}" to the current chat?
The current state is backed up first, so you can restore it again.`)) return;
              if (cc.restoreSnapshot(id)) { showToast('Save restored'); refresh(); }
              else showToast('Restore failed', true);
            } else if (action === 'rename') {
              const name = prompt('New save name:', snap ? snap.name : '');
              if (name == null) return;
              if (cc.renameSnapshot(id, name)) { showToast('Renamed'); render(); }
            } else if (action === 'export') {
              const obj = cc.exportSnapshot(id);
              if (!obj) { showToast('Export failed', true); return; }
              const safe = String(obj.name || id).replace(/[^\w一-龥-]+/g, '_');
              setupDownload(JSON.stringify(obj, null, 2), 'we-snapshot-' + safe + '-' + Date.now() + '.json');
              showToast('Save exported');
            } else if (action === 'delete') {
              if (!confirm(`Delete save "${snap ? snap.name : id}"? This cannot be undone.`)) return;
              if (cc.deleteSnapshot(id)) { showToast('Deleted'); render(); }
            }
          };
        });
      }

      // 立即生效并持久化单个开关（与 saveTonePrompt 同模式）
      const persist = (key, val) => {
        const wapi = window.WORLD_ENGINE_API;
        const cur = wapi && wapi.getSettings ? wapi.getSettings(true) : {};
        window.WORLD_ENGINE_STORE.setItem('world_engine_settings', JSON.stringify({ ...cur, [key]: val }));
        if (wapi && wapi.getSettings) wapi.getSettings(true);
      };

      const syncBox = document.getElementById('we-sync-to-chat');
      if (syncBox) syncBox.onchange = () => {
        persist('syncToChat', syncBox.checked);
        if (syncBox.checked && cc.pushLiveNow) cc.pushLiveNow(); // 开启即把本地播种进聊天
        showToast(syncBox.checked ? 'Cross-device sync turned on' : 'Cross-device sync turned off');
        render();
      };
      const autoBox = document.getElementById('we-auto-backup');
      if (autoBox) autoBox.onchange = () => {
        persist('autoBackup', autoBox.checked);
        showToast(autoBox.checked ? 'Auto backup turned on' : 'Auto backup turned off');
      };

      const ccSaveBtn = document.getElementById('we-chatcache-save');
      if (ccSaveBtn) ccSaveBtn.onclick = () => {
        const name = prompt('Name this save:', 'Save ' + fmtTime(Date.now()));
        if (name == null) return;
        if (cc.createSnapshot(name)) { showToast('Saved'); render(); }
        else showToast('Save failed (the current chat has no world data or cannot be written)', true);
      };

      const ccImportBtn = document.getElementById('we-chatcache-import');
      const ccImportFile = document.getElementById('we-chatcache-import-file');
      if (ccImportBtn && ccImportFile) {
        ccImportBtn.onclick = () => ccImportFile.click();
        ccImportFile.onchange = (e) => {
          const file = e.target.files[0];
          if (!file) return;
          const reader = new FileReader();
          reader.onload = (ev) => {
            try {
              const obj = JSON.parse(ev.target.result);
              if (cc.importSnapshot(obj)) { showToast('Save imported'); render(); }
              else showToast('Not a valid save file', true);
            } catch (err) { showToast('Parse failed: ' + err.message, true); }
          };
          reader.readAsText(file);
          ccImportFile.value = '';
        };
      }

      render();
    })();

    // ===== 批量重填世界推演 =====
    (function setupBackfillSection() {
      const startBtn = document.getElementById('we-backfill-start');
      const stopBtn = document.getElementById('we-backfill-stop');
      if (!startBtn) return; // 不在设置页

      const persistBf = (key, val) => {
        const wapi = window.WORLD_ENGINE_API;
        const cur = wapi && wapi.getSettings ? wapi.getSettings(true) : {};
        window.WORLD_ENGINE_STORE.setItem('world_engine_settings', JSON.stringify({ ...cur, [key]: val }));
        if (wapi && wapi.getSettings) wapi.getSettings(true);
      };
      const batchEl = document.getElementById('we-backfill-batch');
      const endEl = document.getElementById('we-backfill-end');
      const retriesEl = document.getElementById('we-backfill-retries');
      if (batchEl) batchEl.onchange = () => persistBf('backfillBatchSize', Math.max(1, parseInt(batchEl.value) || 1));
      if (endEl) endEl.onchange = () => persistBf('backfillEndLayer', Math.max(0, parseInt(endEl.value) || 0));
      if (retriesEl) retriesEl.onchange = () => persistBf('backfillRetries', Math.max(0, parseInt(retriesEl.value) || 0));

      startBtn.onclick = () => runBackfill();
      if (stopBtn) stopBtn.onclick = () => {
        if (evolution && evolution.abort) { evolution.abort(); showToast('Stop signal sent'); }
      };
    })();

    // 调试区导出按钮
    function setupDownload(content, filename) {
      const blob = new Blob([content], { type: 'text/plain;charset=utf-8' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = filename;
      a.click();
      URL.revokeObjectURL(url);
    }

    const exportPromptBtn = document.getElementById('we-export-prompt');
    if (exportPromptBtn) {
      exportPromptBtn.onclick = () => {
        const evo = window.WORLD_ENGINE_EVOLUTION;
        if (!evo || !evo.getLastDebug) return;
        const dbg = evo.getLastDebug();
        if (!dbg.prompt) { showToast('No prompt to export', true); return; }
        setupDownload(dbg.prompt, 'prompt-' + Date.now() + '.txt');
        showToast('Prompt exported');
      };
    }

    const exportRawBtn = document.getElementById('we-export-raw-result');
    if (exportRawBtn) {
      exportRawBtn.onclick = () => {
        const evo = window.WORLD_ENGINE_EVOLUTION;
        if (!evo || !evo.getLastDebug) return;
        const dbg = evo.getLastDebug();
        if (!dbg.rawResult) { showToast('No API response to export', true); return; }
        setupDownload(dbg.rawResult, 'api-raw-' + Date.now() + '.txt');
        showToast('API response exported');
      };
    }

    // [FIX] 推演 prompt 分段卡片折叠（事件委托，逻辑在模块级 bindPromptSegToggle）
    bindPromptSegToggle(document.querySelector('.we-prompt-debug'));
    bindMemoryDebugExportButtons();

    // [FIX] 导出诊断包
    const exportDiagBtn = document.getElementById('we-export-diag');
    if (exportDiagBtn) {
      exportDiagBtn.onclick = () => {
        const diag = window.WORLD_ENGINE_DIAG;
        if (!diag || !diag.download) { showToast('Diagnostics module unavailable', true); return; }
        try {
          diag.download();
          showToast('Diagnostics bundle exported');
        } catch (e) {
          showToast('Diagnostics bundle export failed: ' + (e && e.message || e), true);
        }
      };
    }
    const memoryExportDiagBtn = document.getElementById('we-memory-export-diag');
    if (memoryExportDiagBtn) memoryExportDiagBtn.onclick = () => {
      const diag = window.WORLD_ENGINE_DIAG;
      if (!diag?.download) { showToast('Memory diagnostics module unavailable', true); return; }
      try { diag.download('memory'); showToast('Memory diagnostics bundle exported'); }
      catch (error) { showToast('Memory diagnostics bundle export failed: ' + (error?.message || error), true); }
    };

    // [MAP] 引擎预设管理：整页装配后首次绑定（事件委托在 bindPresetEvents 内）。
    bindPresetEvents(document.getElementById('we-preset-manage'));
  }

  function showPanel() {
    if (!panelElement) buildPanel();
    applyEngineFaceTheme();
    panelElement.style.display = 'flex';
    panelVisible = true;
    refresh();
  }

  function hidePanel() {
    if (!panelElement) return;
    panelElement.style.display = 'none';
    panelVisible = false;
  }

  function togglePanel() {
    if (panelVisible) hidePanel();
    else showPanel();
  }

  function initDrag(panel, handle) {
    let dragging = false, startX, startY, startLeft, startTop;
    handle.style.cursor = 'grab';

    handle.addEventListener('mousedown', function(e) {
      if (e.target.closest('.we-panel-close') || e.target.closest('.we-panel-corner-actions') || e.target.closest('.we-engine-face-toggle')) return;
      dragging = true;
      const rect = panel.getBoundingClientRect();
      startX = e.clientX; startY = e.clientY;
      startLeft = rect.left; startTop = rect.top;
      panel.style.left = startLeft + 'px'; panel.style.top = startTop + 'px';
      panel.style.right = 'auto'; panel.style.bottom = 'auto';
      panel.style.cursor = 'grabbing';
      e.preventDefault();
    });

    document.addEventListener('mousemove', function(e) {
      if (!dragging) return;
      const dx = e.clientX - startX;
      const dy = e.clientY - startY;
      panel.style.left = (startLeft + dx) + 'px';
      panel.style.top = (startTop + dy) + 'px';
    });

    document.addEventListener('mouseup', function() {
      if (!dragging) return;
      dragging = false;
      panel.style.cursor = '';
    });
  }

  /** 获取当前对话层数 */
  function getChatLayer() {
    try {
      const ctx = SillyTavern.getContext();
      const chat = ctx?.chat || [];
      return Math.max(0, chat.length - 1);
    } catch(e) { return '?'; }
  }

  /** 设置面板状态条 */
  function setStatus(text, isError) {
    const statusBar = document.getElementById('we-status-bar');
    if (!statusBar) return;
    statusBar.textContent = text;
    statusBar.className = 'we-status-bar' + (isError ? ' error' : '');
  }

  // ========== 全局事件委托：声誉点击 + economy 编辑 ==========
  document.addEventListener('click', function(e) {
    // 声誉方块点击
    var dot = e.target.closest('.we-rep-dot');
    if (dot) {
      var dim = dot.getAttribute('data-dim');
      var level = dot.getAttribute('data-level');
      if (dim && level) {
        var scope = dot.getAttribute('data-rep-scope');
        var s = loadScopedState(scope);
        s.reputation = s.reputation || {};
        s.reputation[dim] = level;
        saveScopedState(scope, s);
        refresh();
      }
      return;
    }
    // climate 按钮点击
    var cb = e.target.closest('.we-climate-btn');
    if (cb) {
      var c = cb.getAttribute('data-climate');
      if (c) {
        var scope = cb.getAttribute('data-climate-scope');
        var s = loadScopedState(scope);
        s.economy = s.economy || {};
        s.economy.climate = c;
        saveScopedState(scope, s);
        refresh();
      }
      return;
    }
    // 通用列表翻页
    var arr = e.target.closest('.we-list-arrow');
    if (arr) {
      var rid = arr.getAttribute('data-rid');
      var dir = parseInt(arr.getAttribute('data-dir'));
      if (!rid || isNaN(dir)) return;
      // 找到对应的翻页器
      var pager = arr.parentNode;
      var curSpan = pager.querySelector('.we-list-cur');
      if (!curSpan) return;
      var curPage = parseInt(curSpan.textContent);
      var list = document.querySelector('.we-paged-list[data-rid="' + rid + '"]');
      if (!list) return;
      var items = list.querySelectorAll('.we-page-item');
      var pages = Array.from(items).map(function(el) {
        return { el: el, page: parseInt(el.getAttribute('data-page')) };
      });
      if (!pages.length) return;
      var maxPage = Math.max.apply(null, pages.map(function(p){return p.page;}));
      var newPage = ((curPage - 1 + dir) % maxPage + maxPage) % maxPage + 1;
      pages.forEach(function(p) { p.el.style.display = p.page === newPage ? '' : 'none'; });
      curSpan.textContent = newPage;
      listPageState[rid] = newPage;
      return;
    }
    // 删除 signal
    var sd = e.target.closest('.we-signal-del');
    if (sd) {
      var idx = parseInt(sd.getAttribute('data-sigidx'));
      if (!isNaN(idx)) {
        var scope = sd.getAttribute('data-sig-scope');
        var s = loadScopedState(scope);
        if (s.economy && s.economy.signals && s.economy.signals[idx] !== undefined) {
          s.economy.signals.splice(idx, 1);
          saveScopedState(scope, s);
          refresh();
        }
      }
      return;
    }
    // 添加 signal
    var sa = e.target.closest('.we-signal-add');
    if (sa) {
      var scope = sa.getAttribute('data-sig-scope');
      var s = loadScopedState(scope);
      s.economy = s.economy || {};
      if (!s.economy.signals) s.economy.signals = [];
      if (s.economy.signals.length < 5) {
        s.economy.signals.push({ summary: 'New signal', scope: 'Region' });
        saveScopedState(scope, s);
        refresh();
      }
      return;
    }

    // 单击信号卡片后显示删除按钮；再次点击同一卡片时保持显示，方便移动端操作
    var signalCard = e.target.closest('.we-signal-item');
    if (signalCard && panelBodyElement && panelBodyElement.contains(signalCard)) {
      panelBodyElement.querySelectorAll('.we-card-active').forEach(function(c){ c.classList.remove('we-card-active'); });
      signalCard.classList.add('we-card-active');
      return;
    }

    // ===== 单击条目卡片显示/隐藏其编辑按钮（移动端无悬停，统一改为点按）=====
    if (!panelBodyElement || !panelBodyElement.contains(e.target)) return;
    // 点在按钮/输入控件/展开的编辑器内：交给各自处理器，不切换
    if (e.target.closest('button, select, input, textarea, label, a, .we-event-editor, .we-rep-dot, .we-climate-btn, .we-signal-item, .we-list-arrow, .we-nav-row, .we-section-toggle')) return;
    var card = findActionCard(e.target);
    var wasActive = card && card.classList.contains('we-card-active');
    // 先收起其它已展开的卡片
    panelBodyElement.querySelectorAll('.we-card-active').forEach(function(c){ c.classList.remove('we-card-active'); });
    if (card && !wasActive) card.classList.add('we-card-active');
  });

  /** 找到包含编辑按钮组的条目卡片（其直接子节点里有 .we-event-actions / .we-secret-ops） */
  function findActionCard(target) {
    var el = target;
    while (el && el.nodeType === 1 && el.id !== 'we-panel-body') {
      if (el.querySelector && el.querySelector(':scope > .we-event-actions, :scope > .we-secret-ops')) return el;
      el = el.parentElement;
    }
    return null;
  }

  // 全局事件委托：signal 双击编辑
  document.addEventListener('dblclick', function(e) {
    var sum = e.target.closest('.we-signal-summary');
    var sc = e.target.closest('.we-signal-scope');
    if (!sum && !sc) return;
    e.preventDefault();
    var item = sum || sc;
    var isScope = !!sc;
    var parent = item.closest('.we-signal-item');
    if (!parent) return;
    var del = parent.querySelector('.we-signal-del');
    var idx = del ? parseInt(del.getAttribute('data-sigidx')) : -1;
    if (isNaN(idx)) return;
    var dispScope = parent.getAttribute('data-sig-scope');
    var oldText = item.textContent;
    item.contentEditable = 'true';
    item.focus();
    // select all text
    var range = document.createRange();
    range.selectNodeContents(item);
    var sel = window.getSelection();
    sel.removeAllRanges();
    sel.addRange(range);
    item.onblur = function() {
      item.contentEditable = 'false';
      var s = loadScopedState(dispScope);
      if (s.economy && s.economy.signals && s.economy.signals[idx]) {
        if (isScope) s.economy.signals[idx].scope = item.textContent;
        else s.economy.signals[idx].summary = item.textContent;
        saveScopedState(dispScope, s);
      }
    };
    item.onkeydown = function(ke) {
      if (ke.key === 'Enter') { ke.preventDefault(); item.blur(); }
    };
  });

  // ========== 推演 UI 状态切换 ==========
  function setEvolvingUI(active, scope) {
    // 只置标志，绝不在这里调 refresh()：bindEvents() 每次刷新都会调用本函数，
    // 一旦回头再 refresh 就会 setEvolvingUI→refresh→bindEvents→setEvolvingUI 无限递归卡死。
    // 显示哪份由 getActiveInjected 守卫 + _evolvingScope 负责，刷新由调用方在外面做。
    _evolving = !!active;
    if (active && scope) _evolvingScope = scope;
    updateBallControls();
  }

  function setMemoryEvolvingUI(active, label) {
    _memoryRunningLabel = active ? String(label || 'memory task') : '';
    const status = document.getElementById('we-memory-task-status');
    if (status) status.textContent = active ? `Running ${_memoryRunningLabel}` : 'No memory task is running';
    updateBallControls();
  }

  function setInjectedScope(scope) {
    _injectedScope = scope === 'checkpoint' ? 'checkpoint' : 'state';
  }

  // 手动推演（供悬浮球卫星按钮调用）：显式指定基底，不看 isNewRound。
  //   重新推进 → 喂存档点 B（mode 'redo'），面板显示存档点；
  //   向前推进 → 喂当前状态 A（mode 'forward'），面板显示当前状态。
  async function runManualEvolve(mode, scope) {
    if (!window.WORLD_ENGINE || typeof window.WORLD_ENGINE.manualEvolve !== 'function') {
      showToast('Manual evolution entry point not ready', true);
      return;
    }
    const ok = await window.WORLD_ENGINE.manualEvolve(mode, scope);
    if (ok) showToast('Evolution complete');
    else if (evolution.getLastError?.()) showToast(evolution.getLastError(), true);
  }

  async function runMemoryExtract() {
    if (!window.MEMORY_ENGINE?.manualExtract) { showToast('Memory extraction entry point not ready', true); return; }
    try {
      const result = await window.MEMORY_ENGINE.manualExtract();
      showToast(`Memory extraction complete; ${result?.added || 0} items written or updated`);
      return result;
    } catch (error) {
      showToast(`Memory extraction failed: ${error?.message || error}`, true);
    }
  }

  async function runMemoryReextract() {
    if (!window.MEMORY_ENGINE?.manualReextract) { showToast('Memory evolution entry point not ready', true); return; }
    try {
      const result = await window.MEMORY_ENGINE.manualReextract();
      showToast(`Memory re-run complete; ${result?.added ?? 'Unknown'} items written or updated`);
    } catch (error) { showToast(`Memory re-run failed: ${error?.message || error}`, true); }
  }

  // 批量「重填世界推演」：清空当前世界状态，从第 1 个 AI 楼层分批推到指定楼层。
  async function runBackfill() {
    if (isEvolving) { showToast('An evolution is already in progress; please wait'); return; }
    if (evolution?.isRunning?.()) { showToast('An evolution is already in progress; please wait'); return; }

    const st = window.WORLD_ENGINE_API ? window.WORLD_ENGINE_API.getSettings(true) : {};
    if (st.engineEnabled === false) { showToast('World Engine is off', true); return; }
    const batchSize = Math.max(1, parseInt(st.backfillBatchSize) || 1);
    const retries = Math.max(0, parseInt(st.backfillRetries) || 0);
    let endLayer = Math.max(0, parseInt(st.backfillEndLayer) || 0);

    // 统计当前 AI 楼层数，给出确认信息
    let aiCount = 0;
    try {
      const ctx = SillyTavern.getContext();
      const chat = (ctx && ctx.chat) || [];
      const ignoreFirstLayer = st.firstLayerIsAiOpening !== false;
      for (let index = 0; index < chat.length; index++) {
        const m = chat[index];
        if (m && !m.is_user && String(m.mes || '').trim() && !(ignoreFirstLayer && index === 0)) aiCount++;
      }
    } catch (e) {}
    if (!aiCount) { showToast('The current chat has no AI messages to evolve', true); return; }
    const effectiveEnd = (endLayer > 0 && endLayer <= aiCount) ? endLayer : aiCount;
    const totalBatches = Math.max(1, Math.ceil(effectiveEnd / batchSize));

    const statusEl = document.getElementById('we-backfill-status');
    const setBfStatus = (t) => { if (statusEl) statusEl.textContent = t; };

    if (!confirm(
      `"Refill world evolution" clears the current world state and re-evolves from the first AI message up to message ${effectiveEnd}, ` +
      `about ${totalBatches} batches, with up to ${retries} fault retries per batch.
` +
      `A backup snapshot is saved automatically first.
Start over?`
    )) return;

    // 回填前自动备份（chatcache 不可用则静默跳过）
    try {
      const cc = window.WORLD_ENGINE_CHATCACHE;
      if (cc && cc.createSnapshot) {
        const snap = cc.createSnapshot('Auto backup before backfill');
        if (snap) showToast('Backup snapshot saved before backfill');
      }
    } catch (e) { console.warn('[World Engine] Backup before backfill failed (the backfill is not affected)', e); }

    isEvolving = true;
    setEvolvingUI(true, 'state');
    refresh(true);
    if (window.__WE_SetExternalStatus) window.__WE_SetExternalStatus('Backfilling...');
    setBfStatus('Starting backfill...');

    try {
      const result = await evolution.backfillEvolve({
        batchSize, retries, endLayer,
        onProgress: (p) => {
          if (p.phase === 'batch-start') {
            setBfStatus(`Batch ${p.batch}/${p.totalBatches} (messages ${p.layerFrom}-${p.layerTo}) evolving...`);
            if (window.__WE_SetExternalStatus) window.__WE_SetExternalStatus(`Backfilling ${p.batch}/${p.totalBatches}`);
          } else if (p.phase === 'retry') {
            setBfStatus(`Batch ${p.batch}/${p.totalBatches} failed, retry ${p.attempt}/${retries}...`);
            if (window.__WE_SetExternalStatus) window.__WE_SetExternalStatus(`Backfilling ${p.batch}/${p.totalBatches}`);
          } else if (p.phase === 'batch-done') {
            setBfStatus(`Batch ${p.batch}/${p.totalBatches} done (advanced to round ${p.round})`);
            refresh(true);
          }
        }
      });

      if (result.done) {
        setBfStatus(`✅ Backfill complete, ${result.completedBatches}/${result.totalBatches} batches`);
        showToast(`Backfill complete, ${result.completedBatches} batches`);
        if (window.__WE_SetExternalStatus) window.__WE_SetExternalStatus('Backfill complete');
        if (window.WORLD_ENGINE?.applyInjection) window.WORLD_ENGINE.applyInjection();
      } else if (result.reason === 'aborted') {
        setBfStatus(`🛑 Aborted after ${result.completedBatches}/${result.totalBatches} batches`);
        showToast(`Backfill aborted (${result.completedBatches} batches done)`);
        if (window.__WE_SetExternalStatus) window.__WE_SetExternalStatus('Backfill aborted');
        if (window.WORLD_ENGINE?.applyInjection) window.WORLD_ENGINE.applyInjection();
      } else if (result.reason === 'no-ai-layers') {
        setBfStatus('The current chat has no AI messages to evolve');
        showToast('The current chat has no AI messages to evolve', true);
      } else if (result.reason === 'busy') {
        showToast('An evolution is already in progress; please wait', true);
      } else {
        setBfStatus(`❌ Batch ${result.failedAt || '?'} failed; stopped (${result.completedBatches || 0} batches done)`);
        showToast(`Backfill failed at batch ${result.failedAt || '?'} and stopped`, true);
        if (window.__WE_SetExternalStatus) window.__WE_SetExternalStatus('Backfill failed', true);
        if (window.WORLD_ENGINE?.applyInjection) window.WORLD_ENGINE.applyInjection();
      }
    } catch (e) {
      setBfStatus('❌ Backfill error: ' + (e && e.message || e));
      showToast('Backfill error: ' + (e && e.message || e), true);
    } finally {
      isEvolving = false;
      setEvolvingUI(false);
      refresh();
    }
  }

  // ========== 世界引擎悬浮球 ==========
  let inputButtonObserver = null;
  let inputButtonRetryTimer = null;
  const WE_BALL_POS_KEY = 'we-ball-pos';
  let _ballStatusTimer = null;

  function getFaceSettings() {
    const face = getEngineFace();
    return callEngineFace(face, 'getSettings', {}) || {};
  }

  function updateBallControls() {
    const ball = document.getElementById('we-input-btn');
    if (!ball) return;
    const face = getEngineFace();
    const active = Boolean(callEngineFace(face, 'isRunning', false));
    const runningLabel = String(callEngineFace(face, 'getRunningLabel', '') || '');
    const fwd = ball.querySelector('#we-sat-forward');
    const redo = ball.querySelector('#we-sat-redo');
    const abort = ball.querySelector('#we-sat-abort');
    const power = ball.querySelector('#we-sat-power');
    const engineSwitch = ball.querySelector('#we-sat-engine-switch');
    if (fwd) {
      fwd.style.display = face.showForward === true ? '' : 'none';
      fwd.classList.toggle('we-sat-off', active);
      fwd.title = face.forwardTitle || `Advance ${face.label}`;
    }
    if (redo) {
      redo.classList.toggle('we-sat-off', active);
      redo.title = `Re-evolve ${face.label}`;
    }
    if (abort) {
      abort.classList.toggle('we-sat-off', !active);
      abort.title = active && runningLabel ? `Stop ${runningLabel}` : `Stop ${face.label} evolution`;
    }
    if (power) {
      power.classList.toggle('on', getFaceSettings().engineEnabled === false);
      power.style.display = typeof face.setEnabled === 'function' ? '' : 'none';
      power.title = `Turn ${face.label} evolution and injection on/off`;
    }
    if (engineSwitch) {
      const targetId = face.id === 'memory' ? 'world' : 'memory';
      const target = getEngineFace(targetId);
      const targetActive = Boolean(callEngineFace(target, 'isRunning', false));
      const targetRunningLabel = String(callEngineFace(target, 'getRunningLabel', '') || '');
      engineSwitch.dataset.targetEngine = target.id;
      engineSwitch.dataset.engineRunning = targetActive ? 'true' : 'false';
      engineSwitch.classList.toggle('we-sat-target-world', target.id === 'world');
      engineSwitch.classList.toggle('we-sat-target-memory', target.id === 'memory');
      engineSwitch.classList.toggle('we-sat-engine-running', targetActive);
      engineSwitch.title = targetActive
        ? `${target.label} is running ${targetRunningLabel || 'evolution'} · click to switch and view`
        : `Switch to ${target.label}`;
      engineSwitch.setAttribute('aria-label', engineSwitch.title);
    }
    ball.classList.toggle('we-ball-evolving', active);
    ball.title = active && runningLabel
      ? `${face.label}: running ${runningLabel}`
      : `${face.label}: click to open the panel`;
    ball.setAttribute('aria-label', ball.title);
    if (active) ball.classList.remove('we-ball-success', 'we-ball-fail');
  }

  function syncBallFace() {
    const ball = document.getElementById('we-input-btn');
    if (!ball) return;
    const face = getEngineFace();
    for (const registered of _engineFaceRegistry.values()) {
      if (registered.ballClass) ball.classList.remove(registered.ballClass);
    }
    if (face.ballClass) ball.classList.add(face.ballClass);
    ball.dataset.engineFace = face.id;
    ball.title = `${face.label}: click to open the panel`;
    ball.setAttribute('aria-label', ball.title);
    updateBallControls();
  }

  function loadBallPos() {
    try {
      const raw = localStorage.getItem(WE_BALL_POS_KEY);
      if (raw) {
        const p = JSON.parse(raw);
        if (typeof p.left === 'number' && typeof p.top === 'number') return p;
      }
    } catch (_) {}
    return null;
  }

  function saveBallPos(left, top, tucked, side) {
    try { localStorage.setItem(WE_BALL_POS_KEY, JSON.stringify({ left, top, tucked: !!tucked, side: side || null })); } catch (_) {}
  }

  // 侧边吸附参数
  const WE_TUCK_EDGE = 28;    // 距边缘多近算「吸附」
  const WE_TUCK_HANDLE = 15;  // 缩进后露出的小条宽度
  const WE_TUCK_INSET = 8;    // 拉出后距边缘的留白

  function applyBallTuck(ball, side) {
    const vw = window.innerWidth;
    const size = ball.offsetWidth || 52;
    ball.classList.add('we-ball-tucked');
    ball.classList.toggle('we-ball-tucked-left', side === 'left');
    ball.classList.toggle('we-ball-tucked-right', side === 'right');
    ball.style.left = (side === 'left' ? (WE_TUCK_HANDLE - size) : (vw - WE_TUCK_HANDLE)) + 'px';
  }

  function untuckBall(ball) {
    const pos = loadBallPos() || {};
    const vw = window.innerWidth, vh = window.innerHeight, size = ball.offsetWidth || 52;
    let left = typeof pos.left === 'number' ? pos.left : (vw - size - 18);
    let top = typeof pos.top === 'number' ? pos.top : (vh - size - 90);
    left = Math.max(4, Math.min(left, vw - size - 4));
    top = Math.max(4, Math.min(top, vh - size - 4));
    ball.classList.remove('we-ball-tucked', 'we-ball-tucked-left', 'we-ball-tucked-right');
    ball.style.left = left + 'px';
    ball.style.top = top + 'px';
    saveBallPos(left, top, false, null);
  }

  function applyBallPos(ball) {
    const vw = window.innerWidth, vh = window.innerHeight;
    const size = ball.offsetWidth || 52;
    let pos = loadBallPos();
    if (!pos) pos = { left: vw - size - 44, top: vh - size - 90 };
    // 钳制进可视区域，避免拖出屏幕后找不到
    pos.left = Math.max(4, Math.min(pos.left, vw - size - 4));
    pos.top = Math.max(4, Math.min(pos.top, vh - size - 4));
    ball.style.top = pos.top + 'px';
    ball.style.right = 'auto';
    ball.style.bottom = 'auto';
    if (pos.tucked && (pos.side === 'left' || pos.side === 'right')) {
      ball.style.left = pos.left + 'px';   // 记录的是「拉出后」的位置
      applyBallTuck(ball, pos.side);        // 视觉上缩到边缘
    } else {
      ball.classList.remove('we-ball-tucked', 'we-ball-tucked-left', 'we-ball-tucked-right');
      ball.style.left = pos.left + 'px';
    }
  }

  function makeBallDraggable(ball) {
    let dragging = false, moved = false, sx = 0, sy = 0, ox = 0, oy = 0;
    const onDown = (e) => {
      const pt = e.touches ? e.touches[0] : e;
      dragging = true; moved = false;
      sx = pt.clientX; sy = pt.clientY;
      const rect = ball.getBoundingClientRect();
      ox = rect.left; oy = rect.top;
      ball.classList.add('we-ball-dragging');
      document.addEventListener('mousemove', onMove);
      document.addEventListener('mouseup', onUp);
      document.addEventListener('touchmove', onMove, { passive: false });
      document.addEventListener('touchend', onUp);
    };
    const onMove = (e) => {
      if (!dragging) return;
      const pt = e.touches ? e.touches[0] : e;
      const dx = pt.clientX - sx, dy = pt.clientY - sy;
      if (Math.abs(dx) > 4 || Math.abs(dy) > 4) moved = true;
      if (e.cancelable) e.preventDefault();
      const size = ball.offsetWidth || 52;
      let left = Math.max(4, Math.min(ox + dx, window.innerWidth - size - 4));
      let top = Math.max(4, Math.min(oy + dy, window.innerHeight - size - 4));
      ball.style.left = left + 'px';
      ball.style.top = top + 'px';
    };
    const onUp = () => {
      if (!dragging) return;
      dragging = false;
      ball.classList.remove('we-ball-dragging');
      document.removeEventListener('mousemove', onMove);
      document.removeEventListener('mouseup', onUp);
      document.removeEventListener('touchmove', onMove);
      document.removeEventListener('touchend', onUp);
      if (!moved) return;
      const vw = window.innerWidth, size = ball.offsetWidth || 52;
      const left = parseFloat(ball.style.left) || 0;
      const top = parseFloat(ball.style.top) || 0;
      if (left <= WE_TUCK_EDGE) {                          // 贴左缘 → 缩进左侧
        saveBallPos(WE_TUCK_INSET, top, true, 'left');
        applyBallTuck(ball, 'left');
      } else if (left >= vw - size - WE_TUCK_EDGE) {        // 贴右缘 → 缩进右侧
        saveBallPos(vw - size - WE_TUCK_INSET, top, true, 'right');
        applyBallTuck(ball, 'right');
      } else {
        saveBallPos(left, top, false, null);
      }
    };
    ball.addEventListener('mousedown', onDown);
    ball.addEventListener('touchstart', onDown, { passive: true });
    // 点击处理：拖动后不算点击；已缩进则「拉出来」而非开面板
    ball.addEventListener('click', (e) => {
      if (moved) { e.preventDefault(); e.stopImmediatePropagation(); moved = false; return; }
      if (ball.classList.contains('we-ball-tucked')) {
        e.preventDefault(); e.stopImmediatePropagation();
        untuckBall(ball);
      }
    }, true);
  }

  function observeInputButton() {
    if (inputButtonObserver || !document.body) return;
    inputButtonObserver = new MutationObserver(() => {
      if (!document.getElementById('we-input-btn')) {
        clearTimeout(inputButtonRetryTimer);
        inputButtonRetryTimer = setTimeout(buildInputButton, 50);
      }
    });
    inputButtonObserver.observe(document.body, { childList: true, subtree: true });
  }

  // 解析推演状态文本 → 切换地球形态 + 进度环
  function setBallState(text, isError) {
    const ball = document.getElementById('we-input-btn');
    if (!ball) return;
    const ring = ball.querySelector('.we-ball-ring');
    const badge = ball.querySelector('.we-ball-badge');
    // 悬浮球不显示状态文字（文字走屏幕顶部横幅）

    ball.classList.remove('we-ball-evolving', 'we-ball-success', 'we-ball-fail');
    clearTimeout(_ballStatusTimer);

    const count = ball.querySelector('.we-ball-count');
    const clearCount = () => {
      ball.classList.remove('we-ball-counting');
      if (count) count.textContent = '';
      if (ring) ring.style.setProperty('--we-ring-pct', '0deg');
    };

    if (/Backfilling/.test(text)) {
      // 批量回填：地球持续旋转 + 右下角显示「批/总」进度
      ball.classList.add('we-ball-evolving');
      if (badge) badge.textContent = '';
      const mb = /(\d+)\s*\/\s*(\d+)/.exec(text);
      if (mb && ring) {
        const cur = Number(mb[1]), total = Number(mb[2]) || 1;
        const pct = Math.max(0, Math.min(1, cur / total));
        ring.style.setProperty('--we-ring-pct', (pct * 360) + 'deg');
        ball.classList.add('we-ball-counting');
        if (count) count.textContent = `${cur}/${total}`;
      } else {
        clearCount();
      }
    } else if (/Evolving/.test(text)) {
      ball.classList.add('we-ball-evolving');
      if (badge) badge.textContent = '';
      clearCount(); // 推演进行中不展示轮次计数，避免残留旧的 N/X
    } else if (isError || /failed|error/i.test(text)) {
      ball.classList.add('we-ball-fail');
      if (badge) badge.textContent = '✕';
      _ballStatusTimer = setTimeout(() => clearBallBadge(), 6000);
    } else if (/\bcomplete\b/i.test(text)) {
      ball.classList.add('we-ball-success');
      if (badge) badge.textContent = '✓';
      clearCount(); // 推演完成 → 计数已归零，清掉进度环与数字
      _ballStatusTimer = setTimeout(() => clearBallBadge(), 4000);
    }

    // 解析「第 N/X 轮」→ 进度环 + 数字（仅未到推演的提示态才显示）
    const m = /Round\s*(\d+)\s*\/\s*(\d+)/.exec(text || '');
    if (ring && m) {
      const cur = Number(m[1]), total = Number(m[2]) || 1;
      const pct = Math.max(0, Math.min(1, cur / total));
      ring.style.setProperty('--we-ring-pct', (pct * 360) + 'deg');
      ball.classList.toggle('we-ball-counting', cur > 0 && cur < total);
      if (count) count.textContent = (cur < total) ? `${cur}/${total}` : '';
    }
  }

  function clearBallBadge() {
    const ball = document.getElementById('we-input-btn');
    if (!ball) return;
    ball.classList.remove('we-ball-success', 'we-ball-fail');
    const badge = ball.querySelector('.we-ball-badge');
    if (badge) badge.textContent = '';
  }

  // 屏幕正上方状态横幅：显示约 5s 后淡出
  let _topStatusTimer = null;
  function showTopStatus(text, isError) {
    if (!document.body || !text) return;
    let el = document.getElementById('we-top-status');
    if (!el) {
      el = document.createElement('div');
      el.id = 'we-top-status';
      document.body.appendChild(el);
    }
    el.textContent = text;
    el.classList.toggle('we-top-status-error', !!isError);
    el.classList.add('show');
    clearTimeout(_topStatusTimer);
    _topStatusTimer = setTimeout(() => { el.classList.remove('show'); }, 5000);
  }

  // 给悬浮球的五颗卫星按钮绑事件；阻止冒泡，避免触发拖拽 / 打开面板
  function wireSatellites(ball) {
    const wire = (id, fn) => {
      const el = ball.querySelector('#' + id);
      if (!el) return;
      const stop = e => e.stopPropagation();
      el.addEventListener('mousedown', stop);
      el.addEventListener('touchstart', stop, { passive: true });
      el.addEventListener('click', (e) => {
        e.stopPropagation(); e.preventDefault();
        if (el.classList.contains('we-sat-off')) return;
        fn();
      });
    };
    wire('we-sat-forward', () => {
      callEngineFaceAction(getEngineFace(), 'forward');
    });
    wire('we-sat-redo', () => {
      callEngineFaceAction(getEngineFace(), 'redo');
    });
    wire('we-sat-abort', () => {
      const face = getEngineFace();
      const done = result => { if (result !== ENGINE_ACTION_FAILED) showToast('Stop signal sent'); };
      const result = callEngineFaceAction(face, 'abort');
      if (result && typeof result.then === 'function') result.then(done);
      else done(result);
    });

    // 「插头」跟随当前球面：世界面改 world_engine_settings，记忆面改 memory_engine_settings。
    // 每个已注册引擎各自管理总开关，且不改写用户选好的推演模式与注入选项。
    //   不用 we-sat-off(wire 内会拦 we-sat-off 不可点);用 .on class 标关闭态,power 永远可点。
    wire('we-sat-power', () => {
      const face = getEngineFace();
      const turnOff = getFaceSettings().engineEnabled !== false;
      const finish = result => {
        if (result === ENGINE_ACTION_FAILED) return;
        updateBallControls();
        showToast(turnOff ? `${face.label} evolution and injection turned off` : `${face.label} evolution and injection turned on`);
        if (typeof _currentView !== 'undefined' && _currentView === 'settings') refresh();
      };
      const result = callEngineFaceAction(face, 'setEnabled', !turnOff);
      if (result && typeof result.then === 'function') result.then(finish);
      else finish(result);
    });
    wire('we-sat-engine-switch', () => {
      const shortcut = ball.querySelector('#we-sat-engine-switch');
      switchEngineFace(shortcut?.dataset.targetEngine || (getEngineFace().id === 'memory' ? 'world' : 'memory'));
    });
  }

  function buildInputButton() {
    if (!document.body) return;

    let btn = document.getElementById('we-input-btn');
    if (!btn) {
      btn = document.createElement('button');
      btn.id = 'we-input-btn';
      btn.type = 'button';
      btn.title = 'World Engine';
      btn.setAttribute('aria-label', 'World Engine');
      btn.className = 'we-ball';
      btn.innerHTML =
        '<span class="we-ball-orbit"></span>' +
        '<span class="we-ball-ring"></span>' +
        '<span class="we-ball-core"><span class="we-ball-globe"></span><span class="we-ball-memory"><span class="we-memory-scan"></span></span></span>' +
        '<span class="we-ball-count"></span>' +
        '<span class="we-ball-badge"></span>' +
        '<span class="we-ball-tip"></span>' +
        '<span class="we-sat we-sat-up" id="we-sat-forward" role="button" title="Advance"><i class="fa-solid fa-forward"></i></span>' +
        '<span class="we-sat we-sat-right we-sat-off" id="we-sat-abort" role="button" title="Stop evolution"><i class="fa-solid fa-stop"></i></span>' +
        '<span class="we-sat we-sat-down" id="we-sat-redo" role="button" title="Redo"><i class="fa-solid fa-rotate-right"></i></span>' +
        '<span class="we-sat we-sat-left" id="we-sat-power" role="button" title="Plugged in = evolution and injection off / unplugged = on"><i class="fa-solid fa-power-off"></i></span>' +
        '<span class="we-sat we-sat-lower-right we-sat-engine-switch" id="we-sat-engine-switch" role="button"></span>';
      btn.onclick = () => togglePanel();
      document.body.appendChild(btn);
      wireSatellites(btn);
      syncBallFace();
      applyBallPos(btn);
      makeBallDraggable(btn);
      window.addEventListener('resize', () => applyBallPos(btn));
      setEvolvingUI(isEvolving || Boolean(evolution?.isRunning?.()));
    } else if (btn.parentElement !== document.body) {
      document.body.appendChild(btn);
      applyBallPos(btn);
    }

    // 兼容旧的外部状态接口：保留隐藏元素，转发到地球状态机
    let statusIndicator = document.getElementById('we-external-status');
    if (!statusIndicator) {
      statusIndicator = document.createElement('span');
      statusIndicator.id = 'we-external-status';
      statusIndicator.style.display = 'none';
      document.body.appendChild(statusIndicator);
    }

    window.__WE_SetExternalStatus = function(text, isError) {
      const el = document.getElementById('we-external-status');
      if (el) el.textContent = text;
      setBallState(text || '', !!isError);
      // 进度类（第 N/X 轮/天、回填中 i/M）只在悬浮球上显示；其余状态走屏幕顶部横幅
      if (text && !/(?:Round|Day)\s*\d+\s*\/\s*\d+/.test(text) && !/Backfilling/.test(text)) {
        showTopStatus(text, !!isError);
      }
    };

    buildPanel();
    observeInputButton();
  }

  return {
    buildPanel, buildInputButton, showPanel, hidePanel, togglePanel, refresh, setStatus,
    setEvolvingUI, setMemoryEvolvingUI, setInjectedScope,
    registerEngineFace,
    listEngineFaces: () => { ensureBuiltinEngineFaces(); return _engineFaceOrder.map(id => ({ ...getEngineFace(id) })); },
    advanceEngineFace
  };
})();
