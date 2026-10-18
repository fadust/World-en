const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const storage = new Map();
let sent, scan, fail = false;
const sandbox = {
  console, AbortController,
  WORLD_ENGINE_STORE: { getItem: k => storage.get(k) ?? null, setItem: (k,v) => storage.set(k,v), removeItem: k => storage.delete(k) },
  WORLD_ENGINE_API: {
    getSettings: () => ({localNearEventChancePercent:100, localRegionalIncidentChancePercent:0, localDistantEventChancePercent:0}),
    callApi: async p => {
      sent = p;
      if (fail) throw Error('offline test failure');
      return JSON.stringify({ world_digest:'A distant ferry crew repairs its mooring.',
        events:[{id:null,name:'LEGACY_TERMINAL',resolution:'world',type:'progress',stage:'Underway'}],
        factions:[{id:null,name:'Distant ferry guild',relation:'Hostile'}],
        reputation:{authority:'Reviled'}, enemies:[{name:'Invented pursuer',reason:'scene retaliation'}] });
    },
    parseJSON: JSON.parse,
  },
  WORLD_ENGINE_WORLDBOOK: { buildPromptSection: async s => { scan=s; return ''; } },
  MEMORY_ENGINE: { buildWorldEngineContext: () => { throw Error('Foreground memory link must not be called'); } },
};
sandbox.window = sandbox;
for(const file of ['world-engine-core.js','world-engine-evolution.js','world-engine-inject.js']) {
  vm.runInNewContext(fs.readFileSync(path.join(__dirname,'..',file),'utf8'),sandbox,{filename:file});
}
const core=sandbox.WORLD_ENGINE_CORE, engine=sandbox.WORLD_ENGINE_EVOLUTION, inject=sandbox.WORLD_ENGINE_INJECT;
async function run(state) {
  return engine.evolve(state,'PRIVATE_USER_ACTION','<bbs_start>414/4/12 10:26</bbs_start>PRIVATE_SCENE_SUMMONS< bbs><bbs_end>414/4/12 10:27</bbs_end>',{mode:'forward',dialogueText:'PRIVATE_OLDER_DIALOGUE'});
}
(async()=>{
  const state=core.getDefaultState();
  state.worldDigest='LEGACY_NEARBY_SUMMONS';
  state.nearEvent={pending:true,requestedType:'event',cooldown:0,requestedRound:1};
  state.events=[{id:'event_1',name:'LEGACY_TERMINAL',type:'progress',stage:'Completed',stageRound:9}];
  assert.equal(inject.buildContext(state),'','Legacy state is quarantined before any evolution');
  fail=true;
  assert.equal(await run(state),false);
  assert.equal(state.worldDigest,'LEGACY_NEARBY_SUMMONS');
  assert.equal(state.events[0].name,'LEGACY_TERMINAL');
  assert.equal(state.events[0].stage,'Completed');
  assert.equal(state.nearEvent.pending,true);
  assert.equal(state.offscreenOnly,undefined,'Failure cannot mark legacy data safe');
  assert.equal(state.nearbyArchive,undefined);
  const original=JSON.stringify(state);
  fail=false;
  assert.equal(await run(state),true,engine.getLastError());
  assert.equal(state.offscreenOnly,true);
  assert.equal(JSON.stringify(state.nearbyArchive),original,'Legacy world is preserved verbatim');
  for(const text of ['PRIVATE_USER_ACTION','PRIVATE_SCENE_SUMMONS','PRIVATE_OLDER_DIALOGUE','LEGACY_NEARBY_SUMMONS','LEGACY_TERMINAL']) {
    assert.ok(!sent.includes(text),`Prompt leaked ${text}`);
    assert.ok(!scan.includes(text),`Lorebook scan leaked ${text}`);
    assert.ok(!inject.buildContext(state).includes(text),`Injection leaked ${text}`);
  }
  assert.match(sent,/414\/4\/12 10:26/);
  assert.match(sent,/414\/4\/12 10:27/);
  assert.equal(engine.getLastDebug().segments.find(s=>s.key==='extra-instr').content,'','Even pending/100% nearby jobs cannot generate');
  assert.equal(state.reputation.authority,'Unknown');
  assert.equal(state.events.length,0,'Archived terminal chain cannot be reopened');
  assert.equal(state.enemies.length,0);
  assert.equal(state.factions[0].relation,'Neutral');
  assert.match(inject.buildContext(state),/distant ferry crew/,'Background development remains visible');
  assert.match(inject.buildContext(state),/Off-screen background only/);
  console.log('PASS: scene inputs/legacy state quarantined, nearby jobs disconnected, social impact blocked, background retained, failure rollback safe.');
})().catch(e=>{console.error(e);process.exitCode=1;});
