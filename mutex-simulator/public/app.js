/* UI layer: canvas network view, timeline, controls and readouts. Depends on engine.js. */
/* ---------------- UI ---------------- */
const ORDER = ['central', 'lamport', 'ricart', 'ring', 'suzuki'];
const SPEEDS = [0.25, 0.5, 0.75, 1, 1.5, 2.5, 4];
const TYPE_VAR = { REQUEST: '--m-req', REPLY: '--m-rep', GRANT: '--m-rep', RELEASE: '--m-rel', TOKEN: '--m-tok' };
const TYPE_ABBR = { REQUEST: 'REQ', REPLY: 'REP', GRANT: 'GNT', RELEASE: 'REL', TOKEN: 'TOK' };
const TYPES_FOR = { central: ['REQUEST', 'GRANT', 'RELEASE'], lamport: ['REQUEST', 'REPLY', 'RELEASE'], ricart: ['REQUEST', 'REPLY'], ring: ['TOKEN'], suzuki: ['REQUEST', 'TOKEN'] };
const $ = id => document.getElementById(id);

let algo = 'ricart', N = 5, running = true, speedIdx = 3, rate = 0.025;
let shownSeq = 0, rowEls = [];
try {
  const h = (location.hash || '').slice(1);
  if (ORDER.includes(h)) algo = h;
  const saved = localStorage.getItem('dmx-n'); if (saved && +saved >= 3 && +saved <= 8) N = +saved;
} catch (e) {}

function css(name) { return getComputedStyle(document.documentElement).getPropertyValue(name).trim(); }

function buildTabs() {
  $('tabs').innerHTML = ORDER.map(k => `<button class="tab" role="tab" data-k="${k}" aria-selected="${k === algo}">${ALGOS[k].short}</button>`).join('');
}
$('tabs').addEventListener('click', e => {
  const b = e.target.closest('.tab'); if (!b) return;
  algo = b.dataset.k; buildTabs(); reset();
  try { history.replaceState(null, '', '#' + algo); } catch (err) {}
});

function reset() {
  newSim(algo, N);
  shownSeq = 0; $('log').innerHTML = '';
  $('nVal').textContent = N;
  $('detailHead').textContent = ALGOS[algo].detailHead;
  $('tbody').innerHTML = S.nodes.map(n => `<tr>
    <td class="mono"><b>${P(n.id)}</b></td><td><span class="pill idle">idle</span></td>
    <td class="mono">0</td><td class="detail"></td>
    <td><button class="req" data-i="${n.id}">Request</button></td></tr>`).join('');
  rowEls = [...$('tbody').rows].map(r => ({ st: r.cells[1].firstChild, clk: r.cells[2], det: r.cells[3], btn: r.cells[4].firstChild }));
  $('legend').innerHTML = TYPES_FOR[algo].map(t => `<span>${t}<i style="background:var(${TYPE_VAR[t]})"></i></span>`).join('');
  renderInfo();
  if (rate > 0) for (let k = 0; k < Math.min(2, N); k++) requestCS(1 + k * 2 < N ? 1 + k * 2 : k);
}
$('tbody').addEventListener('click', e => { const b = e.target.closest('.req'); if (b) requestCS(+b.dataset.i); });

function renderInfo() {
  const A = ALGOS[algo];
  $('info').innerHTML = `
    <div class="label">${A.who}</div>
    <h2>${A.name}</h2>
    <dl>
      <dt>Messages per entry</dt><dd>${A.theoryText(N)}</dd>
      <dt>Synchronization delay</dt><dd>${A.delay}</dd>
      <dt>Topology shown</dt><dd>${{ star: 'star around coordinator P0', mesh: 'fully connected', ring: 'unidirectional logical ring' }[A.topo]}</dd>
    </dl>
    <ol>${A.rules.map(r => `<li>${r}</li>`).join('')}</ol>
    <p class="note">${A.note}</p>`;
}

/* controls */
$('btnPlay').onclick = () => { running = !running; $('btnPlay').textContent = running ? 'Pause' : 'Play'; $('btnStep').disabled = running; };
$('btnStep').onclick = () => { if (!running) stepOnce(); };
$('btnStep').disabled = true;
$('btnReset').onclick = reset;
$('btnBurst').onclick = () => { for (const n of S.nodes) requestCS(n.id); };
function setN(v) { N = Math.max(3, Math.min(8, v)); try { localStorage.setItem('dmx-n', N); } catch (e) {} reset(); }
$('nMinus').onclick = () => setN(N - 1);
$('nPlus').onclick = () => setN(N + 1);
$('speed').oninput = e => { speedIdx = +e.target.value; $('speedVal').textContent = SPEEDS[speedIdx] + '×'; };
$('lat').oninput = e => { CFG.latMean = +e.target.value; $('latVal').textContent = (+e.target.value).toFixed(1); };
$('load').addEventListener('click', e => {
  const b = e.target.closest('button'); if (!b) return;
  rate = +b.dataset.rate;
  for (const x of $('load').children) x.setAttribute('aria-pressed', x === b);
});
document.addEventListener('keydown', e => {
  if (e.target.closest('input,button')) return;
  if (e.code === 'Space') { e.preventDefault(); $('btnPlay').click(); }
  else if (e.key === 's' && !running) stepOnce();
});

