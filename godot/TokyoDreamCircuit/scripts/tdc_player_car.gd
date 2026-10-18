class_name TDCPlayerCar
extends RigidBody3D

## Physics-driven car: one rigid body, four contact points, and a simplified
## bicycle-model tyre solver. Works with any mesh and needs no skeleton or
## wheel-collider rig.
##
## The one thing this model has that the arcade version usually skips: grip fades
## as the surface gets wet, so the car understeers on a soaked road and the tail
## steps out under power. wetness blends dry grip toward wet_grip.
##
## Everything is SI - metres, m/s, newtons, kilograms - which is what Godot uses
## natively, so as in the Unity version there is no conversion layer. The numbers
## can be read against real references: 1450 kg, ~1.5 dry friction coefficient,
## ~0.72 wet.
##
## Godot is right-handed and a Node3D faces along its own -Z, so "forward" is
## -basis.z and "right" is +basis.x. Both of those are noted where they are used,
## because they are the two places the Unreal and Unity sources do not port
## verbatim.

# ---------------------------------------------------------------------------
# Components
# ---------------------------------------------------------------------------

@export_group("Components")

## Visual wheel nodes, in the order front left, front right, rear left, rear
## right. Left empty, four cylinders are created for you.
@export var wheels: Array[Node3D] = []

## Visual body node. Left empty, a box is created for you.
@export var body_visual: Node3D

# ---------------------------------------------------------------------------
# Handling
# ---------------------------------------------------------------------------

@export_group("Handling")

## Speed at which the engine stops accelerating the car, in km/h.
@export var max_speed_kmh: float = 342.0

## Peak friction coefficient on fully soaked asphalt. 0.72 is roughly half of dry
## grip, which is what a wet road really costs you.
@export var wet_grip: float = 0.72

## 0 = bone dry, 1 = standing water. Blends dry grip toward wet_grip.
@export_range(0.0, 1.0, 0.01) var wetness: float = 0.0

# ---------------------------------------------------------------------------
# Body and dimensions
# ---------------------------------------------------------------------------

@export_group("Body and dimensions")

@export var mass_kg: float = 1450.0

## Distance between front and rear axle, in metres.
@export var wheel_base: float = 2.8

## Distance between left and right wheels, in metres.
@export var track_width: float = 1.62

## Radius of the wheels, in metres. Used for contact points and visual spin rate.
@export var wheel_radius: float = 0.33

## Placeholder body size in metres: width, height, length. Only used when the car
## builds its own box.
@export var placeholder_body_size := Vector3(2.0, 0.62, 4.6)

## Colour of the placeholder body.
@export var placeholder_car_colour := Color(0.55, 0.06, 0.09)

## 0.5 = balanced, 0.46 = slightly rear-biased, typical of a sports car.
@export_range(0.05, 0.95, 0.01) var front_weight_bias: float = 0.46

# ---------------------------------------------------------------------------
# Engine and brakes
# ---------------------------------------------------------------------------

@export_group("Engine and brakes")

## Peak force at the wheels, in newtons. 20000 N in a 1450 kg car is roughly a
## 3.5 s 0-100 km/h.
@export var max_engine_force: float = 20000.0

## Peak braking force, total, in newtons.
@export var max_brake_force: float = 26000.0

## How much reverse throttle is allowed. 0.35 gives a limited reverse rather than
## matching the forward throttle.
@export_range(0.0, 1.0, 0.01) var max_reverse_throttle: float = 0.35

## 1.0 = the engine fully resists travelling backwards on forward throttle.
@export_range(0.0, 1.0, 0.01) var reverse_throttle_resistance: float = 1.0

## Aerodynamic drag (0.5 * rho * Cd * A). 0.42 is a slippery supercar.
@export var drag_coefficient: float = 0.42

## Rolling resistance, in newtons per (m/s).
@export var rolling_resistance: float = 12.0

## Downforce (0.5 * rho * Cl * A), in N per (m/s)^2. Higher = more grip at speed.
@export var downforce_coefficient: float = 1.8

## Number of forward gears used by the audio model and the telemetry.
@export_range(1, 8, 1) var gear_count: int = 6

