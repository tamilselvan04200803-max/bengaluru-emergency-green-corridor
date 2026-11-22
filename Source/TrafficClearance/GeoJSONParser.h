// Copyright (c) 2026 Bengaluru Digital Twin Initiative. All Rights Reserved.

#pragma once

#include "CoreMinimal.h"
#include "Kismet/BlueprintFunctionLibrary.h"
#include "GeoJSONParser.generated.h"

/**
 * Parsed road segment geometry and attribute data from OpenStreetMap / GIS GeoJSON.
 */
USTRUCT(BlueprintType)
struct TRAFFICCLEARANCE_API FParsedRoadSegment
{
	GENERATED_BODY()

	UPROPERTY(EditAnywhere, BlueprintReadWrite, Category = "TrafficClearance|GeoJSON")
	FString RoadId;

	UPROPERTY(EditAnywhere, BlueprintReadWrite, Category = "TrafficClearance|GeoJSON")
	int64 OsmId = 0;

	UPROPERTY(EditAnywhere, BlueprintReadWrite, Category = "TrafficClearance|GeoJSON")
	FString RoadName;

	UPROPERTY(EditAnywhere, BlueprintReadWrite, Category = "TrafficClearance|GeoJSON")
	FString HighwayType;

	UPROPERTY(EditAnywhere, BlueprintReadWrite, Category = "TrafficClearance|GeoJSON")
	int32 Lanes = 2;

	UPROPERTY(EditAnywhere, BlueprintReadWrite, Category = "TrafficClearance|GeoJSON")
	float SpeedLimitKmh = 50.0f;

	UPROPERTY(EditAnywhere, BlueprintReadWrite, Category = "TrafficClearance|GeoJSON")
	bool bIsOneWay = false;

	UPROPERTY(EditAnywhere, BlueprintReadWrite, Category = "TrafficClearance|GeoJSON")
	bool bIsEmergencyCorridor = false;

	/** Ordered polyline coordinates where X = Longitude, Y = Latitude, Z = Altitude (meters) */
	UPROPERTY(EditAnywhere, BlueprintReadWrite, Category = "TrafficClearance|GeoJSON")
	TArray<FVector> WGS84Coordinates;
};

/**
 * Parsed emergency hospital Point of Interest (POI) data.
 */
USTRUCT(BlueprintType)
struct TRAFFICCLEARANCE_API FParsedHospital
{
	GENERATED_BODY()

	UPROPERTY(EditAnywhere, BlueprintReadWrite, Category = "TrafficClearance|GeoJSON")
	FString HospitalId;

	UPROPERTY(EditAnywhere, BlueprintReadWrite, Category = "TrafficClearance|GeoJSON")
	FString HospitalName;

	UPROPERTY(EditAnywhere, BlueprintReadWrite, Category = "TrafficClearance|GeoJSON")
	FString EmergencyTier;

	UPROPERTY(EditAnywhere, BlueprintReadWrite, Category = "TrafficClearance|GeoJSON")
	int32 EmergencyBeds = 0;

	UPROPERTY(EditAnywhere, BlueprintReadWrite, Category = "TrafficClearance|GeoJSON")
	bool bHasTraumaCenter = true;

	UPROPERTY(EditAnywhere, BlueprintReadWrite, Category = "TrafficClearance|GeoJSON")
	FString ContactNumber;

	/** Location where X = Longitude, Y = Latitude, Z = Altitude (meters) */
	UPROPERTY(EditAnywhere, BlueprintReadWrite, Category = "TrafficClearance|GeoJSON")
	FVector WGS84Location = FVector::ZeroVector;
};

/**
 * Parsed traffic signal intersection node data.
 */
USTRUCT(BlueprintType)
struct TRAFFICCLEARANCE_API FParsedTrafficSignal
{
	GENERATED_BODY()

	UPROPERTY(EditAnywhere, BlueprintReadWrite, Category = "TrafficClearance|GeoJSON")
	FString JunctionId;

