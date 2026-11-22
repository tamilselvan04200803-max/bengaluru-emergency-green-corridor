// Copyright (c) 2026 Bengaluru Digital Twin Initiative. All Rights Reserved.

#include "AmbulanceFleetManager.h"
#include "TrafficClearance.h"
#include "AmbulanceActor.h"
#include "TrafficJunctionActor.h"
#include "RoadSplineNetworkGenerator.h"
#include "CesiumGeoreference.h"
#include "Kismet/GameplayStatics.h"

AAmbulanceFleetManager::AAmbulanceFleetManager()
{
	PrimaryActorTick.bCanEverTick = false;

	SceneRoot = CreateDefaultSubobject<USceneComponent>(TEXT("SceneRoot"));
	SetRootComponent(SceneRoot);

	AmbulanceActorClass = AAmbulanceActor::StaticClass();
}

void AAmbulanceFleetManager::BeginPlay()
{
	Super::BeginPlay();

	ResolveDependencies();
	IndexTrafficJunctions();

	// Subscribe to UTelemetryWebSocketSubsystem delegates
	UGameInstance* GameInstance = GetGameInstance();
	if (GameInstance)
	{
		UTelemetryWebSocketSubsystem* TelemetrySubsystem = GameInstance->GetSubsystem<UTelemetryWebSocketSubsystem>();
		if (TelemetrySubsystem)
		{
			TelemetrySubsystem->OnAmbulanceTelemetryReceived.AddDynamic(this, &AAmbulanceFleetManager::HandleAmbulanceTelemetry);
			TelemetrySubsystem->OnCorridorStateReceived.AddDynamic(this, &AAmbulanceFleetManager::HandleStatePayload);
			UE_LOG(LogTrafficClearance, Log, TEXT("AAmbulanceFleetManager: Subscribed to UTelemetryWebSocketSubsystem delegates."));
		}
		else
		{
			UE_LOG(LogTrafficClearance, Warning, TEXT("AAmbulanceFleetManager: Failed to get UTelemetryWebSocketSubsystem!"));
		}
	}
}

void AAmbulanceFleetManager::EndPlay(const EEndPlayReason::Type EndPlayReason)
{
	UGameInstance* GameInstance = GetGameInstance();
	if (GameInstance)
	{
		UTelemetryWebSocketSubsystem* TelemetrySubsystem = GameInstance->GetSubsystem<UTelemetryWebSocketSubsystem>();
		if (TelemetrySubsystem)
		{
			TelemetrySubsystem->OnAmbulanceTelemetryReceived.RemoveDynamic(this, &AAmbulanceFleetManager::HandleAmbulanceTelemetry);
			TelemetrySubsystem->OnCorridorStateReceived.RemoveDynamic(this, &AAmbulanceFleetManager::HandleStatePayload);
		}
	}

	Super::EndPlay(EndPlayReason);
}

void AAmbulanceFleetManager::ResolveDependencies()
{
	UWorld* World = GetWorld();
	if (!World)
	{
		return;
	}

	if (!IsValid(RoadSplineGenerator))
	{
		AActor* FoundGen = UGameplayStatics::GetActorOfClass(World, ARoadSplineNetworkGenerator::StaticClass());
		if (FoundGen)
		{
			RoadSplineGenerator = Cast<ARoadSplineNetworkGenerator>(FoundGen);
		}
	}

	if (!IsValid(CesiumGeoreference))
	{
		AActor* FoundGeo = UGameplayStatics::GetActorOfClass(World, ACesiumGeoreference::StaticClass());
		if (FoundGeo)
		{
			CesiumGeoreference = Cast<ACesiumGeoreference>(FoundGeo);
		}
	}
}

void AAmbulanceFleetManager::IndexTrafficJunctions()
{
	JunctionMapByOsmId.Empty();

	UWorld* World = GetWorld();
	if (!World)
	{
		return;
	}

	TArray<AActor*> FoundActors;
	UGameplayStatics::GetAllActorsOfClass(World, ATrafficJunctionActor::StaticClass(), FoundActors);

	for (AActor* Actor : FoundActors)
	{
		ATrafficJunctionActor* Junction = Cast<ATrafficJunctionActor>(Actor);
		if (!IsValid(Junction))
		{
			continue;
		}

		// 1. If OsmId is already explicitly set, index it directly
		if (Junction->OsmId != 0)
		{
			JunctionMapByOsmId.Add(Junction->OsmId, Junction);
		}
		// 2. Otherwise derive OsmId from JunctionId string
		else if (!Junction->JunctionId.IsEmpty())
		{
			int64 DerivedOsmId = 0;
			if (Junction->JunctionId.IsNumeric())
			{
				DerivedOsmId = FCString::Atoi64(*Junction->JunctionId);
			}
			else
			{
				FString DigitsOnly;
				for (TCHAR Ch : Junction->JunctionId)
				{
					if (FChar::IsDigit(Ch))
					{
						DigitsOnly.AppendChar(Ch);
					}
				}

				if (!DigitsOnly.IsEmpty())
				{
					DerivedOsmId = FCString::Atoi64(*DigitsOnly);
				}
				else
				{
					DerivedOsmId = static_cast<int64>(GetTypeHash(Junction->JunctionId));
				}
			}

			Junction->OsmId = DerivedOsmId;
			JunctionMapByOsmId.Add(DerivedOsmId, Junction);
		}
	}

	UE_LOG(LogTrafficClearance, Log, TEXT("AAmbulanceFleetManager: Indexed %d traffic junctions by OsmId."), JunctionMapByOsmId.Num());
}