/* stage */
const stage = $('stage'), sctx = stage.getContext('2d');
const gantt = $('gantt'), gctx = gantt.getContext('2d');
let SW = 0, SH = 0, GW = 0, GH = 0, nodePos = [], nodeR = 24;
function sizeCanvases() {
  const dpr = window.devicePixelRatio || 1;
  SW = stage.clientWidth; SH = Math.max(320, Math.min(SW * 0.86, 540));
  stage.style.height = SH + 'px'; stage.width = SW * dpr; stage.height = SH * dpr;
  sctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  GW = gantt.clientWidth; GH = 22 + N * 20;
  gantt.style.height = GH + 'px'; gantt.width = GW * dpr; gantt.height = GH * dpr;
  gctx.setTransform(dpr, 0, 0, dpr, 0, 0);
}
new ResizeObserver(sizeCanvases).observe(stage);

function layout() {
  const cx = SW / 2, cy = SH / 2 + 4, R = Math.min(SW, SH) / 2 - 46;
  nodeR = Math.max(17, Math.min(28, R * 0.17));
  nodePos = S.nodes.map((n, i) => {
    const a = -Math.PI / 2 + i * 2 * Math.PI / S.N;
    return { x: cx + R * Math.cos(a), y: cy + R * Math.sin(a), a };
  });
  return { cx, cy, R };
}

function roundRect(ctx, x, y, w, h, r) { ctx.beginPath(); ctx.moveTo(x + r, y); ctx.arcTo(x + w, y, x + w, y + h, r); ctx.arcTo(x + w, y + h, x, y + h, r); ctx.arcTo(x, y + h, x, y, r); ctx.arcTo(x, y, x + w, y, r); ctx.closePath(); }

