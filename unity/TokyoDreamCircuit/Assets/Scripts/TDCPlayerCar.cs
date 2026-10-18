using UnityEngine;

/// <summary>
/// Physics-driven car. A single rigid body with four contact points and a
/// simplified bicycle-model tyre solver, so it works with any mesh and needs no
/// skeletal rig or physics asset.
///
/// The tyre model has one job the arcade version usually skips: it fades grip as
/// the surface gets wet, so the car understeers on a soaked road and the rear
/// steps out under power. Wetness blends dry grip toward wetGrip.
///
/// Everything is in SI units - metres, m/s, newtons, kg - which is what Unity
/// uses natively, so unlike the Unreal version there is no conversion layer. The
/// numbers below can be read against real references: a 1450 kg car, ~1.5 dry
/// friction coefficient, ~0.72 wet.
/// </summary>
[AddComponentMenu("Tokyo Dream Circuit/Player Car")]
[RequireComponent(typeof(Rigidbody), typeof(BoxCollider))]
public class TDCPlayerCar : MonoBehaviour
{
    // ---------------------------------------------------------------------
    // Components
    // ---------------------------------------------------------------------

    [Header("Components")]
    [Tooltip("Visual wheel transforms, in the order front left, front right, rear left, " +
             "rear right. Left empty, four cylinders are created for you.")]
    public Transform[] wheels = new Transform[4];

    [Tooltip("Visual body mesh. Left empty, a box is created for you.")]
    public Transform bodyVisual;

    // ---------------------------------------------------------------------
    // Handling
    // ---------------------------------------------------------------------

    [Header("Handling")]
    [Tooltip("Speed at which the engine stops accelerating the car, in km/h.")]
    public float maxSpeedKmh = 342f;

    [Tooltip("Peak friction coefficient on fully soaked asphalt. 0.72 is roughly half of dry " +
             "grip, which is what a wet road really costs you.")]
    public float wetGrip = 0.72f;

    [Tooltip("0 = bone dry, 1 = standing water. Blends dry grip toward wetGrip. Drive this from " +
             "weather or a volumetric lookup on the track.")]
    [Range(0f, 1f)] public float wetness = 0f;

    // ---------------------------------------------------------------------
    // Body and dimensions
    // ---------------------------------------------------------------------

    [Header("Body and dimensions")]
    public float massKg = 1450f;

    [Tooltip("Distance between front and rear axle, in metres.")]
    public float wheelBase = 2.8f;

    [Tooltip("Distance between left and right wheels, in metres.")]
    public float trackWidth = 1.62f;

    [Tooltip("Radius of the wheels, in metres. Used for contact points and the visual spin rate.")]
    public float wheelRadius = 0.33f;

    [Tooltip("Placeholder body size in metres: width, height, length. Only used when the car " +
             "builds its own box.")]
    public Vector3 placeholderBodySize = new Vector3(2.0f, 0.62f, 4.6f);

    [Tooltip("Colour of the placeholder body, if the car builds one. Must be set before the " +
             "component is enabled, so the scene bootstrap creates the car inactive.")]
    public Color placeholderCarColour = new Color(0.55f, 0.06f, 0.09f);

    [Tooltip("0.5 = balanced. 0.46 = slightly rear-biased, typical of a sports car.")]
    [Range(0.05f, 0.95f)] public float frontWeightBias = 0.46f;

    // ---------------------------------------------------------------------
    // Engine and brakes
    // ---------------------------------------------------------------------

    [Header("Engine and brakes")]
    [Tooltip("Peak force at the wheels, in newtons. 20000 N in a 1450 kg car is roughly a " +
             "3.5 s 0-100 km/h.")]
    public float maxEngineForce = 20000f;

    [Tooltip("Peak braking force total, in newtons.")]
    public float maxBrakeForce = 26000f;

    [Tooltip("How much reverse throttle is allowed. The original starter used 0.35, so S gives " +
             "a limited reverse rather than matching the forward throttle.")]
    [Range(0f, 1f)] public float maxReverseThrottle = 0.35f;

    [Tooltip("1.0 = the engine fully resists travelling backwards on forward throttle.")]
    [Range(0f, 1f)] public float reverseThrottleResistance = 1f;

    [Tooltip("Aerodynamic drag (0.5 * rho * Cd * A). 0.42 is a slippery supercar.")]
    public float dragCoefficient = 0.42f;

