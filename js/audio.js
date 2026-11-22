/**
 * js/audio.js
 * Bengaluru Emergency Green Corridor 3D Digital Twin — Web Audio API Siren Synthesizer
 * Procedural dual-tone emergency siren synthesizer (750 Hz <-> 1150 Hz wail / yelp).
 * Zero audio samples needed — 100% real-time mathematical frequency modulation synthesis.
 * Browser-global (window.SirenSynthesizer) & CommonJS (Node.js) compatible.
 */

(function (root, factory) {
  if (typeof define === 'function' && define.amd) {
    define([], factory);
  } else if (typeof module === 'object' && module.exports) {
    module.exports = factory();
  } else {
    const exportsObj = factory();
    root.SirenSynthesizer = exportsObj.SirenSynthesizer;
    root.SirenAudio = exportsObj.SirenSynthesizer;
  }
}(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  const SIREN_CONSTANTS = {
    WAIL_MIN_FREQ: 750.0,
    WAIL_MAX_FREQ: 1150.0,
    WAIL_LFO_HZ: 0.25,     // 4.0s cycle
    YELP_LFO_HZ: 2.50,     // 0.4s cycle
    DEFAULT_VOLUME: 0.28,
    RAMP_TIME_SEC: 0.05,   // Smooth anti-pop attack / release
    FILTER_CUTOFF_HZ: 2200.0,
    FILTER_Q: 2.2
  };

  class SirenSynthesizer {
    /**
     * @param {Object} [options]
     * @param {number} [options.volume=0.28] - Master output gain (0.0 - 1.0)
     * @param {string} [options.mode='wail'] - 'wail' or 'yelp'
     */
    constructor(options = {}) {
      this.targetVolume = options.volume !== undefined ? options.volume : SIREN_CONSTANTS.DEFAULT_VOLUME;
      this.mode = options.mode || 'wail'; // 'wail' | 'yelp'
      this.active = false;

      this.audioCtx = null;
      this.masterGain = null;
      this.carrierOsc = null;
      this.overtoneOsc = null;
      this.lfoOsc = null;
      this.lfoGain = null;
      this.biquadFilter = null;

      this.isHeadless = (typeof window === 'undefined') ||
        (typeof window.AudioContext === 'undefined' && typeof window.webkitAudioContext === 'undefined');
    }

    /**
     * Lazily constructs and boots the Web Audio API synthesis graph upon first user interaction.
     */
    initAudioGraph() {
      if (this.isHeadless) return;
      if (this.audioCtx) return;

      const AudioContextClass = window.AudioContext || window.webkitAudioContext;
      this.audioCtx = new AudioContextClass();

      // Master gain node for smooth fading and muting
      this.masterGain = this.audioCtx.createGain();
      this.masterGain.gain.setValueAtTime(0.0001, this.audioCtx.currentTime);
      this.masterGain.connect(this.audioCtx.destination);

      // Resonant lowpass filter to replicate horn housing acoustic resonances
      this.biquadFilter = this.audioCtx.createBiquadFilter();
      this.biquadFilter.type = 'lowpass';
      this.biquadFilter.frequency.setValueAtTime(SIREN_CONSTANTS.FILTER_CUTOFF_HZ, this.audioCtx.currentTime);
      this.biquadFilter.Q.setValueAtTime(SIREN_CONSTANTS.FILTER_Q, this.audioCtx.currentTime);
      this.biquadFilter.connect(this.masterGain);
    }

    /**
     * Activates emergency siren sound with smooth clickless attack.
     */
    start() {
      this.active = true;
      if (this.isHeadless) return true;

      this.initAudioGraph();

      if (this.audioCtx.state === 'suspended') {
        this.audioCtx.resume();
      }

      const now = this.audioCtx.currentTime;

      // Tear down previous nodes if any
      this.teardownNodes();

      // 1. Calculate center frequency and modulation depth
      const minFreq = SIREN_CONSTANTS.WAIL_MIN_FREQ;
      const maxFreq = SIREN_CONSTANTS.WAIL_MAX_FREQ;
      const centerFreq = (minFreq + maxFreq) / 2.0; // 950 Hz
      const modDepth = (maxFreq - minFreq) / 2.0;   // 200 Hz
      const lfoSpeed = (this.mode === 'yelp') ? SIREN_CONSTANTS.YELP_LFO_HZ : SIREN_CONSTANTS.WAIL_LFO_HZ;

      // 2. Primary Sawtooth Oscillator (Rich harmonic spectrum)
      this.carrierOsc = this.audioCtx.createOscillator();
      this.carrierOsc.type = 'sawtooth';
      this.carrierOsc.frequency.setValueAtTime(centerFreq, now);

      // 3. Harmonic Overtone Oscillator (Adds electronic siren body)
      this.overtoneOsc = this.audioCtx.createOscillator();
      this.overtoneOsc.type = 'triangle';
      this.overtoneOsc.frequency.setValueAtTime(centerFreq * 1.5, now);

      // 4. LFO Frequency Modulator (Controls continuous pitch sweep between 750 and 1150 Hz)
      this.lfoOsc = this.audioCtx.createOscillator();
      this.lfoOsc.type = 'triangle';
      this.lfoOsc.frequency.setValueAtTime(lfoSpeed, now);

      // 5. LFO Gain (Modulation Depth: +/- 200 Hz)
      this.lfoGain = this.audioCtx.createGain();
      this.lfoGain.gain.setValueAtTime(modDepth, now);

      // Connect LFO to modulate carrier frequencies
      this.lfoOsc.connect(this.lfoGain);
      this.lfoGain.connect(this.carrierOsc.frequency);

      // Separate LFO gain for overtone
      const overtoneLfoGain = this.audioCtx.createGain();
      overtoneLfoGain.gain.setValueAtTime(modDepth * 1.5, now);
      this.lfoOsc.connect(overtoneLfoGain);
      overtoneLfoGain.connect(this.overtoneOsc.frequency);

      // Sub-gain for overtone mix
      const overtoneMixGain = this.audioCtx.createGain();
      overtoneMixGain.gain.setValueAtTime(0.20, now);
      this.overtoneOsc.connect(overtoneMixGain);

      // Route audio to filter
      this.carrierOsc.connect(this.biquadFilter);
      overtoneMixGain.connect(this.biquadFilter);

      // Start all oscillators
      this.carrierOsc.start(now);
      this.overtoneOsc.start(now);
      this.lfoOsc.start(now);

      // Smooth anti-pop attack ramp
      this.masterGain.gain.cancelScheduledValues(now);
      this.masterGain.gain.setValueAtTime(0.0001, now);
      this.masterGain.gain.linearRampToValueAtTime(this.targetVolume, now + SIREN_CONSTANTS.RAMP_TIME_SEC);

      return true;
    }

    /**
     * Cleanly deactivates siren with anti-pop release ramp.
     */
    stop() {
      this.active = false;
      if (this.isHeadless || !this.audioCtx || !this.masterGain) return false;

      const now = this.audioCtx.currentTime;
      this.masterGain.gain.cancelScheduledValues(now);
      this.masterGain.gain.setValueAtTime(this.masterGain.gain.value, now);
      this.masterGain.gain.linearRampToValueAtTime(0.0001, now + SIREN_CONSTANTS.RAMP_TIME_SEC);

      // Stop and disconnect nodes after fade-out
      setTimeout(() => {
        if (!this.active) {
          this.teardownNodes();
        }
      }, (SIREN_CONSTANTS.RAMP_TIME_SEC + 0.02) * 1000);

      return false;
    }

    /**
     * Toggles siren state.
     * @returns {boolean} New active state
     */
    toggle() {
      if (this.active) {
        this.stop();
      } else {
        this.start();
      }
      return this.active;
    }

    /**
     * Switches between 'wail' (slow sweep) and 'yelp' (rapid cycle).
     * @param {'wail'|'yelp'} mode
     */
    setMode(mode) {
      if (mode !== 'wail' && mode !== 'yelp') return;
      this.mode = mode;
      if (this.active && this.lfoOsc && this.audioCtx) {
        const speed = (this.mode === 'yelp') ? SIREN_CONSTANTS.YELP_LFO_HZ : SIREN_CONSTANTS.WAIL_LFO_HZ;
        this.lfoOsc.frequency.setTargetAtTime(speed, this.audioCtx.currentTime, 0.05);
      }
    }

    /**
     * Adjusts siren volume level.
     * @param {number} volume - Float between 0.0 and 1.0
     */
    setVolume(volume) {
      this.targetVolume = Math.max(0.0, Math.min(1.0, volume));
      if (this.active && this.masterGain && this.audioCtx) {
        this.masterGain.gain.setTargetAtTime(this.targetVolume, this.audioCtx.currentTime, 0.05);
      }
    }

    teardownNodes() {
      if (this.carrierOsc) {
        try { this.carrierOsc.stop(); this.carrierOsc.disconnect(); } catch (e) {}
        this.carrierOsc = null;
      }
      if (this.overtoneOsc) {
        try { this.overtoneOsc.stop(); this.overtoneOsc.disconnect(); } catch (e) {}
        this.overtoneOsc = null;
      }
      if (this.lfoOsc) {
        try { this.lfoOsc.stop(); this.lfoOsc.disconnect(); } catch (e) {}
        this.lfoOsc = null;
      }
      if (this.lfoGain) {
        try { this.lfoGain.disconnect(); } catch (e) {}
        this.lfoGain = null;
      }
    }

    isActive() {
      return this.active;
    }

    getFrequencies() {
      return {
        minFreqHz: SIREN_CONSTANTS.WAIL_MIN_FREQ,
        maxFreqHz: SIREN_CONSTANTS.WAIL_MAX_FREQ,
        currentMode: this.mode
      };
    }
  }

  SirenSynthesizer.CONSTANTS = SIREN_CONSTANTS;

  return {
    SirenSynthesizer,
    SirenAudio: SirenSynthesizer
  };
}));
