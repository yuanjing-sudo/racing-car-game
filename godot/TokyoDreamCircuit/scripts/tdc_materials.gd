class_name TDCMaterials
extends RefCounted

## Materials for the placeholder scene.
##
## One naming trap worth knowing when reading across the three ports: Godot and
## Unreal both expose "roughness", but Unity exposes "smoothness", which is its
## inverse. The Unreal and Unity versions use smoothness 0.85 for wet asphalt;
## the equivalent here is roughness 0.15.


## Wet asphalt: very dark with a low roughness, so it mirrors the neon above it.
## That mirror is most of the look, and it is why roughness matters more than the
## base colour.
static func wet_asphalt() -> StandardMaterial3D:
	var material := StandardMaterial3D.new()
	material.resource_name = "TDC Wet Asphalt"
	material.albedo_color = Color(0.035, 0.036, 0.040)
	material.roughness = 0.15
	material.metallic = 0.0
	material.metallic_specular = 0.8
	return material


static func car_paint(colour: Color) -> StandardMaterial3D:
	var material := StandardMaterial3D.new()
	material.resource_name = "TDC Car Paint"
	material.albedo_color = colour
	material.roughness = 0.12
	material.metallic = 0.35
	material.clearcoat_enabled = true
	material.clearcoat = 0.6
	return material


static func tyre() -> StandardMaterial3D:
	var material := StandardMaterial3D.new()
	material.resource_name = "TDC Tyre"
	material.albedo_color = Color(0.02, 0.02, 0.022)
	material.roughness = 0.85
	material.metallic = 0.0
	return material


static func ground() -> StandardMaterial3D:
	var material := StandardMaterial3D.new()
	material.resource_name = "TDC Ground"
	material.albedo_color = Color(0.02, 0.021, 0.024)
	material.roughness = 0.8
	return material


## Frictionless physics material for the car body. The tyre model supplies all
## the grip, so the engine's own contact friction must not add a second, invisible
## one on top of it.
static func slick() -> PhysicsMaterial:
	var material := PhysicsMaterial.new()
	material.resource_name = "TDC Slick"
	material.friction = 0.0
	material.bounce = 0.0
	return material