    [Tooltip("Rolling resistance, in newtons per (m/s).")]
    public float rollingResistance = 12f;

    [Tooltip("Downforce (0.5 * rho * Cl * A), in N per (m/s)^2. Higher = more grip at speed and " +
             "more stable high-speed cornering.")]
    public float downforceCoefficient = 1.8f;

    // ---------------------------------------------------------------------
    // Steering
    // ---------------------------------------------------------------------

    [Header("Steering")]
    public float maxSteerAngle = 32f;

    [Tooltip("How much steering lock is removed at top speed (0 = none).")]
    [Range(0f, 0.95f)] public float highSpeedSteerReduction = 0.6f;

    [Tooltip("Steering responsiveness. Higher = snappier.")]
    public float steerInterpSpeed = 7f;

    // ---------------------------------------------------------------------
    // Tyres
    // ---------------------------------------------------------------------

    [Header("Tyres")]
    [Tooltip("Cornering stiffness of the front axle, N per radian of slip.")]
    public float frontCorneringStiffness = 90000f;

    [Tooltip("Cornering stiffness of the rear axle. Rear > front = stable understeer.")]
    public float rearCorneringStiffness = 115000f;

    [Tooltip("Peak friction coefficient on dry asphalt. ~1.5 for a road tyre.")]
    public float dryFrictionCoefficient = 1.5f;

    [Tooltip("Rear grip multiplier while the handbrake is pulled.")]
    [Range(0.05f, 1f)] public float handbrakeGripScale = 0.45f;

    [Tooltip("Grip lost while the throttle is pinned (power oversteer). 0 = none.")]
    [Range(0f, 1f)] public float throttleGripLoss = 0.12f;

    [Tooltip("Diagnostic. If the car steers the wrong way, flip this to -1.")]
    [Range(-1f, 1f)] public float lateralForceSign = 1f;

    [Tooltip("Turns the physics model on or off. Off lets an external system drive the body " +
             "instead.")]
    public bool physicsEnabled = true;

    // ---------------------------------------------------------------------
    // Drivetrain, for audio and telemetry
    // ---------------------------------------------------------------------

    [Header("Drivetrain")]
    [Tooltip("Forward gears available to the drivetrain model that drives the engine audio.")]
    [Range(1, 8)] public int gearCount = 6;

    [Tooltip("Engine speed at which the audio model shifts up, in rpm.")]
    public float shiftUpRpm = 7200f;

    [Tooltip("Engine speed at which the audio model shifts down, in rpm.")]
    public float shiftDownRpm = 3200f;

    // ---------------------------------------------------------------------
    // Telemetry
    // ---------------------------------------------------------------------

    /// <summary>Signed forward speed in km/h. Negative = reversing.</summary>
    public float SpeedKmh { get; private set; }

    /// <summary>Total speed in km/h, regardless of direction.</summary>
    public float AbsoluteSpeedKmh { get; private set; }

    /// <summary>0 at rest, 1 at maxSpeedKmh. Drives post effects and audio.</summary>
    public float Speed01 { get; private set; }

    /// <summary>World-space velocity, in m/s.</summary>
    public Vector3 ForwardVelocity { get; private set; }

    /// <summary>Slip angle of the rear axle in degrees. Large = drifting.</summary>
    public float RearSlipAngleDeg { get { return Mathf.RadiansToDegrees(rearSlipAngle); } }

    /// <summary>Current steer angle in degrees.</summary>
    public float SteerAngleDeg { get { return Mathf.RadiansToDegrees(steerAngle); } }

    /// <summary>0..1 brake pedal, for brake lights.</summary>
    public float BrakeInput { get; private set; }

    /// <summary>
    /// -maxReverseThrottle..1 throttle pedal, as read last physics tick. Exposed
    /// for engine audio and telemetry.
    /// </summary>
    public float ThrottleInput { get; private set; }

    /// <summary>
    /// Engine speed in rpm, from the lightweight drivetrain model below. Good
    /// enough to drive engine audio: it climbs to <see cref="shiftUpRpm"/>, drops
    /// on each shift, and sits at idle when the car is stopped.
    /// </summary>
    public float EngineRpm { get; private set; }

    /// <summary>Selected gear, 1-based, from the same model.</summary>
    public int CurrentGear { get; private set; }

