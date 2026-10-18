using System.Collections.Generic;
using UnityEngine;

/// <summary>
/// Generates a drivable road surface as a procedural mesh, swept along a
/// centreline, with a mesh collider for physics.
///
/// Three ways to use it, all of them live:
///
///   BuildDefaultCircuit()  a closed loop with no self-intersections.
///   BuildStraightRoad()    a long open road along +Z, built from roadLength,
///                          curveAmplitude and elevationAmplitude.
///   Edit the centreline    assign controlPoints by hand and press Rebuild;
///                          whatever you author is what gets swept.
///
/// Banking comes from the real curvature of the road rather than being dialled
/// in per sample, and is clamped to bankDegrees, so corners lean the right way
/// on their own.
///
/// Everything is in metres. Unreal's starter used centimetres; the port map in
/// README.md lists the conversions.
/// </summary>
[ExecuteAlways]
[AddComponentMenu("Tokyo Dream Circuit/Procedural Road")]
[RequireComponent(typeof(MeshFilter), typeof(MeshRenderer), typeof(MeshCollider))]
public class TDCProceduralRoad : MonoBehaviour
{
    public enum RoadShape
    {
        Straight,
        Circuit
    }

    /// <summary>
    /// One point of the road cross-section. lateralFraction is normalised so the
    /// profile scales with roadWidth: -0.5 is the left edge, +0.5 the right edge,
    /// 0 the centreline. heightOffset is in metres, negative is below.
    /// </summary>
    [System.Serializable]
    public struct ProfilePoint
    {
        [Tooltip("-0.5 = left edge, +0.5 = right edge, 0 = centreline. Scaled by road width.")]
        public float lateralFraction;

        [Tooltip("Height in metres. Negative is below the centreline.")]
        public float heightOffset;

        public ProfilePoint(float inLateralFraction, float inHeightOffset)
        {
            lateralFraction = inLateralFraction;
            heightOffset = inHeightOffset;
        }
    }

    // ---------------------------------------------------------------------
    // Shape
    // ---------------------------------------------------------------------

    [Header("Shape")]
    [Tooltip("Total width of the road surface, in metres.")]
    public float roadWidth = 12f;

    [Tooltip("Number of segments along the swept mesh. Higher = smoother, more triangles.")]
    public int segments = 512;

    [Tooltip("Extra subdivision between each pair of profile points, across the road.")]
    public int lateralSubdivisions = 4;

    [Tooltip("How far the surface texture repeats along the road, in metres.")]
    public float uvTiling = 12f;

    [Tooltip("Cross-section, left edge (-0.5) to right edge (+0.5). The default crowns the " +
             "middle of the road so water drains to the sides.")]
    public List<ProfilePoint> profile = new List<ProfilePoint>();

    [Tooltip("Closed circuit (true) or a length of open road (false).")]
    public bool closedLoop = true;

    [Tooltip("Flip the triangle winding if the road renders inside-out or unlit.")]
    public bool flipWinding = false;

    // ---------------------------------------------------------------------
    // Banking
    // ---------------------------------------------------------------------

    [Header("Banking")]
    [Tooltip("Hard limit on bank angle, in degrees. The road rolls into corners up to this much, " +
             "and the roll comes from the measured curvature.")]
    public float bankDegrees = 12f;

    [Tooltip("How strongly curvature rolls the road, in metres. Larger = reaches bankDegrees on " +
             "gentler curves.")]
    public float bankingScale = 40f;

    // ---------------------------------------------------------------------
    // Generators
    // ---------------------------------------------------------------------

    [Header("Generator")]
    public RoadShape shape = RoadShape.Circuit;

    [Tooltip("Length of the generated open road, in metres.")]
    public float roadLength = 180f;

    [Tooltip("Distance between control points on the generated open road, in metres.")]
    public float sampleSpacing = 1f;

    [Tooltip("Lateral wander of the generated open road, in metres.")]
    public float curveAmplitude = 17f;

    [Tooltip("Vertical amplitude of the generated open road, in metres.")]
    public float elevationAmplitude = 9f;

