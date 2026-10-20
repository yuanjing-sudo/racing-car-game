# Realism in Godot — what is on, what to turn on, and what is not there

Companion to the Unreal project's `REALISM.md` and the Unity project's
`REALISM_UNITY.md`. The three describe the same target look — neon over wet
asphalt at night, seen from a car doing 300 km/h — reached three different ways.

## What the bootstrap already switches on

`tdc_scene_bootstrap.gd` builds an `Environment` with these set. Nothing is
disabled to begin with except volumetric fog.

| Setting | Value | Why |
| --- | --- | --- |
| Tonemap | ACES, white 3.0 | Keeps neon highlights from clipping to flat white |
| SDFGI | on, 6 cascades, 0.3 m cells | Real-time diffuse bounce — neon splashing onto the road |
| SSR | on, 64 steps | The wet road mirroring the city. This is most of the look |
| SSAO / SSIL | on, radius 1.4 | Contact shadows under the car, and light bleeding into the wheel wells |
| Glow | on, additive, bloom 0.18 | Makes emissive signage bloom, then feeds back into SDFGI |
| Fog | exponential, 0.0022 | Depth cueing so the far side of a 600 m circuit is not a wall of buildings |
| Shadows | directional, 4 splits, 400 m | Rakes the road so the banking reads |
| MSAA | 4× | Thin guard rails and wires are the usual aliasing complaint |
| Screen-space AA | FXAA | Cheap edge smoothing on top of MSAA |

The single most important line for the wet-road look is `ssr_enabled`. A dark
road with a high roughness looks like dry asphalt at night no matter what else is
on; a dark road with SSR and roughness 0.15 looks wet.

## The switches worth knowing

All on `TDCSceneBootstrap` in the inspector, or in `project.godot`.

| If you want | Do this | Cost |
| --- | --- | --- |
| Higher frame rate | `sdfgi_enabled = false` | Loses most of the bounce lighting; the biggest single win |
| Then more | `ssr_enabled = false`, MSAA to 2× | Shadows and a still-correct tonemap survive |
| Sharper motion | TAA instead of MSAA | **They are mutually exclusive in Godot.** Set MSAA to Disabled and turn on `rendering/anti_aliasing/quality/use_taa` |
| Cheaper than TAA at 4K | FSR2 | `rendering/scaling_3d/mode = fsr2`, then pick a scale |
| Thicker atmosphere | `volumetric_fog_enabled = true` | Noticeable cost; be selective about `volumetric_fog_density` |
| Stronger wetness | `wetness` on the bootstrap | Free. Also reduces grip and increases spray — all three together |

## Honest comparison across the three engines

| Feature | Unreal 5.5 | Unity + HDRP | Godot 4.6 |
| --- | --- | --- | --- |
| Real-time diffuse GI | **Lumen** | HDRP ray-traced / SSGI | SDFGI |
| Real-time reflections | Lumen reflections | HDRP SSR / ray-traced | SSR |
| Nanite-class geometry | **Nanite** | none | none |
| Virtual shadow maps | **yes** | indirect | no |
| Volumetric fog | yes | yes | yes |
| Temporal upscaler | **TSR** | DLSS / FSR | TAA / FSR2 |
| Procedural mesh hook | `UProceduralMeshComponent` | `Mesh` API | `SurfaceTool` / `ArrayMesh` |
| Runtime particle without assets | Niagara needs assets | `ParticleSystem` in code | `CPUParticles3D` in code |
| Audio without assets | `USynthComponent` | `OnAudioFilterRead` | `AudioStreamGenerator` |
| Cost | ~123 GB peak, an account, Windows-only launcher | ~25–40 GB | **~120 MB, no account** |

The two things Godot genuinely does not have are **Nanite** and **virtual shadow
maps**, and neither has a substitute. If your scene is millions of triangles,
that is the reason to use Unreal and not this. For a procedurally-generated
circuit this small, it does not matter: the road mesh is around 64,000 triangles
and the walls of the world are fog.

SDFGI is not Lumen. It is a voxel-based, cascaded radiance probe system: it
converges over about a second as you drive and it cannot resolve small emissive
detail the way Lumen's screen tracing can. What it does do is bounce a neon bank
sign's colour onto the road at 300 km/h, which is the effect being chased here.

## Implemented: skid marks

The item that used to be first on this list is now `tdc_skid_marks.gd`, and it is
the ribbon design described below. A `MultiMeshInstance3D` holds a fixed pool of
800 unit cubes; each is stretched between two successive rear contact patches
every 0.55 m of sliding, so a drift leaves two continuous lines and the whole
trail is one draw call. The pool covers about 440 m and then overwrites oldest
first. A custom AABB large enough for the circuit keeps the marks from being
culled while the camera looks away from the origin.

What it is not: a `Decal`. The boxes lie flat between their two contact points, so
they cannot wrap a crest, and the oldest marks disappear when the pool wraps.
There is no fade; rubber does not fade, so the oldest is simply overwritten.

## What is not there yet

Ordered by how much each would add, not by how hard it is.

### 1. Real geometry

The road is a swept prism and the car is a box. A bevel on the road edge, a
kerb, and armco with posts would do more for believability than any post effect.
All three are `SurfaceTool` sweeps, and the road already demonstrates the pattern.

### 2. Scenery

`_build_ground` makes one dark plane. A procedural city — extruded rectangles on
a parallax grid, plus a few landmark silhouettes — would give SDFGI and SSR
something to reflect and turn the fog from a grey wall into depth. This is the
biggest visual gap in all three ports.

### 3. Audio beyond the engine

`tdc_engine_audio.gd` synthesises the car. There is no tyre contact patch noise,
no gravel, no rain on the roof, no city ambience, no doppler on the roadside
objects you pass. The synthesiser already has a noise source and a filter, so
most of these are additions to `_next_sample` rather than new files.

### 4. Other post effects

Godot's environment has what the port needs, but the web version in
`js/gfx/` has a wider set (motion blur, depth of field, chromatic aberration,
bokeh). Godot ships DOF (camera attributes) and glow; Godot 4 has no built-in
motion blur, so a radial-blur shader on a `ColorRect` would be the way.

## What was deliberately not done

- **No textures or assets of any kind.** Every material is a `StandardMaterial3D`
  configured in code, and the one texture in the project is a gradient generated
  at startup. This keeps the project cloneable and license-free; it also means
  the road looks like flat dark asphalt until you author a material.
- **No skybox.** A flat background colour plus exponential fog, which at night is
  closer to what a city sky actually looks like than a starfield is.
- **No physical camera.** Godot's `Camera3D` `fov` is compared directly with the
  Unity and Unreal values. HDRP's physical camera is in the Unity port's notes;
  Godot's equivalent (`CameraAttributesPhysical`) is not used because it changes
  the meaning of the FOV ramp in `tdc_chase_camera.gd`.