    /// <summary>
    /// 0..1 how hard the tyres are sliding, for smoke and skid effects. Combines
    /// a slip-angle term with a wheelspin term, so a slow, hugely sideways car
    /// smokes as much as a fast one scrubbing.
    /// </summary>
    public float TyreSlip01 { get; private set; }

    public bool IsDrifting
    {
        get { return AbsoluteSpeedKmh > 30f && Mathf.Abs(RearSlipAngleDeg) > 12f; }
    }

    /// <summary>Ratios the drivetrain model steps through. Fourth is near 1:1.</summary>
    static readonly float[] GearRatios = { 3.2f, 2.1f, 1.5f, 1.15f, 0.92f, 0.75f, 0.63f, 0.55f };
    const float FinalDrive = 3.4f;

    // ---------------------------------------------------------------------
    // State
    // ---------------------------------------------------------------------

    Rigidbody body;
    BoxCollider box;

    float throttleInput;
    float steeringInput;
    bool handbrake;

    float steerAngle;      // radians
    float rearSlipAngle;   // radians
    float wheelSpin;       // accumulated visual rotation, radians

    Vector3 spawnPosition;
    Quaternion spawnRotation;
    bool spawnCaptured;

    /// <summary>
    /// Reads a Rigidbody's velocity. Unity 6 renamed <c>velocity</c> to
    /// <c>linearVelocity</c>, so this keeps the project compiling on both sides of
    /// that rename without duplicating the code everywhere.
    /// </summary>
    public static Vector3 GetLinearVelocity(Rigidbody rigidbody)
    {
#if UNITY_6000_0_OR_NEWER
        return rigidbody.linearVelocity;
#else
        return rigidbody.velocity;
#endif
    }

    /// <summary>Sets a Rigidbody's velocity across the Unity 6 rename.</summary>
    public static void SetLinearVelocity(Rigidbody rigidbody, Vector3 velocity)
    {
#if UNITY_6000_0_OR_NEWER
        rigidbody.linearVelocity = velocity;
#else
        rigidbody.velocity = velocity;
#endif
    }

    // ---------------------------------------------------------------------
    // Lifecycle
    // ---------------------------------------------------------------------

    void Awake()
    {
        body = GetComponent<Rigidbody>();
        box = GetComponent<BoxCollider>();

        body.mass = Mathf.Max(1f, massKg);

        // Deliberately not touching drag / angularDrag. Unity's defaults (0 and
        // 0.05) are what this model wants, and the properties were renamed in
        // Unity 6, so leaving them alone is both correct and portable.
        body.interpolation = RigidbodyInterpolation.Interpolate;
        body.collisionDetectionMode = CollisionDetectionMode.ContinuousDynamic;
        body.maxAngularVelocity = 30f;

        box.size = placeholderBodySize;
        box.center = Vector3.zero;
        MakeCollidersSlick(box);

        if (bodyVisual == null) BuildPlaceholderBody();
        if (wheels == null || wheels.Length < 4) BuildPlaceholderWheels();

        CaptureSpawn();
    }

    void CaptureSpawn()
    {
        spawnPosition = transform.position;
        spawnRotation = transform.rotation;
        spawnCaptured = true;
    }

    /// <summary>Remember where the car should be when the player asks to reset.</summary>
    public void SetSpawn(Vector3 position, Quaternion rotation)
    {
        transform.SetPositionAndRotation(position, rotation);
        CaptureSpawn();
        ResetCar();
    }

    void FixedUpdate()
    {
        float dt = Time.fixedDeltaTime;
        if (dt <= 0f) return;

        // Input is read on the physics tick so the car cannot miss a frame of it.
        throttleInput = Mathf.Clamp(TDCInput.Throttle, -Mathf.Clamp01(maxReverseThrottle), 1f);
        steeringInput = Mathf.Clamp(TDCInput.Steer, -1f, 1f);
        BrakeInput = TDCInput.Brake;
        handbrake = TDCInput.Handbrake;
        ThrottleInput = throttleInput;

        if (TDCInput.ResetPressed) ResetCar();

        Simulate(dt);
        UpdateWheelVisuals(dt);
    }

