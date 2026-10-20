# Tokyo Dream Circuit — Unity project

A Unity port of the circuit, alongside the Unreal Engine 5 version in
[`../../unreal/TokyoDreamCircuit/`](../../unreal/TokyoDreamCircuit/). Same road
maths, same car physics, same numbers — different engine.

> **Never compiled.** There is no Unity Editor for Android, so this was written on
> a phone and has not been built or run. It is written to be compile-clean and
> version-safe, but expect a small fix or two on the first open. See *Verified
> how* below for exactly what was checked.

## Requirements

- **Unity 6.3 LTS** (6000.3.x). Unity 6.0 through 6.6 should work; 6.3 LTS is what
  it was written against, and `ProjectSettings/ProjectVersion.txt` records that as
  a hint — any newer Unity will offer to upgrade the project, which is fine.
- No packages are required beyond what Unity generates on first open. The render
  pipeline is your choice: the scripts detect HDRP, URP or Built-in and adapt.
- For the cinematic look described in [REALISM_UNITY.md](REALISM_UNITY.md), add
  **High Definition RP** from the Package Manager.

Unity Hub and the Editor are Windows / macOS / Linux only. About 25–40 GB for the
Editor with one platform's build support.

## Quick start

1. Open `unity/TokyoDreamCircuit/` in Unity Hub (any Unity 6 LTS). Let it generate
   `Library/` and import.
2. **GameObject → Tokyo Dream Circuit → Create Demo Scene.** This saves
   `Assets/Scenes/TokyoNightRun.unity` containing one object, which builds
   everything else.
3. Press **Play**. You are on a banked circuit at night, in a car with wet-grip
   physics.

Prefer no scene file at all? Drop a `TDCSceneBootstrap` on any empty GameObject and
press Play — scene creation is optional. Everything it builds is an ordinary,
selectable GameObject, so you can pause and tweak the road and car live.

**Controls:** `W`/`S` throttle and reverse, `A`/`D` steer, `Space` brake,
`Left Shift` handbrake, `R` reset. Arrow keys and a gamepad work too.

## Files

```
Assets/Scripts/
  TDCProceduralRoad.cs    road actor: Catmull-Rom centreline, swept mesh, banking
  TDCPlayerCar.cs         car: rigid body + bicycle-model tyre solver, wet grip
  TDCChaseCamera.cs       chase camera: speed distance, FOV ramp, shake
  TDCSceneBootstrap.cs    builds the whole demo scene at runtime
  TDCInput.cs             keyboard + gamepad, on either input backend
  TDCMaterials.cs         pipeline-agnostic material creation, runtime puff texture
  TDCEngineAudio.cs       engine, tyre and wind sound, synthesised
  TDCVehicleFX.cs         tyre smoke, wet spray, brake lights
  TDCSkidMarks.cs         pooled skid marks from rear slip
Assets/Editor/
  TDCSceneBuilder.cs      menu: create the scene, rebuild roads, check setup
ProjectSettings/
  ProjectVersion.txt      Unity 6.3 LTS hint
```

## Sound and effects

Both are built from maths at runtime. There is not a single audio file or image in
this project, and nothing to license.

**`TDCEngineAudio.cs`** writes into the audio buffer from `OnAudioFilterRead`:

| Layer | How it is made | What drives it |
| --- | --- | --- |
| Engine | A stack of 12 harmonics at the firing frequency of the current rpm | `TDCPlayerCar.EngineRpm` |
| Combustion | Filtered noise on the amplitude | Adds the lumpiness an ideal harmonic stack lacks |
| Tyre scrub | Noise through a two-pole resonator at ~1150 Hz | `TDCPlayerCar.TyreSlip01` |
| Wind roar | Low-passed noise | `speed01²`, which is how wind noise physically scales |

The reason this is worth more than a pitch-shifted loop: the car has a real gear
model, so the rpm climbs to 7200, drops on the upshift and climbs again, and the
audio follows it. You hear the shifts.

Two implementation notes worth knowing, because both are the usual reason a
procedural audio script produces nothing:

- An `AudioSource` with **no clip never reaches the DSP graph**, so `OnAudioFilterRead`
  would never be called. The component assigns a short, silent, looping clip to keep
  the filter alive. The clip itself contributes nothing.
- Gain is applied **inside** the filter rather than through `AudioSource.volume`, so a
  volume of 1 here cannot be mistaken for "muted" and culled.

