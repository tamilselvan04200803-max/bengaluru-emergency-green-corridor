// Copyright (c) 2026 Bengaluru Digital Twin Initiative. All Rights Reserved.

using UnrealBuildTool;
using System.Collections.Generic;

public class TrafficClearanceEditorTarget : TargetRules
{
	public TrafficClearanceEditorTarget(TargetInfo Target) : base(Target)
	{
		Type = TargetType.Editor;
		DefaultBuildSettings = BuildSettingsVersion.V5;
		IncludeOrderVersion = EngineIncludeOrderVersion.Unreal5_4;
		ExtraModuleNames.AddRange(new string[] { "TrafficClearance" });
	}
}
