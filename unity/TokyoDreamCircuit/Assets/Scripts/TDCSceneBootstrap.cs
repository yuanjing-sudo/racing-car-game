using UnityEngine;

/// <summary>
/// Builds the whole demo scene at runtime: road, car, chase camera and night
/// lighting. Add this one component to an empty GameObject, press Play, and you
/// are driving - no asset wiring, no prefabs, no scene authoring.
///
/// It is the Unity answer to the Unreal project's
/// SCENE_SETUP_CHECKLIST.txt: the same scene, but built by code so it cannot get
/// out of step with the scripts. Everything it creates is a normal GameObject you
/// can select and tweak while the game runs.
///
/// For a saved, hand-editable scene instead, use
/// GameObject > Tokyo Dream Circuit > Create Demo Scene.
/// </summary>
[AddComponentMenu("Tokyo Dream Circuit/Scene Bootstrap")]
public class TDCSceneBootstrap : MonoBehaviour
{
    [Header("Road")]
    public TDCProceduralRoad.RoadShape shape = TDCProceduralRoad.RoadShape.Circuit;

    [Tooltip("Road width in metres.")]
    public float roadWidth = 12f;

    [Tooltip("Circuit radius in metres. Only used by the closed circuit.")]
    public float circuitRadius = 600f;

    [Header("Car")]
    public Color carColour = new Color(0.55f, 0.06f, 0.09f);

    [Tooltip("How far above the road the car starts, in metres. It drops onto the surface.")]
    public float carSpawnHeight = 1f;

    [Header("Night lighting")]
    [Tooltip("Directional light colour. Slightly blue for a moonlit sky.")]
    public Color moonColour = new Color(0.62f, 0.72f, 1f);

    [Tooltip("Directional light intensity. Built-in and URP use an arbitrary unit; HDRP uses " +
             "lux, so it needs a much larger number.")]
    public float moonIntensity = 0.55f;

    [Tooltip("Ambient light, filling the shadows. Keep it dim for night.")]
    public Color ambientColour = new Color(0.055f, 0.065f, 0.095f);

    [Tooltip("Fog colour, roughly the colour of the city glow on the horizon.")]
    public Color fogColour = new Color(0.035f, 0.045f, 0.065f);

    [Tooltip("Exponential-squared fog density. Higher = thicker. 0 disables fog.")]
    public float fogDensity = 0.012f;

    [Header("Camera")]
    public Color skyColour = new Color(0.012f, 0.016f, 0.03f);
    public float cameraFarPlane = 20000f;

    [Header("Weather")]
    [Tooltip("0 = bone dry, 1 = standing water. One number drives three things: the tyre " +
             "model's grip, the spray particles, and how the car sounds under load.")]
    [Range(0f, 1f)] public float wetness = 0f;

    [Header("Audio")]
    [Tooltip("Build the synthesised engine, tyre and wind audio. No audio files are used.")]
    public bool audioEnabled = true;

    [Tooltip("Master volume of the synthesised mix.")]
    [Range(0f, 1f)] public float audioGain = 0.32f;

    [Header("FX")]
    [Tooltip("Build the tyre smoke, wet spray and brake lights.")]
    public bool fxEnabled = true;

    [Header("Physics")]
    [Tooltip("Fixed physics step. 1/120 s keeps the tyre model stable at 300+ km/h.")]
    public float fixedTimeStep = 1f / 120f;

    /// <summary>The road this bootstrap created.</summary>
    public TDCProceduralRoad Road { get; private set; }

    /// <summary>The car this bootstrap created.</summary>
    public TDCPlayerCar Car { get; private set; }

    /// <summary>The chase camera this bootstrap created.</summary>
    public TDCChaseCamera CameraRig { get; private set; }

    /// <summary>The synthesised audio source this bootstrap created.</summary>
    public TDCEngineAudio EngineAudio { get; private set; }

    /// <summary>The particles and lights this bootstrap created.</summary>
    public TDCVehicleFX VehicleFX { get; private set; }

    void Awake()
    {
        ConfigurePhysics();
        ConfigureLighting();
        BuildRoad();
        BuildCar();
        BuildCamera();
        BuildAudio();
        BuildFx();
    }

    [ContextMenu("Rebuild Scene")]
    public void Rebuild()
    {
        for (int i = transform.childCount - 1; i >= 0; i--)
        {
            GameObject child = transform.GetChild(i).gameObject;

            if (Application.isPlaying) Destroy(child);
            else DestroyImmediate(child);
        }

        Road = null;
        Car = null;
        CameraRig = null;
        EngineAudio = null;
        VehicleFX = null;

        if (!Application.isPlaying)
        {
            // The camera and the light are not children, so they are handled here.
            DestroyExisting("TDC Camera");
            DestroyExisting("TDC Moon");
        }

        ConfigurePhysics();
        ConfigureLighting();
        BuildRoad();
        BuildCar();
        BuildCamera();
        BuildAudio();
        BuildFx();
    }

    void DestroyExisting(string objectName)
    {
        GameObject existing = GameObject.Find(objectName);
        if (existing == null) return;

        if (Application.isPlaying) Destroy(existing);
        else DestroyImmediate(existing);
    }

    void ConfigurePhysics()
    {
        // A 342 km/h car covers 0.95 m in a 1/60 s tick, which is most of a tyre
        // width. Halving the step keeps contact and slip angles well behaved.
        Time.fixedDeltaTime = Mathf.Clamp(fixedTimeStep, 0.001f, 0.05f);

        // Unity's gravity is already -9.81 on Y, which is what the SI tuning
        // assumes. Asserting it here so a stray change shows up as an obvious
        // handling difference rather than a mystery.
        Physics.gravity = new Vector3(0f, -9.81f, 0f);
    }

