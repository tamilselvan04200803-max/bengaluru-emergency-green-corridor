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
      this.elements.goldenHourOdds = document.getElementById('golden-hour-odds');
      this.elements.goldenHourProgress = document.getElementById('golden-hour-progress');
      this.elements.haltsAvoidedCount = document.getElementById('halts-avoided-count');
      this.elements.speedBoostDisplay = document.getElementById('speed-boost-display');
      this.elements.baselineHaltsCount = document.getElementById('baseline-halts-count');
      this.elements.baselineAvgSpeed = document.getElementById('baseline-avg-speed');
      this.elements.aiHaltsCount = document.getElementById('ai-halts-count');
      this.elements.aiAvgSpeed = document.getElementById('ai-avg-speed');
      this.elements.toastContainer = document.getElementById('toast-container');
      this.elements.speedDialFill = document.getElementById('speed-dial-fill');
      this.elements.speedometerValue = document.getElementById('speedometer-value');
      this.elements.telemetryBadge = document.getElementById('telemetry-badge');
      this.elements.btnExportBenchmark = document.getElementById('btn-export-benchmark');
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
      const metrics = benchmark ? benchmark.getMetrics() : null;
      const ambulance = (this.app && this.app.ambulance) ? this.app.ambulance : null;
      const speedKmh = (ambulance && typeof ambulance.getSpeedKmh === 'function') ? ambulance.getSpeedKmh() : (metrics ? metrics.currentSpeedKmh : 0.0);

      this.renderMetrics(metrics, speedKmh);
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

      // 3. Central Impact Metrics
      if (this.elements.minutesSavedCounter) {
        this.elements.minutesSavedCounter.innerText = m.minutesSaved.toFixed(1);
      }
      if (this.elements.percentSavedDisplay) {
        this.elements.percentSavedDisplay.innerText = `${m.percentTimeSaved.toFixed(1)}% TIME SAVED`;
      }

      // 4. Golden Hour Survival Odds Preserved (+8% per minute saved)
      if (this.elements.goldenHourOdds) {
        this.elements.goldenHourOdds.innerText = `+${m.goldenHourOddsPreserved.toFixed(1)}%`;
      }
      if (this.elements.goldenHourProgress) {
        const fillWidth = Math.min(100.0, Math.max(0.0, m.goldenHourOddsPreserved));
        this.elements.goldenHourProgress.style.width = `${fillWidth.toFixed(1)}%`;
      }

      // 5. Halts Avoided & Speed Boost Badges
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

      // 6. Speedometer Gauge & Telemetry Strip
      if (this.elements.speedometerValue) {
        this.elements.speedometerValue.innerText = `${speedKmh.toFixed(1)}`;
      }
      if (this.elements.speedometerGauge) {
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

    /**
     * Returns required HUD container keys for automated test assertions (Test T1.4.4).
     */
    static getRequiredKeys() {
      return [...HUD_REQUIRED_KEYS];
    }
  }

  UIManager.REQUIRED_KEYS = HUD_REQUIRED_KEYS;
  return UIManager;
}));
