// Copyright (c) 2026 Bengaluru Digital Twin Initiative. All Rights Reserved.

#pragma once

#include "CoreMinimal.h"
#include "GameFramework/Actor.h"
#include "TelemetryWebSocketSubsystem.h"
#include "AmbulanceFleetManager.generated.h"

class AAmbulanceActor;
class ATrafficJunctionActor;
class ARoadSplineNetworkGenerator;
class ACesiumGeoreference;

USTRUCT(BlueprintType)
struct TRAFFICCLEARANCE_API FGreenWaveJunctionList
{
	GENERATED_BODY()

	UPROPERTY(EditAnywhere, BlueprintReadWrite, Category = "TrafficClearance|Fleet")
	TArray<int64> JunctionOsmIds;
};

/**
 * Ambulance Fleet Manager Actor for Bengaluru Digital Twin.
 * Central coordinator that subscribes to UTelemetryWebSocketSubsystem,
 * dynamically spawns and manages AAmbulanceActor instances, prevents stale packet processing,
 * maintains O(1) junction lookup table by OsmId, and dispatches junction preemption overrides.
 */
UCLASS(BlueprintType, Blueprintable)
class TRAFFICCLEARANCE_API AAmbulanceFleetManager : public AActor
{
	GENERATED_BODY()

public:
	AAmbulanceFleetManager();

	virtual void BeginPlay() override;
	virtual void EndPlay(const EEndPlayReason::Type EndPlayReason) override;

	/** Root scene component */
	UPROPERTY(VisibleAnywhere, BlueprintReadOnly, Category = "TrafficClearance|Components")
	USceneComponent* SceneRoot;

	/** Class of ambulance actor to spawn dynamically */
	UPROPERTY(EditAnywhere, BlueprintReadWrite, Category = "TrafficClearance|Configuration")
	TSubclassOf<AAmbulanceActor> AmbulanceActorClass;

	/** Reference to RoadSplineNetworkGenerator actor in level */
	UPROPERTY(EditAnywhere, BlueprintReadWrite, Category = "TrafficClearance|Configuration")
	TObjectPtr<ARoadSplineNetworkGenerator> RoadSplineGenerator;

	/** Reference to CesiumGeoreference actor in level */
	UPROPERTY(EditAnywhere, BlueprintReadWrite, Category = "TrafficClearance|Configuration")
	TObjectPtr<ACesiumGeoreference> CesiumGeoreference;

	/** Map of active ambulance actors keyed by vehicle_id */
	UPROPERTY(VisibleAnywhere, BlueprintReadOnly, Category = "TrafficClearance|Fleet")
	TMap<FString, TObjectPtr<AAmbulanceActor>> ActiveAmbulanceMap;

	/** Map of traffic junction actors keyed by OSM Junction Node ID for instant preemption lookup */
	UPROPERTY(VisibleAnywhere, BlueprintReadOnly, Category = "TrafficClearance|Fleet")
	TMap<int64, TObjectPtr<ATrafficJunctionActor>> JunctionMapByOsmId;

	/** Map of currently active green wave junctions per vehicle ID */
	UPROPERTY(VisibleAnywhere, BlueprintReadOnly, Category = "TrafficClearance|Fleet")
	TMap<FString, FGreenWaveJunctionList> ActiveGreenWaveJunctions;

	/** Latest corridor state payload received from 2Hz broadcast */
	UPROPERTY(VisibleAnywhere, BlueprintReadOnly, Category = "TrafficClearance|Fleet")
	FCorridorStatePayload LatestStatePayload;

	/**
	 * Callback bound to UTelemetryWebSocketSubsystem::OnAmbulanceTelemetryReceived.
	 * Filters stale packets, spawns actors if unseen vehicle_id, and routes telemetry.
	 */
	UFUNCTION(BlueprintCallable, Category = "TrafficClearance|Fleet")
	void HandleAmbulanceTelemetry(const FAmbulanceTelemetryPayload& Payload);

	/**
	 * Callback bound to UTelemetryWebSocketSubsystem::OnCorridorStateReceived.
	 */
	UFUNCTION(BlueprintCallable, Category = "TrafficClearance|Fleet")
	void HandleStatePayload(const FCorridorStatePayload& StatePayload);

	/**
	 * Dispatches Green Wave preemption across an array of upcoming junctions.
	 */
	UFUNCTION(BlueprintCallable, Category = "TrafficClearance|Fleet")
	void HandleGreenWaveJunctionIds(const FString& VehicleId, float HeadingDeg, const TArray<int64>& GreenWaveJunctionIds);

	/**
	 * Returns the most recently received corridor state payload.
	 */
	UFUNCTION(BlueprintPure, Category = "TrafficClearance|Fleet")
	const FCorridorStatePayload& GetLatestStatePayload() const { return LatestStatePayload; }

	/**
	 * Scans the level and populates JunctionMapByOsmId from all ATrafficJunctionActor instances.
	 */
	UFUNCTION(BlueprintCallable, Category = "TrafficClearance|Fleet")
	void IndexTrafficJunctions();

	/**
	 * Triggers emergency priority green corridor on a junction given its OSM Node ID.
	 *
	 * @param JunctionOsmId OpenStreetMap Node ID of the junction.
	 * @param VehicleId Identifier of requesting emergency unit.
	 * @param HeadingDeg Approach heading angle in degrees.
	 * @return Pointer to preempted ATrafficJunctionActor if found and triggered, nullptr otherwise.
	 */
	UFUNCTION(BlueprintCallable, Category = "TrafficClearance|Fleet")
	ATrafficJunctionActor* TriggerJunctionPreemption(int64 JunctionOsmId, const FString& VehicleId, float HeadingDeg = 0.0f);

	/**
	 * Clears emergency priority override on a junction given its OSM Node ID.
	 *
	 * @param JunctionOsmId OpenStreetMap Node ID of the junction.
	 * @param VehicleId Identifier of emergency unit.
	 * @param bForceClear If true, clears regardless of vehicle ID.
	 */
	UFUNCTION(BlueprintCallable, Category = "TrafficClearance|Fleet")
	void ClearJunctionPreemption(int64 JunctionOsmId, const FString& VehicleId, bool bForceClear = false);

	/**
	 * Returns the active ambulance actor for a given vehicle ID.
	 */
	UFUNCTION(BlueprintPure, Category = "TrafficClearance|Fleet")
	AAmbulanceActor* GetAmbulance(const FString& InVehicleId) const;

	/**
	 * Returns the traffic junction actor associated with the given OSM Node ID.
	 */
	UFUNCTION(BlueprintPure, Category = "TrafficClearance|Fleet")
	ATrafficJunctionActor* GetJunctionByOsmId(int64 JunctionOsmId) const;

protected:
	/** Internal method to spawn a new ambulance actor for a vehicle ID */
	AAmbulanceActor* SpawnAmbulanceActor(const FString& InVehicleId, const FAmbulanceTelemetryPayload& InitialPayload);

	/** Resolves scene dependencies (SplineGenerator, CesiumGeoreference) */
	void ResolveDependencies();
};
