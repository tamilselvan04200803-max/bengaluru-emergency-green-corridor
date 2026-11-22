// Copyright (c) 2026 Bengaluru Digital Twin Initiative. All Rights Reserved.

#include "TrafficSwarmManager.h"
#include "AmbulanceFleetManager.h"
#include "AmbulanceActor.h"
#include "RoadSplineNetworkGenerator.h"
#include "TrafficJunctionActor.h"
#include "Kismet/GameplayStatics.h"

ATrafficSwarmManager::ATrafficSwarmManager()
{
	PrimaryActorTick.bCanEverTick = true;
	PrimaryActorTick.TickGroup = TG_PrePhysics;

	SceneRoot = CreateDefaultSubobject<USceneComponent>(TEXT("SceneRoot"));
	RootComponent = SceneRoot;

	VehicleISM = CreateDefaultSubobject<UInstancedStaticMeshComponent>(TEXT("VehicleISM"));
	VehicleISM->SetupAttachment(RootComponent);
	VehicleISM->SetCollisionEnabled(ECollisionEnabled::NoCollision);
	VehicleISM->SetGenerateOverlapEvents(false);
	VehicleISM->SetCastShadow(true);
}

void ATrafficSwarmManager::BeginPlay()
{
	Super::BeginPlay();

	ResolveDependencies();

	if (CivilianVehicleMesh && VehicleISM)
	{
		VehicleISM->SetStaticMesh(CivilianVehicleMesh);
	}

	SpawnSwarm();
}

void ATrafficSwarmManager::ResolveDependencies()
{
	UWorld* World = GetWorld();
	if (!World)
	{
		return;
	}

	if (!RoadSplineGenerator)
	{
		RoadSplineGenerator = Cast<ARoadSplineNetworkGenerator>(
			UGameplayStatics::GetActorOfClass(World, ARoadSplineNetworkGenerator::StaticClass()));
	}

	if (!FleetManager)
	{
		FleetManager = Cast<AAmbulanceFleetManager>(
			UGameplayStatics::GetActorOfClass(World, AAmbulanceFleetManager::StaticClass()));
	}
}

void ATrafficSwarmManager::ClearSwarm()
{
	if (VehicleISM)
	{
		VehicleISM->ClearInstances();
	}
	CivilianVehicles.Empty();
	BatchTransforms.Empty();
}

void ATrafficSwarmManager::SpawnSwarm()
{
	ClearSwarm();

	ResolveDependencies();

	if (!RoadSplineGenerator || RoadSplineGenerator->RoadSplines.Num() == 0)
	{
		UE_LOG(LogTemp, Warning, TEXT("[TrafficSwarmManager] RoadSplineGenerator has no road splines. Delaying swarm generation."));
		return;
	}

	const int32 NumSplines = RoadSplineGenerator->RoadSplines.Num();
	CivilianVehicles.Reserve(NumCivilianVehicles);
	BatchTransforms.Reserve(NumCivilianVehicles);

	for (int32 i = 0; i < NumCivilianVehicles; ++i)
	{
		const int32 SplineIndex = FMath::RandRange(0, NumSplines - 1);
		USplineComponent* Spline = RoadSplineGenerator->RoadSplines[SplineIndex];
		if (!Spline)
		{
			continue;
		}

		const float SplineLen = Spline->GetSplineLength();
		if (SplineLen <= 100.0f)
		{
			continue;
		}

		FCivilianVehicleState State;
		State.SplineComponent = Spline;
		State.SplineLength = SplineLen;
		State.DistanceAlongSpline = FMath::FRandRange(0.0f, SplineLen);
		
		// Map OsmId if available from RoadMetadata
		if (RoadSplineGenerator->RoadMetadata.IsValidIndex(SplineIndex))
		{
			State.RoadOsmId = RoadSplineGenerator->RoadMetadata[SplineIndex].OsmId;
			// Speed limit from road or default 35-50 km/h (972 - 1388 cm/s)
			const float MaxSpeedKmh = RoadSplineGenerator->RoadMetadata[SplineIndex].MaxSpeedKmh;
			const float BaseKmh = (MaxSpeedKmh > 0.0f) ? FMath::Min(MaxSpeedKmh, 50.0f) : 40.0f;
			State.TargetSpeedCmPerSec = (BaseKmh * 100000.0f / 3600.0f) * FMath::FRandRange(0.85f, 1.0f);
		}
		else
		{
			State.TargetSpeedCmPerSec = (40.0f * 100000.0f / 3600.0f) * FMath::FRandRange(0.85f, 1.0f);
		}

		State.CurrentSpeedCmPerSec = State.TargetSpeedCmPerSec;
		State.LateralOffsetCm = 0.0f;
		State.TargetLateralOffsetCm = 0.0f;
		State.bYielding = false;
		State.bQueuedAtRed = false;

		const FVector WorldLoc = Spline->GetLocationAtDistanceAlongSpline(State.DistanceAlongSpline, ESplineCoordinateSpace::World) + FVector(0.0f, 0.0f, VerticalClearanceCm);
		const FRotator WorldRot = Spline->GetRotationAtDistanceAlongSpline(State.DistanceAlongSpline, ESplineCoordinateSpace::World);
		const FTransform InitialTransform(WorldRot, WorldLoc, FVector(1.0f));

		State.InstanceIndex = VehicleISM->AddInstance(InitialTransform, true);
		CivilianVehicles.Add(State);
	}

	UE_LOG(LogTemp, Log, TEXT("[TrafficSwarmManager] Successfully spawned %d civilian vehicles across %d road splines."),
		CivilianVehicles.Num(), NumSplines);
}

