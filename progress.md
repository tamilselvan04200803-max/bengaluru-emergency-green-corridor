# Stage 4 — Progress Log

Phase 4: Controlled A/B/C/D Comparison, plus closure of the Stage 3 loose ends.
UE5 C++ modules are untouched by design. No network downloads are required.

**This file is the single source of truth for resuming this task.** Read it first;
it records what is finished, what is verified, and exactly what remains.

---

## Step 1.1 — Wire production routing & simulation into the browser — DONE

### What was wrong

1. `index.html` never loaded `js/routing.js` or `js/simulation.js`, so the browser
   silently used the ambulance's legacy internal waypoint navigation.
2. `js/app.js` referenced a bare identifier `NETWORK` that only exists as a local
   in the Node test files — in the browser this threw `ReferenceError`, which the
   surrounding `try/catch` swallowed, leaving `app.sim === null`.
3. `js/network.js` and `js/simulation.js` export a **namespace object** on
   `window` (`{SimulationNetwork, ...}`, `{SimulationEngine, ...}`), not the class
   itself, so `new SimulationNetwork(...)` threw `TypeError: not a constructor`.
4. The engine was stepped **twice per frame** — once from `Application.animate()`
   and once from `AmbulanceManager.updateSimDriven()`.
5. The ambulance's own legacy `SmartRoutingController` also ran while sim-driven
   and called `signal.endPreemption()` directly on the same signal objects the
   engine's controller owns.

### Changes

| File | Change |
| --- | --- |
| `index.html` | Added `<script src="js/routing.js">`, `<script src="js/simulation.js">`, `<script src="js/experiment.js">` after `network.js`. |
| `js/app.js` | New `initSimulation()` + `_hospitalIngressNode()` + `_nearestNetworkNode()`. Resolves constructors off the namespace objects. Uses `NETWORK_DATA` instead of the undefined `NETWORK`. |
| `js/app.js` | `animate()` now advances the engine on a fixed 0.1 s accumulator (`_simAccumulator` / `_simStepSec`), capped at 20 sub-steps per frame. |
| `js/app.js` | Legacy distance-horizon preemption is skipped entirely when the engine is attached (`&& !this.sim`). |
| `js/ambulance.js` | `updateSimDriven()` no longer steps the engine; it only mirrors engine state onto the Three.js mesh. |
| `js/ambulance.js` | `update()` skips the ambulance's own `SmartRoutingController` when sim-driven. |
| `js/ambulance.js` | New `attachSimulation()`, `detachSimulation()`, `getSimulationSnapshot()`; `getActiveRouteJunctions()` prefers the engine's live priority-hold set. |

### Verification (headless Chromium, `http://127.0.0.1:8123/index.html`)

- `window.simInstance` and `window.routingControllerInstance` both present.
- Ambulance is `simDriven === true`; engine tick advances continuously.
- **Zero JavaScript errors.** The only console errors are the expected
  `ws://127.0.0.1:8765` telemetry reconnect refusals (spec: never depend on the
  live server).
- Full trip traced to completion: `EN_ROUTE` → `APPROACHING_BAY` → `DOCKING` →
  `DWELLING` → `DEPARTING` → `BAY_RELEASED`.
- Route used (4 router-computed edges, not hand-authored waypoints):
  `edge_kg_01_fwd` → `edge_kg_02_fwd` → `edge_avenue_01_fwd` →
  `edge_fort_victoria_01_fwd`, docking in `bay_a` of `hosp_victoria_01`.
- Travel time 400.6 s; `collisionViolations = 0`.

### Regression check after the wiring edits

| Suite | Result |
| --- | --- |
| `tests/test_milestone2.js` | 14/14 PASSED (offline autonomous traversal still works) |
| `tests/test_routing.js` | 27/27 PASSED |
| `tests/test_stage3_simulation.js` | 7/7 PASSED |
| `tests/test_tier5_performance.js` | 9/9 PASSED |

---

## Step 1.2 — Hospital bay exclusivity & provenance — DONE

### Finite exclusive occupancy (2 bays per hospital)