function drawStage(C) {
  const ctx = sctx; ctx.clearRect(0, 0, SW, SH);
  const { cx, cy } = layout();
  const A = ALGOS[algo];
  // edges
  ctx.lineWidth = 1; ctx.strokeStyle = C.line;
  const edge = (i, j) => { ctx.beginPath(); ctx.moveTo(nodePos[i].x, nodePos[i].y); ctx.lineTo(nodePos[j].x, nodePos[j].y); ctx.stroke(); };
  if (A.topo === 'mesh') for (let i = 0; i < N; i++) for (let j = i + 1; j < N; j++) edge(i, j);
  else if (A.topo === 'star') for (let j = 1; j < N; j++) edge(0, j);
  else for (let i = 0; i < N; i++) {
    const p = nodePos[i], q = nodePos[(i + 1) % N];
    edge(i, (i + 1) % N);
    const mx = (p.x + q.x) / 2, my = (p.y + q.y) / 2, ang = Math.atan2(q.y - p.y, q.x - p.x);
    ctx.fillStyle = C.muted; ctx.beginPath();
    ctx.moveTo(mx + 6 * Math.cos(ang), my + 6 * Math.sin(ang));
    ctx.lineTo(mx + 6 * Math.cos(ang + 2.5), my + 6 * Math.sin(ang + 2.5));
    ctx.lineTo(mx + 6 * Math.cos(ang - 2.5), my + 6 * Math.sin(ang - 2.5));
    ctx.fill();
  }
  // center readout
  ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  ctx.fillStyle = C.muted; ctx.font = `500 11px ${C.mono}`;
  ctx.fillText(A.short.toUpperCase(), cx, cy - 10);
  ctx.fillStyle = C.ink; ctx.font = `500 18px ${C.mono}`;
  ctx.fillText('t = ' + fmt(S.t), cx, cy + 10);

  // messages
  ctx.font = `500 9.5px ${C.mono}`;
  for (const m of S.msgs) {
    const p = nodePos[m.from], q = nodePos[m.to];
    const dx = q.x - p.x, dy = q.y - p.y, L = Math.hypot(dx, dy) || 1, ux = dx / L, uy = dy / L;
    const off = A.topo === 'mesh' ? (m.from < m.to ? 5 : -5) : 0;
    const sx = p.x + ux * nodeR - uy * off, sy = p.y + uy * nodeR + ux * off;
    const ex = q.x - ux * nodeR - uy * off, ey = q.y - uy * nodeR + ux * off;
    const f = Math.min(1, Math.max(0, (S.t - m.sendT) / (m.at - m.sendT)));
    const x = sx + (ex - sx) * f, y = sy + (ey - sy) * f;
    const col = C[m.type];
    if (m.type === 'TOKEN') {
      ctx.fillStyle = col; ctx.beginPath(); ctx.moveTo(x, y - 9); ctx.lineTo(x + 9, y); ctx.lineTo(x, y + 9); ctx.lineTo(x - 9, y); ctx.closePath(); ctx.fill();
    } else {
      const label = TYPE_ABBR[m.type] + (m.type === 'REQUEST' && m.ts ? ' ' + m.ts : '');
      const w = ctx.measureText(label).width + 10;
      ctx.fillStyle = col; roundRect(ctx, x - w / 2, y - 8, w, 16, 8); ctx.fill();
      ctx.fillStyle = C.panel; ctx.fillText(label, x, y + 0.5);
    }
  }

  // nodes
  for (const n of S.nodes) {
    const { x, y } = nodePos[n.id];
    const col = n.state === 'held' ? C.held : n.state === 'wanting' ? C.want : C.muted;
    if (n.state === 'held') {
      ctx.fillStyle = C.held; ctx.globalAlpha = 0.18;
      ctx.beginPath(); ctx.arc(x, y, nodeR + 10, 0, 7); ctx.fill(); ctx.globalAlpha = 1;
    }
    ctx.beginPath(); ctx.arc(x, y, nodeR, 0, 7);
    ctx.fillStyle = n.state === 'held' ? C.held : C.panel; ctx.fill();
    ctx.lineWidth = n.state === 'idle' ? 1.5 : 3; ctx.strokeStyle = col;
    ctx.setLineDash(n.state === 'wanting' ? [5, 4] : []); ctx.stroke(); ctx.setLineDash([]);
    ctx.fillStyle = n.state === 'held' ? C.panel : C.ink;
    ctx.font = `700 ${Math.round(nodeR * 0.6)}px ${C.display}`;
    ctx.fillText(P(n.id), x, y - nodeR * 0.12);
    ctx.font = `500 ${Math.max(9, Math.round(nodeR * 0.36))}px ${C.mono}`;
    ctx.fillStyle = n.state === 'held' ? C.panel : C.muted;
    ctx.fillText('L' + n.clock, x, y + nodeR * 0.45);
    const badge = A.badge(n);
    if (badge) {
      const bx = x + nodeR * 0.78, by = y - nodeR * 0.78;
      if (badge === 'token') {
        ctx.fillStyle = C.TOKEN; ctx.beginPath(); ctx.moveTo(bx, by - 9); ctx.lineTo(bx + 9, by); ctx.lineTo(bx, by + 9); ctx.lineTo(bx - 9, by); ctx.closePath(); ctx.fill();
        ctx.strokeStyle = C.panel; ctx.lineWidth = 2; ctx.stroke();
      } else {
        ctx.fillStyle = C.accent; ctx.beginPath(); ctx.arc(bx, by, 9, 0, 7); ctx.fill();
        ctx.fillStyle = C.accentInk; ctx.font = `700 10px ${C.mono}`; ctx.fillText(badge, bx, by + 0.5);
      }
    }
  }
}

function drawGantt(C) {
  const ctx = gctx; ctx.clearRect(0, 0, GW, GH);
  const left = 34, right = 8, top = 4, rowH = 20, win = 80;
  const t1 = Math.max(win, S.t), t0 = t1 - win;
  const X = t => left + (t - t0) / win * (GW - left - right);
  ctx.textBaseline = 'middle'; ctx.textAlign = 'left';
  ctx.font = `500 11px ${C.mono}`;
  for (let i = 0; i < N; i++) {
    const y = top + i * rowH;
    ctx.fillStyle = C.soft; ctx.fillRect(left, y + 3, GW - left - right, rowH - 6);
    ctx.fillStyle = C.muted; ctx.fillText(P(i), 4, y + rowH / 2);
  }
  for (const iv of S.intervals) {
    if (iv.node >= N) continue;
    const a = Math.max(iv.start, t0), b = iv.end == null ? S.t : iv.end;
    if (b < t0) continue;
    const y = top + iv.node * rowH;
    if (iv.kind === 'wait') { ctx.globalAlpha = 0.4; ctx.fillStyle = C.want; ctx.fillRect(X(a), y + 5, Math.max(1, X(b) - X(a)), rowH - 10); ctx.globalAlpha = 1; }
    else { ctx.fillStyle = C.held; ctx.fillRect(X(a), y + 3, Math.max(1.5, X(b) - X(a)), rowH - 6); }
  }
  // axis
  const ay = top + N * rowH + 8;
  ctx.textAlign = 'center'; ctx.fillStyle = C.muted; ctx.font = `10px ${C.mono}`;
  for (let t = Math.ceil(t0 / 10) * 10; t <= t1; t += 10) {
    const x = X(t);
    ctx.fillRect(x, top, 1, N * rowH);
    ctx.fillText(t, x, ay);
  }
  // now line
  ctx.fillStyle = C.ink; ctx.fillRect(X(S.t) - 0.5, top, 1.5, N * rowH);
}