    /// <summary>Put the car back where it started, at rest.</summary>
    public void ResetCar()
    {
        if (!spawnCaptured) CaptureSpawn();

        transform.SetPositionAndRotation(spawnPosition, spawnRotation);

        if (body != null)
        {
            SetLinearVelocity(body, Vector3.zero);
            body.angularVelocity = Vector3.zero;
        }

        steerAngle = 0f;
        rearSlipAngle = 0f;
        wheelSpin = 0f;
        throttleInput = 0f;
        steeringInput = 0f;
        BrakeInput = 0f;
        EngineRpm = 900f;
        CurrentGear = 1;
        TyreSlip01 = 0f;
    }

    // ---------------------------------------------------------------------
    // Physics
    // ---------------------------------------------------------------------

    void Simulate(float dt)
    {
        Vector3 forward = transform.forward;
        Vector3 right = transform.right;
        Vector3 up = transform.up;

        Vector3 velocity = GetLinearVelocity(body);
        float vLong = Vector3.Dot(velocity, forward);
        float vLat = Vector3.Dot(velocity, right);
        float speed = velocity.magnitude;
        float speedKmh = speed * 3.6f;

        SpeedKmh = vLong * 3.6f;
        AbsoluteSpeedKmh = speedKmh;
        Speed01 = Mathf.Clamp01(speedKmh / Mathf.Max(1f, maxSpeedKmh));
        ForwardVelocity = velocity;

        if (!physicsEnabled) return;

        float yawRate = Vector3.Dot(body.angularVelocity, up);

        // ---- Steering -----------------------------------------------------
        float maxSteerRad = maxSteerAngle * Mathf.Deg2Rad;
        float speedFraction = Mathf.Clamp01(speedKmh / Mathf.Max(1f, maxSpeedKmh));
        float steerLimit = maxSteerRad * (1f - highSpeedSteerReduction * speedFraction);
        float steerTarget = steeringInput * steerLimit;
        steerAngle = Mathf.Lerp(
            steerAngle, steerTarget, 1f - Mathf.Exp(-steerInterpSpeed * dt));

        // ---- Grip available this frame ------------------------------------
        float mu = Mathf.Lerp(
            dryFrictionCoefficient, wetGrip, Mathf.Clamp01(wetness));
        float rearMu = mu
            * (handbrake ? handbrakeGripScale : 1f)
            * (1f - throttleGripLoss * Mathf.Max(0f, throttleInput));

        // ---- Axle geometry -------------------------------------------------
        float halfWheelBase = wheelBase * 0.5f;

        // ---- Slip angles ---------------------------------------------------
        // At very low speed the slip formula divides by ~0 and explodes, so
        // clamp the reference speed. Below ~3.6 km/h the car behaves
        // quasi-statically.
        float longReference = Mathf.Max(Mathf.Abs(vLong), 1f);
        float alphaFront = Mathf.Atan2(vLat + yawRate * halfWheelBase, longReference) - steerAngle;
        float alphaRear = Mathf.Atan2(vLat - yawRate * halfWheelBase, longReference);
        rearSlipAngle = alphaRear;

        // ---- Vertical load, including aero downforce -----------------------
        const float gravity = 9.81f;
        float weight = massKg * gravity;
        float downforce = downforceCoefficient * speed * speed;
        float totalLoad = weight + downforce;
        float frontAxleLoad = totalLoad * frontWeightBias;
        float rearAxleLoad = totalLoad * (1f - frontWeightBias);

        // ---- Lateral cornering forces, limited by the friction circle ------
        float lateralFront = -frontCorneringStiffness * alphaFront;
        float lateralRear = -rearCorneringStiffness * alphaRear;
        lateralFront = Mathf.Clamp(lateralFront, -mu * frontAxleLoad, mu * frontAxleLoad);
        lateralRear = Mathf.Clamp(lateralRear, -rearMu * rearAxleLoad, rearMu * rearAxleLoad);

        lateralFront *= lateralForceSign;
        lateralRear *= lateralForceSign;

        // Half the axle force at each of the two wheels. Because the wheels sit
        // either side of the centreline, this produces the yaw moment for free.
        for (int i = 0; i < 2; i++)
        {
            body.AddForceAtPosition(
                right * (lateralFront * 0.5f), GetWheelContactPoint(i), ForceMode.Force);
        }
        for (int i = 2; i < 4; i++)
        {
            body.AddForceAtPosition(
                right * (lateralRear * 0.5f), GetWheelContactPoint(i), ForceMode.Force);
        }

        // ---- Longitudinal: engine, brakes, drag, rolling resistance --------
        float maxSpeedMs = maxSpeedKmh / 3.6f;
        float torqueFraction = 1f - 0.55f * speedFraction * speedFraction;
        float longitudinal = throttleInput * torqueFraction * maxEngineForce;

        // Soft ceiling: stop adding power once the target top speed is reached.
        if (throttleInput > 0f && vLong > maxSpeedMs)
        {
            longitudinal = Mathf.Min(longitudinal, 0f);
        }

        // Resist the engine when it is fighting the direction of travel.
        if (Mathf.Abs(vLong) > 1f
            && Mathf.Abs(throttleInput) > 0.001f
            && Mathf.Sign(throttleInput) != Mathf.Sign(vLong))
        {
            longitudinal *= 1f - Mathf.Clamp01(reverseThrottleResistance);
        }

        if (BrakeInput > 0f && Mathf.Abs(vLong) > 0.2f)
        {
            longitudinal -= Mathf.Sign(vLong) * BrakeInput * maxBrakeForce;
        }

        if (handbrake && Mathf.Abs(vLong) > 0.2f)
        {
            longitudinal -= Mathf.Sign(vLong) * maxBrakeForce * 0.35f;
        }

        // Drag and rolling resistance always oppose motion.
        longitudinal -= Mathf.Sign(vLong) * dragCoefficient * vLong * vLong;
        longitudinal -= rollingResistance * vLong;

        // Rear-wheel drive, so propulsion goes through the rear contact patches.
        // Under throttle that is what makes the tail step out.
        body.AddForceAtPosition(
            forward * (longitudinal * 0.5f), GetWheelContactPoint(2), ForceMode.Force);
        body.AddForceAtPosition(
            forward * (longitudinal * 0.5f), GetWheelContactPoint(3), ForceMode.Force);

        // ---- Downforce ------------------------------------------------------
        if (downforce > 0f)
        {
            body.AddForceAtPosition(-up * downforce, body.worldCenterOfMass, ForceMode.Force);
        }

        UpdateDrivetrain(vLong, vLat, speed);
    }

