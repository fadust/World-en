// Production evolution/merge regression; no provider or browser calls.
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const storage = new Map();
let response;
let prompt;
const sandbox = {
  console, AbortController,
  WORLD_ENGINE_STORE: {
    getItem: key => storage.get(key) ?? null,
    setItem: (key, value) => storage.set(key, value),
    removeItem: key => storage.delete(key),
  },
  WORLD_ENGINE_API: {
    getSettings: () => ({ localRegionalIncidentChancePercent: 0, localNearEventChancePercent: 0, localDistantEventChancePercent: 0 }),
    callApi: async text => { prompt = text; return JSON.stringify(response); },
    parseJSON: JSON.parse,
  },
};
sandbox.window = sandbox;
for (const file of ['world-engine-core.js', 'world-engine-evolution.js', 'world-engine-inject.js']) {
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, '..', file), 'utf8'), sandbox, { filename: file });
}
const core = sandbox.WORLD_ENGINE_CORE;
const engine = sandbox.WORLD_ENGINE_EVOLUTION;
function fixture(resolution = 'world') {
  const state = core.getDefaultState();
  core.addEvent(state, { id: null, name: 'A patrol approaches', type: 'progress', stage: 'Critical', stageRound: 8,
    consecutiveFails: 99, level: 1, desc: 'The patrol approaches the riverbank.', resolution });
  return state;
}
async function run(state, events, story = 'The patrol calls out. Kai has not answered.') {
  response = { events, world_digest: 'Rain continues upriver.' };
  assert.equal(await engine.evolve(state, '', story, { mode: 'forward' }), true, engine.getLastError());
  return state.events[0];
}
(async () => {
  let state = fixture();
  let event = await run(state, [{ id: state.events[0].id, resolution: 'story', stage: 'Completed', desc: 'Kai answers and leaves.' }]);
  assert.equal(event.stage, 'Critical', 'Scene handoff discards even a terminal dice proposal');
  assert.equal(event.stageRound, 8);
  assert.equal(event.desc, 'The patrol approaches the riverbank.', 'Unsupported prose is rejected with progress');
  assert.equal(event.resolution, 'story');
  assert.equal(event.consecutiveFails, 99);

  const id = event.id;
  event = await run(state, [{ id, resolution: 'story', storyEvidence: 'Kai answers.', stage: 'Completed', desc: 'Kai answers.' }]);
  assert.equal(event.stage, 'Critical', 'Nonmatching quote cannot authorize a scene outcome');
  event = await run(state, [{ id, resolution: 'story', storyEvidence: 'Kai answers the patrol.', stage: 'Completed', desc: 'Kai answers the patrol.' }], 'Kai answers the patrol.');
  assert.equal(event.stage, 'Completed', 'Actual story completion can be recorded');
  assert.equal(event.storyEvidence, undefined, 'Evidence is not duplicated in persistent state');
  event = await run(state, [{ id, resolution: 'world', stage: 'Underway' }]);
  assert.equal(event.stage, 'Completed', 'Existing terminal protection survives');

  state = fixture();
  event = await run(state, []);
  assert.equal(event.stage, 'Critical', 'Omitted event does not commit provisional dice');
  event = await run(state, [{ id: event.id, stage: 'Completed', desc: 'Unclassified completion' }]);
  assert.equal(event.stage, 'Critical', 'Missing ownership fails closed');
  event = await run(state, [{ id: event.id, resolution: 'world', desc: 'The patrol completes its independent route away from the scene.' }]);
  assert.equal(event.stage, 'Completed', 'Independent background progression still commits');

  state = fixture();
  delete state.events[0].resolution;
  event = await run(state, [{ id: state.events[0].id, resolution: 'world' }]);
  assert.equal(event.stage, 'Critical', 'Legacy chain is classified before it becomes eligible for dice');
  event = await run(state, [{ id: event.id, resolution: 'world' }]);
  assert.equal(event.stage, 'Completed');

  state = core.getDefaultState();
  await run(state, [{ id: null, name: 'Invented treatment', resolution: 'story', stage: 'Completed' }]);
  assert.equal(state.events.length, 0);
  await run(state, [{ id: null, name: 'Patrol arrival', type: 'progress', resolution: 'world', stage: 'Underway', desc: 'A patrol approaches and calls out; the response is unresolved.' }]);
  assert.equal(state.events.length, 1, 'Nearby external pressure remains allowed');
  assert.match(prompt, /story resolves their impact/);
  assert.match(prompt, /resolution/);
  assert.match(sandbox.WORLD_ENGINE_INJECT.buildContext(state), /resolve their impact through the active story/);
  console.log('PASS: ownership gates dice and merge; nearby pressure, grounded story updates and terminal protection retained.');
})().catch(error => { console.error(error); process.exitCode = 1; });
