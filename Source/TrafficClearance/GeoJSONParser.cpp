// Copyright (c) 2026 Bengaluru Digital Twin Initiative. All Rights Reserved.

#include "GeoJSONParser.h"
#include "TrafficClearance.h"
#include "Misc/FileHelper.h"
#include "Misc/Paths.h"
#include "Serialization/JsonReader.h"
#include "Serialization/JsonSerializer.h"

bool UGeoJSONParser::LoadJsonString(const FString& Input, bool bIsFilePath, FString& OutJsonString)
{
	if (bIsFilePath)
	{
		FString NormalizedPath = FPaths::ConvertRelativePathToFull(Input);
		if (!FFileHelper::LoadFileToString(OutJsonString, *NormalizedPath))
		{
			UE_LOG(LogTrafficClearance, Error, TEXT("UGeoJSONParser: Failed to load file from disk: %s"), *NormalizedPath);
			return false;
		}
		return true;
	}

	OutJsonString = Input;
	return !OutJsonString.IsEmpty();
}

TSharedPtr<FJsonObject> UGeoJSONParser::DeserializeRootObject(const FString& JsonContent)
{
	TSharedPtr<FJsonObject> RootObject;
	TSharedRef<TJsonReader<>> Reader = TJsonReaderFactory<>::Create(JsonContent);

	if (!FJsonSerializer::Deserialize(Reader, RootObject) || !RootObject.IsValid())
	{
		UE_LOG(LogTrafficClearance, Error, TEXT("UGeoJSONParser: JSON deserialization failed or root is not an object."));
		return nullptr;
	}

	return RootObject;
}

bool UGeoJSONParser::ExtractPointCoordinate(const TArray<TSharedPtr<FJsonValue>>& CoordArray, FVector& OutCoord)
{
	// GeoJSON coordinate order: [Longitude, Latitude, optional Altitude]
	if (CoordArray.Num() < 2)
	{
		return false;
	}

	const double Lon = CoordArray[0]->AsNumber();
	const double Lat = CoordArray[1]->AsNumber();
	const double Alt = (CoordArray.Num() >= 3) ? CoordArray[2]->AsNumber() : 920.0; // Default Bengaluru mean elevation MSL (meters)

	OutCoord = FVector(Lon, Lat, Alt);
	return true;
}

bool UGeoJSONParser::ExtractLineStringCoordinates(const TArray<TSharedPtr<FJsonValue>>& CoordArray, TArray<FVector>& OutCoords)
{
	OutCoords.Reset();
	OutCoords.Reserve(CoordArray.Num());

	for (const TSharedPtr<FJsonValue>& PointVal : CoordArray)
	{
		const TArray<TSharedPtr<FJsonValue>>* PtCoords = nullptr;
		if (PointVal->TryGetArray(PtCoords) && PtCoords)
		{
			FVector Coord;
			if (ExtractPointCoordinate(*PtCoords, Coord))
			{
				OutCoords.Add(Coord);
			}
		}
	}

	return OutCoords.Num() >= 2;
}

