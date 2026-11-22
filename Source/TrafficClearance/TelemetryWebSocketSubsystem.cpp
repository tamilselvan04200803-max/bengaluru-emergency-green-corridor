// Copyright (c) 2026 Bengaluru Digital Twin Initiative. All Rights Reserved.

#include "TelemetryWebSocketSubsystem.h"
#include "TrafficClearance.h"
#include "WebSocketsModule.h"
#include "Modules/ModuleManager.h"
#include "Async/Async.h"
#include "Serialization/JsonReader.h"
#include "Serialization/JsonSerializer.h"
#include "Engine/GameInstance.h"
#include "TimerManager.h"

UTelemetryWebSocketSubsystem::UTelemetryWebSocketSubsystem()
	: ServerUrl(TEXT("ws://localhost:8765"))
	, InitialReconnectDelay(1.0f)
	, MaxReconnectDelay(16.0f)
	, CurrentReconnectDelay(1.0f)
	, bIntentionalDisconnect(false)
{
}

void UTelemetryWebSocketSubsystem::Initialize(FSubsystemCollectionBase& Collection)
{
	Super::Initialize(Collection);

	// Ensure WebSockets module is loaded
	if (!FModuleManager::Get().IsModuleLoaded(TEXT("WebSockets")))
	{
		FModuleManager::Get().LoadModule(TEXT("WebSockets"));
	}

	UE_LOG(LogTrafficClearance, Log, TEXT("UTelemetryWebSocketSubsystem initialized. Auto-connecting to %s"), *ServerUrl);
	bIntentionalDisconnect = false;
	CurrentReconnectDelay = InitialReconnectDelay;
	InternalConnect();
}

void UTelemetryWebSocketSubsystem::Deinitialize()
{
	Disconnect();
	Super::Deinitialize();
}

void UTelemetryWebSocketSubsystem::Connect(const FString& InServerUrl)
{
	if (!InServerUrl.IsEmpty())
	{
		ServerUrl = InServerUrl;
	}

	bIntentionalDisconnect = false;
	CurrentReconnectDelay = InitialReconnectDelay;

	if (UGameInstance* GI = GetGameInstance())
	{
		GI->GetTimerManager().ClearTimer(ReconnectTimerHandle);
	}

	InternalConnect();
}

void UTelemetryWebSocketSubsystem::Disconnect()
{
	bIntentionalDisconnect = true;

	if (UGameInstance* GI = GetGameInstance())
	{
		GI->GetTimerManager().ClearTimer(ReconnectTimerHandle);
	}

	if (WebSocket.IsValid())
	{
		if (WebSocket->IsConnected())
		{
			WebSocket->Close();
		}
		WebSocket.Reset();
	}

	UE_LOG(LogTrafficClearance, Log, TEXT("UTelemetryWebSocketSubsystem disconnected."));
}

bool UTelemetryWebSocketSubsystem::IsConnected() const
{
	return WebSocket.IsValid() && WebSocket->IsConnected();
}

void UTelemetryWebSocketSubsystem::InternalConnect()
{
	if (WebSocket.IsValid() && WebSocket->IsConnected())
	{
		return;
	}

	if (!FModuleManager::Get().IsModuleLoaded(TEXT("WebSockets")))
	{
		FModuleManager::Get().LoadModule(TEXT("WebSockets"));
	}

	FWebSocketsModule& WebSocketsModule = FWebSocketsModule::Get();
	WebSocket = WebSocketsModule.CreateWebSocket(ServerUrl, TEXT("ws"));

	if (!WebSocket.IsValid())
	{
		UE_LOG(LogTrafficClearance, Error, TEXT("UTelemetryWebSocketSubsystem: Failed to create WebSocket for URL: %s"), *ServerUrl);
		ScheduleReconnect();
		return;
	}

	TWeakObjectPtr<UTelemetryWebSocketSubsystem> WeakThis(this);

	WebSocket->OnConnected().AddLambda([WeakThis]()
	{
		if (WeakThis.IsValid())
		{
			WeakThis->HandleWebSocketConnected();
		}
	});

	WebSocket->OnConnectionError().AddLambda([WeakThis](const FString& Error)
	{
		if (WeakThis.IsValid())
		{
			WeakThis->HandleWebSocketConnectionError(Error);
		}
	});

	WebSocket->OnClosed().AddLambda([WeakThis](int32 StatusCode, const FString& Reason, bool bWasClean)
	{
		if (WeakThis.IsValid())
		{
			WeakThis->HandleWebSocketClosed(StatusCode, Reason, bWasClean);
		}
	});

	WebSocket->OnMessage().AddLambda([WeakThis](const FString& MessageString)
	{
		if (WeakThis.IsValid())
		{
			WeakThis->HandleWebSocketMessage(MessageString);
		}
	});

	UE_LOG(LogTrafficClearance, Log, TEXT("UTelemetryWebSocketSubsystem: Connecting to %s..."), *ServerUrl);
	WebSocket->Connect();
}

