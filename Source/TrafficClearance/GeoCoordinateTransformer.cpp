// Copyright (c) 2026 Bengaluru Digital Twin Initiative. All Rights Reserved.

#include "GeoCoordinateTransformer.h"
#include "TrafficClearance.h"

bool UGeoCoordinateTransformer::WGS84ToUnreal(
	const ACesiumGeoreference* Georeference,
	double Longitude,
	double Latitude,
	double Altitude,
	FVector& OutUnrealPosition)
{
	if (!IsValid(Georeference))
	{
		UE_LOG(LogTrafficClearance, Warning, TEXT("UGeoCoordinateTransformer::WGS84ToUnreal: Provided CesiumGeoreference is invalid!"));
		OutUnrealPosition = FVector::ZeroVector;
		return false;
	}

	// CesiumForUnreal provides TransformLongitudeLatitudeHeightPositionToUnreal taking (Lon, Lat, Height) in degrees and meters
	// returning local Unreal coordinates (Centimeters) as FVector (double-precision in UE5 LWC)
	const FVector TargetPositionWGS84(Longitude, Latitude, Altitude);
	OutUnrealPosition = Georeference->TransformLongitudeLatitudeHeightPositionToUnreal(TargetPositionWGS84);
	return true;
}

bool UGeoCoordinateTransformer::UnrealToWGS84(
	const ACesiumGeoreference* Georeference,
	const FVector& UnrealPosition,
	double& OutLongitude,
	double& OutLatitude,
	double& OutAltitude)
{
	if (!IsValid(Georeference))
	{
		UE_LOG(LogTrafficClearance, Warning, TEXT("UGeoCoordinateTransformer::UnrealToWGS84: Provided CesiumGeoreference is invalid!"));
		OutLongitude = 0.0;
		OutLatitude = 0.0;
		OutAltitude = 0.0;
		return false;
	}

	// Converts Unreal local Cartesian (cm) back to (Lon, Lat, Height)
	const FVector GeoCoord = Georeference->TransformUnrealPositionToLongitudeLatitudeHeight(UnrealPosition);
	OutLongitude = GeoCoord.X;
	OutLatitude = GeoCoord.Y;
	OutAltitude = GeoCoord.Z;
	return true;
}

int32 UGeoCoordinateTransformer::BatchWGS84ToUnreal(
	const ACesiumGeoreference* Georeference,
	const TArray<FVector>& InWGS84Coordinates,
	TArray<FVector>& OutUnrealPositions)
{
	OutUnrealPositions.Reset();

	if (!IsValid(Georeference))
	{
		UE_LOG(LogTrafficClearance, Error, TEXT("UGeoCoordinateTransformer::BatchWGS84ToUnreal: Provided CesiumGeoreference is invalid!"));
		return 0;
	}

	const int32 NumPoints = InWGS84Coordinates.Num();
	if (NumPoints == 0)
	{
		return 0;
	}

	OutUnrealPositions.Reserve(NumPoints);

	for (int32 Index = 0; Index < NumPoints; ++Index)
	{
		const FVector& Point = InWGS84Coordinates[Index];
		const FVector Converted = Georeference->TransformLongitudeLatitudeHeightPositionToUnreal(Point);
		OutUnrealPositions.Add(Converted);
	}

	return OutUnrealPositions.Num();
}

int32 UGeoCoordinateTransformer::BatchUnrealToWGS84(
	const ACesiumGeoreference* Georeference,
	const TArray<FVector>& InUnrealPositions,
	TArray<FVector>& OutWGS84Coordinates)
{
	OutWGS84Coordinates.Reset();

	if (!IsValid(Georeference))
	{
		UE_LOG(LogTrafficClearance, Error, TEXT("UGeoCoordinateTransformer::BatchUnrealToWGS84: Provided CesiumGeoreference is invalid!"));
		return 0;
	}

	const int32 NumPoints = InUnrealPositions.Num();
	if (NumPoints == 0)
	{
		return 0;
	}

	OutWGS84Coordinates.Reserve(NumPoints);

	for (int32 Index = 0; Index < NumPoints; ++Index)
	{
		const FVector& Point = InUnrealPositions[Index];
		const FVector GeoCoord = Georeference->TransformUnrealPositionToLongitudeLatitudeHeight(Point);
		OutWGS84Coordinates.Add(GeoCoord);
	}

	return OutWGS84Coordinates.Num();
}
