class_name TDCChaseCamera
extends Camera3D

## Spring-arm style chase camera. Give it the car as its target: it lags behind,
## pulls back with speed, opens its field of view and adds a little high-speed
## shake.
##
## The FOV ramp and the shake are most of the "sense of speed" at 300+ km/h.
## speed_01 is exposed so post effects and engine audio can be driven from the
## single number the camera already has to compute.
##
## Runs in _process, which Godot calls after _physics_process, so the camera never
## lags a frame behind the body it is following.
##
## It reads the car's own speed_01 when the target is a TDCPlayerCar, so the FOV
## ramp and the audio always agree on how fast the car is going. With a plain
## Node3D target it falls back to measuring how far the target moved.

@export_group("Target")

@export var target: Node3D

@export_group("Placement")

## Distance behind the car at a standstill, in metres.
@export var base_distance: float = 8.5

## Extra distance pulled back at top speed, in metres.
@export var speed_distance_gain: float = 3.2

## Height above the car, in metres.
@export var height: float = 3.2

@export_group("Field of view")

## FOV when stationary, in degrees, measured vertically.
@export var base_fov: float = 76.0

## FOV at top speed. This is most of the sense of speed.
@export var max_fov: float = 108.0

@export_group("Smoothing")

## How quickly the camera catches up to its target position. Lower = more lag.
@export var position_interp_speed: float = 6.5

## How quickly the camera catches up to the car's facing.
@export var rotation_interp_speed: float = 4.5

## How far ahead of the car the camera looks, in seconds of travel.
@export var look_ahead_gain: float = 0.35

@export_group("Feel")

## Speed treated as flat out, in km/h. Only used when the target is not a car.
@export var reference_top_speed_kmh: float = 342.0

## Maximum shake offset at top speed, in metres.
@export var shake_amplitude: float = 0.014

## Height the camera aims at, above the car's origin, in metres.
@export var look_at_height: float = 0.9

## 0 at rest, 1 at top speed. Drives post effects and audio.
var speed_01: float = 0.0

var _car: TDCPlayerCar
var _last_target_position := Vector3.ZERO


func _ready() -> void:
	fov = base_fov
	near = 0.3
	far = 20000.0
	current = true
	_cache_target()
	_snap_into_place()


## Point the camera at a car at runtime, or after swapping the target.
func set_target(new_target: Node3D, snap_to_target: bool = true) -> void:
	target = new_target
	_cache_target()
	if snap_to_target:
		_snap_into_place()


func _process(delta: float) -> void:
	if target == null or delta <= 0.0:
		return

	var owner_position := target.global_position

	# Speed. Prefer the car's own physics-accurate figure over anything the camera
	# could infer, so the FOV ramp and the audio never disagree.
	var estimated_velocity := Vector3.ZERO
	if _car != null:
		speed_01 = _car.speed_01
		estimated_velocity = _car.linear_velocity
	else:
		estimated_velocity = (owner_position - _last_target_position) / delta
		speed_01 = clampf(estimated_velocity.length() * 3.6 / maxf(1.0, reference_top_speed_kmh), 0.0, 1.0)

	# Yaw-only basis, so body roll does not tip the horizon.
	var car_forward := -target.global_transform.basis.z
	var yaw_forward := Vector3(car_forward.x, 0.0, car_forward.z)
	if yaw_forward.length_squared() < 0.000001:
		yaw_forward = Vector3.FORWARD
	yaw_forward = yaw_forward.normalized()

	# Desired position.
	var distance := base_distance + speed_distance_gain * speed_01
	var desired := owner_position - yaw_forward * distance + Vector3.UP * height

	# Small, fast shake, scaled by speed.
	if shake_amplitude > 0.0 and speed_01 > 0.01:
		var t := float(Time.get_ticks_msec()) * 0.001
		desired += Vector3(sin(t * 37.0), sin(t * 29.0), sin(t * 43.0)) * (shake_amplitude * speed_01)

	# 1 - exp(-k*dt) is the frame-rate-independent equivalent of a lerp factor, so
	# the feel does not change with frame rate.
	global_position = global_position.lerp(desired, 1.0 - exp(-position_interp_speed * delta))

	# Look at a point ahead of the car.
	var look_target := owner_position + estimated_velocity * look_ahead_gain + Vector3.UP * look_at_height
	var to_look := look_target - global_position
	if to_look.length_squared() > 0.000001:
		var desired_basis := Basis.looking_at(to_look, Vector3.UP)

		# Basis.slerp needs both bases orthonormal, which looking_at already
		# produces and the previous frame's basis stays.
		var t := 1.0 - exp(-rotation_interp_speed * delta)
		var blended := global_transform.basis.slerp(desired_basis, t)
		global_transform = Transform3D(blended, global_position)

	fov = lerpf(base_fov, max_fov, speed_01)

	_last_target_position = owner_position


## Snap into place, so the first frame does not lerp in from the origin.
func _snap_into_place() -> void:
	if target == null:
		return

	var car_forward := -target.global_transform.basis.z
	var yaw_forward := Vector3(car_forward.x, 0.0, car_forward.z)
	if yaw_forward.length_squared() < 0.000001:
		yaw_forward = Vector3.FORWARD
	yaw_forward = yaw_forward.normalized()

	global_position = target.global_position - yaw_forward * base_distance + Vector3.UP * height

	var to_look := target.global_position + Vector3.UP * look_at_height - global_position
	if to_look.length_squared() > 0.000001:
		global_transform = Transform3D(Basis.looking_at(to_look, Vector3.UP), global_position)

	fov = base_fov
	speed_01 = 0.0
	_last_target_position = target.global_position


func _cache_target() -> void:
	_car = null
	if target == null:
		return

	# The target may be the body node inside the car, so walk up the tree.
	var node: Node = target
	while node != null:
		if node is TDCPlayerCar:
			_car = node as TDCPlayerCar
			break
		node = node.get_parent()

	_last_target_position = target.global_position
