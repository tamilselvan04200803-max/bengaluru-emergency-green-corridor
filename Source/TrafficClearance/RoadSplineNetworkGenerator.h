// Copyright (c) 2026 Bengaluru Digital Twin Initiative. All Rights Reserved.

#pragma once

#include "CoreMinimal.h"
#include "GameFramework/Actor.h"
#include "Components/SplineComponent.h"
#include "CesiumGeoreference.h"
#include "GeoJSONParser.h"
#include "RoadSplineNetworkGenerator.generated.h"

/**
 * Procedural Road Spline Network Generator.
 * Converts GIS GeoJSON road segments into continuous 3D Unreal Spline Components.
 * Incorporates Runtime Terrain Draping: traces line rays against Cesium World Terrain collision
 * to accurately conform road surfaces to Bengaluru elevation profile with configurable vertical clearance.
 */
UCLASS(BlueprintType, Blueprintable)
class TRAFFICCLEARANCE_API ARoadSplineNetworkGenerator : public AActor
{
	GENERATED_BODY()

public:
	ARoadSplineNetworkGenerator();

	virtual void BeginPlay() override;

	/** Root scene component */
	UPROPERTY(VisibleAnywhere, BlueprintReadOnly, Category = "TrafficClearance|Components")
	USceneComponent* SceneRoot;

	/** CesiumGeoreference actor in the level for coordinate transformation */
	UPROPERTY(EditAnywhere, BlueprintReadWrite, Category = "TrafficClearance|Configuration")
	TObjectPtr<ACesiumGeoreference> CesiumGeoreference;

	/** File path to roads GeoJSON (relative to project or absolute) */
	UPROPERTY(EditAnywhere, BlueprintReadWrite, Category = "TrafficClearance|Configuration")
	FString RoadGeoJSONPath = TEXT("Data/GeoJSON/bengaluru_roads.geojson");

	/** If true, dynamically traces terrain collision to snap spline points to elevation */
	UPROPERTY(EditAnywhere, BlueprintReadWrite, Category = "TrafficClearance|TerrainDraping")
	bool bEnableTerrainDraping = true;

	/** Vertical offset added above detected terrain in centimeters (default: 15.0 cm road pavement surface) */
	UPROPERTY(EditAnywhere, BlueprintReadWrite, Category = "TrafficClearance|TerrainDraping")
	float TerrainClearanceOffsetCm = 15.0f;

	/** Collision trace channel to test terrain elevation (e.g. ECC_WorldStatic or ECC_Visibility) */
	UPROPERTY(EditAnywhere, BlueprintReadWrite, Category = "TrafficClearance|TerrainDraping")
	TEnumAsByte<ECollisionChannel> TerrainTraceChannel = ECC_WorldStatic;

	/** Downward trace ray distance in cm (1 km ray downwards) */
	UPROPERTY(EditAnywhere, BlueprintReadWrite, Category = "TrafficClearance|TerrainDraping")
	float TraceRayDistanceCm = 100000.0f;

	/** High altitude start above converted point for raycast (500m up) */
	UPROPERTY(EditAnywhere, BlueprintReadWrite, Category = "TrafficClearance|TerrainDraping")
	float TraceRayStartElevationOffsetCm = 50000.0f;

	/** Generated spline components representing road centerlines */
	UPROPERTY(VisibleAnywhere, BlueprintReadOnly, Category = "TrafficClearance|Network")
	TArray<TObjectPtr<USplineComponent>> RoadSplines;

	/** Mapping from RoadId to its respective Spline Component */
	UPROPERTY(VisibleAnywhere, BlueprintReadOnly, Category = "TrafficClearance|Network")
	TMap<FString, TObjectPtr<USplineComponent>> RoadSplineMap;

	/** Mapping from OpenStreetMap ID to its respective Spline Component */
	UPROPERTY(VisibleAnywhere, BlueprintReadOnly, Category = "TrafficClearance|Network")
	TMap<int64, TObjectPtr<USplineComponent>> RoadSplineMapByOsmId;

	/** Road segment attributes indexed alongside RoadSplines */
	UPROPERTY(VisibleAnywhere, BlueprintReadOnly, Category = "TrafficClearance|Network")
	TArray<FParsedRoadSegment> RoadMetadata;

	/**
	 * Retrieves the spline component representing a road by its OpenStreetMap ID.
	 *
	 * @param OsmId The OpenStreetMap way identifier.
	 * @return Pointer to USplineComponent, or nullptr if not found.
	 */
	UFUNCTION(BlueprintCallable, Category = "TrafficClearance|Network")
	USplineComponent* GetSplineByOsmId(int64 OsmId) const;

	/**
	 * Generates the complete road spline network from the configured GeoJSON path.
	 * Can be invoked from Blueprint or C++ at runtime or in editor.
	 */
	UFUNCTION(BlueprintCallable, Category = "TrafficClearance|Network")
	bool GenerateRoadNetwork();

	/**
	 * Clears all existing procedural road splines.
	 */
	UFUNCTION(BlueprintCallable, Category = "TrafficClearance|Network")
	void ClearRoadNetwork();

	/**
	 * Spatial query: finds the nearest road spline component and projection point to a given query location.
	 *
	 * @param QueryLocation World location to query (e.g., ambulance position or GPS pin).
	 * @param OutNearestSpline Pointer to the closest USplineComponent.
	 * @param OutClosestPointOnSpline Closest Cartesian world point on the spline curve.
	 * @param OutDistanceCm Distance in centimeters to the nearest road center.
	 * @param OutRoadMetadata Associated road segment attributes.
	 * @return True if a valid road was found within search criteria.
	 */
	UFUNCTION(BlueprintCallable, Category = "TrafficClearance|SpatialQuery")
	bool FindNearestRoad(
		const FVector& QueryLocation,
		USplineComponent*& OutNearestSpline,
		FVector& OutClosestPointOnSpline,
		float& OutDistanceCm,
		FParsedRoadSegment& OutRoadMetadata) const;

	/**
	 * Drapes a single world location onto terrain collision using raycast.
	 *
	 * @param InRawWorldLocation Input location before terrain adjustment.
	 * @param OutDrapedWorldLocation Adjusted location with TerrainClearanceOffsetCm.
	 * @return True if terrain hit was detected and applied.
	 */
	UFUNCTION(BlueprintCallable, Category = "TrafficClearance|TerrainDraping")
	bool DrapePointToTerrain(const FVector& InRawWorldLocation, FVector& OutDrapedWorldLocation) const;
};