The values it reads are read on the **audio thread**. Reading a float that the main
thread wrote is atomic on every platform Unity supports, so no lock is taken: a lock
would block the audio thread and cause dropouts, which is worse than the race it
would avoid.

**`TDCVehicleFX.cs`** adds three things:

- **Tyre smoke** on all four wheels, emitted only when `TyreSlip01` is above a
  threshold, so it appears when the tyres are actually sliding rather than whenever
  the throttle is down. World-space particles, so the car drives out of its own smoke.
- **Wet spray**, a rooster tail that scales with `wetness × speed`. Set the
  bootstrap's `Wetness` to 1 and you get standing water, less grip, more spray and a
  different engine load all from one number.
- **Brake lights** that are dimly lit with the car running and brighten on the pedal.
  Emission is enabled through `TDCMaterials.EnableEmission`, which finds the right
  property for Built-in, URP or HDRP.

The particle texture is a soft radial puff generated by
`TDCMaterials.CreatePuffTexture`. Without it a particle is a hard-edged square; that
gradient is the difference between smoke and confetti.

**`TDCSkidMarks.cs`** is a separate component because it has a different lifetime:
smoke lives for a second, rubber lives for a lap. It keeps one dynamic mesh with a
ring buffer of 800 quads and writes a new one every 0.55 m of travel while the rear
tyres slide, so a drift leaves two continuous lines rather than a row of dots. The
buffer covers about 440 m and then overwrites oldest first. The whole trail is one
draw call, the mesh is marked dynamic, and its bounds are set once to a 20 km box so
writing a segment never triggers a bounds recalculation.

Its triggers are `RearSlipAngleDeg` above 9° or `TyreSlip01` above 0.32, above
40 km/h: the first catches a handbrake slide, the second catches wheelspin on a
straight where the slip angle is nearly zero. Marks narrow as `wetness` rises,
because rubber on standing water is thinner and greyer.

## Menu

| Item | What it does |
| --- | --- |
| Tokyo Dream Circuit → Create Demo Scene | Writes `Assets/Scenes/TokyoNightRun.unity` and adds it to Build Settings |
| Tokyo Dream Circuit → Add Demo Scene To Build Settings | For a packaged build |
| Tokyo Dream Circuit → Rebuild All Roads | Force a rebuild of every road in the open scene |
| Tokyo Dream Circuit → Check Project Setup | Reports the render pipeline, the lit shader, which input backend is live, the physics timestep, and whether a bootstrap exists |

Run **Check Project Setup** first if anything looks wrong — pink materials and dead
controls are the two most common first-open problems, and that item names both.

## Port map from the Unreal version

Unreal's starter was authored in centimetres. Unity is metres throughout — the
engine, the physics and the maths — so the numbers divide by 100 and nothing else
changes. Unreal's forward axis is +X; Unity's is +Z.

| Unreal (cm) | Unity (m) | Value |
| --- | --- | --- |
| `RoadLength` | `roadLength` | 18000 → 180 |
| `RoadWidth` | `roadWidth` | 1200 → 12 |
| `SampleSpacing` | `sampleSpacing` | 100 → 1 |
| `CurveAmplitude` | `curveAmplitude` | 1700 → 17 |
| `ElevationAmplitude` | `elevationAmplitude` | 900 → 9 |
| `CircuitRadius` | `circuitRadius` | 60000 → 600 |
| `BankDegrees` | `bankDegrees` | 12 → 12 (unchanged) |
| `BankingScale` | `bankingScale` | 4000 → 40 |
| `WheelBase` | `wheelBase` | 280 → 2.8 |
| `TrackWidth` | `trackWidth` | 162 → 1.62 |
| `WheelRadius` | `wheelRadius` | 33 → 0.33 |
| `BaseDistance` | `baseDistance` | 850 → 8.5 |
| `Height` | `height` | 320 → 3.2 |
| `SpeedDistanceGain` | `speedDistanceGain` | 320 → 3.2 |
| `ShakeAmplitude` | `shakeAmplitude` | 1.4 → 0.014 |
| Body scale `(4.6, 2.0, 0.62)` (X=length) | `placeholderBodySize` `(2.0, 0.62, 4.6)` (X=width, Z=length) | remapped |

Everything already in SI stays identical: `MaxSpeedKmh = 342`, `WetGrip = 0.72`,
`MassKg = 1450`, 20000 N engine, 26000 N brakes, 90000/115000 N/rad cornering
stiffness, friction 1.5 dry. Both cars should drive the same.