    [Tooltip("Rough radius of the generated circuit, in metres.")]
    public float circuitRadius = 600f;

    [Tooltip("Number of control points in the generated circuit.")]
    public int circuitPoints = 28;

    [Tooltip("0 = perfect circle, 1 = very twisty. Drives the harmonic sum.")]
    [Range(0f, 1f)]
    public float curvature = 0.28f;

    [Tooltip("Randomisation seed for the generated circuit.")]
    public int circuitSeed = 1337;

    // ---------------------------------------------------------------------
    // State
    // ---------------------------------------------------------------------

    [Header("Result")]
    [Tooltip("Total length of the centreline, in metres. Updated on rebuild.")]
    [SerializeField] float trackLength;

    /// <summary>Total length of the centreline, in metres.</summary>
    public float TrackLength { get { return trackLength; } }

    /// <summary>
    /// Control points the last build swept. Settable so you can author a road by
    /// hand and call Rebuild().
    /// </summary>
    public List<Vector3> controlPoints = new List<Vector3>();

    readonly List<Vector3> centreline = new List<Vector3>();
    readonly List<float> cumulative = new List<float>();
    readonly List<ProfilePoint> crossSection = new List<ProfilePoint>();

    Mesh mesh;

    // ---------------------------------------------------------------------
    // Unity lifecycle
    // ---------------------------------------------------------------------

    void Reset()
    {
        ApplyDefaultProfile();
    }

    void OnEnable()
    {
        EnsureProfile();
        Rebuild();
    }

    void OnValidate()
    {
        // Live update while dragging sliders in the inspector.
        segments = Mathf.Max(2, segments);
        lateralSubdivisions = Mathf.Max(1, lateralSubdivisions);
        roadWidth = Mathf.Max(0.1f, roadWidth);
        circuitPoints = Mathf.Max(8, circuitPoints);

        EnsureProfile();
        if (isActiveAndEnabled) Rebuild();
    }

    void OnDestroy()
    {
        ReleaseMesh();
    }

    void ApplyDefaultProfile()
    {
        profile = new List<ProfilePoint>
        {
            // A gentle crown: the middle of the road sits 4 cm proud of the
            // edges, which is what real roads do for drainage.
            new ProfilePoint(-0.5f, -0.04f),
            new ProfilePoint(-0.25f, -0.01f),
            new ProfilePoint(0f, 0f),
            new ProfilePoint(0.25f, -0.01f),
            new ProfilePoint(0.5f, -0.04f)
        };
    }

    void EnsureProfile()
    {
        if (profile == null || profile.Count < 2)
        {
            ApplyDefaultProfile();
        }
    }

    // ---------------------------------------------------------------------
    // Generators
    // ---------------------------------------------------------------------

    /// <summary>
    /// Regenerate the road mesh from the current centreline and settings.
    /// </summary>
    [ContextMenu("Rebuild Road")]
    public void Rebuild()
    {
        EnsureProfile();

        if (controlPoints == null || controlPoints.Count < 2)
        {
            GenerateControlPoints();
        }

        BuildCentreline();
        BuildMesh();
    }

    /// <summary>
    /// Discard the centreline and generate the open road described by roadLength,
    /// curveAmplitude and elevationAmplitude. This is the starter layout: a road
    /// running along +Z that wanders laterally and rises and falls, both as smooth
    /// sine functions of distance so the curve is continuous and has no kinks.
    /// </summary>
    [ContextMenu("Build Straight Road")]
    public void BuildStraightRoad()
    {
        shape = RoadShape.Straight;
        closedLoop = false;
        GenerateControlPoints();
        Rebuild();
    }

    /// <summary>
    /// Discard the centreline and generate a fresh closed circuit.
    /// </summary>
    [ContextMenu("Build Default Circuit")]
    public void BuildDefaultCircuit()
    {
        shape = RoadShape.Circuit;
        closedLoop = true;
        GenerateControlPoints();
        Rebuild();
    }

