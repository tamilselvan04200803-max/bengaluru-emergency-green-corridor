// Copyright (c) 2026 Bengaluru Digital Twin Initiative. All Rights Reserved.

#pragma once

#include "CoreMinimal.h"
#include "Subsystems/GameInstanceSubsystem.h"
#include "IWebSocket.h"
#include "TelemetryWebSocketSubsystem.generated.h"

/**
 * Enhanced 10Hz Ambulance Telemetry Payload.
 * Captures real-time kinematics, spatial network references, and priority clearance states.
 */
USTRUCT(BlueprintType)
struct TRAFFICCLEARANCE_API FAmbulanceTelemetryPayload
{
	GENERATED_BODY()

	/** Unique ambulance identifier (e.g., "AMB-KA01-0911") */
	UPROPERTY(EditAnywhere, BlueprintReadWrite, Category = "TrafficClearance|Telemetry")
	FString VehicleId;

	/** Unix epoch timestamp in seconds with microsecond precision */
	UPROPERTY(EditAnywhere, BlueprintReadWrite, Category = "TrafficClearance|Telemetry")
	double Timestamp = 0.0;

	/** WGS84 Latitude in decimal degrees */
	UPROPERTY(EditAnywhere, BlueprintReadWrite, Category = "TrafficClearance|Telemetry")
	double Latitude = 0.0;

	/** WGS84 Longitude in decimal degrees */
	UPROPERTY(EditAnywhere, BlueprintReadWrite, Category = "TrafficClearance|Telemetry")
	double Longitude = 0.0;

	/** Altitude in meters above mean sea level (MSL) */
	UPROPERTY(EditAnywhere, BlueprintReadWrite, Category = "TrafficClearance|Telemetry")
	double Altitude = 0.0;

	/** Vehicle speed in kilometers per hour */
	UPROPERTY(EditAnywhere, BlueprintReadWrite, Category = "TrafficClearance|Telemetry")
	float SpeedKmh = 0.0f;

	/** Compass heading in degrees [0..360) clockwise from True North */
	UPROPERTY(EditAnywhere, BlueprintReadWrite, Category = "TrafficClearance|Telemetry")
	float HeadingDeg = 0.0f;

	/** OpenStreetMap Way ID of the road segment currently occupied */
	UPROPERTY(EditAnywhere, BlueprintReadWrite, Category = "TrafficClearance|Telemetry")
	int64 CurrentRoadOsmId = 0;

	/** Target destination hospital identifier */
	UPROPERTY(EditAnywhere, BlueprintReadWrite, Category = "TrafficClearance|Telemetry")
	FString DestinationHospitalId;

	/** Active emergency priority flag requesting green corridor clearance */
	UPROPERTY(EditAnywhere, BlueprintReadWrite, Category = "TrafficClearance|Telemetry")
	bool bPriorityActive = false;

	/** OpenStreetMap Node ID of the upcoming traffic signal junction to preempt */
	UPROPERTY(EditAnywhere, BlueprintReadWrite, Category = "TrafficClearance|Telemetry")
	int64 PreemptJunctionOsmId = 0;

	/** OSM Node IDs of all junctions in the Green Wave window */
	UPROPERTY(EditAnywhere, BlueprintReadWrite, Category = "TrafficClearance|Telemetry")
	TArray<int64> GreenWaveJunctionIds;

	/** Ordered OSM Way IDs of the ambulance's current planned route */
	UPROPERTY(EditAnywhere, BlueprintReadWrite, Category = "TrafficClearance|Telemetry")
	TArray<int64> ActiveRouteOsmIds;

	/** Speed advisory from conflict arbiter (0.0 = no advisory) */
	UPROPERTY(EditAnywhere, BlueprintReadWrite, Category = "TrafficClearance|Telemetry")
	float SpeedAdvisoryKmh = 0.0f;

	/** Patient criticality tier (1 = Critical, 2 = Urgent, 3 = Standard) */
	UPROPERTY(EditAnywhere, BlueprintReadWrite, Category = "TrafficClearance|Telemetry")
	int32 PatientCriticalityTier = 1;
};

/**
 * Decoupled 2Hz Corridor State Payload.
 * Broadcasts congestion heatmap, overall clearance rate, and active override counts.
 */
USTRUCT(BlueprintType)
struct TRAFFICCLEARANCE_API FCorridorStatePayload
{
	GENERATED_BODY()

	UPROPERTY(EditAnywhere, BlueprintReadWrite, Category = "TrafficClearance|State")
	TMap<FString, float> EdgeCongestionMap;

	UPROPERTY(EditAnywhere, BlueprintReadWrite, Category = "TrafficClearance|State")
	float RouteClearRate = 0.0f;

	UPROPERTY(EditAnywhere, BlueprintReadWrite, Category = "TrafficClearance|State")
	int32 TotalSignalOverrides = 0;

	UPROPERTY(EditAnywhere, BlueprintReadWrite, Category = "TrafficClearance|State")
	double Timestamp = 0.0;
};

/**
 * Dynamic multicast delegate broadcast on the GameThread when valid telemetry is received.
 */
