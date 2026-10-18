// world-engine-evolution.js — 世界推演 API 调用（使用完整活体引擎规则）
window.WORLD_ENGINE_EVOLUTION = (function() {
  const core = window.WORLD_ENGINE_CORE;
  const api = window.WORLD_ENGINE_API;

  const EVENT_TYPES = ['conflict', 'progress'];
  const EVENT_STAGE_ORDER = {
    conflict: ['Brewing', 'Escalating', 'Imminent'],
    progress: ['Preparing', 'Underway', 'Critical']
  };
  const EVENT_FINAL_STAGE = {
    conflict: 'Erupted',
    progress: 'Completed'
  };
  const EVENT_TERMINAL_STAGES = {
    conflict: ['Erupted', 'Dissipated'],
    progress: ['Completed', 'Failed']
  };
  const EVENT_STAGE_BASE = {
    conflict: { 'Brewing': 95, 'Escalating': 85, 'Imminent': 75 },
    progress: { 'Preparing': 75, 'Underway': 85, 'Critical': 95 }
  };
  const WIND_DECAY = {
    announcement: { base: 10, grace: 4, linear: 3, quadratic: 1 },
    report: { base: 20, grace: 2, linear: 4, quadratic: 2 },
    rumor: { base: 25, grace: 1, linear: 5, quadratic: 3 },
    sentiment: { base: 8, grace: 5, linear: 2, quadratic: 1 }
  };

  function localSettings() {
    return api && api.getSettings ? api.getSettings() : {};
  }

  function numSetting(key, fallback, min, max) {
    const n = Number(localSettings()[key]);
    let v = Number.isFinite(n) ? n : fallback;
    if (min !== undefined) v = Math.max(min, v);
    if (max !== undefined) v = Math.min(max, v);
    return v;
  }

  function intSetting(key, fallback, min, max) {
    return Math.round(numSetting(key, fallback, min, max));
  }

  function capSetting(key, fallback) {
    return intSetting(key, fallback, 1);
  }

  function windDecayParams(type) {
    const defaults = WIND_DECAY[type] || WIND_DECAY.rumor;
    const prefix = {
      announcement: 'localWindAnnouncement',
      report: 'localWindReport',
      rumor: 'localWindRumor',
      sentiment: 'localWindSentiment'
    }[type] || 'localWindRumor';
    return {
      base: numSetting(prefix + 'Base', defaults.base, 0, 95),
      grace: intSetting(prefix + 'Grace', defaults.grace, 0),
      linear: numSetting(prefix + 'Linear', defaults.linear, 0),
      quadratic: numSetting(prefix + 'Quadratic', defaults.quadratic, 0)
    };
  }

  function positiveTerminalKeepRounds(event) {
    const base = intSetting('localTerminalBaseKeepRounds', 2, 0);
    const perLevel = intSetting('localTerminalLevelKeepRounds', 2, 0);
    return base + (event.level || 1) * perLevel;
  }

  let _lastPrompt = '';
  let _lastRawResult = '';
  // [MAP] 推演 prompt 分段（全透明展示用，只读）。与实际发出的 prompt 字节级一致：
  // 各段先提成命名变量，模板字面量与 segments 数组引用同一变量，杜绝重复求值/复制漂移。
  let _lastPromptSegments = [];

  function getLastDebug() {
    return { prompt: _lastPrompt, rawResult: _lastRawResult, segments: _lastPromptSegments };
  }

  // ========== 区域突发事件骰子系统 ==========

  const REGIONAL_INCIDENT_CONFIG = {
    chance: 0.03,
    durationRounds: 5,
    cooldownRounds: 5,
    typeWeights: [
      { type: 'banditry', label: 'Banditry and raids', weight: 18 },
      { type: 'fire', label: 'Great fire', weight: 14 },
      { type: 'massacre', label: 'Atrocious murders', weight: 10 },
      { type: 'flood', label: 'Flood', weight: 10 },
      { type: 'infrastructure', label: 'Road and waterworks failure', weight: 10 },
      { type: 'plague', label: 'Epidemic', weight: 9 },
      { type: 'famine', label: 'Famine and grain shortage', weight: 8 },
      { type: 'riot', label: 'Riots', weight: 8 },
      { type: 'rebellion', label: 'Popular uprising', weight: 5 },
      { type: 'military', label: 'Military upheaval', weight: 4 },
      { type: 'earthquake', label: 'Earthquake and landslide', weight: 2 },
      { type: 'storm', label: 'Storm and blizzard', weight: 2 }
    ]
  };

  const INCIDENT_TYPE_GUIDE = {
    banditry: 'Banditry and raids: mountain bandits, river pirates, roving brigands, robber gangs, hijacked escorts, seized boats, stolen grain or salt, villages or caravans plundered and slaughtered.',
    fire: 'Great fire: a regional fire in markets, granaries, docks, temples, government offices, workshops, fleets or warehouses.',
    massacre: 'Atrocious murders: serial killings, a whole family murdered, a bloodbath at an inn, a slaughtered caravan, bodies at the docks, or other cases severe enough to cause panic.',
    flood: 'Flood: rivers surging, dikes breaking, docks flooded, villages and fields destroyed, bridges swept away.',
    infrastructure: 'Road and waterworks failure: highway collapses, fallen bridges, ferries halted, cracked dikes, damaged sluice gates, post roads cut off.',
    plague: 'Epidemic: human or livestock disease, contaminated water, villages sealed off, docks refusing cargo, a surge of high-fever patients in the city.',
    famine: 'Famine and grain shortage: empty granaries, relief grain cut off, soaring grain prices, refugees seizing grain, wealthy households locking their stores, villages without food.',
    riot: 'Riots: dockside brawls, hungry crowds seizing grain, stampedes of pilgrims, salt shops smashed, clashes at checkpoints, street fights spreading.',
    rebellion: 'Popular uprising: displaced people building stockades, local militia turning on officials, tax and corvée revolts, cults gathering crowds, regional rebellion.',
    military: 'Military upheaval: garrison mutiny, army supplies seized, border troops routed, enemy forces crossing the border, passes under martial law, panic in the barracks at night.',
    earthquake: 'Earthquake and landslide: earthquakes, landslides, mine collapses, ground fissures, mountain villages buried.',
    storm: 'Storm and blizzard: typhoons, blizzards, sandstorms, cold waves, sea winds wrecking ships, gales tearing down shacks.'
  };

  function ensureRegionalIncident(state) {
    if (!state.regionalIncident) {
      state.regionalIncident = {
        active: false,
        title: '',
        type: '',
        scope: '',
        impact: '',
        duration: 0,
        cooldown: 0,
        _retry: false,
        _retryType: ''
      };
    }
  }

  function getIncidentTypeLabel(type) {
    const found = REGIONAL_INCIDENT_CONFIG.typeWeights.find(t => t.type === type);
    return found ? found.label : type;
  }

  function buildRegionalIncidentOngoingPrompt(incident) {
    return `
[Regional incident still active (${incident.duration} rounds left)]
Title: ${incident.title}
Type: ${getIncidentTypeLabel(incident.type)}
Scope: ${incident.scope}
Current impact: ${incident.impact}
This incident is still active. Carry its aftermath into this round's evolution (economy, news, faction actions and so on); do not write it as already settled, and do not generate a new incident in the regionalIncident field.
`;
  }

  function weightedPick(items, randomFn = Math.random) {
    const total = items.reduce((sum, item) => sum + item.weight, 0);
    let roll = randomFn() * total;
    for (const item of items) {
      roll -= item.weight;
      if (roll <= 0) return item;
    }
    return items[items.length - 1];
  }

  function buildRegionalIncidentPrompt(picked) {
    const guide = INCIDENT_TYPE_GUIDE[picked.type] || '';
    return `
[Local dice order: this round must generate a regional incident]
The local dice decided: a regional incident triggers this round.
The local dice set the incident type:
Type: ${picked.label}
type: ${picked.type}
Type description: ${guide}
Based on the current world state, generate a region-level incident that fits this type.
The incident must:
1. Affect one clear region, road, town, pass, dock, temple, market, village, trade route or waterway.
2. Not be a small episode, background noise or a one-person accident.
3. Produce news that can spread.
4. Cause at least one spillover effect: an economic change, a faction action, a change in public order, an event-chain change, a reputation change, a black-box change or a new influence chain.
5. Have no direct causal link to {{user}}'s current actions, and not be written as the plot of an existing enemy, existing faction or existing event chain.
6. Happen at a location you choose based on the current world state; it must be plausible, must not wipe out the core stage out of nowhere, and must not destroy {{user}}'s core assets without cause.
7. If it does not happen in {{user}}'s region, do not forcibly interrupt {{user}}'s current action; treat it only as a background world change, distant news or spreading talk.
8. If it happens in {{user}}'s region, it may put pressure on the current scene, but still must not make choices for {{user}}.
9. Do not generate low-value events such as a startled carriage horse, someone caught in an affair, passers-by quarreling, a pickpocket, a drunk making trouble or an ordinary neighborly dispute.
10. Do not write the "regional incident" as a plot an existing faction planned long ago, unless the existing state holds clear causal evidence.
You must return these JSON fields:
{
  "regionalIncident": {
    "active": true,
    "title": "incident title",
    "type": "${picked.type}",
    "scope": "area affected",
    "impact": "one sentence summing up the regional consequences"
  },
  "winds": [
    {
      "topic": "stable topic name",
      "type": "report",
      "level": 1-4,
      "content": "what is being said",
      "scope": "how far it has spread",
      "source": "chain of sources"
    }
  ],
  "influenceChain": [
    {
      "trigger": "regional incident title",
      "impact": "direct effects already caused",
      "fallout": "aftermath to come"
    }
  ]
}
If the incident is already enough to form an ongoing conflict or a task to manage, you may also return events.
If it affects markets, roads, waterways, grain prices, salt prices or freight, you may also return economy.
If it affects a faction's judgment or resources, you may also return factions.
If it affects {{user}}'s reputation, you may also return reputation.
If it has secret witnesses, hidden evidence, missing people or unpublicized truths, you may also return blackbox.
`;
  }

  function rollRegionalIncident(state, randomFn = Math.random) {
    ensureRegionalIncident(state);
    const incident = state.regionalIncident;

    // 事件持续中：每轮倒计时，归零后消散并进入冷却
    if (incident.active) {
      const remaining = Math.max(0, (incident.duration || 0) - 1);
      incident.duration = remaining;
      if (remaining <= 0) {
        const title = incident.title;
        incident.active = false;
        incident.title = '';
        incident.type = '';
        incident.scope = '';
        incident.impact = '';
        incident.duration = 0;
        incident.cooldown = intSetting('localRegionalIncidentCooldown', REGIONAL_INCIDENT_CONFIG.cooldownRounds, 1);
        incident._retry = false;
        incident._retryType = '';
        console.log('[World Engine] Regional incident dissipated (duration ended):', title);
        return { triggered: false, injectPrompt: '', reason: 'expired' };
      }
      // 仍在持续，注入"持续中"提示
      return {
        triggered: true,
        ongoing: true,
        injectPrompt: buildRegionalIncidentOngoingPrompt(incident),
        reason: 'ongoing'
      };
    }

    // 冷却中
    if ((incident.cooldown || 0) > 0) {
      incident.cooldown = Math.max(0, incident.cooldown - 1);
      return { triggered: false, injectPrompt: '', reason: 'cooldown' };
    }

    const dice = randomFn();
    const chance = numSetting('localRegionalIncidentChancePercent', REGIONAL_INCIDENT_CONFIG.chance * 100, 0, 100) / 100;

    // 确定是否需要触发
    let triggerNow = false;
    let triggerType = incident._retryType || '';
    let triggerLabel = '';

    if (incident._retry && triggerType) {
      // 上轮骰子成功但 API 未返回 → 重试，类型不变
      triggerNow = true;
      incident._retry = false;
      incident._retryType = '';
      const found = REGIONAL_INCIDENT_CONFIG.typeWeights.find(t => t.type === triggerType);
      if (found) triggerLabel = found.label;
    }

    if (!triggerNow && dice >= chance) {
      // 未触发
      incident.active = false;
      incident.title = '';
      incident.type = '';
      incident.scope = '';
      incident.impact = '';
      return { triggered: false, injectPrompt: '', chance, dice, reason: 'miss' };
    }

    // 触发（首轮）
    let picked;
    if (!triggerNow) {
      picked = weightedPick(REGIONAL_INCIDENT_CONFIG.typeWeights, randomFn);
      triggerType = picked.type;
      triggerLabel = picked.label;
    }

    incident.active = true;
    incident.type = triggerType;
    incident.duration = intSetting('localRegionalIncidentDuration', REGIONAL_INCIDENT_CONFIG.durationRounds, 1); // 持续轮数，冷却在消散后才开始
    incident.cooldown = 0;

    return {
      triggered: true,
      ongoing: false,
      incidentType: triggerType,
      incidentLabel: triggerLabel,
      injectPrompt: buildRegionalIncidentPrompt({ type: triggerType, label: triggerLabel || triggerType }),
      chance,
      dice,
      reason: triggerNow ? 'retry' : 'hit'
    };
  }

  function mergeRegionalIncident(state, update) {
    ensureRegionalIncident(state);
    const incident = state.regionalIncident;

    // 本轮没有本地骰子触发，不接受 API 自发生成
    if (!incident.active) {
      incident.title = '';
      incident.type = '';
      incident.scope = '';
      incident.impact = '';
      incident._retry = false;
      incident._retryType = '';
      return;
    }

    // 持续中的事件（已有标题）：内容固定，不接受 API 覆盖
    if (incident.title) {
      if (update.regionalIncident) delete update.regionalIncident;
      return;
    }

    // 新触发首轮（尚无标题）：合并 API 返回的事件内容
    const duration = incident.duration || intSetting('localRegionalIncidentDuration', REGIONAL_INCIDENT_CONFIG.durationRounds, 1);
    if (update.regionalIncident && update.regionalIncident.active) {
      state.regionalIncident = {
        active: true,
        title: update.regionalIncident.title || 'Unnamed regional incident',
        type: update.regionalIncident.type || incident.type || 'other',
        scope: update.regionalIncident.scope || 'Unknown region',
        impact: update.regionalIncident.impact || 'Regional order has been shaken.',
        duration,
        cooldown: 0,
        _retry: false,
        _retryType: ''
      };
    } else {
      // API 没返回 → 设置重试标记，下轮继续
      state.regionalIncident = {
        active: false,
        title: 'Regional incident generation failed (will retry next round)',
        type: incident.type || 'other',
        scope: 'Unknown region',
        impact: 'The local dice triggered a regional incident, but the API returned no regionalIncident. The same type will be retried next round.',
        duration: 0,
        cooldown: 0,
        _retry: true,
        _retryType: incident.type || ''
      };
    }
  }

  // ========== 远方随机事件（账本驱动、本地骰子、失败持续重试） ==========
  function ensureDistantEvent(state) {
    if (!state.distantEvent || typeof state.distantEvent !== 'object') {
      state.distantEvent = { pending: false, cooldown: 0, sample: [], requestedRound: 0, requestedType: '' };
    }
    state.distantEvent.pending = state.distantEvent.pending === true;
    state.distantEvent.cooldown = Math.max(0, parseInt(state.distantEvent.cooldown) || 0);
    state.distantEvent.sample = Array.isArray(state.distantEvent.sample) ? state.distantEvent.sample : [];
    state.distantEvent.requestedRound = Math.max(0, parseInt(state.distantEvent.requestedRound) || 0);
    state.distantEvent.requestedType = ['event', 'wind'].includes(state.distantEvent.requestedType) ? state.distantEvent.requestedType : '';
    return state.distantEvent;
  }

  function pickDistantEventType(randomFn = Math.random) {
    const eventChance = numSetting('localDistantEventEventPercent', 50, 0, 100) / 100;
    return randomFn() < eventChance ? 'event' : 'wind';
  }

  function sampleDistantLedger(state, randomFn = Math.random) {
    const entries = (state.memories || []).filter(m => m && m.type === 'ledger');
    const recentCount = Math.floor(entries.length / 4);
    const targetCount = Math.floor(entries.length / 2);
    const recent = entries.slice(0, recentCount);
    const older = entries.slice(recentCount);
    for (let i = older.length - 1; i > 0; i--) {
      const j = Math.floor(randomFn() * (i + 1));
      [older[i], older[j]] = [older[j], older[i]];
    }
    return recent.concat(older.slice(0, Math.max(0, targetCount - recent.length))).map(entry => ({
      round: entry.round,
      changes: Array.isArray(entry.changes) ? entry.changes : []
    }));
  }

  function buildDistantEventPrompt(sample, requestedType) {
    const wantsEvent = requestedType === 'event';
    const targetText = wantsEvent ? 'one new events event chain' : 'one new winds news item';
    return `
[Local random mechanism order: this round must generate one distant development]
Below is part of the history ledger, only for identifying event themes, conflict structures and news content that have already been used. Do not continue, rewrite, copy or directly connect to these records:
${JSON.stringify(sample || [], null, 2)}

The local system has set the type of this round's distant development: ${wantsEvent ? 'event chain (events)' : 'news (winds)'}.
Drawing on the current world state, World Info, era, geography and cast of characters, add ${targetText} independently for this distant development (this does not affect your normal updates to other existing world state). Do not change it to another type.

Mandatory requirements:
- The new object's level may only be Lv2 or Lv3.
- The new object must set "id": null and also set the temporary marker "_distanceGenerated": true.
- This temporary marker is only for local confirmation that generation succeeded; do not add it to other objects.
- It has no direct causal link to {{user}}'s current actions, assets, reputation, enemies or current scene, and must not forcibly interrupt {{user}}'s current action.
- It must not be directly caused by existing events, faction conflicts or news in the ledger above, and must not copy their themes or structure.
- It must be rooted in the current setting and existing world conditions, happening in a distant region, group or social system that plausibly exists; it cannot be causeless random noise.
- ${wantsEvent ? 'It must meet the general admission rules for events and fill in all fields of a new event.' : 'It must meet the general admission rules for winds and fill in all fields of a new news item.'}
- This distant development may have only one new object with the "_distanceGenerated" marker; if there are other local mandatory orders this round, complete them separately; they do not count toward this mechanism's one-object limit.
`;
  }

  function rollDistantEvent(state, randomFn = Math.random) {
    const distant = ensureDistantEvent(state);
    const ledgerEntries = (state.memories || []).filter(m => m && m.type === 'ledger');

    if (distant.pending) {
      if (!distant.sample.length && ledgerEntries.length) distant.sample = sampleDistantLedger(state, randomFn);
      // 兼容功能上线初期已进入 pending、但尚未保存目标类型的存档。
      if (!distant.requestedType) distant.requestedType = pickDistantEventType(randomFn);
      return { triggered: true, retry: true, requestedType: distant.requestedType, injectPrompt: buildDistantEventPrompt(distant.sample, distant.requestedType), reason: 'retry' };
    }
    if (distant.cooldown > 0) {
      distant.cooldown = Math.max(0, distant.cooldown - 1);
      return { triggered: false, injectPrompt: '', reason: 'cooldown' };
    }

    const threshold = intSetting('localDistantEventLedgerThreshold', 10, 1);
    if (ledgerEntries.length < threshold) return { triggered: false, injectPrompt: '', reason: 'ledger-threshold' };

    const chance = numSetting('localDistantEventChancePercent', 20, 0, 100) / 100;
    const dice = randomFn();
    if (dice >= chance) return { triggered: false, injectPrompt: '', chance, dice, reason: 'miss' };

    distant.pending = true;
    distant.sample = sampleDistantLedger(state, randomFn);
    distant.requestedRound = state.round;
    distant.requestedType = pickDistantEventType(randomFn);
    return { triggered: true, retry: false, requestedType: distant.requestedType, injectPrompt: buildDistantEventPrompt(distant.sample, distant.requestedType), chance, dice, reason: 'hit' };
  }

  function acceptDistantEventResult(state, update) {
    const distant = ensureDistantEvent(state);
    const markedEvents = (update.events || []).filter(item => item && item._distanceGenerated === true);
    const markedWinds = (update.winds || []).filter(item => item && item._distanceGenerated === true);
    const marked = markedEvents.concat(markedWinds);

    // 临时标记无论是否处于 pending 都不得进入正式状态。
    for (const item of [...(update.events || []), ...(update.winds || [])]) {
      if (item && Object.prototype.hasOwnProperty.call(item, '_distanceGenerated')) delete item._distanceGenerated;
    }
    if (!distant.pending) return false;

    const candidate = marked.length === 1 ? marked[0] : null;
    const isEvent = candidate && markedEvents.includes(candidate);
    const typeMatches = !!candidate && ((distant.requestedType === 'event' && isEvent) || (distant.requestedType === 'wind' && !isEvent));
    const level = candidate ? parseInt(candidate.level) : 0;
    const validShape = isEvent
      ? !!(candidate.name && ['conflict', 'progress'].includes(candidate.type))
      : !!(candidate && candidate.topic && candidate.content);
    const valid = !!candidate && candidate._nearGenerated !== true && typeMatches && (level === 2 || level === 3) && validShape;

    if (!valid) {
      update.events = (update.events || []).filter(item => !markedEvents.includes(item));
      update.winds = (update.winds || []).filter(item => !markedWinds.includes(item));
      console.warn('[World Engine] Distant random event failed validation; generation will be forced again next round');
      return false;
    }

    candidate.id = null;
    candidate.level = level;
    distant.pending = false;
    distant.cooldown = intSetting('localDistantEventCooldown', 5, 1);
    distant.sample = [];
    distant.requestedRound = 0;
    distant.requestedType = '';
    console.log('[World Engine] Distant random event generated:', isEvent ? candidate.name : candidate.topic);
    return true;
  }

  // ========== 近端随机事件（当前剧情驱动、本地骰子、失败持续重试） ==========
  function ensureNearEvent(state) {
    if (!state.nearEvent || typeof state.nearEvent !== 'object') {
      state.nearEvent = { pending: false, cooldown: 0, requestedRound: 0, requestedType: '' };
    }
    state.nearEvent.pending = state.nearEvent.pending === true;
    state.nearEvent.cooldown = Math.max(0, parseInt(state.nearEvent.cooldown) || 0);
    state.nearEvent.requestedRound = Math.max(0, parseInt(state.nearEvent.requestedRound) || 0);
    state.nearEvent.requestedType = ['event', 'wind'].includes(state.nearEvent.requestedType) ? state.nearEvent.requestedType : '';
    return state.nearEvent;
  }

  function pickNearEventType(randomFn = Math.random) {
    const eventChance = numSetting('localNearEventEventPercent', 50, 0, 100) / 100;
    return randomFn() < eventChance ? 'event' : 'wind';
  }

  function buildNearEventPrompt(requestedType) {
    const wantsEvent = requestedType === 'event';
    const targetText = wantsEvent ? 'one new events event chain' : 'one new winds news item';
    return `
[Local random mechanism order: this round must generate one nearby development]
The local system has set the type of this round's nearby development: ${wantsEvent ? 'event chain (events)' : 'news (winds)'}.
Drawing on the current world state, World Info and recent conversation, add ${targetText} for this nearby development. Do not change it to another type.

Mandatory requirements:
- The new object's level may only be Lv2 or Lv3.
- The new object must set "id": null and also set the temporary marker "_nearGenerated": true.
- This temporary marker is only for local confirmation that generation succeeded; do not add it to other objects, and do not use it together with "_distanceGenerated".
- The content must have a clear, traceable causal link to {{user}}'s current actions, the people they are dealing with, their region, the current scene or matters in progress; merely being in the same place or on a similar theme is not enough.
- Do not make decisions for {{user}}, and do not invent witnesses, spread, intelligence sources or other key conditions.
- ${wantsEvent
      ? 'It must meet the creation and merging rules for events: it should be a new main matter that can develop on its own across rounds; do not split steps, obstacles, partial results or aftermath of an existing event into a new chain.'
      : 'It must meet the spreading rules for winds: the information has already begun spreading through valid nodes, with its actual scope and source written out.'}
- This nearby development may have only one new object with the "_nearGenerated" marker; if there are other local mandatory orders this round, complete them separately; they do not count toward this mechanism's one-object limit.
`;
  }

  function rollNearEvent(state, randomFn = Math.random) {
    const near = ensureNearEvent(state);
    if (near.pending) {
      if (!near.requestedType) near.requestedType = pickNearEventType(randomFn);
      return { triggered: true, retry: true, requestedType: near.requestedType, injectPrompt: buildNearEventPrompt(near.requestedType), reason: 'retry' };
    }
    if (near.cooldown > 0) {
      near.cooldown = Math.max(0, near.cooldown - 1);
      return { triggered: false, injectPrompt: '', reason: 'cooldown' };
    }

    const chance = numSetting('localNearEventChancePercent', 20, 0, 100) / 100;
    const dice = randomFn();
    if (dice >= chance) return { triggered: false, injectPrompt: '', chance, dice, reason: 'miss' };

    near.pending = true;
    near.requestedRound = state.round;
    near.requestedType = pickNearEventType(randomFn);
    return { triggered: true, retry: false, requestedType: near.requestedType, injectPrompt: buildNearEventPrompt(near.requestedType), chance, dice, reason: 'hit' };
  }

  function acceptNearEventResult(state, update) {
    const near = ensureNearEvent(state);
    const markedEvents = (update.events || []).filter(item => item && item._nearGenerated === true);
    const markedWinds = (update.winds || []).filter(item => item && item._nearGenerated === true);
    const marked = markedEvents.concat(markedWinds);

    for (const item of [...(update.events || []), ...(update.winds || [])]) {
      if (item && Object.prototype.hasOwnProperty.call(item, '_nearGenerated')) delete item._nearGenerated;
    }
    if (!near.pending) return false;

    const candidate = marked.length === 1 ? marked[0] : null;
    const isEvent = candidate && markedEvents.includes(candidate);
    const typeMatches = !!candidate && ((near.requestedType === 'event' && isEvent) || (near.requestedType === 'wind' && !isEvent));
    const level = candidate ? parseInt(candidate.level) : 0;
    const validShape = isEvent
      ? !!(candidate.name && ['conflict', 'progress'].includes(candidate.type))
      : !!(candidate && candidate.topic && candidate.content);
    const valid = !!candidate && typeMatches && (level === 2 || level === 3) && validShape;

    if (!valid) {
      update.events = (update.events || []).filter(item => !markedEvents.includes(item));
      update.winds = (update.winds || []).filter(item => !markedWinds.includes(item));
      console.warn('[World Engine] Nearby random event failed validation; generation will be forced again next round');
      return false;
    }

    candidate.id = null;
    candidate.level = level;
    near.pending = false;
    near.cooldown = intSetting('localNearEventCooldown', 5, 1);
    near.requestedRound = 0;
    near.requestedType = '';
    console.log('[World Engine] Nearby random event generated:', isEvent ? candidate.name : candidate.topic);
    return true;
  }

  // ========== 事件链骰子推进（双类型四阶段系统）==========
  // 每个阶段 9 格，满 9 晋级下一阶段。
  // conflict: 萌芽→发酵→逼近→已爆发；API 可判定已消散；level 越高越容易推进。
  // progress: 筹备→执行→关键→已完成；API 可判定已失败；level 越高越难推进。
  // 停滞完全交给 API 控制，本地骰子不再跳过轮次
  function forceTriggerEvents(state) {
    const events = state.events || [];
    let anyTriggered = false;

    for (const ev of events) {
      // 清除上轮结果
      delete ev.evolveResult;

      // 初始化字段
      if (!ev.type || !EVENT_TYPES.includes(ev.type)) ev.type = 'conflict';
      if (ev.stageRound === undefined) ev.stageRound = 1;
      if (ev.consecutiveFails === undefined) ev.consecutiveFails = 0;
      const stageOrder = EVENT_STAGE_ORDER[ev.type] || EVENT_STAGE_ORDER.conflict;
      const terminalStages = EVENT_TERMINAL_STAGES[ev.type] || EVENT_TERMINAL_STAGES.conflict;

      // 终局事件跳过
      if (terminalStages.includes(ev.stage)) continue;
      // Unclassified/scene-dependent chains are not autonomous jobs.
      if (ev.resolution !== 'world') continue;
      if (!ev.stage || !stageOrder.includes(ev.stage)) ev.stage = stageOrder[0];

      // 保底：连续非成功达到上限则强制成功
      const maxFails = getMaxFails(ev);
      if (ev.consecutiveFails >= maxFails) {
        advanceStageRound(ev);
        ev.consecutiveFails = 0;
        ev.evolveResult = 'Success';
        anyTriggered = true;
        if (ev.stage === EVENT_FINAL_STAGE.conflict) logEruption(state, ev);
        continue;
      }

      // 正常掷骰
      const r = Math.min(1, (ev.stageRound || 1) / 9);
      const stageBase = (EVENT_STAGE_BASE[ev.type] || EVENT_STAGE_BASE.conflict)[ev.stage] || 85;
      const level = ev.level || 1;
      const levelAdjust = ev.type === 'progress' ? (level - 1) * 10 : -((level - 1) * 10);
      const threshold = Math.round(stageBase - 200 * r * (1 - r) + levelAdjust - numSetting('localEventDiceModifier', 0, -100, 100));
      const dice = Math.floor(Math.random() * 100) + 1;

      if (dice > threshold) {
        // 成功：推进
        advanceStageRound(ev);
        ev.consecutiveFails = 0;
        ev.evolveResult = 'Success';
        anyTriggered = true;
        if (ev.stage === EVENT_FINAL_STAGE.conflict) logEruption(state, ev);
      } else if (dice < threshold * (numSetting('localEventSetbackRatioPercent', 40, 0, 100) / 100)) {
        // 受挫：倒退
        ev.stageRound = Math.max(1, ev.stageRound - 1);
        ev.consecutiveFails++;
        ev.evolveResult = 'Setback';
      } else {
        // 保持：不动
        ev.consecutiveFails++;
        ev.evolveResult = 'Hold';
      }
    }

    if (anyTriggered) return anyTriggered;
  }

  function getMaxFails(ev) {
    const level = ev.level || 1;
    const progressBase = intSetting('localProgressFailBase', 2, 0);
    const conflictBase = intSetting('localConflictFailBase', 6, 1);
    return ev.type === 'progress' ? progressBase + level : Math.max(1, conflictBase - level);
  }

  function advanceStageRound(ev) {
    const stageOrder = EVENT_STAGE_ORDER[ev.type] || EVENT_STAGE_ORDER.conflict;
    const finalStage = EVENT_FINAL_STAGE[ev.type] || EVENT_FINAL_STAGE.conflict;
    ev.stageRound++;
    if (ev.stageRound >= 9) {
      // 晋级下一阶段
      const idx = stageOrder.indexOf(ev.stage);
      if (idx !== -1 && idx < stageOrder.length - 1) {
        ev.stage = stageOrder[idx + 1];
        ev.stageRound = 1;
      } else {
        ev.stage = finalStage;
        ev.stageRound = 9;
      }
    }
  }

  function logEruption(state, ev) {
    console.log(`[World Engine] Event erupted: ${ev.name}`);
  }

  // ========== 风声消散骰 ==========
  // API 本轮返回同 id 风声时，core.addWind 会将 quietRounds 重置为 0。
  // 未被更新的风声在下轮 API 调用前累积沉寂，并可能直接消散。
  function decayWinds(state, randomFn = Math.random) {
    const survivors = [];
    const decayed = [];

    for (const wind of state.winds || []) {
      const params = windDecayParams(wind.type);
      const level = Math.min(4, Math.max(1, parseInt(wind.level) || 1));
      wind.quietRounds = Math.max(0, parseInt(wind.quietRounds) || 0) + 1;

      if (wind.quietRounds <= params.grace) {
        survivors.push(wind);
        continue;
      }

      const n = wind.quietRounds - params.grace - 1;
      const chance = Math.min(95, Math.max(5,
        params.base + params.linear * n + params.quadratic * n * n - (level - 1) * 10
      ));
      const dice = Math.floor(randomFn() * 100) + 1;

      if (dice <= chance) decayed.push(wind);
      else survivors.push(wind);
    }

    state.winds = survivors;
    if (decayed.length) {
      console.log(`[World Engine] 🌫️ News faded: ${decayed.map(w => w.topic).join(', ')}`);
    }
    return decayed;
  }

  const OUTPUT_INSTRUCTIONS = `
## JSON output field reference

You must output one JSON object. Output only fields with real changes this round; never make up meaningless content to fill space.

### Output length limits
The limits below count words. Keep the writing concise; do not get around the limits with heavy punctuation or run-on lists.
- events.desc: at most 35 words.
- factions.currentGoal: at most 35 words.
- winds.content: at most 35 words.
- influenceChain.impact: at most 35 words.
- influenceChain.fallout: at most 35 words.
- worldTrends.description: at most 70 words.

### events (array of event chains)
World Engine may create nearby pressures, arrivals and interruptions, but the story resolves their impact on the active scene. Do not turn unfinished foreground tasks into autonomous jobs. Across all output fields, stop at the external stimulus: never invent a scene participant's response, completed action, injury, departure or knowledge transfer. Independent off-screen developments remain autonomous within the elapsed story interval.
Every event update requires resolution: "world" only for development independent of unresolved foreground actions, or "story" for progress/outcomes dependent on the active scene. Reassess against the latest conversation, not the previous label. Nearby pressure can be world-owned up to contact; resolving its effect on scene participants is story-owned. Missing/invalid resolution rejects the update and its provisional dice advance.
For resolution="story", also supply storyEvidence: a verbatim quote from the latest AI story reply supporting the reported change. If no completed change is supported, return only id, name and resolution="story" to hold the existing chain unchanged. A plan or attempt is not completion; never use an unrelated quote. New foreground tasks need no event chain.
Before creating or updating events, first match existing main matters by core goal or conflict, main parties and continuous process; steps, obstacles, costs, partial results and aftermath of the same matter must keep the original id. A matter that already shows concrete signs and still has room to develop may be created with id:null; it need not be mature yet, and you need not prove in advance that it will span several rounds. Planning, probing, the start of an investigation or a conflict first appearing can all be the early stages of an event chain. If the content clearly belongs to an existing matter as a step, obstacle or direct consequence, keep the original id. A different event type is not by itself a reason to split a chain; create separate chains only when they form conflicts or undertakings that can evolve independently.
Each item contains:
- id: existing events must return their current id unchanged; new events must explicitly use null, never omit it
- name: event name. The name may change as the situation evolves, but renaming does not create a new event
- type: "conflict"/"progress". conflict = conflict event chain, progress = progress event chain. Required for new events; once set, an existing event's type must not change, and updates to the same id must keep the current type.
- level: 1-4. For conflict it means intensity / runaway potential; the higher the Lv, the easier it escalates. For progress it means scale / difficulty; the higher the Lv, the harder it is to complete.
- stage: use different stages by type:
  - conflict may only use "Brewing"/"Escalating"/"Imminent"/"Erupted"/"Dissipated".
    - Brewing: the conflict has just shown signs; only a few have noticed, and there is no public pressure yet.
    - Escalating: the conflict is spreading; organization, manpower, rumors or motives for revenge are gathering.
    - Imminent: the conflict is about to turn into concrete action or direct impact; it is close to the breaking point.
    - Erupted: the conflict has played out; pursuit, wanted notices, armed clashes, blockades, purges and the like have already happened.
    - Dissipated: the conflict has lost its motive, actors, resources, target or timing, and it is certain it will not erupt.
    - The normal order is fixed: Brewing → Escalating → Imminent → Erupted. Dissipated is not a normal stage; only the API can set it directly, based on clear causes.
  - progress may only use "Preparing"/"Underway"/"Critical"/"Completed"/"Failed".
    - Preparing: resources, manpower, materials, intelligence, routes or plans are being prepared; it has not fully started.
    - Underway: the matter has actually begun, with ongoing investment, visible activity and staged costs.
    - Critical: close to the result; most vulnerable to interference, being snatched away, reversal, delay or paying a price.
    - Completed: the result has landed and entered the world state; it may produce follow-up events, news, economic or faction changes.
    - Failed: it is certain the matter cannot be completed because the actors withdrew, resources ran out, key conditions were permanently lost, it was effectively countered or its time ran out.
    - The normal order is fixed: Preparing → Underway → Critical → Completed. Failed is not a normal stage; only the API can set it directly, based on clear causes.
- stageRound: progress within the current stage, 1-8. Writing 9 for a non-final stage makes it advance automatically on the local side; all final stages are locked locally at 9/9.
- desc: event description
- stall: true/false (true means the event is temporarily stalled or blocked but may resume later; it is only a marker and does not change type or stage; write the reason and the condition for resuming in desc)

### Stalls and final outcomes of event chains
- A stall is not a final outcome. As long as a reasonable condition for resuming exists, set stall=true and keep the current stage.
- A conflict may be set directly to "Dissipated" only when it has certainly lost any chance of erupting further.
- A progress event may be set directly to "Failed" only when it certainly cannot continue or reach its goal.
- When setting "Dissipated"/"Failed", desc must state the specific reason for the outcome; never decide a final outcome just because several rounds passed without progress.
- "Erupted"/"Dissipated"/"Completed"/"Failed" are all final; once reached they must not go back to a non-final stage. To restart, create a new event chain.

### factions (array of factions)
Only groups with a stable shared identity, shared goals, organized decision-making and the ability to act across rounds may be created as factions. Temporary crowds, one-off teams and the unorganized public must not be created, and never invent factions to fill numbers. Update only when a field really changes.
Each item contains:
- id: existing factions must return their current id unchanged; new factions must explicitly use null, never omit it
- name: faction name. A rename, change of banner or new title keeps the original id; a faction that truly splits off uses a new object
- scope: the geographic area the faction directly controls or strongly influences
- status: overall fortune — "Ascendant"/"Stable"/"Infighting"/"Beleaguered"/"Declining"/"Collapsing".
  Ascendant = money, people and power, solid as iron; Stable = running normally with no major crisis; Infighting = factional struggle inside, but the structure still holds; Beleaguered = resources exhausted or under blockade, hanging on; Declining = losing pillars, territory or core people, sliding toward collapse; Collapsing = exists in name only, awaiting the final confirmation.
- relation: the faction's attitude toward {{user}}, seven levels (with "Neutral" in the middle; only these seven values) — "Blood pact"/"Ally"/"Friendly"/"Neutral"/"Cold"/"Hostile"/"Sworn enemy".
  Blood pact = absolute trust, bound in life and death; Ally = equal standing, mutual support; Friendly = approves of {{user}}, prefers to cooperate; Neutral = neither cares nor objects; Cold = has noticed but does not plan to act; Hostile = open opposition; Sworn enemy = a fight to the death.
- currentGoal: current goal text
- core_person: name of the core person
- powerPillars: the faction's current pillars of power, at most 3, each a name of 1-3 words (e.g. "Military deterrence"/"Court connections"/"Treasury backing"). List only pillars that are stable and carry real power; pillars that have collapsed or failed must not be kept. This field only shows current pillars, not history. The API must explain pillar changes in desc or influenceChain.

### worldTrends (array of world trends)
A world trend is a long-term situation that has already changed how a nation, the international order or the whole world works. It is not ordinary news, and not an event chain waiting to erupt.
Each item contains:
- id: existing trends must return their current id unchanged; new trends must explicitly use null, never omit it
- name: trend name. A change of wording keeps the original id
- scope: actual area of effect
- status: "Ongoing"/"Ended"
- description: the current situation and how it is constraining actions in the world
- source: the clear source that formed the trend

Rules:
- Each round, check candidate sources such as an Lv4 conflict event reaching Erupted, an Lv4 progress event reaching Completed, or the facts behind Lv4 news being widely confirmed.
- Create a world trend only when the situation is long-term, wide-reaching and cross-system, and forces several factions to keep adjusting their actions. National festivals, single announcements and short-lived sensations do not count.
- World trends do not take part in the dice and do not dissipate on their own. Every ongoing trend must act as a background constraint on the evolution of event chains, factions, the economy and news each round.
- Update only when a fact clearly changes the situation; mark it Ended only when the situation has certainly ended.
- New actions, news or economic changes caused by a trend go into the matching fields; cross-system effects go into influenceChain.

### winds (array of news)
New news only needs a clear information topic that has already entered circulation through public release, being overheard or retold by others, real-world channels, spreading in a small circle or shared discussion. Spreading may be at its very start; it need not have reached a large scale, actually changed other systems or be proven in advance to last several rounds. Private information nobody else has heard, ordinary small talk, pure atmosphere and mechanical repetition that brings no new information are not created.
Before creating, first decide on "merging by information topic": news can be true reports, rumors, misinformation, exaggeration or partial understanding, but it records an information topic in circulation, not a list of facts, details, versions or follow-up headlines. If new information shares the core subject, core event or matter, core claim, meaning in circulation or social target with existing news, keep the original id and update content/level/scope/source; do not create a new one.
Additions, further spreading, more details, a wider scope, a change of tone, version drift, a change in credibility, rising emotion or spreading effects of the same topic should all be merged into the original news. Never create duplicate news just because the headline, wording, a version suffix or the stage of spreading changed. Only when the core meaning in circulation has changed and points to a different subject, judgment, interest, risk assessment or group action may new news be created.
Each item contains:
- id: existing news must return its current id unchanged; new news must explicitly use null, never omit it
- topic: news topic. The claims, focus or headline in circulation may change; as long as it is the same line of spreading, keep the original id.
- type: "announcement"/"report"/"rumor"/"sentiment", meaning an announcement, a report, a rumor or public sentiment.
- level: 1-4, the actual scale of spreading: 1 = a few people in a circle, 2 = local, 3 = a large region, 4 = national / international / the whole world.
- content: the specific claim now in circulation; update this field when the story mutates as it spreads.
- scope: the specific region or circle it has actually reached so far.
- source: the source and chain of spreading. When it involves {{user}}, write out the full chain of information.

### News linkage requirements
- Check existing winds each round, but increase level or scope only when a valid spreading node appears; never upgrade automatically.
- News may change factions, reputation, economy, enemies or events only after it has spread into the area or circle where the affected party is.
- When news causes cross-system changes, also write them into influenceChain, making clear "which news → who learned of it → what action they took or what judgment they formed".
- An announcement only proves the publisher said it publicly, not that it is true; a rumor may also happen to be true. Do not use a credibility field.
- Private letters, secret orders and other information with only specific recipients are not news; create news only after it leaks and starts spreading.
- News that has no real spillover effect may update winds only; do not force changes in other systems.
- If a news item gets no real update for several rounds in a row, the local system will judge it faded and delete it before the next evolution. If a news item is still spreading, mutating, widening its scope or still affecting the world this round, you must return an update with the same id; merely repeating it unchanged does not count as an update.
- quietRounds is a local internal field; never output or modify it.

### economy (economy object)
- climate: economic climate — the current regional economic temperature: "Booming"/"Steady"/"Recession"/"Turbulent"
- signals: array of market signals. Each item { summary: "one sentence describing the change and its effect", scope: "geographic area affected (a specific region name)" }. Record notable economic changes in the market now; a change must be big enough to affect faction actions, NPC decisions or the course of event chains. Everyday small fluctuations do not qualify. Usually no more than 3.
- A signal must be a market change that has already happened, not just a forecast; update it only when its size, scope, cause or effect on decisions really changes, and remove it when the effect is gone. A change in a single commodity usually must not change the whole region's climate.

### reputation (reputation object)
Reputation may change only when information has spread to the matching circle and is enough to change that circle's overall view of {{user}}. A single NPC's attitude, actions that have not spread and old news repeated must not change reputation; do not return reputation without new facts that justify a change of level.
Four dimensions of reputation, five levels each (low to high; only these five values): Reviled → Notorious → Unknown → Respected → Revered
- authority: the halls of power — how the established powers in charge view {{user}}. Law-abiding or lawbreaking, compliant or defiant.
- common: the streets — {{user}}'s standing among ordinary people and street opinion. Kind or brutal, protector or threat.
- shadow: the underworld — how forces outside the system (outlaws, smugglers, mercenaries, hackers, underground gangs and so on) see {{user}}. The core standard: do they have guts or not. Using private force against systemic injustice and standing up for the weak → plus; oppressing commoners, betraying their own kind and bullying the weak → minus. Plain criminal acts do not automatically earn underworld respect.
- circuit: among peers — how fellow members of {{user}}'s trade or profession rate them. Skill, whether they keep the trade's rules, and whether they contribute to the field.
- lastChange: a short note on this round's change (e.g. "no change" or "authority rating rose for helping make an arrest")

### world_digest (string)
A concise account of new background changes during the elapsed story interval, at most 150 words with no minimum. Use supplied story timestamps when available; never extend beyond the latest completed story endpoint to finish an activity. If time is unclear, keep changes proportionate to the available clues without inventing a duration. Independent off-screen activity need not already have been narrated, but must respect established facts, causal and knowledge boundaries, and the available time. Do not recap the foreground or invent departures, answers, completed tasks or decisions for participants still in the active scene. Plans and forecasts are not completed changes. When there is no material background change, return a brief nonempty stability statement instead of filling space. Old conversation is background, not a new development. Never mention {{user}}.

### enemies (array of the enemy roster)
An enemy is a character or group with an irreversible personal grudge against {{user}} caused by concrete harm. Unlike faction-level hostility (that is the job of factions.relation), the defining traits of an enemy are: it never fades, and it hunts {{user}} down.
Create one only when the full trigger condition for its type is met; anger, hostility or verbal threats alone do not make an enemy. Update an existing enemy only when its ability to act, its location, stage, members or the fact of its ending really changes.

Each item contains:
- id: existing enemies must return their current id unchanged; new enemies must explicitly use null, never omit it
- name: enemy name (a person's name or the name of an avenging group)
- reason: why the grudge exists (briefly, what {{user}} did to cause it)
- type: "blood"/"grudge". blood = blood feud (a core person was killed, or a close family member died or was maimed); grudge = a non-lethal grudge (crippled, bankrupted, robbed of something vital, or another irreversible harm)
- status: "Tracking"/"Plotting"/"Striking"/"Resolved"
  - Tracking: gathering intelligence and locating {{user}}
  - Plotting: has located {{user}} and is organizing people and resources for action
  - Striking: has sent killers or avengers; an actual attack has happened or is about to
  - Resolved: the enemy was eliminated by {{user}} or the revenge is complete. After marking, it is kept locally for 20 rounds and then cleared.

Rules:
- Trigger for type=blood: a core person was killed (excluding a former core person who already lost power; see power collapse in the faction module); a close family member died or was maimed. Such hatred cannot be negotiated, never fades and is not given up over time.
- Trigger for type=grudge: {{user}}'s actions caused irreversible major harm to a specific character (crippled in their martial skill, robbed of a life's work, ruined or exiled by a setup), and the victim has a clear motive and the means for revenge. Not everyone {{user}} offends counts as a grudge; all three conditions must be met: "irreversible harm + clear will for revenge + ability to track or retaliate".
- Whether blood or grudge, once marked "Resolved", it is kept locally as a memo for 20 more rounds and then cleared automatically.

Linking with event chains:
- When creating an enemy entry, usually also create a conflict event chain (type=conflict) whose name matches the enemy's name, and record the link between them in influenceChain.
- When an enemy entry's status changes, the stage of the matching event chain should update with it.

Exclusive with power collapse:
- If all of a core person's pillars of power have been destroyed (see power collapse in the faction module), they lose their power and their status as a core person. If {{user}} kills them then, it does not trigger type=blood and is handled only as type=grudge.

Prohibited:
- A blood feud supplies motive, not ability. Pursuit is limited by faction level; a weak faction cannot infiltrate a strong faction's territory.
- Never create an enemy entry just for reversible harm such as "insulted by {{user}}" or "lost a business competition".
- Never record faction-level hostility (factions.relation) again in the enemy roster.

### influenceChain (array of influence chains)
Records how important changes spread through the world: what triggered a change, what it directly changed, and what aftermath followed. It is not a new event chain, takes no part in dice advancement and does not show stage progress.
Create one only when the trigger has already made a real change to another system's lasting state, and this transmission is necessary to understand later states. Mere possibilities, ordinary emotions, internal steps of an event and regular event-chain progress must not be created; trends that have not happened yet but have grounds may only go into fallout.
Each item contains:
- trigger: the source. The specific event, action, world trend, news, economic change, reputation change or black-box information that caused the change
- impact: the direct effect. What world state the trigger has actually changed
- fallout: the aftermath. Secondary changes or next-step trends as the effect keeps spreading

Requirements:
- Record only changes that truly produced spillover effects; do not stuff the ordinary progress of every event chain into influenceChain.
- impact must be a direct change that has already happened; fallout must be aftermath spreading further and must not restate the trigger.
- If event chain A makes event chain B speed up, slow down, change direction, dissipate or fail, explain the transmission in influenceChain.
- If an effect depends on information spreading, it must follow the information-spreading rules; NPCs do not gain a god's-eye view because an influenceChain exists.
- When the same trigger already has a record, update that record; do not stack duplicate records endlessly.

### blackbox (information black-box object)
Only secret actions and assets that need knowledge boundaries protected across rounds, or whose future use or exposure risk must be tracked, go into the black box. Ordinary inner thoughts, ideas never acted on, public items, consumables used up at once and private matters with no later value must not go in.
- secretActions: array of secret actions, each { action: "description of the action", witnesses: "None / only XX" }
- secretAssets: array of secret assets, each { name: "asset name", exposure: 0-100, status: "Active/Stale/Exposed/Void" }
  exposure is the risk of the asset being discovered by outsiders: 0 = top secret, 100 = fully public.
  status shows whether the asset is still usable: Active = still usable, Stale = intelligence outdated, Exposed = discovered, Void = no longer usable.
`;

  const JSON_EXAMPLE = `Format example only; this is not world state or history. Empty fields illustrate JSON structure, not a requirement to suppress autonomous developments. Generate actual updates from the current world, conversation and evolution rules.
{
  "events": [],
  "factions": [],
  "worldTrends": [],
  "winds": [],
  "economy": {},
  "reputation": {},
  "world_digest": "",
  "enemies": [],
  "influenceChain": [],
  "blackbox": { "secretActions": [], "secretAssets": [] }
}`;
  // [MAP] 引擎预设：把引擎角色指令、因果检查10步提成模块级 const（内容与原函数内常量逐字一致），
  // 作为「默认预设」的单一真相源，供 world-engine-preset.js 引用（避免双份拷贝漂移）。
  // callEvolutionAPI 内不再重新定义，直接引用此处；覆写层用 Final 变量区分默认值与用户覆写。
  const DEFAULT_SEG_ENGINE_ROLE = `You are a world-simulation engine. Evolve the background within the elapsed completed-story interval; negligible or no background change is valid. Independent off-screen actors, organizations and environments may develop according to their own goals and the world rules, including during established time skips.
Across all output fields, treat the latest completed scene as the foreground boundary: do not advance its participants' locations, actions, knowledge or unresolved choices beyond what the conversation establishes. A participant becomes off-screen only when their departure or absence is established by the story; do not invent a departure to make them eligible for background evolution.
Update the world state based on the world rules and this round's conversation. Output only JSON, with no other text.`;

  // 身份协议属于本地数据完整性约束，不允许被自定义引擎预设覆盖。
  const ENTITY_ID_PROTOCOL = `[Persistent entity ID protocol (mandatory, cannot be overridden)]
- The id of events, factions, worldTrends, winds and enemies is the system identity.
- When updating an existing object, return the id from the current state unchanged, even if name/topic is renamed.
- When creating a new object, explicitly write "id": null and let the local system assign it; never omit id, and never invent, guess or reuse an id.
- Whether two objects are the same is decided only by id. An id that does not exist in the current state is invalid.`;

  const DEFAULT_SEG_CAUSAL_STEPS = `During evolution, check in this causal order:
1. [Privacy check · always first] First determine whether this round's actions by {{user}} and related characters had witnesses and whether they left traceable evidence. Every private act that happened with no witnesses and no traces (being alone, private intimacy, behind-closed-doors matters, secret talks in a sealed room, covert infiltration, killing with no one around, and so on) goes into blackbox.secretActions (witnesses marked "None" or "only XX"), and: it must not generate news, must not change reputation in any dimension, must not create or advance an event chain, and must not lead any NPC who was not present to act on it. Only after the act is witnessed, leaves traceable evidence or is actually spread afterwards may it turn into public influence.
2. Treat every ongoing world trend as a world-level constraint for this round, and check whether a new trend has formed or an existing trend has clearly ended.
3. Decide whether this round's facts, actions and public information form new news (private acts excluded; see step 1).
4. Check whether existing news gained new valid spreading nodes, and update level/scope/content/source accordingly.
5. Decide which factions, circles or actors the news actually reached; only those reached may change their judgments and actions because of it.
6. When world trends or news cause cross-system changes, put the results into the matching state fields and record the transmission in influenceChain.
7. Reputation check: change a dimension's reputation only after {{user}}'s actions have formed news that reaches that circle; private, unspread acts, or acts seen by only one person, do not change group reputation.
8. Enemy check: decide whether this round produced irreversible harm that triggers a blood feud or grudge; an existing enemy may advance its tracking only after learning of leads through news reaching its intelligence sources or other valid channels, limited by faction level, and must never locate {{user}} out of nowhere.
9. Economy check: update climate and signals only when driven by event chains or traceable outside causes; major economic changes must generate matching news, and baseless swings are not allowed.
10. Never jump from the panel's all-knowing information straight to NPC actions, and never invent spreading nodes just to create linkage.`;

  async function callEvolutionAPI(state, userMsg, aiMsg, extraInstruction = '', dialogueText = '') {
    const rulesLoader = window.WORLD_ENGINE_RULES;
    const fullRules = rulesLoader ? rulesLoader.getAllRulesText() : '[Failed to load rules]';
    // 蓝绿灯触发：扫描本扩展自己喂给推演的近期对话（解耦，不读酒馆的聊天扫描）
    const worldbookScanText = dialogueText || `${userMsg || ''}\n${aiMsg || ''}`;
    const worldbookSection = await window.WORLD_ENGINE_WORLDBOOK?.buildPromptSection?.(worldbookScanText) || '';
    let memoryEngineSection = '';
    try {
      memoryEngineSection = window.MEMORY_ENGINE?.buildWorldEngineContext?.(state) || '';
    } catch (error) {
      // 可选跨引擎上下文必须故障隔离：记忆引擎异常不能中断世界推演。
      console.error('[World Engine] Failed to read the Memory Engine context (isolated)', error);
    }
    const tonePrompt = ((api.getSettings ? api.getSettings() : {}).tonePrompt || '').trim();
    const toneSection = tonePrompt
      ? `

========== Additional prompt (user-defined · follow with priority · but never break the JSON output format above) ==========
${tonePrompt}`
      : '';

    // [MAP] 引擎预设覆写层：默认值用模块级 DEFAULT_SEG_*（单一真相源，逐字等于原模板），
    // 若当前激活预设对某段有自定义覆写则用覆写值，否则用默认值。
    // 激活「默认」预设（无任何覆写）时，4 个 Final 变量逐字等于原常量 → 拼装结果字节级等同 PR#12 现状。
    // [PERF] 一次取 4 段覆写（getOverrides 在默认预设走 0-parse 快路径、自定义预设 1 次 parse），
    // 避免每段分别查导致同一轮推演反复 JSON.parse 整个自定义预设数组。
    const _P = window.WORLD_ENGINE_PRESET;
    const _ov = (_P && typeof _P.getOverrides === 'function') ? _P.getOverrides() : null;
    const segEngineRole = (_ov && _ov['engine-role']) || DEFAULT_SEG_ENGINE_ROLE;
    const segCausalSteps = (_ov && _ov['causal-steps']) || DEFAULT_SEG_CAUSAL_STEPS;
    const segOutputInstructions = (_ov && _ov['output-format']) || OUTPUT_INSTRUCTIONS;
    const segJsonExample = (_ov && _ov['json-example']) || JSON_EXAMPLE;

    const segStateBlock = `## Current world state (round ${state.round})
${JSON.stringify({
  round: state.round,
  events: (state.events || []).map(e => ({ id: e.id, name: e.name, type: e.type || 'conflict', stage: e.stage, stageRound: e.stageRound, level: e.level, desc: e.desc, evolveResult: e.evolveResult, stall: e.stall, resolution: e.resolution || 'story' })),
  factions: (state.factions || []).map(f => ({ id: f.id, name: f.name, scope: f.scope, status: f.status, relation: f.relation, currentGoal: f.currentGoal, core_person: f.core_person, powerPillars: f.powerPillars })),
  worldTrends: state.worldTrends || [],
  winds: (state.winds || []).map(({ quietRounds, ...wind }) => wind),
  reputation: state.reputation,
  economy: state.economy,
  enemies: state.enemies || [],
  influenceChain: state.influenceChain || [],
  blackbox: state.blackbox || { secretActions: [], secretAssets: [] }
}, null, 2)}`;

    const segDialogue = `## Recent conversation
${dialogueText ? dialogueText : `User: ${userMsg || ''}
AI: ${aiMsg || ''}`}`;

    const segExtraInstruction = extraInstruction ? extraInstruction : '';
    // toneSection 已含前导 \n\n；segments 存原始 toneSection，与实际发出一致
    const segToneSection = toneSection;

    // [MAP] 实际发出的完整 prompt：与原模板逐字相同的拼接顺序与分隔，零语义漂移。
    // 4 段用上方的 seg*（覆写层 Final 变量）：无覆写时逐字等于原常量。
    const prompt = segEngineRole + '\n\n' + ENTITY_ID_PROTOCOL + '\n\n' + segCausalSteps
      + '\n\n========== World evolution rules ==========\n' + fullRules
      + '\n\n' + worldbookSection
      + (memoryEngineSection ? '\n\n' + memoryEngineSection : '')
      + '\n\n' + segStateBlock
      + '\n\n' + segDialogue
      + '\n\n' + segOutputInstructions
      + '\n' + segJsonExample
      + '\n' + (extraInstruction ? '\n' + extraInstruction : '') + toneSection;

    // [MAP] 分段镜像（全透明展示用，只读）。各段 content 与上方 prompt 引用同一变量。
    // worldbookSection / toneSection / extraInstruction 为空时 content 为空字符串，展示侧标注「本轮未启用」。
    _lastPromptSegments = [
      { key: 'engine-role',    label: '① Engine role instructions',            content: segEngineRole },
      { key: 'entity-ids',     label: '② Persistent entity ID protocol',         content: ENTITY_ID_PROTOCOL },
      { key: 'causal-steps',   label: '③ Causal check (10 steps)',        content: segCausalSteps },
      { key: 'rules',          label: '④ World evolution rules',            content: fullRules },
      { key: 'worldbook',      label: '⑤ World Info injection',              content: worldbookSection },
      { key: 'memory-engine',  label: '⑤b Memory Engine character/entity injection',   content: memoryEngineSection },
      { key: 'state',          label: '⑥ Current world state (JSON)',     content: segStateBlock },
      { key: 'dialogue',       label: '⑦ Recent conversation',                content: segDialogue },
      { key: 'output-format',  label: '⑧ JSON output field reference',       content: segOutputInstructions },
      { key: 'json-example',   label: '⑨ JSON example',               content: segJsonExample },
      { key: 'extra-instr',    label: '⑩ Extra instructions',                content: segExtraInstruction },
      { key: 'tone',           label: '⑪ Additional prompt (user-defined)', content: segToneSection }
    ];

    _lastPrompt = prompt;
    _lastRawResult = '';
    const knownFields = [
      'events', 'factions', 'worldTrends', 'winds', 'economy', 'reputation',
      'world_digest', 'enemies', 'influenceChain', 'regionalIncident', 'blackbox'
    ];
    const retrySettings = api.getSettings ? api.getSettings() : {};
    const maxRetries = Math.max(0, parseInt(retrySettings.apiAutoRetries) || 0);
    let update = null;

    for (let attempt = 0; attempt <= maxRetries; attempt++) {
      try {
        const rawResult = await api.callApi(prompt, undefined, undefined, _abortController.signal);
        _lastRawResult = rawResult;
        update = api.parseJSON(rawResult);
        if (!update || typeof update !== 'object' || Array.isArray(update)) {
          throw new Error('The API response could not be parsed as valid JSON; the current state from before the reroll was kept');
        }
        if (!knownFields.some(field => Object.prototype.hasOwnProperty.call(update, field))) {
          throw new Error('The API response contains no world-state fields; the current state from before the reroll was kept');
        }
        break;
      } catch (error) {
        if (_abortController && _abortController.signal.aborted) throw error;
        if (attempt >= maxRetries) {
          if (maxRetries > 0 && error && error.message) error.message += ` (auto-retried ${maxRetries} times)`;
          throw error;
        }
        console.warn(`[World Engine] API fault, auto-retry ${attempt + 1}/${maxRetries}:`, error && error.message ? error.message : error);
        if (window.__WE_SetExternalStatus) window.__WE_SetExternalStatus(`API fault, auto-retry ${attempt + 1}/${maxRetries}`);
      }
    }
    console.log('[World Engine] API JSON parsed, world digest:', update.world_digest || '[not returned]');

    update.events = Array.isArray(update.events) ? update.events : [];
    update.factions = Array.isArray(update.factions) ? update.factions : [];
    update.worldTrends = Array.isArray(update.worldTrends) ? update.worldTrends : [];
    update.winds = Array.isArray(update.winds) ? update.winds : [];
    update.economy = update.economy || {};
    if (!update.economy.signals) update.economy.signals = [];
    update.reputation = update.reputation || {};
    update.world_digest = update.world_digest || state.worldDigest;
    update.enemies = Array.isArray(update.enemies) ? update.enemies : [];
    update.influenceChain = Array.isArray(update.influenceChain) ? update.influenceChain : [];
    // regionalIncident 由本地骰子控制，不在 callEvolutionAPI 中自动补全
    // API 返回的 regionalIncident 在 mergeRegionalIncident 中验证
    if (!update.blackbox) update.blackbox = { secretActions: [], secretAssets: [] };
    core.normalizeVocab(update);

    return update;
  }

  let _abortController = null;
  let _isRunning = false;
  let _backfillRunning = false;
  let _backfillAborted = false;
  let _lastError = '';

  async function evolve(state, userMsg, aiMsg, opts) {
    if (_isRunning) {
      console.warn('[World Engine] ⚠️ An evolution is already running; skipping the duplicate request');
      _lastError = 'An evolution is already running';
      return false;
    }
    _lastError = '';

    delete state._terminalEventsThisRound;
    const hadStoredState = core.hasState();
    const backup = JSON.parse(JSON.stringify(state));
    // 基底由调用方显式指定（手动双按钮）：
    //   'forward' = 向前推演，从当前状态推、推完存档点前移（等同新轮次）；
    //   'redo'    = 重新推演，从存档点恢复再推、轮次不变；
    //   不传      = 自动推演，沿用 isNewRound() 判断。
    const mode = opts && opts.mode;
    const isNew = mode === 'forward' ? true
                : mode === 'redo'    ? false
                : core.isNewRound();
    // [FIX] 基底选择三分，解耦「重 roll」与「redo」：
    //   isForward  = mode==='forward' 或自动新轮次（isNew=true） —— 接着当前往前推、round++、存档点前移、刷新指纹。
    //   isRedo     = mode==='redo'（手动卫星「重新推进」）        —— 从存档点恢复基底重推、轮次=存档点轮次、不动存档点/指纹。
    //   自动重 roll = 否则（mode=undefined 且 !isNew）              —— 对同一楼正文重新生成触发的重推，**不从存档点恢复**，
    //                 直接在当前 state 上推、轮次保持当前轮、不动存档点/指纹。
    //   旧代码把「自动重 roll」也走 else 的 Object.assign(state,cp)，把 state 整份恢复成存档点（上一轮）再推→轮次回退成
    //   存档点轮次（症状B：第6轮重 roll 推演后停在5）。现纠正：只有 isRedo 才回存档点；自动重 roll 在当前 state 推
    //   （PR#27 修法2 注释 line768 明说的「基于当前状态推的正道」，旧实现与注释不符，此处对齐）。
    const isForward = isNew;

    if (isForward) {
      console.log('[World Engine] 📌 New round forward');
    } else if (mode === 'redo') {
      // redo（手动「重新推进」）：从存档点 a 恢复基底重推，轮次=存档点轮次
      const cp = core.restoreCheckpoint();
      if (cp) {
        Object.assign(state, cp);
        state.memories = cp.memories || [];
        state.events = cp.events || [];
        state.factions = cp.factions || [];
        state.worldTrends = cp.worldTrends || [];
        state.winds = cp.winds || [];
        state.enemies = cp.enemies || [];
        state.influenceChain = cp.influenceChain || [];
        console.log('[World Engine] 🔄 Redo: restoring from the checkpoint and evolving again');
      } else {
        // [FIX 守卫] redo 必须有存档点作为基底。无存档点时（首次推演后、或仅做过 redo 从未 forward 过）拒绝执行，
        //   避免无声退化成「在当前 state 上推」+ round++ 的伪 redo。自动重 roll 不在本守卫范围（见下分支）。
        _lastError = 'No checkpoint, so redo is not possible; use "Advance" for at least one round before using "Redo"';
        console.warn('[World Engine] ⚠️ Redo has no checkpoint; refused (not falling back to a fake forward)');
        return false;
      }
    } else {
      // 自动重 roll（mode=undefined 且非新轮次）：对同一楼正文重新生成触发的重推。
      //   不从存档点恢复基底（存档点是「这层正文产生前」的状态，留作注入用，推演基底用当前 state）；
      //   轮次保持当前轮（forward 已 round++ 到当前轮，这里不动）；不动存档点/指纹。
      //   无存档点时（首层场景）也不报错——直接在当前 state 上推，首层本就无 cp。
      console.log('[World Engine] 🔄 Re-evolving the current round (automatic reroll, round unchanged)');
    }

    _isRunning = true;
    _abortController = new AbortController();

    try {
      // 第1步：本地骰子推进事件链（全部在 b 上操作）
      const eventsBeforeDice = JSON.parse(JSON.stringify(state.events || []));
      forceTriggerEvents(state);
      const rolledEvents = state.events;
      // Dice are proposals until this round confirms independent world ownership.
      state.events = eventsBeforeDice;

      // 第2步：风声沉寂累积与消散判定
      decayWinds(state);

      // 第3步：区域突发事件骰子
      const regionalIncidentRoll = rollRegionalIncident(state);

      // 第4步：账本驱动的远方随机事件骰子（pending 时跳过骰子并持续重试）
      const distantEventRoll = rollDistantEvent(state);

      // 第5步：当前剧情驱动的近端随机事件骰子
      const nearEventRoll = rollNearEvent(state);

      // 第6步：喂给 API 做叙事更新
      const extraInstructions = [regionalIncidentRoll.injectPrompt, distantEventRoll.injectPrompt, nearEventRoll.injectPrompt].filter(Boolean).join('\n\n');
      const update = await callEvolutionAPI({ ...state, events: rolledEvents }, userMsg, aiMsg, extraInstructions, (opts && opts.dialogueText) || '');

      // 随机对象先识别并清洗临时标记，再进入既有实体 ID 分配与合并流程。
      acceptDistantEventResult(state, update);
      acceptNearEventResult(state, update);

      // 第7步：合并 API 返回
      for (const ev of update.events) {
        const existingIndex = core.findEntityIndex(state.events, ev, core.ENTITY_ID_PREFIXES.events, 'name');
        const existing = existingIndex !== -1 ? state.events[existingIndex] : null;
        if (ev.resolution !== 'world' && ev.resolution !== 'story') continue;
        if (ev.resolution === 'story') {
          if (existing) existing.resolution = 'story';
          const quote = typeof ev.storyEvidence === 'string' ? ev.storyEvidence.trim() : '';
          // shortcut: quotes prove provenance, not entailment; assess semantic failures in the final live trial.
          if (!quote || !(aiMsg || '').includes(quote)) continue;
        } else if (existing) {
          const rolled = rolledEvents.find(e => e.id === existing.id);
          if (rolled) Object.assign(existing, rolled);
        }
        delete ev.storyEvidence; // Evidence stays in debug output, not repeated story inputs.
        if (existing) {
          existing.resolution = ev.resolution;
          // API 的未知/错误 ID 不得污染本地身份；兼容同名认领时也强制继承本地 ID。
          ev.id = existing.id;
          // 事件类型一旦确定不可由 API 改动
          ev.type = existing.type || 'conflict';

          const stageOrder = EVENT_STAGE_ORDER[existing.type] || EVENT_STAGE_ORDER.conflict;
          const finalStage = EVENT_FINAL_STAGE[existing.type] || EVENT_FINAL_STAGE.conflict;
          const terminalStages = EVENT_TERMINAL_STAGES[existing.type] || EVENT_TERMINAL_STAGES.conflict;

          // 终局事件保护：只允许 API 改 desc
          if (terminalStages.includes(existing.stage)) {
            if (ev.desc !== undefined) existing.desc = ev.desc;
            core.ensureEventFields(existing);
            continue;
          }

          // API 改了 stageRound？以 API 为准，但 >=9 时自动晋级
          if (ev.stageRound !== undefined && ev.stageRound !== existing.stageRound) {
            existing.stageRound = ev.stageRound;
            existing.consecutiveFails = 0;
            // stageRound >= 9 触发晋级
            if (existing.stageRound >= 9) {
              const idx = stageOrder.indexOf(existing.stage);
              if (idx !== -1 && idx < stageOrder.length - 1) {
                existing.stage = stageOrder[idx + 1];
                existing.stageRound = existing.stageRound - 9;
              } else {
                existing.stage = finalStage;
                existing.stageRound = 9;
              }
            }
          }
          // 合并其他字段
          if (ev.stage !== undefined) existing.stage = ev.stage;
          if (ev.desc !== undefined) existing.desc = ev.desc;
          if (ev.level !== undefined) existing.level = ev.level;
          if (ev.name !== undefined) existing.name = ev.name;
          if (ev.stall !== undefined) existing.stall = ev.stall;
          existing.type = ev.type;
          core.ensureEventFields(existing);
        } else {
          if (!ev.type || !EVENT_TYPES.includes(ev.type)) ev.type = 'conflict';
          core.addEvent(state, ev);
        }
      }
      for (const fac of update.factions) core.addFaction(state, fac);
      for (const trend of update.worldTrends) core.addWorldTrend(state, trend);
      for (const wind of update.winds) core.addWind(state, wind);
      if (Object.keys(update.economy).length) Object.assign(state.economy, update.economy);
      if (Object.keys(update.reputation).length) Object.assign(state.reputation, update.reputation);
      if (update.world_digest) state.worldDigest = update.world_digest;

      // 仇敌录
      if (update.enemies.length) {
        for (const en of update.enemies) {
          if (!en.name || !en.reason) continue;
          if (!en.type || !['blood', 'grudge'].includes(en.type)) en.type = 'blood';
          if (!en.status|| !['Tracking','Plotting','Striking','Resolved'].includes(en.status)) en.status = 'Tracking';
          core.addEnemy(state, en);
        }
        // 已终结的仇敌保留20轮后清理
        state.enemies = (state.enemies || []).filter(en => {
          if (en.status === 'Resolved') {
            en._terminalSince = en._terminalSince || state.round;
            return (state.round - en._terminalSince) < intSetting('localEnemyTerminalKeepRounds', 20, 1);
          }
          return true;
        });
        if (state.enemies.length > capSetting('localCapEnemies', 8)) state.enemies.length = capSetting('localCapEnemies', 8);
      }

      // 影响链
      if (update.influenceChain.length) {
        const completedRound = state.round + 1;
        for (const influence of update.influenceChain) {
          if (!influence.trigger || !influence.impact) continue;
          influence.fallout = influence.fallout || '';
          const idx = (state.influenceChain || []).findIndex(existing => existing.trigger === influence.trigger);
          if (idx !== -1) {
            influence._createdRound = state.influenceChain[idx]._createdRound ?? completedRound;
            state.influenceChain[idx] = influence;
          } else {
            influence._createdRound = completedRound;
            state.influenceChain.unshift(influence);
          }
        }
        if (state.influenceChain.length > capSetting('localCapInfluence', 12)) state.influenceChain.length = capSetting('localCapInfluence', 12);
      }

      // Influence entries expire after the configured number of rounds; updates to the same trigger do not renew them.
      const completedRound = state.round + 1;
      const influenceKeepRounds = intSetting('localInfluenceKeepRounds', 8, 1);
      const cleanedInfluence = (state.influenceChain || []).filter(influence => {
        if (!influence || typeof influence !== 'object') return false;
        if (influence._createdRound === undefined) influence._createdRound = state.round;
        return (completedRound - influence._createdRound) < influenceKeepRounds;
      });
      if (cleanedInfluence.length !== (state.influenceChain || []).length) {
        console.log('[World Engine] auto-removed influence entries:', (state.influenceChain || [])
          .filter(influence => !cleanedInfluence.includes(influence))
          .map(influence => influence.trigger)
          .join(', '));
      }
      state.influenceChain = cleanedInfluence;

      // economy signals 上限
      if (state.economy && state.economy.signals && state.economy.signals.length > capSetting('localCapEconomySignals', 8)) {
        state.economy.signals.length = capSetting('localCapEconomySignals', 8);
      }

      // 区域突发事件合并
      mergeRegionalIncident(state, update);

      if (update.blackbox) {
        state.blackbox = update.blackbox;
        const totalBlackbox = (state.blackbox.secretActions?.length || 0) + (state.blackbox.secretAssets?.length || 0);
        const blackboxCap = capSetting('localCapBlackbox', 12);
        if (totalBlackbox > blackboxCap) {
          const excess = totalBlackbox - blackboxCap;
          const actions = state.blackbox.secretActions || [];
          const assets = state.blackbox.secretAssets || [];
          if (actions.length > excess) {
            state.blackbox.secretActions.length = Math.max(1, actions.length - excess);
          } else {
            state.blackbox.secretActions = [];
            state.blackbox.secretAssets.length = Math.max(1, assets.length - excess + actions.length);
          }
        }
      }

      // 自动清理：已消散/已失败的事件链 & 已结束的天下大势
      // - 负面终局（已消散/已失败）：下一轮即删
      // - 正面终局（已爆发/已完成）：进入终局起保留 2+level*2 轮（Lv1=4/Lv2=6/Lv3=8/Lv4=10），
      //   留出余波铺陈时间，到期自动清退
      const POSITIVE_TERMINALS = ['Erupted', 'Completed'];
      const cleanedEvents = (state.events || []).filter(e => {
        if (e.stage === 'Dissipated' || e.stage === 'Failed') return false;
        if (POSITIVE_TERMINALS.includes(e.stage)) {
          if (e._terminalSince === undefined) e._terminalSince = state.round;
          const keepRounds = positiveTerminalKeepRounds(e);
          return (state.round - e._terminalSince) < keepRounds;
        }
        // 非终局：清掉可能残留的倒计时标记（被 API 改回非终局阶段时）
        if (e._terminalSince !== undefined) delete e._terminalSince;
        return true;
      });
      if (cleanedEvents.length !== (state.events || []).length) {
        const removed = (state.events || []).filter(e => !cleanedEvents.includes(e));
        state._terminalEventsThisRound = removed.map(e => JSON.parse(JSON.stringify(e)));
        console.log('[World Engine] 🧹 Auto-removed event chains:', removed.map(e => e.name).join(', '));
      }
      state.events = cleanedEvents;

      const cleanedTrends = (state.worldTrends || []).filter(t => t.status !== 'Ended');
      if (cleanedTrends.length !== (state.worldTrends || []).length) {
        const removed = (state.worldTrends || []).filter(t => !cleanedTrends.includes(t));
        console.log('[World Engine] 🧹 Auto-removed world trends:', removed.map(t => t.name).join(', '));
      }
      state.worldTrends = cleanedTrends;

      state.lastEvolveResult = update;

      // [FIX] 轮次块三分，对齐基底选择三分（见上方 isForward/isRedo/自动重roll）：
      //   isForward        → round++ + 存档点前移(saveCheckpoint(backup)) + 刷新指纹(saveFingerprint)。
      //   isRedo           → 轮次不变(=存档点轮次)；不存 checkpoint、不更新 fingerprint（redo 基底就是存档点，不动它）。
      //   自动重 roll       → 轮次不变(=当前轮)；不存 checkpoint、不更新 fingerprint。
      //     关键：自动重 roll **不 saveCheckpoint** —— 存档点保持 forward 时存的「上一轮」状态，
      //     这是注入侧后续能取「这层正文产生前的世界状态」=存档点的前提。若在此前移存档点，
      //     重 roll 后注入将拿到「重 roll 推演前」的状态而非「这层正文产生前」的，语义错位。
      //   旧代码无差别在 isNew=false 时打印「重roll/redo 轮次不变」，但上方基底选择已把自动重 roll
      //   错误 Object.assign(cp) 回存档点（症状B），现基底已纠正为不回存档点，此处轮次保持当前轮。
      if (isForward) {
        // 首次推演不创建空白存档点；后续旧当前状态成为存档点并保留原层数。
        state.round++;                             // 只在 forward 涨轮次
        if (hadStoredState) core.saveCheckpoint(backup);
        core.saveFingerprint(core.getChatFingerprint());
        console.log('[World Engine] ✅ Evolution complete, new round', state.round, ', checkpoint advanced');
      } else {
        const label = (mode === 'redo') ? 'redo' : 'automatic reroll';
        console.log('[World Engine] ✅ Evolution complete (' + label + '), round unchanged:', state.round, '.');
      }
      core.saveStateWithLayer(state);
      return true;

    } catch(e) {
      if (e.name === 'AbortError') {
        console.log('[World Engine] 🛑 Evolution aborted');
        _lastError = 'Aborted';
      } else {
        console.error('[World Engine] Evolution failed', e);
        _lastError = e && e.message ? e.message : 'Unknown error';
      }
      // 若本轮刚骰中远方事件，API 异常也要保留 pending 与固定样本；下一轮不得重新掷骰。
      const pendingDistant = state.distantEvent && state.distantEvent.pending
        ? JSON.parse(JSON.stringify(state.distantEvent))
        : null;
      const pendingNear = state.nearEvent && state.nearEvent.pending
        ? JSON.parse(JSON.stringify(state.nearEvent))
        : null;
      // 恢复前状态；恢复语句本身可能抛错（如 IDB 在内存压力下写失败），吞掉以免跳过 finally 复位
      try {
        Object.assign(state, backup);
        if (pendingDistant) state.distantEvent = pendingDistant;
        if (pendingNear) state.nearEvent = pendingNear;
        core.saveState(state);
      } catch (_) {}
      return false;
    } finally {
      // 无论成功/失败/恢复语句抛错，都复位并发控制标志；否则后续 evolve 会被 isRunning() 守卫永久跳过
      // （即升级后内存压力下偶发"推演再也不工作了"的症状）
      _abortController = null;
      _isRunning = false;
    }
  }

  function abort() {
    if (_backfillRunning) {
      _backfillAborted = true;
      console.log('[World Engine] 🛑 Received a request to abort the batch backfill');
    }
    if (_abortController) {
      _abortController.abort();
      console.log('[World Engine] 🛑 Abort signal sent');
    }
  }

  function isRunning() {
    return _isRunning || _backfillRunning;
  }

  // ========== 批量「重填世界推演」 ==========
  // 从第 1 个 AI 楼层开始，分批把世界状态重新推演到指定楼层（清空重来）。
  // 每批仅喂本批 N 个 AI 楼层（及夹在中间的 user 楼层）的对话，但 state 逐批累积——
  // 第 k 批在第 k-1 批的推演结果之上继续，保证世界连贯；token 每批恒定可控。
  // opts: { batchSize, retries, endLayer, onProgress }
  //   onProgress({ phase, batch, totalBatches, layerFrom, layerTo, attempt, ok, round })
  // 返回 { done, totalBatches, completedBatches, failedAt }
  async function backfillEvolve(opts) {
    opts = opts || {};
    if (_isRunning || _backfillRunning) {
      console.warn('[World Engine] ⚠️ An evolution or backfill is already running; skipping the batch backfill');
      return { done: false, reason: 'busy' };
    }

    const settings = api && api.getSettings ? api.getSettings(true) : {};
    const batchSize = Math.max(1, parseInt(opts.batchSize ?? settings.backfillBatchSize) || 1);
    const retries = Math.max(0, parseInt(opts.retries ?? settings.backfillRetries) || 0);
    const onProgress = typeof opts.onProgress === 'function' ? opts.onProgress : () => {};

    // 1) 收集所有有效 AI 楼层在 chat 中的下标（与自动推演判据一致：非 user、mes 非空）
    let chat = [];
    let startChatId = 'default';
    try {
      const ctx = SillyTavern.getContext();
      chat = (ctx && ctx.chat) || [];
      if (ctx && ctx.chatId) startChatId = ctx.chatId;
    } catch (e) { chat = []; }
    const aiIdx = [];
    const ignoreFirstLayer = settings.firstLayerIsAiOpening !== false;
    for (let i = 0; i < chat.length; i++) {
      const m = chat[i];
      if (m && !m.is_user && String(m.mes || '').trim() && !(ignoreFirstLayer && i === 0)) aiIdx.push(i);
    }
    if (!aiIdx.length) {
      return { done: false, reason: 'no-ai-layers', totalBatches: 0 };
    }

    // 2) 结束楼层夹紧（0 或缺省 = 推到最后一个 AI 楼层）
    let endLayer = parseInt(opts.endLayer ?? settings.backfillEndLayer) || 0;
    if (!Number.isFinite(endLayer) || endLayer <= 0 || endLayer > aiIdx.length) endLayer = aiIdx.length;

    // 3) 切批：前 endLayer 个 AI 楼层按 batchSize 分组，最后一批吸收余数（不产生空批）
    const batches = [];
    for (let p = 0; p < endLayer; p += batchSize) {
      const pEnd = Math.min(p + batchSize, endLayer) - 1; // 含
      // 余数并入上一批：若剩余不足一批且已有批，则把它并进最后一批
      batches.push({ pStart: p, pEnd });
    }
    // 合并末尾零头到上一批（如 30/7 → 7/7/7/9 而非 7/7/7/7/2）
    if (batches.length >= 2) {
      const last = batches[batches.length - 1];
      const lastCount = last.pEnd - last.pStart + 1;
      if (lastCount < batchSize) {
        batches[batches.length - 2].pEnd = last.pEnd;
        batches.pop();
      }
    }
    const totalBatches = batches.length;

    // 4) 清空重来：丢弃当前世界状态与存档点，让第 1 批从空白世界起推
    core.clearState();
    core.clearCheckpoint();

    _backfillRunning = true;
    _backfillAborted = false;
    let completedBatches = 0;

    try {
      for (let b = 0; b < totalBatches; b++) {
        if (_backfillAborted) {
          console.log('[World Engine] 🛑 Batch backfill aborted, stopped at batch', b, '/', totalBatches, '.');
          return { done: false, reason: 'aborted', totalBatches, completedBatches, failedAt: b + 1 };
        }
        // 切聊天守卫：回填进行中用户切到别的聊天 → 立即中止，绝不往 B 写。
        // 否则开头 clearState() 已清空 A，而后续读写用动态 chatId 落到 B，会污染 B 并丢 A 存档。
        if (core.getChatId() !== startChatId) {
          console.warn('[World Engine] 🛑 Chat switch detected; aborting the batch backfill (start', startChatId, '→ now', core.getChatId(), ')');
          return { done: false, reason: 'chat-changed', totalBatches, completedBatches, failedAt: b + 1 };
        }
        const { pStart, pEnd } = batches[b];
        const lastChatIdx = aiIdx[pEnd];
        const startChatIdx = pStart === 0 ? (ignoreFirstLayer ? 1 : 0) : aiIdx[pStart - 1] + 1;
        const aiMsg = String(chat[lastChatIdx].mes || '').trim();

        // 构造本批对话文本（与 performEvolution 一致：含夹在中间的 user 楼层）
        const dialogueText = chat.slice(startChatIdx, lastChatIdx + 1)
          .map(m => (m.is_user ? 'User' : 'AI') + ': ' + core.filterDialogue(String(m.mes || '').trim(), settings))
          .filter(line => /:\s*\S/.test(line))
          .join('\n');

        onProgress({ phase: 'batch-start', batch: b + 1, totalBatches,
          layerFrom: pStart + 1, layerTo: pEnd + 1, attempt: 0 });

        // 每批重读 state（evolve 已落盘），与单轮路径一致
        let ok = false;
        let lastAttempt = 0;
        for (let attempt = 0; attempt <= retries; attempt++) {
          lastAttempt = attempt;
          if (_backfillAborted) break;
          if (core.getChatId() !== startChatId) {
            console.warn('[World Engine] 🛑 Chat switch detected; aborting the batch backfill (start', startChatId, '→ now', core.getChatId(), ')');
            return { done: false, reason: 'chat-changed', totalBatches, completedBatches, failedAt: b + 1 };
          }
          const state = core.loadState();
          ok = await evolve(state, '', aiMsg, { mode: 'forward', dialogueText });
          if (ok || _backfillAborted) break;
          if (attempt < retries) {
            console.warn(`[World Engine] ⚠️ Batch ${b + 1}/${totalBatches} API fault, retry ${attempt + 1}/${retries}`);
            onProgress({ phase: 'retry', batch: b + 1, totalBatches,
              layerFrom: pStart + 1, layerTo: pEnd + 1, attempt: attempt + 1 });
          }
        }

        if (!ok) {
          if (_backfillAborted) {
            return { done: false, reason: 'aborted', totalBatches, completedBatches, failedAt: b + 1 };
          }
          console.error(`[World Engine] ❌ Batch ${b + 1}/${totalBatches} API fault, retries used up; aborting the backfill`);
          onProgress({ phase: 'batch-failed', batch: b + 1, totalBatches,
            layerFrom: pStart + 1, layerTo: pEnd + 1, attempt: lastAttempt });
          return { done: false, reason: 'evolve-failed', totalBatches, completedBatches, failedAt: b + 1 };
        }

        completedBatches++;
        const cur = core.loadState();
        if (window.WORLD_ENGINE_LEDGER) {
          try { window.WORLD_ENGINE_LEDGER.recordChanges(cur); } catch (e) {}
        }
        onProgress({ phase: 'batch-done', batch: b + 1, totalBatches,
          layerFrom: pStart + 1, layerTo: pEnd + 1, attempt: lastAttempt, ok: true, round: cur.round });
      }

      onProgress({ phase: 'all-done', totalBatches, completedBatches });
      return { done: true, totalBatches, completedBatches };
    } catch (e) {
      console.error('[World Engine] Batch backfill error', e);
      return { done: false, reason: 'exception', error: String(e && e.message || e), totalBatches, completedBatches };
    } finally {
      _backfillRunning = false;
      _backfillAborted = false;
    }
  }

  function getLastError() {
    return _lastError;
  }

  window.WORLD_ENGINE_DEBUG = {
    evolve,
    backfillEvolve,
    callEvolutionAPI,
    forceTriggerEvents,
    decayWinds,
    state: () => core.loadState()
  };

  // [MAP] 引擎预设：暴露 4 段默认文本给 world-engine-preset.js 作「默认预设」单一真相源。
  // 只读引用，避免 preset 模块双份拷贝导致默认值漂移。
  window.WORLD_ENGINE_EVOLUTION_DEFAULT_SEGS = {
    'engine-role':   DEFAULT_SEG_ENGINE_ROLE,
    'causal-steps':  DEFAULT_SEG_CAUSAL_STEPS,
    'output-format': OUTPUT_INSTRUCTIONS,
    'json-example':  JSON_EXAMPLE
  };

  return { evolve, backfillEvolve, getLastDebug, abort, isRunning, getLastError };
})();
