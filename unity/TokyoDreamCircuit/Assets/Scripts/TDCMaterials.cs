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

    // -------------------------------------------------------------------------
    // Particles
    // -------------------------------------------------------------------------

    /// <summary>
    /// Finds a particle shader that supports a texture, a tint and alpha, in
    /// whichever pipeline is present. The pipeline-specific names come first so a
    /// URP or HDRP project does not silently fall back to a built-in shader that
    /// renders magenta.
    /// </summary>
    public static Shader FindParticleShader()
    {
        Shader shader = Shader.Find("HDRP/Particles/Unlit");
        if (shader == null) shader = Shader.Find("Universal Render Pipeline/Particles/Unlit");
        if (shader == null) shader = Shader.Find("Particles/Standard Unlit");
        if (shader == null) shader = Shader.Find("Legacy Shaders/Particles/Alpha Blended");
        if (shader == null) shader = Shader.Find("Sprites/Default");
        return shader;
    }

    /// <summary>
    /// A particle material with a soft-edged puff assigned. Returns null if no
    /// particle shader exists, in which case the caller should emit nothing rather
    /// than emit hard-edged squares.
    /// </summary>
    public static Material CreateParticle(string name, Color colour)
    {
        Shader shader = FindParticleShader();
        if (shader == null) return null;

        var material = new Material(shader) { name = name };

        if (material.HasProperty("_BaseColor")) material.SetColor("_BaseColor", colour);
        if (material.HasProperty("_Color")) material.SetColor("_Color", colour);
        if (material.HasProperty("_TintColor")) material.SetColor("_TintColor", colour);

        Texture2D puff = CreatePuffTexture(64);
        if (puff != null)
        {
            material.mainTexture = puff;
            if (material.HasProperty("_BaseMap")) material.SetTexture("_BaseMap", puff);
        }

        return material;
    }

    /// <summary>
    /// A soft radial puff, generated rather than imported. A particle with no
    /// texture is a hard-edged square; this is the difference between smoke and
    /// confetti, and it means the project ships no image assets.
    /// </summary>
    public static Texture2D CreatePuffTexture(int size)
    {
        size = Mathf.Clamp(size, 8, 512);

        var texture = new Texture2D(size, size, TextureFormat.RGBA32, false);
        texture.name = "TDC Puff";
        texture.wrapMode = TextureWrapMode.Clamp;

        var pixels = new Color[size * size];
        float half = size * 0.5f;

        for (int y = 0; y < size; y++)
        {
            for (int x = 0; x < size; x++)
            {
                float dx = (x + 0.5f - half) / half;
                float dy = (y + 0.5f - half) / half;
                float distance = Mathf.Sqrt(dx * dx + dy * dy);

                // Smoothstep to zero rather than a linear ramp, so the edge of the
                // puff does not show as a ring.
                float alpha = 1f - Mathf.SmoothStep(0f, 1f, Mathf.Clamp01(distance));
                pixels[y * size + x] = new Color(1f, 1f, 1f, alpha);
            }
        }

        texture.SetPixels(pixels);
        texture.Apply(false, true);
        return texture;
    }

    /// <summary>
    /// Turns emission on for a material and returns the property name it used, or
    /// null if the shader has no emission at all. Built-in and URP use
    /// _EmissionColor and need the keyword; HDRP uses _EmissiveColor.
    /// </summary>
    public static string EnableEmission(Material material, Color colour)
    {
        if (material == null) return null;

        if (material.HasProperty("_EmissiveColor"))
        {
            material.SetColor("_EmissiveColor", colour);
            return "_EmissiveColor";
        }

        if (material.HasProperty("_EmissionColor"))
        {
            material.EnableKeyword("_EMISSION");
            material.globalIlluminationFlags = MaterialGlobalIlluminationFlags.RealtimeEmissive;
            material.SetColor("_EmissionColor", colour);
            return "_EmissionColor";
        }

        return null;
    }
}
