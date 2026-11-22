// Copyright (c) 2026 Bengaluru Digital Twin Initiative. All Rights Reserved.

using UnrealBuildTool;
using System.Collections.Generic;

public class TrafficClearanceTarget : TargetRules
{
	public TrafficClearanceTarget(TargetInfo Target) : base(Target)
	{
		Type = TargetType.Game;
		DefaultBuildSettings = BuildSettingsVersion.V5;
		IncludeOrderVersion = EngineIncludeOrderVersion.Unreal5_4;
		ExtraModuleNames.AddRange(new string[] { "TrafficClearance" });
	}
}