    void GenerateControlPoints()
    {
        controlPoints = new List<Vector3>();

        if (shape == RoadShape.Circuit)
        {
            int count = Mathf.Max(8, circuitPoints);
            var random = new System.Random(circuitSeed);
            float phase3 = (float)random.NextDouble() * Mathf.PI * 2f;
            float phase5 = (float)random.NextDouble() * Mathf.PI * 2f;
            float phaseY = (float)random.NextDouble() * Mathf.PI * 2f;

            for (int i = 0; i < count; i++)
            {
                float angle = 2f * Mathf.PI * i / count;

                // Integer harmonics keep the loop seamless and prevent the
                // self-intersection and zero-radius cusps you get from arbitrary
                // wiggles.
                float radius = circuitRadius;
                radius += circuitRadius * curvature * Mathf.Sin(3f * angle + phase3);
                radius += circuitRadius * 0.5f * curvature * Mathf.Sin(5f * angle + phase5);

                float y = elevationAmplitude * Mathf.Sin(2f * angle + phaseY)
                        + elevationAmplitude * 0.35f * Mathf.Sin(4f * angle);

                controlPoints.Add(new Vector3(
                    Mathf.Cos(angle) * radius,
                    y,
                    Mathf.Sin(angle) * radius));
            }

            return;
        }

        // Open road. The starter used 100 cm sample spacing over 18000 cm; that
        // is 1 m over 180 m here.
        int steps = Mathf.Max(20, Mathf.CeilToInt(roadLength / Mathf.Max(0.1f, sampleSpacing)));
        for (int i = 0; i <= steps; i++)
        {
            float distance = roadLength * i / steps;
            float t = distance / Mathf.Max(0.1f, roadLength) * 2f * Mathf.PI;

            float x = curveAmplitude * 0.45f * Mathf.Sin(t);
            float y = elevationAmplitude * Mathf.Sin(t)
                    + elevationAmplitude * 0.24f * Mathf.Sin(2f * t + 0.6f);

            controlPoints.Add(new Vector3(x, y, distance));
        }
    }

    // ---------------------------------------------------------------------
    // Centreline
    // ---------------------------------------------------------------------

    void BuildCentreline()
    {
        centreline.Clear();
        cumulative.Clear();

        int count = controlPoints.Count;
        if (count < 2)
        {
            trackLength = 0f;
            return;
        }

        // Dense, smooth path through the control points. Catmull-Rom passes
        // through every control point, which a bezier does not, so the road stays
        // where you put it.
        int subdivisions = Mathf.Max(2, segments / count);
        int segmentCount = closedLoop ? count : count - 1;

        for (int i = 0; i < segmentCount; i++)
        {
            Vector3 p0 = controlPoints[WrapIndex(i - 1, count)];
            Vector3 p1 = controlPoints[WrapIndex(i, count)];
            Vector3 p2 = controlPoints[WrapIndex(i + 1, count)];
            Vector3 p3 = controlPoints[WrapIndex(i + 2, count)];

            for (int s = 0; s < subdivisions; s++)
            {
                float t = (float)s / subdivisions;
                centreline.Add(CatmullRom(p0, p1, p2, p3, t));
            }
        }

        if (!closedLoop)
        {
            centreline.Add(controlPoints[count - 1]);
        }

        // Arc length table, so the mesh can be swept at even spacing regardless
        // of how the control points are distributed.
        cumulative.Add(0f);
        float total = 0f;
        for (int i = 1; i < centreline.Count; i++)
        {
            total += Vector3.Distance(centreline[i - 1], centreline[i]);
            cumulative.Add(total);
        }

        trackLength = total;
    }

    int WrapIndex(int index, int count)
    {
        if (closedLoop) return ((index % count) + count) % count;
        return Mathf.Clamp(index, 0, count - 1);
    }

    static Vector3 CatmullRom(Vector3 p0, Vector3 p1, Vector3 p2, Vector3 p3, float t)
    {
        float t2 = t * t;
        float t3 = t2 * t;

        return 0.5f * (
            2f * p1 +
            (-p0 + p2) * t +
            (2f * p0 - 5f * p1 + 4f * p2 - p3) * t2 +
            (-p0 + 3f * p1 - 3f * p2 + p3) * t3);
    }

