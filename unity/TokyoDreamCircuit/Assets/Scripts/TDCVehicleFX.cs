using UnityEngine;
using UnityEngine.Rendering;

/// <summary>
/// Tyre smoke, wet spray and brake lights, all built from code.
///
/// Nothing here loads an asset. The particle texture is a soft radial puff
/// generated at runtime by <see cref="TDCMaterials.CreatePuffTexture"/>, which is
/// why the smoke reads as smoke rather than as squares, and the emitters are
/// ordinary <see cref="ParticleSystem"/> components so no shader graph work is
/// needed.
///
/// What drives each effect:
///   smoke         <see cref="TDCPlayerCar.TyreSlip01"/>, so it appears when the
///                 tyres are actually sliding rather than whenever the throttle
///                 is down
///   spray         wetness x speed: standing water thrown off the tyres, which is
///                 the whole visual point of a wet track
///   brake lights  <see cref="TDCPlayerCar.BrakeInput"/>
///
/// Skid marks are deliberately not here. They need either a decal projector or a
/// ribbon mesh with its own ring buffer, which is a bigger piece of work than the
/// rest of this file put together.
/// </summary>
[AddComponentMenu("Tokyo Dream Circuit/Vehicle FX")]
public class TDCVehicleFX : MonoBehaviour
{
    // ---------------------------------------------------------------------
    // Source
    // ---------------------------------------------------------------------

    [Header("Source")]
    [Tooltip("The car to read telemetry from.")]
    public TDCPlayerCar car;

    [Tooltip("How much water is on the track, 0..1. Blends the spray in. The bootstrap " +
             "drives this from the same number the car's tyre model uses.")]
    [Range(0f, 1f)] public float wetness = 0f;

    // ---------------------------------------------------------------------
    // Tyre smoke
    // ---------------------------------------------------------------------

    [Header("Tyre smoke")]
    public bool smokeEnabled = true;

    [Tooltip("Slip below which no smoke is emitted, 0..1.")]
    [Range(0f, 1f)] public float smokeThreshold = 0.16f;

    [Tooltip("A pale grey reads as tyre smoke; a burnt-orange tint reads as a burnout.")]
    public Color smokeColour = new Color(0.72f, 0.71f, 0.70f, 0.34f);

    [Tooltip("Particles per wheel emitter. Allocated up front, so this is a memory cost " +
             "as well as a visual one.")]
    [Range(8, 256)] public int smokeBudget = 64;

    public float smokeLifetime = 1.6f;
    public float smokeSize = 0.55f;

    [Tooltip("Slip at which smoke reaches full density.")]
    [Range(0.1f, 1f)] public float smokeFullSlip = 0.6f;

    // ---------------------------------------------------------------------
    // Wet spray
    // ---------------------------------------------------------------------

    [Header("Wet spray")]
    public bool sprayEnabled = true;

    [Range(8, 512)] public int sprayBudget = 192;
    public Color sprayColour = new Color(0.80f, 0.85f, 0.92f, 0.22f);
    public float sprayLifetime = 0.9f;

    // ---------------------------------------------------------------------
    // Brake lights
    // ---------------------------------------------------------------------

    [Header("Brake lights")]
    public bool brakeLightsEnabled = true;

    [Tooltip("Emission strength while braking. Over 1 so it blooms under HDRP.")]
    public float brakeEmissionEnergy = 5f;

    public Color brakeColour = new Color(1f, 0.08f, 0.06f);

    // ---------------------------------------------------------------------

    readonly ParticleSystem[] smoke = new ParticleSystem[4];
    ParticleSystem spray;
    readonly Material[] brakeMaterials = new Material[2];
    readonly string[] brakeEmissionProperty = new string[2];

    void Awake()
    {
        if (car == null) car = GetComponentInParent<TDCPlayerCar>();
        if (car == null)
        {
            Debug.LogWarning("TDCVehicleFX: no car assigned, nothing to emit from", this);
            return;
        }

        Material puffMaterial = TDCMaterials.CreateParticle("TDC Puff", Color.white);

        if (smokeEnabled)
        {
            if (puffMaterial != null) BuildSmoke(puffMaterial);
            else Debug.LogWarning("TDCVehicleFX: no particle shader found, smoke disabled", this);
        }

        if (sprayEnabled)
        {
            if (puffMaterial != null) BuildSpray(puffMaterial);
            else Debug.LogWarning("TDCVehicleFX: no particle shader found, spray disabled", this);
        }

        if (brakeLightsEnabled) BuildBrakeLights();
    }