void ATrafficSwarmManager::Tick(float DeltaTime)
{
	Super::Tick(DeltaTime);

	if (CivilianVehicles.Num() == 0 || !VehicleISM)
	{
		return;
	}

	BatchTransforms.Reset();
	BatchTransforms.Reserve(CivilianVehicles.Num());

	for (FCivilianVehicleState& Vehicle : CivilianVehicles)
	{
		UpdateVehicleState(Vehicle, DeltaTime);

		if (!Vehicle.SplineComponent)
		{
			BatchTransforms.Add(FTransform::Identity);
			continue;
		}

		// Evaluate center world location and orientation from spline
		FVector CenterLoc = Vehicle.SplineComponent->GetLocationAtDistanceAlongSpline(
			Vehicle.DistanceAlongSpline, ESplineCoordinateSpace::World);
		const FRotator Rotation = Vehicle.SplineComponent->GetRotationAtDistanceAlongSpline(
			Vehicle.DistanceAlongSpline, ESplineCoordinateSpace::World);

		// Calculate lateral offset along the right vector of the spline tangent
		const FVector Direction = Vehicle.SplineComponent->GetDirectionAtDistanceAlongSpline(
			Vehicle.DistanceAlongSpline, ESplineCoordinateSpace::World);
		const FVector RightVector = FVector::CrossProduct(FVector::UpVector, Direction).GetSafeNormal();

		CenterLoc += RightVector * Vehicle.LateralOffsetCm;
		CenterLoc.Z += VerticalClearanceCm;

		BatchTransforms.Add(FTransform(Rotation, CenterLoc, FVector(1.0f)));
	}

	// CRITICAL RULE: Flush all transforms in a single batch call.
	// Never call UpdateInstanceTransform() in an individual loop.
	VehicleISM->BatchUpdateInstancesTransforms(0, BatchTransforms, false, true);
}

void ATrafficSwarmManager::UpdateVehicleState(FCivilianVehicleState& Vehicle, float DeltaTime)
{
	if (!Vehicle.SplineComponent)
	{
		return;
	}

	// 1. Advance distance along spline
	Vehicle.CurrentSpeedCmPerSec = FMath::FInterpTo(Vehicle.CurrentSpeedCmPerSec, Vehicle.bQueuedAtRed ? 0.0f : Vehicle.TargetSpeedCmPerSec, DeltaTime, 4.0f);
	Vehicle.DistanceAlongSpline += Vehicle.CurrentSpeedCmPerSec * DeltaTime;

	// Loop back around road spline
	if (Vehicle.DistanceAlongSpline >= Vehicle.SplineLength)
	{
		Vehicle.DistanceAlongSpline = FMath::Fmod(Vehicle.DistanceAlongSpline, Vehicle.SplineLength);
	}

	// 2. Parting Wave Check against approaching ambulances
	bool bShouldYield = false;
	if (FleetManager)
	{
		for (const auto& Pair : FleetManager->ActiveAmbulanceMap)
		{
			const AAmbulanceActor* Amb = Pair.Value;
			if (!Amb || Amb->CurrentSplineComponent != Vehicle.SplineComponent)
			{
				continue;
			}

			// Distance behind/ahead along the same 1D spline
			const float AmbDistance = Amb->CurrentDistanceAlongSpline;
			const float RelativeDistance = Vehicle.DistanceAlongSpline - AmbDistance;

			// Ambulance is behind us within YieldTriggerDistance (80m = 8000 cm)
			if (RelativeDistance > 0.0f && RelativeDistance <= YieldTriggerDistanceCm)
			{
				bShouldYield = true;
				break;
			}
			// Ambulance has just passed and is ahead within PastClearDistance (25m = 2500 cm)
			else if (RelativeDistance < 0.0f && FMath::Abs(RelativeDistance) <= PastClearDistanceCm)
			{
				bShouldYield = true;
				break;
			}
		}
	}

	Vehicle.bYielding = bShouldYield;
	Vehicle.TargetLateralOffsetCm = bShouldYield ? ShoulderOffsetCm : 0.0f;
	Vehicle.LateralOffsetCm = FMath::FInterpTo(Vehicle.LateralOffsetCm, Vehicle.TargetLateralOffsetCm, DeltaTime, LateralLerpSpeed);

	// 3. Signal Queueing Check (End of spline or nearby signal actor)
	bool bHaltForSignal = false;
	const float DistToEnd = Vehicle.SplineLength - Vehicle.DistanceAlongSpline;
	if (DistToEnd <= StopLineDistanceCm && FleetManager)
	{
		// Check if there is an active signal at this junction
		const FVector EndLocation = Vehicle.SplineComponent->GetLocationAtDistanceAlongSpline(
			Vehicle.SplineLength, ESplineCoordinateSpace::World);

		for (const auto& Pair : FleetManager->JunctionMapByOsmId)
		{
			const ATrafficJunctionActor* Junction = Pair.Value;
			if (!Junction)
			{
				continue;
			}

			const float DistToJunction = FVector::Dist(EndLocation, Junction->GetActorLocation());
			if (DistToJunction <= 1500.0f) // Within 15m of junction actor
			{
				if (Junction->CurrentSignalState == ETrafficSignalState::Red ||
					Junction->CurrentSignalState == ETrafficSignalState::Amber)
				{
					bHaltForSignal = true;
				}
				break;
			}
		}
	}

	Vehicle.bQueuedAtRed = bHaltForSignal;
}
