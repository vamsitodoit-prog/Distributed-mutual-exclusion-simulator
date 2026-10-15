// Safety, liveness and message-complexity tests for every algorithm.
// Run with: npm test   (Node 18+, no dependencies)
const test = require('node:test');
const assert = require('node:assert/strict');
const E = require('../public/engine.js');

// Deterministic PRNG so failures are reproducible.
function mulberry32(seed) {
  return function () {
    seed |= 0; seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function run(algo, N, rate, steps = 20000, seed = 42) {
  E.setRng(mulberry32(seed));
  E.newSim(algo, N);
  let maxWait = 0;
  for (let k = 0; k < steps; k++) {
    E.autoRequests(0.1, rate);
    E.advanceTo(E.getState().t + 0.1);
    for (const n of E.getState().nodes)
      if (n.state === 'wanting') maxWait = Math.max(maxWait, E.getState().t - n.reqT);
  }
  const st = E.getState().stats;
  return { ...st, perEntry: st.msgs / st.entries, maxWait };
}

const ALGOS = Object.keys(E.ALGOS);

for (const algo of ALGOS) {
  test(`${algo}: mutual exclusion is never violated`, () => {
    for (let N = 3; N <= 8; N++)
      for (const rate of [0.02, 0.1, 0.5]) {
        const r = run(algo, N, rate, 8000, N * 7 + Math.round(rate * 100));
        assert.equal(r.violations, 0, `N=${N} rate=${rate}`);
        assert.ok(r.maxConc <= 1);
      }
  });

  test(`${algo}: every request is eventually served (no starvation)`, () => {
    for (let N = 3; N <= 8; N++) {
      const r = run(algo, N, 0.5, 8000, 100 + N);
      assert.ok(r.entries > 20, `N=${N} only ${r.entries} entries`);
      assert.ok(r.maxWait < 400, `N=${N} max wait ${r.maxWait}`);
    }
  });
}

test('message complexity matches theory under saturation (N=5)', () => {
  const N = 5;
  const near = (x, y, tol) => assert.ok(Math.abs(x - y) <= tol, `${x.toFixed(2)} vs ${y}`);
  near(run('lamport', N, 0.5).perEntry, 3 * (N - 1), 0.2);
  near(run('ricart', N, 0.5).perEntry, 2 * (N - 1), 0.2);
  near(run('suzuki', N, 0.5).perEntry, N, 0.3);
  assert.ok(run('central', N, 0.5).perEntry <= 3);
  near(run('ring', N, 0.5).perEntry, 1, 0.2);
});

test('manual request: an idle process enters and leaves', () => {
  E.setRng(mulberry32(1));
  E.newSim('ricart', 4);
  assert.equal(E.requestCS(2), true);
  assert.equal(E.requestCS(2), false, 'second request while waiting is ignored');
  E.advanceTo(50);
  assert.equal(E.getState().stats.entries, 1);
  assert.equal(E.getState().nodes[2].state, 'idle');
});