    /// <summary>
    /// Steps the lightweight drivetrain model. This is not a real gearbox - there
    /// is no clutch, no torque converter and no shift time - but it produces the
    /// two things engine audio needs to read as real: a pitch that tracks road
    /// speed, and a drop on every upshift.
    /// </summary>
    void UpdateDrivetrain(float vLong, float vLat, float speed)
    {
        float circumference = Mathf.Max(0.01f, 2f * Mathf.PI * wheelRadius);
        float wheelRevolutionsPerSecond = Mathf.Abs(vLong) / circumference;

        float ratio = GearRatios[Mathf.Clamp(CurrentGear - 1, 0, GearRatios.Length - 1)];
        float targetRpm = wheelRevolutionsPerSecond * 60f * ratio * FinalDrive;

        if (vLong >= 0f && CurrentGear < Mathf.Clamp(gearCount, 1, GearRatios.Length)
            && targetRpm > shiftUpRpm)
        {
            CurrentGear++;
        }
        else if (CurrentGear > 1 && targetRpm < shiftDownRpm && throttleInput < 0.9f)
        {
            // Only drop a gear when the driver is not asking for full power, so
            // the audio does not hunt on and off the shift point.
            CurrentGear--;
        }

        ratio = GearRatios[Mathf.Clamp(CurrentGear - 1, 0, GearRatios.Length - 1)];
        targetRpm = wheelRevolutionsPerSecond * 60f * ratio * FinalDrive;

        // Below walking pace, sit at idle rather than at ~0 rpm.
        EngineRpm = Mathf.Lerp(EngineRpm, Mathf.Clamp(targetRpm, 850f, 8000f),
            1f - Mathf.Exp(-12f * Time.fixedDeltaTime));

        float slipAngleTerm = Mathf.Clamp01(Mathf.Abs(rearSlipAngle) / (30f * Mathf.Deg2Rad));
        float slipSpeedTerm = Mathf.Clamp01(Mathf.Abs(vLat) / 12f);
        float wheelspinTerm = Mathf.Clamp01(
            Mathf.Abs(vLong) * (1f - Speed01 * 0.7f) / 18f) * Mathf.Max(0f, throttleInput);

        TyreSlip01 = Mathf.Clamp01(Mathf.Max(slipAngleTerm * slipSpeedTerm, wheelspinTerm));
    }