    // ---------------------------------------------------------------------
    // Sampling
    // ---------------------------------------------------------------------

    /// <summary>Position on the centreline at a given distance along it.</summary>
    public Vector3 SamplePoint(float distance)
    {
        int count = centreline.Count;
        if (count == 0) return Vector3.zero;
        if (count == 1) return centreline[0];

        distance = closedLoop
            ? Mathf.Repeat(distance, Mathf.Max(0.0001f, trackLength))
            : Mathf.Clamp(distance, 0f, trackLength);

        int lo = 0;
        int hi = count - 1;
        while (lo < hi - 1)
        {
            int mid = (lo + hi) / 2;
            if (cumulative[mid] <= distance) lo = mid;
            else hi = mid;
        }

        float spanLength = cumulative[hi] - cumulative[lo];
        float t = spanLength > 1e-6f ? (distance - cumulative[lo]) / spanLength : 0f;
        return Vector3.Lerp(centreline[lo], centreline[hi], t);
    }

    /// <summary>Unit tangent on the centreline at a given distance along it.</summary>
    public Vector3 SampleTangent(float distance)
    {
        float step = Mathf.Max(0.01f, trackLength / Mathf.Max(2, segments) * 0.5f);
        Vector3 ahead = SamplePoint(distance + step);
        Vector3 behind = SamplePoint(distance - step);

        Vector3 tangent = ahead - behind;
        if (tangent.sqrMagnitude < 1e-8f) tangent = Vector3.forward;
        return tangent.normalized;
    }

    /// <summary>
    /// Position and tangent on the centreline. Useful for placing cars, cameras
    /// and scenery, and for lap logic.
    /// </summary>
    public void SampleCenterline(float distance, out Vector3 position, out Vector3 tangent)
    {
        position = SamplePoint(distance);
        tangent = SampleTangent(distance);
    }

    /// <summary>
    /// Project a world position onto the centreline. outDistanceAlong is metres
    /// along the track, outLateralOffset is signed metres, positive to the right
    /// of the centreline.
    /// </summary>
    public void ProjectOntoTrack(Vector3 worldPosition, out float outDistanceAlong, out float outLateralOffset)
    {
        outDistanceAlong = 0f;
        outLateralOffset = 0f;

        if (centreline.Count < 2) return;

        // Coarse search for the nearest sampled point, then a local refinement.
        int bestIndex = 0;
        float bestSqrDistance = float.MaxValue;
        for (int i = 0; i < centreline.Count; i++)
        {
            float sqr = (centreline[i] - worldPosition).sqrMagnitude;
            if (sqr < bestSqrDistance)
            {
                bestSqrDistance = sqr;
                bestIndex = i;
            }
        }

        outDistanceAlong = cumulative[bestIndex];
        Vector3 tangent = SampleTangent(outDistanceAlong);
        Vector3 right = Vector3.Cross(Vector3.up, tangent).normalized;
        outLateralOffset = Vector3.Dot(worldPosition - centreline[bestIndex], right);
    }

    // ---------------------------------------------------------------------
    // Mesh
    // ---------------------------------------------------------------------