function updatePanels() {
  const A = ALGOS[algo], st = S.stats;
  $('clock').textContent = 't = ' + fmt(S.t);
  const conc = S.nodes.filter(n => n.state === 'held').length;
  const ok = st.violations === 0;
  const sf = $('safety');
  sf.firstChild.style.background = ok ? 'var(--held)' : 'var(--alert)';
  sf.lastChild.textContent = ok
    ? `Mutual exclusion holds · ${conc} in critical section now · peak ${st.maxConc}`
    : `Safety violated ${st.violations}× · peak ${st.maxConc} in critical section`;
  $('mEntries').textContent = st.entries;
  $('mThroughput').textContent = S.t > 0 ? (st.entries / S.t * 100).toFixed(1) + ' per 100t' : '—';
  $('mPer').textContent = st.entries ? (st.msgs / st.entries).toFixed(1) : '—';
  $('mTheory').textContent = 'theory ' + A.theoryText(N);
  $('mWait').textContent = st.waitN ? fmt(st.waitSum / st.waitN) : '—';
  $('mDelay').textContent = 'sync delay ' + A.delay;
  const types = TYPES_FOR[algo], max = Math.max(1, ...types.map(t => st.byType[t] || 0));
  $('bars').innerHTML = types.map(t => {
    const v = st.byType[t] || 0;
    return `<div class="bar"><span>${t}</span><div class="track"><div class="fill" style="width:${v / max * 100}%;background:var(${TYPE_VAR[t]})"></div></div><span class="n">${v}</span></div>`;
  }).join('');
  S.nodes.forEach((n, i) => {
    const r = rowEls[i]; if (!r) return;
    if (r.st.textContent !== n.state) { r.st.textContent = n.state; r.st.className = 'pill ' + n.state; }
    r.clk.textContent = n.clock;
    r.det.textContent = A.detail(n);
    r.btn.disabled = n.state !== 'idle';
  });
  // log
  const fresh = S.log.filter(e => e.seq > shownSeq);
  if (fresh.length) {
    const frag = document.createDocumentFragment();
    for (const e of fresh.slice(-120)) {
      const li = document.createElement('li');
      const chip = e.type ? `<span class="chip" style="background:var(${TYPE_VAR[e.type]})"></span>` : '';
      li.innerHTML = `<span class="t">${fmt(e.t)}</span><span class="msg k-${e.kind}">${chip}</span>`;
      li.lastChild.append(e.text);
      frag.prepend(li);
    }
    $('log').prepend(frag);
    while ($('log').children.length > 150) $('log').lastChild.remove();
    shownSeq = fresh[fresh.length - 1].seq;
  }
}

stage.addEventListener('click', e => {
  const r = stage.getBoundingClientRect(), x = e.clientX - r.left, y = e.clientY - r.top;
  nodePos.forEach((p, i) => { if (Math.hypot(p.x - x, p.y - y) <= nodeR + 8) requestCS(i); });
});

let last = performance.now(), frame = 0, C = null;
function readColors() {
  C = { line: css('--line'), muted: css('--muted'), ink: css('--ink'), panel: css('--panel'), soft: css('--soft'),
        accent: css('--accent'), accentInk: css('--accent-ink'), held: css('--held'), want: css('--want'),
        REQUEST: css('--m-req'), REPLY: css('--m-rep'), GRANT: css('--m-rep'), RELEASE: css('--m-rel'), TOKEN: css('--m-tok'),
        mono: css('--f-mono'), display: css('--f-display') };
}
function loop(now) {
  const dt = Math.min(0.1, (now - last) / 1000); last = now;
  if (running) {
    const du = dt * 2 * SPEEDS[speedIdx];
    autoRequests(du, rate);
    advanceTo(S.t + du);
  }
  if (frame++ % 30 === 0) readColors();
  if (GH !== 22 + N * 20) sizeCanvases();
  drawStage(C); drawGantt(C); updatePanels();
  requestAnimationFrame(loop);
}

buildTabs();
reset();
sizeCanvases();
readColors();
requestAnimationFrame(loop);
