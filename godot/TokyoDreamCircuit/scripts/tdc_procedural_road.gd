class_name TDCProceduralRoad
extends Node3D

## Generates a drivable road surface as a procedural mesh, swept along a
## centreline, with a trimesh collider for physics.
##
## Three ways to use it, all of them live:
##
##   build_default_circuit()  a closed loop with no self-intersections.
##   build_straight_road()    a long open road along +Z, built from road_length,
##                            curve_amplitude and elevation_amplitude.
##   author the centreline    set the control points and call rebuild();
##                            whatever you author is what gets swept.
##
## Banking comes from the real curvature of the road rather than being dialled in
## per sample, and is clamped to bank_degrees, so corners lean the right way on
## their own.
##
## Everything is in metres, like the Unreal and Unity versions. Unlike them,
## Godot is RIGHT-HANDED, which changes two things in this file - see the comments
## on the lateral basis and on the triangle winding.

enum RoadShape { STRAIGHT, CIRCUIT }

# ---------------------------------------------------------------------------
# Shape
# ---------------------------------------------------------------------------

@export var shape: RoadShape = RoadShape.CIRCUIT

## Total width of the road surface, in metres.
@export_range(0.1, 60.0, 0.1) var road_width: float = 12.0

## Number of segments along the swept mesh. Higher = smoother, more triangles.
@export_range(2, 4000, 1) var segments: int = 512

## Extra subdivision between each pair of profile points, across the road.
@export_range(1, 16, 1) var lateral_subdivisions: int = 4

## How far the surface texture repeats along the road, in metres.
@export var uv_tiling: float = 12.0

## Cross-section as (lateral fraction, height offset). -0.5 is the left edge,
## +0.5 the right edge, 0 the centreline, scaled by road_width. The default
## crowns the middle so water drains to the sides.
@export var profile: Array[Vector2] = []

## Closed circuit (true) or a length of open road (false).
@export var closed_loop: bool = true

## Flip the triangle winding if the road renders inside-out or unlit. See the
## long comment in _build_mesh() - this is a one-click fix for the one thing in
## this file that cannot be verified without running the engine.
@export var flip_winding: bool = false

# ---------------------------------------------------------------------------
# Banking
# ---------------------------------------------------------------------------

## Hard limit on bank angle, in degrees. The road rolls into corners up to this
## much, and the roll comes from the measured curvature.
@export_range(0.0, 30.0, 0.1) var bank_degrees: float = 12.0

## How strongly curvature rolls the road, in metres. Larger reaches bank_degrees
## on gentler curves.
@export var banking_scale: float = 40.0

# ---------------------------------------------------------------------------
# Generators
# ---------------------------------------------------------------------------

## Length of the generated open road, in metres.
@export var road_length: float = 180.0

## Distance between control points on the generated open road, in metres.
@export var sample_spacing: float = 1.0

## Lateral wander of the generated open road, in metres.
@export var curve_amplitude: float = 17.0

## Vertical amplitude of the generated open road, in metres.
@export var elevation_amplitude: float = 9.0

## Rough radius of the generated circuit, in metres.
@export var circuit_radius: float = 600.0

## Number of control points in the generated circuit.
@export_range(8, 256, 1) var circuit_points: int = 28

## 0 = perfect circle, 1 = very twisty. Drives the harmonic sum.
@export_range(0.0, 1.0, 0.01) var curvature: float = 0.28

## Randomisation seed for the generated circuit.
@export var circuit_seed: int = 1337

## Build as soon as the node enters the tree.
@export var build_on_ready: bool = true

# ---------------------------------------------------------------------------
# Result
# ---------------------------------------------------------------------------

## Total length of the centreline, in metres. Updated on rebuild.
var track_length: float = 0.0

var _control_points := PackedVector3Array()
var _centreline := PackedVector3Array()
var _cumulative := PackedFloat32Array()
var _cross_section: Array[Vector2] = []

var _mesh_instance: MeshInstance3D
var _body: StaticBody3D
var _collider: CollisionShape3D


func _ready() -> void:
	_ensure_children()
	_ensure_profile()
	if build_on_ready:
		if shape == RoadShape.CIRCUIT:
			build_default_circuit()
		else:
			build_straight_road()


# ---------------------------------------------------------------------------
# Generators
# ---------------------------------------------------------------------------

