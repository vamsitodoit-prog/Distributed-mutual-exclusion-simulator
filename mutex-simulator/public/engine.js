/* Distributed mutual exclusion engine: discrete-event simulation of
 * Centralized, Lamport, Ricart–Agrawala, Token Ring and Suzuki–Kasami.
 * Works in the browser (globals) and in Node (module.exports) for tests. */
const CFG = { latMean: 3, cs: 4, hold: 0.6 };
let S = null;
let rng = Math.random;
const P = i => 'P' + i;
const fmt = x => (Math.round(x * 10) / 10).toFixed(1);
const lessPair = (a, b) => a[0] < b[0] || (a[0] === b[0] && a[1] < b[1]);

function log(kind, type, text) {
  S.log.push({ seq: ++S.logSeq, t: S.t, kind, type, text });
  if (S.log.length > 400) S.log.splice(0, S.log.length - 400);
}
function tick(n) { return ++n.clock; }
function send(from, to, type, payload, ts, note) {
  let at = S.t + CFG.latMean * (0.5 + rng());
  const key = from + '>' + to;            // FIFO per channel
  if (S.chan[key] != null && at <= S.chan[key]) at = S.chan[key] + 0.05;
  S.chan[key] = at;
  S.msgs.push({ id: ++S.seq, from, to, type, payload, ts, sendT: S.t, at });
  S.stats.msgs++;
  S.stats.byType[type] = (S.stats.byType[type] || 0) + 1;
  log('msg', type, `${P(from)} → ${P(to)} ${type}${note ? ' ' + note : ''}`);
}
function broadcast(n, type, payload, note) {
  const ts = tick(n);
  for (const m of S.nodes) if (m.id !== n.id) send(n.id, m.id, type, payload, ts, note ?? `⟨${ts},${n.id}⟩`);
  return ts;
}
function timer(at, fn) { const t = { id: ++S.seq, at, fn }; S.timers.push(t); return t; }
function cancel(t) { const i = S.timers.indexOf(t); if (i >= 0) S.timers.splice(i, 1); }

function nextEvent() {
  let best = null;
  for (const e of S.msgs) if (!best || e.at < best.at || (e.at === best.at && e.id < best.id)) best = e;
  for (const e of S.timers) if (!best || e.at < best.at || (e.at === best.at && e.id < best.id)) best = e;
  return best;
}
function processEvent(e) {
  S.t = Math.max(S.t, e.at);
  if (e.fn) { cancel(e); e.fn(); }
  else {
    S.msgs.splice(S.msgs.indexOf(e), 1);
    const n = S.nodes[e.to];
    n.clock = Math.max(n.clock, e.ts || 0) + 1;
    ALGOS[S.algo].onMsg(n, e);
  }
  checkSafety();
}
function advanceTo(T) {
  for (;;) { const e = nextEvent(); if (!e || e.at > T) break; processEvent(e); }
  S.t = Math.max(S.t, T);
  pruneIntervals();
}
function stepOnce() {
  const e = nextEvent(); if (!e) return false;
  const at = e.at; processEvent(e);
  for (let n = nextEvent(); n && n.at === at; n = nextEvent()) processEvent(n);
  pruneIntervals();
  return true;
}
function requestCS(i) {
  const n = S.nodes[i];
  if (!n || n.state !== 'idle') return false;
  n.state = 'wanting'; n.reqT = S.t;
  n.wait = { node: i, kind: 'wait', start: S.t, end: null }; S.intervals.push(n.wait);
  log('want', null, `${P(i)} requests the critical section`);
  ALGOS[S.algo].request(n);
  checkSafety();
  return true;
}
function enter(n) {
  n.state = 'held';
  if (n.wait) { n.wait.end = S.t; n.wait = null; }
  n.cs = { node: n.id, kind: 'cs', start: S.t, end: null }; S.intervals.push(n.cs);
  S.stats.entries++; S.stats.waitSum += S.t - n.reqT; S.stats.waitN++;
  log('enter', null, `${P(n.id)} enters the critical section after waiting ${fmt(S.t - n.reqT)}`);
  timer(S.t + CFG.cs, () => exitCS(n));
}
function exitCS(n) {
  n.state = 'idle';
  if (n.cs) { n.cs.end = S.t; n.cs = null; }
  log('exit', null, `${P(n.id)} leaves the critical section`);
  ALGOS[S.algo].release(n);
}
function checkSafety() {
  const c = S.nodes.filter(n => n.state === 'held').length;
  if (c > S.stats.maxConc) S.stats.maxConc = c;
  if (c > 1) { S.stats.violations++; log('alert', null, `Safety violated: ${c} processes in the critical section`); }
}
function pruneIntervals() {
  const lim = S.t - 240;
  if (S.intervals.length > 60 && S.intervals[0].end != null && S.intervals[0].end < lim)
    S.intervals = S.intervals.filter(iv => iv.end == null || iv.end >= lim);
}
function autoRequests(dt, rate) {
  if (!rate) return;
  for (const n of S.nodes) if (n.state === 'idle' && rng() < rate * dt) requestCS(n.id);
}

