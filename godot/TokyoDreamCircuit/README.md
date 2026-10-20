# Tokyo Dream Circuit — Godot 4 project

A Godot port of the circuit, alongside the Unreal Engine 5 version in
[`../../unreal/TokyoDreamCircuit/`](../../unreal/TokyoDreamCircuit/) and the Unity
version in [`../../unity/TokyoDreamCircuit/`](../../unity/TokyoDreamCircuit/).
Same road maths, same car physics, same numbers — third engine.

> **Never opened.** There is no Godot editor for Android, so this was written on a
> phone and has not been run. It is written to be parse-clean and version-safe,
> but expect a small fix or two on the first open. See *Verified how* below for
> exactly what was checked, and *Two things you may have to flip* for the two
> places where that is a one-line change.

## Requirements

- **Godot 4.6** (current stable). Anything from 4.3 up should work; the project
  declares 4.6 in `config/features`. No plugins, no addons, no packages.
- The **Forward+** renderer, which is Godot's default for desktop. Mobile and
  Compatibility will run it but lose SDFGI and SSR — see
  [REALISM_GODOT.md](REALISM_GODOT.md).

Godot is a ~120 MB download with no installer and no account, so unlike the
Unreal and Unity versions this one costs nothing to try.

## Quick start

1. Open Godot 4.6, **Import**, and pick
   `godot/TokyoDreamCircuit/project.godot`.
2. Press **F5**. You are on a banked circuit at night, in a car with wet-grip
   physics and a synthesised engine.

There is no scene to assemble: `scenes/tokyo_night_run.tscn` is six lines — one
Node3D with one script — and `TDCSceneBootstrap` builds the road, the car, the
camera, the lighting, the audio and the particles from code. Everything it
creates is an ordinary node, so you can select it in the **Remote** scene tree
while the game runs and tune it live.

**Controls:** `W`/`S` throttle and reverse, `A`/`D` steer, `Space` brake,
`Shift` handbrake, `R` reset. Arrow keys and a gamepad work too.

## Files

```
project.godot                    project settings: Forward+, MSAA, 120 Hz physics
scenes/tokyo_night_run.tscn      the whole scene: one node, one script
scripts/
  tdc_procedural_road.gd         road: Catmull-Rom centreline, swept mesh, banking
  tdc_player_car.gd              car: rigid body + bicycle-model tyre solver, wet grip
  tdc_chase_camera.gd            chase camera: speed distance, FOV ramp, shake
  tdc_scene_bootstrap.gd         builds the whole demo scene at runtime
  tdc_input.gd                   keyboard + gamepad, read directly
  tdc_materials.gd               material creation
  tdc_engine_audio.gd            engine, tyre and wind sound, synthesised
  tdc_vehicle_fx.gd              tyre smoke, wet spray, brake lights
  tdc_skid_marks.gd              pooled skid marks from rear slip
```

## Sound and visual effects

Both are built from maths at runtime. There is not a single audio file or
texture in this project, and nothing to license.

**`tdc_engine_audio.gd`** fills an `AudioStreamGenerator` buffer every frame:

| Layer | How it is made | What drives it |
| --- | --- | --- |
| Engine | A stack of 12 harmonics at the firing frequency of the current rpm | `car.engine_rpm`, which comes from the car's gear model |
| Combustion | Filtered noise on the amplitude | Adds the lumpiness an ideal harmonic stack lacks |
| Tyre scrub | Noise through a two-pole resonator at ~1150 Hz | `car.tyre_slip_01`, the car's own measured slip |
| Wind roar | Low-passed noise | `speed01²`, which is how wind noise physically scales |

The reason this is worth more than a pitch-shifted loop: the car has a real gear
model (`_update_gearbox` in `tdc_player_car.gd`), so the rpm rises to 7200, drops
to about 4200 on the upshift, and rises again. The audio follows that, so you
hear the shifts. That single behaviour is most of what makes engine audio read as
real.

**`tdc_vehicle_fx.gd`** adds three things:

- **Tyre smoke** on all four wheels, emitted only when `tyre_slip_01` is above a
  threshold — so it appears when the tyres are actually sliding, not whenever the
  throttle is down. Particles are in world space, so the car drives out of its
  own smoke.