    void Update()
    {
        if (car == null) return;

        UpdateSmoke();
        UpdateSpray();
        UpdateBrakeLights();
    }

    // ---------------------------------------------------------------------
    // Smoke
    // ---------------------------------------------------------------------

    void BuildSmoke(Material puffMaterial)
    {
        float halfTrack = car.trackWidth * 0.5f;
        float halfBase = car.wheelBase * 0.5f;

        for (int i = 0; i < 4; i++)
        {
            var go = new GameObject("TyreSmoke" + i);
            go.transform.SetParent(transform, false);

            ParticleSystem system = go.AddComponent<ParticleSystem>();

            // World simulation space, so the smoke stays where it was made and the
            // car drives out of it. In local space it would follow the wheels,
            // which looks like fog attached to the tyres.
            ParticleSystem.MainModule main = system.main;
            main.loop = true;
            main.simulationSpace = ParticleSystemSimulationSpace.World;
            main.startLifetime = smokeLifetime;
            main.startSpeed = 1.5f;
            main.startSize = smokeSize;
            main.startColor = smokeColour;
            main.maxParticles = smokeBudget;
            main.gravityModifier = -0.02f;   // negative gravity: the smoke rises

            ParticleSystem.EmissionModule emission = system.emission;
            emission.rateOverTime = 0f;

            ParticleSystem.ShapeModule shape = system.shape;
            shape.shapeType = ParticleSystemShapeType.Cone;
            shape.angle = 38f;
            shape.radius = 0.1f;

            // Grow over the particle's life. A puff that does not expand reads as
            // a bag of marbles rather than smoke.
            var growth = new AnimationCurve();
            growth.AddKey(0f, 0.35f);
            growth.AddKey(1f, 1.7f);

            ParticleSystem.SizeOverLifetimeModule sizeOverLife = system.sizeOverLifetime;
            sizeOverLife.enabled = true;
            sizeOverLife.size = new ParticleSystem.MinMaxCurve(1f, growth);

            ParticleSystemRenderer renderer = go.GetComponent<ParticleSystemRenderer>();
            renderer.renderMode = ParticleSystemRenderMode.Billboard;
            renderer.material = puffMaterial;
            renderer.shadowCastingMode = ShadowCastingMode.Off;
            renderer.receiveShadows = false;

            system.Play();

            // Park it on the wheel for now; UpdateSmoke moves it every frame.
            bool isLeft = i == 0 || i == 2;
            bool isFront = i < 2;
            go.transform.position = car.transform.TransformPoint(new Vector3(
                isLeft ? -halfTrack : halfTrack,
                car.wheelRadius - car.placeholderBodySize.y * 0.5f,
                isFront ? halfBase : -halfBase));

            smoke[i] = system;
        }
    }

    void UpdateSmoke()
    {
        if (smoke[0] == null) return;

        float slip = car.TyreSlip01;

        // Smoke is emitted on slip, not on speed: a car crawling sideways on the
        // handbrake smokes, a car at 300 km/h in a straight line does not.
        bool emitting = slip > smokeThreshold && car.AbsoluteSpeedKmh > 4f;

        float intensity = emitting
            ? Mathf.Clamp01((slip - smokeThreshold) / Mathf.Max(0.001f, smokeFullSlip - smokeThreshold))
            : 0f;

        for (int i = 0; i < 4; i++)
        {
            ParticleSystem system = smoke[i];
            if (system == null) continue;

            if (emitting)
            {
                system.transform.position = car.GetWheelContactPoint(i) + Vector3.up * 0.08f;
            }

            ParticleSystem.EmissionModule emission = system.emission;
            emission.rateOverTime = emitting ? intensity * 45f : 0f;

            ParticleSystem.MainModule main = system.main;
            main.startSpeed = 1.2f + intensity * 3f;
            main.startColor = new Color(
                smokeColour.r, smokeColour.g, smokeColour.b,
                smokeColour.a * (0.45f + 0.55f * intensity));

            if (!system.isPlaying) system.Play();
        }
    }

    // ---------------------------------------------------------------------
    // Spray
    // ---------------------------------------------------------------------

