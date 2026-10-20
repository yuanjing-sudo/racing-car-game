class_name TDCSkidMarks
extends MultiMeshInstance3D

## Rubber laid down by the rear tyres, built from code like everything else here.
##
## A fixed MultiMesh pool of unit cubes, one instance per segment. Each frame the
## rear contact patches are read; while the tyres are sliding, a segment is
## written every segment_spacing metres between the wheel's last point and its
## current one. A box stretched between two points is a quad without the winding
## and buffer bookkeeping, and MultiMesh keeps the whole trail in one draw call.
##
## What drives it:
##
##   rear slip angle   car.rear_slip_angle above min_slip_degrees, so a handbrake
##                     slide marks the road
##   combined slip     car.tyre_slip_01 above min_slip_01, which catches wheelspin
##                     on a straight line where the slip angle is nearly zero
##   speed             above min_speed_kmh, so parking-lot pivots leave nothing
##
## The pool covers about 440 m of sliding at the default spacing and then
## overwrites oldest first. Marks are permanent, because rubber is; they thin out
## in the wet instead of fading, because that is what happens to rubber on water.
##
## The node is top-level and sits at the world origin, so the marks stay anchored
## to the road if the bootstrap that created them is ever moved.

@export_group("Source")

## The car to read telemetry and wheel positions from.
@export var car: TDCPlayerCar

@export_group("Pool")

## Instances in the ring buffer. 800 at 0.55 m spacing covers about 440 m.
@export_range(16, 4000, 1) var max_segments: int = 800

## Metres between the centres of successive segments.
@export_range(0.05, 3.0, 0.05) var segment_spacing: float = 0.55

@export_group("Shape")

## Tyre width in metres.
@export_range(0.02, 1.0, 0.01) var mark_width: float = 0.26

## Metres above the contact patch. The patch is 2 cm under the body's underside,
## so 4 cm puts rubber 2 cm over the road.
@export_range(0.0, 0.2, 0.005) var mark_lift: float = 0.04

## Thickness of the segment in metres. Thicker is easier to see; thinner cannot
## ever poke through a crest.
@export_range(0.001, 0.05, 0.001) var mark_thickness: float = 0.006

@export_group("Trigger")

@export_range(0.0, 60.0, 1.0) var min_slip_degrees: float = 9.0

@export_range(0.0, 1.0, 0.01) var min_slip_01: float = 0.32

@export var min_speed_kmh: float = 40.0

@export_group("Look")

@export var rubber_colour := Color(0.018, 0.018, 0.02, 1.0)

## Wet rubber is thinner and greyer, so marks narrow as wetness rises.
@export_range(0.0, 1.0, 0.01) var wet_width_loss: float = 0.45

var _last_point: Array[Vector3] = [Vector3.ZERO, Vector3.ZERO]
var _has_last: Array[bool] = [false, false]
var _next_segment: int = 0


func _ready() -> void:
	# Anchored to the world, not to the bootstrap that created us.
	top_level = true
	global_transform = Transform3D.IDENTITY

	_build_multimesh()


func _build_multimesh() -> void:
	max_segments = clampi(max_segments, 16, 4000)

	var box := BoxMesh.new()
	box.size = Vector3.ONE

	multimesh = MultiMesh.new()
	multimesh.transform_format = MultiMesh.TRANSFORM_3D
	multimesh.mesh = box
	multimesh.instance_count = max_segments
	multimesh.visible_instance_count = max_segments

	var material := StandardMaterial3D.new()
	material.resource_name = "TDC Skid Mark Rubber"
	material.albedo_color = rubber_colour
	material.roughness = 0.95
	material.metallic = 0.0

	material_override = material

	# The pool is written a segment at a time, so the automatic AABB would be
	# stale for most of the lap and the marks would pop out of view. A generous
	# custom box costs nothing and keeps them always drawn.
	custom_aabb = AABB(Vector3(-2000.0, -500.0, -2000.0), Vector3(4000.0, 1000.0, 4000.0))
	cast_shadow = GeometryInstance3D.SHADOW_CASTING_SETTING_OFF

	for index in max_segments:
		multimesh.set_instance_transform(index, _hidden_transform())

	_next_segment = 0
	_has_last = [false, false]


func _process(_delta: float) -> void:
	if car == null or multimesh == null:
		return

	var sliding := (
		absf(rad_to_deg(car.rear_slip_angle)) > min_slip_degrees
		or car.tyre_slip_01 > min_slip_01
	)
	var marking := sliding and car.absolute_speed_kmh > min_speed_kmh

	for side in 2:
		# 2 = rear left, 3 = rear right, matching TDCPlayerCar's wheel order.
		var contact := car.wheel_contact_point(side + 2) + Vector3.UP * mark_lift

		if not marking:
			_has_last[side] = false
			continue

		if not _has_last[side]:
			_last_point[side] = contact
			_has_last[side] = true
			continue

		var previous: Vector3 = _last_point[side]
		var flat := contact - previous
		flat.y = 0.0

		if flat.length() < segment_spacing:
			continue

		_write_segment(previous, contact)
		_last_point[side] = contact


func _write_segment(a: Vector3, b: Vector3) -> void:
	var delta := b - a
	delta.y = 0.0

	var length := delta.length()
	if length < 0.05:
		return

	# Godot looks down -Z, so a segment pointing along +Z needs a yaw of atan2(0, 1)
	# = 0, and the box's local Z maps onto the segment.
	var yaw := atan2(delta.x, delta.z)
	var wetness := clampf(car.wetness, 0.0, 1.0) if car != null else 0.0
	var width := mark_width * lerpf(1.0, 1.0 - wet_width_loss, wetness)

	var basis := Basis(Vector3.UP, yaw) * Basis.from_scale(
		Vector3(width, mark_thickness, length + 0.01)
	)
	var origin := (a + b) * 0.5

	multimesh.set_instance_transform(_next_segment, Transform3D(basis, origin))
	_next_segment = (_next_segment + 1) % max_segments


func _hidden_transform() -> Transform3D:
	return Transform3D(Basis().scaled(Vector3.ONE * 0.0001), Vector3(0.0, -1000.0, 0.0))


## Wipe every mark and restart the ring buffer.
func clear_marks() -> void:
	if multimesh == null:
		return

	for index in max_segments:
		multimesh.set_instance_transform(index, _hidden_transform())

	_next_segment = 0
	_has_last = [false, false]
