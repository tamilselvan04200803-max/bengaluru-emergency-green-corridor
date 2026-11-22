// Copyright (c) 2026 Bengaluru Digital Twin Initiative. All Rights Reserved.

using UnrealBuildTool;

public class TrafficClearance : ModuleRules
{
	public TrafficClearance(ReadOnlyTargetRules Target) : base(Target)
	{
		PCHUsage = PCHUsageMode.UseExplicitOrSharedPCHs;
		IncludeOrderVersion = EngineIncludeOrderVersion.Unreal5_4;

		PublicDependencyModuleNames.AddRange(
			new string[]
			{
				"Core",
				"CoreUObject",
				"Engine",
				"InputCore",
				"Json",
				"JsonUtilities",
				"CesiumRuntime",
				"WebSockets"
			}
		);

		PrivateDependencyModuleNames.AddRange(
			new string[]
			{
				"Projects"
			}
		);

		PublicIncludePaths.AddRange(
			new string[] {
				// Module include paths
			}
		);
	}
}