- **Wet spray**, a rooster tail that scales with `wetness × speed`. Set the
  bootstrap's `wetness` to 1 and you get standing water, less grip, spray and a
  different engine load all from one number.
- **Brake lights** that are dimly lit with the car running and brighten on the
  brake pedal.

The particle texture is a `GradientTexture2D` with a radial fill, generated at
startup. Without it, a particle is a hard-edged square; that gradient is the
difference between smoke and confetti.

**`tdc_skid_marks.gd`** is a separate node because it has a different lifetime:
smoke lives for a second, rubber lives for a lap. It is a `MultiMeshInstance3D` with
a fixed pool of 800 unit cubes, each stretched between two successive rear contact
patches every 0.55 m of sliding, so a drift leaves two continuous lines and the
whole trail is one draw call. The pool covers about 440 m and then overwrites oldest
first. A custom AABB large enough for the circuit stops the marks being culled as
the pool is written.

Its triggers are `rear_slip_angle` above 9° or `tyre_slip_01` above 0.32, above
40 km/h: the first catches a handbrake slide, the second catches wheelspin on a
straight where the slip angle is nearly zero. Marks narrow as `wetness` rises,
because rubber on standing water is thinner and greyer.

## Why there is no InputMap

The driving controls are read directly in `tdc_input.gd` rather than through
project input actions. Two reasons:

- The built-in `ui_up` / `ui_down` / `ui_left` / `ui_right` actions exist in every
  Godot project and are already bound to the arrow keys, the D-pad **and** the
  left stick, so gamepad support costs nothing.
- Defining custom actions means serialising `InputEventKey` objects into
  `project.godot`, and the property list of those objects has changed between
  4.x releases. That is a class of breakage for no benefit, especially in a file
  that was hand-written.

If you want remappable controls, add the actions in the Input Map and change the
handful of lines in `tdc_input.gd`. Each is one line.

## Port map from the Unreal version

Unreal's starter was authored in centimetres. Godot is metres throughout, exactly
as Unity is, so the numbers are the same as the Unity port's and divide by 100
from Unreal's. Unreal's forward axis is +X; **Godot's is −Z**, and Godot is
right-handed where Unreal and Unity are left-handed. Those two differences are
the only places the code could not be copied.

| Unreal (cm) | Godot (m) | Value |
| --- | --- | --- |
| `RoadLength` | `road_length` | 18000 → 180 |
| `RoadWidth` | `road_width` | 1200 → 12 |
| `SampleSpacing` | `sample_spacing` | 100 → 1 |
| `CurveAmplitude` | `curve_amplitude` | 1700 → 17 |
| `ElevationAmplitude` | `elevation_amplitude` | 900 → 9 |
| `CircuitRadius` | `circuit_radius` | 60000 → 600 |
| `BankDegrees` | `bank_degrees` | 12 → 12 (unchanged) |
| `BankingScale` | `banking_scale` | 4000 → 40 |
| `WheelBase` | `wheel_base` | 280 → 2.8 |
| `TrackWidth` | `track_width` | 162 → 1.62 |
| `WheelRadius` | `wheel_radius` | 33 → 0.33 |
| `BaseDistance` | `base_distance` | 850 → 8.5 |
| `Height` | `height` | 320 → 3.2 |
| `SpeedDistanceGain` | `speed_distance_gain` | 320 → 3.2 |
| `ShakeAmplitude` | `shake_amplitude` | 1.4 → 0.014 |

Everything already in SI stays identical: `max_speed_kmh = 342`, `wet_grip = 0.72`,
`mass_kg = 1450`, 20000 N engine, 26000 N brakes, 90000 / 115000 N/rad cornering
stiffness, 1.5 dry friction. All three cars should drive the same.

Two values do **not** carry across, because the engines express them differently:

| Concept | Unreal / Unity | Godot |
| --- | --- | --- |
| Surface finish | smoothness 0.85 | roughness 0.15 — the inverse |
| Directional light | 0.55 (Unity arbitrary) / lux | `light_energy` 0.28 |

## What changed in the port, and why

Same model, four deliberate departures:

1. **The centreline is Catmull-Rom control points.** Unreal's `USplineComponent`
   has no Godot equivalent without an addon. Catmull-Rom passes through every
   control point, which a bezier does not, so the road stays where you put it.
2. **Input is read directly** instead of through the InputMap — see above.
3. **The scene is built by code**, as in the Unity version, so the scene and the
   scripts cannot drift apart.
