using UnityEngine;

/// <summary>
/// Finds a lit shader and builds materials that work in whichever render pipeline
/// the project uses.
///
/// The property names differ between pipelines - HDRP and URP use _BaseColor and
/// _Smoothness, Built-in uses _Color and _Glossiness - so every write is guarded
/// by HasProperty instead of assuming. Nothing here throws if a property is
/// missing; it just does less.
/// </summary>
public static class TDCMaterials
{
    static int pipelineChecked;

    /// <summary>True when the High Definition Render Pipeline is available.</summary>
    public static bool IsHDRP
    {
        get
        {
            if (pipelineChecked == 0)
            {
                pipelineChecked = Shader.Find("HDRP/Lit") != null ? 2 : 1;
            }
            return pipelineChecked == 2;
        }
    }

    public static Shader FindLitShader()
    {
        Shader shader = Shader.Find("HDRP/Lit");
        if (shader == null) shader = Shader.Find("Universal Render Pipeline/Lit");
        if (shader == null) shader = Shader.Find("Standard");
        if (shader == null) shader = Shader.Find("Legacy Shaders/Diffuse");
        return shader;
    }

    public static Material CreateLit(string name, Color colour, float smoothness, float metallic)
    {
        Shader shader = FindLitShader();
        if (shader == null) return null;

        var material = new Material(shader) { name = name };

        if (material.HasProperty("_BaseColor")) material.SetColor("_BaseColor", colour);
        if (material.HasProperty("_Color")) material.SetColor("_Color", colour);

        if (material.HasProperty("_Smoothness")) material.SetFloat("_Smoothness", smoothness);
        if (material.HasProperty("_Glossiness")) material.SetFloat("_Glossiness", smoothness);
        if (material.HasProperty("_SmoothnessRemapMax")) material.SetFloat("_SmoothnessRemapMax", smoothness);

        if (material.HasProperty("_Metallic")) material.SetFloat("_Metallic", metallic);
        if (material.HasProperty("_MetallicRemapMax")) material.SetFloat("_MetallicRemapMax", metallic);

        return material;
    }

    /// <summary>
    /// Wet asphalt: very dark, moderately smooth. The reflections Lumen would
    /// give you in Unreal come from screen-space reflections or ray tracing in
    /// Unity, which is why smoothness matters more than the base colour here.
    /// </summary>
    public static Material WetAsphalt()
    {
        return CreateLit("TDC Wet Asphalt", new Color(0.035f, 0.036f, 0.040f), 0.85f, 0.0f);
    }

    public static Material CarPaint(Color colour)
    {
        return CreateLit("TDC Car Paint", colour, 0.9f, 0.35f);
    }

    public static Material Tyre()
    {
        return CreateLit("TDC Tyre", new Color(0.02f, 0.02f, 0.022f), 0.15f, 0.0f);
    }
}
