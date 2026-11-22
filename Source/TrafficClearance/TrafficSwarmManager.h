// Copyright (c) 2026 Bengaluru Digital Twin Initiative. All Rights Reserved.

#pragma once

#include "CoreMinimal.h"
#include "GameFramework/Actor.h"
#include "Components/InstancedStaticMeshComponent.h"
#include "Components/SplineComponent.h"
#include "TrafficSwarmManager.generated.h"

class AAmbulanceFleetManager;
class ARoadSplineNetworkGenerator;
class ATrafficJunctionActor;

/**
 * State representation for an individual civilian vehicle simulated on a road spline.
 */
USTRUCT(BlueprintType)
struct TRAFFICCLEARANCE_API FCivilianVehicleState
{
	GENERATED_BODY()

	/** OpenStreetMap Way ID of the road this vehicle occupies */
	UPROPERTY(EditAnywhere, BlueprintReadWrite, Category = "TrafficClearance|Swarm")
	int64 RoadOsmId = 0;

	/** Cached pointer to road spline component */
	UPROPERTY(Transient)
	TObjectPtr<USplineComponent> SplineComponent = nullptr;

	/** 1D distance along spline in centimeters */
	UPROPERTY(EditAnywhere, BlueprintReadWrite, Category = "TrafficClearance|Swarm")
	float DistanceAlongSpline = 0.0f;

	/** Total spline length in centimeters */
	UPROPERTY(EditAnywhere, BlueprintReadWrite, Category = "TrafficClearance|Swarm")
	float SplineLength = 0.0f;

	/** Target travel speed in centimeters per second */
	UPROPERTY(EditAnywhere, BlueprintReadWrite, Category = "TrafficClearance|Swarm")
	float TargetSpeedCmPerSec = 1111.0f; // ~40 km/h

	/** Current speed in centimeters per second */
	UPROPERTY(EditAnywhere, BlueprintReadWrite, Category = "TrafficClearance|Swarm")
	float CurrentSpeedCmPerSec = 1111.0f;

	/** Current lateral displacement from road centerline (+ = right shoulder) */
	UPROPERTY(EditAnywhere, BlueprintReadWrite, Category = "TrafficClearance|Swarm")
	float LateralOffsetCm = 0.0f;

	/** Target lateral displacement lerp destination */
	UPROPERTY(EditAnywhere, BlueprintReadWrite, Category = "TrafficClearance|Swarm")
	float TargetLateralOffsetCm = 0.0f;

	/** Whether this vehicle is actively yielding to an approaching emergency vehicle */
	UPROPERTY(EditAnywhere, BlueprintReadWrite, Category = "TrafficClearance|Swarm")
	bool bYielding = false;

	/** Whether this vehicle is queued at a red or amber traffic signal */
	UPROPERTY(EditAnywhere, BlueprintReadWrite, Category = "TrafficClearance|Swarm")
	bool bQueuedAtRed = false;

	/** Index in InstancedStaticMeshComponent */
	UPROPERTY(EditAnywhere, BlueprintReadWrite, Category = "TrafficClearance|Swarm")
	int32 InstanceIndex = INDEX_NONE;
};

/**
 * High-performance Civilian Traffic Swarm Manager for Bengaluru Digital Twin.
 * Utilizes Instanced Static Mesh (ISM) rendering (single draw call) combined with
 * a parallel POD data array for 200+ civilian vehicles.
 * Executes red-light queuing and dynamic lateral Parting Wave emergency yielding.
 */
UCLASS(BlueprintType, Blueprintable)
class TRAFFICCLEARANCE_API ATrafficSwarmManager : public AActor
{
	GENERATED_BODY()

public:
	ATrafficSwarmManager();

	virtual void BeginPlay() override;
	virtual void Tick(float DeltaTime) override;

	/** Root scene component */
	UPROPERTY(VisibleAnywhere, BlueprintReadOnly, Category = "TrafficClearance|Components")
	USceneComponent* SceneRoot;

