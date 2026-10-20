class_name TDCSceneBootstrap
extends Node3D

## Builds the whole demo scene at runtime: road, car, chase camera and night
## lighting. Attach this one script to an empty Node3D, press F5, and you are
## driving. No asset wiring, no prefabs, no scene authoring.
##
## It is the Godot answer to the Unreal project's SCENE_SETUP_CHECKLIST.txt and
## the Unity project's TDCSceneBootstrap: the same scene, built by code so it
## cannot drift out of step with the scripts. Everything it creates is a normal
## node you can select in the remote inspector and tweak while the game runs.
##
## The scene file in scenes/tokyo_night_run.tscn is this script and nothing else,
## which is why it is 6 lines. That is deliberate: the smaller the hand-written
## .tscn, the less there is to get wrong, given it was authored without an editor.

@export_group("Road")

@export var shape: TDCProceduralRoad.RoadShape = TDCProceduralRoad.RoadShape.CIRCUIT

## Road width in metres.
@export var road_width: float = 12.0

## Circuit radius in metres. Only used by the closed circuit.
@export var circuit_radius: float = 600.0

@export_group("Car")

@export var car_colour := Color(0.55, 0.06, 0.09)

## How far above the road the car starts, in metres. It drops onto the surface.
@export var car_spawn_height: float = 1.0

## 0 = bone dry, 1 = standing water. Feeds both the tyre model and the spray FX,
## so the grip, the sound and the visuals stay consistent with one number.
@export_range(0.0, 1.0, 0.01) var wetness: float = 0.0

@export_group("Night lighting")

@export var sky_colour := Color(0.012, 0.016, 0.030)

## Directional light colour. Slightly blue for a moonlit sky.
@export var moon_colour := Color(0.62, 0.72, 1.0)

## Directional light energy. Godot's is roughly comparable to Unreal's lux value
## divided by a large constant, so this is a small number, not a big one.
@export var moon_energy: float = 0.28

## Ambient light, filling the shadows. Keep it dim for night.
@export var ambient_colour := Color(0.055, 0.065, 0.095)

## Fog colour, roughly the colour of the city glow on the horizon.
@export var fog_colour := Color(0.035, 0.045, 0.065)

## Fog density. 0 disables fog.
@export var fog_density: float = 0.0022

@export_group("Quality")

## Screen-space global illumination. The big win for the neon-on-wet-asphalt
## look, and the biggest cost. Turn it off first if the frame rate hurts.
@export var sdfgi_enabled: bool = true

## Screen-space reflections, for the wet road mirroring the city.
@export var ssr_enabled: bool = true

@export var ssao_enabled: bool = true
@export var glow_enabled: bool = true

@export_group("Audio")

@export var audio_enabled: bool = true

## Master volume of the synthesised mix.
@export_range(0.0, 1.0, 0.01) var audio_gain: float = 0.32

@export_group("FX")

@export var fx_enabled: bool = true

## Build the pooled skid marks. Independent of fx_enabled, so the rubber can stay
## while the smoke is off.
@export var skid_marks_enabled: bool = true

## The road this bootstrap created.
var road: TDCProceduralRoad

## The car this bootstrap created.
var car: TDCPlayerCar

## The chase camera this bootstrap created.
var camera: TDCChaseCamera

## The synthesised audio source this bootstrap created.
var engine_audio: TDCEngineAudio

## The particles and lights this bootstrap created.
var vehicle_fx: TDCVehicleFX

## The pooled skid marks this bootstrap created.
var skid_marks: TDCSkidMarks


func _ready() -> void:
	_assert_gravity()
	DisplayServer.window_set_title("Tokyo Dream Circuit - Godot")

	_build_environment()
	_build_moon()
	_build_road()
	_build_ground()
	_build_car()
	_build_camera()
	_build_audio()
	_build_fx()
	_build_skid_marks()


## Tear the whole scene down and build it again. Handy while tuning numbers: call
## it from the remote inspector's "Call" box, or bind it to a key.
func rebuild() -> void:
	for child in get_children():
		child.queue_free()

	road = null
	car = null
	camera = null
	engine_audio = null
	vehicle_fx = null
	skid_marks = null

	# queue_free defers to the end of the frame, so the new nodes would collide by
	# name with the old ones. Rename them out of the way first.
	await get_tree().process_frame
	_ready()


## The whole tyre model is tuned in SI at 9.81 m/s^2. Asserting it here means a
## stray project setting shows up as an obvious handling change rather than a
## mystery.
func _assert_gravity() -> void:
	var gravity := float(ProjectSettings.get_setting("physics/3d/default_gravity", 9.81))
	if absf(gravity - 9.81) > 0.01:
		push_warning(
			"TDCSceneBootstrap: physics/3d/default_gravity is %.2f, not 9.81. The tyre model's " % gravity
			+ "friction circle will be scaled by that, so the car will brake and corner differently.")


# ---------------------------------------------------------------------------
# Environment
# ---------------------------------------------------------------------------

