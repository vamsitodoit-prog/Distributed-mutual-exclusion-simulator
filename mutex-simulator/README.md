# Distributed Mutual Exclusion Simulator

An interactive, browser-based simulator for five classic distributed mutual exclusion algorithms. Watch N processes compete for a single critical section over an asynchronous network, with animated messages, Lamport clocks, live metrics, a per-process timeline and an event log.

No framework, no build step, no dependencies: plain HTML, CSS and JavaScript.

## Algorithms

| Algorithm | Messages per CS entry | Synchronization delay | Notes |
|---|---|---|---|
| Centralized coordinator | 3 | 2T | P0 coordinates; single point of failure |
| Lamport (1978) | 3(N−1) | T | Needs FIFO channels; REQUEST / REPLY / RELEASE |
| Ricart–Agrawala (1981) | 2(N−1) | T | Deferred REPLY doubles as release |
| Token Ring | 1 to ∞ | 0 to (N−1)T | Token circulates even with no demand |
| Suzuki–Kasami (1985) | 0 or N | 0 or T | Broadcast token with RN[ ] / LN[ ] and queue Q |

T is the mean network delay, adjustable in the UI.

## Features

- Network view of 3 to 8 processes, with message pills color-coded by type and a token drawn as a diamond
- Click a process (or its **Request** button) to make it request the critical section
- Play / pause / single-step through events, plus speed, network delay and load presets (Off, Light, Busy, Saturated)
- Live safety monitor that flags any moment two processes are in the critical section at once
- Measured messages per entry compared against the theoretical cost
- Per-process internal state: Lamport queues, deferred replies, RN[ ] arrays, token queue
- Gantt-style timeline of waiting time and critical-section time
- Light and dark themes, responsive down to phone width
- Deep links to a specific algorithm: `/#lamport`, `/#ricart`, `/#ring`, `/#suzuki`, `/#central`

## Project structure

```
public/
  index.html     page markup
  styles.css     theme tokens and layout
  engine.js      discrete-event simulation + all five algorithms (browser + Node)
  app.js         canvas rendering, controls, readouts
  favicon.svg
tests/
  engine.test.js safety, liveness and message-complexity tests
render.yaml      Render Blueprint (static site)
.github/workflows/ci.yml   runs the tests on Node 18, 20 and 22
```

## Run locally

```bash
npm run dev        # serves ./public on http://localhost:3000
```

Or open `public/index.html` directly in a browser.

## Tests

```bash
npm test
```

The suite runs every algorithm with 3 to 8 processes under three load levels using a seeded random generator. It checks that mutual exclusion is never violated, that no process starves, and that measured message counts match theory.

## Deploy to Render

**Option A: Blueprint (recommended)**

1. Push this repo to GitHub.
2. In the Render dashboard, choose **New → Blueprint** and select the repo.
3. Render reads `render.yaml` and creates a free static site. Each push to `main` runs the tests and redeploys; a failing test blocks the deploy.

**Option B: Manual static site**

1. **New → Static Site**, connect the repo.
2. Build command: `npm test`
3. Publish directory: `public`

## How the simulation works

`engine.js` is a discrete-event simulator. Each message gets a random delay of 0.5T to 1.5T, and channels are FIFO (later messages on the same link never overtake earlier ones). Every received message advances the receiver's Lamport clock to `max(local, msg.ts) + 1`. A process holds the critical section for 4 time units. The UI advances simulated time each animation frame and draws in-flight messages by interpolating between send and delivery time.

## License

MIT