	/** Instanced Static Mesh Component rendering the civilian vehicle swarm in a single draw call */
	UPROPERTY(VisibleAnywhere, BlueprintReadOnly, Category = "TrafficClearance|Components")
	UInstancedStaticMeshComponent* VehicleISM;

	/** Static mesh asset to instantiate for civilian vehicles */
	UPROPERTY(EditAnywhere, BlueprintReadWrite, Category = "TrafficClearance|Configuration")
	UStaticMesh* CivilianVehicleMesh;

	/** Number of civilian vehicles to populate in the simulation */
	UPROPERTY(EditAnywhere, BlueprintReadWrite, Category = "TrafficClearance|Configuration")
	int32 NumCivilianVehicles = 200;

	/** Distance behind vehicle that triggers Parting Wave lateral yield (80m = 8000 cm) */
	UPROPERTY(EditAnywhere, BlueprintReadWrite, Category = "TrafficClearance|Configuration")
	float YieldTriggerDistanceCm = 8000.0f;

	/** Distance ahead of vehicle when emergency unit has passed and yield clears (25m = 2500 cm) */
	UPROPERTY(EditAnywhere, BlueprintReadWrite, Category = "TrafficClearance|Configuration")
	float PastClearDistanceCm = 2500.0f;

	/** Lateral displacement applied when yielding toward the road shoulder (cm) */
	UPROPERTY(EditAnywhere, BlueprintReadWrite, Category = "TrafficClearance|Configuration")
	float ShoulderOffsetCm = 120.0f;

	/** Interpolation rate for lateral offset transitions */
	UPROPERTY(EditAnywhere, BlueprintReadWrite, Category = "TrafficClearance|Configuration")
	float LateralLerpSpeed = 2.0f;

	/** Stop-line proximity threshold to detect signal halt (cm) */
	UPROPERTY(EditAnywhere, BlueprintReadWrite, Category = "TrafficClearance|Configuration")
	float StopLineDistanceCm = 300.0f;

	/** Vertical ground clearance offset above spline (cm) */
	UPROPERTY(EditAnywhere, BlueprintReadWrite, Category = "TrafficClearance|Configuration")
	float VerticalClearanceCm = 10.0f;

	/** Reference to RoadSplineNetworkGenerator */
	UPROPERTY(EditAnywhere, BlueprintReadWrite, Category = "TrafficClearance|Configuration")
	TObjectPtr<ARoadSplineNetworkGenerator> RoadSplineGenerator;

	/** Reference to AmbulanceFleetManager */
	UPROPERTY(EditAnywhere, BlueprintReadWrite, Category = "TrafficClearance|Configuration")
	TObjectPtr<AAmbulanceFleetManager> FleetManager;

	/** Spawns and distributes civilian vehicles randomly across road splines */
	UFUNCTION(BlueprintCallable, Category = "TrafficClearance|Swarm")
	void SpawnSwarm();

	/** Clears all instances and state array */
	UFUNCTION(BlueprintCallable, Category = "TrafficClearance|Swarm")
	void ClearSwarm();

	/** Total active vehicles currently simulated */
	UFUNCTION(BlueprintPure, Category = "TrafficClearance|Swarm")
	int32 GetVehicleCount() const { return CivilianVehicles.Num(); }

protected:
	/** Parallel data array storing state of all civilian vehicles */
	UPROPERTY(Transient)
	TArray<FCivilianVehicleState> CivilianVehicles;

	/** Pre-allocated transform buffer for ISM batch update */
	TArray<FTransform> BatchTransforms;

	/** Resolves world actor dependencies if unset */
	void ResolveDependencies();

	/** Updates physics, signal queueing, and parting wave for an individual civilian vehicle */
	void UpdateVehicleState(FCivilianVehicleState& Vehicle, float DeltaTime);
};
