// Copyright (c) 2026 Bengaluru Digital Twin Initiative. All Rights Reserved.

#include "TrafficJunctionActor.h"
#include "TrafficClearance.h"

ATrafficJunctionActor::ATrafficJunctionActor()
{
	PrimaryActorTick.bCanEverTick = true;

	SceneRoot = CreateDefaultSubobject<USceneComponent>(TEXT("SceneRoot"));
	SetRootComponent(SceneRoot);

	CurrentSignalState = ETrafficSignalState::Red;
	CurrentPhaseTimer = 0.0f;
}

void ATrafficJunctionActor::BeginPlay()
{
	Super::BeginPlay();

	CurrentPhaseTimer = 0.0f;
	UE_LOG(LogTrafficClearance, Log, TEXT("ATrafficJunctionActor [%s]: Initialized at state %d."), *JunctionName, (int32)CurrentSignalState);
}

void ATrafficJunctionActor::Tick(float DeltaTime)
{
	Super::Tick(DeltaTime);

	if (!bIsPriorityOverrideActive)
	{
		AdvanceNormalCycle(DeltaTime);
	}
}

float ATrafficJunctionActor::GetDurationForState(ETrafficSignalState State) const
{
	switch (State)
	{
	case ETrafficSignalState::Green:
		return FMath::Max(1.0f, GreenDurationSeconds);
	case ETrafficSignalState::Amber:
		return FMath::Max(1.0f, AmberDurationSeconds);
	case ETrafficSignalState::Red:
	default:
		return FMath::Max(1.0f, RedDurationSeconds);
	}
}

ETrafficSignalState ATrafficJunctionActor::GetNextState(ETrafficSignalState State) const
{
	switch (State)
	{
	case ETrafficSignalState::Red:
		return ETrafficSignalState::Green;
	case ETrafficSignalState::Green:
		return ETrafficSignalState::Amber;
	case ETrafficSignalState::Amber:
		return ETrafficSignalState::Red;
	default:
		return ETrafficSignalState::Red;
	}
}

void ATrafficJunctionActor::AdvanceNormalCycle(float DeltaTime)
{
	CurrentPhaseTimer += DeltaTime;

	const float TargetDuration = GetDurationForState(CurrentSignalState);
	if (CurrentPhaseTimer >= TargetDuration)
	{
		CurrentPhaseTimer = 0.0f;
		const ETrafficSignalState Next = GetNextState(CurrentSignalState);
		SetSignalState(Next);
	}
}

void ATrafficJunctionActor::SetSignalState(ETrafficSignalState NewState)
{
	if (CurrentSignalState == NewState)
	{
		return;
	}

	const ETrafficSignalState OldState = CurrentSignalState;
	CurrentSignalState = NewState;

	UE_LOG(LogTrafficClearance, Verbose, TEXT("ATrafficJunctionActor [%s]: State changed from %d to %d."),
		*JunctionName, (int32)OldState, (int32)NewState);

	if (OnSignalStateChanged.IsBound())
	{
		OnSignalStateChanged.Broadcast(NewState, OldState);
	}
}

void ATrafficJunctionActor::ActivatePriorityOverride(const FString& EmergencyVehicleId, float PriorityDirectionHeading)
{
	if (!bIsPriorityOverrideActive)
	{
		StatePriorToOverride = CurrentSignalState;
	}

	bIsPriorityOverrideActive = true;
	ActivePreemptingVehicleId = EmergencyVehicleId;
	CorridorPriorityHeadingDeg = PriorityDirectionHeading;

	SetSignalState(ETrafficSignalState::PriorityOverride);

	UE_LOG(LogTrafficClearance, Warning, TEXT("ATrafficJunctionActor [%s]: EMERGENCY PRIORITY OVERRIDE ACTIVATED by Vehicle [%s]! Heading: %.1f deg."),
		*JunctionName, *EmergencyVehicleId, PriorityDirectionHeading);

	if (OnPriorityOverrideToggled.IsBound())
	{
		OnPriorityOverrideToggled.Broadcast(true);
	}
}

void ATrafficJunctionActor::DeactivatePriorityOverride(const FString& EmergencyVehicleId, bool bForceClear)
{
	if (!bIsPriorityOverrideActive)
	{
		return;
	}

	if (!bForceClear && !ActivePreemptingVehicleId.IsEmpty() && ActivePreemptingVehicleId != EmergencyVehicleId)
	{
		UE_LOG(LogTrafficClearance, Warning, TEXT("ATrafficJunctionActor [%s]: DeactivatePriorityOverride rejected - Vehicle mismatch (%s != %s)."),
			*JunctionName, *EmergencyVehicleId, *ActivePreemptingVehicleId);
		return;
	}

	if (bForceClear || ConflictLockVehicleId == EmergencyVehicleId)
	{
		ConflictLockVehicleId.Empty();
	}

	bIsPriorityOverrideActive = false;
	ActivePreemptingVehicleId.Empty();

	// Smooth transition: give Amber safety period before returning to normal red/green
	SetSignalState(ETrafficSignalState::Amber);
	CurrentPhaseTimer = 0.0f;

	UE_LOG(LogTrafficClearance, Log, TEXT("ATrafficJunctionActor [%s]: Emergency Priority Override cleared. Resuming normal cycle through Amber safety phase."),
		*JunctionName);

	if (OnPriorityOverrideToggled.IsBound())
	{
		OnPriorityOverrideToggled.Broadcast(false);
	}
}

void ATrafficJunctionActor::ProcessGreenWaveRequest(const FString& VehicleId, float HeadingDeg)
{
	if (ConflictLockVehicleId.IsEmpty())
	{
		ConflictLockVehicleId = VehicleId;
		ActivatePriorityOverride(VehicleId, HeadingDeg);
	}
	else if (ConflictLockVehicleId == VehicleId)
	{
		if (!bIsPriorityOverrideActive)
		{
			ActivatePriorityOverride(VehicleId, HeadingDeg);
		}
	}
	else
	{
		UE_LOG(LogTrafficClearance, Warning, TEXT("ATrafficJunctionActor [%s]: Conflict! Preemption requested by [%s] but lock held by [%s]."),
			*JunctionName, *VehicleId, *ConflictLockVehicleId);
	}
}

void ATrafficJunctionActor::ReleaseGreenWaveLock(const FString& VehicleId)
{
	if (ConflictLockVehicleId == VehicleId)
	{
		ConflictLockVehicleId.Empty();
		DeactivatePriorityOverride(VehicleId, false);
	}
}
