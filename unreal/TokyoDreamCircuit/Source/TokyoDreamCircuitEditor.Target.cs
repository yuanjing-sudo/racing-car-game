// Copyright Epic Games, Inc. All Rights Reserved.

using UnrealBuildTool;
using System.Collections.Generic;

public class TokyoDreamCircuitEditorTarget : TargetRules
{
	public TokyoDreamCircuitEditorTarget(TargetInfo Target) : base(Target)
	{
		Type = TargetType.Editor;
		DefaultBuildSettings = BuildSettingsVersion.V5;

		ExtraModuleNames.Add("TokyoDreamCircuit");
	}
}