## Engine speed, in rpm, at which the audio model shifts up and down.
@export var shift_up_rpm: float = 7200.0
@export var shift_down_rpm: float = 3200.0

# ---------------------------------------------------------------------------
# Steering
# ---------------------------------------------------------------------------

@export_group("Steering")

@export var max_steer_angle: float = 32.0

## How much steering lock is removed at top speed (0 = none).
@export_range(0.0, 0.95, 0.01) var high_speed_steer_reduction: float = 0.6

## Steering responsiveness. Higher = snappier.
@export var steer_interp_speed: float = 7.0

# ---------------------------------------------------------------------------
# Tyres
# ---------------------------------------------------------------------------

@export_group("Tyres")

## Cornering stiffness of the front axle, N per radian of slip.
@export var front_cornering_stiffness: float = 90000.0

## Cornering stiffness of the rear axle. Rear > front = stable understeer.
@export var rear_cornering_stiffness: float = 115000.0

## Peak friction coefficient on dry asphalt. ~1.5 for a road tyre.
@export var dry_friction_coefficient: float = 1.5

## Rear grip multiplier while the handbrake is pulled.
@export_range(0.05, 1.0, 0.01) var handbrake_grip_scale: float = 0.45

## Grip lost while the throttle is pinned (power oversteer). 0 = none.
@export_range(0.0, 1.0, 0.01) var throttle_grip_loss: float = 0.12

## Diagnostics. If the car steers the wrong way, set this to -1.
@export_range(-1.0, 1.0, 0.1) var lateral_force_sign: float = 1.0

## Turns the physics model on or off. Off lets an external system drive the body.
@export var physics_enabled: bool = true

# ---------------------------------------------------------------------------
# Telemetry
# ---------------------------------------------------------------------------

## Signed forward speed in km/h. Negative = reversing.
var speed_kmh: float = 0.0

## Total speed in km/h, regardless of direction.
var absolute_speed_kmh: float = 0.0

## 0 at rest, 1 at max_speed_kmh. Drives post effects and audio.
var speed_01: float = 0.0

## Current steer angle in radians.
var steer_angle: float = 0.0

## Slip angle of the rear axle in radians. Large = drifting.
var rear_slip_angle: float = 0.0

## 0..1 brake pedal, for brake lights.
var brake_input: float = 0.0

## Estimated engine speed, in rpm, and the gear driving it. Both are a simple
## model rather than a real gearbox, but they track wheel speed closely enough to
## make the audio respond the way a driver expects: pitch rises, drops on a shift.
var engine_rpm: float = 900.0
var current_gear: int = 1

## 0..1 how hard the tyres are sliding, for smoke and skid FX.
var tyre_slip_01: float = 0.0

var is_drifting: bool:
	get:
		return absolute_speed_kmh > 30.0 and absf(rad_to_deg(rear_slip_angle)) > 12.0

# ---------------------------------------------------------------------------
# State
# ---------------------------------------------------------------------------

## Gear ratios and final drive for the audio model's gearbox. Only the top six
## are reachable by default; gear_count caps it.
const GEAR_RATIOS := [3.2, 2.1, 1.5, 1.15, 0.92, 0.75, 0.63, 0.55]
const FINAL_DRIVE := 3.4

## -max_reverse_throttle .. 1, read last physics tick. The audio uses this as the
## engine load figure.
var throttle_input: float = 0.0

## -1 .. 1, read last physics tick.
var steering_input: float = 0.0

var _handbrake: bool = false
var _wheel_spin: float = 0.0

var _spawn_origin := Vector3.ZERO
var _spawn_basis := Basis.IDENTITY
var _spawn_captured := false

var _collider: CollisionShape3D


func _ready() -> void:
	mass = maxf(1.0, mass_kg)

	# Godot's project default linear damp is 0.1, which is a slow invisible brake
	# that would quietly shave the top speed. The tuning below assumes none.
	linear_damp = 0.0
	angular_damp = 0.05

	continuous_cd = true
	physics_material_override = TDCMaterials.slick()

	_ensure_collider()

	if body_visual == null:
		_build_placeholder_body()
	if wheels.size() < 4:
		_build_placeholder_wheels()

	_capture_spawn()


