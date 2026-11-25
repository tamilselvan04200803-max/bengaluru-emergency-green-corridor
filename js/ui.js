/**
 * js/ui.js
 * Bengaluru Emergency Green Corridor 3D Digital Twin — Interactive HUD & Analytics UI
 *
 * Manages the live Sci-Fi Heads-Up Display (HUD):
 * - Live "AI Green Corridor: ON vs. OFF (Baseline)" toggle button
 * - Side-by-side comparative cards: Baseline vs AI Green Wave ETA, Halts Avoided,
 *   Minutes Saved, and Golden Hour Survival Odds Preserved (+8% per min)
 * - Digital Speedometer & Radial Gauge, Telemetry status, Mode indicators
 * - Floating notification toasts & Benchmark JSON export trigger
 * - Phase 5: 7 Interactive Control Panels with single active drawer mode
 *
 * Browser-global (window.UIManager) & CommonJS / Node.js compatible (UMD).
 */

(function (root, factory) {
  if (typeof define === 'function' && define.amd) {
    define([], factory);
  } else if (typeof module === 'object' && module.exports) {
    module.exports = factory();
  } else {
    root.UIManager = factory();
  }
}(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  const HUD_REQUIRED_KEYS = [
    'speedometerGauge',
    'baselineTimeDisplay',
    'aiCorridorTimeDisplay',
    'minutesSavedCounter',
    'priorityStatusBadge',
    'haltReductionBadge'
  ];

  class UIManager {
    /**
     * @param {Object} [app] - Main Application instance
     */
    constructor(app = null) {
      this.app = app;
      this.isNode = typeof document === 'undefined';
      this.lastTelemetryUpdate = 0;
      this.updateIntervalMs = 100; // 10Hz UI refresh (>2Hz requirement for Test T1.4.5)
      this.elements = {};
      this.activePanel = null; // Single active drawer mode

      if (!this.isNode) {
        this.cacheDomElements();
        this.initEventListeners();
      } else {
        // Node.js test environment mock containers
        this.elements = {
          speedometerGauge: { innerText: '0.0 km/h', value: 0 },
          baselineTimeDisplay: { innerText: '00:00' },
          aiCorridorTimeDisplay: { innerText: '00:00' },
          minutesSavedCounter: { innerText: '0.0' },
          priorityStatusBadge: { innerText: 'ACTIVE' },
          haltReductionBadge: { innerText: '0' }
        };
      }
    }

    /**
     * Caches all HUD DOM elements and aliases for test suite compatibility (Test T1.4.4).
     */
    cacheDomElements() {
      // Primary HUD gauges and counters
      this.elements.speedometerGauge = document.getElementById('speedometerGauge') || document.getElementById('speedometer-gauge');
      this.elements.baselineTimeDisplay = document.getElementById('baselineTimeDisplay') || document.getElementById('baseline-time-display');
      this.elements.aiCorridorTimeDisplay = document.getElementById('aiCorridorTimeDisplay') || document.getElementById('ai-corridor-time-display');
      this.elements.minutesSavedCounter = document.getElementById('minutesSavedCounter') || document.getElementById('minutes-saved-counter');
      this.elements.priorityStatusBadge = document.getElementById('priorityStatusBadge') || document.getElementById('priority-status-badge');
      this.elements.haltReductionBadge = document.getElementById('haltReductionBadge') || document.getElementById('halt-reduction-badge');

      // Additional comparative elements
      this.elements.btnCorridorToggle = document.getElementById('btn-corridor-toggle');
      this.elements.corridorToggleText = document.getElementById('corridor-toggle-text');
      this.elements.percentSavedDisplay = document.getElementById('percent-saved-display');
      this.elements.haltsAvoidedCount = document.getElementById('halts-avoided-count');
      this.elements.speedBoostDisplay = document.getElementById('speed-boost-display');
      this.elements.baselineHaltsCount = document.getElementById('baseline-halts-count');
      this.elements.baselineAvgSpeed = document.getElementById('baseline-avg-speed');
      this.elements.baselineSignalDelays = document.getElementById('baseline-signal-delays');
      this.elements.aiHaltsCount = document.getElementById('ai-halts-count');
      this.elements.aiAvgSpeed = document.getElementById('ai-avg-speed');
      this.elements.preemptionHorizon = document.getElementById('preemption-horizon');
      this.elements.rerouteCount = document.getElementById('reroute-count');
      this.elements.signalInterventionCount = document.getElementById('signal-intervention-count');
      this.elements.toastContainer = document.getElementById('toast-container');
      this.elements.speedDialFill = document.getElementById('speed-dial-fill');
      this.elements.speedometerValue = document.getElementById('speedometer-value');
      this.elements.telemetryBadge = document.getElementById('telemetry-badge');
      this.elements.btnExportBenchmark = document.getElementById('btn-export-benchmark');
      this.elements.liveTelemetryCard = document.getElementById('live-telemetry-card');
      this.elements.liveTelemetryContent = document.getElementById('live-telemetry-content');

      // Stage 7: AI Priority & Clearance Banner elements
      this.elements.aiPriorityBanner = document.getElementById('ai-priority-banner');
      this.elements.bannerSubtitle = document.getElementById('banner-subtitle');
      this.elements.bannerNextSignal = document.getElementById('banner-next-signal');
      this.elements.bannerEta = document.getElementById('banner-eta');
      this.elements.bannerQueueLength = document.getElementById('banner-queue-length');
      this.elements.bannerClearRate = document.getElementById('banner-clear-rate');

      // Stage 7: Spawn Traffic Ahead button
      this.elements.spawnTrafficBtn = document.getElementById('spawn-traffic-btn');
    }

    /**
     * Initializes UI event listeners including the live AI Green Corridor toggle button.
     */
    initEventListeners() {
      if (this.isNode) return;

      // AI Green Corridor Toggle Button
      if (this.elements.btnCorridorToggle) {
        this.elements.btnCorridorToggle.addEventListener('click', () => {
          this.toggleCorridorMode();
        });
      }

      // Benchmark JSON Export Button
      if (this.elements.btnExportBenchmark) {
        this.elements.btnExportBenchmark.addEventListener('click', () => {
          this.exportBenchmarkJson();
        });
      }

      // Stage 7: Spawn Traffic Ahead button
      if (this.elements.spawnTrafficBtn) {
        this.elements.spawnTrafficBtn.addEventListener('click', () => {
          this.spawnTrafficAhead();
        });
      }

      // Keyboard Shortcut 'G' for Green Corridor toggle
      window.addEventListener('keydown', (e) => {
        if (e.target && (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA')) return;
        if (e.key === 'g' || e.key === 'G') {
          this.toggleCorridorMode();
        }
      });
    }

    /**
     * Toggles between AI Green Corridor (Active Preemption & Yielding)
     * and Baseline Demonstration Mode (No Preemption, No Yielding).
     */
    toggleCorridorMode() {
      let isAiActive = true;
      if (this.app && typeof this.app.toggleAiCorridor === 'function') {
        isAiActive = this.app.toggleAiCorridor();
      } else if (this.app && this.app.benchmark && typeof this.app.benchmark.toggleAiCorridor === 'function') {
        isAiActive = this.app.benchmark.toggleAiCorridor();
        this.app.aiCorridorActive = isAiActive;
      }

      this.updateCorridorToggleUI(isAiActive);

      if (isAiActive) {
        this.showToast('AI Green Corridor: ACTIVE — Dynamic Preemption & Parting Wave ON', 'success');
      } else {
        this.showToast('AI Green Corridor: DISABLED — Baseline Congestion & Cycling Red Signals', 'warning');
      }

      return isAiActive;
    }

    /**
     * Updates visual state of the Corridor Toggle Button.
     * @param {boolean} isActive
     */
    updateCorridorToggleUI(isActive) {
      if (this.elements.btnCorridorToggle) {
        this.elements.btnCorridorToggle.classList.toggle('active', isActive);
        this.elements.btnCorridorToggle.classList.toggle('baseline-mode', !isActive);
      }

      if (this.elements.corridorToggleText) {
        this.elements.corridorToggleText.innerText = isActive
          ? 'AI GREEN CORRIDOR: ACTIVE'
          : 'AI GREEN CORRIDOR: OFF (BASELINE)';
      }

      if (this.elements.priorityStatusBadge) {
        this.elements.priorityStatusBadge.innerText = isActive
          ? 'GREEN WAVE ACTIVE'
          : 'BASELINE ITMS';
        this.elements.priorityStatusBadge.className = isActive
          ? 'card-badge badge-active'
          : 'card-badge badge-baseline';
      }
    }

    /**
     * Periodic telemetry update called from the animation loop.
     * Enforces >=2Hz refresh rate (Test T1.4.5).
     * @param {number} dt - Frame delta time in seconds
     */
    update(dt = 0.016) {
      if (this.isNode) return;

      const now = (typeof performance !== 'undefined') ? performance.now() : Date.now();
      if (now - this.lastTelemetryUpdate < this.updateIntervalMs) {
        return;
      }
      this.lastTelemetryUpdate = now;

      const benchmark = (this.app && this.app.benchmark) ? this.app.benchmark : null;
      const simEngine = (this.app && this.app.sim) ? this.app.sim : null;
      const metrics = benchmark && simEngine ? benchmark.getMetrics(simEngine) : null;
      const ambulance = (this.app && this.app.ambulance) ? this.app.ambulance : null;
      const speedKmh = (ambulance && typeof ambulance.getSpeedKmh === 'function') ? ambulance.getSpeedKmh() : (metrics ? metrics.currentSpeedKmh : 0.0);

      this.renderMetrics(metrics, speedKmh);
      this.renderLiveTelemetry(metrics, simEngine);
    }

    /**
     * Renders benchmark metrics into DOM containers.
     * @param {Object} m - Metrics snapshot from BenchmarkEngine
     * @param {number} speedKmh - Current ambulance speed
     */
    renderMetrics(m, speedKmh = 0.0) {
      if (!m || this.isNode) return;

      // 1. Baseline Card Metrics
      if (this.elements.baselineTimeDisplay) {
        this.elements.baselineTimeDisplay.innerText = m.baselineEtaStr || BenchmarkEngine.formatTime(m.baselineTimeSec);
      }
      if (this.elements.baselineHaltsCount) {
        this.elements.baselineHaltsCount.innerText = `${m.baselineHalts} stops`;
      }
      if (this.elements.baselineAvgSpeed) {
        this.elements.baselineAvgSpeed.innerText = `${m.avgSpeedBaseKmh.toFixed(1)} km/h`;
      }
      if (this.elements.baselineSignalDelays) {
        this.elements.baselineSignalDelays.innerText = `${(m.ambulanceRedLightWaitSec || 0).toFixed(0)}s`;
      }

      // 2. AI Green Corridor Card Metrics
      if (this.elements.aiCorridorTimeDisplay) {
        this.elements.aiCorridorTimeDisplay.innerText = m.aiEtaStr || BenchmarkEngine.formatTime(m.aiCorridorTimeSec);
      }
      if (this.elements.aiHaltsCount) {
        this.elements.aiHaltsCount.innerText = `${m.aiHalts} (ZERO)`;
      }
      if (this.elements.aiAvgSpeed) {
        this.elements.aiAvgSpeed.innerText = `${m.avgSpeedAiKmh.toFixed(1)} km/h`;
      }
      if (this.elements.preemptionHorizon) {
        this.elements.preemptionHorizon.innerText = `${(m.preemptionHorizon || 250)}m`;
      }

      // 3. Central Impact Metrics
      if (this.elements.minutesSavedCounter) {
        this.elements.minutesSavedCounter.innerText = m.minutesSaved.toFixed(1);
      }
      if (this.elements.percentSavedDisplay) {
        this.elements.percentSavedDisplay.innerText = `${m.percentTimeSaved.toFixed(1)}% TIME SAVED`;
      }

      // 4. Halts Avoided & Speed Boost Badges
      if (this.elements.haltsAvoidedCount) {
        this.elements.haltsAvoidedCount.innerText = `${m.haltsAvoided}`;
      }
      if (this.elements.haltReductionBadge) {
        const badgeNum = this.elements.haltReductionBadge.querySelector('.badge-num');
        if (badgeNum) badgeNum.innerText = `${m.haltsAvoided}`;
      }
      if (this.elements.speedBoostDisplay) {
        this.elements.speedBoostDisplay.innerText = `+${m.speedImprovementPercent.toFixed(0)}%`;
      }
      if (this.elements.rerouteCount) {
        this.elements.rerouteCount.innerText = `${m.reroutes || 0}`;
      }
      if (this.elements.signalInterventionCount) {
        this.elements.signalInterventionCount.innerText = `${m.signalInterventions || 0}`;
      }

      // 5. Speedometer Gauge & Telemetry Strip
      if (this.elements.speedometerValue) {
        this.elements.speedometerValue.innerText = `${speedKmh.toFixed(1)}`;
      }
      // Only overwrite speedometerGauge.innerText in headless/Node mock mode (preserves SVG gauge in DOM)
      if (this.isNode && this.elements.speedometerGauge) {
        this.elements.speedometerGauge.innerText = `${speedKmh.toFixed(1)} km/h`;
      }
      if (this.elements.speedDialFill) {
        // Circumference is 2 * PI * 42 ~= 264
        const maxSpeed = 100.0;
        const fraction = Math.min(1.0, Math.max(0.0, speedKmh / maxSpeed));
        const offset = 264 * (1.0 - fraction);
        this.elements.speedDialFill.style.strokeDashoffset = `${offset}`;
      }
    }

    /**
     * Renders Live Simulation Telemetry card (single-column right HUD card).
     * Shows real-time measured data from SimulationEngine — zero fabricated estimates.
     */
    renderLiveTelemetry(m, simEngine) {
      if (!this.elements.liveTelemetryCard || !this.elements.liveTelemetryContent) return;
      if (!simEngine) return;

      const simMetrics = simEngine.getMetrics ? simEngine.getMetrics() : {};
      const simTimeSec = Number.isFinite(simMetrics.time) ? simMetrics.time : (simEngine.time || 0);
      const ambSpeed = Number.isFinite(simMetrics.ambulanceSpeedKmh) ? simMetrics.ambulanceSpeedKmh : 0;
      const distKm = (this.app && typeof this.app._ambOdometerM === 'number')
        ? (this.app._ambOdometerM / 1000.0)
        : (simMetrics.ambulanceDistanceKm || 0);
      const activeSignals = (simEngine.signalManager && typeof simEngine.signalManager.getAllSignals === 'function')
        ? simEngine.signalManager.getAllSignals().length
        : 0;
      const totalVeh = Number.isFinite(simMetrics.vehicleCount) ? simMetrics.vehicleCount : (simEngine.vehicles ? simEngine.vehicles.size : 0);
      const ambCount = simEngine.ambulances ? simEngine.ambulances.size : 0;
      const civCount = Math.max(0, totalVeh - ambCount);
      const congestedEdges = simMetrics.totalCongestionEdges || 0;
      const clearRatePct = ((simMetrics.routeClearRate || 0) * 100).toFixed(1);
      const signalOverrides = simMetrics.signalInterventions || 0;
      const redWait = (simMetrics.ambulanceRedLightWaitSec || 0).toFixed(1);
      const log = simMetrics.decisionLog || simEngine.decisionLog || [];
      const tier1Count = log.filter(d => d.tier === 'TIER1_REROUTE' || d.tier === 'Tier-1' || d.tier === 1).length;
      const tier2Count = log.filter(d => d.tier === 'TIER2_PRIORITY' || d.tier === 'Tier-2' || d.tier === 2).length;

      const html = `
        <div class="telemetry-row">
          <span class="telemetry-label">Sim Time:</span>
          <span class="telemetry-value" style="color:var(--accent-cyan);">${simTimeSec.toFixed(1)}s</span>
        </div>
        <div class="telemetry-row">
          <span class="telemetry-label">Ambulance Speed:</span>
          <span class="telemetry-value" style="color:var(--accent-green);">${ambSpeed.toFixed(1)} km/h</span>
        </div>
        <div class="telemetry-row">
          <span class="telemetry-label">Distance Traveled:</span>
          <span class="telemetry-value">${distKm.toFixed(2)} km</span>
        </div>
        <div class="telemetry-row">
          <span class="telemetry-label">Active Signals:</span>
          <span class="telemetry-value">${activeSignals}</span>
        </div>
        <div class="telemetry-row">
          <span class="telemetry-label">Civilian Vehicles:</span>
          <span class="telemetry-value">${civCount}</span>
        </div>
        <div class="telemetry-row">
          <span class="telemetry-label">Congested Edges:</span>
          <span class="telemetry-value" style="color:var(--accent-red);">${congestedEdges}</span>
        </div>
        <div class="telemetry-row">
          <span class="telemetry-label">Route Clear Rate:</span>
          <span class="telemetry-value" style="color:var(--accent-green);">${clearRatePct}%</span>
        </div>
        <div class="telemetry-row">
          <span class="telemetry-label">Signal Overrides:</span>
          <span class="telemetry-value" style="color:var(--accent-amber);">${signalOverrides}</span>
        </div>
        <div class="telemetry-row">
          <span class="telemetry-label">Red Light Wait:</span>
          <span class="telemetry-value" style="color:var(--accent-red);">${redWait}s</span>
        </div>
        <div class="telemetry-row">
          <span class="telemetry-label">Tier-1 Reroutes:</span>
          <span class="telemetry-value" style="color:var(--accent-cyan);">${tier1Count}</span>
        </div>
        <div class="telemetry-row">
          <span class="telemetry-label">Tier-2 Priority:</span>
          <span class="telemetry-value" style="color:var(--accent-amber);">${tier2Count}</span>
        </div>
      `;
      this.elements.liveTelemetryContent.innerHTML = html;
    }

    /**
     * Displays a floating toast notification.
     * @param {string} message
     * @param {string} [type='info'] - 'info' | 'success' | 'warning' | 'error'
     * @param {number} [durationMs=3200]
     */
    showToast(message, type = 'info', durationMs = 3200) {
      if (this.isNode) return;
      let container = this.elements.toastContainer;
      if (!container) {
        container = document.createElement('div');
        container.id = 'toast-container';
        document.body.appendChild(container);
        this.elements.toastContainer = container;
      }

      const toast = document.createElement('div');
      toast.className = `hud-toast toast-${type}`;
      toast.innerText = message;
      container.appendChild(toast);

      // Trigger animation
      setTimeout(() => toast.classList.add('show'), 10);

      // Dismiss
      setTimeout(() => {
        toast.classList.remove('show');
        setTimeout(() => {
          if (toast.parentNode) toast.parentNode.removeChild(toast);
        }, 300);
      }, durationMs);
    }

    /**
     * Generates and downloads structured benchmark data JSON.
     */
    exportBenchmarkJson() {
      if (this.isNode || !this.app || !this.app.benchmark) return;
      const data = this.app.benchmark.exportBenchmarkData();
      const jsonStr = JSON.stringify(data, null, 2);

      const blob = new Blob([jsonStr], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `bengaluru_green_corridor_benchmark_${Date.now()}.json`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);

      this.showToast('Benchmark Analytics JSON Exported Successfully', 'success');
    }

    // ============================================================
    // Stage 7: AI Priority & Clearance Banner + Spawn Traffic
    // ============================================================

    /**
     * Updates the AI Priority & Clearance Banner with live data.
     * Called from Application.animate() when AI corridor is active.
     * @param {Object} data - Banner data from simulation
     */
    updateAIPriorityBanner(data) {
      if (this.isNode || !this.elements.aiPriorityBanner) return;

      const {
        isActive = false,
        nextSignalDistance = 0,
        nextSignalEta = 0,
        queueLength = 0,
        clearRate = 0,
        subtitle = 'Tier-2 Preemption Engaged — Signal Clearance In Progress'
      } = data || {};

      // Show/hide banner based on AI corridor active state
      if (isActive) {
        this.elements.aiPriorityBanner.classList.remove('hidden');
        this.elements.aiPriorityBanner.classList.add('visible');
      } else {
        this.elements.aiPriorityBanner.classList.remove('visible');
        this.elements.aiPriorityBanner.classList.add('hidden');
      }

      if (!isActive) return;

      // Update subtitle
      if (this.elements.bannerSubtitle) {
        this.elements.bannerSubtitle.textContent = subtitle;
      }

      // Update next signal distance
      if (this.elements.bannerNextSignal) {
        this.elements.bannerNextSignal.textContent = nextSignalDistance > 0
          ? `${Math.round(nextSignalDistance)} m`
          : '-- m';
      }

      // Update ETA
      if (this.elements.bannerEta) {
        this.elements.bannerEta.textContent = nextSignalEta > 0
          ? `${Math.round(nextSignalEta)} s`
          : '-- s';
      }

      // Update queue length
      if (this.elements.bannerQueueLength) {
        this.elements.bannerQueueLength.textContent = `${queueLength} veh`;
      }

      // Update clear rate
      if (this.elements.bannerClearRate) {
        const ratePct = Math.round(clearRate * 100);
        this.elements.bannerClearRate.textContent = `${ratePct}%`;
      }
    }

    /**
     * Shows/hides the Spawn Traffic Ahead button.
     * @param {boolean} show - Whether to show the button
     */
    setSpawnTrafficButtonVisible(show) {
      if (this.isNode || !this.elements.spawnTrafficBtn) return;

      if (show) {
        this.elements.spawnTrafficBtn.classList.remove('hidden');
      } else {
        this.elements.spawnTrafficBtn.classList.add('hidden');
      }
    }

    /**
     * Spawns civilian traffic ahead on the ambulance's active route.
     * Called when user clicks "Spawn Traffic Ahead" button.
     */
    spawnTrafficAhead() {
      if (this.isNode || !this.app || !this.app.sim || !this.app.sim.routingController) return;

      const routeEdges = this.app.sim.routingController.currentRouteEdges || [];
      if (routeEdges.length === 0) {
        this.showToast('No active route to spawn traffic on', 'warning');
        return;
      }

      // Delegate to Application's corridor pre-population method
      if (typeof this.app._prepopulateCorridorTraffic === 'function') {
        this.app._prepopulateCorridorTraffic(routeEdges);
        this.showToast('Civilian traffic queues spawned on corridor route', 'success');
      } else {
        this.showToast('Traffic spawning not available', 'error');
      }
    }

    /**
     * Returns required HUD container keys for automated test assertions (Test T1.4.4).
     */
    static getRequiredKeys() {
      return [...HUD_REQUIRED_KEYS];
    }

    // ============================================================
    // Stage 6: CameraDirector Bottom-Bar Preset Buttons
    // ============================================================

    initCameraPresetButtons() {
      if (this.isNode) return;

      const viewBtns = {
        silkBoard: document.getElementById('btn-view-silk-board'),
        majesticToVictoria: document.getElementById('btn-view-majestic-victoria'),
        fullCity: document.getElementById('btn-view-full-city'),
        chaseAmbulance: document.getElementById('btn-view-chase-ambulance'),
        dualAvsD: document.getElementById('btn-view-dual-ad')
      };

      const setActiveBtn = (activeKey) => {
        Object.entries(viewBtns).forEach(([k, btn]) => {
          if (btn) btn.classList.toggle('active', k === activeKey);
        });
      };

      const getDirector = () => (this.app && this.app.cameraDirector) || window.cameraDirectorInstance || null;

      if (viewBtns.silkBoard) {
        viewBtns.silkBoard.addEventListener('click', () => {
          setActiveBtn('silkBoard');
          const d = getDirector();
          if (d && typeof d.flyToSilkBoard === 'function') d.flyToSilkBoard();
        });
      }

      if (viewBtns.majesticToVictoria) {
        viewBtns.majesticToVictoria.addEventListener('click', () => {
          setActiveBtn('majesticToVictoria');
          const d = getDirector();
          if (d && typeof d.flyToMajesticToVictoria === 'function') d.flyToMajesticToVictoria();
        });
      }

      if (viewBtns.fullCity) {
        viewBtns.fullCity.addEventListener('click', () => {
          setActiveBtn('fullCity');
          const d = getDirector();
          if (d && typeof d.flyToFullCity === 'function') d.flyToFullCity();
        });
      }

      if (viewBtns.chaseAmbulance) {
        viewBtns.chaseAmbulance.addEventListener('click', () => {
          setActiveBtn('chaseAmbulance');
          const d = getDirector();
          if (d && typeof d.chaseAmbulance === 'function') d.chaseAmbulance();
        });
      }

      if (viewBtns.dualAvsD) {
        viewBtns.dualAvsD.addEventListener('click', () => {
          setActiveBtn('dualAvsD');
          const d = getDirector();
          if (d && typeof d.setDualMode === 'function') d.setDualMode('vs');
          // Open A vs D Comparison drawer cleanly in single-active-drawer mode
          if (this.elements && this.elements.panels && this.elements.panels['comparison-panel']) {
            if (this.activePanel && this.activePanel !== 'comparison-panel') {
              this.hidePanel(this.activePanel);
              const prevDock = document.querySelector(`.dock-btn[data-panel="${this.activePanel}"]`);
              if (prevDock) prevDock.classList.remove('active');
            }
            this.showPanel('comparison-panel');
            const cmpDock = document.querySelector('.dock-btn[data-panel="comparison-panel"]');
            if (cmpDock) cmpDock.classList.add('active');
          }
        });
      }
    }

    // ============================================================
    // Phase 5: Interactive Control Panels
    // ============================================================

    /**
     * Initializes all Phase 5 interactive control panels.
     * Called from Application after all subsystems are ready.
     */
    initPhase5Controls() {
      if (this.isNode) return;

      this.cachePhase5Elements();
      this.initPhase5EventListeners();
      this.populateEdgeSelect();
      this.startMinimapRenderLoop();
      this.startDecisionLogPolling();
      this.startSensorPanelUpdate();
      this.startComparisonPanelUpdate();
    }

    cachePhase5Elements() {
      // Minimap
      this.elements.minimapContainer = document.getElementById('minimap-container');
      this.elements.minimapCanvas = document.getElementById('minimap-canvas');
      this.elements.minimapCtx = this.elements.minimapCanvas ? this.elements.minimapCanvas.getContext('2d') : null;

      // Panel dock buttons
      this.elements.dockButtons = document.querySelectorAll('.dock-btn');
      this.elements.panels = {
        'minimap-container': document.getElementById('minimap-container'),
        'congestion-panel': document.getElementById('congestion-panel'),
        'decision-log-panel': document.getElementById('decision-log-panel'),
        'sensor-panel': document.getElementById('sensor-panel'),
        'comparison-panel': document.getElementById('comparison-panel'),
        'replay-panel': document.getElementById('replay-panel'),
        'export-panel': document.getElementById('export-panel')
      };

      // Congestion panel
      this.elements.congestionEdgeSelect = document.getElementById('congestion-edge-select');
      this.elements.congestionType = document.getElementById('congestion-type');
      this.elements.speedFactor = document.getElementById('speed-factor');
      this.elements.speedFactorValue = document.getElementById('speed-factor-value');
      this.elements.congestionDuration = document.getElementById('congestion-duration');
      this.elements.btnInjectCongestion = document.getElementById('btn-inject-congestion');
      this.elements.btnClearCongestion = document.getElementById('btn-clear-congestion');
      this.elements.activeCongestionList = document.getElementById('active-congestion-list');

      // Decision log panel
      this.elements.filterTier1 = document.getElementById('filter-tier1');
      this.elements.filterTier2 = document.getElementById('filter-tier2');
      this.elements.decisionLogEntries = document.getElementById('decision-log-entries');
      this.elements.logTier1Count = document.getElementById('log-tier1-count');
      this.elements.logTier2Count = document.getElementById('log-tier2-count');

      // Sensor panel - with explicit defaults for cone range (80m) and FOV (60°)
      this.elements.coneRange = document.getElementById('cone-range');
      this.elements.coneFov = document.getElementById('cone-fov');
      this.elements.coneTargets = document.getElementById('cone-targets');
      this.elements.yieldingCount = document.getElementById('yielding-count');
      this.elements.sensorTargetList = document.getElementById('sensor-target-list');
      this.elements.sensorConeCanvas = document.getElementById('sensor-cone-canvas');
      this.elements.sensorConeCtx = this.elements.sensorConeCanvas ? this.elements.sensorConeCanvas.getContext('2d') : null;

      // Comparison panel
      this.elements.comparisonScenarioSelect = document.getElementById('comparison-scenario-select');
      this.elements.comparisonResults = document.getElementById('comparison-results');
      this.elements.comparisonDeltas = document.getElementById('comparison-deltas');
      this.elements.cmpAOutcome = document.getElementById('cmp-a-outcome');
      this.elements.cmpATime = document.getElementById('cmp-a-time');
      this.elements.cmpARed = document.getElementById('cmp-a-red');
      this.elements.cmpAStops = document.getElementById('cmp-a-stops');
      this.elements.cmpASpeed = document.getElementById('cmp-a-speed');
      this.elements.cmpDOutcome = document.getElementById('cmp-d-outcome');
      this.elements.cmpDTime = document.getElementById('cmp-d-time');
      this.elements.cmpDRed = document.getElementById('cmp-d-red');
      this.elements.cmpDStops = document.getElementById('cmp-d-stops');
      this.elements.cmpDSpeed = document.getElementById('cmp-d-speed');
      this.elements.cmpDeltaTime = document.getElementById('cmp-delta-time');
      this.elements.cmpDeltaStops = document.getElementById('cmp-delta-stops');
      this.elements.cmpDeltaSpeed = document.getElementById('cmp-delta-speed');
      this.elements.btnRunComparison = document.getElementById('btn-run-comparison');
      this.elements.comparisonPlaceholder = document.getElementById('comparison-placeholder');

      // Replay panel
      this.elements.seedSlider = document.getElementById('seed-slider');
      this.elements.seedValue = document.getElementById('seed-value');
      this.elements.demandProfile = document.getElementById('demand-profile');
      this.elements.simSpeed = document.getElementById('sim-speed');
      this.elements.simSpeedValue = document.getElementById('sim-speed-value');
      this.elements.simDuration = document.getElementById('sim-duration');
      this.elements.btnResetSim = document.getElementById('btn-reset-sim');
      this.elements.btnPauseSim = document.getElementById('btn-pause-sim');
      this.elements.btnResumeSim = document.getElementById('btn-resume-sim');
      this.elements.btnStepSim = document.getElementById('btn-step-sim');

      // Export panel
      this.elements.btnExportJson = document.getElementById('btn-export-json');
      this.elements.btnExportCsv = document.getElementById('btn-export-csv');
      this.elements.btnExportConsole = document.getElementById('btn-export-console');
      this.elements.exportStatus = document.getElementById('export-status');
    }

    initPhase5EventListeners() {
      // Panel dock toggles - SINGLE ACTIVE DRAWER MODE
      this.elements.dockButtons.forEach(btn => {
        btn.addEventListener('click', () => {
          const panelId = btn.dataset.panel;
          this.togglePanel(panelId);
          btn.classList.toggle('active', this.isPanelVisible(panelId));
        });
      });

      // Panel close buttons
      document.querySelectorAll('.panel-close').forEach(btn => {
        btn.addEventListener('click', () => {
          const panelId = btn.dataset.target;
          this.hidePanel(panelId);
          const dockBtn = document.querySelector(`.dock-btn[data-panel="${panelId}"]`);
          if (dockBtn) dockBtn.classList.remove('active');
        });
      });

      // Congestion panel
      if (this.elements.speedFactor) {
        this.elements.speedFactor.addEventListener('input', (e) => {
          if (this.elements.speedFactorValue) {
            this.elements.speedFactorValue.textContent = parseFloat(e.target.value).toFixed(1);
          }
        });
      }

      if (this.elements.congestionType) {
        this.elements.congestionType.addEventListener('change', (e) => {
          const speedFactorRow = document.getElementById('speed-factor-row');
          if (speedFactorRow) {
            speedFactorRow.style.display = e.target.value === 'incident' ? 'flex' : 'none';
          }
        });
      }

      if (this.elements.btnInjectCongestion) {
        this.elements.btnInjectCongestion.addEventListener('click', () => this.injectCongestion());
      }

      if (this.elements.btnClearCongestion) {
        this.elements.btnClearCongestion.addEventListener('click', () => this.clearAllCongestion());
      }

      // Decision log filters
      if (this.elements.filterTier1) {
        this.elements.filterTier1.addEventListener('change', () => this.renderDecisionLog());
      }
      if (this.elements.filterTier2) {
        this.elements.filterTier2.addEventListener('change', () => this.renderDecisionLog());
      }

      // Comparison panel
      if (this.elements.btnRunComparison) {
        this.elements.btnRunComparison.addEventListener('click', () => this.runComparisonExperiment());
      }

      // Replay panel
      if (this.elements.seedSlider) {
        this.elements.seedSlider.addEventListener('input', (e) => {
          if (this.elements.seedValue) {
            this.elements.seedValue.textContent = e.target.value;
          }
        });
      }

      if (this.elements.simSpeed) {
        this.elements.simSpeed.addEventListener('input', (e) => {
          if (this.elements.simSpeedValue) {
            this.elements.simSpeedValue.textContent = `${parseFloat(e.target.value).toFixed(1)}x`;
          }
          if (this.app && this.app.sim) {
            this.app.sim.setTimeScale(parseFloat(e.target.value));
          }
        });
      }

      if (this.elements.btnResetSim) {
        this.elements.btnResetSim.addEventListener('click', () => this.resetSimulation());
      }

      if (this.elements.btnPauseSim) {
        this.elements.btnPauseSim.addEventListener('click', () => this.pauseSimulation());
      }

      if (this.elements.btnResumeSim) {
        this.elements.btnResumeSim.addEventListener('click', () => this.resumeSimulation());
      }

      if (this.elements.btnStepSim) {
        this.elements.btnStepSim.addEventListener('click', () => this.stepSimulation());
      }

      // Export panel
      if (this.elements.btnExportJson) {
        this.elements.btnExportJson.addEventListener('click', () => this.exportExperiment('json'));
      }

      if (this.elements.btnExportCsv) {
        this.elements.btnExportCsv.addEventListener('click', () => this.exportExperiment('csv'));
      }

      if (this.elements.btnExportConsole) {
        this.elements.btnExportConsole.addEventListener('click', () => this.exportExperiment('console'));
      }

      // Keyboard shortcuts for panels
      const panelKeys = {
        'KeyM': 'minimap-container',
        'KeyC': 'congestion-panel',
        'KeyL': 'decision-log-panel',
        'KeyV': 'sensor-panel',
        'KeyD': 'comparison-panel',
        'KeyP': 'replay-panel',
        'KeyE': 'export-panel'
      };

      window.addEventListener('keydown', (e) => {
        if (e.target && (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA' || e.target.tagName === 'SELECT')) return;
        const panelId = panelKeys[e.code];
        if (panelId) {
          e.preventDefault();
          this.togglePanel(panelId);
          const dockBtn = document.querySelector(`.dock-btn[data-panel="${panelId}"]`);
          if (dockBtn) dockBtn.classList.toggle('active', this.isPanelVisible(panelId));
        }
      });
    }

    // ============================================================
    // Panel Management - SINGLE ACTIVE DRAWER MODE
    // ============================================================

    togglePanel(panelId) {
      const panel = this.elements.panels[panelId];
      if (!panel) return;
      
      // Single active drawer mode: close any other open panel
      if (this.activePanel && this.activePanel !== panelId) {
        this.hidePanel(this.activePanel);
        const otherBtn = document.querySelector(`.dock-btn[data-panel="${this.activePanel}"]`);
        if (otherBtn) otherBtn.classList.remove('active');
      }
      
      if (panel.classList.contains('visible')) {
        this.hidePanel(panelId);
      } else {
        this.showPanel(panelId);
      }
    }

    showPanel(panelId) {
      const panel = this.elements.panels[panelId];
      if (panel) {
        panel.classList.add('visible');
        this.activePanel = panelId;
      }
    }

    hidePanel(panelId) {
      const panel = this.elements.panels[panelId];
      if (panel) {
        panel.classList.remove('visible');
        if (this.activePanel === panelId) {
          this.activePanel = null;
        }
      }
    }

    isPanelVisible(panelId) {
      const panel = this.elements.panels[panelId];
      return panel ? panel.classList.contains('visible') : false;
    }

    // ============================================================
    // Minimap
    // ============================================================

    startMinimapRenderLoop() {
      if (!this.elements.minimapCtx || !this.app) return;
      const render = () => {
        this.renderMinimap();
        requestAnimationFrame(render);
      };
      requestAnimationFrame(render);
    }

    renderMinimap() {
      const ctx = this.elements.minimapCtx;
      const canvas = this.elements.minimapCanvas;
      if (!ctx || !canvas || !this.app) return;

      // Clear canvas
      ctx.clearRect(0, 0, canvas.width, canvas.height);

      const proj = this.app.projection;
      const networkData = this.app.networkData || window.NETWORK_DATA;
      const bounds = proj ? proj.getNetworkBounds(networkData) : null;
      if (!bounds) return;

      // Compute transform: world -> canvas with 10% padding
      const paddingRatio = 0.10;
      const paddingX = canvas.width * paddingRatio;
      const paddingY = canvas.height * paddingRatio;
      const drawWidth = canvas.width - 2 * paddingX;
      const drawHeight = canvas.height - 2 * paddingY;
      
      const scaleX = drawWidth / bounds.spanX;
      const scaleZ = drawHeight / bounds.spanZ;
      const scale = Math.min(scaleX, scaleZ);
      
      // Center the bounds in the canvas
      const offsetX = paddingX + (drawWidth - bounds.spanX * scale) / 2 - bounds.minX * scale;
      const offsetY = paddingY + (drawHeight - bounds.spanZ * scale) / 2 - bounds.minZ * scale;

      const worldToCanvas = (x, z) => ({
        x: x * scale + offsetX,
        y: canvas.height - (z * scale + offsetY)
      });

      // Draw roads (dark charcoal #334155)
      if (networkData && networkData.edges) {
        ctx.strokeStyle = '#334155';
        ctx.lineWidth = 2;
        networkData.edges.forEach(edge => {
          if (!edge.polyline || edge.polyline.length < 2) return;
          ctx.beginPath();
          edge.polyline.forEach((pt, i) => {
            const w = proj.latLonAltToCartesian(pt[1], pt[0], pt[2] || 920);
            const pos = worldToCanvas(w.x, w.z);
            if (i === 0) ctx.moveTo(pos.x, pos.y);
            else ctx.lineTo(pos.x, pos.y);
          });
          ctx.stroke();
        });
      }

      // Draw signals
      if (this.app.signalManager && this.app.signalManager.getAllSignals) {
        const signals = this.app.signalManager.getAllSignals();
        signals.forEach(sig => {
          const wp = sig.worldPos;
          if (!wp) return;
          const pos = worldToCanvas(wp.x, wp.z);
          const isPreempted = sig.isPreempted || sig.currentPhase === 'PREEMPT_GREEN';
          ctx.fillStyle = isPreempted ? '#22d3ee' : (sig.currentPhase === 'GREEN' ? '#10b981' : '#ef4444');
          ctx.beginPath();
          ctx.arc(pos.x, pos.y, 4, 0, Math.PI * 2);
          ctx.fill();
        });
      }

      // Draw ambulance route (green line)
      if (this.app.ambulance && this.app.ambulance.currentRoute) {
        const route = this.app.ambulance.currentRoute;
        if (route && route.length >= 1) {
          ctx.strokeStyle = '#10b981';
          ctx.lineWidth = 3;
          ctx.setLineDash([8, 4]);
          ctx.beginPath();
          let started = false;
          route.forEach((edgeId) => {
            const edge = networkData.edges.find(e => e.id === edgeId);
            if (edge && edge.polyline && edge.polyline.length > 0) {
              edge.polyline.forEach(pt => {
                const w = proj.latLonAltToCartesian(pt[1], pt[0], pt[2] || 920);
                const pos = worldToCanvas(w.x, w.z);
                if (!started) { ctx.moveTo(pos.x, pos.y); started = true; }
                else ctx.lineTo(pos.x, pos.y);
              });
            }
          });
          ctx.stroke();
          ctx.setLineDash([]);
        }
      }

      // Draw congestion (red edges)
      if (this.app.sim && this.app.sim.lastCongestionMap) {
        const congestionMap = this.app.sim.lastCongestionMap;
        Object.entries(congestionMap).forEach(([edgeId, data]) => {
          if (data.travelTimeSec > 30) {
            const edge = networkData.edges.find(e => e.id === edgeId);
            if (edge && edge.polyline && edge.polyline.length > 1) {
              ctx.strokeStyle = '#ef4444';
              ctx.lineWidth = 4;
              ctx.globalAlpha = 0.7;
              ctx.beginPath();
              edge.polyline.forEach((pt, i) => {
                const w = proj.latLonAltToCartesian(pt[1], pt[0], pt[2] || 920);
                const pos = worldToCanvas(w.x, w.z);
                if (i === 0) ctx.moveTo(pos.x, pos.y);
                else ctx.lineTo(pos.x, pos.y);
              });
              ctx.stroke();
              ctx.globalAlpha = 1.0;
            }
          }
        });
      }

      // Draw ambulance position
      if (this.app.ambulance && this.app.ambulance.position) {
        const pos = this.app.ambulance.position;
        const canvasPos = worldToCanvas(pos.x, pos.z);
        const heading = this.app.ambulance.headingRad || 0;
        ctx.save();
        ctx.translate(canvasPos.x, canvasPos.y);
        ctx.rotate(heading);
        ctx.fillStyle = '#ffffff';
        ctx.beginPath();
        ctx.moveTo(0, -8);
        ctx.lineTo(6, 6);
        ctx.lineTo(-6, 6);
        ctx.closePath();
        ctx.fill();
        ctx.fillStyle = '#38bdf8';
        ctx.beginPath();
        ctx.arc(0, 0, 3, 0, Math.PI * 2);
        ctx.fill();
        ctx.restore();
      }

      // Draw hospital markers
      if (networkData && networkData.hospitals) {
        networkData.hospitals.forEach(hosp => {
          const p = hosp.bays && hosp.bays.bay_a && hosp.bays.bay_a.position;
          if (!p) return;
          const w = proj.latLonAltToCartesian(p.lat, p.lon, p.alt || 920);
          const pos = worldToCanvas(w.x, w.z);
          ctx.fillStyle = '#ef4444';
          ctx.beginPath();
          ctx.arc(pos.x, pos.y, 5, 0, Math.PI * 2);
          ctx.fill();
          ctx.strokeStyle = '#fff';
          ctx.lineWidth = 1.5;
          ctx.beginPath();
          ctx.moveTo(pos.x, pos.y - 3);
          ctx.lineTo(pos.x, pos.y + 3);
          ctx.moveTo(pos.x - 3, pos.y);
          ctx.lineTo(pos.x + 3, pos.y);
          ctx.stroke();
        });
      }
    }

    populateEdgeSelect() {
      const select = this.elements.congestionEdgeSelect;
      if (!select || !this.app) return;
      const networkData = this.app.networkData || window.NETWORK_DATA;
      if (!networkData || !networkData.edges) return;

      // Clear existing options except first
      while (select.options.length > 1) {
        select.remove(1);
      }

      networkData.edges.forEach(edge => {
        const option = document.createElement('option');
        option.value = edge.id;
        const from = edge.from || edge.source;
        const to = edge.to || edge.target;
        option.textContent = `${edge.id} (${from} → ${to}, ${(edge.length || 0).toFixed(0)}m)`;
        select.appendChild(option);
      });
    }

    // ============================================================
    // Congestion Injection
    // ============================================================

    injectCongestion() {
      if (!this.app || !this.app.sim) return;
      const edgeId = this.elements.congestionEdgeSelect.value;
      const type = this.elements.congestionType.value;
      const duration = parseFloat(this.elements.congestionDuration.value) || 60;
      const speedFactor = parseFloat(this.elements.speedFactor.value) || 0.3;

      if (!edgeId) {
        this.showToast('Please select an edge for congestion injection', 'warning');
        return;
      }

      this.app.sim.injectCongestion(edgeId, type, duration, speedFactor);
      this.showToast(`Congestion injected on ${edgeId} (${type}, ${duration}s)`, 'success');
      this.renderActiveCongestionList();
    }

    clearAllCongestion() {
      if (!this.app || !this.app.sim) return;
      this.app.sim.clearAllCongestion();
      this.showToast('All congestion cleared', 'info');
      this.renderActiveCongestionList();
    }

    renderActiveCongestionList() {
      const list = this.elements.activeCongestionList;
      if (!list || !this.app || !this.app.sim) return;

      const congestionMap = this.app.sim.activeCongestion || {};
      list.innerHTML = '';

      Object.entries(congestionMap).forEach(([edgeId, data]) => {
        const item = document.createElement('div');
        item.className = 'congestion-item';
        item.innerHTML = `
          <div class="congestion-item-info">
            <span class="congestion-item-edge">${edgeId}</span>
            <span class="congestion-item-type">${data.type} - ${data.remainingSec.toFixed(0)}s remaining</span>
          </div>
          <button class="congestion-item-remove" data-edge="${edgeId}">×</button>
        `;
        list.appendChild(item);
      });

      // Add remove handlers
      list.querySelectorAll('.congestion-item-remove').forEach(btn => {
        btn.addEventListener('click', (e) => {
          const edgeId = e.target.dataset.edge;
          if (this.app && this.app.sim) {
            this.app.sim.removeCongestion(edgeId);
            this.renderActiveCongestionList();
          }
        });
      });
    }

    // ============================================================
    // AI Decision Log
    // ============================================================

    startDecisionLogPolling() {
      // Poll every 500ms for new decisions
      setInterval(() => this.renderDecisionLog(), 500);
    }

    renderDecisionLog() {
      const entries = this.elements.decisionLogEntries;
      const tier1Count = this.elements.logTier1Count;
      const tier2Count = this.elements.logTier2Count;
      if (!entries || !this.app || !this.app.sim) return;

      const log = this.app.sim.decisionLog || [];
      const showTier1 = this.elements.filterTier1?.checked !== false;
      const showTier2 = this.elements.filterTier2?.checked !== false;

      let tier1 = 0, tier2 = 0;
      entries.innerHTML = '';

      const isTier1 = (t) => t === 1 || t === 'TIER1_REROUTE' || t === 'Tier-1';
      const isTier2 = (t) => t === 2 || t === 'TIER2_PRIORITY' || t === 'Tier-2';

      log.forEach(entry => {
        if (isTier1(entry.tier)) tier1++;
        else if (isTier2(entry.tier)) tier2++;
      });

      const filtered = log
        .filter(entry => (isTier1(entry.tier) && showTier1) || (isTier2(entry.tier) && showTier2) || (!isTier1(entry.tier) && !isTier2(entry.tier)))
        .slice(-50)
        .reverse();

      filtered.forEach(entry => {
        const t2 = isTier2(entry.tier);
        const div = document.createElement('div');
        div.className = `log-entry ${t2 ? 'tier2' : ''}`;
        const timeStr = typeof entry.timestamp === 'number' && entry.timestamp < 1e9
          ? `t=${entry.timestamp.toFixed(1)}s`
          : new Date(entry.timestamp).toLocaleTimeString();
        const msg = entry.reason || entry.message || `${entry.fromEdge || ''} → ${entry.toEdge || ''}`;
        div.innerHTML = `
          <div class="log-entry-header">
            <span class="log-entry-tier">${entry.tier}</span>
            <span class="log-entry-time">${timeStr}</span>
          </div>
          <div class="log-entry-message">${msg}</div>
          ${entry.predictedSavingSec ? `<div class="log-entry-details">Saving: ${Number(entry.predictedSavingSec).toFixed(1)}s</div>` : ''}
        `;
        entries.appendChild(div);
      });

      if (tier1Count) tier1Count.textContent = `Tier-1: ${tier1}`;
      if (tier2Count) tier2Count.textContent = `Tier-2: ${tier2}`;
    }

    // ============================================================
    // Virtual Sensor Panel
    // ============================================================

    startSensorPanelUpdate() {
      setInterval(() => this.updateSensorPanel(), 200);
    }

    updateSensorPanel() {
      if (!this.app || !this.app.ambulance) return;

      const amb = this.app.ambulance;
      const cone = amb.getClearanceCone ? amb.getClearanceCone() : null;
      
      // EXPLICIT DEFAULTS: 80m range, 60° FOV — never undefined
      const maxRange = (cone && cone.maxRange) ? cone.maxRange : 80;
      const fovDegrees = (cone && cone.fovDegrees) ? cone.fovDegrees : 60;

      // Update metrics with explicit values
      if (this.elements.coneRange) this.elements.coneRange.textContent = `${maxRange}m`;
      if (this.elements.coneFov) this.elements.coneFov.textContent = `${fovDegrees}°`;

      // Get targets in cone from simulation
      let targetsInCone = 0;
      let yieldingCount = 0;
      let targetDetails = [];

      if (this.app.sim && this.app.sim.vehicles && this.app.projection) {
        const ambPos = amb.position;
        const ambHeading = amb.headingRad || 0;
        if (ambPos) {
          for (const veh of this.app.sim.vehicles.values()) {
            if (!veh || (veh.cls && veh.cls.isEmergency) || !veh.edge) continue;
            const sample = veh.edge.sampleAt(veh.s);
            const vehPos = this.app.projection.latLonAltToCartesian(sample.lat, sample.lon, sample.alt || 920);
            const dx = vehPos.x - ambPos.x;
            const dz = vehPos.z - ambPos.z;
            const dist = Math.hypot(dx, dz);

            if (dist <= maxRange) {
              const angleToVeh = Math.atan2(dx, -dz);
              let angleDiff = angleToVeh - ambHeading;
              while (angleDiff > Math.PI) angleDiff -= 2 * Math.PI;
              while (angleDiff < -Math.PI) angleDiff += 2 * Math.PI;
              const halfFov = (fovDegrees * Math.PI / 180) / 2;

              if (Math.abs(angleDiff) <= halfFov) {
                targetsInCone++;
                const isYielding = veh.v < 3.0;
                if (isYielding) yieldingCount++;
                targetDetails.push({
                  id: veh.id,
                  dist,
                  angle: angleDiff,
                  yielding: isYielding,
                  speed: veh.v || 0
                });
              }
            }
          }
        }
      }

      if (this.elements.coneTargets) this.elements.coneTargets.textContent = targetsInCone;
      if (this.elements.yieldingCount) this.elements.yieldingCount.textContent = yieldingCount;

      // Render target list
      this.renderSensorTargetList(targetDetails);

      // Render cone visualization
      this.renderSensorConeVisualization({ maxRange, fovDegrees }, targetDetails);
    }

    renderSensorTargetList(targets) {
      const list = this.elements.sensorTargetList;
      if (!list) return;

      list.innerHTML = '';
      targets.slice(0, 10).forEach(t => {
        const item = document.createElement('div');
        item.className = `target-item ${t.yielding ? 'yielding' : ''}`;
        item.innerHTML = `
          <div class="target-info">
            <span class="target-id">${t.id}</span>
            <span class="target-dist">${t.dist.toFixed(1)}m @ ${(t.angle * 180 / Math.PI).toFixed(0)}°</span>
          </div>
          <span class="target-status ${t.yielding ? 'yielding' : 'normal'}">${t.yielding ? 'YIELDING' : 'NORMAL'}</span>
        `;
        list.appendChild(item);
      });
    }

    renderSensorConeVisualization(cone, targets) {
      const canvas = this.elements.sensorConeCanvas;
      const ctx = this.elements.sensorConeCtx;
      if (!canvas || !ctx) return;

      const w = canvas.width;
      const h = canvas.height;
      const cx = w / 2;
      const cy = h - 20; // Bottom center

      ctx.clearRect(0, 0, w, h);

      // Draw cone background
      const halfFov = (cone.fovDegrees * Math.PI / 180) / 2;
      const maxRange = cone.maxRange;
      const scale = (h - 30) / maxRange;

      ctx.fillStyle = 'rgba(16, 185, 129, 0.1)';
      ctx.beginPath();
      ctx.moveTo(cx, cy);
      ctx.lineTo(cx - Math.sin(-halfFov) * maxRange * scale, cy - Math.cos(-halfFov) * maxRange * scale);
      ctx.arc(cx, cy, maxRange * scale, -halfFov - Math.PI / 2, halfFov - Math.PI / 2);
      ctx.closePath();
      ctx.fill();

      // Draw cone outline
      ctx.strokeStyle = '#10b981';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(cx, cy);
      ctx.lineTo(cx - Math.sin(-halfFov) * maxRange * scale, cy - Math.cos(-halfFov) * maxRange * scale);
      ctx.arc(cx, cy, maxRange * scale, -halfFov - Math.PI / 2, halfFov - Math.PI / 2);
      ctx.closePath();
      ctx.stroke();

      // Draw range rings
      ctx.strokeStyle = 'rgba(16, 185, 129, 0.2)';
      ctx.lineWidth = 1;
      for (let r = 20; r <= maxRange; r += 20) {
        ctx.beginPath();
        ctx.arc(cx, cy, r * scale, -halfFov - Math.PI / 2, halfFov - Math.PI / 2);
        ctx.stroke();
      }

      // Draw ambulance at apex
      ctx.fillStyle = '#38bdf8';
      ctx.beginPath();
      ctx.arc(cx, cy, 6, 0, Math.PI * 2);
      ctx.fill();

      // Draw target vehicles
      targets.forEach(t => {
        const angle = t.angle;
        const dist = Math.min(t.dist, maxRange);
        const x = cx + Math.sin(angle) * dist * scale;
        const y = cy - Math.cos(angle) * dist * scale;

        ctx.fillStyle = t.yielding ? '#10b981' : '#f59e0b';
        ctx.beginPath();
        ctx.arc(x, y, 4, 0, Math.PI * 2);
        ctx.fill();

        // Speed indicator
        ctx.fillStyle = '#fff';
        ctx.font = '8px monospace';
        ctx.textAlign = 'center';
        ctx.fillText(`${(t.speed * 3.6).toFixed(0)}`, x, y - 8);
      });

      // Labels - always show explicit values
      ctx.fillStyle = '#94a3b8';
      ctx.font = '9px monospace';
      ctx.textAlign = 'center';
      ctx.fillText(`${maxRange}m`, cx, 15);
      ctx.fillText(`${cone.fovDegrees}° FOV`, cx, 28);
    }

    // ============================================================
    // Dual Ambulance A vs D Comparison
    // ============================================================

    startComparisonPanelUpdate() {
      setInterval(() => this.updateComparisonPanel(), 1000);
    }

    updateComparisonPanel() {
      if (!this.app || !this.app.sim) return;

      const hasExperimentRun = this.lastExperimentResult !== undefined;

      if (this.elements.comparisonPlaceholder) {
        this.elements.comparisonPlaceholder.style.display = hasExperimentRun ? 'none' : 'block';
      }
      if (this.elements.comparisonResults) {
        this.elements.comparisonResults.style.display = hasExperimentRun ? 'grid' : 'none';
      }
      if (this.elements.comparisonDeltas) {
        this.elements.comparisonDeltas.style.display = hasExperimentRun ? 'block' : 'none';
      }

      if (!hasExperimentRun) {
        return;
      }

      const result = this.lastExperimentResult;
      if (!result || !result.modes) return;

      const modeA = result.modes.A;
      const modeD = result.modes.D;

      const computeAvgSpeedKmh = (m) => {
        const sec = m.arrived && m.travelTimeSec > 0 ? m.travelTimeSec : m.finalTimeSec;
        if (!sec || sec <= 0 || !m.distanceTravelledM) return 0;
        return (m.distanceTravelledM / 1000) / (sec / 3600);
      };

      if (modeA) {
        if (this.elements.cmpAOutcome) this.elements.cmpAOutcome.textContent = modeA.outcome;
        if (this.elements.cmpATime) {
          this.elements.cmpATime.textContent = modeA.arrived
            ? `${this.formatTime(modeA.travelTimeSec)} (${modeA.travelTimeSec.toFixed(1)}s)`
            : `DNF (${modeA.finalTimeSec.toFixed(0)}s)`;
        }
        if (this.elements.cmpARed) this.elements.cmpARed.textContent = `${(modeA.redLightWaitSec ?? 0).toFixed(1)}s`;
        if (this.elements.cmpAStops) this.elements.cmpAStops.textContent = `${(modeA.stoppedTimeSec ?? 0).toFixed(1)}s / ${modeA.rerouteCount || 0} reroutes`;
        if (this.elements.cmpASpeed) this.elements.cmpASpeed.textContent = `${computeAvgSpeedKmh(modeA).toFixed(1)} km/h`;
      }

      if (modeD) {
        if (this.elements.cmpDOutcome) this.elements.cmpDOutcome.textContent = modeD.outcome;
        if (this.elements.cmpDTime) {
          this.elements.cmpDTime.textContent = modeD.arrived
            ? `${this.formatTime(modeD.travelTimeSec)} (${modeD.travelTimeSec.toFixed(1)}s)`
            : `DNF (${modeD.finalTimeSec.toFixed(0)}s)`;
        }
        if (this.elements.cmpDRed) this.elements.cmpDRed.textContent = `${(modeD.redLightWaitSec ?? 0).toFixed(1)}s`;
        if (this.elements.cmpDStops) this.elements.cmpDStops.textContent = `${(modeD.stoppedTimeSec ?? 0).toFixed(1)}s / ${modeD.rerouteCount || 0} reroutes`;
        if (this.elements.cmpDSpeed) this.elements.cmpDSpeed.textContent = `${computeAvgSpeedKmh(modeD).toFixed(1)} km/h`;
      }

      if (modeA && modeD) {
        const speedA = computeAvgSpeedKmh(modeA);
        const speedD = computeAvgSpeedKmh(modeD);
        const speedGain = speedD - speedA;
        const stoppedSaved = (modeA.stoppedTimeSec ?? 0) - (modeD.stoppedTimeSec ?? 0);

        if (this.elements.cmpDeltaTime) {
          if (modeA.arrived && modeD.arrived) {
            const savedSec = modeA.travelTimeSec - modeD.travelTimeSec;
            this.elements.cmpDeltaTime.textContent = `${savedSec >= 0 ? '+' : ''}${savedSec.toFixed(1)}s (${savedSec >= 0 ? 'faster' : 'slower'})`;
          } else if (!modeA.arrived && modeD.arrived) {
            this.elements.cmpDeltaTime.textContent = `A=DNF → D=${modeD.travelTimeSec.toFixed(1)}s`;
          } else {
            this.elements.cmpDeltaTime.textContent = `${modeA.outcome} vs ${modeD.outcome}`;
          }
        }
        if (this.elements.cmpDeltaStops) {
          this.elements.cmpDeltaStops.textContent = `${stoppedSaved >= 0 ? '-' : '+'}${Math.abs(stoppedSaved).toFixed(1)}s wait | ${modeD.signalInterventions || 0} overrides`;
        }
        if (this.elements.cmpDeltaSpeed) {
          this.elements.cmpDeltaSpeed.textContent = `${speedGain >= 0 ? '+' : ''}${speedGain.toFixed(1)} km/h`;
        }
      }
    }

    async runComparisonExperiment() {
      if (!this.app || !this.app.sim) return;

      this.showToast('Running A/B/C/D Experiment...', 'info');
      this.elements.btnRunComparison.disabled = true;
      this.elements.btnRunComparison.textContent = 'Running...';

      try {
        if (window.ExperimentHarness && typeof window.ExperimentHarness.runComparison === 'function') {
          const scenarioKey = this.elements.comparisonScenarioSelect
            ? this.elements.comparisonScenarioSelect.value
            : 'severe_congestion_avenue_road';

          const seed = parseInt(this.elements.seedSlider?.value, 10) || 42;
          const demandProfile = this.elements.demandProfile?.value || 'peak';
          const durationSec = Math.max(900, parseInt(this.elements.simDuration?.value, 10) || 900);

          const SCENARIOS = {
            severe_congestion_avenue_road: {
              name: 'severe_congestion_avenue_road',
              origin: 'node_majestic',
              destinationHospital: 'hosp_victoria_01',
              durationSec,
              seed,
              demandProfile,
              congestionEvents: [{ edgeId: 'edge_avenue_01_fwd', atSec: 30, speedFactor: 0.1 }]
            },
            blocked_primary_corridor: {
              name: 'blocked_primary_corridor',
              origin: 'node_majestic',
              destinationHospital: 'hosp_victoria_01',
              durationSec,
              seed,
              demandProfile,
              congestionEvents: [{ edgeId: 'edge_avenue_01_fwd', atSec: 30, blocked: true }]
            },
            peak_signalised_corridor: {
              name: 'peak_signalised_corridor',
              origin: 'node_majestic',
              destinationHospital: 'hosp_victoria_01',
              durationSec,
              seed,
              demandProfile,
              congestionEvents: []
            },
            mild_congestion_below_threshold: {
              name: 'mild_congestion_below_threshold',
              origin: 'node_majestic',
              destinationHospital: 'hosp_victoria_01',
              durationSec,
              seed,
              demandProfile,
              congestionEvents: [{ edgeId: 'edge_avenue_01_fwd', atSec: 30, speedFactor: 0.5 }]
            }
          };

          const scenario = SCENARIOS[scenarioKey] || SCENARIOS.severe_congestion_avenue_road;
          const overrides = {
            CONFIG: (typeof CONFIG !== 'undefined') ? CONFIG : window.CONFIG,
            NETWORK: (typeof NETWORK_DATA !== 'undefined') ? NETWORK_DATA : window.NETWORK_DATA,
            SIGNALS: (typeof SIGNALS_DATA !== 'undefined') ? SIGNALS_DATA : window.SIGNALS_DATA
          };
          const result = window.ExperimentHarness.runComparison(scenario, overrides);

          this.lastExperimentResult = result;
          this.showToast('Experiment Complete — Real A/B/C/D Metrics Loaded', 'success');

          if (this.elements.exportStatus) {
            this.elements.exportStatus.textContent = `Experiment (${scenario.name}) completed at ${new Date().toLocaleTimeString()}.`;
          }

          this.updateComparisonPanel();
        } else {
          this.showToast('Experiment module not available', 'error');
        }
      } catch (e) {
        console.error('Experiment failed:', e);
        this.showToast(`Experiment failed: ${e.message}`, 'error');
      } finally {
        this.elements.btnRunComparison.disabled = false;
        this.elements.btnRunComparison.textContent = 'Run A/B/C/D Experiment';
      }
    }

    // ============================================================
    // Replay / Seed / Mode Controls
    // ============================================================

    resetSimulation() {
      if (!this.app) return;
      
      const seed = parseInt(this.elements.seedSlider.value) || 42;
      const demandProfile = this.elements.demandProfile.value || 'peak';
      const duration = parseInt(this.elements.simDuration.value) || 600;

      // Re-initialize simulation with new seed
      if (this.app.initSimulation) {
        this.app.initSimulation(seed, demandProfile, duration);
      }

      // Reset benchmark
      if (this.app.benchmark) {
        this.app.benchmark = new window.BenchmarkEngine({ isAiCorridorActive: this.app.aiCorridorActive });
        window.benchmarkInstance = this.app.benchmark;
      }

      // Reset experiment result
      this.lastExperimentResult = undefined;

      // Reset UI
      this.updateCorridorToggleUI(this.app.aiCorridorActive);
      
      this.showToast(`Simulation reset (seed: ${seed}, profile: ${demandProfile})`, 'success');
    }

    pauseSimulation() {
      if (this.app && this.app.sim) {
        this.app.sim.paused = true;
        this.showToast('Simulation paused', 'info');
      }
    }

    resumeSimulation() {
      if (this.app && this.app.sim) {
        this.app.sim.paused = false;
        this.showToast('Simulation resumed', 'success');
      }
    }

    stepSimulation() {
      if (this.app && this.app.sim) {
        if (typeof this.app.sim.stepFrame === 'function') {
          this.app.sim.stepFrame(0.1); // Step 0.1s
        } else {
          const wasPaused = this.app.sim.paused;
          this.app.sim.paused = true;
          this.app.sim.step(0.1); // Step 0.1s
          this.showToast('Stepped 0.1s', 'info');
          if (!wasPaused) this.app.sim.paused = false;
          return;
        }
        this.showToast('Stepped 0.1s', 'info');
      }
    }

    // ============================================================
    // Experiment Export
    // ============================================================

    exportExperiment(format) {
      if (!this.lastExperimentResult) {
        this.showToast('No experiment results to export. Run experiment first.', 'warning');
        return;
      }

      const ExperimentHarness = window.ExperimentHarness;
      if (!ExperimentHarness) {
        this.showToast('Experiment module not available', 'error');
        return;
      }

      try {
        let output;
        if (format === 'json') {
          output = ExperimentHarness.toJSON(this.lastExperimentResult);
          this.downloadFile(output, `experiment_${Date.now()}.json`, 'application/json');
        } else if (format === 'csv') {
          output = ExperimentHarness.toCSV(this.lastExperimentResult);
          this.downloadFile(output, `experiment_${Date.now()}.csv`, 'text/csv');
        } else if (format === 'console') {
          console.log('=== EXPERIMENT RESULTS (JSON) ===');
          console.log(ExperimentHarness.toJSON(this.lastExperimentResult));
          console.log('=== EXPERIMENT RESULTS (CSV) ===');
          console.log(ExperimentHarness.toCSV(this.lastExperimentResult));
          this.showToast('Results printed to browser console (F12)', 'info');
          return;
        }

        this.showToast(`Experiment exported as ${format.toUpperCase()}`, 'success');
        if (this.elements.exportStatus) {
          this.elements.exportStatus.textContent = `Exported ${format.toUpperCase()} at ${new Date().toLocaleTimeString()}`;
        }
      } catch (e) {
        console.error('Export failed:', e);
        this.showToast(`Export failed: ${e.message}`, 'error');
      }
    }

    downloadFile(content, filename, mimeType) {
      const blob = new Blob([content], { type: mimeType });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    }

    // ============================================================
    // Helper: Format time
    // ============================================================

    formatTime(seconds) {
      if (seconds === null || seconds === undefined || isNaN(seconds)) return '--:--';
      const mins = Math.floor(seconds / 60);
      const secs = Math.floor(seconds % 60);
      return `${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
    }
  } // End of UIManager class

  UIManager.REQUIRED_KEYS = HUD_REQUIRED_KEYS;
  return UIManager;
}));