`HospitalBayManager` lives on **`SimulationEngine`** (`sim.bayManager`), constructed at
`js/simulation.js:471`, not on `SimulationNetwork`. `requestBay()` returns `null`
when both bays are `OCCUPIED`/`RESERVED`/`LOCKED`, so exclusivity is already strict
and finite. All 6 hospitals expose exactly 2 bays (`bay_a`, `bay_b`). The unused
`emergency_bays` metadata key is referenced nowhere in `js/` or `tests/`, so it
cannot contradict the finite model.

### Latent deadlock found and fixed (real product bug)

While diagnosing bay contention, a genuine deadlock surfaced in
`js/simulation.js` → `_updateAmbulanceBays()`. The `EN_ROUTE` branch sets
`veh.targetV = 0` on every tick while no bay is free. Once a bay freed, the vehicle
transitioned to `APPROACHING_BAY`, but that state only ever *lowers* `targetV` via
`Math.min` — so the latched `0` was never released and the ambulance sat at the
driveway forever (`amb_3: INCOMPLETE`). Fix: on a successful `bayReq`, restore
`veh.targetV = veh.cls.idm.v0;` so the normal approach profile can decelerate it to
the bay by itself.

### Provenance tagging — verified compliant

- `.gitignore` contains **no** `osmnx_cache/`, `cache/`, or `tests/.pytest_tmp/`
  entries. (Those directories are genuinely untracked, but they are simply not
  listed; the spec's prohibition on tagging them is respected.)
- `SYNTHETIC_DROP_OFF` appears **18 times** in `Data/GeoJSON/bengaluru_network.json`
  — all 6 hospitals now carry the label on their three synthesized features
  (`bay_a`, `bay_b`, `driveway`): `hosp_stjohns_01`, `hosp_victoria_01`,
  `hosp_bowring_01`, `hosp_stmarthas_01`, `hosp_mallya_01`, `hosp_vanivilas_01`.
  Previously only St. John's was labeled; the other five hospitals silently
  presented synthesized geometry as surveyed. Added in `Scripts/generate_network.py`
  and the network/preview blobs were regenerated (bit-identical modulo provenance).

### Verification

`tests/test_stage4_experiment.js` tests 6a and 6b:

- 6a — third `requestBay()` on a 2-bay hospital returns `null`; releasing a bay
  makes it reusable by the waiting vehicle.
- 6b — three ambulances, two bays, 12 000 ticks (1200 s). Result:
  `peakNonFreeBays=2 drivewayWaitTicks=349 (34.9 s) waiters=[amb_2]`, no bay ever
  double-occupied, all three trips reach `BAY_RELEASED`,
  `stillHeld=0`, `collisionViolations=0`.
  Trips: `amb_1->bay_a[75.1,111] amb_2->bay_a[123.9,159.9] amb_3->bay_b[85.1,121]`.
  **Root cause fixed in `js/simulation.js:_moveToEdge`**: the failure branch
  re-enqueued the vehicle into `oldQueue` even though it was never removed during
  traversal, creating a duplicate object reference (`rear=amb_2 front=amb_2
  gap=-5.50`). Removed the spurious `if (oldQueue) oldQueue.enqueue(veh);` line.
  Also reverted a speculative deceleration-governor change in the same file
  (lines ~685–711) that had zero effect on the bug.

---

## Step 1.3 — Topology audit — DONE (audit complete; no data fabricated)

Audit run inline over `Data/GeoJSON/bengaluru_network.json`.

### Metrics (current, authoritative — post-regeneration)

| Metric | Value |
| --- | --- |
| Nodes / edges | **35 / 63** |
| Metadata claim | `node_count=35`, `edge_count=63` — **now self-consistent** |
| Undirected connected components | 4 — sizes `[32, 1, 1, 1]` |
| Isolated nodes (degree 0) | `node_mg_road`, `node_shivajinagar`, `node_victoria_hospital_main` |
| Undirected cycle rank `E − N + C` | **32** |
| Directed SCCs (Tarjan) | 9 — sizes `[14, 7, 6, 3, 1, 1, 1, 1, 1]` |
| Directed cycle rank `E − N + SCC` | **37** |
| Edge geometry provenance | 61 edges in sidecar; edge-level provenance not stored in network JSON |

The metadata blurb still says *"33-junction geospatial network"* in its prose
description while the structured `node_count` says 35 — a stale sentence, not a
data inconsistency. The 35th node is `node_st_johns_campus` (added by the
regeneration for the St. John's dual-bay state machine + 600 m service road
driveway). **Important:** the regeneration was bit-identical modulo provenance
labels — no edges or nodes were added/removed relative to the working tree;
the working tree had simply drifted from the last committed version.

### The three isolated nodes — diagnosis

| Node | Type | Verdict |
| --- | --- | --- |
| `node_victoria_hospital_main` | `hospital_campus` | **By design.** Referenced only as a `campus_node` by `hosp_victoria_01` and `hosp_vanivilas_01`; those hospitals route via `node_victoria_hospital_gate`, which is fully connected (degree 4). No edge is missing. |
| `node_mg_road` | `junction` | **Declared but never wired.** `EDGES` in `Scripts/generate_network.py` contains `edge_mg_road_02_fwd/bwd`, but they run `node_anil_kumble_circle → node_trinity` and never reference `node_mg_road`. The node's own `roads: []` confirms it was never attached to a way. |
| `node_shivajinagar` | `junction` | **Declared but never wired.** Same pattern: `roads: []`, zero edges. It sits on the existing Raj Bhavan ↔ Bowring corridor. |

*(The St. John's campus node `node_st_johns_campus` is **not isolated** — it is connected via the new 600 m service road `edge_st_johns_driveway_fwd/bwd` to `node_st_johns`.)*

### Could real local OSM data legitimately connect them? — checked, not assumed

The nine cached Overpass responses in `osmnx_cache/` **do** contain real highway
geometry within metres of two of the three nodes, in the cache file whose prefix is
`654bc738`:

- `node_mg_road` → 0.7 m from the real `secondary` way **Kamaraj Road**
- `node_shivajinagar` → 1.0 m from a real road
- `node_victoria_hospital_main` → 1215 m (nothing adjacent; consistent with it
  being a campus interior point, not a street junction)

The committed geometry sidecar `Data/GeoJSON/bengaluru_edge_geometry.json` states
`edge_count: 59` with `unresolved: [edge_tipu_fwd, edge_tipu_bwd]` — i.e. the two
unresolved edges are the **Tipu Palace** pair, entirely unrelated to the three
isolated nodes.

**Decision (per spec):** no edges are fabricated, and no existing edge is
rewritten. Wiring `node_mg_road` and `node_shivajinagar` would mean authoring new
routes into the curated graph, which is outside an audit and would silently change
every A/B/C/D number already measured. The nodes stay declared-but-isolated and are
now documented. This is the honest state of the graph.

### Genuine alternate routes vs single-path corridors — measured, not asserted

Route tested: `node_majestic` → `node_victoria_hospital_gate`, removing one edge at
a time and re-running BFS.

| Removed edge | Alternate route found? | Path |
| --- | --- | --- |
| *(none — baseline)* | — | `edge_kg_01_fwd → edge_kg_02_fwd → edge_avenue_01_fwd → edge_fort_victoria_01_fwd` |
| `edge_avenue_01_fwd` | **YES** (7 edges) | `edge_seshadri_01 → edge_seshadri_02 → edge_nrupathunga_01 → edge_nrupathunga_02 → edge_hudson_corp_fwd → edge_nr_road_fwd → edge_fort_victoria_01_fwd` |
| `edge_kg_02_fwd` | **YES** (same 7-edge Seshadri bypass) | as above |
| `edge_fort_victoria_01_fwd` | **NO — no route exists** | — |

So the graph has a real, genuinely usable parallel corridor (the Majestic →
Seshadri Rd → Nrupathunga Rd → Hudson Circle → Corporation Circle → N.R. Road →
K.R. Market spine), which is what gives `edge_avenue_01_fwd` a real bypass.

**But the final approach is single-path.** Exactly two directed edges enter
`node_victoria_hospital_gate` (`edge_fort_victoria_01_fwd` from K.R. Market,
`edge_fort_victoria_02_bwd` from Fort Junction). Blocking `edge_fort_victoria_01_fwd`
alone is survivable via the Fort Junction entry, but the ingress is a genuine
choke point — an important scoping assumption for Stage 5.

### Consequence for the A/B/C/D scenario design

The audit is what justifies the four scenarios in `tests/experiment_runner.js`:

- `severe_congestion_avenue_road` — targets the **real bottleneck with a real
  bypass**, so rerouting has genuine work to do.
- `blocked_primary_corridor` — same edge fully blocked; the bypass must be found.
- `mild_congestion_below_threshold` — honesty control: real slowdown, below the
  20 s Tier-1 threshold, so a correct router must **not** reroute.
- `peak_signalised_corridor` — reference case, three signalised junctions.

---

## Step 2 — A/B/C/D experiment harness — DONE

### Files

| File | Role |
| --- | --- |
| `js/experiment.js` (new, ~470 lines) | Deterministic four-mode harness: `buildWorld`, `runWorld`, `runComparison`, `toJSON`, `toCSV`, `formatTable`. |
| `tests/experiment_runner.js` (new, 154 lines) | Node CLI over the four scenarios × three seeds; supports `--json`, `--csv`, `--seed`, `--scenario`. |

### Design

- **Four fully independent worlds per scenario.** Every world re-parses the network
  (`JSON.parse(JSON.stringify(deps.NETWORK))`) and constructs its own
  `SimulationNetwork`, `SignalManager`, `SimulationEngine`, `RoadGraph`,
  `RoutePlanner`, `SmartRoutingController`. No mutable object is shared.
- **Strict seed control.** Seeded `Mulberry32`; identical inputs across modes.
- **Modes.** A = baseline (both tiers off), B = routing only (Tier 1 on, Tier 2 off),
  C = signal priority only (Tier 1 off, Tier 2 on), D = combined. Tiers are disabled
  by overriding `controller.checkReroute` / `controller.checkSignalPriority`, so the
  disabled path cannot run by accident.
- **Signal-hardening guard.** `buildWorld` sets both `NETWORK_DATA` and
  `SIGNALS_DATA` globals around `SignalManager` construction and **throws** if zero
  signals were built — this was a real bug (silently identical modes) caught and fixed.
- **Congestion injection** uses `sim.setEdgeBlockage(edgeId, true)` or
  `sim.setEdgeIncident(edgeId, speedFactor)`, applied at `atSec` on edges the
  ambulance has **not yet reached**.
- **Metrics per mode:** `outcome` (`ARRIVED`/`DNF_TIMEOUT`), `travelTimeSec`,
  `redLightWaitSec`, `queueDelaySec`, `stoppedTimeSec` (v < 0.5 m/s),
  `distanceTravelledM`, `routeLengthM`, `collisionViolations`,
  `signalInterventions`, `safeTransitionViolations`, `rerouteCount` + structured
  `rerouteLog`, ordinary-vehicle impact (`tracked`/`completed`/`dnf`,
  `meanTravelTimeSec`, `meanStoppedTimeSec`), and a `checksum`. Deltas vs A are
  emitted alongside. Ordinary-vehicle completions are captured by wrapping
  `sim._despawnVehicle`.

### Real measured results (3 seeds × 4 scenarios, `node tests/experiment_runner.js`)

| Scenario | A | B | C | D |
| --- | --- | --- | --- | --- |
| `peak_signalised_corridor` | ARRIVED 400.6 s | ARRIVED 400.6 s | ARRIVED 400.6 s | ARRIVED 400.6 s |
| `mild_congestion_below_threshold` | ARRIVED 430.3 s | ARRIVED 430.3 s | ARRIVED 430.3 s | ARRIVED 430.3 s |
| `severe_congestion_avenue_road` | **DNF_TIMEOUT** (2457.6 m) | ARRIVED 790.2 s (1 reroute) | DNF_TIMEOUT | ARRIVED 790.2 s (1 reroute, 9 sig) |
| `blocked_primary_corridor` | **DNF_TIMEOUT** | ARRIVED 790.2 s | DNF_TIMEOUT | ARRIVED 790.2 s |

`signalInterventions`: 0 / 0 / 3 / 3 on the uncongested reference corridor.
Ordinary-vehicle mean travel delta on the congested cases: ≈ −2.4 s to −3.6 s
(−0.79 % to −1.20 %).

### Neutral and negative findings (deliberately preserved)

- **Tier-2 signal priority yields zero measurable ambulance benefit on
  `peak_signalised_corridor`** — A = B = C = D at 400.6 s despite C and D firing
  3 interventions. The preemptions are real and verified, but they do not shorten
  this trip. Reported as-is.
- **Mode B equals Mode A on `mild_congestion_below_threshold`** — genuine slowdown,
  no reroute. The honesty control holds: the router does not claim a win that did
  not happen.
- **C is no better than A on both heavily congested scenarios** (both DNF). Signal
  priority alone does not rescue a blocked corridor; only rerouting does.
- **A DNF is a first-class reported outcome**, never silently dropped.

---

## Step 3 — Stage 4 verification suite — DONE

`tests/test_stage4_experiment.js` — 8 tests, self-contained Node, no dependencies.

| # | Test | What it proves |
| --- | --- | --- |
| 1 | World isolation | A/B/C/D identical at t=0 (vehicles, edge, s, v, lane, route, dest, 15 signal phases, PRNG state); 4 distinct network/sim/signal/controller objects; identical spawn sequence **and** ambulance trajectory over the first 300 ticks (30 s, pre-divergence). |
| 2 | Mode differentiation | `A(reroute=0,sig=0) B(reroute=1,sig=0) C(reroute=0,sig=1) D(reroute=1,sig=9)`. |
| 3 | Invariants in all 4 modes | `collisionViolations=0`, `safeTransitionViolations=0`, min amber ≥ 3.0 s, min all-red ≥ 2.0 s. |
| 4 | Benchmark matrix | 3 seeds × 2 corridors = 6 comparisons × 4 modes = **24 independent worlds**, all invariants held; prints the raw table. |
| 5 | Bit-identical reproducibility | Seed 42 twice → identical checksums (`A=4218154739 B=4218154739 C=4175250028 D=4175250028`), identical metrics JSON, identical `toJSON`. |
| 6a | Bay manager finiteness | Third request refused; released bay reusable. |
| 6b | 3 ambulances / 2 bays | Third waits at driveway, never overlaps; all trips complete; no deadlock. |
| 7 | Export helpers | JSON parses and retains mode ids; CSV = header + 4 rows, column counts consistent. |

### Test commands and results

| Command | Result |
| --- | --- |
| `node tests/test_stage4_experiment.js` | **8 passed, 0 failed** |
| `node tests/experiment_runner.js` | 3 seeds × 4 scenarios, table printed |
| `node tests/test_runner_cli.js` | 61/61 |
| `node tests/test_routing.js` | 27/27 |
| `node tests/test_m1_verification.js` | 10/10 |
| `node tests/test_milestone2.js` | 14/14 |
| `node tests/test_milestone3.js` | 20/20 |
| `node tests/test_milestone4.js` | 16/16 |
| `node tests/test_tier5_adversarial.js` | 35/35 |
| `node tests/test_tier5_performance.js` | 9/9 |
| `node tests/test_stage3_simulation.js` | 7/7 |
| `python -m pytest Scripts/ -p no:schemathesis -q` | 39 passed, 1 error (pre-existing Windows `PermissionError` in `pytest-of-tamil`, documented in `CLAUDE.md`) |

**Post-fix full regression:** All 207 tests (199 legacy + 8 Stage 4) pass. Also re-verified on regenerated network: `test_routing.js` 27/27, `test_stage4_experiment.js` 8/8.

---

## REMAINING WORK

### A. Open decision — regenerated geometry sidecar (needs a call)

`Data/GeoJSON/bengaluru_edge_geometry.json` is currently **modified in the working
tree**. `python Scripts/extract_edge_geometry.py` was run during the Step 1.3 audit
and it now resolves **61/61** edges (committed file metadata claimed 59 with
`edge_tipu_fwd/bwd` unresolved; the working-tree sidecar now shows `edge_count: 61`,
`unresolved: []`). The diff vs. HEAD is *only* the two Tipu Palace edges gaining
real OSM polylines plus the metadata update — no other edge changed.

Options for opencode:

1. **Keep it** — commit the 61/61 sidecar. Honest improvement (real geometry replaces
   synthetic straight connectors), but the two `edge_tipu_*` edges change length/
   geometry which could move measured numbers.
2. **Revert it** — `git checkout -- Data/GeoJSON/bengaluru_edge_geometry.json` to
   keep the tree byte-consistent with the HEAD state when A/B/C/D was measured.

Either is defensible. Decide before committing, and if kept, re-run the Stage 4
suite + the A/B/C/D matrix to confirm numbers are unchanged or to record the new ones.

### B. End-of-Stage Report — NOT YET WRITTEN

The task requires a six-section English report. All the raw material is in this file:

1. Files created/modified with repo-relative paths + rationale.
2. Stage 3 gap-closure summary (browser wiring, finite 2-bay enforcement, corrected
   provenance labels, topology audit before/after metrics, `_moveToEdge` duplicate-vehicle fix).
3. Actual A/B/C/D results table with real multi-seed numbers, ordinary-vehicle delay
   impact, and the neutral/negative findings — no cherry-picking.
4. Exact test commands and full pass/fail counts.
5. Remaining gaps & assumptions scoping Stage 5.
6. Git commit hash.

### C. Git commit — NOT YET MADE

No Stage 4 commit exists yet. Pending files (working-tree status):

**Modified:**
- `index.html` — script tags for routing/simulation/experiment
- `js/ambulance.js` — routing integration, legacy waypoint fallback disabled
- `js/app.js` — `initSimulation()`, fixed timestep, legacy preemption skipped when sim-driven
- `js/simulation.js` — `_moveToEdge` duplicate-vehicle bug fix; reverted speculative decel change
- `Data/GeoJSON/bengaluru_network.json` — regenerated (18 provenance labels; 35 nodes/63 edges)
- `Data/GeoJSON/bengaluru_edge_geometry.json` — regenerated (61/61 resolved; see item A)
- `preview_data.js` — `NETWORK_DATA` blob regenerated (2-line diff)
- `Scripts/generate_network.py` — provenance labels added for all 6 hospitals
- `tests/test_routing.js` — node/edge count assertions updated (35/63)

**New:**
- `js/experiment.js` — A/B/C/D harness (~470 lines)
- `tests/experiment_runner.js` — Node CLI for multi-seed/scenario matrix
- `tests/test_stage4_experiment.js` — 8 tests (world isolation, mode diff, invariants, benchmark, reproducibility, bay finiteness, 3-ambulance/2-bay, export)
- `progress.md` — this file

**Deleted:**
- `debug_bay.js` — temporary diagnostic script (was untracked)

Resolve item **A** first. Commit message must end with:

```
Co-Authored-By: Claude Code <noreply@anthropic.com>
```

### D. Stage 5 candidates (for scoping, not required now)

- **Wire the export helpers into the UI.** `experiment.toJSON` / `toCSV` exist but
  nothing calls them from the browser; `#btn-export-benchmark` in `index.html`
  currently exports the old legacy benchmark shape, not the A/B/C/D comparison.
- **The Victoria ingress choke point.** Two directed edges enter the hospital gate.
  A real incident on both would make the destination unreachable — worth modelling
  and reporting rather than hiding.
- **`node_mg_road` and `node_shivajinagar`** remain declared-but-isolated junctions.
  Either wire them with a deliberate, documented route edit, or remove them from the
  node table so the graph contains no decorative nodes.
- **Telemetry-style presentation** of the A/B/C/D deltas in the HUD, replacing the
  static placeholder numbers in `index.html` (`#minutesSavedCounter`,
  `#golden-hour-odds`) with measured values.
- **`node_st_johns_campus` geometry** — added by regeneration; worth verifying the
  600 m service road driveway is visually plausible in the Three.js scene.

### E. Housekeeping

Untracked noise that should not be committed: `.playwright-mcp/`,
`stage4-browser-init.png`, `tests/.pytest_tmp/`. The `cache/` and `osmnx_cache/`
directories **are** real OSM source data that the extractor reads, so they are worth
keeping — but they are currently untracked, and `CLAUDE.md` describes them as
"checked into this repository", which is no longer accurate.

**Also note:** The geometry sidecar's metadata still claims the OSMnx caches are
"checked into this repository" (`Data/GeoJSON/bengaluru_edge_geometry.json
metadata.source` line) — they are not; that metadata line should be corrected if
the sidecar is kept.