    void BuildSpray(Material puffMaterial)
    {
        var go = new GameObject("WetSpray");
        go.transform.SetParent(transform, false);

        spray = go.AddComponent<ParticleSystem>();

        ParticleSystem.MainModule main = spray.main;
        main.loop = true;
        main.simulationSpace = ParticleSystemSimulationSpace.World;
        main.startLifetime = sprayLifetime;
        main.startSpeed = 4f;
        main.startSize = 0.3f;
        main.startColor = sprayColour;
        main.maxParticles = sprayBudget;
        main.gravityModifier = 0.6f;   // spray is thrown up and then falls

        ParticleSystem.EmissionModule emission = spray.emission;
        emission.rateOverTime = 0f;

        ParticleSystem.ShapeModule shape = spray.shape;
        shape.shapeType = ParticleSystemShapeType.Cone;
        shape.angle = 42f;
        shape.radius = 0.3f;
        shape.rotation = new Vector3(15f, 0f, 0f);

        ParticleSystemRenderer renderer = go.GetComponent<ParticleSystemRenderer>();
        renderer.renderMode = ParticleSystemRenderMode.Billboard;
        renderer.material = puffMaterial;
        renderer.shadowCastingMode = ShadowCastingMode.Off;
        renderer.receiveShadows = false;

        spray.Play();
    }

    void UpdateSpray()
    {
        if (spray == null) return;

        // Only a wet track throws water, and only once you are moving.
        float wetFactor = Mathf.Clamp01(wetness) * Mathf.Clamp01(car.Speed01 * 1.6f);

        spray.transform.position = car.transform.position + Vector3.up * 0.25f;

        ParticleSystem.EmissionModule emission = spray.emission;
        emission.rateOverTime = wetFactor * 220f;

        ParticleSystem.MainModule main = spray.main;
        main.startColor = new Color(
            sprayColour.r, sprayColour.g, sprayColour.b, sprayColour.a * wetFactor);
        main.startSpeed = 3f + 9f * car.Speed01;

        if (wetFactor > 0.05f && !spray.isPlaying) spray.Play();
    }

    // ---------------------------------------------------------------------
    // Brake lights
    // ---------------------------------------------------------------------

    void BuildBrakeLights()
    {
        // Unity's forward is +Z, so the rear of the car is -Z.
        float halfLength = car.placeholderBodySize.z * 0.5f;
        float halfWidth = car.placeholderBodySize.x * 0.5f;
        float height = car.placeholderBodySize.y * 0.5f - 0.12f;

        // Parented to the car root, not to the body mesh: in the Unity version the
        // placeholder body is a scaled cube, and children would inherit that
        // non-uniform scale and come out squashed.
        int index = 0;
        for (int side = -1; side <= 1; side += 2)
        {
            GameObject lens = GameObject.CreatePrimitive(PrimitiveType.Quad);
            lens.name = "BrakeLight" + (side < 0 ? "L" : "R");
            lens.transform.SetParent(car.transform, false);

            // The car's own rigid body handles collision; the quad's collider would
            // be a stray box hanging off the back.
            Collider created = lens.GetComponent<Collider>();
            if (created != null) Destroy(created);

            lens.transform.localPosition = new Vector3(
                side * halfWidth * 0.62f, height, -(halfLength + 0.01f));

            // A Unity quad faces +Z. Turning it around makes it visible from a
            // camera behind the car.
            lens.transform.localRotation = Quaternion.Euler(0f, 180f, 0f);
            lens.transform.localScale = new Vector3(
                car.placeholderBodySize.x * 0.30f, 0.16f, 1f);

            Material material = TDCMaterials.CreateLit(
                "TDC Brake Light", new Color(brakeColour.r * 0.25f, 0.02f, 0.02f), 0.6f, 0f);

            if (material != null)
            {
                brakeEmissionProperty[index] = TDCMaterials.EnableEmission(material, brakeColour);
                lens.GetComponent<MeshRenderer>().sharedMaterial = material;
                brakeMaterials[index] = material;
            }

            index++;
        }
    }

    void UpdateBrakeLights()
    {
        if (brakeMaterials[0] == null) return;

        // Tail lights are dimly on whenever the car is running; braking lights them
        // properly. That distinction is what makes it read as a brake light.
        float energy = 0.35f + (brakeEmissionEnergy - 0.35f) * Mathf.Clamp01(car.BrakeInput);
        Color lit = new Color(
            brakeColour.r * energy, brakeColour.g * energy, brakeColour.b * energy, 1f);

        for (int i = 0; i < brakeMaterials.Length; i++)
        {
            string property = brakeEmissionProperty[i];
            if (brakeMaterials[i] != null && !string.IsNullOrEmpty(property))
            {
                brakeMaterials[i].SetColor(property, lit);
            }
        }
    }
}