func _build_environment() -> void:
	var environment := Environment.new()
	environment.resource_name = "TDC Night"

	environment.background_mode = Environment.BG_COLOR
	environment.background_color = sky_colour

	environment.ambient_light_source = Environment.AMBIENT_SOURCE_COLOR
	environment.ambient_light_color = ambient_colour
	environment.ambient_light_energy = 1.0

	# ACES keeps the neon highlights from clipping to white, which is most of the
	# difference between "bright" and "cinematic".
	environment.tonemap_mode = Environment.TONE_MAPPER_ACES
	environment.tonemap_white = 3.0

	environment.ssao_enabled = ssao_enabled
	if ssao_enabled:
		environment.ssao_radius = 1.4
		environment.ssao_intensity = 1.6

	environment.ssil_enabled = ssao_enabled

	environment.ssr_enabled = ssr_enabled
	if ssr_enabled:
		environment.ssr_max_steps = 64
		environment.ssr_fade_in = 2.0
		environment.ssr_fade_out = 40.0

	environment.sdfgi_enabled = sdfgi_enabled
	if sdfgi_enabled:
		environment.sdfgi_cascades = Environment.SDFGI_CASCADES_6
		environment.sdfgi_min_cell_size = 0.3
		environment.sdfgi_bounce_feedback = 0.5

	environment.glow_enabled = glow_enabled
	if glow_enabled:
		environment.glow_intensity = 0.9
		environment.glow_bloom = 0.18
		environment.glow_hdr_threshold = 0.85
		environment.glow_blend_mode = Environment.GLOW_BLEND_MODE_ADDITIVE

	environment.fog_enabled = fog_density > 0.0
	environment.fog_mode = Environment.FOG_MODE_EXPONENTIAL
	environment.fog_light_color = fog_colour
	environment.fog_density = fog_density
	environment.fog_sun_scatter = 0.1

	var world := WorldEnvironment.new()
	world.name = "TDC Environment"
	world.environment = environment
	add_child(world)


func _build_moon() -> void:
	var moon := DirectionalLight3D.new()
	moon.name = "TDC Moon"
	moon.light_color = moon_colour
	moon.light_energy = moon_energy
	moon.shadow_enabled = true
	moon.directional_shadow_mode = DirectionalLight3D.SHADOW_PARALLEL_4_SPLITS
	moon.directional_shadow_max_distance = 400.0

	add_child(moon)

	# Low and to one side, so the road is raked rather than flatly lit.
	moon.rotation_degrees = Vector3(-22.0, 145.0, 0.0)


# ---------------------------------------------------------------------------
# Road and ground
# ---------------------------------------------------------------------------

func _build_road() -> void:
	road = TDCProceduralRoad.new()
	road.name = "TDC Road"

	# Fields are set before the node enters the tree, because _ready() runs on
	# add_child() and would otherwise build the road with the defaults.
	road.shape = shape
	road.road_width = road_width
	road.circuit_radius = circuit_radius
	road.closed_loop = shape == TDCProceduralRoad.RoadShape.CIRCUIT
	road.build_on_ready = false

	add_child(road)

	if shape == TDCProceduralRoad.RoadShape.CIRCUIT:
		road.build_default_circuit()
	else:
		road.build_straight_road()

	road.set_surface_material(TDCMaterials.wet_asphalt())


func _build_ground() -> void:
	# A wide, dark apron so the car never falls off the edge of the world and the
	# fog has something to sit on. The road sits on top of it.
	var ground := MeshInstance3D.new()
	ground.name = "TDC Ground"

	var plane := PlaneMesh.new()
	var extent := maxf(400.0, circuit_radius * 2.4)
	plane.size = Vector2(extent, extent)
	ground.mesh = plane
	ground.material_override = TDCMaterials.ground()
	ground.position = Vector3(0.0, -0.25, 0.0)

	add_child(ground)


# ---------------------------------------------------------------------------
# Car, camera, audio, FX
# ---------------------------------------------------------------------------

func _build_car() -> void:
	car = TDCPlayerCar.new()
	car.name = "TDC Car"
	car.placeholder_car_colour = car_colour
	car.wetness = wetness

	# _ready() builds the placeholder body and wheels, so the colour has to be set
	# before this line.
	add_child(car)

	# Start on the centreline, pointing along the track.
	var tangent := road.tangent_at(0.0)
	if tangent.length_squared() < 0.000001:
		tangent = Vector3.FORWARD

	# Godot's Basis.looking_at aligns the node's -Z with the direction given, and
	# -Z is a Node3D's forward, so this points the car down the road.
	var origin := road.point_at(0.0) + Vector3.UP * car_spawn_height
	car.set_spawn(origin, Basis.looking_at(tangent, Vector3.UP))


func _build_camera() -> void:
	var existing := get_viewport().get_camera_3d()

	# Reuse the scene's camera if there already is one, so this does not fight with
	# a rig the user has set up.
	if existing is TDCChaseCamera:
		camera = existing as TDCChaseCamera
	else:
		camera = TDCChaseCamera.new()
		camera.name = "TDC Camera"
		add_child(camera)

	# Keep the FOV ramp's idea of "flat out" in step with the car's real limit.
	camera.reference_top_speed_kmh = car.max_speed_kmh

	# target has to be set before _ready() snaps the camera into place.
	camera.set_target(car, true)


func _build_audio() -> void:
	if not audio_enabled:
		return

	engine_audio = TDCEngineAudio.new()
	engine_audio.name = "TDC Engine Audio"
	engine_audio.car = car
	engine_audio.master_gain = audio_gain

	add_child(engine_audio)


func _build_fx() -> void:
	if not fx_enabled:
		return

	vehicle_fx = TDCVehicleFX.new()
	vehicle_fx.name = "TDC Vehicle FX"
	vehicle_fx.car = car
	vehicle_fx.wetness = wetness

	add_child(vehicle_fx)


func _build_skid_marks() -> void:
	if not skid_marks_enabled:
		return

	skid_marks = TDCSkidMarks.new()
	skid_marks.name = "TDC Skid Marks"
	skid_marks.car = car

	add_child(skid_marks)
