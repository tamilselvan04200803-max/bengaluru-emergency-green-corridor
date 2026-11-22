/**
 * js/routing.js
 * Bengaluru Emergency Green Corridor 3D Digital Twin — Smart Ambulance Routing Engine
 *
 * Features:
 * 1. RoadGraph: Directed graph from bengaluru_network.json edges with road geometry, speed limits, restrictions
 * 2. A* Routing: Time-based edge weights using actual distances, speed limits, congestion factors, signal delays
 * 3. Congestion Model: Live congestion factors per edge (0.0 = free flow, 1.0 = gridlocked)
 * 4. Tier 1: Automatic reroute when alternative path saves >= 20 seconds
 * 5. Tier 2: Signal priority request up to 250m ahead when no better bypass
 * 6. Hysteresis: Prevents thrashing between routes (min 30s between reroutes, 15% time saving threshold)
 * 7. Signal Wait Estimation: Computes expected wait time at each signal based on cycle timing and preemption
 * 8. Deterministic, no backend required, browser + Node.js compatible (UMD)
 */

(function (root, factory) {
  if (typeof define === 'function' && define.amd) {
    define([], factory);
  } else if (typeof module === 'object' && module.exports) {
    module.exports = factory();
  } else {
    root.RoutingEngine = factory();
    root.RoadGraph = factory().RoadGraph;
    root.RoutePlanner = factory().RoutePlanner;
  }
}(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  // ============================================================================
  // 1. CONSTANTS & CONFIGURATION
  // ============================================================================

  /**
   * Deterministic seeded PRNG (Mulberry32). Routing must be reproducible across
   * runs, so the fallback congestion model never calls Math.random().
   */
  class SeededRandom {
    constructor(seed = 1) {
      this.state = seed >>> 0;
    }
    seed(seed) { this.state = seed >>> 0; }
    next() {
      this.state = (this.state + 0x6D2B79F5) >>> 0;
      let t = Math.imul(this.state ^ (this.state >>> 15), 1 | this.state);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    }
    nextFloat() { return this.next(); }
    nextInt(max) { return Math.floor(this.next() * max); }
    nextBool(p = 0.5) { return this.next() < p; }
  }

  const ROUTING_CONSTANTS = {
    // Tier 1: Rerouting thresholds
    MIN_REROUTE_TIME_SAVING_SEC: 20.0,    // Must save at least 20s to trigger reroute
    MIN_REROUTE_INTERVAL_SEC: 30.0,       // Minimum 30 seconds between reroute attempts
    REROUTE_HYSTERESIS_FACTOR: 1.15,      // New route must be 15% better (not just 20s absolute)

    // Tier 2: Signal priority
    PRIORITY_REQUEST_HORIZON_M: 250.0,    // Request signal priority up to 250m ahead
    PRIORITY_LEAD_TIME_SEC: 25.0,         // Time horizon for priority actuation

    // Congestion model
    DEFAULT_CONGESTION: 0.15,             // Base congestion factor (0.0 - 1.0)
    MAX_CONGESTION: 0.95,                 // Gridlock threshold
    CONGESTION_UPDATE_INTERVAL_SEC: 10.0, // How often to re-evaluate congestion

    // Signal wait estimation
    AVG_RED_WAIT_SEC: 35.0,               // Average wait at red signal without preemption
    PREEMPTION_SUCCESS_RATE: 0.85,        // Probability signal preempts successfully

    // Routing algorithm
    HEURISTIC_WEIGHT: 1.0,                // A* heuristic weight (1.0 = admissible)
    MAX_ITERATIONS: 10000,                // Safety limit for A* iterations

    // Edge traversal
    MIN_TRAVERSAL_SPEED_KMH: 5.0,         // Minimum speed even in heavy congestion
    TURNOVER_PENALTY_SEC: 5.0,            // Penalty for turning at junctions
    U_TURN_PENALTY_SEC: 15.0,             // Heavy penalty for U-turns
  };

  // ============================================================================
  // 2. UTILITY FUNCTIONS
  // ============================================================================
  function haversineDistance(lat1, lon1, lat2, lon2) {
    const R = 6371000; // Earth radius in meters
    const dLat = (lat2 - lat1) * Math.PI / 180;
    const dLon = (lon2 - lon1) * Math.PI / 180;
    const a = Math.sin(dLat/2) * Math.sin(dLat/2) +
              Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
              Math.sin(dLon/2) * Math.sin(dLon/2);
    return 2 * R * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
  }

  function estimateEdgeTravelTime(edge, congestionFactor = 0) {
    const lengthM = edge.length_m || 100;
    const speedLimitKmh = edge.maxspeed || 40;
    const effectiveSpeedKmh = Math.max(
      ROUTING_CONSTANTS.MIN_TRAVERSAL_SPEED_KMH,
      speedLimitKmh * (1 - congestionFactor)
    );
    const speedMps = effectiveSpeedKmh / 3.6;
    return lengthM / speedMps;
  }

  function estimateSignalWait(edge, signalManager, isPreempted) {
    // Check if edge ends at a signalized junction
    if (!signalManager || !signalManager.signals) return 0;

    const toNode = edge.to_node;
    let waitTime = 0;

    signalManager.signals.forEach(signal => {
      if (signal.properties && signal.properties.node_id === toNode) {
        if (isPreempted) {
          // With preemption: mostly green, small chance of catching amber/red transition
          waitTime = ROUTING_CONSTANTS.AVG_RED_WAIT_SEC * (1 - ROUTING_CONSTANTS.PREEMPTION_SUCCESS_RATE);
        } else {
          // Deterministic: derive the wait from the signal's own phase rather than
          // Math.random(), so a given simulation state always yields the same route.
          const phase = signal.currentPhase;
          if (phase === 'RED' || phase === 'ALL_RED_CLEARANCE') {
            waitTime = ROUTING_CONSTANTS.AVG_RED_WAIT_SEC * 0.5;
          } else if (phase === 'AMBER') {
            waitTime = ROUTING_CONSTANTS.AVG_RED_WAIT_SEC * 0.25;
          } else {
            waitTime = 0; // GREEN / PREEMPT_GREEN
          }
        }
      }
    });

    return waitTime;
  }

  function computeTurnPenalty(fromEdge, toEdge) {
    if (!fromEdge || !toEdge) return 0;

    // Same road continuing straight - no penalty
    if (fromEdge.highway === toEdge.highway &&
        fromEdge.name && toEdge.name &&
        fromEdge.name.split(' ')[0] === toEdge.name.split(' ')[0]) {
      return 0;
    }

    // Check if it's a U-turn (opposite directions on same road)
    if (fromEdge.from_node === toEdge.to_node && fromEdge.to_node === toEdge.from_node) {
      return ROUTING_CONSTANTS.U_TURN_PENALTY_SEC;
    }

    // Regular turn
    return ROUTING_CONSTANTS.TURNOVER_PENALTY_SEC;
  }

  // ============================================================================
  // 3. ROAD GRAPH CLASS
  // ============================================================================
  class RoadGraph {
    /**
     * @param {Object} networkData - bengaluru_network.json data
     */
    constructor(networkData, seed = 42) {
      this.nodes = new Map();
      this.edges = new Map();
      this.adjacency = new Map(); // nodeId -> [{ edge, toNode }]
      this.reverseAdjacency = new Map(); // nodeId -> [{ edge, fromNode }]
      this.congestion = new Map(); // edgeId -> congestion factor 0.0-1.0
      this.edgeById = new Map();
      this.liveTravelTimeSec = new Map(); // edgeId -> live travel time (s) from sim
      // Edges known to be physically impassable (blockage, closure). Excluded
      // from A* expansion so the router routes around them instead of pricing
      // them as merely slow.
      this.blockedEdges = new Set();
      this.rng = new SeededRandom(seed);

      if (networkData) {
        this.loadFromNetworkData(networkData);
      }
    }

    loadFromNetworkData(networkData) {
      // Load nodes
      if (networkData.nodes) {
        networkData.nodes.forEach(node => {
          this.nodes.set(node.id, {
            id: node.id,
            name: node.name,
            zone: node.zone,
            lat: node.lat,
            lon: node.lon,
            alt: node.alt,
            type: node.type,
            signals: node.signals || [],
            roads: node.roads || []
          });
          this.adjacency.set(node.id, []);
          this.reverseAdjacency.set(node.id, []);
        });
      }

      // Load edges
      if (networkData.edges) {
        networkData.edges.forEach(edge => {
          const edgeData = {
            id: edge.id,
            name: edge.name,
            from_node: edge.from_node,
            to_node: edge.to_node,
            highway: edge.highway,
            lanes: edge.lanes,
            maxspeed: edge.maxspeed,
            oneway: edge.oneway,
            surface: edge.surface,
            length_m: edge.length_m,
            elevation_m: edge.elevation_m,
            ev_priority_corridor: edge.ev_priority_corridor,
            is_divided_carriageway: edge.is_divided_carriageway,
            carriageway_tag: edge.carriageway_tag
          };

          this.edges.set(edge.id, edgeData);
          this.edgeById.set(edge.id, edgeData);

          // Build adjacency (directed)
          if (!this.adjacency.has(edge.from_node)) {
            this.adjacency.set(edge.from_node, []);
          }
          this.adjacency.get(edge.from_node).push({
            edge: edgeData,
            toNode: edge.to_node
          });

          if (!this.reverseAdjacency.has(edge.to_node)) {
            this.reverseAdjacency.set(edge.to_node, []);
          }
          this.reverseAdjacency.get(edge.to_node).push({
            edge: edgeData,
            fromNode: edge.from_node
          });

          // Initialize congestion
          this.congestion.set(edge.id, ROUTING_CONSTANTS.DEFAULT_CONGESTION);
        });
      }

      // Load hospitals as special destination nodes
      this.hospitals = new Map();
      if (networkData.hospitals) {
        networkData.hospitals.forEach(hosp => {
          this.hospitals.set(hosp.id, {
            id: hosp.id,
            name: hosp.name,
            campus_node: hosp.campus_node,
            ingress_node: hosp.ingress_node,
            trauma_level: hosp.trauma_level,
            ev_priority: hosp.ev_priority,
            bays: hosp.bays,
            driveway: hosp.driveway
          });
        });
      }
    }

    /**
     * Get outgoing edges from a node
     */
    getOutgoingEdges(nodeId) {
      const all = this.adjacency.get(nodeId) || [];
      if (this.blockedEdges.size === 0) return all;
      return all.filter(entry => !this.blockedEdges.has(entry.edge.id));
    }

    /**
     * Get incoming edges to a node
     */
    getIncomingEdges(nodeId) {
      return this.reverseAdjacency.get(nodeId) || [];
    }

    /**
     * Get edge by ID
     */
    getEdge(edgeId) {
      return this.edgeById.get(edgeId);
    }

    /**
     * Get node by ID
     */
    getNode(nodeId) {
      return this.nodes.get(nodeId);
    }

    /**
     * Update congestion factor for an edge (0.0 = free flow, 1.0 = gridlocked)
     */
    setCongestion(edgeId, factor) {
      const clamped = Math.max(0, Math.min(ROUTING_CONSTANTS.MAX_CONGESTION, factor));
      this.congestion.set(edgeId, clamped);
    }

    /**
     * Get congestion factor for an edge
     */
    getCongestion(edgeId) {
      const value = this.congestion.get(edgeId);
      return value !== undefined ? value : ROUTING_CONSTANTS.DEFAULT_CONGESTION;
    }

    /**
     * Batch update congestion from external source (e.g., traffic simulation)
     */
    updateCongestionMap(congestionMap) {
      for (const [edgeId, factor] of Object.entries(congestionMap)) {
        this.setCongestion(edgeId, factor);
      }
    }

    /**
     * Simulate dynamic congestion (for testing/fallback).
     * Deterministic: the drift is derived from a seeded PRNG so repeated runs
     * with the same seed produce identical routing decisions.
     */
    simulateCongestionUpdate() {
      this.edges.forEach((edge, edgeId) => {
        // Deterministic drift from the seeded PRNG (no Math.random()).
        const drift = (this.rng.next() - 0.5) * 0.1;
        const reversion = (ROUTING_CONSTANTS.DEFAULT_CONGESTION - this.getCongestion(edgeId)) * 0.05;
        const current = Math.max(0, Math.min(ROUTING_CONSTANTS.MAX_CONGESTION,
          this.getCongestion(edgeId) + drift + reversion));
        this.congestion.set(edgeId, current);
      });
    }

    /**
     * Ingest live per-edge travel times from the deterministic traffic simulation.
     * Density is derived from the ratio of actual travel time to free-flow travel
     * time; the simulation's queue delay is folded in by the caller, so this
     * function never double-counts it.
     *
     * @param {Object} travelTimeMap - edgeId -> { travelTimeSec, density, meanSpeedMps, queueDelaySec, vehicleCount }
     */
    updateTravelTimesFromSimulation(travelTimeMap) {
      if (!travelTimeMap) return;
      for (const [edgeId, data] of Object.entries(travelTimeMap)) {
        const edge = this.edges.get(edgeId);
        if (!edge || !data || typeof data.travelTimeSec !== 'number') continue;
        const freeFlowSec = (edge.length_m || 100) / Math.max(1.0, (edge.maxspeed || 40) / 3.6);
        const ratio = data.travelTimeSec / freeFlowSec; // >= 1.0
        const factor = Math.max(0, Math.min(ROUTING_CONSTANTS.MAX_CONGESTION, (ratio - 1.0) * 0.5));
        this.congestion.set(edgeId, factor);
        this.liveTravelTimeSec.set(edgeId, data.travelTimeSec);
      }
    }

    /** Live travel time (s) reported by the simulation, or congestion-aware estimate. */
    getLiveTravelTime(edgeId) {
      // A blocked edge is impassable, not merely slow. Reporting it as a
      // congestion-capped travel time would let estimateRemainingTime price the
      // current route at a finite number while A* routes around it, so the
      // reroute comparison would see a saving that does not exist. A blocked
      // edge is a wall: the remaining route through it is infinite.
      if (this.blockedEdges.has(edgeId)) return Infinity;
      const live = this.liveTravelTimeSec.get(edgeId);
      if (live !== undefined && live > 0) return live;
      const edge = this.edges.get(edgeId);
      if (!edge) return 0;
      return estimateEdgeTravelTime(edge, this.getCongestion(edgeId));
    }

    /**
     * Mark an edge as impassable (or clear it). Excluded from A* expansion.
     */
    setEdgeBlocked(edgeId, blocked = true) {
      if (blocked) this.blockedEdges.add(edgeId);
      else this.blockedEdges.delete(edgeId);
    }

    /** True when the edge is currently excluded from routing. */
    isEdgeBlocked(edgeId) {
      return this.blockedEdges.has(edgeId);
    }

    /**
     * Find nearest node to a lat/lon coordinate
     */
    findNearestNode(lat, lon) {
      let nearest = null;
      let minDist = Infinity;

      this.nodes.forEach(node => {
        const d = haversineDistance(lat, lon, node.lat, node.lon);
        if (d < minDist) {
          minDist = d;
          nearest = node;
        }
      });

      return { node: nearest, distance: minDist };
    }

    /**
     * Get hospital by ID
     */
    getHospital(hospitalId) {
      return this.hospitals.get(hospitalId);
    }

    /**
     * Get hospital ingress node for a hospital
     */
    getHospitalIngressNode(hospitalId) {
      const hosp = this.hospitals.get(hospitalId);
      if (hosp && hosp.ingress_node) {
        return this.nodes.get(hosp.ingress_node);
      }
      return null;
    }

    /**
     * Validate graph connectivity for a route
     */
    validateConnectivity(fromNodeId, toNodeId) {
      // Simple BFS to check if path exists
      const visited = new Set();
      const queue = [fromNodeId];

      while (queue.length > 0) {
        const current = queue.shift();
        if (current === toNodeId) return true;
        if (visited.has(current)) continue;
        visited.add(current);

        const outgoing = this.getOutgoingEdges(current);
        for (const { toNode } of outgoing) {
          if (!visited.has(toNode)) {
            queue.push(toNode);
          }
        }
      }

      return false;
    }

    /**
     * Get all edges as array (for iteration)
     */
    getAllEdges() {
      return Array.from(this.edges.values());
    }

    /**
     * Get all nodes as array
     */
    getAllNodes() {
      return Array.from(this.nodes.values());
    }
  }

  // ============================================================================
  // 4. A* ROUTE PLANNER
  // ============================================================================
  class RoutePlanner {
    /**
     * @param {RoadGraph} roadGraph
     * @param {SignalManager} [signalManager] - Optional for signal wait estimation
     * @param {Object} [options]
     */
    constructor(roadGraph, signalManager = null, options = {}) {
      this.graph = roadGraph;
      this.signals = signalManager;
      this.options = Object.assign({}, {
        heuristicWeight: ROUTING_CONSTANTS.HEURISTIC_WEIGHT,
        maxIterations: ROUTING_CONSTANTS.MAX_ITERATIONS,
        enablePreemption: true
      }, options);
    }

    /**
     * Heuristic: straight-line distance / max possible speed
     */
    heuristic(nodeId, goalNodeId) {
      const node = this.graph.getNode(nodeId);
      const goal = this.graph.getNode(goalNodeId);
      if (!node || !goal) return 0;

      const dist = haversineDistance(node.lat, node.lon, goal.lat, goal.lon);
      // Admissible heuristic: distance at max highway speed (80 km/h = 22.2 m/s)
      return dist / 22.2;
    }

    /**
     * Calculate edge weight (travel time in seconds) including congestion, signals, turns.
     *
     * Live per-edge times reported by the simulation take precedence over the
     * fallback congestion model, exactly as they do in estimateRemainingTime.
     * Both sides of a reroute comparison must be priced with the same estimator;
     * mixing a live measurement against a capped congestion factor manufactures
     * a saving that does not exist.
     */
    calculateEdgeWeight(edge, fromEdge, congestionFactor, isPreempted) {
      const live = this.graph.liveTravelTimeSec.get(edge.id);
      let weight = (live !== undefined && live > 0)
        ? live
        : estimateEdgeTravelTime(edge, congestionFactor);

      // Add turn penalty
      weight += computeTurnPenalty(fromEdge, edge);

      // Add signal wait at destination node
      if (this.signals && this.options.enablePreemption) {
        weight += estimateSignalWait(edge, this.signals, isPreempted);
      }

      return weight;
    }

    /**
     * A* Search for shortest-time path
     * @param {string} startNodeId
     * @param {string} goalNodeId
     * @param {Object} [context] - { isPreempted, currentCongestionMap }
     * @returns {Object} { path: [edgeId], nodes: [nodeId], totalTime: sec, distance: m }
     */
    findRoute(startNodeId, goalNodeId, context = {}) {
      const isPreempted = context.isPreempted !== false;
      const congestionMap = context.congestionMap || this.graph.congestion;

      // Validate nodes exist
      if (!this.graph.getNode(startNodeId) || !this.graph.getNode(goalNodeId)) {
        return { path: [], nodes: [], totalTime: Infinity, distance: 0, error: 'Invalid start or goal node' };
      }

      // Quick connectivity check
      if (!this.graph.validateConnectivity(startNodeId, goalNodeId)) {
        return { path: [], nodes: [], totalTime: Infinity, distance: 0, error: 'No path exists between nodes' };
      }

      // A* data structures
      const openSet = new Map(); // nodeId -> { f, g, h, parent, parentEdge }
      const closedSet = new Set();

      // Initialize start node
      const startH = this.heuristic(startNodeId, goalNodeId) * this.options.heuristicWeight;
      openSet.set(startNodeId, {
        f: startH,
        g: 0,
        h: startH,
        parent: null,
        parentEdge: null
      });

      let iterations = 0;

      while (openSet.size > 0 && iterations < this.options.maxIterations) {
        iterations++;

        // Find node with lowest f-score
        let currentNodeId = null;
        let lowestF = Infinity;

        for (const [nodeId, data] of openSet) {
          if (data.f < lowestF) {
            lowestF = data.f;
            currentNodeId = nodeId;
          }
        }

        if (currentNodeId === null) break;

        // Check if goal reached
        if (currentNodeId === goalNodeId) {
          return this.reconstructPath(openSet, closedSet, currentNodeId, startNodeId, goalNodeId);
        }

        // Move current from open to closed
        const currentData = openSet.get(currentNodeId);
        openSet.delete(currentNodeId);
        closedSet.add(currentNodeId);

        // Expand neighbors
        const outgoing = this.graph.getOutgoingEdges(currentNodeId);

        for (const { edge, toNode } of outgoing) {
          if (closedSet.has(toNode)) continue;

          const congestion = congestionMap.get(edge.id) || ROUTING_CONSTANTS.DEFAULT_CONGESTION;
          const edgeWeight = this.calculateEdgeWeight(edge, currentData.parentEdge, congestion, isPreempted);

          const tentativeG = currentData.g + edgeWeight;

          const existing = openSet.get(toNode);
          if (!existing || tentativeG < existing.g) {
            const h = this.heuristic(toNode, goalNodeId) * this.options.heuristicWeight;
            openSet.set(toNode, {
              f: tentativeG + h,
              g: tentativeG,
              h: h,
              parent: currentNodeId,
              parentEdge: edge
            });
          }
        }
      }

      return { path: [], nodes: [], totalTime: Infinity, distance: 0, error: 'A* search failed or exceeded iterations' };
    }

    /**
     * Reconstruct path from A* search results
     */
    reconstructPath(openSet, closedSet, goalNodeId, startNodeId, originalGoal) {
      const pathEdges = [];
      const pathNodes = [goalNodeId];
      let totalTime = 0;
      let totalDistance = 0;
      let current = goalNodeId;

      // Combine open and closed for parent lookup
      const allNodes = new Map([...openSet, ...Array.from(closedSet).map(id => [id, null])]);

      // We need to track parents from the search
      // Re-run to build parent map or use stored data
      // For simplicity, we'll use the closed set which has the final parents
      // Actually we need to store parent info during search

      // Better approach: store parent map during search
      // Let's do a reverse traversal from goal using stored data
      const parentMap = new Map();
      const parentEdgeMap = new Map();

      // We need to re-trace. Since we lost parent info in current structure,
      // we'll modify the algorithm to track it properly

      // For now, return the data we have
      // This will be fixed in the actual implementation

      // Find the final node data
      let finalData = null;
      for (const [nodeId, data] of [...openSet, ...Array.from(closedSet).map(id => [id, null])]) {
        if (nodeId === goalNodeId && data) {
          finalData = data;
          break;
        }
      }

      // Build path backwards
      let currentNode = goalNodeId;
      let currentData = finalData;

      while (currentData && currentData.parent !== null) {
        if (currentData.parentEdge) {
          pathEdges.unshift(currentData.parentEdge.id);
          totalDistance += currentData.parentEdge.length_m || 0;
        }
        pathNodes.unshift(currentData.parent);
        currentData = this.findNodeData(currentData.parent, openSet, closedSet);
      }

      if (finalData) {
        totalTime = finalData.g;
      }

      return {
        path: pathEdges,
        nodes: pathNodes,
        totalTime: totalTime,
        distance: totalDistance,
        iterations: iterations
      };
    }

    findNodeData(nodeId, openSet, closedSet) {
      if (openSet.has(nodeId)) return openSet.get(nodeId);
      // For closed set we don't store data - this is a limitation
      // In a real implementation, we'd keep a separate parent map
      return null;
    }

    /**
     * Enhanced A* with proper parent tracking
     */
    findRouteEnhanced(startNodeId, goalNodeId, context = {}) {
      const isPreempted = context.isPreempted !== false;
      const congestionMap = context.congestionMap || this.graph.congestion;

      if (!this.graph.getNode(startNodeId) || !this.graph.getNode(goalNodeId)) {
        return { path: [], nodes: [], totalTime: Infinity, distance: 0, error: 'Invalid nodes' };
      }

      if (!this.graph.validateConnectivity(startNodeId, goalNodeId)) {
        return { path: [], nodes: [], totalTime: Infinity, distance: 0, error: 'No connectivity' };
      }

      const openSet = new Map(); // nodeId -> { f, g, h, parent, parentEdge }
      const closedSet = new Set();
      const parentMap = new Map(); // nodeId -> parentNodeId
      const parentEdgeMap = new Map(); // nodeId -> edge

      const startH = this.heuristic(startNodeId, goalNodeId) * this.options.heuristicWeight;
      openSet.set(startNodeId, { f: startH, g: 0, h: startH });

      let iterations = 0;

      while (openSet.size > 0 && iterations < this.options.maxIterations) {
        iterations++;

        let currentNodeId = null;
        let lowestF = Infinity;

        for (const [nodeId, data] of openSet) {
          if (data.f < lowestF) {
            lowestF = data.f;
            currentNodeId = nodeId;
          }
        }

        if (currentNodeId === goalNodeId) {
          // Reconstruct path
          const pathEdges = [];
          const pathNodes = [];
          let totalDistance = 0;

          let current = goalNodeId;
          pathNodes.unshift(current);

          while (parentMap.has(current)) {
            const edge = parentEdgeMap.get(current);
            if (edge) {
              pathEdges.unshift(edge.id);
              totalDistance += edge.length_m || 0;
            }
            current = parentMap.get(current);
            pathNodes.unshift(current);
          }

          const finalData = openSet.get(goalNodeId) || { g: 0 };
          // Find g-score from closed set or compute
          let totalTime = 0;
          let trace = goalNodeId;
          let prevEdge = null;
          while (parentMap.has(trace)) {
            const edge = parentEdgeMap.get(trace);
            if (edge) {
              const congestion = congestionMap.get(edge.id) || ROUTING_CONSTANTS.DEFAULT_CONGESTION;
              totalTime += this.calculateEdgeWeight(edge, prevEdge, congestion, isPreempted);
              prevEdge = edge;
            }
            trace = parentMap.get(trace);
          }

          return {
            path: pathEdges,
            nodes: pathNodes,
            totalTime: totalTime,
            distance: totalDistance,
            iterations: iterations
          };
        }

        const currentData = openSet.get(currentNodeId);
        openSet.delete(currentNodeId);
        closedSet.add(currentNodeId);

        const outgoing = this.graph.getOutgoingEdges(currentNodeId);

        for (const { edge, toNode } of outgoing) {
          if (closedSet.has(toNode)) continue;

          const congestion = congestionMap.get(edge.id) || ROUTING_CONSTANTS.DEFAULT_CONGESTION;
          // Get previous edge for turn penalty
          const prevEdge = parentEdgeMap.get(currentNodeId) || null;
          const edgeWeight = this.calculateEdgeWeight(edge, prevEdge, congestion, isPreempted);

          const tentativeG = currentData.g + edgeWeight;

          const existing = openSet.get(toNode);
          if (!existing || tentativeG < existing.g) {
            const h = this.heuristic(toNode, goalNodeId) * this.options.heuristicWeight;
            openSet.set(toNode, { f: tentativeG + h, g: tentativeG, h: h });
            parentMap.set(toNode, currentNodeId);
            parentEdgeMap.set(toNode, edge);
          }
        }
      }

      return { path: [], nodes: [], totalTime: Infinity, distance: 0, error: 'Search failed', iterations: iterations };
    }
  }

  // ============================================================================
  // 5. SMART ROUTING CONTROLLER (Two-Tier Decision Logic)
  // ============================================================================
  class SmartRoutingController {
    /**
     * @param {RoutePlanner} planner
     * @param {RoadGraph} graph
     * @param {SignalManager} signals
     * @param {Object} [options]
     */
    constructor(planner, graph, signals, options = {}) {
      this.planner = planner;
      this.graph = graph;
      this.signals = signals;
      this.options = Object.assign({}, {
        minRerouteSavingSec: ROUTING_CONSTANTS.MIN_REROUTE_TIME_SAVING_SEC,
        minRerouteIntervalSec: ROUTING_CONSTANTS.MIN_REROUTE_INTERVAL_SEC,
        hysteresisFactor: ROUTING_CONSTANTS.REROUTE_HYSTERESIS_FACTOR,
        priorityHorizonM: ROUTING_CONSTANTS.PRIORITY_REQUEST_HORIZON_M,
        priorityLeadTimeSec: ROUTING_CONSTANTS.PRIORITY_LEAD_TIME_SEC,
        congestionUpdateIntervalSec: ROUTING_CONSTANTS.CONGESTION_UPDATE_INTERVAL_SEC
      }, options);

      // State
      this.currentRoute = null;
      this.currentRouteEdges = [];
      this.currentRouteTime = 0;
      this.currentDestination = null;
      this.lastRerouteTime = 0;
      this.lastRerouteReason = '';
      this.rerouteHistory = [];
      this.priorityRequestedJunctions = new Set();
      this.isActive = true;
    }

    /**
     * Set destination (hospital or node)
     */
    setDestination(destinationNodeId, hospitalId = null) {
      this.currentDestination = destinationNodeId;
      this.currentRoute = null;
      this.currentRouteEdges = [];
      this.currentRouteTime = 0;
      this.lastRerouteTime = 0; // Reset hysteresis timer on new destination
      this.priorityRequestedJunctions.clear();
    }

    /**
     * Push live per-edge travel times from the deterministic traffic simulation.
     * Called by the simulation every congestion-update tick; the controller
     * prefers these over the fallback congestion model when present.
     */
    setLiveTravelTimes(travelTimeMap) {
      this.liveTravelTimes = travelTimeMap || null;
      if (this.liveTravelTimes) {
        this.graph.updateTravelTimesFromSimulation(this.liveTravelTimes);
      }
    }

    /**
     * Main update loop - called every frame
     * @param {Object} ambulanceState - { position, speedKmh, heading, currentNode, destination }
     * @param {number} dt - Delta time in seconds
     * @param {number} currentTime - Current simulation time in seconds
     * @returns {Object} Routing decisions { reroute, newRoute, priorityRequests, log }
     */
    update(ambulanceState, dt, currentTime) {
      if (!this.isActive || !this.currentDestination) {
        return { reroute: false, priorityRequests: [], log: [] };
      }

      // If the ambulance has reached its destination (docked/dwelled), do not
      // continue issuing reroutes or priority requests. The simulation handles
      // the final state machine.
      if (ambulanceState.isAtDestination) {
        return { reroute: false, priorityRequests: [], log: [] };
      }

      const logs = [];
      const priorityRequests = [];

      // 1. Check if we need initial route
      if (!this.currentRoute) {
        const startNode = ambulanceState.currentNode || this.findCurrentNode(ambulanceState);
        if (!startNode) {
          return { reroute: false, priorityRequests: [], route: null, log: ['[ROUTE] Cannot determine start node'] };
        }
        const initialRoute = this.computeRoute(startNode, this.currentDestination, {
          isPreempted: true
        });

        if (initialRoute.path.length > 0) {
          this.currentRoute = initialRoute;
          this.currentRouteEdges = initialRoute.path;
          this.currentRouteTime = initialRoute.totalTime;
          this.lastRerouteTime = currentTime; // Initialize hysteresis timer
          logs.push(`[ROUTE] Initial route computed: ${initialRoute.path.length} edges, ${initialRoute.totalTime.toFixed(1)}s ETA`);
        }

        // Check for signal priority on initial route
        const priorityDecision = this.checkSignalPriority(ambulanceState);
        if (priorityDecision.requests.length > 0) {
          priorityRequests.push(...priorityDecision.requests);
          priorityDecision.requests.forEach(req => {
            this.priorityRequestedJunctions.add(req.junctionId);
            logs.push(`[PRIORITY] Requesting preemption for ${req.junctionId} (${req.distanceM.toFixed(0)}m ahead, ETA ${req.etaSec.toFixed(1)}s)`);
          });
        }

        return { reroute: false, priorityRequests: priorityRequests, currentRoute: this.currentRoute, log: logs };
      }

      // 2. Update congestion (periodic)
      if (currentTime % this.options.congestionUpdateIntervalSec < dt) {
        this.graph.simulateCongestionUpdate();
      }

      // 3. Check for Tier 1: Automatic Reroute
      const rerouteDecision = this.checkReroute(ambulanceState, currentTime);
      if (rerouteDecision.shouldReroute) {
        this.currentRoute = rerouteDecision.newRoute;
        this.currentRouteEdges = rerouteDecision.newRoute.path;
        this.currentRouteTime = rerouteDecision.newRoute.totalTime;
        this.lastRerouteTime = currentTime;
        this.lastRerouteReason = rerouteDecision.reason;
        this.rerouteHistory.push({
          time: currentTime,
          fromRoute: this.currentRouteEdges.slice(),
          toRoute: rerouteDecision.newRoute.path.slice(),
          timeSaved: rerouteDecision.timeSaved,
          reason: rerouteDecision.reason
        });
        logs.push(`[REROUTE] ${rerouteDecision.reason} - Saved ${rerouteDecision.timeSaved.toFixed(1)}s`);

        // Clear priority requests for old route
        this.priorityRequestedJunctions.clear();
      } else if (rerouteDecision.reason) {
        // Log routing evaluation even if no reroute
        logs.push(`[ROUTE] Checked reroute: ${rerouteDecision.reason}` +
          (rerouteDecision.timeSaved !== undefined ? ` (${rerouteDecision.timeSaved.toFixed(1)}s)` : ''));
      }

      // 4. Check for Tier 2: Signal Priority Requests
      const priorityDecision = this.checkSignalPriority(ambulanceState);
      if (priorityDecision.requests.length > 0) {
        priorityRequests.push(...priorityDecision.requests);
        priorityDecision.requests.forEach(req => {
          this.priorityRequestedJunctions.add(req.junctionId);
          logs.push(`[PRIORITY] Requesting preemption for ${req.junctionId} (${req.distanceM.toFixed(0)}m ahead, ETA ${req.etaSec.toFixed(1)}s)`);
        });
      }

      // 5. Clean up passed junctions
      this.cleanupPassedJunctions(ambulanceState);

      return {
        reroute: rerouteDecision.shouldReroute || false,
        newRoute: rerouteDecision.newRoute || null,
        // Time saved by the accepted reroute, in seconds. Callers must use this
        // rather than newRoute.totalTime, which is an absolute duration and not
        // a saving.
        timeSaved: rerouteDecision.shouldReroute ? rerouteDecision.timeSaved : 0,
        priorityRequests: priorityRequests,
        currentRoute: this.currentRoute,
        log: logs
      };
    }

    /**
     * Compute route from current position to destination
     */
    computeRoute(fromNodeId, toNodeId, context = {}) {
      return this.planner.findRouteEnhanced(fromNodeId, toNodeId, context);
    }

    /**
     * Remaining travel time on the edge the ambulance is currently occupying,
     * from its present position to that edge's downstream node.
     */
    estimateRemainingOnCurrentEdge(ambulanceState) {
      const edgeId = ambulanceState.currentEdgeId;
      if (!edgeId) return 0;
      const edge = this.graph.getEdge(edgeId);
      if (!edge) return 0;
      // A blocked edge is a wall, so the remaining route through it is infinite.
      if (this.graph.blockedEdges.has(edgeId)) return Infinity;
      const remainingM = Math.max(0, (edge.length_m || 0) - (ambulanceState.sOnEdge || 0));
      return this.graph.getLiveTravelTime(edgeId) * (remainingM / Math.max(1, edge.length_m || 1));
    }

    /**
     * Tier 1: Check if rerouting is beneficial
     */
    checkReroute(ambulanceState, currentTime) {
      // Hysteresis: minimum time between reroutes
      if (currentTime - this.lastRerouteTime < this.options.minRerouteIntervalSec) {
        return { shouldReroute: false, reason: 'Hysteresis: minimum interval not elapsed' };
      }

      // Need current node - the node the ambulance is travelling towards. Mid-edge
      // this is the edge's downstream node; routing from anywhere behind the
      // vehicle would answer with a U-turn back onto the edge it is already on.
      const currentNodeId = ambulanceState.currentNode || this.findCurrentNode(ambulanceState);
      if (!currentNodeId) {
        return { shouldReroute: false, reason: 'Cannot determine current node' };
      }

      // Compute alternative route with current congestion
      const altRoute = this.computeRoute(currentNodeId, this.currentDestination, {
        isPreempted: true,
        congestionMap: this.graph.congestion
      });

      if (altRoute.path.length === 0 || altRoute.totalTime === Infinity) {
        return { shouldReroute: false, reason: 'No alternative route found' };
      }

      // Both sides of the comparison are time-to-destination-from-here. The
      // alternative starts at the vehicle's downstream node, so the remaining
      // portion of the current edge must be added to it, otherwise the
      // alternative is credited with a head start it does not have.
      const remainingOnCurrentEdge = this.estimateRemainingOnCurrentEdge(ambulanceState);
      const altTime = altRoute.totalTime + remainingOnCurrentEdge;

      // Compute current route remaining time from current position
      const currentRemainingTime = this.estimateRemainingTime(currentNodeId, ambulanceState)
        + remainingOnCurrentEdge;

      // A blocked edge makes the current route a wall (remaining time
      // Infinity). Any finite alternative is then a saving of the whole
      // remaining trip, so fold Infinity back to the alternative's own cost
      // rather than reporting a literal Infinity in the decision log.
      const timeSaved = currentRemainingTime === Infinity
        ? altTime
        : currentRemainingTime - altTime;

      // Check thresholds
      const meetsAbsoluteThreshold = timeSaved >= this.options.minRerouteSavingSec;
      const meetsRelativeThreshold = currentRemainingTime > 0 &&
        (currentRemainingTime / altTime) >= this.options.hysteresisFactor;

      if (meetsAbsoluteThreshold && meetsRelativeThreshold) {
        const pct = currentRemainingTime === Infinity
          ? 100
          : (timeSaved / currentRemainingTime) * 100;
        return {
          shouldReroute: true,
          newRoute: altRoute,
          timeSaved: timeSaved,
          reason: `Alternative route saves ${timeSaved.toFixed(1)}s (${pct.toFixed(1)}%)`
        };
      }

      return {
        shouldReroute: false,
        reason: meetsAbsoluteThreshold ? 'Relative threshold not met' : 'Absolute threshold not met',
        timeSaved: timeSaved
      };
    }

    /**
     * Estimate remaining time on current route from a given node
     */
    estimateRemainingTime(fromNodeId, ambulanceState) {
      if (!this.currentRoute || this.currentRouteEdges.length === 0) {
        return Infinity;
      }

      // Find where we are in the current route
      let startIndex = 0;
      for (let i = 0; i < this.currentRouteEdges.length; i++) {
        const edge = this.graph.getEdge(this.currentRouteEdges[i]);
        if (edge && edge.from_node === fromNodeId) {
          startIndex = i;
          break;
        }
        if (edge && edge.to_node === fromNodeId) {
          startIndex = i + 1;
          break;
        }
      }

      // Sum remaining edge times
      let remainingTime = 0;
      for (let i = startIndex; i < this.currentRouteEdges.length; i++) {
        const edge = this.graph.getEdge(this.currentRouteEdges[i]);
        if (edge) {
          // Prefer the live travel time reported by the simulation over the
          // congestion-factor estimate, so reroute decisions reflect reality.
          // getLiveTravelTime already folds in congestion when no live value
          // exists, so we must not add it a second time.
          remainingTime += this.graph.getLiveTravelTime(edge.id);

          // Add signal wait at end of edge
          if (this.signals) {
            remainingTime += estimateSignalWait(edge, this.signals, true);
          }
        }
      }

      // Add small offset for current position within edge
      remainingTime += 5.0;

      return remainingTime;
    }

    /**
     * Find the node the ambulance is travelling towards.
     *
     * The ambulance state carries the edge it is actually on and how far along
     * that edge it has travelled, so the node is that edge's downstream end.
     * Falling back to the first edge of the planned route instead reported the
     * route origin long after the vehicle had left it, which made every
     * reroute comparison start from the wrong place.
     */
    findCurrentNode(ambulanceState) {
      const edgeId = ambulanceState.currentEdgeId;
      if (edgeId) {
        const edge = this.graph.getEdge(edgeId);
        if (edge) return edge.to_node;
      }
      if (this.currentRouteEdges.length > 0) {
        const firstEdge = this.graph.getEdge(this.currentRouteEdges[0]);
        if (firstEdge) return firstEdge.from_node;
      }
      return null;
    }

    /**
     * Tier 2: Check signal priority requests
     */
    checkSignalPriority(ambulanceState) {
      const requests = [];
      const currentNodeId = ambulanceState.currentNode || this.findCurrentNode(ambulanceState);

      if (!currentNodeId || !this.currentRouteEdges.length) {
        return { requests: [] };
      }

      // Position along the route: the edge the ambulance is actually on, so the
      // look-ahead starts from the next junction rather than from the origin.
      const currentEdgeId = ambulanceState.currentEdgeId || this.currentRouteEdges[0];
      const currentIndex = Math.max(0, this.currentRouteEdges.indexOf(currentEdgeId));

      // Check signals at the departure node, but only while the ambulance is
      // genuinely still on the first route edge. Once it hands off, that
      // junction is behind it and look-ahead coverage takes over — otherwise
      // the request is re-issued every tick and the signal never releases.
      const headEdgeId = this.currentRouteEdges[currentIndex];
      const headEdge = headEdgeId ? this.graph.getEdge(headEdgeId) : null;
      const isAtDeparture = currentIndex === 0 && !!headEdge && headEdge.from_node === currentNodeId;
      const currentNode = this.graph.getNode(currentNodeId);
      if (isAtDeparture && currentNode && currentNode.signals && currentNode.signals.length > 0) {
        for (const signalId of currentNode.signals) {
          if (!this.priorityRequestedJunctions.has(signalId)) {
            requests.push({
              junctionId: signalId,
              nodeId: currentNodeId,
              distanceM: 0,
              etaSec: 0,
              edgeId: headEdgeId,
              priority: 'CRITICAL'
            });
          }
        }
      }

      // Look ahead along the remaining route up to the priority horizon. The
      // first edge contributes only the distance still ahead of the ambulance,
      // so a junction can be requested even when the current edge is longer
      // than the horizon.
      let accumulatedDistance = 0;

      for (let i = currentIndex; i < this.currentRouteEdges.length; i += 1) {
        const edgeId = this.currentRouteEdges[i];
        const edge = this.graph.getEdge(edgeId);
        if (!edge) continue;

        const edgeLength = edge.length_m || 0;
        const remainingOnEdge = i === currentIndex
          ? Math.max(0, edgeLength - (ambulanceState.sOnEdge || 0))
          : edgeLength;
        accumulatedDistance += remainingOnEdge;

        // Check if we're within priority horizon
        if (accumulatedDistance > this.options.priorityHorizonM) {
          break;
        }

        // Check if edge ends at a signalized junction
        const toNode = this.graph.getNode(edge.to_node);
        if (toNode && toNode.signals && toNode.signals.length > 0) {
          for (const signalId of toNode.signals) {
            // Skip if already requested
            if (this.priorityRequestedJunctions.has(signalId)) continue;

            // Estimate ETA to this junction
            const speedMps = Math.max(5, (ambulanceState.speedKmh || 40) / 3.6);
            const etaSec = accumulatedDistance / speedMps;

            // Only request if within lead time
            if (etaSec <= this.options.priorityLeadTimeSec) {
              requests.push({
                junctionId: signalId,
                nodeId: edge.to_node,
                distanceM: accumulatedDistance,
                etaSec: etaSec,
                edgeId: edgeId,
                priority: 'CRITICAL'
              });
            }
          }
        }
      }

      return { requests };
    }

    /**
     * Clean up priority requests for junctions we've passed
     */
    /**
     * Drop priority requests for junctions the ambulance has already crossed.
     *
     * A junction counts as passed once the ambulance's current route edge is
     * downstream of the edge that leads into it — measured by route progress,
     * not by distance, because distance alone cannot tell "not yet reached"
     * from "already left" and would clear the set on every tick.
     */
    cleanupPassedJunctions(ambulanceState) {
      if (this.priorityRequestedJunctions.size === 0) return;

      const currentEdgeId = ambulanceState.currentEdgeId || this.currentRouteEdges[0];
      const currentIndex = this.currentRouteEdges.indexOf(currentEdgeId);

      // Nodes at or before the current position along the route. Only once the
      // ambulance has handed off at least one edge has it actually cleared a
      // junction; while it is still on its first edge the departure junction is
      // the one it is approaching, not one it has left.
      const passedNodes = new Set();
      // The edge the ambulance is actually on: it has already left that edge's
      // departure node. This matters when the controller's recomputed route no
      // longer contains the current edge (it was rerouted), because indexOf()
      // then returns -1 and nothing would ever be marked passed — leaving the
      // signal preempted and its queue unserviced forever.
      const actualEdge = currentEdgeId ? this.graph.getEdge(currentEdgeId) : null;
      if (actualEdge) {
        passedNodes.add(actualEdge.from_node);
      }
      if (currentIndex > 0) {
        for (let i = 0; i < currentIndex; i += 1) {
          const edge = this.graph.getEdge(this.currentRouteEdges[i]);
          if (edge) {
            passedNodes.add(edge.from_node);
            passedNodes.add(edge.to_node);
          }
        }
      }

      for (const junctionId of Array.from(this.priorityRequestedJunctions)) {
        const signal = this.signals && this.signals.getSignal
          ? this.signals.getSignal(junctionId)
          : null;
        const nodeId = signal && signal.properties ? signal.properties.node_id : null;
        if (nodeId && passedNodes.has(nodeId)) {
          this.priorityRequestedJunctions.delete(junctionId);
          // The ambulance has cleared this junction, so the priority hold is
          // over. endPreemption() walks the safe amber -> all-red -> cycle
          // transition; without it the signal stays "preempted" forever and
          // the next request can never be serviced.
          if (signal && typeof signal.endPreemption === 'function') {
            signal.endPreemption();
          }
        }
      }
    }

    /**
     * Get current route info for display
     */
    getRouteInfo() {
      if (!this.currentRoute) return null;

      return {
        edges: this.currentRouteEdges,
        totalTime: this.currentRouteTime,
        distance: this.currentRoute.distance,
        nodeCount: this.currentRoute.nodes.length,
        lastReroute: this.lastRerouteTime,
        lastRerouteReason: this.lastRerouteReason,
        rerouteCount: this.rerouteHistory.length
      };
    }

    /**
     * Force recomputation of route (e.g., after major congestion change)
     */
    forceReroute(ambulanceState) {
      this.lastRerouteTime = 0; // Reset hysteresis
      return this.update(ambulanceState, 0, Date.now() / 1000);
    }

    /**
     * Enable/disable smart routing
     */
    setActive(active) {
      this.isActive = active;
    }
  }

  // ============================================================================
  // 6. INTEGRATION HELPER: Create routing system from network data
  // ============================================================================
  function createRoutingSystem(networkData, signalManager = null, options = {}) {
    const graph = new RoadGraph(networkData, options.seed);
    const planner = new RoutePlanner(graph, signalManager, options.plannerOptions);
    const controller = new SmartRoutingController(planner, graph, signalManager, options.controllerOptions);

    return {
      graph,
      planner,
      controller,
      // Convenience methods
      setDestination: (nodeId, hospitalId) => controller.setDestination(nodeId, hospitalId),
      update: (ambulanceState, dt, currentTime) => controller.update(ambulanceState, dt, currentTime),
      getRouteInfo: () => controller.getRouteInfo(),
      forceReroute: (ambulanceState) => controller.forceReroute(ambulanceState),
      setActive: (active) => controller.setActive(active)
    };
  }

  // ============================================================================
  // 7. EXPORTS
  // ============================================================================
  return {
    RoadGraph,
    RoutePlanner,
    SmartRoutingController,
    createRoutingSystem,
    ROUTING_CONSTANTS,
    SeededRandom,
    // Utility functions
    haversineDistance,
    estimateEdgeTravelTime,
    estimateSignalWait,
    computeTurnPenalty
  };
}));