4. **The road winding order is derived, not copied.** See below.

### On handedness

Godot is **right-handed**; Unreal and Unity are **left-handed**. Both of the
places this matters are commented in the source, because the wrong version still
renders and therefore survives review:

```gdscript
# Unreal / Unity:  right = Cross(up, forward)
var right := tangent.cross(Vector3.UP)      # Godot: forward × up

# Unreal / Unity:  forward = transform.forward
var forward := -global_transform.basis.z    # Godot: a Node3D looks down -Z
```

Getting the lateral basis backwards mirrors the road's cross-section and banks
every corner the wrong way. Porting the road to Unity is what surfaced that the
Unreal version had it backwards; it has been fixed there too.

### On winding order

There is a genuine ambiguity here. Godot's documentation says it uses
**clockwise** winding for front faces; an open documentation issue
([godot-docs#10757](https://github.com/godotengine/godot-docs/issues/10757))
reports that this is wrong and that it is in fact **counter-clockwise**, which is
what a right-handed engine with the OpenGL default (`GL_CCW`) would do.

`tdc_procedural_road.gd` follows the counter-clockwise reading, derived rather
than copied: in a right-handed system, if the normal is `(b − a) × (c − a)` and
the lateral direction is `tangent × up`, then the triangle `(i0, i1, i2)` has a
normal of exactly `+UP`. The second triangle of each quad is `(i1, i3, i2)`.

Note that this is a **different order** to the Unreal and Unity ports, which use
`(i0, i2, i3)` and `(i0, i3, i1)`. That is not a copy-paste slip; those are
left-handed. Shading does not depend on it either way, because vertex normals are
computed analytically and set explicitly rather than generated from the winding.

## Two things you may have to flip

Both are one-line changes, and both are flagged in the inspector.

| Symptom | Fix |
| --- | --- |
| The road is invisible from above — you see through it | Tick `flip_winding` on the road |
| The car steers the wrong way | Set `lateral_force_sign` on the car to `-1` |

The second one exists in all three ports and has never needed to be used. The
first is the winding question above.

## Verified how

Not opened, and honest about it. What was actually checked:

- Every script is tab-indented, bracket-balanced and free of mixed indentation,
  checked mechanically with the same kind of checker used on the C# and C++
  ports.
- Cross-file names were walked by construction: every member the bootstrap sets
  on the road, car, camera, audio and FX nodes exists on that class.
- The road maths (Catmull-Rom, arc-length resampling, curvature banking, triangle
  winding) and the handedness were **re-derived** for a right-handed engine rather
  than adapted from the other two ports.
- The Godot API calls were each checked against the current class reference,
  because unlike the C# and C++ ports there is no compiler at all here to catch a
  renamed property.

What could not be checked: the engine's own winding convention, whether the
values above look right on screen, and whether any property has been renamed in
your specific 4.x point release.

## Caveats

- The car is a **box with cylinder wheels** until you assign a real mesh. Set
  `body_visual` and match `placeholder_body_size` to it.
- The tyre model is a single-track approximation: two slip angles, two cornering
  forces, clamped by a friction circle from weight plus downforce. No suspension,
  no load transfer, no tyre temperature. Same model as the other two ports.
- **Skid marks are flat boxes, not decals.** `tdc_skid_marks.gd` stretches pooled
  instances over the road; they cannot wrap a crest the way an authored `Decal`
  would, and the oldest marks disappear once the pool wraps. On a wet track they
  narrow rather than smear, which is the right direction but not a water simulation.
- **No Nanite equivalent**, and none is coming. See
  [REALISM_GODOT.md](REALISM_GODOT.md).
- No terrain, no city, no traffic, no lap timing.
- `.godot/` is generated and ignored. Nothing else is ignored except
  `export_presets.cfg`, which can contain keystore passwords.

## Next steps

1. Press F5, then set `wetness` to 1 on the bootstrap and try the circuit again —
   that one number changes the grip, the spray and the engine load together.
2. Work through [REALISM_GODOT.md](REALISM_GODOT.md): SDFGI is already on, and
   turning it off is the first thing to try if the frame rate hurts.
3. Assign a real car mesh, and give the road a wet-asphalt material with a normal
   map.
4. Replace the placeholder ground with real scenery.
