// Copyright (c) 2026 Bengaluru Digital Twin Initiative. All Rights Reserved.

#pragma once

#include "CoreMinimal.h"
#include "Kismet/BlueprintFunctionLibrary.h"
#include "CesiumGeoreference.h"
#include "GeoCoordinateTransformer.generated.h"

/**
 * High-performance spatial transformer converting between WGS84 Geographic Coordinates (Lon, Lat, Height)
 * and Unreal Engine 5.4 64-bit Large World Coordinates (LWC) local Cartesian centimeters.
 */
UCLASS(BlueprintType)
class TRAFFICCLEARANCE_API UGeoCoordinateTransformer : public UBlueprintFunctionLibrary
{
	GENERATED_BODY()

public:
	/**
	 * Converts a single WGS84 coordinate (Longitude, Latitude in degrees, Height in meters)
	 * to Unreal local Cartesian coordinates (Centimeters) relative to the provided CesiumGeoreference.
	 *
	 * @param Georeference The CesiumGeoreference actor anchoring the local UE origin.
	 * @param Longitude Longitude in decimal degrees (e.g., 77.5945627 for Bengaluru).
	 * @param Latitude Latitude in decimal degrees (e.g., 12.9715987 for Bengaluru).
	 * @param Altitude Altitude/Height in meters above the WGS84 ellipsoid.
	 * @param OutUnrealPosition Resulting UE local position (cm).
	 * @return True if conversion succeeded, False if Georeference is invalid.
	 */
	UFUNCTION(BlueprintCallable, Category = "TrafficClearance|GeoTransformation")
	static bool WGS84ToUnreal(
		const ACesiumGeoreference* Georeference,
		double Longitude,
		double Latitude,
		double Altitude,
		FVector& OutUnrealPosition);

	/**
	 * Converts an Unreal local Cartesian position (Centimeters) back to WGS84 coordinates.
	 *
	 * @param Georeference The CesiumGeoreference actor anchoring the local UE origin.
	 * @param UnrealPosition Unreal local position (cm).
	 * @param OutLongitude Resulting Longitude in decimal degrees.
	 * @param OutLatitude Resulting Latitude in decimal degrees.
	 * @param OutAltitude Resulting Altitude in meters above WGS84 ellipsoid.
	 * @return True if conversion succeeded, False if Georeference is invalid.
	 */
	UFUNCTION(BlueprintCallable, Category = "TrafficClearance|GeoTransformation")
	static bool UnrealToWGS84(
		const ACesiumGeoreference* Georeference,
		const FVector& UnrealPosition,
		double& OutLongitude,
		double& OutLatitude,
		double& OutAltitude);

	/**
	 * Batch converts an array of WGS84 coordinates into an array of UE local vectors (cm).
	 * Optimized for high-throughput road coordinate ingestion.
	 *
	 * @param Georeference The CesiumGeoreference actor anchoring the local UE origin.
	 * @param InWGS84Coordinates Array of coordinates where X=Longitude, Y=Latitude, Z=Altitude.
	 * @param OutUnrealPositions Destination array receiving Unreal local positions.
	 * @return Number of points successfully converted.
	 */
	UFUNCTION(BlueprintCallable, Category = "TrafficClearance|GeoTransformation")
	static int32 BatchWGS84ToUnreal(
		const ACesiumGeoreference* Georeference,
		const TArray<FVector>& InWGS84Coordinates,
		TArray<FVector>& OutUnrealPositions);

	/**
	 * Batch converts an array of UE local vectors (cm) back to WGS84 coordinates (X=Lon, Y=Lat, Z=Alt).
	 *
	 * @param Georeference The CesiumGeoreference actor anchoring the local UE origin.
	 * @param InUnrealPositions Array of Unreal local positions (cm).
	 * @param OutWGS84Coordinates Destination array receiving WGS84 coordinates (X=Lon, Y=Lat, Z=Alt).
	 * @return Number of points successfully converted.
	 */
	UFUNCTION(BlueprintCallable, Category = "TrafficClearance|GeoTransformation")
	static int32 BatchUnrealToWGS84(
		const ACesiumGeoreference* Georeference,
		const TArray<FVector>& InUnrealPositions,
		TArray<FVector>& OutWGS84Coordinates);
};