	UPROPERTY(EditAnywhere, BlueprintReadWrite, Category = "TrafficClearance|GeoJSON")
	int64 OsmId = 0;

	UPROPERTY(EditAnywhere, BlueprintReadWrite, Category = "TrafficClearance|GeoJSON")
	FString JunctionName;

	UPROPERTY(EditAnywhere, BlueprintReadWrite, Category = "TrafficClearance|GeoJSON")
	FString ControlType;

	UPROPERTY(EditAnywhere, BlueprintReadWrite, Category = "TrafficClearance|GeoJSON")
	int32 CycleTimeSeconds = 90;

	UPROPERTY(EditAnywhere, BlueprintReadWrite, Category = "TrafficClearance|GeoJSON")
	bool bCorridorPriorityCapable = true;

	/** Location where X = Longitude, Y = Latitude, Z = Altitude (meters) */
	UPROPERTY(EditAnywhere, BlueprintReadWrite, Category = "TrafficClearance|GeoJSON")
	FVector WGS84Location = FVector::ZeroVector;
};

/**
 * High-performance, robust parser for Bengaluru GIS GeoJSON datasets.
 * Supports FeatureCollection structures containing LineString, MultiLineString, and Point features.
 */
UCLASS(BlueprintType)
class TRAFFICCLEARANCE_API UGeoJSONParser : public UBlueprintFunctionLibrary
{
	GENERATED_BODY()

public:
	/**
	 * Parses a road network GeoJSON file or string into an array of FParsedRoadSegment structs.
	 *
	 * @param FilePathOrJsonContent Absolute file path or raw GeoJSON string.
	 * @param bIsFilePath True if the input parameter is a file path on disk.
	 * @param OutRoads Resulting array of parsed road segments.
	 * @return True if parsing succeeded and at least one road feature was extracted.
	 */
	UFUNCTION(BlueprintCallable, Category = "TrafficClearance|GeoJSON")
	static bool ParseRoadsGeoJSON(
		const FString& FilePathOrJsonContent,
		bool bIsFilePath,
		TArray<FParsedRoadSegment>& OutRoads);

	/**
	 * Parses a hospital POI GeoJSON file or string into an array of FParsedHospital structs.
	 *
	 * @param FilePathOrJsonContent Absolute file path or raw GeoJSON string.
	 * @param bIsFilePath True if the input parameter is a file path on disk.
	 * @param OutHospitals Resulting array of parsed hospital POIs.
	 * @return True if parsing succeeded and at least one hospital feature was extracted.
	 */
	UFUNCTION(BlueprintCallable, Category = "TrafficClearance|GeoJSON")
	static bool ParseHospitalsGeoJSON(
		const FString& FilePathOrJsonContent,
		bool bIsFilePath,
		TArray<FParsedHospital>& OutHospitals);

	/**
	 * Parses a traffic signal junction GeoJSON file or string into an array of FParsedTrafficSignal structs.
	 *
	 * @param FilePathOrJsonContent Absolute file path or raw GeoJSON string.
	 * @param bIsFilePath True if the input parameter is a file path on disk.
	 * @param OutSignals Resulting array of parsed traffic signals.
	 * @return True if parsing succeeded and at least one signal feature was extracted.
	 */
	UFUNCTION(BlueprintCallable, Category = "TrafficClearance|GeoJSON")
	static bool ParseTrafficSignalsGeoJSON(
		const FString& FilePathOrJsonContent,
		bool bIsFilePath,
		TArray<FParsedTrafficSignal>& OutSignals);

private:
	static bool LoadJsonString(const FString& Input, bool bIsFilePath, FString& OutJsonString);
	static TSharedPtr<FJsonObject> DeserializeRootObject(const FString& JsonContent);
	static bool ExtractPointCoordinate(const TArray<TSharedPtr<FJsonValue>>& CoordArray, FVector& OutCoord);
	static bool ExtractLineStringCoordinates(const TArray<TSharedPtr<FJsonValue>>& CoordArray, TArray<FVector>& OutCoords);
};
