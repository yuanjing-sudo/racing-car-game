class_name TDCVehicleFX
extends Node3D

## Tyre smoke, wet spray and brake lights, all built from code.
##
## Nothing here loads an asset. The particle textures are GradientTexture2D
## resources built at runtime as soft radial puffs, which is why the smoke reads
## as smoke rather than as squares, and the emitters are CPUParticles3D so no
## compute shader or GPU driver support is needed.
##
## What drives each effect:
##
##   smoke        car.tyre_slip_01, so it appears when the tyres are actually
##                sliding rather than whenever the throttle is down
##   spray        car.wetness x speed x slip: standing water thrown off the
##                tyres, which is the whole visual point of a wet track
##   brake lights brake_input, brightened only while braking
##
## Skid marks are deliberately not here. They need either a decal or a ribbon
## mesh with its own ring buffer, which is a bigger piece of work than the rest of
## this file put together; see REALISM_GODOT.md for what that would take.

@export_group("Source")

## The car to read telemetry from.
@export var car: TDCPlayerCar

@export_group("Tyre smoke")

@export var smoke_enabled: bool = true

## Slip below which no smoke is emitted, 0..1.
@export_range(0.0, 1.0, 0.01) var smoke_threshold: float = 0.16

## Colour of the smoke. A pale grey reads as tyre smoke; a burnt-orange tint
## reads as a burnout.
@export var smoke_colour := Color(0.72, 0.71, 0.70, 0.34)

## Particles per wheel emitter. Each is allocated at startup, so this is a memory
## cost as well as a visual one.
@export_range(8, 256, 1) var smoke_amount: int = 64

@export var smoke_lifetime: float = 1.6
@export var smoke_size: float = 0.55

@export_group("Wet spray")

@export var spray_enabled: bool = true

## How much water is on the track, 0..1. Blends the spray in.
@export_range(0.0, 1.0, 0.01) var wetness: float = 0.0

@export_range(8, 512, 1) var spray_amount: int = 192

@export var spray_colour := Color(0.80, 0.85, 0.92, 0.22)
@export var spray_lifetime: float = 0.9

@export_group("Brake lights")

@export var brake_lights_enabled: bool = true

## Emission strength while braking. Over 1 so it blooms.
@export var brake_emission_energy: float = 5.0

@export var brake_colour := Color(1.0, 0.08, 0.06)

var _smoke: Array[CPUParticles3D] = []
var _spray: CPUParticles3D
var _brake_materials: Array[StandardMaterial3D] = []

var _emitting_smoke := false
var _emitting_spray := false


func _ready() -> void:
	if car == null:
		push_warning("TDCVehicleFX: no car assigned, nothing to emit from")
		return

	var puff := _make_puff_texture()

	if smoke_enabled:
		_build_smoke(puff)
	if spray_enabled:
		_build_spray(puff)
	if brake_lights_enabled:
		_build_brake_lights()


func _process(_delta: float) -> void:
	if car == null:
		return

	_update_smoke()
	_update_spray()
	_update_brake_lights()


# ---------------------------------------------------------------------------
# Smoke
# ---------------------------------------------------------------------------

func _build_smoke(puff: Texture2D) -> void:
	for i in range(4):
		var emitter := CPUParticles3D.new()
		emitter.name = "TyreSmoke%d" % i

		# World-space particles, so the smoke stays where it was made and the car
		# drives out of it. With local coordinates it would follow the wheels,
		# which looks like fog attached to the tyres.
		emitter.local_coords = false
		emitter.amount = smoke_amount
		emitter.lifetime = smoke_lifetime
		emitter.explosiveness = 0.0
		emitter.randomness = 0.6
		emitter.emitting = false

		emitter.direction = Vector3.UP
		emitter.spread = 38.0
		emitter.initial_velocity_min = 0.5
		emitter.initial_velocity_max = 2.6
		emitter.gravity = Vector3(0.0, 1.1, 0.0)
		emitter.damping_min = 1.4
		emitter.damping_max = 2.2
		emitter.scale_amount_min = smoke_size * 0.55
		emitter.scale_amount_max = smoke_size * 1.6
		emitter.color = smoke_colour
		emitter.mesh = _make_quad(puff)

		add_child(emitter)
		_smoke.append(emitter)


func _update_smoke() -> void:
	if _smoke.is_empty():
		return

	var slip := car.tyre_slip_01

	# Smoke is emitted on slip, not on speed. A car crawling sideways on the
	# handbrake smokes; a car at 300 km/h in a straight line does not.
	var should_emit := slip > smoke_threshold and car.absolute_speed_kmh > 4.0

	if should_emit != _emitting_smoke:
		_emitting_smoke = should_emit
		for emitter in _smoke:
			emitter.emitting = should_emit

	if not should_emit:
		return

	# Heavier slip = faster billowing, so the smoke keeps up with the car instead
	# of being left behind in a stationary cloud.
	var intensity := clampf((slip - smoke_threshold) / maxf(0.001, 1.0 - smoke_threshold), 0.0, 1.0)
	var travel := maxf(2.0, car.absolute_speed_kmh / 3.6)

	for i in range(_smoke.size()):
		var emitter := _smoke[i]
		emitter.global_position = car.wheel_contact_point(i) + Vector3.UP * 0.08

		emitter.initial_velocity_min = 0.5 + intensity * 1.5
		emitter.initial_velocity_max = 2.0 + travel * 0.22 * intensity
		emitter.color = Color(
			smoke_colour.r, smoke_colour.g, smoke_colour.b,
			smoke_colour.a * (0.45 + 0.55 * intensity))