void UTelemetryWebSocketSubsystem::HandleWebSocketConnected()
{
	UE_LOG(LogTrafficClearance, Log, TEXT("UTelemetryWebSocketSubsystem: WebSocket connected successfully to %s"), *ServerUrl);
	CurrentReconnectDelay = InitialReconnectDelay;

	if (UGameInstance* GI = GetGameInstance())
	{
		GI->GetTimerManager().ClearTimer(ReconnectTimerHandle);
	}
}

void UTelemetryWebSocketSubsystem::HandleWebSocketConnectionError(const FString& Error)
{
	UE_LOG(LogTrafficClearance, Warning, TEXT("UTelemetryWebSocketSubsystem: WebSocket error [%s]: %s"), *ServerUrl, *Error);
	ScheduleReconnect();
}

void UTelemetryWebSocketSubsystem::HandleWebSocketClosed(int32 StatusCode, const FString& Reason, bool bWasClean)
{
	UE_LOG(LogTrafficClearance, Log, TEXT("UTelemetryWebSocketSubsystem: WebSocket closed (Code: %d, Reason: '%s', Clean: %s)"),
		StatusCode, *Reason, bWasClean ? TEXT("true") : TEXT("false"));

	if (!bIntentionalDisconnect)
	{
		ScheduleReconnect();
	}
}

void UTelemetryWebSocketSubsystem::ScheduleReconnect()
{
	if (bIntentionalDisconnect)
	{
		return;
	}

	UGameInstance* GI = GetGameInstance();
	if (!GI)
	{
		return;
	}

	// Avoid duplicate scheduling
	if (GI->GetTimerManager().IsTimerActive(ReconnectTimerHandle))
	{
		return;
	}

	const float Delay = CurrentReconnectDelay;
	UE_LOG(LogTrafficClearance, Log, TEXT("UTelemetryWebSocketSubsystem: Scheduling reconnect in %.2f seconds (Backoff)"), Delay);

	GI->GetTimerManager().SetTimer(
		ReconnectTimerHandle,
		FTimerDelegate::CreateUObject(this, &UTelemetryWebSocketSubsystem::InternalConnect),
		Delay,
		false
	);

	// Exponential backoff capped at MaxReconnectDelay (1.0s, 2.0s, 4.0s, 8.0s, 16.0s)
	CurrentReconnectDelay = FMath::Clamp(CurrentReconnectDelay * 2.0f, InitialReconnectDelay, MaxReconnectDelay);
}

