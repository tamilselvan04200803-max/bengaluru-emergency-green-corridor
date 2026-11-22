// Copyright (c) 2026 Bengaluru Digital Twin Initiative. All Rights Reserved.

#pragma once

#include "CoreMinimal.h"
#include "GameFramework/Actor.h"
#include "Components/SplineComponent.h"
#include "CesiumGeoreference.h"
#include "TelemetryWebSocketSubsystem.h"
#include "AmbulanceActor.generated.h"

class ARoadSplineNetworkGenerator;
class AAmbulanceFleetManager;
class ATrafficJunctionActor;

/**
 * Ambulance Simulation Actor representing an emergency response vehicle in the Bengaluru Digital Twin.
 * Performs continuous 1D spline dead-reckoning interpolation, terrain clearance offset clamping,
 * look-ahead priority signal preemption, and post-junction automatic restoration.
 */
UCLASS(BlueprintType, Blueprintable)
class TRAFFICCLEARANCE_API AAmbulanceActor : public AActor
{
	GENERATED_BODY()

public:
	AAmbulanceActor();

	virtual void BeginPlay() override;
	virtual void Tick(float DeltaTime) override;

	/** Root scene component */
	UPROPERTY(VisibleAnywhere, BlueprintReadOnly, Category = "TrafficClearance|Components")
	USceneComponent* SceneRoot;

	/** Optional static mesh component for visual representation */
	UPROPERTY(VisibleAnywhere, BlueprintReadOnly, Category = "TrafficClearance|Components")
	UStaticMeshComponent* VehicleMesh;

	/** Unique vehicle identifier (e.g. "AMB-KA01-0911") */
	UPROPERTY(VisibleAnywhere, BlueprintReadOnly, Category = "TrafficClearance|Ambulance")
	FString VehicleId;

	/** Telemetry speed in kilometers per hour */
	UPROPERTY(VisibleAnywhere, BlueprintReadOnly, Category = "TrafficClearance|Ambulance")
	float SpeedKmh = 0.0f;

	/** Kinematic speed converted to Unreal centimeters per second */
	UPROPERTY(VisibleAnywhere, BlueprintReadOnly, Category = "TrafficClearance|Ambulance")
	float SpeedCmPerSec = 0.0f;

	/** OpenStreetMap Way ID of the currently occupied road segment */
	UPROPERTY(VisibleAnywhere, BlueprintReadOnly, Category = "TrafficClearance|Ambulance")
	int64 CurrentRoadOsmId = 0;

	/** Current distance along the spline in centimeters */
	UPROPERTY(VisibleAnywhere, BlueprintReadOnly, Category = "TrafficClearance|Ambulance")
	float CurrentDistanceAlongSpline = 0.0f;

	/** Target distance along the spline derived from latest GPS telemetry */
	UPROPERTY(VisibleAnywhere, BlueprintReadOnly, Category = "TrafficClearance|Ambulance")
	float TargetDistanceAlongSpline = 0.0f;

	/** Distance error delta smoothly decayed toward zero over time */
	UPROPERTY(VisibleAnywhere, BlueprintReadOnly, Category = "TrafficClearance|Ambulance")
	float DistanceErrorOffset = 0.0f;

	/** Currently assigned road spline component */
	UPROPERTY(VisibleAnywhere, BlueprintReadOnly, Category = "TrafficClearance|Ambulance")
	TObjectPtr<USplineComponent> CurrentSplineComponent = nullptr;

	/** Unix epoch timestamp of the latest accepted telemetry packet */
	UPROPERTY(VisibleAnywhere, BlueprintReadOnly, Category = "TrafficClearance|Ambulance")
	double LastTelemetryTimestamp = 0.0;

	/** Vertical offset added above spline/terrain in centimeters (default: 15.0 cm) */
	UPROPERTY(EditAnywhere, BlueprintReadWrite, Category = "TrafficClearance|Ambulance")
	float TerrainClearanceOffsetCm = 15.0f;

	/** Reference to RoadSplineNetworkGenerator actor in level */
	UPROPERTY(EditAnywhere, BlueprintReadWrite, Category = "TrafficClearance|References")
	TObjectPtr<ARoadSplineNetworkGenerator> SplineGenerator;

	/** Reference to CesiumGeoreference actor in level */
	UPROPERTY(EditAnywhere, BlueprintReadWrite, Category = "TrafficClearance|References")
	TObjectPtr<ACesiumGeoreference> CesiumGeoreference;

	/** Reference to Fleet Manager for junction preemption dispatches */
	UPROPERTY(VisibleAnywhere, BlueprintReadOnly, Category = "TrafficClearance|References")
	TObjectPtr<AAmbulanceFleetManager> FleetManager;

	/** OSM Node ID of currently active preempted junction (0 if none) */
	UPROPERTY(VisibleAnywhere, BlueprintReadOnly, Category = "TrafficClearance|Preemption")
	int64 ActivePreemptedJunctionOsmId = 0;

	/** Reference to currently preempted junction actor */
	UPROPERTY(VisibleAnywhere, BlueprintReadOnly, Category = "TrafficClearance|Preemption")
	TObjectPtr<ATrafficJunctionActor> ActivePreemptedJunction = nullptr;

	/**
	 * Ingests incoming 10Hz telemetry payload.
	 * Matches road spline via O(1) OsmId lookup or fallback spatial query,
	 * projects coordinates, computes distance error, and handles look-ahead preemption.
	 */
	UFUNCTION(BlueprintCallable, Category = "TrafficClearance|Ambulance")
	void ReceiveTelemetryUpdate(const FAmbulanceTelemetryPayload& Payload);

	/**
	 * Deactivates active priority corridor override on junction.
	 */
	UFUNCTION(BlueprintCallable, Category = "TrafficClearance|Ambulance")
	void ClearActiveJunctionPreemption();

protected:
	/** Threshold distance in centimeters past a preempted junction before restoring signals (30 meters = 3000 cm) */
	UPROPERTY(EditAnywhere, BlueprintReadWrite, Category = "TrafficClearance|Preemption")
	float JunctionRestorationDistanceThresholdCm = 3000.0f;

	/** Rate of exponential decay for DistanceErrorOffset */
	UPROPERTY(EditAnywhere, BlueprintReadWrite, Category = "TrafficClearance|Ambulance")
	float DistanceErrorDecaySpeed = 6.0f;

	/** Resolves scene dependencies (SplineGenerator, CesiumGeoreference) if not set */
	void ResolveDependencies();

	/** Evaluates whether vehicle has passed the active preempted junction by > 30m */
	void CheckPostJunctionRestoration();
};
