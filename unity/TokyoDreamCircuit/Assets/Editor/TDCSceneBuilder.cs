#if UNITY_EDITOR
using System.Collections.Generic;
using System.IO;
using UnityEditor;
using UnityEditor.SceneManagement;
using UnityEngine;

/// <summary>
/// Editor tools for the circuit. Everything lives under the
/// "Tokyo Dream Circuit" top-level menu.
///
/// Files in an Editor folder are compiled out of player builds, so none of this
/// ships.
/// </summary>
public static class TDCSceneBuilder
{
    const string ScenePath = "Assets/Scenes/TokyoNightRun.unity";

    /// <summary>
    /// Creates a new, empty scene containing a single bootstrap object and saves
    /// it, so the project has a real, editable scene instead of only a runtime
    /// one.
    /// </summary>
    [MenuItem("Tokyo Dream Circuit/Create Demo Scene (TokyoNightRun)", false, 0)]
    public static void CreateDemoScene()
    {
        if (File.Exists(ScenePath))
        {
            bool overwrite = EditorUtility.DisplayDialog(
                "Tokyo Dream Circuit",
                ScenePath + " already exists.\n\nOverwrite it?",
                "Overwrite",
                "Cancel");

            if (!overwrite) return;
        }

        UnityEngine.SceneManagement.Scene scene =
            EditorSceneManager.NewScene(NewSceneSetup.EmptyScene, NewSceneMode.Single);

        var root = new GameObject("Tokyo Dream Circuit");
        root.AddComponent<TDCSceneBootstrap>();

        Directory.CreateDirectory(Path.GetDirectoryName(ScenePath));
        EditorSceneManager.SaveScene(scene, ScenePath);
        AddToBuildSettings(ScenePath);

        Debug.Log("[TDC] Created " + ScenePath + ". Press Play to drive.");
    }

    /// <summary>
    /// Adds the demo scene to Build Settings if it is not already there, so a
    /// packaged build starts in the right place.
    /// </summary>
    [MenuItem("Tokyo Dream Circuit/Add Demo Scene To Build Settings", false, 1)]
    public static void AddDemoSceneToBuildSettings()
    {
        if (!File.Exists(ScenePath))
        {
            EditorUtility.DisplayDialog(
                "Tokyo Dream Circuit",
                "No scene at " + ScenePath + ".\n\nRun Create Demo Scene first.",
                "OK");
            return;
        }

        AddToBuildSettings(ScenePath);
        Debug.Log("[TDC] " + ScenePath + " is in Build Settings.");
    }

    static void AddToBuildSettings(string path)
    {
        var scenes = new List<EditorBuildSettingsScene>(EditorBuildSettings.scenes);

        foreach (EditorBuildSettingsScene existing in scenes)
        {
            if (existing.path == path)
            {
                existing.enabled = true;
                EditorBuildSettings.scenes = scenes.ToArray();
                return;
            }
        }

        scenes.Insert(0, new EditorBuildSettingsScene(path, true));
        EditorBuildSettings.scenes = scenes.ToArray();
    }

    /// <summary>
    /// Rebuilds every procedural road in the open scene, for when something has
    /// changed that OnValidate did not pick up.
    /// </summary>
    [MenuItem("Tokyo Dream Circuit/Rebuild All Roads", false, 20)]
    public static void RebuildAllRoads()
    {
        TDCProceduralRoad[] roads =
            Object.FindObjectsByType<TDCProceduralRoad>(FindObjectsSortMode.None);

        foreach (TDCProceduralRoad road in roads)
        {
            road.Rebuild();
        }

        Debug.Log("[TDC] Rebuilt " + roads.Length + " road(s).");
    }

    /// <summary>
    /// Reports what the project is missing before the first Play, so the
    /// render-pipeline and input-setup mistakes surface here rather than as
    /// pink materials and dead controls.
    /// </summary>
    [MenuItem("Tokyo Dream Circuit/Check Project Setup", false, 40)]
    public static void CheckProjectSetup()
    {
        var lines = new List<string>();

        lines.Add("Render pipeline: " + (TDCMaterials.IsHDRP ? "HDRP"
            : Shader.Find("Universal Render Pipeline/Lit") != null ? "URP" : "Built-in"));

        lines.Add("Lit shader found: " + (TDCMaterials.FindLitShader() != null ? "yes" : "NO - materials will be white"));

        lines.Add("Active input handling: " + ActiveInputDescription());

        lines.Add("Fixed timestep: " + Time.fixedDeltaTime.ToString("0.00000") + " s");

        GameObject bootstrap = null;
        foreach (TDCSceneBootstrap candidate in
            Object.FindObjectsByType<TDCSceneBootstrap>(FindObjectsSortMode.None))
        {
            bootstrap = candidate.gameObject;
            break;
        }

        lines.Add("Scene bootstrap present: " + (bootstrap != null ? "yes" : "no - add one, or run Create Demo Scene"));

        Debug.Log("[TDC] Project setup\n  " + string.Join("\n  ", lines.ToArray()));
    }

    static string ActiveInputDescription()
    {
#if ENABLE_INPUT_SYSTEM && ENABLE_LEGACY_INPUT_MANAGER
        return "Both (using the legacy Input Manager path)";
#elif ENABLE_INPUT_SYSTEM
        return "Input System package only (using the new Input System path)";
#elif ENABLE_LEGACY_INPUT_MANAGER
        return "Input Manager only";
#else
        return "neither - no input will be read";
#endif
    }
}
#endif