## What changed in the port, and why

Same model, three deliberate departures:

1. **The centreline is Catmull-Rom control points, not an editor spline.** Unreal's
   `USplineComponent` has no direct Unity equivalent without adding the Splines
   package. Catmull-Rom passes through every control point (a bezier does not), so
   the road stays where you put it, and there is no package dependency.
2. **Input is abstracted.** Unity 6.3's default template ships the new Input System
   and sets Active Input Handling to "Input System" only, where `Input.GetAxis`
   throws `InvalidOperationException`. `TDCInput` compiles both paths and picks one
   from the `ENABLE_INPUT_SYSTEM` / `ENABLE_LEGACY_INPUT_MANAGER` symbols Unity
   sets, so the project works either way without changing a project setting.
3. **The scene is built by code.** Unreal had a seven-step checklist to assemble a
   level by hand (`SCENE_SETUP_CHECKLIST.txt`). Here the same scene is constructed
   at runtime, so the scene and the scripts cannot drift apart.

Two API renames between Unity 6.0 and 6.3 are handled explicitly rather than
ignored, since they are the usual cause of "works for me, does not compile for
you": `Rigidbody.velocity` → `linearVelocity`, and `PhysicMaterial` →
`PhysicsMaterial`. Both are wrapped in `UNITY_6000_0_OR_NEWER` checks in one place
each.

### On handedness

Both engines are left-handed with the same axis labels, which makes this easy to
get quietly wrong: `Vector3.Cross(up, forward)` is the **right** vector in both,
and `Cross(forward, up)` is the left one. Using the wrong one mirrors the road's
cross-section, inverts the winding, and banks every corner the wrong way — and it
still renders, which is why it survives review. Porting the road to a second
engine is what surfaced that the Unreal version had it backwards; it has been
fixed there too.

## Verified how

Not compiled, and honest about it. What was actually checked:

- C# is written against documented, stable Unity APIs; the version-sensitive ones
  are behind explicit symbol checks.
- Dependencies between the files were walked by hand: every member the bootstrap
  calls exists on the car and road, and every field the car reads exists on the
  materials helper.
- The road maths (Catmull-Rom, arc-length resampling, curvature banking, triangle
  winding) was re-derived rather than copied from the Unreal version, which is how
  the handedness bug above was found.
- A structural checker confirms balanced braces, matched types and no references
  to members that do not exist, including the ones the new audio and FX classes read
  off the car.
- The `OnAudioFilterRead` setup was written against the failure mode that actually
  bites: a silent looping clip exists purely so the filter is called at all.

It has not been opened in an Editor, so nothing here is a claim about how it
looks or drives. The first thing to run is **Check Project Setup**.

## Caveats

- The car is a **scaled cube with cylinder wheels** until you assign a real mesh.
  Assign your mesh to the car's `bodyVisual` field and set `placeholderBodySize`
  to roughly match it.
- The tyre model is a single-track approximation: two slip angles, two cornering
  forces, clamped by a friction circle from weight plus downforce. It does not
  simulate suspension, load transfer or tyre temperature. It is the same model as
  the Unreal version.
- Unity has **no equivalent of Nanite**. Large detail meshes need authored LODs or
  HLODs. [REALISM_UNITY.md](REALISM_UNITY.md) covers this honestly.
- **No `.meta` files are committed**, because no assets exist yet — only scripts, and
  Unity generates their `.meta` files on first open. Once you add textures or models,
  commit their `.meta` files so references survive, and use version control as normal.
- **Skid marks are flat quads, not decals.** `TDCSkidMarks` writes a world-space ring
  buffer of quads lifted 2 cm over the road; it cannot wrap a crest the way a
  projected decal would, and the oldest marks disappear once the buffer wraps. On a
  wet track they narrow rather than smear, which is the right direction but not a
  water simulation.
- There is no terrain, city or traffic yet — the same gap the Unreal project has.

## Next steps

1. **Check Project Setup**, then Play, then set `Wetness` to 1 and try the circuit
   again — that one number changes the grip, the spray and the engine load together.
2. Add **HDRP** and work through [REALISM_UNITY.md](REALISM_UNITY.md) for the
   cinematic look.
3. Assign a real car mesh and a wet-asphalt material to the road.
4. Replace the placeholder ground with real scenery.