void AAmbulanceFleetManager::HandleAmbulanceTelemetry(const FAmbulanceTelemetryPayload& Payload)
{
	if (Payload.VehicleId.IsEmpty())
	{
		return;
	}

	// 1. Check if ambulance already exists
	TObjectPtr<AAmbulanceActor>* FoundActorPtr = ActiveAmbulanceMap.Find(Payload.VehicleId);
	AAmbulanceActor* AmbulanceActor = (FoundActorPtr && IsValid(*FoundActorPtr)) ? FoundActorPtr->Get() : nullptr;

	if (AmbulanceActor)
	{
		// Stale Packet Protection: drop packets where Payload.Timestamp <= ExistingActor->LastTelemetryTimestamp
		if (Payload.Timestamp <= AmbulanceActor->LastTelemetryTimestamp)
		{
			UE_LOG(LogTrafficClearance, Verbose, TEXT("AAmbulanceFleetManager: Stale telemetry packet dropped for [%s] (%.4f <= %.4f)"),
				*Payload.VehicleId, Payload.Timestamp, AmbulanceActor->LastTelemetryTimestamp);
			return;
		}
	}
	else
	{
		// Dynamically spawn AAmbulanceActor when an unknown vehicle_id arrives
		AmbulanceActor = SpawnAmbulanceActor(Payload.VehicleId, Payload);
		if (!AmbulanceActor)
		{
			UE_LOG(LogTrafficClearance, Error, TEXT("AAmbulanceFleetManager: Failed to spawn ambulance actor for [%s]"), *Payload.VehicleId);
			return;
		}

		ActiveAmbulanceMap.Add(Payload.VehicleId, AmbulanceActor);
	}

	// Route valid telemetry payload to matching AAmbulanceActor
	AmbulanceActor->ReceiveTelemetryUpdate(Payload);

	// Process Green Wave array or fallback single preemption
	if (Payload.bPriorityActive)
	{
		if (Payload.GreenWaveJunctionIds.Num() > 0)
		{
			HandleGreenWaveJunctionIds(Payload.VehicleId, Payload.HeadingDeg, Payload.GreenWaveJunctionIds);
		}
		else if (Payload.PreemptJunctionOsmId != 0)
		{
			TArray<int64> SingleWave;
			SingleWave.Add(Payload.PreemptJunctionOsmId);
			HandleGreenWaveJunctionIds(Payload.VehicleId, Payload.HeadingDeg, SingleWave);
		}
		else
		{
			TArray<int64> EmptyWave;
			HandleGreenWaveJunctionIds(Payload.VehicleId, Payload.HeadingDeg, EmptyWave);
		}
	}
	else
	{
		TArray<int64> EmptyWave;
		HandleGreenWaveJunctionIds(Payload.VehicleId, Payload.HeadingDeg, EmptyWave);
	}
}

AAmbulanceActor* AAmbulanceFleetManager::SpawnAmbulanceActor(const FString& InVehicleId, const FAmbulanceTelemetryPayload& InitialPayload)
{
	UWorld* World = GetWorld();
	if (!World)
	{
		return nullptr;
	}

	FActorSpawnParameters SpawnParams;
	SpawnParams.Owner = this;
	SpawnParams.SpawnCollisionHandlingOverride = ESpawnActorCollisionHandlingMethod::AlwaysSpawn;

	UClass* ClassToSpawn = AmbulanceActorClass ? AmbulanceActorClass.Get() : AAmbulanceActor::StaticClass();

	AAmbulanceActor* NewAmbulance = World->SpawnActor<AAmbulanceActor>(ClassToSpawn, FVector::ZeroVector, FRotator::ZeroRotator, SpawnParams);
	if (!NewAmbulance)
	{
		return nullptr;
	}

	NewAmbulance->VehicleId = InVehicleId;
	NewAmbulance->SplineGenerator = RoadSplineGenerator;
	NewAmbulance->CesiumGeoreference = CesiumGeoreference;
	NewAmbulance->FleetManager = this;

#if WITH_EDITOR
	NewAmbulance->SetActorLabel(FString::Printf(TEXT("Ambulance_%s"), *InVehicleId));
#endif

	UE_LOG(LogTrafficClearance, Log, TEXT("AAmbulanceFleetManager: Spawned new ambulance actor [%s]."), *InVehicleId);
	return NewAmbulance;
}

