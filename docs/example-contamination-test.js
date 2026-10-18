// Exercise the production prompt builder and merge path without a live provider.
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const storage = new Map();
let sentPrompt;
let overrides = null;
let response = { world_digest: 'A distant ferry crew repairs its mooring.' };
const sandbox = {
  console, AbortController,
  WORLD_ENGINE_STORE: {
    getItem: key => storage.get(key) ?? null,
    setItem: (key, value) => storage.set(key, value),
    removeItem: key => storage.delete(key),
  },
  WORLD_ENGINE_API: {
    getSettings: () => ({ localRegionalIncidentChancePercent: 0, localNearEventChancePercent: 0 }),
    callApi: async prompt => { sentPrompt = prompt; return JSON.stringify(response); },
    parseJSON: JSON.parse,
  },
  WORLD_ENGINE_PRESET: { getOverrides: () => overrides },
  WORLD_ENGINE_RULES: { getAllRulesText: () => 'Autonomous off-screen activity is allowed.' },
};
sandbox.window = sandbox;
for (const file of ['world-engine-core.js', 'world-engine-evolution.js']) {
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, '..', file), 'utf8'), sandbox, { filename: file });
}
const core = sandbox.WORLD_ENGINE_CORE;
const engine = sandbox.WORLD_ENGINE_EVOLUTION;
async function run(state) {
  assert.equal(await engine.evolve(state, 'Wait beside the river.', 'Only a moment passes.', { mode: 'forward' }), true, engine.getLastError());
  const debug = engine.getLastDebug();
  assert.equal(debug.prompt, sentPrompt);
  for (const segment of debug.segments) assert.ok(sentPrompt.includes(segment.content));
  return debug;
}
(async () => {
  const state = core.getDefaultState();
  const debug = await run(state);
  assert.doesNotMatch(sentPrompt, /Redblade|Bluefurnace|Drunken Sage|Lady Corwin|Skywatch/);
  assert.match(sentPrompt, /background world must advance one step on its own/);
  const example = debug.segments.find(s => s.key === 'json-example').content;
  assert.match(example, /not world state or history/);
  assert.deepEqual(JSON.parse(example.slice(example.indexOf('{'))).events, []);
  assert.equal(state.worldDigest, response.world_digest, 'Independent off-screen development still commits');

  core.addFaction(state, { id: null, name: 'Redblade Clan', status: 'Stable' });
  await run(state);
  assert.match(sentPrompt, /Redblade Clan/, 'Legitimate current state is not blacklisted');
  assert.equal(state.factions[0].name, 'Redblade Clan');

  overrides = { 'json-example': 'USER CUSTOM EXAMPLE: { "events": [] }' };
  const custom = await run(state);
  assert.equal(custom.segments.find(s => s.key === 'json-example').content, overrides['json-example']);
  assert.match(sentPrompt, /USER CUSTOM EXAMPLE/);
  console.log('PASS: default example has no story facts; autonomy, state and custom overrides preserved.');
})().catch(error => { console.error(error); process.exitCode = 1; });
