// world-engine-inject.js — 构建注入上下文（条件筛选，只注入影响RP的关键信息）
window.WORLD_ENGINE_INJECT = (function() {
  const core = window.WORLD_ENGINE_CORE;
  const ledger = window.WORLD_ENGINE_LEDGER;

  // 声誉判词：把等级翻译成给正文模型看的人话，避免注入光秃秃的等级标签
  const REP_DIM_NAME = { authority: 'official and power circles', common: 'public and popular circles', shadow: 'informal and underground circles', circuit: 'trade and professional circles' };
  const REP_VERDICT = {
    authority: { // 朝堂之上 —— 守法/顺从 ↔ 挑衅/危险
      'Reviled': 'this circle widely sees them as a serious threat and may actively move to restrict them or hold them to account',
      'Notorious': 'this circle\'s view is clearly negative; it stays wary of them and tends to limit cooperation',
      'Unknown': 'this circle knows little about them and has not formed a clear view',
      'Respected': 'this circle\'s view is broadly positive; it is willing to extend some trust and chances to cooperate',
      'Revered': 'this circle highly recognizes their ability and influence and is willing to back their actions first',
    },
    common: { // 市井之间 —— 仁善/保护 ↔ 暴戾/威胁
      'Reviled': 'public opinion is extremely negative; people widely avoid, resist or openly oppose their actions',
      'Notorious': 'public opinion is clearly negative; people lack trust in them and tend to keep their distance',
      'Unknown': 'the public knows little about them and has not formed a broad opinion',
      'Respected': 'public opinion is broadly positive; people have some trust in their actions and promises',
      'Revered': 'public opinion is highly positive, with broad approval and strong rallying power',
    },
    shadow: { // 草莽之中 —— 有种/敢扛 ↔ 没种/欺弱
      'Reviled': 'this circle widely sees them as a serious threat and may actively shut them out or target their actions',
      'Notorious': 'this circle\'s view is clearly negative; it is unwilling to cooperate and stays on guard against them',
      'Unknown': 'this circle knows little about them and has not formed a clear view',
      'Respected': 'this circle\'s view is broadly positive; it is willing to offer limited cooperation or information',
      'Revered': 'this circle highly recognizes their ability and stance and can coordinate and mobilize strongly for them',
    },
    circuit: { // 同道之间 —— 技艺/守规/贡献 ↔ 砸招牌/背叛
      'Reviled': 'this circle\'s view is extremely negative; it may cancel cooperation, exclude them or publicly hold them to account',
      'Notorious': 'this circle\'s view is clearly negative; it doubts their professional ability or reliability',
      'Unknown': 'this circle knows little about them and has not formed a professional view',
      'Respected': 'this circle recognizes their professional ability and conduct and is willing to work with them',
      'Revered': 'this circle highly recognizes their professional ability and contributions and treats them as an important reference',
    },
  };
  // 旧存档兼容：六级时期的"小有名气"归入"受人尊敬"
  const REP_LEGACY = { 'Somewhat known': 'Respected' };
  const REP_LEVEL_NAME = {
    'Reviled': 'extremely negative',
    'Notorious': 'clearly negative',
    'Unknown': 'unknown',
    'Respected': 'positive',
    'Revered': 'highly recognized',
  };

  // 势力运势判词：把运势词翻译成「这势力眼下什么处境、内部团不团结」
  const STATUS_VERDICT = {
    'Ascendant': 'ample resources and stable personnel, smooth organizational coordination, and a strong ability to keep acting',
    'Stable': 'resources and organizational structure remain stable, and it can carry on with its business as planned',
    'Infighting': 'the basic structure is still there, but there are clear internal divisions, and decision-making and execution have slowed',
    'Beleaguered': 'resources are tight or it faces outside restrictions; it is keeping basic operations going and has little capacity for extra risk',
    'Declining': 'it keeps losing key resources, reach or core members, and its organizational stability has clearly dropped',
    'Collapsing': 'its actual operation and coordination are very weak, and its structure is close to falling apart',
  };

  // 势力关系判词：把关系词翻译成「这势力对{{user}}的行为倾向」
  const RELATION_VERDICT = {
    'Blood pact': 'it has a highly trusting long-term partnership with {{user}}, gives them priority support, and values their safety and shared goals',
    'Ally': 'it cooperates steadily with {{user}}, actively helps and shares information on common interests, but keeps its own boundaries',
    'Friendly': 'it approves of {{user}}, is willing to cooperate first and offer limited favors, but has no stable partnership yet',
    'Neutral': 'it has no clear leaning toward {{user}} and decides its actions by its own goals and interests',
    'Cold': 'it has noticed {{user}} but has little wish to cooperate, tends to keep its distance, and has no active plans for now',
    'Hostile': 'it openly opposes {{user}} and may apply pressure, obstruct them or confront them directly',
    'Sworn enemy': 'it is in a lasting, intense hostility with {{user}} and may keep taking high-intensity action against them',
  };
  const RELATION_NAME = {
    'Blood pact': 'high mutual trust',
    'Ally': 'stable cooperation',
    'Friendly': 'inclined to cooperate',
    'Neutral': 'no clear stance',
    'Cold': 'keeping distance',
    'Hostile': 'open opposition',
    'Sworn enemy': 'intense hostility',
  };

  // 经济气候判词：把单个气候词翻译成给正文模型看的市面描述
  const CLIMATE_VERDICT = {
    'Booming': 'the market is lively, goods flow smoothly, and supply, demand and employment stay high',
    'Steady': 'the market runs normally, with only routine swings in prices, supply and demand',
    'Recession': 'market activity is shrinking, demand and business are contracting, and some essentials are getting scarce',
    'Turbulent': 'market order is unstable, prices and supply swing sharply, and normal trade is disrupted',
  };

  function buildContext(worldState, tags) {
    const rulesLoader = window.WORLD_ENGINE_RULES;
    const rulesSummary = rulesLoader ? rulesLoader.getCoreRulesSummary() : '';
    let injectAllLevels = false;
    try {
      const api = window.WORLD_ENGINE_API;
      const settings = api && api.getSettings ? api.getSettings() : {};
      injectAllLevels = settings.injectAllLevels === true;
    } catch (e) {}

    // 事件链：开启全等级时全部注入；否则 Lv3/4 全注入，Lv1/2 仅已爆发/已完成终局注入
    const visibleEvents = (worldState.events || []).filter(e => {
      if (injectAllLevels) return true;
      if ((e.level || 0) >= 3) return true;
      return e.stage === 'Erupted' || e.stage === 'Completed';
    });
    const eventsText = visibleEvents.map(e => {
      const typeName = e.type === 'progress' ? 'progress event' : 'conflict event';
      let txt = `${e.name} (${typeName}, level ${e.level}) ${e.stage} ${e.stageRound||1}/9`;
      if (e.evolveResult) txt += ` [${e.evolveResult}]`;
      return txt;
    }).join('; ') || 'None';

    // 势力：全部7级关系都注入，渲染成自然语句，运势/关系各带判词
    const formatPillars = (arr) => arr.length === 1
      ? arr[0]
      : arr.slice(0, -1).join(', ') + ' and ' + arr[arr.length - 1];
    const allFactions = worldState.factions || [];
    const factionsText = allFactions.length
      ? '\n' + allFactions.map(f => {
          const statusDesc = STATUS_VERDICT[f.status] || (f.status ? `its current status is "${f.status}"` : 'its current status is unclear');
          const relation = f.relation || 'Neutral';
          const relationName = RELATION_NAME[relation] || relation;
          const relationDesc = RELATION_VERDICT[relation] || `its attitude toward {{user}} is "${relation}"`;
          let s = `- ${f.name}: ${statusDesc}; its relationship with {{user}} is ${relationName} — ${relationDesc}. `;
          if (f.scope) s += `Its area of activity or influence is ${f.scope}. `;
          if (f.currentGoal) s += `Its current goal is ${f.currentGoal}. `;
          const tail = [];
          if (f.core_person) tail.push(`Core person: ${f.core_person}`);
          if (f.powerPillars?.length) tail.push(`Key resources or power: ${formatPillars(f.powerPillars)}`);
          if (tail.length) s += tail.join(', ') + '. ';
          return s;
        }).join('\n')
      : 'None';

    // 风声：开启全等级时全部注入；否则只注入 Lv3/4
    const windTypeNames = { announcement: 'Announcement', report: 'Report', rumor: 'Rumor', sentiment: 'Sentiment' };
    const visibleWinds = (worldState.winds || []).filter(w => injectAllLevels || (w.level || 0) >= 3);
    const windsText = visibleWinds.map(w =>
      `[${windTypeNames[w.type] || 'Information'} level ${w.level || 1} ${w.scope || '?'}] ${w.content}`
    ).join('; ') || 'None';

    // 天下大势
    const trendsText = (worldState.worldTrends || []).filter(t => t.status !== 'Ended').map(t =>
      `${t.name} (${t.scope || 'global'}): ${t.description}`
    ).join('; ') || 'None';

    // 声誉：注入人话判词，而非光秃秃的等级标签
    const rep = worldState.reputation || {};
    const repText = ['authority', 'common', 'shadow', 'circuit'].map(k => {
      const lv = REP_LEGACY[rep[k]] || rep[k];
      const verdict = REP_VERDICT[k] && REP_VERDICT[k][lv];
      if (!verdict) return '';
      return `${REP_DIM_NAME[k]}: standing is ${REP_LEVEL_NAME[lv] || lv}; ${verdict}`;
    }).filter(Boolean).join('. ') + '. ';
    const repChange = rep.lastChange ? ` (${rep.lastChange})` : '';

    // 经济信号：全注入
    const econ = worldState.economy || {};
    const signalsText = (econ.signals || []).map(s => `${s.summary} (${s.scope})`).join('; ');
    const climate = econ.climate || 'Steady';
    const climateText = `The market is ${climate}: ${CLIMATE_VERDICT[climate] || CLIMATE_VERDICT['Steady']}`;
    const econText = `${climateText}${signalsText ? '. Market signals: ' + signalsText : ''}`;

    // 仇敌录
    let enemiesText = 'None';
    if (worldState.enemies && worldState.enemies.length) {
      enemiesText = worldState.enemies.map(e =>
        `${e.name} (${e.type==='blood'?'serious opposition':'ordinary opposition'}, ${e.status}, reason: ${e.reason})`
      ).join('; ');
    }

    // 区域突发事件
    const ri = worldState.regionalIncident || {};
    let riText = '';
    if (ri.active) {
      riText = `⚠️ ${ri.title || 'Regional incident'} (${ri.type || '?'}, ${ri.scope || '?'}) — ${ri.impact || ''}`;
    } else {
      riText = ri.title && ri.title.includes('retry') ? `⚠️ ${ri.title}` : 'No new regional incidents this round';
    }

    // 信息黑盒：展示具体内容
    const blackbox = worldState.blackbox || {};
    const boxParts = [];
    if (blackbox.secretActions?.length) {
      const actionsText = blackbox.secretActions.map(a =>
        `[Action] ${a.action || '?'} (witnesses: ${a.witnesses || 'None'})`
      ).join('; ');
      boxParts.push(`Unpublicized actions (${blackbox.secretActions.length}): ${actionsText}`);
    }
    if (blackbox.secretAssets?.length) {
      const assetsText = blackbox.secretAssets.map(a =>
        `[Asset] ${a.name || '?'} (exposure: ${a.exposure || 0}%, ${a.status || 'Active'})`
      ).join('; ');
      boxParts.push(`Unpublicized resources (${blackbox.secretAssets.length}): ${assetsText}`);
    }
    const blackboxText = boxParts.length ? boxParts.join(' | ') : 'No unpublicized information';

    const context = `
[World state]
Nearby developments supply external pressure; resolve their impact through the active story. Do not treat them as proof of an unplayed response, completed action, injury, departure or knowledge transfer by scene participants.
Update round: ${worldState.round}
Digest: ${worldState.worldDigest}
Global trends: ${trendsText}
Events in progress: ${eventsText}
Organizations and relations: ${factionsText}
Public information and opinion: ${windsText}
Opposition: ${enemiesText}
Social standing: ${repText}${repChange}
Economy: ${econText}
Regional developments: ${riText}
Unpublicized information: ${blackboxText}

${rulesSummary}
    `.trim();

    let maxChars = 18000;
    try {
      const api = window.WORLD_ENGINE_API;
      const settings = api && api.getSettings ? api.getSettings() : {};
      const configured = Number(settings.injectMaxChars);
      if (Number.isFinite(configured)) maxChars = Math.max(0, Math.floor(configured));
    } catch (e) {}
    return maxChars > 0 ? context.substring(0, maxChars) : context;
  }

  return { buildContext };
})();
