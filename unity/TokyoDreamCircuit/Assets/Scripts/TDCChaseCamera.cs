using UnityEngine;

/// <summary>
/// Spring-arm style chase camera. Put it on the Camera object and give it the car
/// as its target: it lags behind, pulls back with speed, opens up its field of
/// view and adds a little high-speed shake.
///
/// The FOV ramp and the shake are most of the "sense of speed" at 300+ km/h.
/// Speed01 is exposed so motion blur, chromatic aberration and engine audio can
/// be driven from the single number the camera already has to compute.
///
/// Runs in LateUpdate, after physics has moved the car, so the camera never lags
/// a frame behind the body it is following.
///
/// It reads the car's own Speed01 when a <see cref="TDCPlayerCar"/> is present,
/// so the FOV ramp and the HUD always agree on how fast the car is going. With a
/// plain Transform target it falls back to measuring how far the target moved.
/// </summary>
[AddComponentMenu("Tokyo Dream Circuit/Chase Camera")]
[RequireComponent(typeof(Camera))]
public class TDCChaseCamera : MonoBehaviour
{
    [Header("Target")]
    public Transform target;

    [Header("Placement")]
    [Tooltip("Distance behind the car at a standstill, in metres.")]
    public float baseDistance = 8.5f;

    [Tooltip("Extra distance pulled back at top speed, in metres.")]
    public float speedDistanceGain = 3.2f;

    [Tooltip("Height above the car, in metres.")]
    public float height = 3.2f;

    [Header("Field of view")]
    [Tooltip("FOV when stationary.")]
    public float baseFOV = 76f;

    [Tooltip("FOV at top speed. This is most of the sense of speed.")]
    public float maxFOV = 108f;

    [Header("Smoothing")]
    [Tooltip("How quickly the camera catches up to its target position. Lower = more lag.")]
    public float positionInterpSpeed = 6.5f;

    [Tooltip("How quickly the camera catches up to the car's facing.")]
    public float rotationInterpSpeed = 4.5f;

    [Tooltip("How far ahead of the car the camera looks, in seconds of travel.")]
    public float lookAheadGain = 0.35f;

    [Header("Feel")]
    [Tooltip("Speed treated as flat out, in km/h. Only used when the target has no TDCPlayerCar.")]
    public float referenceTopSpeedKmh = 342f;

    [Tooltip("Maximum shake offset at top speed, in metres.")]
    public float shakeAmplitude = 0.014f;

    [Tooltip("Height the camera aims at, above the car's origin, in metres.")]
    public float lookAtHeight = 0.9f;

    /// <summary>0 at rest, 1 at top speed. Drives post effects and audio.</summary>
    public float Speed01 { get; private set; }

    Camera cam;
    TDCPlayerCar car;
    Vector3 lastTargetPosition;

    void Awake()
    {
        cam = GetComponent<Camera>();
        cam.fieldOfView = baseFOV;
        CacheTarget();
    }

    void Start()
    {
        SnapIntoPlace();
    }

    /// <summary>
    /// Point the camera at a car at runtime (or after swapping the target).
    /// </summary>
    public void SetTarget(Transform newTarget, bool snap = true)
    {
        target = newTarget;
        CacheTarget();
        if (snap) SnapIntoPlace();
    }

    void LateUpdate()
    {
        if (target == null) return;

        float dt = Time.deltaTime;
        if (dt <= 0f) return;

        Vector3 ownerLocation = target.position;

        // Speed. Prefer the car's own physics-accurate figure over anything the
        // camera could infer, so the FOV ramp and the HUD never disagree.
        if (car != null)
        {
            Speed01 = car.Speed01;
        }
        else
        {
            Vector3 moved = dt > 0f ? (ownerLocation - lastTargetPosition) / dt : Vector3.zero;
            Speed01 = Mathf.Clamp01(moved.magnitude * 3.6f / Mathf.Max(1f, referenceTopSpeedKmh));
        }

        Vector3 estimatedVelocity = car != null
            ? car.ForwardVelocity
            : (ownerLocation - lastTargetPosition) / dt;

        // Yaw-only basis, so body roll does not tip the horizon.
        Quaternion yawOnly = Quaternion.Euler(0f, target.eulerAngles.y, 0f);
        Vector3 forward = yawOnly * Vector3.forward;

        // Desired position.
        float distance = baseDistance + speedDistanceGain * Speed01;
        Vector3 desired = ownerLocation - forward * distance + Vector3.up * height;

        // Small, fast shake, scaled by speed.
        if (shakeAmplitude > 0f && Speed01 > 0.01f)
        {
            float t = Time.time;
            desired += new Vector3(
                Mathf.Sin(t * 37f),
                Mathf.Sin(t * 29f),
                Mathf.Sin(t * 43f)) * (shakeAmplitude * Speed01);
        }

        // 1 - exp(-k*dt) is the frame-rate-independent equivalent of a lerp
        // factor, so the feel does not change with frame rate.
        transform.position = Vector3.Lerp(
            transform.position, desired, 1f - Mathf.Exp(-positionInterpSpeed * dt));

        // Look at a point ahead of the car.
        Vector3 lookTarget = ownerLocation + estimatedVelocity * lookAheadGain + Vector3.up * lookAtHeight;
        Quaternion desiredRotation = Quaternion.LookRotation(lookTarget - transform.position, Vector3.up);
        transform.rotation = Quaternion.Slerp(
            transform.rotation, desiredRotation, 1f - Mathf.Exp(-rotationInterpSpeed * dt));

        // Field of view.
        cam.fieldOfView = Mathf.Lerp(baseFOV, maxFOV, Speed01);

        lastTargetPosition = ownerLocation;
    }

    /// <summary>Snap into place, so the first frame does not lerp in from the origin.</summary>
    public void SnapIntoPlace()
    {
        if (target == null) return;

        Quaternion yawOnly = Quaternion.Euler(0f, target.eulerAngles.y, 0f);
        Vector3 forward = yawOnly * Vector3.forward;

        transform.position = target.position - forward * baseDistance + Vector3.up * height;
        transform.rotation = Quaternion.LookRotation(
            target.position + Vector3.up * lookAtHeight - transform.position, Vector3.up);

        if (cam == null) cam = GetComponent<Camera>();
        if (cam != null) cam.fieldOfView = baseFOV;

        Speed01 = 0f;
        lastTargetPosition = target.position;
    }

    void CacheTarget()
    {
        car = target != null ? target.GetComponentInParent<TDCPlayerCar>() : null;
        if (target != null) lastTargetPosition = target.position;
    }
}
