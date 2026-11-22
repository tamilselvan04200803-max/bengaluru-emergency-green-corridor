---
# UE5 Bengaluru Digital Twin — Mandatory Engineering Constraints
# Applied automatically to all sessions in this workspace.
---

## 1. Zero External API Dependencies in Simulation
- NEVER add Google Maps, Mapbox, OpenRouteService, or any cloud routing API call to the Python simulation layer.
- ALL routing MUST use the local NetworkX directed graph built from `Data/GeoJSON/bengaluru_roads.geojson`.
- Acceptable: Overpass API for one-time GeoJSON extraction. Forbidden: any runtime API call during simulation.

## 2. O(1) Spline Lookup by OsmId
- In all UE5 C++ ambulance / fleet code, ALWAYS query `ARoadSplineNetworkGenerator::GetSplineByOsmId(OsmId)` first.
- Only fall back to `FindNearestRoad()` (O(N) spatial scan) when `GetSplineByOsmId` returns null or OsmId == 0.
- NEVER use `FindNearestRoad()` as the primary lookup path.

## 3. 1D Spline Dead-Reckoning — Never 3D VInterpTo
- `AAmbulanceActor` and ALL vehicle actors MUST track `CurrentDistanceAlongSpline` (float, cm).
- In `Tick(DeltaTime)`, advance via: `CurrentDistanceAlongSpline += SpeedCmPerSec * DeltaTime`.
- NEVER set world location directly via `FMath::VInterpTo` or `FMath::Lerp` on raw 3D positions.
- World transform MUST be evaluated as: `SplineComponent->GetLocationAtDistanceAlongSpline(D, World)` with `+15.0f cm` vertical terrain clearance.

## 4. Strict Game-Thread Marshaling
- WebSocket message parsing in `UTelemetryWebSocketSubsystem` MUST be offloaded to `ENamedThreads::AnyBackgroundThreadNormalTask`.
- After deserialization, ALWAYS dispatch back to GameThread via `AsyncTask(ENamedThreads::GameThread, ...)` BEFORE calling `OnAmbulanceTelemetryReceived.Broadcast()`.
- NEVER broadcast UObject delegates from a background thread.

## 5. Green Wave — Array of Junctions, Not Single Preempt
- Ambulance preemption operates on a **list** `green_wave_junction_ids: []` covering all junctions within `min(300m, 25s ETA)` along the route.
- Single `preempt_junction_osm_id` is kept for backward compatibility only (first element of wave or 0).
- `AAmbulanceFleetManager::HandleAmbulanceTelemetry()` MUST iterate the full Green Wave array and call `TriggerJunctionPreemption()` for each junction.
- Post-junction restoration (`DeactivatePriorityOverride`) fires when vehicle is >30m (3000 cm) past the junction.

## 6. Multi-Ambulance Conflict Resolution Order
- When two ambulances contest the same junction simultaneously, ALWAYS resolve using:
  1. `patient_criticality_tier` (lower number = higher priority)
  2. ETA to junction (shorter = higher priority, as tiebreaker)
- The loser MUST receive a `speed_advisory_kmh` adjustment (not a hard stop) so vehicles cross sequentially.
- NEVER let two ambulances hold `PriorityOverride` on the same junction simultaneously.

## 7. Stale Packet Guard
- In `AAmbulanceFleetManager::HandleAmbulanceTelemetry()`, ALWAYS check `Payload.Timestamp <= ExistingActor->LastTelemetryTimestamp` and silently DROP stale packets.
- NEVER process out-of-order telemetry.

## 8. UE5 C++ Include Order
- `.generated.h` MUST always be the LAST #include in any UE5 header file.
- Public includes before private/module includes.

## 9. Dynamic Edge Weights in NetworkX Graph
- Congestion MUST be modeled as: `travel_time = base_time * (1.0 + congestion_factor)` where `congestion_factor ∈ [0.0, 1.0]`.
- Rerouting triggers when ANY edge on an ambulance's active `node_path` exceeds `congestion_factor > 0.85`.
- Base weights (unloaded travel times) MUST be snapshotted at graph construction time in `CongestionEngine.initialize()`.

## 10. Civilian Traffic — ISM + Data Array Pattern
- `ATrafficSwarmManager` uses `UInstancedStaticMeshComponent` for rendering (one draw call).
- Per-instance motion logic lives in a parallel `TArray<FCivilianVehicleState>` struct array.
- NEVER use `AActor`-per-vehicle for civilian traffic (CPU overhead).
- Parting Wave: lateral yield triggers at 80m (8000 cm) behind, clears at 25m (2500 cm) ahead.
- In `ATrafficSwarmManager`, NEVER call `ISM->UpdateInstanceTransform()` in an individual loop. Accumulate all updated civilian vehicle transforms into a `TArray<FTransform>` during `Tick()` and flush them in a single call via `ISM->BatchUpdateInstancesTransforms(0, NewTransforms, false, true)`.