ATrafficJunctionActor* AAmbulanceFleetManager::TriggerJunctionPreemption(int64 JunctionOsmId, const FString& VehicleId, float HeadingDeg)
{
	if (JunctionOsmId == 0)
	{
		return nullptr;
	}

	ATrafficJunctionActor* Junction = GetJunctionByOsmId(JunctionOsmId);
	if (IsValid(Junction))
	{
		Junction->ActivatePriorityOverride(VehicleId, HeadingDeg);
		UE_LOG(LogTrafficClearance, Warning, TEXT("AAmbulanceFleetManager: Priority corridor override triggered on Junction [%lld (%s)] for Vehicle [%s]."),
			JunctionOsmId, *Junction->JunctionName, *VehicleId);
		return Junction;
	}

	UE_LOG(LogTrafficClearance, Warning, TEXT("AAmbulanceFleetManager: Junction with OsmId [%lld] not found in JunctionMap!"), JunctionOsmId);
	return nullptr;
}

void AAmbulanceFleetManager::ClearJunctionPreemption(int64 JunctionOsmId, const FString& VehicleId, bool bForceClear)
{
	if (JunctionOsmId == 0)
	{
		return;
	}

	ATrafficJunctionActor* Junction = GetJunctionByOsmId(JunctionOsmId);
	if (IsValid(Junction))
	{
		Junction->DeactivatePriorityOverride(VehicleId, bForceClear);
		UE_LOG(LogTrafficClearance, Log, TEXT("AAmbulanceFleetManager: Priority corridor cleared on Junction [%lld (%s)] for Vehicle [%s]."),
			JunctionOsmId, *Junction->JunctionName, *VehicleId);
	}
}

AAmbulanceActor* AAmbulanceFleetManager::GetAmbulance(const FString& InVehicleId) const
{
	const TObjectPtr<AAmbulanceActor>* FoundPtr = ActiveAmbulanceMap.Find(InVehicleId);
	return (FoundPtr && IsValid(*FoundPtr)) ? FoundPtr->Get() : nullptr;
}

ATrafficJunctionActor* AAmbulanceFleetManager::GetJunctionByOsmId(int64 JunctionOsmId) const
{
	const TObjectPtr<ATrafficJunctionActor>* FoundPtr = JunctionMapByOsmId.Find(JunctionOsmId);
	return (FoundPtr && IsValid(*FoundPtr)) ? FoundPtr->Get() : nullptr;
}

void AAmbulanceFleetManager::HandleGreenWaveJunctionIds(const FString& VehicleId, float HeadingDeg, const TArray<int64>& GreenWaveJunctionIds)
{
	FGreenWaveJunctionList* ExistingList = ActiveGreenWaveJunctions.Find(VehicleId);
	TSet<int64> PreviousJunctions;
	if (ExistingList)
	{
		PreviousJunctions.Append(ExistingList->JunctionOsmIds);
	}

	TSet<int64> CurrentJunctions(GreenWaveJunctionIds);

	// 1. Activate newly entered or current green wave junctions
	for (int64 JunctionOsmId : GreenWaveJunctionIds)
	{
		ATrafficJunctionActor* Junction = GetJunctionByOsmId(JunctionOsmId);
		if (IsValid(Junction))
		{
			Junction->ProcessGreenWaveRequest(VehicleId, HeadingDeg);
		}
	}

	// 2. Clear junctions that have left the wave window
	for (int64 PrevId : PreviousJunctions)
	{
		if (!CurrentJunctions.Contains(PrevId))
		{
			ATrafficJunctionActor* Junction = GetJunctionByOsmId(PrevId);
			if (IsValid(Junction))
			{
				Junction->ReleaseGreenWaveLock(VehicleId);
			}
		}
	}

	// 3. Update cached wave list
	ActiveGreenWaveJunctions.FindOrAdd(VehicleId).JunctionOsmIds = GreenWaveJunctionIds;
}

void AAmbulanceFleetManager::HandleStatePayload(const FCorridorStatePayload& StatePayload)
{
	LatestStatePayload = StatePayload;
	UE_LOG(LogTrafficClearance, Verbose, TEXT("AAmbulanceFleetManager: Received 2Hz Corridor State. ClearRate: %.1f%%, TotalOverrides: %d"),
		StatePayload.RouteClearRate, StatePayload.TotalSignalOverrides);
}