func _ensure_collider() -> void:
	_collider = CollisionShape3D.new()
	_collider.name = "BodyShape"

	var box := BoxShape3D.new()
	box.size = placeholder_body_size
	_collider.shape = box

	add_child(_collider)


# ---------------------------------------------------------------------------
# Lifecycle
# ---------------------------------------------------------------------------

func _physics_process(delta: float) -> void:
	if delta <= 0.0:
		return

	# Input is read on the physics tick so the car cannot miss a frame of it.
	throttle_input = clampf(TDCInput.throttle(), -max_reverse_throttle, 1.0)
	steering_input = clampf(TDCInput.steer(), -1.0, 1.0)
	brake_input = TDCInput.brake()
	_handbrake = TDCInput.handbrake()

	if TDCInput.reset_pressed():
		reset_car()

	_simulate(delta)
	_update_wheel_visuals(delta)


func _capture_spawn() -> void:
	_spawn_origin = global_position
	_spawn_basis = global_transform.basis
	_spawn_captured = true


## Put the car back where it started, at rest.
func reset_car() -> void:
	if not _spawn_captured:
		_capture_spawn()

	global_transform = Transform3D(_spawn_basis, _spawn_origin)
	linear_velocity = Vector3.ZERO
	angular_velocity = Vector3.ZERO

	steer_angle = 0.0
	rear_slip_angle = 0.0
	_wheel_spin = 0.0
	throttle_input = 0.0
	steering_input = 0.0
	brake_input = 0.0
	engine_rpm = 900.0
	current_gear = 1


## Remember where the car should be when the player asks to reset.
func set_spawn(origin: Vector3, basis: Basis) -> void:
	global_transform = Transform3D(basis, origin)
	_capture_spawn()
	reset_car()


# ---------------------------------------------------------------------------
# Physics
# ---------------------------------------------------------------------------

