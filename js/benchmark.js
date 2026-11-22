/**
 * js/benchmark.js
 * Bengaluru Emergency Green Corridor 3D Digital Twin — Benchmark & Analytics Engine
 *
 * Implements parallel tracking of baseline uncoordinated traffic conditions
 * (stochastic red light waits, congestion drag, accumulating halts) vs
 * AI Green Corridor preemption (zero signal stops, unhindered transit).
 * Calculates travel times, minutes saved, percentage time saved, speed improvement %,
 * halts avoided, and Golden Hour Survival Odds Preserved (+8% per minute saved).
 *
 * Browser-global (window.BenchmarkEngine) & CommonJS / Node.js compatible (UMD).
 */

(function (root, factory) {
  if (typeof define === 'function' && define.amd) {
    define([], factory);
  } else if (typeof module === 'object' && module.exports) {
    module.exports = factory();
  } else {
    root.BenchmarkEngine = factory();
  }
}(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  const BENCHMARK_DEFAULTS = {
    TOTAL_ROUTE_LENGTH_KM: 3.8,       // Central Majestic to Victoria Hospital Corridor
    BASELINE_AVG_SPEED_KMH: 14.2,      // Congested uncoordinated traffic speed in central Bengaluru
    AI_CORRIDOR_SPEED_KMH: 52.8,       // Green wave uninhibited cruising speed
    MIN_STOCHASTIC_RED_SEC: 35.0,      // Minimum delay at an uncoordinated red signal
    MAX_STOCHASTIC_RED_SEC: 50.0,      // Maximum delay at an uncoordinated red signal
    INTERSECTION_SPACING_KM: 0.55,     // Average spacing between corridor signal junctions
    GOLDEN_HOUR_RATE_PER_MIN: 8.0,     // +8% survival odds preserved per minute of transit saved
    MAX_GOLDEN_HOUR_ODDS: 99.0         // Asymptotic ceiling for survival odds metric
  };

  class BenchmarkEngine {
    /**
     * @param {Object} [options]
     * @param {number} [options.totalRouteLengthKm=3.8] - Total route length in kilometers
     * @param {boolean} [options.isAiCorridorActive=true] - Initial AI corridor preemption state
     */
    constructor(options = {}) {
      this.options = Object.assign({}, BENCHMARK_DEFAULTS, options);
      this.totalRouteLengthKm = this.options.totalRouteLengthKm || BENCHMARK_DEFAULTS.TOTAL_ROUTE_LENGTH_KM;
      this.isAiCorridorActive = options.isAiCorridorActive !== false;

      // Parallel Simulation State
      this.baselineTimeSec = 0.0;
      this.aiCorridorTimeSec = 0.0;
      this.baselineHalts = 0;
      this.aiHalts = 0;
      this.distanceTraveledKm = 0.0;
      this.currentSpeedKmh = 0.0;

      // Stochastic Junction Halt Tracking for Baseline Model
      this.nextHaltDistKm = 0.45; // First signal junction encounter ~450m along corridor
      this.runHistory = [];
    }

    /**
     * Resets the benchmark simulation metrics and halt counters.
     * Satisfies Test T2.4.4.
     */
    reset() {
      this.baselineTimeSec = 0.0;
      this.aiCorridorTimeSec = 0.0;
      this.baselineHalts = 0;
      this.aiHalts = 0;
      this.distanceTraveledKm = 0.0;
      this.currentSpeedKmh = 0.0;
      this.nextHaltDistKm = 0.45;
    }

    /**
     * Toggles AI Green Corridor active state (ON vs. Baseline OFF).
     * @returns {boolean} New active state
     */
    toggleAiCorridor() {
      this.isAiCorridorActive = !this.isAiCorridorActive;
      return this.isAiCorridorActive;
    }

    /**
     * Sets AI Green Corridor active state.
     * @param {boolean} isActive
     */
    setAiCorridorActive(isActive) {
      this.isAiCorridorActive = Boolean(isActive);
      return this.isAiCorridorActive;
    }

    /**
     * Formats seconds into MM:SS format.
     * @param {number} seconds
     * @returns {string} Formatted time string (e.g. "04:15")
     */
    static formatTime(seconds) {
      if (isNaN(seconds) || seconds < 0) return '00:00';
      const s = Math.floor(seconds);
      const mins = Math.floor(s / 60);
      const secs = s % 60;
      const mm = mins < 10 ? `0${mins}` : `${mins}`;
      const ss = secs < 10 ? `0${secs}` : `${secs}`;
      return `${mm}:${ss}`;
    }

    /**
     * Pure static calculation oracle matching SpecOracles and test suite requirements.
     * Guards against division-by-zero, negative values, and NaN (Test T2.4.1, T2.4.2).
     *
     * @param {number} baselineSec - Baseline transit duration in seconds
     * @param {number} aiSec - AI Green Corridor transit duration in seconds
     * @param {number} [baselineHalts=0] - Red-light halts encountered in baseline
     * @param {number} [aiHalts=0] - Red-light halts encountered in AI corridor
     * @param {number} [routeLengthKm=3.8] - Route distance in kilometers
     * @returns {Object} Calculated metrics
     */
    static calculateMetrics(baselineSec, aiSec, baselineHalts = 0, aiHalts = 0, routeLengthKm = 3.8) {
      const bSec = Math.max(0, Number(baselineSec) || 0.0);
      const aSec = Math.max(0, Number(aiSec) || 0.0);
      const distKm = Math.max(0, Number(routeLengthKm) || 0.0);

      const minutesSaved = Math.max(0.0, (bSec - aSec) / 60.0);
      let percentTimeSaved = 0.0;
      if (bSec > 0.0) {
        // Extreme congestion bounded within [0, 95%] (Test T2.4.2)
        percentTimeSaved = Math.max(0.0, Math.min(95.0, ((bSec - aSec) / bSec) * 100.0));
      }

      const avgSpeedBaseKmh = (bSec > 0.0 && distKm > 0.0) ? (distKm / (bSec / 3600.0)) : 0.0;
      const avgSpeedAiKmh = (aSec > 0.0 && distKm > 0.0) ? (distKm / (aSec / 3600.0)) : 0.0;

      let speedImprovementPercent = 0.0;
      if (avgSpeedBaseKmh > 0.0) {
        speedImprovementPercent = Math.max(0.0, ((avgSpeedAiKmh - avgSpeedBaseKmh) / avgSpeedBaseKmh) * 100.0);
      }

      const bHalts = Math.max(0, Math.round(Number(baselineHalts) || 0));
      const aHalts = Math.max(0, Math.round(Number(aiHalts) || 0));
      const haltReduction = Math.max(0, bHalts - aHalts);

      // Golden Hour Survival Odds Preserved: +8% per minute saved, clamped to [0.0, 99.0]%
      const rawOdds = minutesSaved * BENCHMARK_DEFAULTS.GOLDEN_HOUR_RATE_PER_MIN;
      const goldenHourOddsPreserved = Math.min(BENCHMARK_DEFAULTS.MAX_GOLDEN_HOUR_ODDS, Math.max(0.0, rawOdds));

      return {
        baselineTimeSec: Math.round(bSec * 10) / 10,
        aiCorridorTimeSec: Math.round(aSec * 10) / 10,
        baselineEtaStr: BenchmarkEngine.formatTime(bSec),
        aiEtaStr: BenchmarkEngine.formatTime(aSec),
        minutesSaved: Math.round(minutesSaved * 10) / 10,
        percentTimeSaved: Math.round(percentTimeSaved * 10) / 10,
        avgSpeedBaseKmh: Math.round(avgSpeedBaseKmh * 10) / 10,
        avgSpeedAiKmh: Math.round(avgSpeedAiKmh * 10) / 10,
        speedImprovementPercent: Math.round(speedImprovementPercent * 10) / 10,
        baselineHalts: bHalts,
        aiHalts: aHalts,
        haltsAvoided: haltReduction,
        haltReduction: haltReduction,
        goldenHourOddsPreserved: Math.round(goldenHourOddsPreserved * 10) / 10
      };
    }

    /**
     * Returns live metrics snapshot for the current simulation state.
     * Complies with Interface Contract 5 and Tier 1-4 test assertions.
     * @returns {Object}
     */
    getMetrics() {
      const calc = BenchmarkEngine.calculateMetrics(
        this.baselineTimeSec,
        this.aiCorridorTimeSec,
        this.baselineHalts,
        this.aiHalts,
        this.distanceTraveledKm > 0 ? this.distanceTraveledKm : this.totalRouteLengthKm
      );

      return Object.assign({}, calc, {
        currentSpeedKmh: Math.round(this.currentSpeedKmh * 10) / 10,
        distanceTraveledKm: Math.round(this.distanceTraveledKm * 100) / 100,
        totalRouteLengthKm: this.totalRouteLengthKm,
        isAiCorridorActive: this.isAiCorridorActive,
        runsCompleted: this.runHistory.length
      });
    }

    /**
     * Updates simulation metrics across frame delta dt.
     * Enforces progress guard: negative speed/reverse does not decrement distance (Test T2.4.3).
     *
     * @param {number} dt - Frame delta in seconds
     * @param {Object} ambulance - Active ambulance controller instance
     * @returns {Object} Updated metrics
     */
    update(dt = 0.016, ambulance = null) {
      const safeDt = Math.max(0.0, Math.min(Number(dt) || 0.016, 3600.0));

      let speedKmh = 0.0;
      if (ambulance && typeof ambulance.getSpeedKmh === 'function') {
        speedKmh = ambulance.getSpeedKmh();
      }

      // Progress guard: Negative speed / reverse driving is discarded in progress accumulation (Test T2.4.3)
      const forwardSpeedKmh = Math.max(0.0, speedKmh);
      this.currentSpeedKmh = forwardSpeedKmh;

      // Accumulate forward distance in kilometers
      const deltaDistKm = (forwardSpeedKmh / 3600.0) * safeDt;
      this.distanceTraveledKm += deltaDistKm;

      if (this.isAiCorridorActive) {
        // --- 1. AI Green Corridor Active Mode ---
        // Ambulance travels with 0 signal halts and early preemption wave
        this.aiCorridorTimeSec += safeDt;
        this.aiHalts = 0;

        // Parallel baseline uncoordinated progress accumulation
        // In uncoordinated baseline, moving speed is ~14.2 km/h in dense Bengaluru corridors
        const baseMovingSpeed = BENCHMARK_DEFAULTS.BASELINE_AVG_SPEED_KMH;
        const baselineMovingDt = deltaDistKm > 0.0
          ? (deltaDistKm / baseMovingSpeed) * 3600.0
          : (safeDt * (BENCHMARK_DEFAULTS.AI_CORRIDOR_SPEED_KMH / baseMovingSpeed));
        this.baselineTimeSec += baselineMovingDt;

        // Stochastic intersection halts in uncoordinated baseline
        if (this.distanceTraveledKm >= this.nextHaltDistKm) {
          this.baselineHalts += 1;
          // Stochastic red-light dwell time between 35s and 50s
          const stochasticWaitSec = BENCHMARK_DEFAULTS.MIN_STOCHASTIC_RED_SEC +
            Math.random() * (BENCHMARK_DEFAULTS.MAX_STOCHASTIC_RED_SEC - BENCHMARK_DEFAULTS.MIN_STOCHASTIC_RED_SEC);
          this.baselineTimeSec += stochasticWaitSec;

          // Next intersection spacing ~450m - 750m
          this.nextHaltDistKm += (BENCHMARK_DEFAULTS.INTERSECTION_SPACING_KM + (Math.random() * 0.2 - 0.1));
        }
      } else {
        // --- 2. Baseline Demonstration Mode (AI Green Corridor OFF) ---
        // Signals do not preempt and civilian vehicles do not yield
        this.baselineTimeSec += safeDt;

        // In baseline demonstration, AI green wave ETA is calculated in parallel
        const aiCruisingSpeed = BENCHMARK_DEFAULTS.AI_CORRIDOR_SPEED_KMH;
        const aiProjectedDt = deltaDistKm > 0.0
          ? (deltaDistKm / aiCruisingSpeed) * 3600.0
          : (safeDt * (BENCHMARK_DEFAULTS.BASELINE_AVG_SPEED_KMH / aiCruisingSpeed));
        this.aiCorridorTimeSec += aiProjectedDt;
        this.aiHalts = 0;

        // Detect baseline stops when speed drops near zero at intersection
        if (this.distanceTraveledKm >= this.nextHaltDistKm && forwardSpeedKmh < 5.0) {
          this.baselineHalts += 1;
          this.nextHaltDistKm += BENCHMARK_DEFAULTS.INTERSECTION_SPACING_KM;
        }
      }

      // Automatic route completion wrap & record
      if (this.distanceTraveledKm >= this.totalRouteLengthKm) {
        this.recordRun();
        // Reset distance for continuous circular demonstration
        this.distanceTraveledKm = 0.0;
        this.nextHaltDistKm = 0.45;
      }

      return this.getMetrics();
    }

    /**
     * Records a completed transit run for cumulative multi-run telemetry aggregation.
     * @param {Object|number} [runOrLength] - Run metrics object or route length
     */
    recordRun(runOrLength = null) {
      let runMetrics;
      if (runOrLength && typeof runOrLength === 'object') {
        runMetrics = Object.assign({}, runOrLength);
      } else {
        runMetrics = this.getMetrics();
      }

      this.runHistory.push(runMetrics);
      return runMetrics;
    }

    /**
     * Generates structured JSON export of benchmark performance and cumulative multi-run analytics.
     * Satisfies Tier 4 Test T4.5 schema requirements.
     * @returns {Object} Structured benchmark telemetry export
     */
    exportBenchmarkData() {
      const current = this.getMetrics();
      const hasHistory = this.runHistory.length > 0;
      const runs = hasHistory ? this.runHistory : [current];

      const totalRuns = runs.length;
      const cumulativeMinutesSaved = runs.reduce((acc, r) => acc + (r.minutesSaved || 0.0), 0.0);
      const totalHaltsEliminated = runs.reduce((acc, r) => acc + (r.haltReduction || r.haltsAvoided || 0), 0);
      const avgPercentSaved = runs.reduce((acc, r) => acc + (r.percentTimeSaved || 0.0), 0.0) / totalRuns;

      return {
        exportTimestamp: new Date().toISOString(),
        totalRunsCompleted: totalRuns,
        cumulativeMinutesSaved: Math.round(cumulativeMinutesSaved * 10) / 10,
        averageTimeSavedPercent: Math.round(avgPercentSaved * 10) / 10,
        totalHaltsEliminated: totalHaltsEliminated,
        runs: runs
      };
    }
  }

  BenchmarkEngine.DEFAULTS = BENCHMARK_DEFAULTS;
  return BenchmarkEngine;
}));
