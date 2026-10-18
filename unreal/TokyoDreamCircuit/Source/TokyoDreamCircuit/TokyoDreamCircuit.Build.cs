// Copyright Epic Games, Inc. All Rights Reserved.

using UnrealBuildTool;

public class TokyoDreamCircuit : ModuleRules
{
	public TokyoDreamCircuit(ReadOnlyTargetRules Target) : base(Target)
	{
		PCHUsage = PCHUsageMode.UseExplicitOrSharedPCHs;

		PublicDependencyModuleNames.AddRange(new string[]
		{
			"Core",
			"CoreUObject",
			"Engine",
			"InputCore",
			"ProceduralMeshComponent",
			"PhysicsCore",
			// USynthComponent, for the runtime-synthesised engine audio. No audio
			// assets are used anywhere in this project.
			"AudioMixer"
		});

		PrivateDependencyModuleNames.AddRange(new string[]
		{
			"RenderCore",
			"RHI"
		});

		// Uncomment when you start using these. They are enabled as plugins in
		// TokyoDreamCircuit.uproject already.
		// PrivateDependencyModuleNames.AddRange(new string[] { "ChaosVehicles", "Chaos", "Niagara", "PCG" });
	}
}