func _simulate(delta: float) -> void:
	# Godot is right-handed and a Node3D looks down its own -Z, so forward is the
	# negated third basis column. The Unreal and Unity versions can use their
	# transform's forward vector directly; here it has to be flipped.
	var forward := -global_transform.basis.z
	var right := global_transform.basis.x
	var up := global_transform.basis.y

	var velocity := linear_velocity
	var v_long := velocity.dot(forward)
	var v_lat := velocity.dot(right)
	var speed := velocity.length()
	var speed_kmh_now := speed * 3.6

	speed_kmh = v_long * 3.6
	absolute_speed_kmh = speed_kmh_now
	speed_01 = clampf(speed_kmh_now / maxf(1.0, max_speed_kmh), 0.0, 1.0)

	_update_gearbox(v_long)

	if not physics_enabled:
		return

	var yaw_rate := angular_velocity.dot(up)

	# ---- Steering ---------------------------------------------------------
	var max_steer_rad := deg_to_rad(max_steer_angle)
	var speed_fraction := clampf(speed_kmh_now / maxf(1.0, max_speed_kmh), 0.0, 1.0)
	var steer_limit := max_steer_rad * (1.0 - high_speed_steer_reduction * speed_fraction)
	var steer_target := steering_input * steer_limit
	steer_angle = lerpf(steer_angle, steer_target, 1.0 - exp(-steer_interp_speed * delta))

	# ---- Grip available this frame ----------------------------------------
	var mu := lerpf(dry_friction_coefficient, wet_grip, clampf(wetness, 0.0, 1.0))
	var rear_mu := mu
	rear_mu *= handbrake_grip_scale if _handbrake else 1.0
	rear_mu *= 1.0 - throttle_grip_loss * maxf(0.0, throttle_input)

	# ---- Axle geometry ------------------------------------------------------
	var half_wheel_base := wheel_base * 0.5

	# ---- Slip angles --------------------------------------------------------
	# At very low speed the slip formula divides by ~0 and explodes, so clamp the
	# reference speed. Below ~3.6 km/h the car behaves quasi-statically.
	var long_reference := maxf(absf(v_long), 1.0)
	var alpha_front := atan2(v_lat + yaw_rate * half_wheel_base, long_reference) - steer_angle
	var alpha_rear := atan2(v_lat - yaw_rate * half_wheel_base, long_reference)
	rear_slip_angle = alpha_rear

	# ---- Vertical load, including aero downforce ---------------------------
	var gravity := 9.81
	var weight := mass_kg * gravity
	var downforce := downforce_coefficient * speed * speed
	var total_load := weight + downforce
	var front_axle_load := total_load * front_weight_bias
	var rear_axle_load := total_load * (1.0 - front_weight_bias)

	# ---- Lateral cornering forces, limited by the friction circle ----------
	var lateral_front := -front_cornering_stiffness * alpha_front
	var lateral_rear := -rear_cornering_stiffness * alpha_rear
	lateral_front = clampf(lateral_front, -mu * front_axle_load, mu * front_axle_load)
	lateral_rear = clampf(lateral_rear, -rear_mu * rear_axle_load, rear_mu * rear_axle_load)

	lateral_front *= lateral_force_sign
	lateral_rear *= lateral_force_sign

	# Half the axle force at each of the two wheels. Because the wheels sit either
	# side of the centreline, this produces the yaw moment for free.
	for i in range(2):
		_apply_at(right * (lateral_front * 0.5), wheel_contact_point(i))
	for i in range(2, 4):
		_apply_at(right * (lateral_rear * 0.5), wheel_contact_point(i))

	# ---- Longitudinal: engine, brakes, drag, rolling resistance ------------
	var max_speed_ms := max_speed_kmh / 3.6
	var torque_fraction := 1.0 - 0.55 * speed_fraction * speed_fraction
	var longitudinal := throttle_input * torque_fraction * max_engine_force

	# Soft ceiling: stop adding power once the target top speed is reached.
	if throttle_input > 0.0 and v_long > max_speed_ms:
		longitudinal = minf(longitudinal, 0.0)

	# Resist the engine when it is fighting the direction of travel.
	if absf(v_long) > 1.0 and absf(throttle_input) > 0.001 and signf(throttle_input) != signf(v_long):
		longitudinal *= 1.0 - clampf(reverse_throttle_resistance, 0.0, 1.0)

	if brake_input > 0.0 and absf(v_long) > 0.2:
		longitudinal -= signf(v_long) * brake_input * max_brake_force

	if _handbrake and absf(v_long) > 0.2:
		longitudinal -= signf(v_long) * max_brake_force * 0.35

	# Drag and rolling resistance always oppose motion.
	longitudinal -= signf(v_long) * drag_coefficient * v_long * v_long
	longitudinal -= rolling_resistance * v_long

	# Rear-wheel drive, so propulsion goes through the rear contact patches.
	# Under throttle that is what makes the tail step out.
	_apply_at(forward * (longitudinal * 0.5), wheel_contact_point(2))
	_apply_at(forward * (longitudinal * 0.5), wheel_contact_point(3))

	# ---- Downforce ----------------------------------------------------------
	if downforce > 0.0:
		_apply_at(-up * downforce, global_transform.basis * center_of_mass)


## Godot's apply_force takes an offset from the body origin, in global
## coordinates, not an absolute world position. Passing a world position here
## would apply a wild torque, which is a trap worth a comment.
func _apply_at(force: Vector3, world_point: Vector3) -> void:
	apply_force(force, world_point - global_position)


## World-space position of one wheel's contact patch.
## Index order: 0 front left, 1 front right, 2 rear left, 3 rear right.
func wheel_contact_point(index: int) -> Vector3:
	var half_track := track_width * 0.5
	var half_base := wheel_base * 0.5

	# Left/right is the same as the left-handed engines, but front is -Z here:
	# a Node3D looks down its own -Z.
	var x := -half_track if (index == 0 or index == 2) else half_track
	var z := -half_base if index < 2 else half_base

	# The contact patch sits a wheel radius below the axle.
	return to_global(Vector3(x, -wheel_radius, z))


