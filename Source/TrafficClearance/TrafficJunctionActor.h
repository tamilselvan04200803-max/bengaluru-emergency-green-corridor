// Copyright (c) 2026 Bengaluru Digital Twin Initiative. All Rights Reserved.

#pragma once

#include "CoreMinimal.h"
#include "GameFramework/Actor.h"
#include "TrafficJunctionActor.generated.h"

/**
 * Traffic signal state machine states.
 */
UENUM(BlueprintType)
enum class ETrafficSignalState : uint8
{
	Red                 UMETA(DisplayName = "Red (Halt)"),
	Amber               UMETA(DisplayName = "Amber (Prepare)"),
	Green               UMETA(DisplayName = "Green (Pass)"),
	PriorityOverride    UMETA(DisplayName = "Emergency Priority (Green Corridor)")
};

DECLARE_DYNAMIC_MULTICAST_DELEGATE_TwoParams(FOnSignalStateChanged, ETrafficSignalState, NewState, ETrafficSignalState, PreviousState);
DECLARE_DYNAMIC_MULTICAST_DELEGATE_OneParam(FOnPriorityOverrideToggled, bool, bIsActive);

/**
 * Traffic Junction Actor representing a signalized intersection in the Bengaluru Digital Twin.
 * Supports autonomous cycling and dynamic Emergency Priority Corridor Preemption for ambulances.
 */
UCLASS(BlueprintType, Blueprintable)
class TRAFFICCLEARANCE_API ATrafficJunctionActor : public AActor
{
	GENERATED_BODY()

public:
	ATrafficJunctionActor();

	virtual void BeginPlay() override;
	virtual void Tick(float DeltaTime) override;

	/** Root scene component */
	UPROPERTY(VisibleAnywhere, BlueprintReadOnly, Category = "TrafficClearance|Components")
	USceneComponent* SceneRoot;

	/** Unique Junction Identifier matching GIS data */
	UPROPERTY(EditAnywhere, BlueprintReadWrite, Category = "TrafficClearance|Junction")
	FString JunctionId;

	/** OpenStreetMap Node / Feature ID for fast indexing */
	UPROPERTY(EditAnywhere, BlueprintReadWrite, Category = "TrafficClearance|Junction")
	int64 OsmId = 0;

	/** Human-readable Junction name (e.g., "Corporation Circle", "Town Hall") */
	UPROPERTY(EditAnywhere, BlueprintReadWrite, Category = "TrafficClearance|Junction")
	FString JunctionName;

	/** WGS84 Geographic Location (X=Longitude, Y=Latitude, Z=Altitude) */
	UPROPERTY(EditAnywhere, BlueprintReadWrite, Category = "TrafficClearance|Junction")
	FVector WGS84Location = FVector::ZeroVector;

	/** Current operational signal state */
	UPROPERTY(VisibleAnywhere, BlueprintReadOnly, Category = "TrafficClearance|SignalState")
	ETrafficSignalState CurrentSignalState = ETrafficSignalState::Red;

	/** State before priority override was engaged (restored when preemption clears) */
	UPROPERTY(VisibleAnywhere, BlueprintReadOnly, Category = "TrafficClearance|SignalState")
	ETrafficSignalState StatePriorToOverride = ETrafficSignalState::Red;

	/** Green light duration in seconds */
	UPROPERTY(EditAnywhere, BlueprintReadWrite, Category = "TrafficClearance|SignalTiming")
	float GreenDurationSeconds = 40.0f;

	/** Amber light duration in seconds */
	UPROPERTY(EditAnywhere, BlueprintReadWrite, Category = "TrafficClearance|SignalTiming")
	float AmberDurationSeconds = 5.0f;

	/** Red light duration in seconds */
	UPROPERTY(EditAnywhere, BlueprintReadWrite, Category = "TrafficClearance|SignalTiming")
	float RedDurationSeconds = 45.0f;

	/** Whether the junction is currently under Emergency Vehicle priority preemption */
	UPROPERTY(VisibleAnywhere, BlueprintReadOnly, Category = "TrafficClearance|EmergencyCorridor")
	bool bIsPriorityOverrideActive = false;

	/** Identifier of the emergency vehicle requesting priority (e.g., "AMB-108-01") */
	UPROPERTY(VisibleAnywhere, BlueprintReadOnly, Category = "TrafficClearance|EmergencyCorridor")
	FString ActivePreemptingVehicleId;

	/** Direction bearing/angle granted green during priority (degrees) */
	UPROPERTY(EditAnywhere, BlueprintReadWrite, Category = "TrafficClearance|EmergencyCorridor")
	float CorridorPriorityHeadingDeg = 0.0f;

	/** Event broadcast when signal state transitions */
	UPROPERTY(BlueprintAssignable, Category = "TrafficClearance|Events")
	FOnSignalStateChanged OnSignalStateChanged;

	/** Event broadcast when priority override status changes */
	UPROPERTY(BlueprintAssignable, Category = "TrafficClearance|Events")
	FOnPriorityOverrideToggled OnPriorityOverrideToggled;

	/** Identifier of the vehicle currently holding the conflict lock on this junction (empty if none) */
	UPROPERTY(VisibleAnywhere, BlueprintReadOnly, Category = "TrafficClearance|GreenWave")
	FString ConflictLockVehicleId;

	/**
	 * Preempts normal signal cycle and locks intersection into Emergency Green Corridor.
	 *
	 * @param EmergencyVehicleId Identifier of the ambulance or emergency unit.
	 * @param PriorityDirectionHeading Angle/bearing of the emergency corridor approach.
	 */
	UFUNCTION(BlueprintCallable, Category = "TrafficClearance|EmergencyCorridor")
	void ActivatePriorityOverride(const FString& EmergencyVehicleId, float PriorityDirectionHeading = 0.0f);

	/**
	 * Clears emergency corridor preemption and smoothly resumes standard cycle.
	 *
	 * @param EmergencyVehicleId Must match active vehicle or be forced clear.
	 * @param bForceClear If true, clears regardless of vehicle ID.
	 */
	UFUNCTION(BlueprintCallable, Category = "TrafficClearance|EmergencyCorridor")
	void DeactivatePriorityOverride(const FString& EmergencyVehicleId, bool bForceClear = false);

	/**
	 * Processes a preemption request from an incoming Green Wave broadcast.
	 *
	 * @param VehicleId Identifier of requesting vehicle.
	 * @param HeadingDeg Approach angle/heading.
	 */
	UFUNCTION(BlueprintCallable, Category = "TrafficClearance|GreenWave")
	void ProcessGreenWaveRequest(const FString& VehicleId, float HeadingDeg = 0.0f);

	/**
	 * Releases green wave preemption lock if held by given vehicle.
	 *
	 * @param VehicleId Identifier of vehicle releasing lock.
	 */
	UFUNCTION(BlueprintCallable, Category = "TrafficClearance|GreenWave")
	void ReleaseGreenWaveLock(const FString& VehicleId);

	/**
	 * Manually forces a specific signal state.
	 */
	UFUNCTION(BlueprintCallable, Category = "TrafficClearance|SignalState")
	void SetSignalState(ETrafficSignalState NewState);

protected:
	/** Internal timer tracker for standard signal cycle progression */
	float CurrentPhaseTimer = 0.0f;

	void AdvanceNormalCycle(float DeltaTime);
	float GetDurationForState(ETrafficSignalState State) const;
	ETrafficSignalState GetNextState(ETrafficSignalState State) const;
};
