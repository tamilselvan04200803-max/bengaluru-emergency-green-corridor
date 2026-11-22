// Copyright (c) 2026 Bengaluru Digital Twin Initiative. All Rights Reserved.

#include "AmbulanceActor.h"
#include "TrafficClearance.h"
#include "RoadSplineNetworkGenerator.h"
#include "AmbulanceFleetManager.h"
#include "TrafficJunctionActor.h"
#include "GeoCoordinateTransformer.h"
#include "Kismet/GameplayStatics.h"

AAmbulanceActor::AAmbulanceActor()
{
	PrimaryActorTick.bCanEverTick = true;

	SceneRoot = CreateDefaultSubobject<USceneComponent>(TEXT("SceneRoot"));
	SetRootComponent(SceneRoot);

	VehicleMesh = CreateDefaultSubobject<UStaticMeshComponent>(TEXT("VehicleMesh"));
	VehicleMesh->SetupAttachment(SceneRoot);
	VehicleMesh->SetCollisionProfileName(UCollisionProfile::NoCollision_ProfileName);

	TerrainClearanceOffsetCm = 15.0f;
	DistanceErrorDecaySpeed = 6.0f;
	JunctionRestorationDistanceThresholdCm = 3000.0f;
}

void AAmbulanceActor::BeginPlay()
{
	Super::BeginPlay();

	ResolveDependencies();
}

void AAmbulanceActor::ResolveDependencies()
{
	UWorld* World = GetWorld();
	if (!World)
	{
		return;
	}

	// Auto-resolve RoadSplineNetworkGenerator if not linked
	if (!IsValid(SplineGenerator))
	{
		AActor* FoundGen = UGameplayStatics::GetActorOfClass(World, ARoadSplineNetworkGenerator::StaticClass());
		if (FoundGen)
		{
			SplineGenerator = Cast<ARoadSplineNetworkGenerator>(FoundGen);
		}
	}

	// Auto-resolve CesiumGeoreference if not linked
	if (!IsValid(CesiumGeoreference))
	{
		AActor* FoundGeo = UGameplayStatics::GetActorOfClass(World, ACesiumGeoreference::StaticClass());
		if (FoundGeo)
		{
			CesiumGeoreference = Cast<ACesiumGeoreference>(FoundGeo);
		}
	}

	// Auto-resolve FleetManager if not linked
	if (!IsValid(FleetManager))
	{
		AActor* FoundMgr = UGameplayStatics::GetActorOfClass(World, AAmbulanceFleetManager::StaticClass());
		if (FoundMgr)
		{
			FleetManager = Cast<AAmbulanceFleetManager>(FoundMgr);
		}
	}
}

void AAmbulanceActor::ReceiveTelemetryUpdate(const FAmbulanceTelemetryPayload& Payload)
{
	ResolveDependencies();

	VehicleId = Payload.VehicleId;
	LastTelemetryTimestamp = Payload.Timestamp;
	SpeedKmh = Payload.SpeedKmh;

	// Convert km/h to cm/s (1 km/h = 1000 m / 3600 s = (100000 cm / 3600 s) = 100/3.6 = 27.777778 cm/s)
	SpeedCmPerSec = (SpeedKmh * 100000.0f) / 3600.0f;

	CurrentRoadOsmId = Payload.CurrentRoadOsmId;

	// 1. Convert WGS84 GPS coords (Lon, Lat, Alt) to Unreal World coordinates
	FVector TargetUnrealWorldPos = FVector::ZeroVector;
	if (IsValid(CesiumGeoreference))
	{
		UGeoCoordinateTransformer::WGS84ToUnreal(
			CesiumGeoreference,
			Payload.Longitude,
			Payload.Latitude,
			Payload.Altitude,
			TargetUnrealWorldPos
		);
	}
	else
	{
		UE_LOG(LogTrafficClearance, Warning, TEXT("AAmbulanceActor [%s]: CesiumGeoreference is invalid during telemetry update!"), *VehicleId);
		TargetUnrealWorldPos = GetActorLocation();
	}

	// 2. O(1) Road Spline Lookup: query SplineGenerator->GetSplineByOsmId
	USplineComponent* MatchedSpline = nullptr;
	if (IsValid(SplineGenerator))
	{
		if (Payload.CurrentRoadOsmId != 0)
		{
			MatchedSpline = SplineGenerator->GetSplineByOsmId(Payload.CurrentRoadOsmId);
		}

		// Fallback to spatial FindNearestRoad if spline is null or OsmId is 0
		if (!MatchedSpline)
		{
			FVector ClosestPointOnSpline;
			float DistanceCm = 0.0f;
			FParsedRoadSegment RoadMetadata;
			SplineGenerator->FindNearestRoad(TargetUnrealWorldPos, MatchedSpline, ClosestPointOnSpline, DistanceCm, RoadMetadata);
		}
	}

	// 3. Update current spline and distance along spline
	if (IsValid(MatchedSpline))
	{
		const bool bRoadChanged = (MatchedSpline != CurrentSplineComponent);
		CurrentSplineComponent = MatchedSpline;

		// Find distance along spline corresponding to target location
		const float InputKey = CurrentSplineComponent->FindInputKeyClosestToWorldLocation(TargetUnrealWorldPos);
		TargetDistanceAlongSpline = CurrentSplineComponent->GetDistanceAlongSplineAtSplineInputKey(InputKey);

		if (bRoadChanged || CurrentDistanceAlongSpline <= 0.0f)
		{
			// Snap on initial acquisition or road switch
			CurrentDistanceAlongSpline = TargetDistanceAlongSpline;
			DistanceErrorOffset = 0.0f;
		}
		else
		{
			// Compute distance delta and initialize DistanceErrorOffset for smooth blending
			const float SplineDelta = TargetDistanceAlongSpline - CurrentDistanceAlongSpline;
			DistanceErrorOffset = SplineDelta;
		}
	}
	else
	{
		// No spline found: fallback to placing actor directly at transformed location
		SetActorLocation(TargetUnrealWorldPos + FVector(0.0f, 0.0f, TerrainClearanceOffsetCm));
		if (Payload.HeadingDeg != 0.0f)
		{
			SetActorRotation(FRotator(0.0f, Payload.HeadingDeg, 0.0f));
		}
	}

	// 4. Look-Ahead Priority Junction Preemption
	if (Payload.bPriorityActive && Payload.PreemptJunctionOsmId != 0)
	{
		if (ActivePreemptedJunctionOsmId != Payload.PreemptJunctionOsmId)
		{
			// Clear any previous preemption if switching junctions
			ClearActiveJunctionPreemption();

			ActivePreemptedJunctionOsmId = Payload.PreemptJunctionOsmId;
			if (IsValid(FleetManager))
			{
				ActivePreemptedJunction = FleetManager->TriggerJunctionPreemption(
					Payload.PreemptJunctionOsmId,
					VehicleId,
					Payload.HeadingDeg
				);
			}
			else
			{
				UE_LOG(LogTrafficClearance, Warning, TEXT("AAmbulanceActor [%s]: FleetManager missing for preemption of Junction %lld!"),
					*VehicleId, Payload.PreemptJunctionOsmId);
			}
		}
	}
	else if (!Payload.bPriorityActive && ActivePreemptedJunctionOsmId != 0)
	{
		// Emergency priority deactivated in telemetry
		ClearActiveJunctionPreemption();
	}
}