    /// <summary>
    /// World-space position of one wheel's contact patch.
    /// Index order: 0 front left, 1 front right, 2 rear left, 3 rear right.
    /// </summary>
    public Vector3 GetWheelContactPoint(int index)
    {
        float halfTrack = trackWidth * 0.5f;
        float halfBase = wheelBase * 0.5f;

        // Unity is left-handed like Unreal: +X right, +Y up, +Z forward.
        float x;
        float z;
        switch (index)
        {
            case 0: x = -halfTrack; z = halfBase; break;   // front left
            case 1: x = halfTrack; z = halfBase; break;    // front right
            case 2: x = -halfTrack; z = -halfBase; break;  // rear left
            default: x = halfTrack; z = -halfBase; break;  // rear right
        }

        // The contact patch sits a wheel radius below the axle.
        return transform.TransformPoint(new Vector3(x, -wheelRadius, z));
    }

    void UpdateWheelVisuals(float dt)
    {
        if (wheels == null || wheels.Length < 4) return;

        if (wheelRadius > 0.01f)
        {
            // angular speed = v / r
            wheelSpin += (SpeedKmh / 3.6f) / wheelRadius * dt;
        }

        float spinDegrees = Mathf.RadiansToDegrees(wheelSpin);
        float steerDegrees = Mathf.RadiansToDegrees(steerAngle);

        for (int i = 0; i < 4; i++)
        {
            if (wheels[i] == null) continue;

            bool isFrontWheel = i < 2;

            // Composed right to left: stand the cylinder up as an axle, roll it
            // about that axle, then steer it about the car's up axis.
            wheels[i].localRotation =
                Quaternion.AngleAxis(isFrontWheel ? steerDegrees : 0f, Vector3.up) *
                Quaternion.AngleAxis(spinDegrees, Vector3.right) *
                Quaternion.AngleAxis(90f, Vector3.forward);
        }
    }

    // ---------------------------------------------------------------------
    // Placeholder visuals
    // ---------------------------------------------------------------------

    void BuildPlaceholderBody()
    {
        GameObject go = GameObject.CreatePrimitive(PrimitiveType.Cube);
        go.name = "Body";
        go.transform.SetParent(transform, false);
        go.transform.localScale = placeholderBodySize;

        // The box collider on the car root already handles collision.
        Collider created = go.GetComponent<Collider>();
        if (created != null) Destroy(created);

        Material material = TDCMaterials.CarPaint(placeholderCarColour);
        if (material != null) go.GetComponent<MeshRenderer>().sharedMaterial = material;

        bodyVisual = go.transform;
    }

    void BuildPlaceholderWheels()
    {
        wheels = new Transform[4];

        Material material = TDCMaterials.Tyre();
        float halfTrack = trackWidth * 0.5f;
        float halfBase = wheelBase * 0.5f;
        float localY = wheelRadius - placeholderBodySize.y * 0.5f;

        for (int i = 0; i < 4; i++)
        {
            GameObject go = GameObject.CreatePrimitive(PrimitiveType.Cylinder);
            go.name = "Wheel" + i;
            go.transform.SetParent(transform, false);

            Collider created = go.GetComponent<Collider>();
            if (created != null) Destroy(created);

            bool isLeft = i == 0 || i == 2;
            bool isFront = i < 2;

            go.transform.localPosition = new Vector3(
                isLeft ? -halfTrack : halfTrack,
                localY,
                isFront ? halfBase : -halfBase);

            go.transform.localRotation =
                Quaternion.AngleAxis(90f, Vector3.forward);

            // Unity's cylinder is 2 units tall and 1 unit across.
            go.transform.localScale = new Vector3(
                wheelRadius * 2f, placeholderBodySize.x * 0.09f, wheelRadius * 2f);

            if (material != null) go.GetComponent<MeshRenderer>().sharedMaterial = material;

            wheels[i] = go.transform;
        }
    }

    void MakeCollidersSlick(Collider collider)
    {
        // Our tyre model supplies all the grip, so the built-in collider friction
        // must not add a second, invisible one on top of it. Unity 6 renamed
        // PhysicMaterial to PhysicsMaterial.
#if UNITY_6000_0_OR_NEWER
        var slick = new PhysicsMaterial("TDC Slick");
#else
        var slick = new PhysicMaterial("TDC Slick");
#endif
        slick.dynamicFriction = 0f;
        slick.staticFriction = 0f;
        slick.bounciness = 0f;
        collider.material = slick;
    }
}