bool UGeoJSONParser::ParseRoadsGeoJSON(
	const FString& FilePathOrJsonContent,
	bool bIsFilePath,
	TArray<FParsedRoadSegment>& OutRoads)
{
	OutRoads.Reset();

	FString JsonContent;
	if (!LoadJsonString(FilePathOrJsonContent, bIsFilePath, JsonContent))
	{
		return false;
	}

	TSharedPtr<FJsonObject> RootObject = DeserializeRootObject(JsonContent);
	if (!RootObject.IsValid())
	{
		return false;
	}

	const TArray<TSharedPtr<FJsonValue>>* FeaturesArray = nullptr;
	if (!RootObject->TryGetArrayField(TEXT("features"), FeaturesArray) || !FeaturesArray)
	{
		UE_LOG(LogTrafficClearance, Error, TEXT("UGeoJSONParser::ParseRoadsGeoJSON: Missing 'features' array in GeoJSON root."));
		return false;
	}

	OutRoads.Reserve(FeaturesArray->Num());

	for (int32 FeatureIdx = 0; FeatureIdx < FeaturesArray->Num(); ++FeatureIdx)
	{
		const TSharedPtr<FJsonObject> FeatureObj = (*FeaturesArray)[FeatureIdx]->AsObject();
		if (!FeatureObj.IsValid())
		{
			continue;
		}

		const TSharedPtr<FJsonObject>* GeometryObj = nullptr;
		if (!FeatureObj->TryGetObjectField(TEXT("geometry"), GeometryObj) || !GeometryObj || !GeometryObj->IsValid())
		{
			continue;
		}

		FString GeomType;
		if (!(*GeometryObj)->TryGetStringField(TEXT("type"), GeomType))
		{
			continue;
		}

		// Properties extraction
		const TSharedPtr<FJsonObject>* PropertiesObj = nullptr;
		FeatureObj->TryGetObjectField(TEXT("properties"), PropertiesObj);

		FParsedRoadSegment RoadBase;
		RoadBase.RoadId = FString::Printf(TEXT("Road_%04d"), FeatureIdx);
		RoadBase.RoadName = TEXT("Unnamed Road");
		RoadBase.HighwayType = TEXT("primary");
		RoadBase.Lanes = 2;
		RoadBase.SpeedLimitKmh = 50.0f;
		RoadBase.bIsOneWay = false;
		RoadBase.bIsEmergencyCorridor = false;

		if (PropertiesObj && PropertiesObj->IsValid())
		{
			const TSharedPtr<FJsonObject>& Props = *PropertiesObj;

			FString IdStr;
			if (Props->TryGetStringField(TEXT("id"), IdStr) || Props->TryGetStringField(TEXT("road_id"), IdStr) || Props->TryGetStringField(TEXT("osm_id"), IdStr))
			{
				RoadBase.RoadId = IdStr;
			}

			int64 OsmIdVal = 0;
			if (Props->TryGetNumberField(TEXT("osm_id"), OsmIdVal))
			{
				RoadBase.OsmId = OsmIdVal;
			}
			else if (!IdStr.IsEmpty())
			{
				if (IdStr.IsNumeric())
				{
					RoadBase.OsmId = FCString::Atoi64(*IdStr);
				}
				else
				{
					// If id has a non-numeric prefix like 'way_12345' or 'way_seshadri_01', extract digits or hash
					FString DigitsOnly;
					for (TCHAR Ch : IdStr)
					{
						if (FChar::IsDigit(Ch))
						{
							DigitsOnly.AppendChar(Ch);
						}
					}
					if (!DigitsOnly.IsEmpty())
					{
						RoadBase.OsmId = FCString::Atoi64(*DigitsOnly);
					}
					else
					{
						RoadBase.OsmId = static_cast<int64>(GetTypeHash(IdStr));
					}
				}
			}

			FString NameStr;
			if (Props->TryGetStringField(TEXT("name"), NameStr) || Props->TryGetStringField(TEXT("road_name"), NameStr))
			{
				RoadBase.RoadName = NameStr;
			}

			FString HwType;
			if (Props->TryGetStringField(TEXT("highway"), HwType) || Props->TryGetStringField(TEXT("type"), HwType))
			{
				RoadBase.HighwayType = HwType;
			}

			int32 LanesVal = 2;
			if (Props->TryGetNumberField(TEXT("lanes"), LanesVal))
			{
				RoadBase.Lanes = LanesVal;
			}

			double SpeedVal = 50.0;
			if (Props->TryGetNumberField(TEXT("maxspeed"), SpeedVal) || Props->TryGetNumberField(TEXT("speed_limit"), SpeedVal))
			{
				RoadBase.SpeedLimitKmh = static_cast<float>(SpeedVal);
			}

			bool bOneWayVal = false;
			if (Props->TryGetBoolField(TEXT("oneway"), bOneWayVal))
			{
				RoadBase.bIsOneWay = bOneWayVal;
			}

			bool bCorridorVal = false;
			if (Props->TryGetBoolField(TEXT("is_emergency_corridor"), bCorridorVal) || Props->TryGetBoolField(TEXT("green_corridor"), bCorridorVal))
			{
				RoadBase.bIsEmergencyCorridor = bCorridorVal;
			}
		}

		// Coordinate extraction for LineString or MultiLineString
		const TArray<TSharedPtr<FJsonValue>>* CoordinatesArray = nullptr;
		if (!(*GeometryObj)->TryGetArrayField(TEXT("coordinates"), CoordinatesArray) || !CoordinatesArray)
		{
			continue;
		}

		if (GeomType.Equals(TEXT("LineString"), ESearchCase::IgnoreCase))
		{
			FParsedRoadSegment Road = RoadBase;
			if (ExtractLineStringCoordinates(*CoordinatesArray, Road.WGS84Coordinates))
			{
				OutRoads.Add(Road);
			}
		}
		else if (GeomType.Equals(TEXT("MultiLineString"), ESearchCase::IgnoreCase))
		{
			// Each item in coordinates is a LineString array
			for (int32 PartIdx = 0; PartIdx < CoordinatesArray->Num(); ++PartIdx)
			{
				const TArray<TSharedPtr<FJsonValue>>* LineCoords = nullptr;
				if ((*CoordinatesArray)[PartIdx]->TryGetArray(LineCoords) && LineCoords)
				{
					FParsedRoadSegment Road = RoadBase;
					Road.RoadId = FString::Printf(TEXT("%s_part%d"), *RoadBase.RoadId, PartIdx);
					if (ExtractLineStringCoordinates(*LineCoords, Road.WGS84Coordinates))
					{
						OutRoads.Add(Road);
					}
				}
			}
		}
	}

	UE_LOG(LogTrafficClearance, Log, TEXT("UGeoJSONParser::ParseRoadsGeoJSON: Successfully parsed %d road segments."), OutRoads.Num());
	return OutRoads.Num() > 0;
}

