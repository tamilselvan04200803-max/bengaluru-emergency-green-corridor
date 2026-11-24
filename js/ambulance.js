/**
 * js/ambulance.js
 * Bengaluru Emergency Green Corridor 3D Digital Twin — Dual-Mode Ambulance Controller
 * Procedural 3D ambulance model, authentic pitch/roll suspension kinematics,
 * dual-mode navigation (10Hz WebSocket client + standalone autonomous fallback),
 * WASD vehicle driving physics (speed cap 100 km/h, braking priority, 35 deg steering),
 * emergency beacon LED strobes, forward clearance cone sensor, and siren integration.
 * Browser-global (window.AmbulanceManager) & CommonJS (Node.js) compatible.
 */

(function (root, factory) {
  if (typeof define === 'function' && define.amd) {
    define([], factory);
  } else if (typeof module === 'object' && module.exports) {
    module.exports = factory();
  } else {
    const exportsObj = factory();
    root.AmbulanceManager = exportsObj.AmbulanceManager;
    root.AmbulanceController = exportsObj.AmbulanceManager;
  }
}(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  const AMB_CONSTANTS = {
    MAX_SPEED_KMH: 100.0,
    MAX_REVERSE_SPEED_KMH: 25.0,
    ACCELERATION_MPS2: 8.5,
    BRAKE_MPS2: 14.0,
    HANDBRAKE_MPS2: 22.0,
    ROLLING_FRICTION_MPS2: 3.5,
    MAX_STEER_DEG: 35.0,
    STEER_SPEED_RAD_S: 2.8,
    STEER_RETURN_SPEED_RAD_S: 3.5,
    WHEELBASE_M: 3.2,
    CLEARANCE_RANGE_M: 80.0,
    CLEARANCE_FOV_RAD: 0.70, // ~40 degrees
    STROBE_RATE_HZ: 4.0,
    STROBE_POINT_RANGE: 25.0,
    STROBE_POINT_INTENSITY: 3.5,
    MAX_PITCH_RAD: Math.PI / 6.0, // ±30 deg
    MAX_ROLL_RAD: Math.PI / 8.0,  // ±22.5 deg (clamped)
    WS_DEFAULT_URL: 'ws://127.0.0.1:8765',
    WS_RECONNECT_INTERVAL_MS: 3000
  };

  // Load routing module (Node.js/CommonJS compatibility)
  let RoadGraph = null;
  let RoutePlanner = null;
  let SmartRoutingController = null;
  let networkData = null;

  function loadRoutingModule() {
    if (RoadGraph && RoutePlanner && SmartRoutingController) {
      return { RoadGraph, RoutePlanner, SmartRoutingController };
    }
    // Try to load from local file
    try {
      if (typeof require === 'function') {
        const routing = require('./routing.js');
        RoadGraph = routing.RoadGraph;
        RoutePlanner = routing.RoutePlanner;
        SmartRoutingController = routing.SmartRoutingController;
      }
    } catch (e) {
      // Check global (browser with script tags)
      if (typeof root !== 'undefined' && root.RoadGraph) {
        RoadGraph = root.RoadGraph;
        RoutePlanner = root.RoutePlanner;
        SmartRoutingController = root.SmartRoutingController;
      }
    }
    return { RoadGraph, RoutePlanner, SmartRoutingController };
  }

  function loadNetworkData() {
    if (networkData) return networkData;
    try {
      if (typeof require === 'function') {
        networkData = require('./Data/GeoJSON/bengaluru_network.json');
      } else if (typeof NETWORK_DATA !== 'undefined') {
        networkData = NETWORK_DATA;
      }
    } catch (e) {
      console.warn('Could not load network data');
    }
    return networkData;
  }

  class AmbulanceManager {
    /**
     * @param {THREE.Scene} scene - Three.js scene graph
     * @param {GeoProjection} projection - Coordinate projection transformer
     * @param {SignalManager} [signals=null] - Traffic signals manager
     * @param {Object} [options]
     */
    constructor(scene, projection, signals = null, options = {}) {
      this.scene = scene;
      this.projection = projection;
      this.signals = signals;
      this.options = options;

      // Position, Heading & Kinematics
      this.position = (typeof THREE !== 'undefined') ? new THREE.Vector3(0, 0, 0) : { x: 0, y: 0, z: 0 };
      this.headingDeg = 90.0; // Azimuth: 0 = North (-Z), 90 = East (+X)
      this.headingRad = (this.headingDeg * Math.PI) / 180.0;
      this.speedKmh = 0.0;
      this.speedMps = 0.0;
      this.accelerationMps2 = 0.0;
      this.steeringAngleDeg = 0.0;
      this.steeringAngleRad = 0.0;

      // Suspension Tilt
      this.pitchRad = 0.0;
      this.rollRad = 0.0;
      this.targetPitchRad = 0.0;
      this.targetRollRad = 0.0;

      // Operational Modes
      this.isManual = false; // false = Autonomous, true = Manual WASD
      this.sirenActive = true;
      this.priorityActive = true;
      this.strobeTimer = 0.0;

      // Active Telemetry / Corridor State
      this.vehicleId = 'AMB-108-01';
      this.criticalityTier = 1;
      this.destinationHospital = options.destinationHospital || 'hosp_victoria_01';
      this.activeRouteJunctions = [
        'signal_majestic_cross',
        'signal_sheshadri_junction',
        'signal_kr_circle',
        'signal_st_marthas',
        'signal_hudson_circle',
        'signal_corporation_circle',
        'signal_kr_market',
        'signal_victoria_hospital_gate'
      ];

      // Smart Routing Integration (Stage 2)
      this.smartRouting = null;
      this.routeRenderer = null;
      this.currentRouteInfo = null;
      this.simulationTime = 0;

      // Stage 4: when attached to a SimulationEngine the deterministic sim is
      // the single authority over position, heading and speed. The browser
      // fallback waypoint engine is disabled so the live app can never silently
      // revert to the legacy internal navigation.
      this.simDriven = false;
      this.simBridge = null;
      this.initSmartRouting();

      // Autonomous Waypoints Engine (offline fallback only)
      this.waypoints = [];
      this.currentWaypointIndex = 0;
      this.autonomousCruisingSpeedKmh = 50.0;
      this.initCorridorWaypoints();

      // Keyboard Input State
      this.keys = {
        w: false,
        s: false,
        a: false,
        d: false,
        space: false
      };
      this.initKeyboardListeners();

      // Audio Siren Synthesizer
      this.initAudioSynthesizer();

      // Procedural 3D Mesh Construction
      this.mesh = null;
      this.chassisGroup = null;
      this.leftStrobeMesh = null;
      this.rightStrobeMesh = null;
      this.leftPointLight = null;
      this.rightPointLight = null;
      this.wheels = [];
      this.buildAmbulanceMesh();

      // WebSocket Ingestion & Graceful Fallback
      this.ws = null;
      this.isWsConnected = false;
      this.wsUrl = (typeof CONFIG !== 'undefined' && CONFIG.TELEMETRY && CONFIG.TELEMETRY.wsUrl)
        ? CONFIG.TELEMETRY.wsUrl
        : AMB_CONSTANTS.WS_DEFAULT_URL;
      this.initWebSocketClient();
    }

    /**
     * Initializes autonomous route waypoints from road network GeoJSON.
     */
    initCorridorWaypoints() {
      let roadsData = null;
      if (typeof ROADS_DATA !== 'undefined') {
        roadsData = ROADS_DATA;
      } else if (typeof global !== 'undefined' && global.ROADS_DATA) {
        roadsData = global.ROADS_DATA;
      }

      if (roadsData && roadsData.features && this.projection) {
        // Priority corridor sequence: Majestic -> Seshadri -> KR Circle -> Nrupathunga -> Hudson -> Corp -> Victoria
        const corridorRoadIds = [
          'way_seshadri_01',
          'way_seshadri_02',
          'way_nrupathunga_01',
          'way_nrupathunga_02',
          'way_hudson_to_corp',
          'way_nr_road_01',
          'way_fort_victoria_01',
          'way_fort_victoria_02'
        ];

        const roadMap = new Map();
        roadsData.features.forEach(f => roadMap.set(f.id || f.properties.id, f));

        corridorRoadIds.forEach(id => {
          const road = roadMap.get(id);
          if (road && road.geometry && road.geometry.coordinates) {
            road.geometry.coordinates.forEach(coord => {
              const pt = this.projection.latLonAltToCartesian(coord[1], coord[0], coord[2]);
              // Deduplicate sequential points
              if (this.waypoints.length === 0) {
                this.waypoints.push(pt);
              } else {
                const prev = this.waypoints[this.waypoints.length - 1];
                const dist = Math.hypot(pt.x - prev.x, pt.z - prev.z);
                if (dist > 1.0) {
                  this.waypoints.push(pt);
                }
              }
            });
          }
        });
      }

      // Fallback synthetic waypoints if GeoJSON is absent
      if (this.waypoints.length === 0) {
        const defaultCoords = [
          { x: -2360.0, y: 2.0, z: -689.0 },
          { x: -2100.0, y: 1.8, z: -620.0 },
          { x: -1600.0, y: 1.5, z: -450.0 },
          { x: -800.0, y: 2.5, z: -250.0 },
          { x: 0.0, y: 2.5, z: 0.0 },
          { x: 50.0, y: 1.8, z: 250.0 },
          { x: 70.0, y: 0.9, z: 500.0 },
          { x: 30.0, y: 0.1, z: 650.0 },
          { x: -1100.0, y: -3.5, z: 750.0 },
          { x: -2000.0, y: -5.2, z: 1000.0 }
        ];
        this.waypoints = defaultCoords;
      }

      // Anchor initial vehicle position to first waypoint
      if (this.waypoints.length > 0) {
        const start = this.waypoints[0];
        this.position.x = start.x;
        // FIXED: Road deck is at y=0.0 in Three.js scene. Ambulance wheel centers at y=0.42
        this.position.y = 0.42;
        this.position.z = start.z;

        if (this.waypoints.length > 1) {
          const next = this.waypoints[1];
          const dx = next.x - start.x;
          const dz = next.z - start.z;
          this.headingDeg = (Math.atan2(dx, -dz) * 180.0) / Math.PI;
          if (this.headingDeg < 0) this.headingDeg += 360.0;
          this.headingRad = (this.headingDeg * Math.PI) / 180.0;
        }
      }
    }

    /**
     * Initializes Smart Routing Controller (Stage 2).
     */
    initSmartRouting() {
      const routing = loadRoutingModule();
      const netData = loadNetworkData();

      if (!routing.RoadGraph || !routing.RoutePlanner || !routing.SmartRoutingController || !netData) {
        console.warn('Smart Routing: Required modules or data not available');
        return;
      }

      try {
        const graph = new routing.RoadGraph(netData);
        const planner = new routing.RoutePlanner(graph);
        const controller = new routing.SmartRoutingController(planner, graph, this.signals, {
          minRerouteSavingSec: 20.0,
          minRerouteIntervalSec: 30.0,
          hysteresisFactor: 1.15,
          priorityHorizonM: 250.0,
          priorityLeadTimeSec: 25.0,
          congestionUpdateIntervalSec: 30.0
        });

        // Determine destination node based on hospital
        let destinationNode = 'node_victoria_hospital_gate';
        if (this.destinationHospital === 'hosp_stjohns_01') {
          destinationNode = 'node_st_johns';
        } else if (this.destinationHospital === 'hosp_bowring_01') {
          destinationNode = 'node_bowring_hospital_gate';
        } else if (this.destinationHospital === 'hosp_stmarthas_01') {
          destinationNode = 'node_st_marthas';
        } else if (this.destinationHospital === 'hosp_mallya_01') {
          destinationNode = 'node_kasturba_cross';
        } else if (this.destinationHospital === 'hosp_vanivilas_01') {
          destinationNode = 'node_victoria_hospital_gate';
        }

        // Set initial position node
        const startNode = this.findClosestNode(graph);
        if (startNode) {
          controller.setDestination(destinationNode);

          // Initial route computation
          const initialRoute = controller.computeRoute(startNode, destinationNode, { isPreempted: true });
          if (initialRoute.path.length > 0) {
            controller.currentRoute = initialRoute;
            controller.currentRouteEdges = initialRoute.path;
            controller.currentRouteTime = initialRoute.totalTime;
            controller.lastRerouteTime = 0;
          }
        }

        this.smartRouting = controller;

        // Create route renderer
        this.createRouteRenderer(graph);
      } catch (e) {
        console.error('Smart Routing initialization failed:', e);
      }
    }

    /**
     * Finds the closest graph node to the ambulance's current position.
     */
    findClosestNode(graph) {
      if (!graph || graph.nodes.size === 0) return null;

      let closestNode = null;
      let minDist = Infinity;

      for (const [nodeId, node] of graph.nodes) {
        if (node.worldPos) {
          const dx = node.worldPos.x - this.position.x;
          const dz = node.worldPos.z - this.position.z;
          const dist = Math.hypot(dx, dz);
          if (dist < minDist) {
            minDist = dist;
            closestNode = nodeId;
          }
        }
      }

      return closestNode;
    }

    /**
     * Creates a Three.js line renderer for visualizing the current route.
     */
    createRouteRenderer(graph) {
      if (typeof THREE === 'undefined' || !this.scene) return;

      const material = new THREE.LineBasicMaterial({
        color: 0x00ff88,
        opacity: 0.8,
        transparent: true,
        linewidth: 3
      });

      this.routeRenderer = {
        mesh: null,
        material: material,
        update: (routeEdges) => {
          if (!routeEdges || routeEdges.length === 0) return;

          const points = [];
          for (const edgeId of routeEdges) {
            const edge = graph.getEdge(edgeId);
            if (edge && edge.geometry && edge.geometry.coordinates) {
              edge.geometry.coordinates.forEach(coord => {
                const pt = this.projection.latLonAltToCartesian(coord[1], coord[0], coord[2]);
                points.push(new THREE.Vector3(pt.x, pt.y + 0.5, pt.z));
              });
            }
          }

          if (points.length < 2) return;

          const geometry = new THREE.BufferGeometry().setFromPoints(points);

          if (this.routeRenderer.mesh) {
            this.scene.remove(this.routeRenderer.mesh);
            this.routeRenderer.mesh.geometry.dispose();
          }

          this.routeRenderer.mesh = new THREE.Line(geometry, material);
          this.routeRenderer.mesh.name = 'RouteRenderer';
          this.scene.add(this.routeRenderer.mesh);
        },
        clear: () => {
          if (this.routeRenderer.mesh) {
            this.scene.remove(this.routeRenderer.mesh);
            this.routeRenderer.mesh.geometry.dispose();
            this.routeRenderer.mesh = null;
          }
        }
      };
    }

    /**
     * Initializes keyboard listeners for WASD driving physics.
     */
    initKeyboardListeners() {
      if (typeof window === 'undefined') return;

      window.addEventListener('keydown', (e) => {
        if (e.target && (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA')) return;
        const key = e.key.toLowerCase();
        if (key === 'w' || key === 'arrowup') this.keys.w = true;
        if (key === 's' || key === 'arrowdown') this.keys.s = true;
        if (key === 'a' || key === 'arrowleft') this.keys.a = true;
        if (key === 'd' || key === 'arrowright') this.keys.d = true;
        if (key === ' ') {
          this.keys.space = true;
          e.preventDefault();
        }
      });

      window.addEventListener('keyup', (e) => {
        const key = e.key.toLowerCase();
        if (key === 'w' || key === 'arrowup') this.keys.w = false;
        if (key === 's' || key === 'arrowdown') this.keys.s = false;
        if (key === 'a' || key === 'arrowleft') this.keys.a = false;
        if (key === 'd' || key === 'arrowright') this.keys.d = false;
        if (key === ' ') this.keys.space = false;
      });
    }

    /**
     * Instantiates audio synthesizer.
     */
    initAudioSynthesizer() {
      if (typeof SirenSynthesizer !== 'undefined') {
        this.audio = new SirenSynthesizer({ volume: 0.28, mode: 'wail' });
      } else if (typeof root !== 'undefined' && root.SirenSynthesizer) {
        this.audio = new root.SirenSynthesizer({ volume: 0.28, mode: 'wail' });
      } else {
        this.audio = null;
      }
    }

    /**
     * Procedural 3D ambulance mesh construction.
     */
    buildAmbulanceMesh() {
      if (typeof THREE === 'undefined') return;

      this.mesh = new THREE.Group();
      this.mesh.name = 'AmbulanceRoot';
      this.mesh.position.set(this.position.x, this.position.y, this.position.z);

      // Chassis group handles local pitch & roll suspension dynamics
      this.chassisGroup = new THREE.Group();
      this.chassisGroup.name = 'AmbulanceChassis';
      this.mesh.add(this.chassisGroup);

      // Materials
      const bodyWhiteMat = new THREE.MeshStandardMaterial({
        color: 0xf8f9fa,
        roughness: 0.25,
        metalness: 0.15,
        name: 'ambWhiteChassis'
      });

      const stripeRedMat = new THREE.MeshStandardMaterial({
        color: 0xdc2626,
        roughness: 0.35,
        metalness: 0.10,
        name: 'ambRedStripe'
      });

      const glassMat = new THREE.MeshStandardMaterial({
        color: 0x1e293b,
        roughness: 0.10,
        metalness: 0.90,
        transparent: true,
        opacity: 0.85,
        name: 'ambGlass'
      });

      const bumperMat = new THREE.MeshStandardMaterial({
        color: 0x334155,
        roughness: 0.65,
        metalness: 0.50,
        name: 'ambBumper'
      });

      const wheelRubberMat = new THREE.MeshStandardMaterial({
        color: 0x111827,
        roughness: 0.85,
        metalness: 0.10,
        name: 'ambWheelRubber'
      });

      const rimMat = new THREE.MeshStandardMaterial({
        color: 0x94a3b8,
        roughness: 0.25,
        metalness: 0.85,
        name: 'ambRim'
      });

      // 1. Lower chassis frame
      const chassisGeo = new THREE.BoxGeometry(2.1, 0.45, 5.2);
      const chassisMesh = new THREE.Mesh(chassisGeo, bumperMat);
      chassisMesh.position.y = 0.45;
      this.chassisGroup.add(chassisMesh);

      // 2. Front Driver Cab
      const cabGeo = new THREE.BoxGeometry(2.1, 1.45, 1.8);
      const cabMesh = new THREE.Mesh(cabGeo, bodyWhiteMat);
      cabMesh.position.set(0, 1.35, 1.6);
      this.chassisGroup.add(cabMesh);

      // 3. Sloped Windshield
      const windshieldGeo = new THREE.BoxGeometry(1.95, 0.75, 0.1);
      const windshieldMesh = new THREE.Mesh(windshieldGeo, glassMat);
      windshieldMesh.position.set(0, 1.60, 2.52);
      windshieldMesh.rotation.x = -Math.PI / 8.0;
      this.chassisGroup.add(windshieldMesh);

      // 4. Rear Patient Compartment Box
      const boxGeo = new THREE.BoxGeometry(2.2, 1.95, 3.4);
      const boxMesh = new THREE.Mesh(boxGeo, bodyWhiteMat);
      boxMesh.position.set(0, 1.62, -0.9);
      this.chassisGroup.add(boxMesh);

      // 5. Red Emergency Stripes along flank
      const stripeGeoL = new THREE.BoxGeometry(0.04, 0.25, 5.0);
      const stripeMeshL = new THREE.Mesh(stripeGeoL, stripeRedMat);
      stripeMeshL.position.set(-1.12, 1.25, 0.0);
      this.chassisGroup.add(stripeMeshL);

      const stripeMeshR = new THREE.Mesh(stripeGeoL, stripeRedMat);
      stripeMeshR.position.set(1.12, 1.25, 0.0);
      this.chassisGroup.add(stripeMeshR);

      // 6. Red Cross Decals on Patient Module Flanks
      const makeCross = () => {
        const g = new THREE.Group();
        const vGeo = new THREE.BoxGeometry(0.03, 0.60, 0.20);
        const hGeo = new THREE.BoxGeometry(0.03, 0.20, 0.60);
        const vM = new THREE.Mesh(vGeo, stripeRedMat);
        const hM = new THREE.Mesh(hGeo, stripeRedMat);
        g.add(vM);
        g.add(hM);
        return g;
      };

      const crossL = makeCross();
      crossL.position.set(-1.12, 1.80, -0.9);
      this.chassisGroup.add(crossL);

      const crossR = makeCross();
      crossR.position.set(1.12, 1.80, -0.9);
      this.chassisGroup.add(crossR);

      // 7. Roof Lightbar & Emergency Strobes
      const lightbarGeo = new THREE.BoxGeometry(1.6, 0.18, 0.35);
      const lightbarBase = new THREE.Mesh(lightbarGeo, bumperMat);
      lightbarBase.position.set(0, 2.68, 0.6);
      this.chassisGroup.add(lightbarBase);

      // Left Red Strobe Lens
      const strobeGeo = new THREE.BoxGeometry(0.65, 0.16, 0.32);
      const redStrobeMat = new THREE.MeshStandardMaterial({
        color: 0xff0033,
        emissive: 0xff0033,
        emissiveIntensity: 3.5,
        roughness: 0.1,
        transparent: true,
        opacity: 0.95
      });
      this.leftStrobeMesh = new THREE.Mesh(strobeGeo, redStrobeMat);
      this.leftStrobeMesh.position.set(-0.45, 2.70, 0.6);
      this.chassisGroup.add(this.leftStrobeMesh);

      // Right Blue Strobe Lens
      const blueStrobeMat = new THREE.MeshStandardMaterial({
        color: 0x0066ff,
        emissive: 0x0066ff,
        emissiveIntensity: 3.5,
        roughness: 0.1,
        transparent: true,
        opacity: 0.95
      });
      this.rightStrobeMesh = new THREE.Mesh(strobeGeo, blueStrobeMat);
      this.rightStrobeMesh.position.set(0.45, 2.70, 0.6);
      this.chassisGroup.add(this.rightStrobeMesh);

      // Synchronized 3D Point Lights
      this.leftPointLight = new THREE.PointLight(0xff0033, AMB_CONSTANTS.STROBE_POINT_INTENSITY, AMB_CONSTANTS.STROBE_POINT_RANGE, 2.0);
      this.leftPointLight.position.set(-0.6, 2.8, 0.6);
      this.chassisGroup.add(this.leftPointLight);

      this.rightPointLight = new THREE.PointLight(0x0066ff, AMB_CONSTANTS.STROBE_POINT_INTENSITY, AMB_CONSTANTS.STROBE_POINT_RANGE, 2.0);
      this.rightPointLight.position.set(0.6, 2.8, 0.6);
      this.chassisGroup.add(this.rightPointLight);

      // 8. Front Headlights & Rear Tail Lights
      const headlightGeo = new THREE.BoxGeometry(0.35, 0.20, 0.10);
      const headlightMat = new THREE.MeshStandardMaterial({
        color: 0xffffee,
        emissive: 0xffffee,
        emissiveIntensity: 2.5
      });
      const hlL = new THREE.Mesh(headlightGeo, headlightMat);
      hlL.position.set(-0.80, 0.68, 2.58);
      const hlR = new THREE.Mesh(headlightGeo, headlightMat);
      hlR.position.set(0.80, 0.68, 2.58);
      this.chassisGroup.add(hlL);
      this.chassisGroup.add(hlR);

      // 9. 4 Wheels
      const wheelGeo = new THREE.CylinderGeometry(0.42, 0.42, 0.32, 16);
      wheelGeo.rotateZ(Math.PI / 2.0);

      const wheelPositions = [
        { x: -1.05, y: 0.42, z: 1.6, isFront: true, isLeft: true },
        { x: 1.05, y: 0.42, z: 1.6, isFront: true, isLeft: false },
        { x: -1.05, y: 0.42, z: -1.6, isFront: false, isLeft: true },
        { x: 1.05, y: 0.42, z: -1.6, isFront: false, isLeft: false }
      ];

      wheelPositions.forEach((wp, idx) => {
        const wGroup = new THREE.Group();
        wGroup.position.set(wp.x, wp.y, wp.z);

        const rubberMesh = new THREE.Mesh(wheelGeo, wheelRubberMat);
        const rimGeo = new THREE.CylinderGeometry(0.24, 0.24, 0.33, 12);
        rimGeo.rotateZ(Math.PI / 2.0);
        const rimMesh = new THREE.Mesh(rimGeo, rimMat);

        wGroup.add(rubberMesh);
        wGroup.add(rimMesh);
        this.chassisGroup.add(wGroup);

        this.wheels.push({
          group: wGroup,
          rubberMesh,
          isFront: wp.isFront
        });
      });

      // 10. Front and Rear Bumpers
      const frontBumperGeo = new THREE.BoxGeometry(2.2, 0.30, 0.25);
      const frontBumper = new THREE.Mesh(frontBumperGeo, bumperMat);
      frontBumper.position.set(0, 0.42, 2.65);
      this.chassisGroup.add(frontBumper);

      const rearBumper = new THREE.Mesh(frontBumperGeo, bumperMat);
      rearBumper.position.set(0, 0.42, -2.65);
      this.chassisGroup.add(rearBumper);

      // Add entire ambulance to Three.js scene
      if (this.scene) {
        this.scene.add(this.mesh);
      }
    }

    /**
     * Initializes real-time 10Hz WebSocket client with auto-reconnection.
     */
    initWebSocketClient() {
      // In headless Node.js testing environment without window, skip background WS auto-connect
      if (typeof window === 'undefined') {
        this.isWsConnected = false;
        return;
      }
      if (typeof WebSocket === 'undefined') return;

      const connect = () => {
        try {
          this.ws = new WebSocket(this.wsUrl);

          this.ws.onopen = () => {
            this.isWsConnected = true;
            this.updateBadgeUI('CONNECTED 10Hz', '#10b981');
          };

          this.ws.onmessage = (event) => {
            try {
              const data = JSON.parse(event.data);
              if (data && data.latitude && data.longitude) {
                this.setAutonomousTelemetry(data);
              }
            } catch (err) {}
          };

          this.ws.onclose = () => {
            this.isWsConnected = false;
            this.updateBadgeUI('STANDALONE 10Hz', '#38bdf8');
            this.scheduleReconnect(connect);
          };

          this.ws.onerror = () => {
            this.isWsConnected = false;
            try { this.ws.close(); } catch (e) {}
          };
        } catch (e) {
          this.isWsConnected = false;
          this.scheduleReconnect(connect);
        }
      };

      connect();
    }

    scheduleReconnect(connectFn) {
      if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
      this.reconnectTimer = setTimeout(connectFn, AMB_CONSTANTS.WS_RECONNECT_INTERVAL_MS);
      if (this.reconnectTimer && typeof this.reconnectTimer.unref === 'function') {
        this.reconnectTimer.unref();
      }
    }

    dispose() {
      if (this.reconnectTimer) {
        clearTimeout(this.reconnectTimer);
        this.reconnectTimer = null;
      }
      if (this.ws) {
        try { this.ws.close(); } catch (e) {}
        this.ws = null;
      }
      if (this.audio) {
        try { this.audio.stop(); } catch (e) {}
      }
    }

    updateBadgeUI(text, color) {
      if (typeof document === 'undefined') return;
      const badge = document.getElementById('telemetry-badge');
      if (badge) {
        badge.innerText = text;
        badge.style.borderColor = color;
      }
    }

    /**
     * Ingests 10Hz kinematics telemetry frame from WebSocket server.
     */
    setAutonomousTelemetry(data) {
      if (this.isManual) return; // Manual drive overrides telemetry

      if (data.vehicle_id) this.vehicleId = data.vehicle_id;
      if (data.patient_criticality_tier) this.criticalityTier = data.patient_criticality_tier;
      if (data.destination_hospital_id) this.destinationHospital = data.destination_hospital_id;
      if (data.green_wave_junction_ids) this.activeRouteJunctions = data.green_wave_junction_ids;

      if (this.projection && data.latitude !== undefined && data.longitude !== undefined) {
        const alt = data.altitude !== undefined ? data.altitude : 920.0;
        const targetPos = this.projection.latLonAltToCartesian(data.latitude, data.longitude, alt);

        // Smooth dead-reckoning lerp
        this.position.x += (targetPos.x - this.position.x) * 0.45;
        this.position.y += (targetPos.y - this.position.y) * 0.45;
        this.position.z += (targetPos.z - this.position.z) * 0.45;
      }

      if (data.speed_kmh !== undefined) {
        this.speedKmh = Math.min(AMB_CONSTANTS.MAX_SPEED_KMH, Math.max(0.0, data.speed_kmh));
        this.speedMps = (this.speedKmh * 1000.0) / 3600.0;
      }

      if (data.heading !== undefined) {
        this.headingDeg = data.heading;
        this.headingRad = (this.headingDeg * Math.PI) / 180.0;
      }

      if (data.priority_active !== undefined) {
        this.priorityActive = Boolean(data.priority_active);
      }
    }

    /**
     * Client-side autonomous navigation along georeferenced road network.
     * Engaged when WebSocket is disconnected or offline (graceful fallback).
     */
    updateInternalSimulation(dt) {
      if (this.waypoints.length === 0) return;

      const targetPt = this.waypoints[this.currentWaypointIndex];
      const dx = targetPt.x - this.position.x;
      const dz = targetPt.z - this.position.z;
      const dist = Math.hypot(dx, dz);

      // Waypoint arrival threshold
      if (dist < 8.0) {
        this.currentWaypointIndex = (this.currentWaypointIndex + 1) % this.waypoints.length;
      }

      // Desired heading to next waypoint
      const desiredHeadingDeg = (Math.atan2(dx, -dz) * 180.0) / Math.PI;
      const normDesired = (desiredHeadingDeg + 360.0) % 360.0;
      const normCurrent = (this.headingDeg + 360.0) % 360.0;

      let deltaAngle = normDesired - normCurrent;
      if (deltaAngle > 180.0) deltaAngle -= 360.0;
      if (deltaAngle < -180.0) deltaAngle += 360.0;

      // Smooth steering toward waypoint
      const turnRate = 45.0 * dt; // deg/sec
      if (Math.abs(deltaAngle) <= turnRate) {
        this.headingDeg = normDesired;
      } else {
        this.headingDeg += Math.sign(deltaAngle) * turnRate;
      }
      this.headingDeg = (this.headingDeg + 360.0) % 360.0;
      this.headingRad = (this.headingDeg * Math.PI) / 180.0;

      // Cruising speed regulation
      const targetSpeed = this.autonomousCruisingSpeedKmh;
      if (this.speedKmh < targetSpeed) {
        this.speedKmh = Math.min(targetSpeed, this.speedKmh + 12.0 * dt);
      } else if (this.speedKmh > targetSpeed) {
        this.speedKmh = Math.max(targetSpeed, this.speedKmh - 15.0 * dt);
      }
      this.speedMps = (this.speedKmh * 1000.0) / 3600.0;

      // Advance position
      this.position.x += Math.sin(this.headingRad) * this.speedMps * dt;
      this.position.z += -Math.cos(this.headingRad) * this.speedMps * dt;
      // FIXED: Road deck is at y=0.0 in Three.js scene. Ambulance wheel centers at y=0.42
      this.position.y = 0.42;

      // Angular velocity for centripetal roll
      const angularVelocityRadS = (deltaAngle * Math.PI / 180.0);
      this.computePitchAndRoll(0.0, angularVelocityRadS, dt);
    }

    /**
     * Drive the 3D controller from the deterministic SimulationEngine.
     *
     * The engine owns the ambulance's kinematics (arc-length position, speed,
     * bay state machine), so this is a read: the engine steps, then the
     * controller mirrors its state onto the Three.js mesh. The controller
     * keeps its own clearance cone and route junctions for the civilian
     * parting-wave and preemption subsystems, which still need a live
     * heading rather than a planned one.
     */
    updateSimDriven(dt) {
      const { sim, ambulanceId } = this.simBridge;
      if (!sim) return;

      // The engine is stepped once per frame by Application.animate() (fixed
      // 0.1 s accumulator). This method only mirrors engine state onto the
      // Three.js mesh — stepping here too would advance the world twice.
      const veh = sim.vehicles.get(ambulanceId);
      if (!veh) return;

      const sample = veh.edge.sampleAt(veh.s);
      if (this.projection) {
        const world = this.projection.latLonAltToCartesian(sample.lat, sample.lon, sample.alt);
        this.position.x = world.x;
        // FIXED: Road deck is at y=0.0 in Three.js scene. Ambulance wheel centers at y=0.42
        this.position.y = 0.42; 
        this.position.z = world.z;
      } else {
        this.position.x = sample.lon;
        this.position.y = 0.42; // FIXED: Consistent with Three.js scene coords
        this.position.z = sample.lat;
      }

      // Heading is the edge tangent at the current arc-length. Compass bearing
      // 0 = North, +ve = clockwise; Three.js yaw is -bearing.
      const bearingDeg = (sample.headingRad * 180.0 / Math.PI + 360.0) % 360.0;
      this.headingDeg = bearingDeg;
      this.headingRad = sample.headingRad;
      this.speedKmh = veh.v * 3.6;
      this.speedMps = veh.v;

      // Suspension: a small pitch from longitudinal acceleration, roll from
      // the tangent turn rate. These are cosmetic only — the engine is the
      // authority on position — but they keep the chase camera usable.
      this.computePitchAndRoll(veh.a || 0.0, 0.0, dt);
    }

    /**
     * Updates smart routing controller with current ambulance state.
     */
    updateSmartRouting(dt) {
      // Determine current graph node
      const currentNode = this.smartRouting.findCurrentNode({
        currentNode: this.currentNode || null,
        speedKmh: this.speedKmh,
        position: this.position
      });

      // Update routing controller
      const ambulanceState = {
        currentNode: currentNode,
        speedKmh: this.speedKmh,
        position: this.position
      };

      const result = this.smartRouting.update(ambulanceState, dt, this.simulationTime);

      // Update route info
      if (result.currentRoute) {
        this.currentRouteInfo = {
          edges: result.currentRoute.path,
          totalTime: result.currentRoute.totalTime,
          distance: result.currentRoute.distance,
          reroute: result.reroute,
          newRoute: result.newRoute,
          priorityRequests: result.priorityRequests,
          log: result.log
        };

        // Update route renderer
        if (this.routeRenderer && result.currentRoute.path) {
          this.routeRenderer.update(result.currentRoute.path);
        }

        // Update active route junctions for signal preemption
        this.activeRouteJunctions = result.priorityRequests.map(req => req.junctionId);

        // Log routing decisions
        if (result.log && result.log.length > 0) {
          console.log('[SmartRouting]', ...result.log);
        }
      }
    }

    /**
     * Manual WASD driving physics integration.
     */
    updateManualDriving(dt) {
      // 1. Conflicting input handling: Braking strictly overrides throttle (Test T2.2.4)
      let throttle = 0.0;
      if (this.keys.w && this.keys.s) {
        throttle = -1.0; // Braking priority
      } else if (this.keys.w) {
        throttle = 1.0;
      } else if (this.keys.s) {
        throttle = -1.0;
      }

      // Handbrake override
      if (this.keys.space) {
        throttle = -1.5;
      }

      // 2. Acceleration / Deceleration Integration
      let accel = 0.0;
      if (throttle > 0.0) {
        // Accelerating forward
        accel = AMB_CONSTANTS.ACCELERATION_MPS2 * throttle;
        this.speedMps += accel * dt;
      } else if (throttle < 0.0) {
        if (this.speedMps > 0.1) {
          // Braking while moving forward
          const brakeRate = this.keys.space ? AMB_CONSTANTS.HANDBRAKE_MPS2 : AMB_CONSTANTS.BRAKE_MPS2;
          accel = -brakeRate;
          this.speedMps = Math.max(0.0, this.speedMps - brakeRate * dt);
        } else {
          // Reversing
          accel = -AMB_CONSTANTS.ACCELERATION_MPS2 * 0.6;
          const maxRevMps = (AMB_CONSTANTS.MAX_REVERSE_SPEED_KMH * 1000.0) / 3600.0;
          this.speedMps = Math.max(-maxRevMps, this.speedMps + accel * dt);
        }
      } else {
        // Coasting with natural friction
        if (Math.abs(this.speedMps) > 0.05) {
          const friction = AMB_CONSTANTS.ROLLING_FRICTION_MPS2 * Math.sign(this.speedMps);
          accel = -friction;
          if (this.speedMps > 0) {
            this.speedMps = Math.max(0.0, this.speedMps - AMB_CONSTANTS.ROLLING_FRICTION_MPS2 * dt);
          } else {
            this.speedMps = Math.min(0.0, this.speedMps + AMB_CONSTANTS.ROLLING_FRICTION_MPS2 * dt);
          }
        } else {
          this.speedMps = 0.0;
          accel = 0.0;
        }
      }

      this.accelerationMps2 = accel;

      // 3. Engine speed governor: Strictly clamp to max 100 km/h (Test T2.2.2)
      const maxMps = (AMB_CONSTANTS.MAX_SPEED_KMH * 1000.0) / 3600.0;
      this.speedMps = Math.min(maxMps, Math.max(-((AMB_CONSTANTS.MAX_REVERSE_SPEED_KMH * 1000.0) / 3600.0), this.speedMps));
      this.speedKmh = (this.speedMps * 3600.0) / 1000.0;

      // 4. Steering physics: Clamped to 35 deg (Test T1.2.3)
      const maxSteerRad = (AMB_CONSTANTS.MAX_STEER_DEG * Math.PI) / 180.0;
      if (this.keys.a) {
        this.steeringAngleRad = Math.max(-maxSteerRad, this.steeringAngleRad - AMB_CONSTANTS.STEER_SPEED_RAD_S * dt);
      } else if (this.keys.d) {
        this.steeringAngleRad = Math.min(maxSteerRad, this.steeringAngleRad + AMB_CONSTANTS.STEER_SPEED_RAD_S * dt);
      } else {
        // Return steering to center
        if (Math.abs(this.steeringAngleRad) > 0.02) {
          const returnStep = AMB_CONSTANTS.STEER_RETURN_SPEED_RAD_S * dt;
          if (this.steeringAngleRad > 0) {
            this.steeringAngleRad = Math.max(0, this.steeringAngleRad - returnStep);
          } else {
            this.steeringAngleRad = Math.min(0, this.steeringAngleRad + returnStep);
          }
        } else {
          this.steeringAngleRad = 0.0;
        }
      }
      this.steeringAngleDeg = (this.steeringAngleRad * 180.0) / Math.PI;

      // 5. Bicycle / Ackermann Kinematic Motion Model
      let angularVelocityRadS = 0.0;
      if (Math.abs(this.speedMps) > 0.01 && Math.abs(this.steeringAngleRad) > 0.001) {
        angularVelocityRadS = (this.speedMps / AMB_CONSTANTS.WHEELBASE_M) * Math.tan(this.steeringAngleRad);
        this.headingRad += angularVelocityRadS * dt;
        this.headingDeg = ((this.headingRad * 180.0) / Math.PI + 360.0) % 360.0;
        this.headingRad = (this.headingDeg * Math.PI) / 180.0;
      }

      // 6. World translation (East = +X, North = -Z)
      this.position.x += Math.sin(this.headingRad) * this.speedMps * dt;
      this.position.z += -Math.cos(this.headingRad) * this.speedMps * dt;

      // 7. Calculate suspension pitch & roll
      this.computePitchAndRoll(this.accelerationMps2, angularVelocityRadS, dt);
    }

    /**
     * Computes suspension pitch (acceleration tilt) and centripetal roll (cornering lean).
     * Enforces strict roll clamping to [-pi/8, pi/8] (Test T2.2.5).
     */
    computePitchAndRoll(accelMps2, angularVelRadS, dt) {
      if (Math.abs(this.speedMps) < 0.05) {
        // Stationary state: Pitch and roll settle to zero (Test T2.2.1)
        this.targetPitchRad = 0.0;
        this.targetRollRad = 0.0;
      } else {
        // Pitch: Nose dips forward on braking (accel < 0), lifts on throttle (accel > 0)
        this.targetPitchRad = Math.atan2(accelMps2, 9.81) * 0.40;
        this.targetPitchRad = Math.max(-AMB_CONSTANTS.MAX_PITCH_RAD, Math.min(AMB_CONSTANTS.MAX_PITCH_RAD, this.targetPitchRad));

        // Roll: Centripetal leaning into turns
        const rawRoll = (angularVelRadS * 0.25) * Math.min(1.5, Math.abs(this.speedMps) / 10.0);
        // Strictly clamped to [-pi/8, pi/8] (Test T2.2.5)
        this.targetRollRad = Math.max(-AMB_CONSTANTS.MAX_ROLL_RAD, Math.min(AMB_CONSTANTS.MAX_ROLL_RAD, rawRoll));
      }

      // Smooth suspension damping lerp
      const damp = Math.min(1.0, dt * 8.0);
      this.pitchRad += (this.targetPitchRad - this.pitchRad) * damp;
      this.rollRad += (this.targetRollRad - this.rollRad) * damp;
    }

    /**
     * Alternates emergency lightbar LED strobes (Red/Blue) and synchronized point lights.
     */
    updateStrobes(dt) {
      if (!this.priorityActive && !this.sirenActive) {
        if (this.leftPointLight) this.leftPointLight.intensity = 0.0;
        if (this.rightPointLight) this.rightPointLight.intensity = 0.0;
        return;
      }

      this.strobeTimer += dt;
      const cycleTime = 1.0 / AMB_CONSTANTS.STROBE_RATE_HZ; // 0.25s
      const phase = (this.strobeTimer % cycleTime) / cycleTime;
      const isRedPhase = phase < 0.5;

      if (this.leftStrobeMesh && this.leftStrobeMesh.material) {
        this.leftStrobeMesh.material.emissiveIntensity = isRedPhase ? 4.8 : 0.2;
      }
      if (this.rightStrobeMesh && this.rightStrobeMesh.material) {
        this.rightStrobeMesh.material.emissiveIntensity = !isRedPhase ? 4.8 : 0.2;
      }

      if (this.leftPointLight) {
        this.leftPointLight.intensity = isRedPhase ? AMB_CONSTANTS.STROBE_POINT_INTENSITY : 0.0;
      }
      if (this.rightPointLight) {
        this.rightPointLight.intensity = !isRedPhase ? AMB_CONSTANTS.STROBE_POINT_INTENSITY : 0.0;
      }
    }

    /**
     * Rotates wheels based on vehicle speed and turns front wheels based on steering angle.
     */
    updateWheels(dt) {
      if (this.wheels.length === 0) return;

      const wheelRadius = 0.42;
      const distTraveled = this.speedMps * dt;
      const rotationAngle = distTraveled / wheelRadius;

      this.wheels.forEach(w => {
        if (w.rubberMesh) {
          w.rubberMesh.rotation.x += rotationAngle;
        }
        if (w.isFront && w.group) {
          w.group.rotation.y = this.steeringAngleRad;
        }
      });
    }

    /**
     * Attach this controller to a deterministic SimulationEngine. When set,
     * the simulation is the single authority over the ambulance's position,
     * heading and speed; the offline waypoint engine is disabled so the live
     * app cannot silently fall back to legacy internal navigation.
     *
     * @param {SimulationEngine} sim
     * @param {string} ambulanceId
     */
    attachSimulation(sim, ambulanceId = 'amb_1') {
      this.simDriven = true;
      this.simBridge = { sim, ambulanceId };
    }

    /** Detach from the simulation, returning to offline waypoint navigation. */
    detachSimulation() {
      this.simDriven = false;
      this.simBridge = null;
    }

    /**
     * Master update loop called every frame at 60 FPS.
     * @param {number} dt - Frame delta time in seconds
     */
    update(dt = 0.016) {
      this.simulationTime += dt;

      // 1. Navigation / Driving Physics
      if (this.isManual) {
        this.updateManualDriving(dt);
      } else if (this.simDriven && this.simBridge) {
        this.updateSimDriven(dt);
      } else if (!this.isWsConnected) {
        this.updateInternalSimulation(dt);
      }

      // 2. Smart Routing Update (Stage 2). Skipped when sim-driven: the
      // SimulationEngine's own SmartRoutingController is the authority, and it
      // holds the live signal preemptions. Running this legacy controller too
      // would double-register preemptions on the same TrafficSignalPost objects.
      if (this.smartRouting && !this.simDriven) {
        this.updateSmartRouting(dt);
      }

      // 2. Synchronize Three.js 3D transforms
      if (this.mesh) {
        this.mesh.position.set(this.position.x, this.position.y, this.position.z);
        this.mesh.rotation.y = this.headingRad + Math.PI; // FIXED: Ambulance mesh front is at local +Z, but heading 0 (North) = world -Z. Add PI to align.

        if (this.chassisGroup) {
          // Authentic suspension pitch & roll
          this.chassisGroup.rotation.x = this.pitchRad;
          this.chassisGroup.rotation.z = -this.rollRad;
        }
      }

      // 3. Update Visual Strobes & Wheels
      this.updateStrobes(dt);
      this.updateWheels(dt);
    }

    /**
     * Returns forward clearance cone sensor for civilian traffic parting wave.
     * Range = 80.0m, FOV angle = 0.7 rad (~40 deg). (Test T1.3.2, Interface Contract 3).
     */
    getClearanceCone() {
      const fwdX = Math.sin(this.headingRad);
      const fwdZ = -Math.cos(this.headingRad);

      const fwd = (typeof THREE !== 'undefined')
        ? new THREE.Vector3(fwdX, 0, fwdZ)
        : { x: fwdX, y: 0, z: fwdZ };

      return {
        position: this.position,
        forward: fwd,
        range: AMB_CONSTANTS.CLEARANCE_RANGE_M,
        fovAngleRad: AMB_CONSTANTS.CLEARANCE_FOV_RAD,
        headingDeg: this.headingDeg,
        sirenActive: this.sirenActive
      };
    }

    /**
     * Toggles between Autonomous and Manual driving mode.
     * @returns {boolean} True if manual mode is now active
     */
    toggleMode() {
      this.isManual = !this.isManual;
      return this.isManual;
    }

    setMode(mode) {
      this.isManual = (String(mode).toLowerCase() === 'manual');
      return this.isManual;
    }

    isManualMode() {
      return this.isManual;
    }

    /**
     * Toggles siren sound synthesizer and priority strobes.
     * @returns {boolean} New siren active state
     */
    toggleSiren() {
      this.sirenActive = !this.sirenActive;
      this.priorityActive = this.sirenActive;

      if (this.audio) {
        if (this.sirenActive) {
          this.audio.start();
        } else {
          this.audio.stop();
        }
      }

      return this.sirenActive;
    }

    isSirenActive() {
      return this.sirenActive;
    }

    getPosition() {
      return this.position;
    }

    getSpeedKmh() {
      return this.speedKmh;
    }

    getSpeedMps() {
      return this.speedMps;
    }

    getHeadingDeg() {
      return this.headingDeg;
    }

    getHeadingRad() {
      return this.headingRad;
    }

    getPitch() {
      return this.pitchRad;
    }

    getRoll() {
      return this.rollRad;
    }

    getActiveRouteJunctions() {
      // When sim-driven, the live priority-hold set is the source of truth for
      // the preemption subsystem; the planned junction list is a fallback.
      if (this.simDriven && this.simBridge && this.simBridge.sim) {
        const held = this.simBridge.sim.routingController
          ? this.simBridge.sim.routingController.priorityRequestedJunctions
          : null;
        if (held && held.size > 0) return Array.from(held);
      }
      return this.activeRouteJunctions;
    }

    /**
     * Expose the attached simulation's live snapshot for the HUD and the
     * benchmark engine. Returns null when not sim-driven.
     */
    getSimulationSnapshot() {
      if (!this.simDriven || !this.simBridge) return null;
      const { sim, ambulanceId } = this.simBridge;
      const trip = sim.completedTrips.get(ambulanceId);
      const amb = sim.ambulances.get(ambulanceId);
      const veh = sim.vehicles.get(ambulanceId);
      return {
        tick: sim.tick,
        time: sim.time,
        vehicleCount: sim.vehicles.size,
        collisionViolations: sim.collisionViolations,
        signalInterventions: sim.signalInterventions,
        addedWaitTime: sim.totalAddedWaitTime,
        arrived: !!(trip && trip.state === 'BAY_RELEASED'),
        travelTimeSec: trip ? trip.travelTimeSec : null,
        bayKey: trip ? trip.bayKey : null,
        enRoute: !!amb,
        edgeId: veh ? veh.edge.id : null,
        sOnEdge: veh ? veh.s : null,
      };
    }

    /**
     * Returns current route information for UI/display
     */
    getCurrentRouteInfo() {
      return this.currentRouteInfo;
    }

    /**
     * Sets the visibility of the ambulance 3D mesh.
     * Used to hide the ambulance in cockpit/first-person view.
     * @param {boolean} visible
     */
    setMeshVisibility(visible) {
      if (this.mesh) {
        this.mesh.visible = visible;
      }
    }

    /**
     * Sets the destination hospital and recomputes route
     */
    setDestinationHospital(hospitalId) {
      this.destinationHospital = hospitalId;
      if (this.smartRouting) {
        let destinationNode = 'node_victoria_hospital_gate';
        if (hospitalId === 'hosp_stjohns_01') {
          destinationNode = 'node_st_johns';
        } else if (hospitalId === 'hosp_bowring_01') {
          destinationNode = 'node_bowring_hospital_gate';
        } else if (hospitalId === 'hosp_stmarthas_01') {
          destinationNode = 'node_st_marthas';
        } else if (hospitalId === 'hosp_mallya_01') {
          destinationNode = 'node_kasturba_cross';
        } else if (hospitalId === 'hosp_vanivilas_01') {
          destinationNode = 'node_victoria_hospital_gate';
        }

        const startNode = this.findClosestNode(this.smartRouting.graph);
        if (startNode) {
          this.smartRouting.setDestination(destinationNode);
        }
      }
    }
  }

  AmbulanceManager.CONSTANTS = AMB_CONSTANTS;

  return {
    AmbulanceManager,
    AmbulanceController: AmbulanceManager
  };
}));
