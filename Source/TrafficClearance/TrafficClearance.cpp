// Copyright (c) 2026 Bengaluru Digital Twin Initiative. All Rights Reserved.

#include "TrafficClearance.h"
#include "Modules/ModuleManager.h"

DEFINE_LOG_CATEGORY(LogTrafficClearance);

void FTrafficClearanceModule::StartupModule()
{
	UE_LOG(LogTrafficClearance, Log, TEXT("TrafficClearance: Bengaluru Digital Twin Module initialized successfully."));
}

void FTrafficClearanceModule::ShutdownModule()
{
	UE_LOG(LogTrafficClearance, Log, TEXT("TrafficClearance: Bengaluru Digital Twin Module shut down."));
}

IMPLEMENT_PRIMARY_GAME_MODULE(FTrafficClearanceModule, TrafficClearance, "TrafficClearance");