void AAmbulanceActor::Tick(float DeltaTime)
{
	Super::Tick(DeltaTime);

	if (IsValid(CurrentSplineComponent))
	{
		// 1D Spline Dead-Reckoning: advance along spline using vehicle speed
		CurrentDistanceAlongSpline += SpeedCmPerSec * DeltaTime;

		// Smoothly decay DistanceErrorOffset toward 0
		DistanceErrorOffset = FMath::FInterpTo(DistanceErrorOffset, 0.0f, DeltaTime, DistanceErrorDecaySpeed);

		const float EffectiveDistance = CurrentDistanceAlongSpline + DistanceErrorOffset;
		const float SplineLength = CurrentSplineComponent->GetSplineLength();
		const float ClampedDistance = FMath::Clamp(EffectiveDistance, 0.0f, SplineLength);

		// Evaluate world transform strictly from spline
		const FVector SplineWorldLocation = CurrentSplineComponent->GetLocationAtDistanceAlongSpline(
			ClampedDistance,
			ESplineCoordinateSpace::World
		);

		const FRotator SplineWorldRotation = CurrentSplineComponent->GetRotationAtDistanceAlongSpline(
			ClampedDistance,
			ESplineCoordinateSpace::World
		);

		// Apply location with terrain clearance offset
		SetActorLocation(SplineWorldLocation + FVector(0.0f, 0.0f, TerrainClearanceOffsetCm));
		SetActorRotation(SplineWorldRotation);
	}

	// Post-Junction Automatic Signal Restoration Check
	CheckPostJunctionRestoration();
}

void AAmbulanceActor::CheckPostJunctionRestoration()
{
	if (ActivePreemptedJunctionOsmId == 0 || !IsValid(ActivePreemptedJunction))
	{
		return;
	}

	const FVector JunctionLocation = ActivePreemptedJunction->GetActorLocation();
	const FVector AmbulanceLocation = GetActorLocation();

	// Check if the vehicle has moved > 30 meters (3000 cm) past the junction
	const float DistanceToJunctionCm = FVector::Distance(AmbulanceLocation, JunctionLocation);

	// To ensure we have passed the junction (rather than still approaching from far away),
	// check relative direction using vehicle velocity / forward orientation
	const FVector ToJunction = JunctionLocation - AmbulanceLocation;
	const FVector ForwardVector = GetActorForwardVector();
	const float DotProduct = FVector::DotProduct(ForwardVector, ToJunction);

	// If DotProduct < 0, the junction is behind the vehicle (passed it).
	// If it is behind and distance is greater than the restoration threshold (> 3000 cm), deactivate preemption.
	if (DotProduct < 0.0f && DistanceToJunctionCm >= JunctionRestorationDistanceThresholdCm)
	{
		UE_LOG(LogTrafficClearance, Log, TEXT("AAmbulanceActor [%s]: Passed Junction [%lld] by %.1f cm (> %.1f cm). Restoring signal!"),
			*VehicleId, ActivePreemptedJunctionOsmId, DistanceToJunctionCm, JunctionRestorationDistanceThresholdCm);

		ClearActiveJunctionPreemption();
	}
}

void AAmbulanceActor::ClearActiveJunctionPreemption()
{
	if (ActivePreemptedJunctionOsmId == 0)
	{
		return;
	}

	if (IsValid(ActivePreemptedJunction))
	{
		ActivePreemptedJunction->DeactivatePriorityOverride(VehicleId);
	}
	else if (IsValid(FleetManager))
	{
		FleetManager->ClearJunctionPreemption(ActivePreemptedJunctionOsmId, VehicleId);
	}

	ActivePreemptedJunctionOsmId = 0;
	ActivePreemptedJunction = nullptr;
}