func _update_gearbox(v_long: float) -> void:
	var wheel_circumference := TAU * maxf(0.01, wheel_radius)

	# Ratio of the gear currently engaged, then the engine speed that ratio
	# implies at this road speed.
	var ratio := GEAR_RATIOS[clampi(current_gear - 1, 0, GEAR_RATIOS.size() - 1)]

	var wheel_rps := absf(v_long) / wheel_circumference
	var target_rpm := wheel_rps * 60.0 * ratio * FINAL_DRIVE

	if v_long >= 0.0 and current_gear < gear_count and target_rpm > shift_up_rpm:
		current_gear += 1
	elif current_gear > 1 and target_rpm < shift_down_rpm and throttle_input < 0.9:
		# Only drop a gear when the driver is not asking for full power, so the
		# audio does not hunt on and off the shift point.
		current_gear -= 1

	ratio = GEAR_RATIOS[clampi(current_gear - 1, 0, GEAR_RATIOS.size() - 1)]
	target_rpm = wheel_rps * 60.0 * ratio * FINAL_DRIVE

	# Below walking pace, sit at idle instead of at ~0 rpm.
	engine_rpm = lerpf(engine_rpm, clampf(target_rpm, 850.0, 8000.0), 0.15)

	# How hard the tyres are sliding, for smoke and skid FX. Combines a
	# sliding-speed term with a slip-angle term, so a slow, hugely sideways car
	# smokes as much as a fast one scrubbing.
	var slip_angle_term := clampf(absf(rear_slip_angle) / deg_to_rad(30.0), 0.0, 1.0)
	var slip_speed_term := clampf(absf(v_lat) / 12.0, 0.0, 1.0)
	var wheelspin_term := clampf((absf(v_long) * (1.0 - speed_01 * 0.7)) / 18.0, 0.0, 1.0) * throttle_input

	tyre_slip_01 = clampf(maxf(slip_angle_term * slip_speed_term, wheelspin_term), 0.0, 1.0)


func _update_wheel_visuals(delta: float) -> void:
	if wheels.size() < 4:
		return

	if wheel_radius > 0.01:
		# angular speed = v / r
		_wheel_spin += (speed_kmh / 3.6) / wheel_radius * delta

	for i in range(4):
		var wheel := wheels[i]
		if wheel == null:
			continue

		var is_front := i < 2

		# Composed right to left: stand the cylinder up as an axle, roll it about
		# that axle, then steer it about the car's up axis. Godot's CylinderMesh
		# runs along Y, so a quarter turn about Z makes it an axle.
		var new_basis := Basis(Vector3.UP, steer_angle if is_front else 0.0)
		new_basis = new_basis * Basis(Vector3.RIGHT, _wheel_spin)
		new_basis = new_basis * Basis(Vector3.FORWARD, PI * 0.5)

		var t := wheel.transform
		t.basis = new_basis
		wheel.transform = t


# ---------------------------------------------------------------------------
# Placeholder visuals
# ---------------------------------------------------------------------------

func _build_placeholder_body() -> void:
	var mesh := MeshInstance3D.new()
	mesh.name = "BodyMesh"

	var box := BoxMesh.new()
	box.size = placeholder_body_size
	mesh.mesh = box

	mesh.material_override = TDCMaterials.car_paint(placeholder_car_colour)

	var visual := Node3D.new()
	visual.name = "Body"
	visual.add_child(mesh)
	add_child(visual)

	body_visual = visual


func _build_placeholder_wheels() -> void:
	wheels = []

	var half_track := track_width * 0.5
	var half_base := wheel_base * 0.5
	var local_y := wheel_radius - placeholder_body_size.y * 0.5
	var material := TDCMaterials.tyre()

	for i in range(4):
		var mesh := MeshInstance3D.new()
		mesh.name = "Wheel%d" % i
		mesh.material_override = material

		var cylinder := CylinderMesh.new()
		cylinder.top_radius = wheel_radius
		cylinder.bottom_radius = wheel_radius
		cylinder.height = placeholder_body_size.x * 0.18
		mesh.mesh = cylinder

		var is_left := i == 0 or i == 2
		var is_front := i < 2

		add_child(mesh)
		mesh.position = Vector3(
			-half_track if is_left else half_track,
			local_y,
			-half_base if is_front else half_base)

		wheels.append(mesh)