## Regenerate the mesh from the current centreline and settings.
func rebuild() -> void:
	_ensure_children()
	_ensure_profile()

	if _control_points.size() < 2:
		_generate_control_points()

	_build_centreline()
	_build_mesh()


## Discard the centreline and build the open road described by road_length,
## curve_amplitude and elevation_amplitude. This is the original starter layout:
## a road running along +Z that wanders laterally and rises and falls, both as
## smooth sine functions of distance so the curve is continuous and has no kinks.
func build_straight_road() -> void:
	shape = RoadShape.STRAIGHT
	closed_loop = false
	_generate_control_points()
	rebuild()


## Discard the centreline and build a fresh closed circuit.
func build_default_circuit() -> void:
	shape = RoadShape.CIRCUIT
	closed_loop = true
	_generate_control_points()
	rebuild()


func _generate_control_points() -> void:
	_control_points = PackedVector3Array()

	if shape == RoadShape.CIRCUIT:
		var count := maxi(8, circuit_points)
		var rng := RandomNumberGenerator.new()
		rng.seed = circuit_seed
		var phase3 := rng.randf() * TAU
		var phase5 := rng.randf() * TAU
		var phase_y := rng.randf() * TAU

		for i in range(count):
			var angle := TAU * float(i) / float(count)

			# Integer harmonics keep the loop seamless and prevent the
			# self-intersection and zero-radius cusps you get from arbitrary
			# wiggles.
			var radius := circuit_radius
			radius += circuit_radius * curvature * sin(3.0 * angle + phase3)
			radius += circuit_radius * 0.5 * curvature * sin(5.0 * angle + phase5)

			var y := elevation_amplitude * sin(2.0 * angle + phase_y)
			y += elevation_amplitude * 0.35 * sin(4.0 * angle)

			_control_points.append(Vector3(cos(angle) * radius, y, sin(angle) * radius))
		return

	# Open road. The starter used 100 cm spacing over 18000 cm; that is 1 m over
	# 180 m here.
	var steps := maxi(20, int(ceil(road_length / maxf(0.1, sample_spacing))))
	for i in range(steps + 1):
		var distance := road_length * float(i) / float(steps)
		var t := distance / maxf(0.1, road_length) * TAU

		var x := curve_amplitude * 0.45 * sin(t)
		var y := elevation_amplitude * sin(t)
		y += elevation_amplitude * 0.24 * sin(2.0 * t + 0.6)

		_control_points.append(Vector3(x, y, distance))


# ---------------------------------------------------------------------------
# Centreline
# ---------------------------------------------------------------------------

func _build_centreline() -> void:
	_centreline = PackedVector3Array()
	_cumulative = PackedFloat32Array()

	var count := _control_points.size()
	if count < 2:
		track_length = 0.0
		return

	# Dense, smooth path through the control points. Catmull-Rom passes through
	# every control point, which a bezier does not, so the road stays where you
	# put it.
	var subdivisions := maxi(2, segments / count)
	var segment_count := count if closed_loop else count - 1

	for i in range(segment_count):
		var p0 := _control_points[_wrap_index(i - 1, count)]
		var p1 := _control_points[_wrap_index(i, count)]
		var p2 := _control_points[_wrap_index(i + 1, count)]
		var p3 := _control_points[_wrap_index(i + 2, count)]

		for s in range(subdivisions):
			var t := float(s) / float(subdivisions)
			_centreline.append(_catmull_rom(p0, p1, p2, p3, t))

	if not closed_loop:
		_centreline.append(_control_points[count - 1])

	# Arc length table, so the mesh can be swept at even spacing regardless of
	# how the control points are distributed.
	_cumulative.append(0.0)
	var total := 0.0
	for i in range(1, _centreline.size()):
		total += _centreline[i - 1].distance_to(_centreline[i])
		_cumulative.append(total)

	track_length = total


func _wrap_index(index: int, count: int) -> int:
	if closed_loop:
		return ((index % count) + count) % count
	return clampi(index, 0, count - 1)


static func _catmull_rom(p0: Vector3, p1: Vector3, p2: Vector3, p3: Vector3, t: float) -> Vector3:
	var t2 := t * t
	var t3 := t2 * t

	return 0.5 * (
		2.0 * p1
		+ (-p0 + p2) * t
		+ (2.0 * p0 - 5.0 * p1 + 4.0 * p2 - p3) * t2
		+ (-p0 + 3.0 * p1 - 3.0 * p2 + p3) * t3)