    void BuildMesh()
    {
        if (centreline.Count < 2 || trackLength <= 1e-4f) return;

        BuildCrossSection();
        int crossCount = crossSection.Count;
        if (crossCount < 2) return;

        int rowCount = Mathf.Max(2, segments) + 1;
        int vertexCount = rowCount * crossCount;

        var vertices = new List<Vector3>(vertexCount);
        var uvs = new List<Vector2>(vertexCount);
        var triangles = new List<int>((rowCount - 1) * (crossCount - 1) * 6);

        float maxBank = Mathf.DegreesToRadians(Mathf.Max(0f, bankDegrees));
        float step = Mathf.Max(0.01f, trackLength / Mathf.Max(2, segments) * 0.5f);

        for (int row = 0; row < rowCount; row++)
        {
            float distance = trackLength * row / (rowCount - 1);

            Vector3 position = SamplePoint(distance);
            Vector3 tangent = SampleTangent(distance);

            // Unity's cross product is the left-handed one, so Cross(up, forward)
            // is the right-hand vector. Getting this backwards mirrors the road
            // and banks every corner the wrong way.
            Vector3 right = Vector3.Cross(Vector3.up, tangent);
            if (right.sqrMagnitude < 1e-8f) right = Vector3.Cross(Vector3.forward, tangent);
            right.Normalize();

            // Curvature from how fast the tangent is turning, signed by which way
            // it turns.
            float bankAngle = 0f;
            if (bankingScale > 0f && maxBank > 0f)
            {
                Vector3 aheadTangent = SampleTangent(distance + step);
                Vector3 behindTangent = SampleTangent(distance - step);
                Vector3 tangentDerivative = (aheadTangent - behindTangent) / (2f * step);

                float signedCurvature = Vector3.Dot(tangentDerivative, right);

                // Negative sign: turning left raises the right-hand edge.
                bankAngle = Mathf.Clamp(-signedCurvature * bankingScale, -maxBank, maxBank);
            }

            float cosB = Mathf.Cos(bankAngle);
            float sinB = Mathf.Sin(bankAngle);

            Vector3 bankedRight = right * cosB + Vector3.up * sinB;
            Vector3 bankedUp = Vector3.up * cosB - right * sinB;

            float v = distance / Mathf.Max(0.1f, uvTiling);

            for (int column = 0; column < crossCount; column++)
            {
                ProfilePoint point = crossSection[column];

                vertices.Add(position
                    + bankedRight * (point.lateralFraction * roadWidth)
                    + bankedUp * point.heightOffset);

                uvs.Add(new Vector2(point.lateralFraction + 0.5f, v));
            }
        }

        for (int row = 0; row < rowCount - 1; row++)
        {
            for (int column = 0; column < crossCount - 1; column++)
            {
                int i0 = row * crossCount + column;
                int i1 = i0 + 1;
                int i2 = (row + 1) * crossCount + column;
                int i3 = i2 + 1;

                // These two triangles give upward-facing normals for a road that
                // runs along +Z with the right-hand vector to the +X side. Flip
                // them with flipWinding if your centreline runs the other way.
                if (!flipWinding)
                {
                    triangles.Add(i0); triangles.Add(i2); triangles.Add(i3);
                    triangles.Add(i0); triangles.Add(i3); triangles.Add(i1);
                }
                else
                {
                    triangles.Add(i0); triangles.Add(i3); triangles.Add(i2);
                    triangles.Add(i0); triangles.Add(i1); triangles.Add(i3);
                }
            }
        }

        ReleaseMesh();
        mesh = new Mesh { name = "TDC Road" };
        mesh.indexFormat = UnityEngine.Rendering.IndexFormat.UInt32;
        mesh.SetVertices(vertices);
        mesh.SetUVs(0, uvs);
        mesh.SetTriangles(triangles, 0);
        mesh.RecalculateNormals();
        mesh.RecalculateBounds();

        GetComponent<MeshFilter>().sharedMesh = mesh;

        MeshCollider collider = GetComponent<MeshCollider>();
        collider.sharedMesh = null;
        collider.sharedMesh = mesh;
    }

    void BuildCrossSection()
    {
        crossSection.Clear();

        int steps = Mathf.Max(1, lateralSubdivisions);
        int count = profile.Count;

        for (int p = 0; p < count - 1; p++)
        {
            ProfilePoint a = profile[p];
            ProfilePoint b = profile[p + 1];

            for (int k = 0; k < steps; k++)
            {
                float t = (float)k / steps;
                crossSection.Add(new ProfilePoint(
                    Mathf.Lerp(a.lateralFraction, b.lateralFraction, t),
                    Mathf.Lerp(a.heightOffset, b.heightOffset, t)));
            }
        }

        crossSection.Add(profile[count - 1]);
    }

    void ReleaseMesh()
    {
        if (mesh == null) return;

        if (Application.isPlaying) Destroy(mesh);
        else DestroyImmediate(mesh);

        mesh = null;
    }
}
