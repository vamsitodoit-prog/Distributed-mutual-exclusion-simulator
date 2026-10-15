# Distributed Mutual Exclusion Simulator

An interactive, browser-based simulator for five classic distributed mutual exclusion algorithms. Watch N processes compete for a single critical section over an asynchronous network, with animated messages, Lamport logical clocks, live metrics, a per-process timeline and an event log.

Built with plain HTML, CSS and JavaScript. No framework, no build step, no runtime dependencies.

**Live demo:** https://distributed-mutex-simulator.onrender.com <!-- replace with your Render URL if it differs -->

---

## Algorithms

| Algorithm | Messages per CS entry | Synchronization delay | Key idea |
|---|---|---|---|
| Centralized coordinator | 3 | 2T | P0 grants access from a FIFO queue. Single point of failure. |
| Lamport (1978) | 3(N−1) | T | Timestamped REQUEST / REPLY / RELEASE with a replicated priority queue. Needs FIFO channels. |
| Ricart–Agrawala (1981) | 2(N−1) | T | A deferred REPLY doubles as the release message. |
| Token Ring | 1 to ∞ | 0 to (N−1)T | A token circulates around a logical ring, even when no one needs it. |
| Suzuki–Kasami (1985) | 0 or N | 0 or T | Broadcast requests. The token carries LN[ ] and a queue Q. |

N is the number of processes and T is the mean network delay.

## Features

- **Network view:** 3 to 8 processes, with in-flight messages color-coded by type (REQUEST, REPLY, GRANT, RELEASE, TOKEN) and each process's Lamport clock shown on its node
- **Interactive requests:** click a process, or its **Request** button, to make it ask for the critical section
- **Simulation controls:** play, pause, single-step through events, speed, network delay, and load presets (Off, Light, Busy, Saturated)
- **Safety monitor:** flags any moment when more than one process is in the critical section
- **Metrics:** critical-section entries, throughput, average wait, and measured messages per entry against the theoretical value
- **Internal state:** Lamport request queues, Ricart–Agrawala deferred replies, Suzuki–Kasami RN[ ] arrays and token queue
- **Timeline:** a Gantt-style chart of each process's waiting time and critical-section time
- **Event log:** every send, receive, deferral, entry and exit, with timestamps
- **Usability:** light and dark themes, works on phones, and deep links to an algorithm (`#lamport`, `#ricart`, `#ring`, `#suzuki`, `#central`)

## Project structure

```
.
├── README.md
└── mutex-simulator/
    ├── public/
    │   ├── index.html       page markup
    │   ├── styles.css       theme tokens and layout
    │   ├── engine.js        discrete-event simulator + all five algorithms
    │   ├── app.js           canvas rendering, controls, readouts
    │   └── favicon.svg
    ├── tests/
    │   └── engine.test.js   safety, liveness and message-complexity tests
    ├── render.yaml          Render Blueprint (static site)
    ├── package.json
    └── LICENSE
```

## Run locally

Requires Node.js 18 or later for the tests and dev server. To only view the simulator, open `mutex-simulator/public/index.html` in a browser.

```bash
git clone https://github.com/vamsitodoit-prog/Distributed-mutual-exclusion-simulator.git
cd Distributed-mutual-exclusion-simulator/mutex-simulator
npm run dev      # serves the site at http://localhost:3000
```

## Tests

```bash
cd mutex-simulator
npm test
```

The suite uses Node's built-in test runner and a seeded random number generator, so every run is reproducible. For every algorithm, with 3 to 8 processes and three load levels, it checks that:

- mutual exclusion is never violated
- every request is eventually served, so no process starves
- measured messages per entry match theory: 3(N−1) for Lamport, 2(N−1) for Ricart–Agrawala, about N for Suzuki–Kasami

## Deploy to Render

The repo includes a Render Blueprint that deploys the simulator as a free static site.

1. In the Render dashboard, choose **New → Blueprint** and connect this repository.
2. Set **Blueprint Path** to `mutex-simulator/render.yaml`.
3. Click **Apply**.

`render.yaml` sets `rootDir: mutex-simulator`, so Render runs `npm test` and publishes `public/` from inside that folder. A failing test blocks the deploy, and every push to `main` redeploys automatically.

To set it up without the Blueprint, choose **New → Static Site** and use:

| Setting | Value |
|---|---|
| Root Directory | `mutex-simulator` |
| Build Command | `npm test` |
| Publish Directory | `public` |

## How the simulation works

`engine.js` is a discrete-event simulator:

- **Network:** each message gets a random delay between 0.5T and 1.5T. Channels are FIFO, so a later message on the same link never overtakes an earlier one.
- **Logical clocks:** a process increments its Lamport clock on each send. On receive it sets the clock to `max(local, msg.ts) + 1`.
- **Tie-breaking:** requests are ordered by the pair ⟨timestamp, process id⟩.
- **Critical section:** a process holds it for 4 time units, then runs the algorithm's release step.
- **Rendering:** the UI advances simulated time each animation frame and draws each message by interpolating between its send time and delivery time.

## References

- L. Lamport, "Time, Clocks, and the Ordering of Events in a Distributed System," *Communications of the ACM*, 1978.
- G. Ricart and A. K. Agrawala, "An Optimal Algorithm for Mutual Exclusion in Computer Networks," *Communications of the ACM*, 1981.
- I. Suzuki and T. Kasami, "A Distributed Mutual Exclusion Algorithm," *ACM Transactions on Computer Systems*, 1985.

## License

MIT. See [LICENSE](mutex-simulator/LICENSE).