# ---------------------------------------------------------------------------
# Sampling
# ---------------------------------------------------------------------------

## Position on the centreline at a given distance along it.
func point_at(distance: float) -> Vector3:
	var count := _centreline.size()
	if count == 0:
		return Vector3.ZERO
	if count == 1:
		return _centreline[0]

	var d := distance
	if closed_loop:
		d = fposmod(d, maxf(0.0001, track_length))
	else:
		d = clampf(d, 0.0, track_length)

	var lo := 0
	var hi := count - 1
	while lo < hi - 1:
		var mid := (lo + hi) / 2
		if _cumulative[mid] <= d:
			lo = mid
		else:
			hi = mid

	var span := _cumulative[hi] - _cumulative[lo]
	var t := 0.0 if span <= 0.000001 else (d - _cumulative[lo]) / span
	return _centreline[lo].lerp(_centreline[hi], t)


## Unit tangent on the centreline at a given distance along it.
func tangent_at(distance: float) -> Vector3:
	var step := maxf(0.01, track_length / float(maxi(2, segments)) * 0.5)
	var ahead := point_at(distance + step)
	var behind := point_at(distance - step)
	var tangent := ahead - behind
	if tangent.length_squared() < 0.00000001:
		tangent = Vector3.FORWARD
	return tangent.normalized()


## Signed lateral offset of a world position from the centreline, in metres.
## Positive is to the right of the direction of travel.
func lateral_offset_of(world_position: Vector3) -> float:
	if _centreline.size() < 2:
		return 0.0

	var best_index := 0
	var best := INF
	for i in range(_centreline.size()):
		var d := _centreline[i].distance_squared_to(world_position)
		if d < best:
			best = d
			best_index = i

	var tangent := tangent_at(_cumulative[best_index])
	var right := tangent.cross(Vector3.UP).normalized()
	return (world_position - _centreline[best_index]).dot(right)


# ---------------------------------------------------------------------------
# Mesh
# ---------------------------------------------------------------------------

func _ensure_children() -> void:
	if _mesh_instance == null:
		_mesh_instance = MeshInstance3D.new()
		_mesh_instance.name = "RoadSurface"
		add_child(_mesh_instance)

	if _body == null:
		_body = StaticBody3D.new()
		_body.name = "RoadCollision"
		add_child(_body)

	if _collider == null:
		_collider = CollisionShape3D.new()
		_collider.name = "RoadShape"
		_body.add_child(_collider)


func _ensure_profile() -> void:
	if profile.size() >= 2:
		return

	# A gentle crown: the middle sits 4 cm proud of the edges, which is what real
	# roads do for drainage.
	profile = [
		Vector2(-0.5, -0.04),
		Vector2(-0.25, -0.01),
		Vector2(0.0, 0.0),
		Vector2(0.25, -0.01),
		Vector2(0.5, -0.04),
	]


func _build_cross_section() -> void:
	_cross_section = []

	var steps := maxi(1, lateral_subdivisions)
	var count := profile.size()

	for p in range(count - 1):
		var a := profile[p]
		var b := profile[p + 1]
		for k in range(steps):
			var t := float(k) / float(steps)
			_cross_section.append(a.lerp(b, t))

	_cross_section.append(profile[count - 1])