void UTelemetryWebSocketSubsystem::HandleWebSocketMessage(const FString& MessageString)
{
	TWeakObjectPtr<UTelemetryWebSocketSubsystem> WeakThis(this);

	// Asynchronous JSON deserialization on background thread
	AsyncTask(ENamedThreads::AnyBackgroundThreadNormalTask, [WeakThis, MessageString]()
	{
		TSharedPtr<FJsonObject> RootObject;
		TSharedRef<TJsonReader<>> Reader = TJsonReaderFactory<>::Create(MessageString);

		if (!FJsonSerializer::Deserialize(Reader, RootObject) || !RootObject.IsValid())
		{
			return;
		}

		FString FrameType;
		if (RootObject->TryGetStringField(TEXT("frame_type"), FrameType) && FrameType == TEXT("state"))
		{
			FCorridorStatePayload ParsedState;
			if (ParseStateJson(MessageString, ParsedState))
			{
				AsyncTask(ENamedThreads::GameThread, [WeakThis, ParsedState]()
				{
					if (UTelemetryWebSocketSubsystem* Subsystem = WeakThis.Get())
					{
						Subsystem->LatestStatePayload = ParsedState;
						Subsystem->OnCorridorStateReceived.Broadcast(ParsedState);
					}
				});
			}
			return;
		}

		FAmbulanceTelemetryPayload ParsedPayload;
		const bool bSuccess = ParseTelemetryJson(MessageString, ParsedPayload);

		if (!bSuccess)
		{
			return;
		}

		// CRITICAL REQUIREMENT: Strict Game-Thread Marshaling
		AsyncTask(ENamedThreads::GameThread, [WeakThis, ParsedPayload]()
		{
			if (UTelemetryWebSocketSubsystem* Subsystem = WeakThis.Get())
			{
				Subsystem->LatestTelemetry = ParsedPayload;
				Subsystem->OnAmbulanceTelemetryReceived.Broadcast(ParsedPayload);
			}
		});
	});
}

