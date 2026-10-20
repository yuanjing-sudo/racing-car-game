using UnityEngine;
using UnityEngine.Rendering;

/// <summary>
/// Rubber laid down by the rear tyres, built from code like everything else here.
///
/// One <see cref="Mesh"/> with a fixed budget of quads, written as a ring buffer:
/// each new segment overwrites the oldest quad once the buffer is full. That is
/// one draw call for the whole trail and no per-mark GameObjects, which is why it
/// is cheap enough to keep on while the car is sliding at 300 km/h.
///
/// What drives it:
///   rear slip angle  <see cref="TDCPlayerCar.RearSlipAngleDeg"/> above minSlipDegrees,
///                    so a handbrake slide marks the road;
///   combined slip    <see cref="TDCPlayerCar.TyreSlip01"/> above minSlip01, which
///                    catches wheelspin on a straight line where the slip angle
///                    is nearly zero;
///   speed            above minSpeedKmh, so parking-lot pivots leave nothing.
///
/// A new quad is written every segmentSpacing metres of travel. The mesh is
/// marked dynamic and its bounds are set once to a box large enough for the whole
/// circuit, so writing a segment never triggers a bounds recalculation.
/// </summary>
[AddComponentMenu("Tokyo Dream Circuit/Skid Marks")]
public class TDCSkidMarks : MonoBehaviour
{
    [Header("Source")]
    [Tooltip("The car to read telemetry and wheel positions from.")]
    public TDCPlayerCar car;

    [Header("Pool")]
    [Tooltip("Quads in the ring buffer. 800 at 0.55 m spacing covers about 440 m of " +
             "sliding; older marks are overwritten first.")]
    [Range(16, 4000)] public int maxSegments = 800;

    [Tooltip("Metres between the centres of successive quads. Smaller = smoother curves " +
             "and a shorter total trail for the same budget.")]
    [Range(0.05f, 3f)] public float segmentSpacing = 0.55f;

    [Tooltip("Tyre width in metres.")]
    [Range(0.02f, 1f)] public float markWidth = 0.26f;

    [Tooltip("Metres above the contact patch. The patch is 2 cm under the body's " +
             "underside, so 4 cm puts rubber 2 cm over the road.")]
    [Range(0f, 0.2f)] public float markLift = 0.04f;

    [Header("Trigger")]
    [Range(0f, 60f)] public float minSlipDegrees = 9f;

    [Range(0f, 1f)] public float minSlip01 = 0.32f;

    public float minSpeedKmh = 40f;

    [Header("Look")]
    public Color rubberColour = new Color(0.018f, 0.018f, 0.02f, 1f);

    [Tooltip("Wet rubber is thinner and greyer, so the marks fade out as wetness rises.")]
    [Range(0f, 1f)] public float wetWidthLoss = 0.45f;

    Mesh mesh;
    Material material;
    Vector3[] vertices;
    Vector3[] normals;
    int[] triangles;

    /// <summary>Last written point for each rear wheel (0 = left, 1 = right).</summary>
    readonly Vector3[] lastPoint = new Vector3[2];
    readonly bool[] hasLast = new bool[2];

    int nextQuad;

    void Awake()
    {
        BuildMesh();
    }

    void OnDestroy()
    {
        if (mesh != null) Destroy(mesh);
        if (material != null) Destroy(material);
    }

    void BuildMesh()
    {
        maxSegments = Mathf.Clamp(maxSegments, 16, 4000);

        mesh = new Mesh { name = "TDC Skid Marks" };
        mesh.MarkDynamic();

        vertices = new Vector3[maxSegments * 4];
        normals = new Vector3[maxSegments * 4];
        triangles = new int[maxSegments * 6];

        for (int i = 0; i < normals.Length; i++) normals[i] = Vector3.up;

        for (int quad = 0; quad < maxSegments; quad++)
        {
            int v = quad * 4;
            int t = quad * 6;

            // Unity treats clockwise winding, seen from the front, as visible.
            // This order gives each quad a +Y normal.
            triangles[t + 0] = v + 0;
            triangles[t + 1] = v + 2;
            triangles[t + 2] = v + 1;
            triangles[t + 3] = v + 0;
            triangles[t + 4] = v + 3;
            triangles[t + 5] = v + 2;
        }

        mesh.vertices = vertices;
        mesh.normals = normals;
        mesh.triangles = triangles;

        // A fixed, generous box: the circuit is 1.2 km across, and a 20 km box
        // means we never pay for RecalculateBounds as the trail grows.
        mesh.bounds = new Bounds(Vector3.zero, new Vector3(20000f, 2000f, 20000f));

        material = TDCMaterials.CreateLit("TDC Skid Marks", rubberColour, 0.12f, 0f);

        var renderer = gameObject.AddComponent<MeshRenderer>();
        renderer.shadowCastingMode = ShadowCastingMode.Off;
        renderer.receiveShadows = false;
        if (material != null) renderer.sharedMaterial = material;

        gameObject.AddComponent<MeshFilter>().sharedMesh = mesh;

        nextQuad = 0;
    }

    void Update()
    {
        if (car == null || mesh == null) return;

        bool sliding =
            Mathf.Abs(car.RearSlipAngleDeg) > minSlipDegrees ||
            car.TyreSlip01 > minSlip01;
        bool marking = sliding && car.AbsoluteSpeedKmh > minSpeedKmh;

        for (int side = 0; side < 2; side++)
        {
            int wheel = side + 2; // 2 = rear left, 3 = rear right
            Vector3 contact = car.GetWheelContactPoint(wheel) + Vector3.up * markLift;

            if (!marking)
            {
                hasLast[side] = false;
                continue;
            }

            if (!hasLast[side])
            {
                lastPoint[side] = contact;
                hasLast[side] = true;
                continue;
            }

            Vector3 previous = lastPoint[side];
            Vector3 flat = contact - previous;
            flat.y = 0f;

            if (flat.magnitude < segmentSpacing) continue;

            WriteSegment(previous, contact);
            lastPoint[side] = contact;
        }
    }

    void WriteSegment(Vector3 a, Vector3 b)
    {
        Vector3 delta = b - a;
        delta.y = 0f;

        float length = delta.magnitude;
        if (length < 0.05f) return;

        Vector3 direction = delta / length;
        float width = markWidth * Mathf.Lerp(1f, 1f - wetWidthLoss, car != null ? car.wetness : 0f);
        Vector3 right = Vector3.Cross(Vector3.up, direction) * (width * 0.5f);

        int v = nextQuad * 4;

        vertices[v + 0] = a - right;
        vertices[v + 1] = a + right;
        vertices[v + 2] = b + right;
        vertices[v + 3] = b - right;

        mesh.vertices = vertices;

        nextQuad++;
        if (nextQuad >= maxSegments) nextQuad = 0;
    }

    /// <summary>Wipe every mark and start the ring buffer again.</summary>
    public void ClearMarks()
    {
        if (mesh == null) return;

        for (int i = 0; i < vertices.Length; i++) vertices[i] = Vector3.zero;
        mesh.vertices = vertices;

        nextQuad = 0;
        hasLast[0] = false;
        hasLast[1] = false;
    }
}