func _build_mesh() -> void:
	if _centreline.size() < 2 or track_length <= 0.0001:
		return

	_build_cross_section()
	var columns := _cross_section.size()
	if columns < 2:
		return

	var rows := maxi(2, segments) + 1
	var max_bank := deg_to_rad(maxf(0.0, bank_degrees))
	var step := maxf(0.01, track_length / float(maxi(2, segments)) * 0.5)
	var inv_rows := 1.0 / float(rows - 1)

	var st := SurfaceTool.new()
	st.begin(Mesh.PRIMITIVE_TRIANGLES)

	var positions := PackedVector3Array()

	for row in range(rows):
		var distance := track_length * float(row) * inv_rows

		var position := point_at(distance)
		var tangent := tangent_at(distance)

		# Godot is RIGHT-HANDED, so this is the opposite argument order to the
		# Unreal and Unity versions. In a right-handed Y-up basis, forward x up is
		# the right-hand vector; in the left-handed engines it is up x forward.
		# Getting it backwards mirrors the cross-section and banks every corner
		# the wrong way.
		var right := tangent.cross(Vector3.UP)
		if right.length_squared() < 0.00000001:
			right = tangent.cross(Vector3.BACK)
		right = right.normalized()

		# Curvature from how fast the tangent is turning, signed by which way it
		# turns.
		var bank_angle := 0.0
		if banking_scale > 0.0 and max_bank > 0.0:
			var ahead_tangent := tangent_at(distance + step)
			var behind_tangent := tangent_at(distance - step)
			var tangent_derivative := (ahead_tangent - behind_tangent) / (2.0 * step)
			var signed_curvature := tangent_derivative.dot(right)

			# Negative sign: the road leans into the corner, which raises the
			# outside edge.
			bank_angle = clampf(-signed_curvature * banking_scale, -max_bank, max_bank)

		var banked_right := right * cos(bank_angle) + Vector3.UP * sin(bank_angle)
		var banked_up := Vector3.UP * cos(bank_angle) - right * sin(bank_angle)

		var v := distance / maxf(0.1, uv_tiling)

		for column in range(columns):
			var point := _cross_section[column]
			var vertex := position
			vertex += banked_right * (point.x * road_width)
			vertex += banked_up * point.y

			positions.append(vertex)

			# Normals are set explicitly rather than generated, so the shading is
			# correct no matter which winding convention Godot actually uses. Only
			# back-face culling depends on the winding.
			st.set_uv(Vector2(point.x + 0.5, v))
			st.set_normal(banked_up)
			st.add_vertex(vertex)

	# -----------------------------------------------------------------------
	# Triangulation.
	#
	# Godot's documentation says it uses clockwise winding for front faces; an
	# open documentation issue (godot-docs#10757) reports that this is wrong and
	# that it is in fact counter-clockwise, which is what a right-handed engine
	# with the OpenGL default (GL_CCW) would do. This order follows the
	# counter-clockwise reading, derived rather than copied:
	#
	#   right-handed system, normal = (b - a) x (c - a) points at the viewer
	#   lateral R = tangent x up, rows advance along the tangent
	#   -> (i0, i1, i2) gives a normal of exactly +UP
	#
	# Note this is a DIFFERENT order to the Unreal and Unity ports, which use
	# (i0, i2, i3) and (i0, i3, i1). That is not a typo: those are left-handed.
	#
	# If the road is invisible from above (you will see through it), tick
	# flip_winding - that inverts both triangles and fixes the culling.
	# -----------------------------------------------------------------------
	var faces := PackedVector3Array()

	for row in range(rows - 1):
		for column in range(columns - 1):
			var i0 := row * columns + column
			var i1 := i0 + 1
			var i2 := (row + 1) * columns + column
			var i3 := i2 + 1

			if not flip_winding:
				st.add_index(i0)
				st.add_index(i1)
				st.add_index(i2)

				st.add_index(i1)
				st.add_index(i3)
				st.add_index(i2)

				faces.append(positions[i0])
				faces.append(positions[i1])
				faces.append(positions[i2])
				faces.append(positions[i1])
				faces.append(positions[i3])
				faces.append(positions[i2])
			else:
				st.add_index(i0)
				st.add_index(i2)
				st.add_index(i1)

				st.add_index(i1)
				st.add_index(i2)
				st.add_index(i3)

				faces.append(positions[i0])
				faces.append(positions[i2])
				faces.append(positions[i1])
				faces.append(positions[i1])
				faces.append(positions[i2])
				faces.append(positions[i3])

	var mesh: ArrayMesh = st.commit()
	if mesh == null:
		push_error("TDCProceduralRoad: SurfaceTool.commit() failed")
		return

	_mesh_instance.mesh = mesh

	# Collision is built from the same triangle list, so it cannot drift out of
	# step with the visuals. Concave shapes are not winding-sensitive.
	var shape_resource := ConcavePolygonShape3D.new()
	shape_resource.set_faces(faces)
	_collider.shape = shape_resource


## Apply a material to the road surface.
func set_surface_material(material: Material) -> void:
	_ensure_children()
	_mesh_instance.material_override = material
