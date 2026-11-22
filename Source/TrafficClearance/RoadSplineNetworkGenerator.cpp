// Copyright (c) 2026 Bengaluru Digital Twin Initiative. All Rights Reserved.

#include "RoadSplineNetworkGenerator.h"
#include "TrafficClearance.h"
#include "GeoCoordinateTransformer.h"
#include "Engine/World.h"
#include "CollisionQueryParams.h"
#include "Kismet/GameplayStatics.h"
#include "Misc/Paths.h"

ARoadSplineNetworkGenerator::ARoadSplineNetworkGenerator()
{
	PrimaryActorTick.bCanEverTick = false;

	SceneRoot = CreateDefaultSubobject<USceneComponent>(TEXT("SceneRoot"));
	SetRootComponent(SceneRoot);
}

void ARoadSplineNetworkGenerator::BeginPlay()
{
	Super::BeginPlay();

	// Auto-resolve CesiumGeoreference if not explicitly linked in details panel
	if (!IsValid(CesiumGeoreference))
	{
		AActor* FoundActor = UGameplayStatics::GetActorOfClass(GetWorld(), ACesiumGeoreference::StaticClass());
		if (FoundActor)
		{
			CesiumGeoreference = Cast<ACesiumGeoreference>(FoundActor);
			UE_LOG(LogTrafficClearance, Log, TEXT("ARoadSplineNetworkGenerator: Automatically resolved CesiumGeoreference in level."));
		}
	}

	// Auto-generate road network on level startup
	GenerateRoadNetwork();
}

void ARoadSplineNetworkGenerator::ClearRoadNetwork()
{
	for (USplineComponent* Spline : RoadSplines)
	{
		if (IsValid(Spline))
		{
			Spline->DestroyComponent();
		}
	}

	RoadSplines.Empty();
	RoadSplineMap.Empty();
	RoadSplineMapByOsmId.Empty();
	RoadMetadata.Empty();
}

bool ARoadSplineNetworkGenerator::DrapePointToTerrain(const FVector& InRawWorldLocation, FVector& OutDrapedWorldLocation) const
{
	UWorld* World = GetWorld();
	if (!World)
	{
		OutDrapedWorldLocation = InRawWorldLocation;
		return false;
	}

	const FVector TraceStart = InRawWorldLocation + FVector(0.0, 0.0, TraceRayStartElevationOffsetCm);
	const FVector TraceEnd = InRawWorldLocation - FVector(0.0, 0.0, TraceRayDistanceCm);

	FHitResult HitResult;
	FCollisionQueryParams QueryParams;
	QueryParams.bTraceComplex = true;
	QueryParams.AddIgnoredActor(this);

	if (World->LineTraceSingleByChannel(HitResult, TraceStart, TraceEnd, TerrainTraceChannel, QueryParams))
	{
		// Snap precisely to the terrain collision impact point plus clearance offset
		OutDrapedWorldLocation = HitResult.ImpactPoint + FVector(0.0, 0.0, TerrainClearanceOffsetCm);
		return true;
	}

	// Fallback to initial location if terrain is not hit
	OutDrapedWorldLocation = InRawWorldLocation;
	return false;
}

