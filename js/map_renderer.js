/**
 * js/map_renderer.js
 * Bengaluru Emergency Green Corridor 3D Digital Twin — MapLibre GL JS Renderer
 * OpenFreeMap Liberty 3D vector tiles + dark smart-city styling + 3D extruded buildings,
 * live congestion heat corridors, glowing green-corridor beam, 15 ITMS signal beacons,
 * dynamic hospital & landmark badges from NETWORK_DATA / Data/GeoJSON/bengaluru_network.json.
 * Browser-global (window.MapRenderer / window.mapRenderer) & CommonJS / Node.js compatible (UMD).
 */

(function (root, factory) {
  if (typeof define === 'function' && define.amd) {
    define([], factory);
  } else if (typeof module === 'object' && module.exports) {
    module.exports = factory();
  } else {
    const cls = factory();
    root.MapRenderer = cls;
  }
}(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  const LIBERTY_STYLE_URL = 'https://tiles.openfreemap.org/styles/liberty';
  const BENGALURU_CENTER = [77.596, 12.954];

  const OFFLINE_DARK_STYLE = {
    version: 8,
    name: 'Bengaluru Dark Fallback',
    sources: {},
    layers: [
      {
        id: 'background',
        type: 'background',
        paint: { 'background-color': '#070b14' }
      }
    ]
  };

  class MapRenderer {
    /**
     * @param {Object} [options]
     * @param {GeoProjection} [options.projection]
     * @param {SignalManager} [options.signalManager]
     * @param {SmartRoutingController} [options.routingController]
     * @param {SimulationEngine} [options.sim]
     * @param {Object} [options.networkData]
     */
    constructor(options = {}) {
      this.projection = options.projection || null;
      this.signalManager = options.signalManager || null;
      this.routingController = options.routingController || null;
      this.sim = options.sim || null;
      this.networkData = options.networkData || null;
      this.map = null;
      this.containerId = options.containerId || 'map-container';

      this._headless = (typeof maplibregl === 'undefined' || typeof document === 'undefined');
      this._initialized = false;
      this._layersReady = false;
      this._lastSyncTime = 0;
      this._lastCorridorSyncTime = 0;
      this._lastBeamKey = '';
      this._pulsePhase = 0;
      this._fallbackAttempted = false;

      // Stage 7: Targeting beam & priority halo state
      this._targetSignalId = null;
      this._targetSignalDistance = 0;
      this._targetSignalETA = 0;
      this._priorityHaloPhase = 0;
    }

    configure(options = {}) {
      if (options.projection !== undefined) this.projection = options.projection;
      if (options.signalManager !== undefined) this.signalManager = options.signalManager;
      if (options.routingController !== undefined) this.routingController = options.routingController;
      if (options.sim !== undefined) this.sim = options.sim;
      if (options.networkData !== undefined) this.networkData = options.networkData;
      if (options.containerId !== undefined) this.containerId = options.containerId;
      return this;
    }

    /**
     * Initialize MapLibre GL JS map with OpenFreeMap Liberty style (3D buildings) + offline fallback.
     * @returns {Promise<maplibregl.Map|null>}
     */
    initMap() {
      if (this._headless) {
        console.warn('MapRenderer: maplibregl or DOM not available — running headless');
        return Promise.resolve(null);
      }
      if (this._initialized && this.map) {
        return Promise.resolve(this.map);
      }

      const containerEl = document.getElementById(this.containerId) || document.getElementById('webgl-canvas');
      if (!containerEl) {
        console.error(`MapRenderer: #${this.containerId} not found — cannot init MapLibre`);
        return Promise.resolve(null);
      }

      return new Promise((resolve) => {
        try {
          this.map = new maplibregl.Map({
            container: containerEl,
            style: LIBERTY_STYLE_URL,
            center: BENGALURU_CENTER,
            zoom: 12.3,
            pitch: 55,
            bearing: -10,
            maxPitch: 75,
            antialias: true,
            attributionControl: false
          });

          this.map.addControl(new maplibregl.NavigationControl({ visualizePitch: true }), 'bottom-left');

          let resolved = false;
          let themeApplied = false;
          const applyThemeEarly = () => {
            if (themeApplied) return;
            themeApplied = true;
            this._applyDarkSmartCityTheme();
          };
          const finishInit = () => {
            if (resolved) return;
            resolved = true;
            this._initialized = true;
            applyThemeEarly();
            this._onStyleReady().then(() => resolve(this.map));
          };

          this.map.on('style.load', applyThemeEarly);
          this.map.on('load', finishInit);

          this.map.on('error', (err) => {
            const msg = err && err.error ? err.error.message : '';
            // Only swap to offline dark style if initial style itself failed to load
            if (!this._initialized && !this._fallbackAttempted && /style|Failed to fetch|NetworkError|404/i.test(msg)) {
              this._fallbackAttempted = true;
              console.warn('MapRenderer: OpenFreeMap style failed, switching to dark fallback:', msg);
              try {
                this.map.setStyle(OFFLINE_DARK_STYLE);
                this.map.once('styledata', finishInit);
              } catch (e) {
                finishInit();
              }
            }
          });
        } catch (e) {
          console.error('MapRenderer: initMap exception', e);
          resolve(null);
        }
      });
    }

    async _onStyleReady() {
      if (!this.map || this._layersReady) return;
      this._layersReady = true;

      this._applyDarkSmartCityTheme();
      this._registerCustomIcons();

      const netData = await this._resolveNetworkData();
      this._addNetworkCorridors(netData);
      this._addGreenCorridorBeam();
      this._addTargetingBeam();
      this._addPriorityHalo();
      this._addSignalBeacons();
      this._addHospitalBadges(netData);
      this._addLandmarkBadges(netData);

      this.syncWithThree(0);
    }

    /**
     * Shift OpenFreeMap Liberty base layers into a dark smart-city digital twin palette
     * and reveal 3D extruded buildings from zoom 12 upward.
     */
    _applyDarkSmartCityTheme() {
      if (!this.map) return;
      const style = this.map.getStyle();
      if (!style || !Array.isArray(style.layers)) return;

      for (const layer of style.layers) {
        const id = layer.id || '';
        try {
          if (layer.type === 'background') {
            this.map.setPaintProperty(id, 'background-color', '#080d1a');
          } else if (id === 'building') {
            this.map.setLayerZoomRange(id, 10, 11.5);
            this.map.setPaintProperty(id, 'fill-color', '#162033');
            this.map.setPaintProperty(id, 'fill-outline-color', '#24344d');
          } else if (id === 'building-3d') {
            this.map.setLayerZoomRange(id, 11.5, 24);
            this.map.setPaintProperty(id, 'fill-extrusion-color', [
              'interpolate', ['linear'], ['coalesce', ['get', 'render_height'], 12],
              0, '#131d2e',
              20, '#1c2b45',
              50, '#273c61',
              100, '#365485'
            ]);
            this.map.setPaintProperty(id, 'fill-extrusion-opacity', 0.90);
          } else if (layer.type === 'fill' && /water/i.test(id)) {
            this.map.setPaintProperty(id, 'fill-color', '#0a192f');
          } else if (layer.type === 'fill' && /park|wood|grass|landcover|landuse/i.test(id)) {
            this.map.setPaintProperty(id, 'fill-color', '#0d1b24');
            this.map.setPaintProperty(id, 'fill-opacity', 0.65);
          } else if (layer.type === 'line' && /road|highway|street|path|tunnel|bridge/i.test(id)) {
            if (/casing/i.test(id)) {
              this.map.setPaintProperty(id, 'line-color', '#0f172a');
            } else if (/motorway|trunk|primary/i.test(id)) {
              this.map.setPaintProperty(id, 'line-color', '#1e293b');
            } else {
              this.map.setPaintProperty(id, 'line-color', '#172133');
            }
          } else if (layer.type === 'symbol') {
            if (layer.paint && 'text-color' in layer.paint) {
              this.map.setPaintProperty(id, 'text-color', '#94a3b8');
              this.map.setPaintProperty(id, 'text-halo-color', '#070b14');
              this.map.setPaintProperty(id, 'text-halo-width', 1.2);
            }
          }
        } catch (e) {
          // Ignore individual paint property mismatches across style variants
        }
      }
    }

    /**
     * Create crisp canvas-rendered icons in MapLibre so zero missing sprite 404s occur.
     */
    _registerCustomIcons() {
      if (!this.map) return;

      // Hospital red cross badge
      if (!this.map.hasImage('hospital-cross-badge')) {
        const size = 40;
        const c = document.createElement('canvas');
        c.width = size;
        c.height = size;
        const ctx = c.getContext('2d');
        // Outer glow circle
        ctx.beginPath();
        ctx.arc(size / 2, size / 2, 17, 0, Math.PI * 2);
        ctx.fillStyle = '#dc2626';
        ctx.fill();
        ctx.lineWidth = 2.5;
        ctx.strokeStyle = '#ffffff';
        ctx.stroke();
        // White medical cross
        ctx.fillStyle = '#ffffff';
        ctx.fillRect(size / 2 - 3, size / 2 - 9, 6, 18);
        ctx.fillRect(size / 2 - 9, size / 2 - 3, 18, 6);
        this.map.addImage('hospital-cross-badge', ctx.getImageData(0, 0, size, size));
      }

      // Landmark cyan diamond badge
      if (!this.map.hasImage('landmark-diamond-badge')) {
        const size = 28;
        const c = document.createElement('canvas');
        c.width = size;
        c.height = size;
        const ctx = c.getContext('2d');
        ctx.translate(size / 2, size / 2);
        ctx.rotate(Math.PI / 4);
        ctx.fillStyle = '#0ea5e9';
        ctx.fillRect(-7, -7, 14, 14);
        ctx.lineWidth = 2;
        ctx.strokeStyle = '#e0f2fe';
        ctx.strokeRect(-7, -7, 14, 14);
        this.map.addImage('landmark-diamond-badge', ctx.getImageData(0, 0, size, size));
      }
    }

    async _resolveNetworkData() {
      if (this.networkData) return this.networkData;
      if (typeof NETWORK_DATA !== 'undefined' && NETWORK_DATA) {
        this.networkData = NETWORK_DATA;
        return this.networkData;
      }
      try {
        const resp = await fetch('Data/GeoJSON/bengaluru_network.json');
        if (resp.ok) {
          this.networkData = await resp.json();
          return this.networkData;
        }
      } catch (e) {
        console.warn('MapRenderer: Could not fetch Data/GeoJSON/bengaluru_network.json', e);
      }
      return null;
    }

    _addNetworkCorridors(netData) {
      if (!this.map || !netData || !Array.isArray(netData.edges)) return;

      const features = this._buildCorridorFeatures(netData);
      if (!this.map.getSource('network-corridors')) {
        this.map.addSource('network-corridors', {
          type: 'geojson',
          data: { type: 'FeatureCollection', features }
        });
      }

      const beforeLayer = this.map.getLayer('building-3d') ? 'building-3d' : undefined;
      if (!this.map.getLayer('corridor-lines-glow')) {
        this.map.addLayer({
          id: 'corridor-lines-glow',
          type: 'line',
          source: 'network-corridors',
          layout: { 'line-join': 'round', 'line-cap': 'round' },
          paint: {
            'line-color': [
              'match', ['get', 'status'],
              'reroute', '#22d3ee',
              'blocked', '#ef4444',
              'heavy', '#ef4444',
              'moderate', '#f59e0b',
              '#10b981'
            ],
            'line-width': ['interpolate', ['linear'], ['zoom'], 11, 5, 16, 16],
            'line-opacity': 0.22,
            'line-blur': 4
          }
        }, beforeLayer);
      }

      if (!this.map.getLayer('corridor-lines')) {
        this.map.addLayer({
          id: 'corridor-lines',
          type: 'line',
          source: 'network-corridors',
          layout: { 'line-join': 'round', 'line-cap': 'round' },
          paint: {
            'line-color': [
              'match', ['get', 'status'],
              'reroute', '#22d3ee',
              'blocked', '#dc2626',
              'heavy', '#ef4444',
              'moderate', '#f59e0b',
              '#10b981'
            ],
            'line-width': ['interpolate', ['linear'], ['zoom'], 11, 2.2, 16, 7],
            'line-opacity': 0.85
          }
        }, beforeLayer);
      }
    }

    _buildCorridorFeatures(netData) {
      const congestionMap = this._getCongestionMap();
      const rerouteEdges = this._getTier1RerouteSet();
      const routeEdges = new Set(this._getCurrentRouteEdges());

      const features = [];
      for (const edge of netData.edges) {
        if (!Array.isArray(edge.polyline) || edge.polyline.length < 2) continue;
        const coords = edge.polyline.map(pt => [pt[0], pt[1]]);
        const simEdge = this.sim && this.sim.network ? this.sim.network.getEdge(edge.id) : null;
        const cEntry = congestionMap[edge.id];

        let status = 'free';
        if (simEdge && simEdge._blocked) {
          status = 'blocked';
        } else if (rerouteEdges.has(edge.id)) {
          status = 'reroute';
        } else if (cEntry) {
          const isInfTravel = cEntry.travelTimeSec !== undefined && !Number.isFinite(cEntry.travelTimeSec);
          if (isInfTravel || cEntry.density > 1.2 || (cEntry.meanSpeedMps !== undefined && cEntry.meanSpeedMps < 3.5 && cEntry.vehicleCount >= 3)) {
            status = 'heavy';
          } else if (cEntry.density > 0.5 || (cEntry.meanSpeedMps !== undefined && cEntry.meanSpeedMps < 7.0 && cEntry.vehicleCount >= 2)) {
            status = 'moderate';
          }
        }

        features.push({
          type: 'Feature',
          properties: {
            id: edge.id,
            name: edge.name || edge.id,
            status,
            inRoute: routeEdges.has(edge.id) ? 1 : 0
          },
          geometry: {
            type: 'LineString',
            coordinates: coords
          }
        });
      }
      return features;
    }

    _addGreenCorridorBeam() {
      if (!this.map) return;
      if (!this.map.getSource('green-corridor-beam')) {
        this.map.addSource('green-corridor-beam', {
          type: 'geojson',
          data: { type: 'FeatureCollection', features: [] }
        });
      }
      const beforeLayer = this.map.getLayer('building-3d') ? 'building-3d' : undefined;

      if (!this.map.getLayer('green-corridor-beam-glow')) {
        this.map.addLayer({
          id: 'green-corridor-beam-glow',
          type: 'line',
          source: 'green-corridor-beam',
          layout: { 'line-join': 'round', 'line-cap': 'round' },
          paint: {
            'line-color': '#22d3ee',
            'line-width': ['interpolate', ['linear'], ['zoom'], 11, 8, 16, 22],
            'line-opacity': 0.42,
            'line-blur': 6
          }
        }, beforeLayer);
      }

      if (!this.map.getLayer('green-corridor-beam-core')) {
        this.map.addLayer({
          id: 'green-corridor-beam-core',
          type: 'line',
          source: 'green-corridor-beam',
          layout: { 'line-join': 'round', 'line-cap': 'round' },
          paint: {
            'line-color': '#67e8f9',
            'line-width': ['interpolate', ['linear'], ['zoom'], 11, 3, 16, 8],
            'line-opacity': 0.95
          }
        }, beforeLayer);
      }
    }

    /**
     * Stage 7: Add targeting beam - dashed line from ambulance to next signal within 350m.
     * Updates dynamically as ambulance approaches signals.
     */
    _addTargetingBeam() {
      if (!this.map) return;
      if (!this.map.getSource('targeting-beam')) {
        this.map.addSource('targeting-beam', {
          type: 'geojson',
          data: { type: 'FeatureCollection', features: [] }
        });
      }
      const beforeLayer = this.map.getLayer('building-3d') ? 'building-3d' : undefined;

      if (!this.map.getLayer('targeting-beam-line')) {
        this.map.addLayer({
          id: 'targeting-beam-line',
          type: 'line',
          source: 'targeting-beam',
          layout: { 'line-join': 'round', 'line-cap': 'round' },
          paint: {
            'line-color': '#22d3ee',
            'line-width': ['interpolate', ['linear'], ['zoom'], 11, 3, 16, 6],
            'line-dasharray': [2.5, 2.0],
            'line-opacity': 0.95
          }
        }, beforeLayer);
      }
    }

    /**
     * Stage 7: Add pulsing priority halo ring on targeted signal when Tier-2 preemption activates (≤250m).
     * A growing/shrinking ring around the signal beacon.
     */
    _addPriorityHalo() {
      if (!this.map) return;
      if (!this.map.getSource('priority-halo')) {
        this.map.addSource('priority-halo', {
          type: 'geojson',
          data: { type: 'FeatureCollection', features: [] }
        });
      }
      const beforeLayer = this.map.getLayer('building-3d') ? 'building-3d' : undefined;

      if (!this.map.getLayer('priority-halo-ring')) {
        this.map.addLayer({
          id: 'priority-halo-ring',
          type: 'circle',
          source: 'priority-halo',
          paint: {
            'circle-radius': [
              'interpolate', ['linear'], ['zoom'],
              11, ['*', ['get', 'pulseScale'], 12],
              16, ['*', ['get', 'pulseScale'], 28]
            ],
            'circle-color': '#22d3ee',
            'circle-opacity': ['*', 0.55, ['get', 'pulseOpacity']],
            'circle-stroke-width': 3,
            'circle-stroke-color': '#67e8f9',
            'circle-stroke-opacity': ['get', 'pulseOpacity']
          }
        }, beforeLayer);
      }
    }

    _addSignalBeacons() {
      if (!this.map) return;
      const features = this._buildSignalFeatures();
      if (!this.map.getSource('signal-beacons')) {
        this.map.addSource('signal-beacons', {
          type: 'geojson',
          data: { type: 'FeatureCollection', features }
        });
      }

      if (!this.map.getLayer('signal-beacons-halo')) {
        this.map.addLayer({
          id: 'signal-beacons-halo',
          type: 'circle',
          source: 'signal-beacons',
          paint: {
            'circle-radius': [
              'case',
              ['==', ['get', 'preempted'], 1],
              ['interpolate', ['linear'], ['zoom'], 11, 10, 16, 22],
              ['interpolate', ['linear'], ['zoom'], 11, 6, 16, 12]
            ],
            'circle-color': [
              'match', ['get', 'colorKey'],
              'PREEMPT', '#22d3ee',
              'GREEN', '#10b981',
              'AMBER', '#f59e0b',
              '#ef4444'
            ],
            'circle-opacity': ['case', ['==', ['get', 'preempted'], 1], 0.45, 0.25],
            'circle-blur': 0.6
          }
        });
      }

      if (!this.map.getLayer('signal-beacons-core')) {
        this.map.addLayer({
          id: 'signal-beacons-core',
          type: 'circle',
          source: 'signal-beacons',
          paint: {
            'circle-radius': ['interpolate', ['linear'], ['zoom'], 11, 4, 16, 8],
            'circle-color': [
              'match', ['get', 'colorKey'],
              'PREEMPT', '#67e8f9',
              'GREEN', '#22c55e',
              'AMBER', '#fbbf24',
              '#ef4444'
            ],
            'circle-stroke-width': 1.5,
            'circle-stroke-color': '#ffffff'
          }
        });
      }
    }

    _buildSignalFeatures() {
      const signals = this.signalManager && typeof this.signalManager.getAllSignals === 'function'
        ? this.signalManager.getAllSignals()
        : [];
      const features = [];

      for (const sig of signals) {
        let lon = null;
        let lat = null;
        if (this.projection && sig.worldPos && typeof this.projection.cartesianToLatLonAlt === 'function') {
          const geo = this.projection.cartesianToLatLonAlt(sig.worldPos.x, sig.worldPos.y || 0, sig.worldPos.z);
          lon = geo.lon;
          lat = geo.lat;
        }
        if (lon === null || lat === null) continue;

        const phase = String(sig.currentPhase || sig.currentState || 'RED').toUpperCase();
        const isPreempted = Boolean(sig.isPreempted || phase === 'PREEMPT_GREEN');
        let colorKey = 'RED';
        if (isPreempted) colorKey = 'PREEMPT';
        else if (phase.includes('GREEN')) colorKey = 'GREEN';
        else if (phase.includes('AMBER')) colorKey = 'AMBER';

        features.push({
          type: 'Feature',
          properties: {
            id: sig.id,
            name: sig.name || sig.id,
            colorKey,
            preempted: isPreempted ? 1 : 0
          },
          geometry: {
            type: 'Point',
            coordinates: [lon, lat]
          }
        });
      }
      return features;
    }

    /**
     * Dynamically extract all verified hospitals from NETWORK_DATA / bengaluru_network.json.
     * Includes both the registered hospital compounds in `networkData.hospitals` and
     * the trauma hospital nodes in `networkData.nodes` (NIMHANS, Jayadeva, Manipal Old Airport Rd).
     */
    _extractHospitalsFromNetwork(netData) {
      if (!netData) return [];
      const nodesById = new Map();
      for (const n of (netData.nodes || [])) {
        nodesById.set(n.id, n);
      }

      const result = [];
      const seenNames = new Set();

      const formatHospitalLabel = (rawName) => {
        if (!rawName) return 'Hospital';
        if (/Victoria/i.test(rawName)) return 'Victoria Hospital';
        if (/Bowring/i.test(rawName)) return 'Bowring Hospital';
        if (/St\.?\s*John/i.test(rawName)) return "St. John's Hospital";
        if (/St\.?\s*Martha/i.test(rawName)) return "St. Martha's Hospital";
        if (/Mallya/i.test(rawName)) return 'Mallya Hospital';
        if (/Vani\s*Vilas/i.test(rawName)) return 'Vani Vilas Hospital';
        if (/NIMHANS/i.test(rawName)) return 'NIMHANS';
        if (/Jayadeva/i.test(rawName)) return 'Jayadeva Hospital';
        if (/Manipal/i.test(rawName)) return 'Manipal Old Airport Rd';
        return rawName;
      };

      // 1. Registered hospital compounds from NETWORK_DATA.hospitals
      for (const h of (netData.hospitals || [])) {
        const bayPos = h.bays && h.bays.bay_a && h.bays.bay_a.position;
        const fallbackNode = nodesById.get(h.campus_node) || nodesById.get(h.ingress_node);
        const lon = bayPos ? bayPos.lon : (fallbackNode ? fallbackNode.lon : null);
        const lat = bayPos ? bayPos.lat : (fallbackNode ? fallbackNode.lat : null);
        if (!Number.isFinite(lon) || !Number.isFinite(lat)) continue;

        const label = formatHospitalLabel(h.name);
        seenNames.add(label);
        result.push({
          id: h.id,
          name: label,
          fullName: h.name,
          traumaLevel: h.trauma_level || 'Level 1',
          coords: [lon, lat]
        });
      }

      // 2. Additional verified hospital hubs present in NETWORK_DATA.nodes (NIMHANS, Jayadeva, Manipal Old Airport Rd)
      const medicalNodeIds = ['node_nimhans', 'node_jayadeva', 'node_manipal_hospital'];
      for (const nid of medicalNodeIds) {
        const n = nodesById.get(nid);
        if (!n || !Number.isFinite(n.lon) || !Number.isFinite(n.lat)) continue;
        const label = formatHospitalLabel(n.name);
        if (seenNames.has(label)) continue;
        seenNames.add(label);
        result.push({
          id: n.id,
          name: label,
          fullName: n.name,
          traumaLevel: 'Trauma Hub',
          coords: [n.lon, n.lat]
        });
      }

      return result;
    }

    _addHospitalBadges(netData) {
      if (!this.map) return;
      const hospitals = this._extractHospitalsFromNetwork(netData);
      if (hospitals.length === 0) return;

      const primaryHospitalIds = new Set([
        'hosp_victoria_01',
        'hosp_stjohns_01',
        'hosp_bowring_01',
        'node_nimhans',
        'node_jayadeva',
        'node_manipal_hospital'
      ]);

      const primaryFeatures = hospitals
        .filter(h => primaryHospitalIds.has(h.id))
        .map(h => ({
          type: 'Feature',
          properties: { id: h.id, name: h.name, fullName: h.fullName },
          geometry: { type: 'Point', coordinates: h.coords }
        }));

      const secondaryFeatures = hospitals
        .filter(h => !primaryHospitalIds.has(h.id))
        .map(h => ({
          type: 'Feature',
          properties: { id: h.id, name: h.name, fullName: h.fullName },
          geometry: { type: 'Point', coordinates: h.coords }
        }));

      if (!this.map.getSource('hospital-badges')) {
        this.map.addSource('hospital-badges', {
          type: 'geojson',
          data: { type: 'FeatureCollection', features: primaryFeatures }
        });
      }

      if (!this.map.getLayer('hospital-badges-layer')) {
        this.map.addLayer({
          id: 'hospital-badges-layer',
          type: 'symbol',
          source: 'hospital-badges',
          layout: {
            'icon-image': 'hospital-cross-badge',
            'icon-size': 0.85,
            'icon-allow-overlap': true,
            'text-field': ['get', 'name'],
            'text-font': ['Noto Sans Bold'],
            'text-size': 11,
            'text-offset': [0, 1.45],
            'text-anchor': 'top',
            'text-allow-overlap': true
          },
          paint: {
            'text-color': '#fecaca',
            'text-halo-color': '#070b14',
            'text-halo-width': 1.8
          }
        });
      }

      if (secondaryFeatures.length > 0 && !this.map.getSource('secondary-hospital-badges')) {
        this.map.addSource('secondary-hospital-badges', {
          type: 'geojson',
          data: { type: 'FeatureCollection', features: secondaryFeatures }
        });
        this.map.addLayer({
          id: 'secondary-hospital-badges-layer',
          type: 'symbol',
          source: 'secondary-hospital-badges',
          minzoom: 14.8,
          layout: {
            'icon-image': 'hospital-cross-badge',
            'icon-size': 0.72,
            'icon-allow-overlap': false,
            'text-field': ['get', 'name'],
            'text-font': ['Noto Sans Bold'],
            'text-size': 10,
            'text-offset': [0, 1.3],
            'text-anchor': 'top',
            'text-allow-overlap': false,
            'text-optional': true
          },
          paint: {
            'text-color': '#fca5a5',
            'text-halo-color': '#070b14',
            'text-halo-width': 1.6
          }
        });
      }
    }

    _addLandmarkBadges(netData) {
      if (!this.map || !netData || !Array.isArray(netData.nodes)) return;
      const landmarkIds = [
        'node_silk_board',
        'node_majestic',
        'node_kr_market_junction',
        'node_hudson_circle',
        'node_corporation_circle',
        'node_vidhana_soudha',
        'node_hebbal_flyover'
      ];
      const nodesById = new Map(netData.nodes.map(n => [n.id, n]));
      const features = [];

      for (const id of landmarkIds) {
        const n = nodesById.get(id);
        if (!n || !Number.isFinite(n.lon) || !Number.isFinite(n.lat)) continue;
        features.push({
          type: 'Feature',
          properties: { id: n.id, name: n.name.replace(/\s*\(.*?\)\s*/g, '') },
          geometry: { type: 'Point', coordinates: [n.lon, n.lat] }
        });
      }

      if (!this.map.getSource('landmark-badges')) {
        this.map.addSource('landmark-badges', {
          type: 'geojson',
          data: { type: 'FeatureCollection', features }
        });
      }

      if (!this.map.getLayer('landmark-badges-layer')) {
        this.map.addLayer({
          id: 'landmark-badges-layer',
          type: 'symbol',
          source: 'landmark-badges',
          minzoom: 13.5,
          layout: {
            'icon-image': 'landmark-diamond-badge',
            'icon-size': 0.72,
            'icon-allow-overlap': false,
            'text-field': ['get', 'name'],
            'text-font': ['Noto Sans Bold'],
            'text-size': 10,
            'text-offset': [0, -1.25],
            'text-anchor': 'bottom',
            'text-allow-overlap': false,
            'text-optional': true
          },
          paint: {
            'text-color': '#bae6fd',
            'text-halo-color': '#070b14',
            'text-halo-width': 1.5
          }
        });
      }
    }

    _getCongestionMap() {
      if (this.sim && this.sim.lastCongestionMap) {
        return this.sim.lastCongestionMap;
      }
      if (this.sim && typeof this.sim.getCongestionMap === 'function') {
        return this.sim.getCongestionMap();
      }
      return {};
    }

    _getTier1RerouteSet() {
      const set = new Set();
      if (!this.routingController) return set;
      const hist = this.routingController.rerouteHistory || [];
      for (const item of hist) {
        if (item && Array.isArray(item.newRoute)) {
          item.newRoute.forEach(eid => set.add(eid));
        }
      }
      return set;
    }

    _getCurrentRouteEdges() {
      if (this.sim && this.sim.ambulances) {
        const amb = this.sim.ambulances.get('amb_1');
        if (amb && Array.isArray(amb.routeEdgeIds) && amb.routeEdgeIds.length > 0) {
          return amb.routeEdgeIds;
        }
      }
      if (this.routingController && Array.isArray(this.routingController.currentRouteEdges)) {
        return this.routingController.currentRouteEdges;
      }
      return [];
    }

    /**
     * Synchronize signal beacons (2 Hz), green-corridor beam (on route change),
     * targeting beam (10 Hz), priority halo (10 Hz), and road congestion colors (0.5 Hz)
     * to avoid starving MapLibre tile workers.
     */
    syncWithThree(delta = 0.016) {
      if (this._headless || !this.map || !this._layersReady) return;
      this._pulsePhase += delta;
      this._priorityHaloPhase += delta * 2.0; // 2 Hz pulse for priority halo

      const now = (typeof performance !== 'undefined') ? performance.now() : Date.now();
      if (now - this._lastSyncTime < 500) return;
      this._lastSyncTime = now;

      try {
        // 1. Update signal beacons (15 point features)
        const sigSource = this.map.getSource('signal-beacons');
        if (sigSource) {
          sigSource.setData({
            type: 'FeatureCollection',
            features: this._buildSignalFeatures()
          });
        }

        // 2. Update green corridor beam only when route edges change
        const beamSource = this.map.getSource('green-corridor-beam');
        if (beamSource && this.networkData && Array.isArray(this.networkData.edges)) {
          const routeIds = this._getCurrentRouteEdges();
          const beamKey = routeIds.join('|');
          if (beamKey !== this._lastBeamKey) {
            this._lastBeamKey = beamKey;
            const edgeMap = new Map(this.networkData.edges.map(e => [e.id, e]));
            const beamFeatures = [];
            for (const eid of routeIds) {
              const e = edgeMap.get(eid);
              if (e && Array.isArray(e.polyline) && e.polyline.length >= 2) {
                beamFeatures.push({
                  type: 'Feature',
                  properties: { id: eid },
                  geometry: {
                    type: 'LineString',
                    coordinates: e.polyline.map(pt => [pt[0], pt[1]])
                  }
                });
              }
            }
            beamSource.setData({ type: 'FeatureCollection', features: beamFeatures });
          }
        }

        // 3. Stage 7: Update targeting beam - dashed line from ambulance to next signal within 350m
        this._updateTargetingBeam();

        // 4. Stage 7: Update priority halo on targeted signal when Tier-2 preemption activates (≤250m)
        this._updatePriorityHalo();

        // 5. Update road congestion colors every 2.5s
        if (now - this._lastCorridorSyncTime >= 2500) {
          this._lastCorridorSyncTime = now;
          const corrSource = this.map.getSource('network-corridors');
          if (corrSource && this.networkData) {
            corrSource.setData({
              type: 'FeatureCollection',
              features: this._buildCorridorFeatures(this.networkData)
            });
          }
        }
      } catch (e) {
        console.warn('MapRenderer: syncWithThree error', e);
      }
    }

    /**
     * Stage 7: Update targeting beam - dashed line from ambulance to next signal within 350m.
     * Called every frame to track the next signal on the ambulance's route.
     */
    _updateTargetingBeam() {
      const beamSource = this.map.getSource('targeting-beam');
      if (!beamSource || !this.sim || !this.sim.ambulances || !this.routingController) return;

      const amb = this.sim.ambulances.get('amb_1');
      if (!amb) return;

      // Get ambulance position and route
      const ambVeh = this.sim.vehicles.get('amb_1');
      if (!ambVeh || !ambVeh.edge) return;

      const routeEdges = this.routingController.currentRouteEdges || [];
      if (routeEdges.length === 0) return;

      // Find current edge index in route
      const currentEdgeId = ambVeh.edge.id;
      let currentIndex = routeEdges.indexOf(currentEdgeId);
      if (currentIndex === -1) currentIndex = 0;

      // Look ahead along route for next signalized junction (within 3500m)
      const TARGET_HORIZON_M = 3500;
      let accumulatedDistance = 0;
      let targetSignal = null;
      let targetDistance = 0;
      let targetETA = 0;
      const speedMps = Math.max(5, ambVeh.v || 14);

      // First check if current edge has signal at its end
      const currentEdge = this.sim.network.getEdge(currentEdgeId);
      if (currentEdge) {
        const remainingOnEdge = Math.max(0, currentEdge.length - ambVeh.s);
        accumulatedDistance = remainingOnEdge;
        const toNodeId = currentEdge.toNodeId || currentEdge.to_node;
        const toNode = toNodeId ? this.sim.network.getNode(toNodeId) : null;
        const sig = (this.signalManager && toNodeId)
          ? (this.signalManager.getSignalByNode(toNodeId) || (toNode && toNode.signals && toNode.signals[0] ? this.signalManager.getSignal(toNode.signals[0]) : null))
          : null;
        if (sig && accumulatedDistance <= TARGET_HORIZON_M) {
          targetSignal = sig.id;
          targetDistance = accumulatedDistance;
          targetETA = targetDistance / speedMps;
        }
      }

      // If no signal on current edge, look ahead on subsequent edges
      if (!targetSignal) {
        for (let i = currentIndex + 1; i < routeEdges.length; i += 1) {
          const edgeId = routeEdges[i];
          const edge = this.sim.network.getEdge(edgeId);
          if (!edge) continue;

          const edgeLength = edge.length || 0;
          accumulatedDistance += edgeLength;

          if (accumulatedDistance > TARGET_HORIZON_M) break;

          const toNodeId = edge.toNodeId || edge.to_node;
          const toNode = toNodeId ? this.sim.network.getNode(toNodeId) : null;
          const sig = (this.signalManager && toNodeId)
            ? (this.signalManager.getSignalByNode(toNodeId) || (toNode && toNode.signals && toNode.signals[0] ? this.signalManager.getSignal(toNode.signals[0]) : null))
            : null;
          if (sig) {
            targetSignal = sig.id;
            targetDistance = accumulatedDistance;
            targetETA = targetDistance / speedMps;
            break;
          }
        }
      }

      this._targetSignalId = targetSignal;
      this._targetSignalDistance = targetDistance;
      this._targetSignalETA = targetETA;

      // Build targeting beam feature along route polyline from ambulance to target signal
      if (targetSignal && this.projection) {
        const ambSample = ambVeh.edge.sampleAt(ambVeh.s);
        const coords = [[ambSample.lon, ambSample.lat]];

        // Trace remaining route edges up to targetSignal
        for (let i = currentIndex; i < routeEdges.length; i += 1) {
          const edge = this.sim.network.getEdge(routeEdges[i]);
          if (!edge || !Array.isArray(edge.polyline)) continue;
          for (let p = 0; p < edge.polyline.length; p += 1) {
            if (i === currentIndex && edge.cumulative && edge.cumulative[p] <= ambVeh.s) continue;
            coords.push([edge.polyline[p][0], edge.polyline[p][1]]);
          }
          const toNodeId = edge.toNodeId || edge.to_node;
          const toNode = toNodeId ? this.sim.network.getNode(toNodeId) : null;
          const sig = (this.signalManager && toNodeId)
            ? (this.signalManager.getSignalByNode(toNodeId) || (toNode && toNode.signals && toNode.signals[0] ? this.signalManager.getSignal(toNode.signals[0]) : null))
            : null;
          if (sig && sig.id === targetSignal) break;
        }

        const signal = this.signalManager.getSignal(targetSignal);
        if (signal && signal.worldPos) {
          const sigGeo = this.projection.cartesianToLatLonAlt(signal.worldPos.x, signal.worldPos.y || 0, signal.worldPos.z);
          coords.push([sigGeo.lon, sigGeo.lat]);
        }

        if (coords.length >= 2) {
          const beamFeature = {
            type: 'Feature',
            properties: { signalId: targetSignal, distance: targetDistance, eta: targetETA },
            geometry: {
              type: 'LineString',
              coordinates: coords
            }
          };
          beamSource.setData({ type: 'FeatureCollection', features: [beamFeature] });
        } else {
          beamSource.setData({ type: 'FeatureCollection', features: [] });
        }
      } else {
        beamSource.setData({ type: 'FeatureCollection', features: [] });
      }
    }

    /**
     * Stage 7: Update priority halo on targeted signal when Tier-2 preemption activates (≤250m).
     * Pulsing ring around the signal beacon.
     */
    _updatePriorityHalo() {
      const haloSource = this.map.getSource('priority-halo');
      if (!haloSource) return;
      if (!this._targetSignalId || !this.signalManager) {
        haloSource.setData({ type: 'FeatureCollection', features: [] });
        return;
      }

      // Check if target signal is within 250m and has Tier-2 preemption active
      const signal = this.signalManager.getSignal(this._targetSignalId);
      const isPreempted = signal && (signal.isPreempted || signal.currentPhase === 'PREEMPT_GREEN');
      const withinRange = this._targetSignalDistance <= 250 && this._targetSignalDistance > 0;

      if (isPreempted && withinRange) {
        // Calculate pulse animation (0.5 to 1.5 scale, opacity 0.3 to 0.8)
        const pulse = Math.sin(this._priorityHaloPhase * Math.PI * 2);
        const pulseScale = 0.5 + (pulse + 1) * 0.5; // 0.5 to 1.5
        const pulseOpacity = 0.3 + (pulse + 1) * 0.25; // 0.3 to 0.8

        if (this.projection && signal && signal.worldPos) {
          const sigGeo = this.projection.cartesianToLatLonAlt(signal.worldPos.x, signal.worldPos.y || 0, signal.worldPos.z);
          const haloFeature = {
            type: 'Feature',
            properties: { pulseScale, pulseOpacity },
            geometry: {
              type: 'Point',
              coordinates: [sigGeo.lon, sigGeo.lat]
            }
          };
          haloSource.setData({ type: 'FeatureCollection', features: [haloFeature] });
        }
      } else {
        haloSource.setData({ type: 'FeatureCollection', features: [] });
      }
    }

    getMap() {
      return this.map || null;
    }

    isInitialized() {
      return !this._headless && this._initialized;
    }

    updateCongestion() {
      this._lastSyncTime = 0;
      this.syncWithThree(0);
    }
  }

  if (typeof window !== 'undefined') {
    window.mapRenderer = new MapRenderer();
  }

  return MapRenderer;
}));