const ALGOS = {
  central: {
    name: 'Centralized coordinator', short: 'Centralized', topo: 'star',
    who: 'Classic baseline', theory: N => 3, theoryText: () => '3', delay: '2T',
    detailHead: 'Coordinator',
    rules: [
      'A process sends REQUEST to the coordinator, P0.',
      'If the critical section is free, the coordinator replies with GRANT. Otherwise it appends the request to a FIFO queue.',
      'On exit the process sends RELEASE, and the coordinator grants the next queued process.',
    ],
    note: 'Cheapest in messages, but P0 is a single point of failure and a throughput bottleneck. Requests from P0 itself are handled locally with no messages.',
    init() { S.c = { holder: null, queue: [] }; },
    grant(j) {
      if (S.c.holder === null) {
        S.c.holder = j;
        if (j === 0) enter(S.nodes[0]); else send(0, j, 'GRANT', null, tick(S.nodes[0]));
      } else S.c.queue.push(j);
    },
    freed() { S.c.holder = null; if (S.c.queue.length) this.grant(S.c.queue.shift()); },
    request(n) { if (n.id === 0) this.grant(0); else send(n.id, 0, 'REQUEST', null, tick(n)); },
    onMsg(n, m) {
      if (m.type === 'REQUEST') this.grant(m.from);
      else if (m.type === 'GRANT') enter(n);
      else if (m.type === 'RELEASE') this.freed();
    },
    release(n) { if (n.id === 0) this.freed(); else send(n.id, 0, 'RELEASE', null, tick(n)); },
    detail(n) {
      if (n.id !== 0) return '';
      const h = S.c.holder === null ? 'free' : 'held by ' + P(S.c.holder);
      return `${h} · queue [${S.c.queue.map(P).join(' ')}]`;
    },
    badge(n) { return n.id === 0 ? 'C' : null; },
  },

  lamport: {
    name: "Lamport's algorithm", short: 'Lamport', topo: 'mesh',
    who: 'Leslie Lamport, 1978', theory: N => 3 * (N - 1), theoryText: N => `3(N−1) = ${3 * (N - 1)}`, delay: 'T',
    detailHead: 'Request queue',
    rules: [
      'To request, timestamp the request, add it to your own queue, and send REQUEST to every other process.',
      'On REQUEST, add it to your queue and return a timestamped REPLY.',
      'Enter when your request heads your queue and you have received a message with a larger timestamp from every other process.',
      'On exit, remove your request and broadcast RELEASE. Receivers drop that request from their queues.',
    ],
    note: 'Correctness depends on FIFO channels; this simulator delivers every channel in order. Ties between equal timestamps break on process id.',
    init() { for (const n of S.nodes) { n.q = []; n.last = Array(S.N).fill(-1); n.reqTs = null; } },
    ins(n, e) { n.q.push(e); n.q.sort((a, b) => lessPair(a, b) ? -1 : 1); },
    request(n) { n.reqTs = broadcast(n, 'REQUEST'); this.ins(n, [n.reqTs, n.id]); this.tryEnter(n); },
    onMsg(n, m) {
      n.last[m.from] = Math.max(n.last[m.from], m.ts);
      if (m.type === 'REQUEST') { this.ins(n, [m.ts, m.from]); send(n.id, m.from, 'REPLY', null, tick(n)); }
      else if (m.type === 'RELEASE') n.q = n.q.filter(e => e[1] !== m.from);
      this.tryEnter(n);
    },
    tryEnter(n) {
      if (n.state !== 'wanting' || !n.q.length || n.q[0][1] !== n.id) return;
      for (let j = 0; j < S.N; j++) if (j !== n.id && !lessPair([n.reqTs, n.id], [n.last[j], j])) return;
      enter(n);
    },
    release(n) { n.q = n.q.filter(e => e[1] !== n.id); n.reqTs = null; broadcast(n, 'RELEASE', null, ''); },
    detail(n) { return n.q.length ? n.q.map(e => `⟨${e[0]},${e[1]}⟩`).join(' ') : '—'; },
    badge() { return null; },
  },

  ricart: {
    name: 'Ricart–Agrawala', short: 'Ricart–Agrawala', topo: 'mesh',
    who: 'Glenn Ricart & Ashok Agrawala, 1981', theory: N => 2 * (N - 1), theoryText: N => `2(N−1) = ${2 * (N - 1)}`, delay: 'T',
    detailHead: 'Request · deferred',
    rules: [
      'To request, broadcast a timestamped REQUEST ⟨ts, id⟩.',
      'On REQUEST, reply at once unless you are in the critical section or your own pending request has the smaller ⟨ts, id⟩. In those cases, defer the reply.',
      'Enter after collecting N−1 REPLY messages.',
      'On exit, send every deferred REPLY.',
    ],
    note: "An optimisation of Lamport's algorithm: the deferred reply doubles as the release, which saves N−1 messages per entry and drops the FIFO requirement.",
    init() { for (const n of S.nodes) { n.reqTs = null; n.replies = 0; n.deferred = []; } },
    request(n) { n.replies = 0; n.reqTs = broadcast(n, 'REQUEST'); },
    onMsg(n, m) {
      if (m.type === 'REQUEST') {
        const mine = n.state === 'held' || (n.state === 'wanting' && lessPair([n.reqTs, n.id], [m.ts, m.from]));
        if (mine) { n.deferred.push(m.from); log('defer', null, `${P(n.id)} defers its reply to ${P(m.from)}`); }
        else send(n.id, m.from, 'REPLY', null, tick(n));
      } else if (m.type === 'REPLY' && n.state === 'wanting') {
        if (++n.replies === S.N - 1) enter(n);
      }
    },
    release(n) {
      const d = n.deferred; n.deferred = []; n.reqTs = null;
      for (const j of d) send(n.id, j, 'REPLY', null, tick(n));
    },
    detail(n) {
      const r = n.state === 'wanting' ? `⟨${n.reqTs},${n.id}⟩ ${n.replies}/${S.N - 1}` : '—';
      return n.deferred.length ? `${r} · defer ${n.deferred.map(P).join(' ')}` : r;
    },
    badge() { return null; },
  },

  ring: {
    name: 'Token ring', short: 'Token ring', topo: 'ring',
    who: 'Logical ring, after Le Lann, 1977', theory: N => null, theoryText: () => '1 to ∞', delay: '0 to (N−1)T',
    detailHead: 'Token',
    rules: [
      'A single TOKEN travels P0 → P1 → … → P(N−1) → P0.',
      'A process may enter only while it holds the token.',
      'A process that does not want the critical section forwards the token after a short hold. One that does enters, then forwards the token on exit.',
    ],
    note: 'Fair and starvation-free by construction, but the token keeps moving with no demand, so idle traffic counts against messages per entry. Raise the load to see the cost per entry fall.',
    init() { for (const n of S.nodes) { n.hasToken = false; n.passT = null; } this.got(S.nodes[0]); },
    got(n) {
      n.hasToken = true;
      if (n.state === 'wanting') enter(n);
      else n.passT = timer(S.t + CFG.hold, () => { n.passT = null; this.pass(n); });
    },
    pass(n) { n.hasToken = false; send(n.id, (n.id + 1) % S.N, 'TOKEN', null, tick(n)); },
    request(n) { if (n.hasToken && n.passT) { cancel(n.passT); n.passT = null; enter(n); } },
    onMsg(n, m) { if (m.type === 'TOKEN') this.got(n); },
    release(n) { this.pass(n); },
    detail(n) { return n.hasToken ? 'holding token' : ''; },
    badge(n) { return n.hasToken ? 'token' : null; },
  },

  suzuki: {
    name: 'Suzuki–Kasami', short: 'Suzuki–Kasami', topo: 'mesh',
    who: 'Ichiro Suzuki & Tadao Kasami, 1985', theory: N => N, theoryText: N => `0 or N = ${N}`, delay: '0 or T',
    detailHead: 'RN[ ] · token',
    rules: [
      'Each process keeps RN[j], the highest request number it has seen from each process. The token carries LN[j], the number of the last request served for each process, and a queue Q.',
      'To request, increment RN[i] and broadcast REQUEST(i, RN[i]). A process already holding the token enters with no messages.',
      'An idle token holder sends the token to j when RN[j] = LN[j] + 1.',
      'On exit, set LN[i] = RN[i], append every j with RN[j] = LN[j] + 1 to Q, then send the token to the head of Q.',
    ],
    note: 'A broadcast token algorithm: entry costs N messages (N−1 requests plus the token), or zero when the requester already has the token.',
    init() {
      for (const n of S.nodes) { n.RN = Array(S.N).fill(0); n.token = null; }
      S.nodes[0].token = { LN: Array(S.N).fill(0), Q: [] };
    },
    give(n, j) {
      const tok = { LN: n.token.LN.slice(), Q: n.token.Q.slice() };
      n.token = null; send(n.id, j, 'TOKEN', tok, tick(n), `Q[${tok.Q.map(P).join(' ')}]`);
    },
    request(n) {
      n.RN[n.id]++;
      if (n.token) enter(n);
      else broadcast(n, 'REQUEST', { sn: n.RN[n.id] }, `(${n.id}, ${n.RN[n.id]})`);
    },
    onMsg(n, m) {
      if (m.type === 'REQUEST') {
        n.RN[m.from] = Math.max(n.RN[m.from], m.payload.sn);
        if (n.token && n.state === 'idle' && n.RN[m.from] === n.token.LN[m.from] + 1) this.give(n, m.from);
      } else if (m.type === 'TOKEN') { n.token = m.payload; enter(n); }
    },
    release(n) {
      const t = n.token; t.LN[n.id] = n.RN[n.id];
      for (let j = 0; j < S.N; j++) if (!t.Q.includes(j) && n.RN[j] === t.LN[j] + 1) t.Q.push(j);
      if (t.Q.length) this.give(n, t.Q.shift());
    },
    detail(n) { const s = `[${n.RN.join(',')}]`; return n.token ? `${s} · token Q[${n.token.Q.map(P).join(' ')}]` : s; },
    badge(n) { return n.token ? 'token' : null; },
  },
};

function newSim(algo, N) {
  S = { t: 0, N, algo, nodes: [], msgs: [], timers: [], seq: 0, chan: {}, log: [], logSeq: 0, intervals: [],
        stats: { msgs: 0, byType: {}, entries: 0, waitSum: 0, waitN: 0, maxConc: 0, violations: 0 } };
  for (let i = 0; i < N; i++) S.nodes.push({ id: i, state: 'idle', clock: 0, reqT: null, wait: null, cs: null });
  log('sys', null, `${ALGOS[algo].name} started with ${N} processes`);
  ALGOS[algo].init();
  return S;
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { ALGOS, CFG, newSim, requestCS, advanceTo, stepOnce, autoRequests,
    getState: () => S, setRng: f => { rng = f; } };
}