bool UGeoJSONParser::ParseHospitalsGeoJSON(
	const FString& FilePathOrJsonContent,
	bool bIsFilePath,
	TArray<FParsedHospital>& OutHospitals)
{
	OutHospitals.Reset();

	FString JsonContent;
	if (!LoadJsonString(FilePathOrJsonContent, bIsFilePath, JsonContent))
	{
		return false;
	}

	TSharedPtr<FJsonObject> RootObject = DeserializeRootObject(JsonContent);
	if (!RootObject.IsValid())
	{
		return false;
	}

	const TArray<TSharedPtr<FJsonValue>>* FeaturesArray = nullptr;
	if (!RootObject->TryGetArrayField(TEXT("features"), FeaturesArray) || !FeaturesArray)
	{
		UE_LOG(LogTrafficClearance, Error, TEXT("UGeoJSONParser::ParseHospitalsGeoJSON: Missing 'features' array."));
		return false;
	}

	OutHospitals.Reserve(FeaturesArray->Num());

	for (int32 FeatureIdx = 0; FeatureIdx < FeaturesArray->Num(); ++FeatureIdx)
	{
		const TSharedPtr<FJsonObject> FeatureObj = (*FeaturesArray)[FeatureIdx]->AsObject();
		if (!FeatureObj.IsValid())
		{
			continue;
		}

		const TSharedPtr<FJsonObject>* GeometryObj = nullptr;
		if (!FeatureObj->TryGetObjectField(TEXT("geometry"), GeometryObj) || !GeometryObj || !GeometryObj->IsValid())
		{
			continue;
		}

		FString GeomType;
		if (!(*GeometryObj)->TryGetStringField(TEXT("type"), GeomType) || !GeomType.Equals(TEXT("Point"), ESearchCase::IgnoreCase))
		{
			continue;
		}

		const TArray<TSharedPtr<FJsonValue>>* CoordsArray = nullptr;
		if (!(*GeometryObj)->TryGetArrayField(TEXT("coordinates"), CoordsArray) || !CoordsArray)
		{
			continue;
		}

		FVector PointLoc;
		if (!ExtractPointCoordinate(*CoordsArray, PointLoc))
		{
			continue;
		}

		FParsedHospital Hospital;
		Hospital.HospitalId = FString::Printf(TEXT("Hospital_%03d"), FeatureIdx);
		Hospital.HospitalName = TEXT("Unknown Hospital");
		Hospital.EmergencyTier = TEXT("Tier-1 Level Trauma");
		Hospital.EmergencyBeds = 20;
		Hospital.bHasTraumaCenter = true;
		Hospital.ContactNumber = TEXT("108 / 112");
		Hospital.WGS84Location = PointLoc;

		const TSharedPtr<FJsonObject>* PropertiesObj = nullptr;
		if (FeatureObj->TryGetObjectField(TEXT("properties"), PropertiesObj) && PropertiesObj && PropertiesObj->IsValid())
		{
			const TSharedPtr<FJsonObject>& Props = *PropertiesObj;

			FString IdStr;
			if (Props->TryGetStringField(TEXT("id"), IdStr) || Props->TryGetStringField(TEXT("hospital_id"), IdStr))
			{
				Hospital.HospitalId = IdStr;
			}

			FString NameStr;
			if (Props->TryGetStringField(TEXT("name"), NameStr) || Props->TryGetStringField(TEXT("hospital_name"), NameStr))
			{
				Hospital.HospitalName = NameStr;
			}

			FString TierStr;
			if (Props->TryGetStringField(TEXT("emergency_tier"), TierStr) || Props->TryGetStringField(TEXT("tier"), TierStr))
			{
				Hospital.EmergencyTier = TierStr;
			}

			int32 BedsVal = 0;
			if (Props->TryGetNumberField(TEXT("emergency_beds"), BedsVal) || Props->TryGetNumberField(TEXT("capacity"), BedsVal))
			{
				Hospital.EmergencyBeds = BedsVal;
			}

			bool bTrauma = true;
			if (Props->TryGetBoolField(TEXT("trauma_center"), bTrauma) || Props->TryGetBoolField(TEXT("has_trauma_center"), bTrauma))
			{
				Hospital.bHasTraumaCenter = bTrauma;
			}

			FString ContactStr;
			if (Props->TryGetStringField(TEXT("contact"), ContactStr) || Props->TryGetStringField(TEXT("phone"), ContactStr))
			{
				Hospital.ContactNumber = ContactStr;
			}
		}

		OutHospitals.Add(Hospital);
	}

	UE_LOG(LogTrafficClearance, Log, TEXT("UGeoJSONParser::ParseHospitalsGeoJSON: Successfully parsed %d hospitals."), OutHospitals.Num());
	return OutHospitals.Num() > 0;
}