    void ConfigureLighting()
    {
        RenderSettings.ambientMode = UnityEngine.Rendering.AmbientMode.Flat;
        RenderSettings.ambientLight = ambientColour;

        RenderSettings.fog = fogDensity > 0f;
        RenderSettings.fogMode = FogMode.ExponentialSquared;
        RenderSettings.fogColor = fogColour;
        RenderSettings.fogDensity = fogDensity;

        var moonObject = new GameObject("TDC Moon");
        moonObject.transform.SetParent(transform, false);

        Light moon = moonObject.AddComponent<Light>();
        moon.type = LightType.Directional;
        moon.color = moonColour;
        moon.intensity = TDCMaterials.IsHDRP ? MoonIntensityForHDRP() : moonIntensity;
        moon.shadows = LightShadows.Soft;
        moonObject.transform.rotation = Quaternion.Euler(28f, 145f, 0f);
    }

    float MoonIntensityForHDRP()
    {
        // HDRP directional lights are measured in lux, and the physically correct
        // range is tiny at night. Scaled from the built-in default so that the
        // moonIntensity field still means "brighter or dimmer" in both pipelines.
        return moonIntensity * 9f;
    }

    void BuildRoad()
    {
        var roadObject = new GameObject("TDC Road");
        roadObject.transform.SetParent(transform, false);

        Road = roadObject.AddComponent<TDCProceduralRoad>();
        Road.shape = shape;
        Road.roadWidth = roadWidth;
        Road.circuitRadius = circuitRadius;
        Road.closedLoop = shape == TDCProceduralRoad.RoadShape.Circuit;

        MeshRenderer renderer = roadObject.GetComponent<MeshRenderer>();
        Material asphalt = TDCMaterials.WetAsphalt();
        if (asphalt != null) renderer.sharedMaterial = asphalt;

        if (shape == TDCProceduralRoad.RoadShape.Circuit) Road.BuildDefaultCircuit();
        else Road.BuildStraightRoad();

        // Distant sea of buildings is scenery: see REALISM_UNITY.md.
        BuildGroundPlane();
    }

    void BuildGroundPlane()
    {
        // A wide, dark apron so the car never falls off the edge of the world and
        // the fog has something to sit on. The road sits on top of it.
        var ground = GameObject.CreatePrimitive(PrimitiveType.Plane);
        ground.name = "TDC Ground";
        ground.transform.SetParent(transform, false);
        ground.transform.localScale = new Vector3(circuitRadius * 0.06f, 1f, circuitRadius * 0.06f);
        ground.transform.localPosition = new Vector3(0f, -0.25f, 0f);

        Material material = TDCMaterials.CreateLit(
            "TDC Ground", new Color(0.02f, 0.021f, 0.024f), 0.2f, 0f);
        if (material != null) ground.GetComponent<MeshRenderer>().sharedMaterial = material;
    }

    void BuildCar()
    {
        // Created inactive so the colour is set before Awake runs and builds the
        // placeholder body. AddComponent on an active object would run Awake
        // immediately, before any field could be assigned.
        var carObject = new GameObject("TDC Car");
        carObject.SetActive(false);
        carObject.transform.SetParent(transform, false);

        Car = carObject.AddComponent<TDCPlayerCar>();
        Car.placeholderCarColour = carColour;

        // Set before the object is activated, so the tyre model and the spray
        // particles agree from the first frame.
        Car.wetness = wetness;
        carObject.SetActive(true);

        // Start on the centreline, pointing along the track.
        Vector3 position;
        Vector3 tangent;
        Road.SampleCenterline(0f, out position, out tangent);
        if (tangent.sqrMagnitude < 1e-6f) tangent = Vector3.forward;

        Car.SetSpawn(
            position + Vector3.up * carSpawnHeight,
            Quaternion.LookRotation(tangent, Vector3.up));
    }

    void BuildCamera()
    {
        // Reuse the scene's main camera if there is one, so this does not fight
        // with an existing rig.
        Camera camera = Camera.main;
        GameObject cameraObject;

        if (camera != null && camera.GetComponent<TDCChaseCamera>() == null)
        {
            cameraObject = camera.gameObject;
        }
        else
        {
            cameraObject = new GameObject("TDC Camera");
            cameraObject.transform.SetParent(transform, false);
            camera = cameraObject.AddComponent<Camera>();
        }

        camera.clearFlags = CameraClearFlags.SolidColor;
        camera.backgroundColor = skyColour;
        camera.allowHDR = true;
        camera.nearClipPlane = 0.3f;
        camera.farClipPlane = cameraFarPlane;
        cameraObject.tag = "MainCamera";

        CameraRig = cameraObject.GetComponent<TDCChaseCamera>();
        if (CameraRig == null) CameraRig = cameraObject.AddComponent<TDCChaseCamera>();

        // Keep the camera's speed blend in step with the car's top speed.
        CameraRig.referenceTopSpeedKmh = Car.maxSpeedKmh;
        CameraRig.SetTarget(Car.transform, true);
    }

    void BuildAudio()
    {
        if (!audioEnabled) return;

        var audioObject = new GameObject("TDC Engine Audio");
        audioObject.transform.SetParent(transform, false);

        // TDCEngineAudio requires an AudioSource, which Unity adds automatically
        // from the RequireComponent attribute.
        EngineAudio = audioObject.AddComponent<TDCEngineAudio>();
        EngineAudio.car = Car;
        EngineAudio.masterGain = audioGain;
    }

    void BuildFx()
    {
        if (!fxEnabled) return;

        var fxObject = new GameObject("TDC Vehicle FX");
        fxObject.transform.SetParent(transform, false);

        VehicleFX = fxObject.AddComponent<TDCVehicleFX>();
        VehicleFX.car = Car;
        VehicleFX.wetness = wetness;
    }
}