bool ARoadSplineNetworkGenerator::GenerateRoadNetwork()
{
	ClearRoadNetwork();

	if (!IsValid(CesiumGeoreference))
	{
		UE_LOG(LogTrafficClearance, Error, TEXT("ARoadSplineNetworkGenerator::GenerateRoadNetwork: No valid CesiumGeoreference available!"));
		return false;
	}

	// Resolve file path (support project-relative paths)
	FString ResolvedPath = RoadGeoJSONPath;
	if (FPaths::IsRelative(ResolvedPath))
	{
		ResolvedPath = FPaths::Combine(FPaths::ProjectDir(), RoadGeoJSONPath);
	}

	TArray<FParsedRoadSegment> ParsedRoads;
	if (!UGeoJSONParser::ParseRoadsGeoJSON(ResolvedPath, true, ParsedRoads))
	{
		UE_LOG(LogTrafficClearance, Warning, TEXT("ARoadSplineNetworkGenerator: Could not parse roads from %s"), *ResolvedPath);
		return false;
	}

	RoadMetadata = ParsedRoads;
	RoadSplines.Reserve(ParsedRoads.Num());

	for (int32 RoadIdx = 0; RoadIdx < ParsedRoads.Num(); ++RoadIdx)
	{
		const FParsedRoadSegment& Road = ParsedRoads[RoadIdx];
		if (Road.WGS84Coordinates.Num() < 2)
		{
			continue;
		}

		// Create dynamic Spline Component attached to Root
		const FName SplineCompName = *FString::Printf(TEXT("RoadSpline_%s"), *Road.RoadId);
		USplineComponent* SplineComp = NewObject<USplineComponent>(this, USplineComponent::StaticClass(), SplineCompName);
		if (!SplineComp)
		{
			continue;
		}

		SplineComp->RegisterComponent();
		SplineComp->AttachToComponent(SceneRoot, FAttachmentTransformRules::KeepRelativeTransform);
		SplineComp->ClearSplinePoints(false);

		// Convert and drape all coordinate points
		for (int32 PtIdx = 0; PtIdx < Road.WGS84Coordinates.Num(); ++PtIdx)
		{
			const FVector& GeoPt = Road.WGS84Coordinates[PtIdx];

			FVector UnrealWorldLoc;
			UGeoCoordinateTransformer::WGS84ToUnreal(CesiumGeoreference, GeoPt.X, GeoPt.Y, GeoPt.Z, UnrealWorldLoc);

			if (bEnableTerrainDraping)
			{
				FVector DrapedLoc;
				DrapePointToTerrain(UnrealWorldLoc, DrapedLoc);
				UnrealWorldLoc = DrapedLoc;
			}

			// Add point to spline (World coordinate space)
			SplineComp->AddSplinePoint(UnrealWorldLoc, ESplineCoordinateSpace::World, false);
			SplineComp->SetSplinePointType(PtIdx, ESplinePointType::Linear, false);
		}

		SplineComp->UpdateSpline();

		RoadSplines.Add(SplineComp);
		RoadSplineMap.Add(Road.RoadId, SplineComp);
		if (Road.OsmId != 0)
		{
			RoadSplineMapByOsmId.Add(Road.OsmId, SplineComp);
		}
	}

	UE_LOG(LogTrafficClearance, Log, TEXT("ARoadSplineNetworkGenerator: Successfully generated %d road splines with terrain draping."), RoadSplines.Num());
	return RoadSplines.Num() > 0;
}

USplineComponent* ARoadSplineNetworkGenerator::GetSplineByOsmId(int64 OsmId) const
{
	const TObjectPtr<USplineComponent>* FoundSpline = RoadSplineMapByOsmId.Find(OsmId);
	return FoundSpline ? FoundSpline->Get() : nullptr;
}

bool ARoadSplineNetworkGenerator::FindNearestRoad(
	const FVector& QueryLocation,
	USplineComponent*& OutNearestSpline,
	FVector& OutClosestPointOnSpline,
	float& OutDistanceCm,
	FParsedRoadSegment& OutRoadMetadata) const
{
	OutNearestSpline = nullptr;
	OutClosestPointOnSpline = FVector::ZeroVector;
	OutDistanceCm = MAX_FLT;

	if (RoadSplines.Num() == 0)
	{
		return false;
	}

	float MinDistanceSq = MAX_FLT;
	int32 BestIndex = -1;
	FVector BestPoint = FVector::ZeroVector;

	for (int32 Idx = 0; Idx < RoadSplines.Num(); ++Idx)
	{
		const USplineComponent* Spline = RoadSplines[Idx];
		if (!IsValid(Spline))
		{
			continue;
		}

		// Find closest world point on continuous spline curve
		const FVector ClosestPoint = Spline->FindLocationClosestToWorldLocation(QueryLocation, ESplineCoordinateSpace::World);
		const float DistSq = FVector::DistSquared(QueryLocation, ClosestPoint);

		if (DistSq < MinDistanceSq)
		{
			MinDistanceSq = DistSq;
			BestIndex = Idx;
			BestPoint = ClosestPoint;
		}
	}

	if (BestIndex >= 0 && RoadSplines.IsValidIndex(BestIndex))
	{
		OutNearestSpline = RoadSplines[BestIndex];
		OutClosestPointOnSpline = BestPoint;
		OutDistanceCm = FMath::Sqrt(MinDistanceSq);
		if (RoadMetadata.IsValidIndex(BestIndex))
		{
			OutRoadMetadata = RoadMetadata[BestIndex];
		}
		return true;
	}

	return false;
}