# ---------------------------------------------------------------------------
# Spray
# ---------------------------------------------------------------------------

func _build_spray(puff: Texture2D) -> void:
	_spray = CPUParticles3D.new()
	_spray.name = "WetSpray"
	_spray.local_coords = false
	_spray.amount = spray_amount
	_spray.lifetime = spray_lifetime
	_spray.explosiveness = 0.0
	_spray.randomness = 0.7
	_spray.emitting = false

	# Spray is thrown up and backwards off the tyres, then falls.
	_spray.direction = Vector3(0.0, 0.55, 1.0).normalized()
	_spray.spread = 42.0
	_spray.initial_velocity_min = 1.5
	_spray.initial_velocity_max = 6.0
	_spray.gravity = Vector3(0.0, -6.0, 0.0)
	_spray.damping_min = 0.4
	_spray.damping_max = 1.2
	_spray.scale_amount_min = 0.18
	_spray.scale_amount_max = 0.55
	_spray.color = spray_colour
	_spray.mesh = _make_quad(puff)

	add_child(_spray)


func _update_spray() -> void:
	if _spray == null:
		return

	# Only a wet track throws water, and only once you are moving.
	var wet_factor := clampf(wetness, 0.0, 1.0) * clampf(car.speed_01 * 1.6, 0.0, 1.0)
	var should_emit := wet_factor > 0.05

	if should_emit != _emitting_spray:
		_emitting_spray = should_emit
		_spray.emitting = should_emit

	if not should_emit:
		return

	_spray.global_position = car.global_position + Vector3.UP * 0.25
	_spray.color = Color(
		spray_colour.r, spray_colour.g, spray_colour.b,
		spray_colour.a * wet_factor)

	# A rooster tail grows with speed.
	_spray.initial_velocity_max = 3.0 + 9.0 * car.speed_01


# ---------------------------------------------------------------------------
# Brake lights
# ---------------------------------------------------------------------------

func _build_brake_lights() -> void:
	if car.body_visual == null:
		return

	# The body is built by the car as "Body/BodyMesh"; the length tells us where
	# the rear is. Forward is -Z in Godot, so the rear is +Z.
	var half_length := car.placeholder_body_size.z * 0.5
	var half_width := car.placeholder_body_size.x * 0.5

	for side in [-1.0, 1.0]:
		var lens := MeshInstance3D.new()
		lens.name = "BrakeLight"

		var quad := QuadMesh.new()
		quad.size = Vector2(car.placeholder_body_size.x * 0.30, 0.16)
		lens.mesh = quad

		var material := StandardMaterial3D.new()
		material.albedo_color = Color(brake_colour.r * 0.25, 0.02, 0.02)
		material.emission_enabled = true
		material.emission = brake_colour
		material.emission_energy_multiplier = 0.0
		material.shading_mode = BaseMaterial3D.SHADING_MODE_UNSHADED
		material.cull_mode = BaseMaterial3D.CULL_DISABLED
		lens.material_override = material

		# The quad faces +Z, which is the rear, so no rotation is needed.
		lens.position = Vector3(side * half_width * 0.62, 0.02, half_length * 0.99)
		car.body_visual.add_child(lens)

		_brake_materials.append(material)


func _update_brake_lights() -> void:
	if _brake_materials.is_empty():
		return

	# Tail lights are dimly on whenever the car is running; braking lights them
	# properly. That distinction is what makes it read as a brake light.
	var energy := 0.35 + (brake_emission_energy - 0.35) * clampf(car.brake_input, 0.0, 1.0)

	for material in _brake_materials:
		material.emission_energy_multiplier = energy


# ---------------------------------------------------------------------------
# Asset-free textures and meshes
# ---------------------------------------------------------------------------

## A soft radial puff. A particle without a texture is a hard-edged square, which
## is why the generated gradient matters: the mesh is a quad and the gradient
## gives it soft edges.
func _make_puff_texture() -> Texture2D:
	var gradient := Gradient.new()
	gradient.set_color(0, Color(1.0, 1.0, 1.0, 1.0))
	gradient.set_color(1, Color(1.0, 1.0, 1.0, 0.0))

	var texture := GradientTexture2D.new()
	texture.gradient = gradient
	texture.width = 128
	texture.height = 128
	texture.fill = GradientTexture2D.FILL_RADIAL
	texture.fill_from = Vector2(0.5, 0.5)
	texture.fill_to = Vector2(1.0, 0.5)

	return texture


func _make_quad(texture: Texture2D) -> QuadMesh:
	var quad := QuadMesh.new()
	quad.size = Vector2.ONE

	var material := StandardMaterial3D.new()
	material.albedo_texture = texture
	material.transparency = BaseMaterial3D.TRANSPARENCY_ALPHA
	material.shading_mode = BaseMaterial3D.SHADING_MODE_UNSHADED
	material.billboard_mode = BaseMaterial3D.BILLBOARD_ENABLED
	material.vertex_color_use_as_albedo = true
	material.cull_mode = BaseMaterial3D.CULL_DISABLED
	material.disable_receive_shadows = true
	quad.material = material

	return quad