bool UTelemetryWebSocketSubsystem::ParseTelemetryJson(const FString& JsonString, FAmbulanceTelemetryPayload& OutPayload)
{
	TSharedPtr<FJsonObject> RootObject;
	TSharedRef<TJsonReader<>> Reader = TJsonReaderFactory<>::Create(JsonString);

	if (!FJsonSerializer::Deserialize(Reader, RootObject) || !RootObject.IsValid())
	{
		return false;
	}

	// VehicleId (supports "vehicle_id", "VehicleId", "id")
	FString VehicleIdVal;
	if (RootObject->TryGetStringField(TEXT("vehicle_id"), VehicleIdVal) ||
		RootObject->TryGetStringField(TEXT("VehicleId"), VehicleIdVal) ||
		RootObject->TryGetStringField(TEXT("id"), VehicleIdVal))
	{
		OutPayload.VehicleId = VehicleIdVal;
	}

	// Timestamp (epoch in seconds, supports double or int64)
	double TimestampVal = 0.0;
	if (RootObject->TryGetNumberField(TEXT("timestamp"), TimestampVal) ||
		RootObject->TryGetNumberField(TEXT("Timestamp"), TimestampVal))
	{
		OutPayload.Timestamp = TimestampVal;
	}

	// Latitude (supports "latitude", "Latitude", "lat")
	double LatVal = 0.0;
	if (RootObject->TryGetNumberField(TEXT("latitude"), LatVal) ||
		RootObject->TryGetNumberField(TEXT("Latitude"), LatVal) ||
		RootObject->TryGetNumberField(TEXT("lat"), LatVal))
	{
		OutPayload.Latitude = LatVal;
	}

	// Longitude (supports "longitude", "Longitude", "lon", "lng")
	double LonVal = 0.0;
	if (RootObject->TryGetNumberField(TEXT("longitude"), LonVal) ||
		RootObject->TryGetNumberField(TEXT("Longitude"), LonVal) ||
		RootObject->TryGetNumberField(TEXT("lon"), LonVal) ||
		RootObject->TryGetNumberField(TEXT("lng"), LonVal))
	{
		OutPayload.Longitude = LonVal;
	}

	// Altitude (supports "altitude", "Altitude", "alt")
	double AltVal = 0.0;
	if (RootObject->TryGetNumberField(TEXT("altitude"), AltVal) ||
		RootObject->TryGetNumberField(TEXT("Altitude"), AltVal) ||
		RootObject->TryGetNumberField(TEXT("alt"), AltVal))
	{
		OutPayload.Altitude = AltVal;
	}

	// SpeedKmh (supports "speed_kmh", "SpeedKmh", "speed")
	double SpeedVal = 0.0;
	if (RootObject->TryGetNumberField(TEXT("speed_kmh"), SpeedVal) ||
		RootObject->TryGetNumberField(TEXT("SpeedKmh"), SpeedVal) ||
		RootObject->TryGetNumberField(TEXT("speed"), SpeedVal))
	{
		OutPayload.SpeedKmh = static_cast<float>(SpeedVal);
	}

	// HeadingDeg (supports "heading_deg", "HeadingDeg", "heading")
	double HeadingVal = 0.0;
	if (RootObject->TryGetNumberField(TEXT("heading_deg"), HeadingVal) ||
		RootObject->TryGetNumberField(TEXT("HeadingDeg"), HeadingVal) ||
		RootObject->TryGetNumberField(TEXT("heading"), HeadingVal))
	{
		OutPayload.HeadingDeg = static_cast<float>(HeadingVal);
	}

	// CurrentRoadOsmId (supports "current_road_osm_id", "CurrentRoadOsmId", "road_osm_id", "road_id")
	int64 RoadOsmIdVal = 0;
	if (RootObject->TryGetNumberField(TEXT("current_road_osm_id"), RoadOsmIdVal) ||
		RootObject->TryGetNumberField(TEXT("CurrentRoadOsmId"), RoadOsmIdVal) ||
		RootObject->TryGetNumberField(TEXT("road_osm_id"), RoadOsmIdVal))
	{
		OutPayload.CurrentRoadOsmId = RoadOsmIdVal;
	}
	else
	{
		FString RoadOsmIdStr;
		if (RootObject->TryGetStringField(TEXT("current_road_osm_id"), RoadOsmIdStr) ||
			RootObject->TryGetStringField(TEXT("CurrentRoadOsmId"), RoadOsmIdStr) ||
			RootObject->TryGetStringField(TEXT("road_osm_id"), RoadOsmIdStr) ||
			RootObject->TryGetStringField(TEXT("road_id"), RoadOsmIdStr))
		{
			if (RoadOsmIdStr.IsNumeric())
			{
				OutPayload.CurrentRoadOsmId = FCString::Atoi64(*RoadOsmIdStr);
			}
			else
			{
				FString DigitsOnly;
				for (TCHAR Ch : RoadOsmIdStr)
				{
					if (FChar::IsDigit(Ch))
					{
						DigitsOnly.AppendChar(Ch);
					}
				}
				if (!DigitsOnly.IsEmpty())
				{
					OutPayload.CurrentRoadOsmId = FCString::Atoi64(*DigitsOnly);
				}
				else
				{
					OutPayload.CurrentRoadOsmId = static_cast<int64>(GetTypeHash(RoadOsmIdStr));
				}
			}
		}
	}

	// DestinationHospitalId (supports "destination_hospital_id", "DestinationHospitalId", "hospital_id")
	FString DestHospVal;
	if (RootObject->TryGetStringField(TEXT("destination_hospital_id"), DestHospVal) ||
		RootObject->TryGetStringField(TEXT("DestinationHospitalId"), DestHospVal) ||
		RootObject->TryGetStringField(TEXT("hospital_id"), DestHospVal))
	{
		OutPayload.DestinationHospitalId = DestHospVal;
	}

	// bPriorityActive (supports "priority_active", "bPriorityActive", "priority", "is_priority")
	bool bPriorityVal = false;
	if (RootObject->TryGetBoolField(TEXT("priority_active"), bPriorityVal) ||
		RootObject->TryGetBoolField(TEXT("bPriorityActive"), bPriorityVal) ||
		RootObject->TryGetBoolField(TEXT("priority"), bPriorityVal) ||
		RootObject->TryGetBoolField(TEXT("is_priority"), bPriorityVal))
	{
		OutPayload.bPriorityActive = bPriorityVal;
	}

	// PreemptJunctionOsmId (supports "preempt_junction_osm_id", "PreemptJunctionOsmId", "junction_osm_id", "junction_id")
	int64 JunctionOsmIdVal = 0;
	if (RootObject->TryGetNumberField(TEXT("preempt_junction_osm_id"), JunctionOsmIdVal) ||
		RootObject->TryGetNumberField(TEXT("PreemptJunctionOsmId"), JunctionOsmIdVal) ||
		RootObject->TryGetNumberField(TEXT("junction_osm_id"), JunctionOsmIdVal))
	{
		OutPayload.PreemptJunctionOsmId = JunctionOsmIdVal;
	}
	else
	{
		FString JunctionOsmIdStr;
		if (RootObject->TryGetStringField(TEXT("preempt_junction_osm_id"), JunctionOsmIdStr) ||
			RootObject->TryGetStringField(TEXT("PreemptJunctionOsmId"), JunctionOsmIdStr) ||
			RootObject->TryGetStringField(TEXT("junction_osm_id"), JunctionOsmIdStr) ||
			RootObject->TryGetStringField(TEXT("junction_id"), JunctionOsmIdStr))
		{
			if (JunctionOsmIdStr.IsNumeric())
			{
				OutPayload.PreemptJunctionOsmId = FCString::Atoi64(*JunctionOsmIdStr);
			}
			else
			{
				FString DigitsOnly;
				for (TCHAR Ch : JunctionOsmIdStr)
				{
					if (FChar::IsDigit(Ch))
					{
						DigitsOnly.AppendChar(Ch);
					}
				}
				if (!DigitsOnly.IsEmpty())
				{
					OutPayload.PreemptJunctionOsmId = FCString::Atoi64(*DigitsOnly);
				}
				else
				{
					OutPayload.PreemptJunctionOsmId = static_cast<int64>(GetTypeHash(JunctionOsmIdStr));
				}
			}
		}
	}

	// GreenWaveJunctionIds (supports "green_wave_junction_ids", "GreenWaveJunctionIds")
	const TArray<TSharedPtr<FJsonValue>>* GreenWaveArray = nullptr;
	if (RootObject->TryGetArrayField(TEXT("green_wave_junction_ids"), GreenWaveArray) ||
		RootObject->TryGetArrayField(TEXT("GreenWaveJunctionIds"), GreenWaveArray))
	{
		OutPayload.GreenWaveJunctionIds.Empty();
		for (const TSharedPtr<FJsonValue>& Item : *GreenWaveArray)
		{
			if (!Item.IsValid()) continue;
			int64 JunctionId = 0;
			if (Item->TryGetNumber(JunctionId))
			{
				OutPayload.GreenWaveJunctionIds.Add(JunctionId);
			}
			else
			{
				FString ItemStr = Item->AsString();
				if (ItemStr.IsNumeric())
				{
					OutPayload.GreenWaveJunctionIds.Add(FCString::Atoi64(*ItemStr));
				}
				else if (!ItemStr.IsEmpty())
				{
					FString DigitsOnly;
					for (TCHAR Ch : ItemStr)
					{
						if (FChar::IsDigit(Ch)) DigitsOnly.AppendChar(Ch);
					}
					if (!DigitsOnly.IsEmpty())
					{
						OutPayload.GreenWaveJunctionIds.Add(FCString::Atoi64(*DigitsOnly));
					}
					else
					{
						OutPayload.GreenWaveJunctionIds.Add(static_cast<int64>(GetTypeHash(ItemStr)));
					}
				}
			}
		}
	}

	// Fallback single PreemptJunctionOsmId to first element of GreenWaveJunctionIds if not explicitly set
	if (OutPayload.PreemptJunctionOsmId == 0 && OutPayload.GreenWaveJunctionIds.Num() > 0)
	{
		OutPayload.PreemptJunctionOsmId = OutPayload.GreenWaveJunctionIds[0];
	}

	// ActiveRouteOsmIds (supports "active_route_osm_ids", "ActiveRouteOsmIds")
	const TArray<TSharedPtr<FJsonValue>>* ActiveRouteArray = nullptr;
	if (RootObject->TryGetArrayField(TEXT("active_route_osm_ids"), ActiveRouteArray) ||
		RootObject->TryGetArrayField(TEXT("ActiveRouteOsmIds"), ActiveRouteArray))
	{
		OutPayload.ActiveRouteOsmIds.Empty();
		for (const TSharedPtr<FJsonValue>& Item : *ActiveRouteArray)
		{
			if (!Item.IsValid()) continue;
			int64 RoadId = 0;
			if (Item->TryGetNumber(RoadId))
			{
				OutPayload.ActiveRouteOsmIds.Add(RoadId);
			}
			else
			{
				FString ItemStr = Item->AsString();
				if (ItemStr.IsNumeric())
				{
					OutPayload.ActiveRouteOsmIds.Add(FCString::Atoi64(*ItemStr));
				}
				else if (!ItemStr.IsEmpty())
				{
					FString DigitsOnly;
					for (TCHAR Ch : ItemStr)
					{
						if (FChar::IsDigit(Ch)) DigitsOnly.AppendChar(Ch);
					}
					if (!DigitsOnly.IsEmpty())
					{
						OutPayload.ActiveRouteOsmIds.Add(FCString::Atoi64(*DigitsOnly));
					}
					else
					{
						OutPayload.ActiveRouteOsmIds.Add(static_cast<int64>(GetTypeHash(ItemStr)));
					}
				}
			}
		}
	}

	// SpeedAdvisoryKmh (supports "speed_advisory_kmh", "SpeedAdvisoryKmh")
	double SpeedAdvisoryVal = 0.0;
	if (RootObject->TryGetNumberField(TEXT("speed_advisory_kmh"), SpeedAdvisoryVal) ||
		RootObject->TryGetNumberField(TEXT("SpeedAdvisoryKmh"), SpeedAdvisoryVal))
	{
		OutPayload.SpeedAdvisoryKmh = static_cast<float>(SpeedAdvisoryVal);
	}

	// PatientCriticalityTier (supports "patient_criticality_tier", "criticality_tier", "PatientCriticalityTier")
	int32 TierVal = 1;
	if (RootObject->TryGetNumberField(TEXT("patient_criticality_tier"), TierVal) ||
		RootObject->TryGetNumberField(TEXT("criticality_tier"), TierVal) ||
		RootObject->TryGetNumberField(TEXT("PatientCriticalityTier"), TierVal))
	{
		OutPayload.PatientCriticalityTier = TierVal;
	}

	return true;
}