DECLARE_DYNAMIC_MULTICAST_DELEGATE_OneParam(FOnAmbulanceTelemetryReceived, const FAmbulanceTelemetryPayload&, Payload);

/**
 * Dynamic multicast delegate broadcast on the GameThread when 2Hz corridor state frame is received.
 */
DECLARE_DYNAMIC_MULTICAST_DELEGATE_OneParam(FOnCorridorStateReceived, const FCorridorStatePayload&, StatePayload);

/**
 * Telemetry WebSocket GameInstance Subsystem.
 * Maintains persistent 10Hz live telemetry link with automated exponential backoff reconnection.
 * Handles asynchronous background JSON parsing with strict GameThread dispatching.
 */
UCLASS(BlueprintType)
class TRAFFICCLEARANCE_API UTelemetryWebSocketSubsystem : public UGameInstanceSubsystem
{
	GENERATED_BODY()

public:
	UTelemetryWebSocketSubsystem();

	//~ Begin USubsystem Interface
	virtual void Initialize(FSubsystemCollectionBase& Collection) override;
	virtual void Deinitialize() override;
	//~ End USubsystem Interface

	/** Dynamic multicast delegate broadcasting telemetry packets on the GameThread */
	UPROPERTY(BlueprintAssignable, Category = "TrafficClearance|Telemetry")
	FOnAmbulanceTelemetryReceived OnAmbulanceTelemetryReceived;

	/** Dynamic multicast delegate broadcasting 2Hz corridor state frame on the GameThread */
	UPROPERTY(BlueprintAssignable, Category = "TrafficClearance|State")
	FOnCorridorStateReceived OnCorridorStateReceived;

	/** Connects to the telemetry WebSocket endpoint */
	UFUNCTION(BlueprintCallable, Category = "TrafficClearance|Telemetry")
	void Connect(const FString& InServerUrl = TEXT("ws://localhost:8765"));

	/** Gracefully disconnects the WebSocket */
	UFUNCTION(BlueprintCallable, Category = "TrafficClearance|Telemetry")
	void Disconnect();

	/** Returns true if the WebSocket is currently connected */
	UFUNCTION(BlueprintPure, Category = "TrafficClearance|Telemetry")
	bool IsConnected() const;

	/** Returns the configured WebSocket server URL */
	UFUNCTION(BlueprintPure, Category = "TrafficClearance|Telemetry")
	FString GetServerUrl() const { return ServerUrl; }

	/** Returns the most recently parsed telemetry payload */
	UFUNCTION(BlueprintPure, Category = "TrafficClearance|Telemetry")
	const FAmbulanceTelemetryPayload& GetLatestTelemetry() const { return LatestTelemetry; }

	/** Returns the most recently parsed corridor state payload */
	UFUNCTION(BlueprintPure, Category = "TrafficClearance|State")
	const FCorridorStatePayload& GetLatestStatePayload() const { return LatestStatePayload; }

protected:
	/** WebSocket server endpoint */
	UPROPERTY(EditAnywhere, BlueprintReadWrite, Category = "TrafficClearance|Telemetry")
	FString ServerUrl = TEXT("ws://localhost:8765");

	/** Cached latest corridor state payload */
	UPROPERTY(VisibleAnywhere, BlueprintReadOnly, Category = "TrafficClearance|State")
	FCorridorStatePayload LatestStatePayload;

	/** Initial reconnection delay in seconds */
	UPROPERTY(EditAnywhere, BlueprintReadWrite, Category = "TrafficClearance|Telemetry")
	float InitialReconnectDelay = 1.0f;

	/** Maximum backoff reconnect delay in seconds */
	UPROPERTY(EditAnywhere, BlueprintReadWrite, Category = "TrafficClearance|Telemetry")
	float MaxReconnectDelay = 16.0f;

	/** Current reconnection backoff delay */
	float CurrentReconnectDelay = 1.0f;

	/** Timer handle for scheduled reconnection attempts */
	FTimerHandle ReconnectTimerHandle;

	/** Internal IWebSocket instance */
	TSharedPtr<IWebSocket> WebSocket;

	/** Flag indicating if user or system explicitly requested disconnection */
	bool bIntentionalDisconnect = false;

	/** Cached latest telemetry payload */
	UPROPERTY(VisibleAnywhere, BlueprintReadOnly, Category = "TrafficClearance|Telemetry")
	FAmbulanceTelemetryPayload LatestTelemetry;

	/** Internal setup and event binding */
	void InternalConnect();
	void ScheduleReconnect();
	void HandleWebSocketConnected();
	void HandleWebSocketConnectionError(const FString& Error);
	void HandleWebSocketClosed(int32 StatusCode, const FString& Reason, bool bWasClean);
	void HandleWebSocketMessage(const FString& MessageString);

	/** Parses raw JSON string into FAmbulanceTelemetryPayload */
	static bool ParseTelemetryJson(const FString& JsonString, FAmbulanceTelemetryPayload& OutPayload);

	/** Parses raw JSON string into FCorridorStatePayload */
	static bool ParseStateJson(const FString& JsonString, FCorridorStatePayload& OutPayload);
};