bool UGeoJSONParser::ParseTrafficSignalsGeoJSON(
	const FString& FilePathOrJsonContent,
	bool bIsFilePath,
	TArray<FParsedTrafficSignal>& OutSignals)
{
	OutSignals.Reset();

	FString JsonContent;
	if (!LoadJsonString(FilePathOrJsonContent, bIsFilePath, JsonContent))
	{
		return false;
	}

	TSharedPtr<FJsonObject> RootObject = DeserializeRootObject(JsonContent);
	if (!RootObject.IsValid())
	{
		return false;
	}

	const TArray<TSharedPtr<FJsonValue>>* FeaturesArray = nullptr;
	if (!RootObject->TryGetArrayField(TEXT("features"), FeaturesArray) || !FeaturesArray)
	{
		UE_LOG(LogTrafficClearance, Error, TEXT("UGeoJSONParser::ParseTrafficSignalsGeoJSON: Missing 'features' array."));
		return false;
	}

	OutSignals.Reserve(FeaturesArray->Num());

	for (int32 FeatureIdx = 0; FeatureIdx < FeaturesArray->Num(); ++FeatureIdx)
	{
		const TSharedPtr<FJsonObject> FeatureObj = (*FeaturesArray)[FeatureIdx]->AsObject();
		if (!FeatureObj.IsValid())
		{
			continue;
		}

		const TSharedPtr<FJsonObject>* GeometryObj = nullptr;
		if (!FeatureObj->TryGetObjectField(TEXT("geometry"), GeometryObj) || !GeometryObj || !GeometryObj->IsValid())
		{
			continue;
		}

		FString GeomType;
		if (!(*GeometryObj)->TryGetStringField(TEXT("type"), GeomType) || !GeomType.Equals(TEXT("Point"), ESearchCase::IgnoreCase))
		{
			continue;
		}

		const TArray<TSharedPtr<FJsonValue>>* CoordsArray = nullptr;
		if (!(*GeometryObj)->TryGetArrayField(TEXT("coordinates"), CoordsArray) || !CoordsArray)
		{
			continue;
		}

		FVector PointLoc;
		if (!ExtractPointCoordinate(*CoordsArray, PointLoc))
		{
			continue;
		}

		FParsedTrafficSignal Signal;
		Signal.JunctionId = FString::Printf(TEXT("Junction_%03d"), FeatureIdx);
		Signal.JunctionName = TEXT("Junction");
		Signal.ControlType = TEXT("Adaptive SCATS/ITMS");
		Signal.CycleTimeSeconds = 90;
		Signal.bCorridorPriorityCapable = true;
		Signal.WGS84Location = PointLoc;

		const TSharedPtr<FJsonObject>* PropertiesObj = nullptr;
		if (FeatureObj->TryGetObjectField(TEXT("properties"), PropertiesObj) && PropertiesObj && PropertiesObj->IsValid())
		{
			const TSharedPtr<FJsonObject>& Props = *PropertiesObj;

			FString IdStr;
			if (Props->TryGetStringField(TEXT("id"), IdStr) || Props->TryGetStringField(TEXT("junction_id"), IdStr) || Props->TryGetStringField(TEXT("signal_id"), IdStr))
			{
				Signal.JunctionId = IdStr;
			}

			int64 OsmIdVal = 0;
			if (Props->TryGetNumberField(TEXT("osm_id"), OsmIdVal) || Props->TryGetNumberField(TEXT("id"), OsmIdVal))
			{
				Signal.OsmId = OsmIdVal;
			}
			else if (!IdStr.IsEmpty())
			{
				if (IdStr.IsNumeric())
				{
					Signal.OsmId = FCString::Atoi64(*IdStr);
				}
				else
				{
					FString DigitsOnly;
					for (TCHAR Ch : IdStr)
					{
						if (FChar::IsDigit(Ch))
						{
							DigitsOnly.AppendChar(Ch);
						}
					}
					if (!DigitsOnly.IsEmpty())
					{
						Signal.OsmId = FCString::Atoi64(*DigitsOnly);
					}
					else
					{
						Signal.OsmId = static_cast<int64>(GetTypeHash(IdStr));
					}
				}
			}

			FString NameStr;
			if (Props->TryGetStringField(TEXT("name"), NameStr) || Props->TryGetStringField(TEXT("junction_name"), NameStr))
			{
				Signal.JunctionName = NameStr;
			}

			FString ControlStr;
			if (Props->TryGetStringField(TEXT("control_type"), ControlStr) || Props->TryGetStringField(TEXT("system"), ControlStr))
			{
				Signal.ControlType = ControlStr;
			}

			int32 CycleVal = 90;
			if (Props->TryGetNumberField(TEXT("cycle_time"), CycleVal) || Props->TryGetNumberField(TEXT("cycle_seconds"), CycleVal))
			{
				Signal.CycleTimeSeconds = CycleVal;
			}

			bool bPriorityCap = true;
			if (Props->TryGetBoolField(TEXT("priority_capable"), bPriorityCap) || Props->TryGetBoolField(TEXT("corridor_priority"), bPriorityCap))
			{
				Signal.bCorridorPriorityCapable = bPriorityCap;
			}
		}

		OutSignals.Add(Signal);
	}

	UE_LOG(LogTrafficClearance, Log, TEXT("UGeoJSONParser::ParseTrafficSignalsGeoJSON: Successfully parsed %d signals."), OutSignals.Num());
	return OutSignals.Num() > 0;
}