bool UTelemetryWebSocketSubsystem::ParseStateJson(const FString& JsonString, FCorridorStatePayload& OutPayload)
{
	TSharedPtr<FJsonObject> RootObject;
	TSharedRef<TJsonReader<>> Reader = TJsonReaderFactory<>::Create(JsonString);

	if (!FJsonSerializer::Deserialize(Reader, RootObject) || !RootObject.IsValid())
	{
		return false;
	}

	// Timestamp
	double TimestampVal = 0.0;
	if (RootObject->TryGetNumberField(TEXT("timestamp"), TimestampVal) ||
		RootObject->TryGetNumberField(TEXT("Timestamp"), TimestampVal))
	{
		OutPayload.Timestamp = TimestampVal;
	}

	// RouteClearRate
	double ClearRateVal = 0.0;
	if (RootObject->TryGetNumberField(TEXT("route_clear_rate"), ClearRateVal) ||
		RootObject->TryGetNumberField(TEXT("RouteClearRate"), ClearRateVal))
	{
		OutPayload.RouteClearRate = static_cast<float>(ClearRateVal);
	}

	// TotalSignalOverrides
	int32 OverridesVal = 0;
	if (RootObject->TryGetNumberField(TEXT("total_signal_overrides"), OverridesVal) ||
		RootObject->TryGetNumberField(TEXT("TotalSignalOverrides"), OverridesVal))
	{
		OutPayload.TotalSignalOverrides = OverridesVal;
	}

	// EdgeCongestionMap
	const TSharedPtr<FJsonObject>* MapObject = nullptr;
	if (RootObject->TryGetObjectField(TEXT("edge_congestion_map"), MapObject) ||
		RootObject->TryGetObjectField(TEXT("EdgeCongestionMap"), MapObject))
	{
		OutPayload.EdgeCongestionMap.Empty();
		for (const auto& Pair : (*MapObject)->Values)
		{
			if (Pair.Value.IsValid())
			{
				double CongestionVal = 0.0;
				if (Pair.Value->TryGetNumber(CongestionVal))
				{
					OutPayload.EdgeCongestionMap.Add(Pair.Key, static_cast<float>(CongestionVal));
				}
			}
		}
	}

	return true;
}
