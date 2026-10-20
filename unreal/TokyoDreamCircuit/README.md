# Tokyo Dream Circuit — UE5 starter

**Requirements:** Unreal Engine 5.5 and Visual Studio 2022 with the *Game development with C++* workload (or clang + build-essential on Linux). The Procedural Mesh Component plugin is already enabled in the `.uproject`.

> **This code has never been compiled.** There is no Unreal Editor for Android, so it was written on a phone and has not been built or rendered. Expect a handful of small API fixes on the first compile — that is normal for hand-written UE C++. See *Merge notes* below for what changed.

## Setup

1. Right-click `TokyoDreamCircuit.uproject` and choose **Generate Visual Studio project files**.
2. Open the project and allow C++ compilation.
3. Create `Content/Maps/TokyoNightRun` (the config already points at this path).
4. Place a **Procedural Road** actor at the world origin. Adjust `Road Length`, `Road Width`, `Curve Amplitude`, `Elevation Amplitude` and `Bank Degrees` in Details. Press **Build Straight Road** for the open-road layout, or **Build Default Circuit** for a closed loop.
5. Place a **Player Car** above the road (Z around 150, facing +X). Press Play.
6. That is enough for the full Neon Horizon set-up: the game mode spawns
   `ATDCGoldenHour` (sun, sky, fog, grade), `ATDCWorldLandmarks` (Tokyo Tower,
   Skytree, Fuji, Rainbow Bridge, torii, 220-tower skyline) and
   `ATDCWeatherSystem` (rain, spray, wet grip) if the level has none. To place
   them by hand instead, drop the three actors in and uncheck
   `bSpawnNeonHorizonWorld` on the game mode.
7. Optional, and the biggest visual upgrade: create a wet asphalt material and
   assign it to the road's `Wet Asphalt Material` (dark albedo, high-frequency
   normal, roughness 0.05–0.3). Expose the scalars `Wetness`, `RainIntensity` and
   `PuddleMask`; the weather system writes them. Without the material everything
   still works — the writes are simply ignored.
8. Import licensed art when you want photoreal: hypercar mesh, Nanite city kit,
   textured Fuji. The procedural city is a stand-in, not a Nanite asset.

**Controls:** W throttle, S reverse, A/D steer, Space brake, Left Shift handbrake,
**P Photo Mode** (then WASD/QE fly, mouse look, wheel zoom, F12 capture). Gamepad
and arrow keys are mapped too. Full details in `NEON_HORIZON.md`.

## Files

```
TokyoDreamCircuit.uproject          project + plugin list
Source/
  TokyoDreamCircuit.Target.cs       game build target
  TokyoDreamCircuitEditor.Target.cs editor build target
  TokyoDreamCircuit/
    TokyoDreamCircuit.Build.cs      module dependencies
    Public/TDCProceduralRoad.h      road actor
    Public/TDCPlayerCar.h           car pawn
    Public/TDCChaseCameraComponent.h chase camera
    Public/TDCEngineAudioComponent.h engine/tyre/wind audio, synthesised (AudioMixer)
    Public/TDCGoldenHour.h          sun, sky atmosphere, fog, film grade
    Public/TDCWorldLandmarks.h      Tokyo Tower, Skytree, Fuji, Rainbow Bridge, torii, skyline
    Public/TDCWeatherSystem.h       rain streaks, wheel spray, wet grip
    Public/TDCHUD.h                 Zen HUD, drift score, landmark compass
    Public/TDCPhotoPawn.h           free camera with a physical lens
    Public/TDCPhotoModeComponent.h  enter/exit Photo Mode, freeze world time
    Public/TDCGameMode.h            game mode, spawns the Neon Horizon actors
    Private/*.cpp                   implementations
Config/
  DefaultEngine.ini                 Lumen / Nanite / VSM / Substrate / TSR
  DefaultInput.ini                  throttle, steer, brake, handbrake
  DefaultGame.ini                   project identity
SCENE_SETUP_CHECKLIST.txt           short scene checklist
SETUP_PC.md                         the PC runbook: installs, storage, template walkthrough
REALISM.md                          what makes it look real (assets + settings)
NEON_HORIZON.md                     the design target: Zen, Photo Mode, landmarks, rain
CITY_SAMPLE.md                      verified Epic City Sample + Houdini procedure
```

**Start with `SETUP_PC.md`** if you have not yet installed the engine — it covers
the four things to download (two of which are not what they sound like), the real
storage budget, and what the Chaos Vehicle template actually contains.

## Sound

`UTDCEngineAudioComponent` synthesises the engine, the tyres and the wind at
runtime. **There are no audio assets in this project**, and nothing to import or
license. It is attached to the car in the car's constructor, so there is no setup
step: press Play and the car makes a noise.

| Layer | How it is made | What drives it |
| --- | --- | --- |
| Engine | A stack of 12 harmonics at the firing frequency of the current rpm | `GetEngineRpm()`, from the car's drivetrain model |
| Combustion | Filtered noise on the amplitude | Adds the lumpiness an ideal harmonic stack lacks |
| Tyre scrub | Noise through a two-pole resonator at ~1150 Hz | `GetTyreSlip01()` |
| Wind roar | Low-passed noise | `GetSpeed01()²`, which is how wind noise physically scales |

The car's drivetrain model is what makes this worth more than a pitch-shifted loop:
it shifts up at 8200 rpm and down at 3600, so the pitch climbs, drops on the shift,
and climbs again. That drop is most of what makes engine audio read as real.

Two Unreal-specific notes:

- `OnGenerateAudio` runs on the **audio render thread**. It reads a small set of
  floats that `TickComponent` copies across once a frame, rather than reaching into
  the car from the audio thread. One writer and one reader of a float needs no lock,
  and a lock would block the audio thread.
- The component renders **mono** and lets Unreal's mixer upmix. If the output comes
  out at the wrong pitch or half length, `NumChannels` is the knob.

Particles are procedural too, but not Niagara: `ATDCWeatherSystem` draws rain
streaks and wheel spray as instanced cubes, updated with one batch transform call
per frame. That is a deliberate asset-free choice — a Niagara system is a `.uasset`
— and it means there is no editor step and nothing to license. The trade-off is
honest: no road splashes, no ripples, no lens drops. `REALISM.md` says what a
proper Niagara rain system would add.

## Tuning

Every number is in SI units (metres, m/s, newtons, kg); the conversion to Unreal centimetres happens in one place, `ATDCPlayerCar::ApplyForceAtLocationSI`.

| What you want | Knob |
| --- | --- |
| Faster | `Max Speed Kmh` (currently 342, the original target), `Max Engine Force` |
| Grippier | `Dry Friction Coefficient`, `Downforce Coefficient` |
| Tail-happy (oversteer) | lower `Rear Cornering Stiffness`, or raise `Throttle Grip Loss` |
| Stable (understeer) | keep `Rear Cornering Stiffness` above `Front Cornering Stiffness` |
| Wet handling | raise `Wetness` (0 dry → 1 soaked); `Wet Grip` is the soaked coefficient |
| Steering the wrong way | flip `Lateral Force Sign` to `-1` |
| Different exhaust note | `Harmonics` (brighter), `Harmonic Rolloff` (warmer), `Firing Pulses Per Revolution` (2 = four-cylinder, 3 = six) on `EngineAudio` |
| Earlier / later gear shifts | `Shift Up Rpm`, `Shift Down Rpm`, `Gear Count` on the car |
| Camera too far / too wide | `Base Distance`, `Base FOV`, `Max FOV` on the chase camera |
| Zen starts earlier | `Zen Start Kmh`, `Zen Full Kmh` |
| More forgiving slides | `Drift Assist Strength`, `Drift Assist Max Torque` |
| Denser / taller city | `Skyline Blocks`, `Seed` on the world landmarks actor |
| More rain | `Rain Intensity`, `Max Drops` on the weather actor |
| Later sunset | `Sun Elevation Degrees` on the golden hour actor |

`Wetness` is the interesting one: it blends dry grip toward `WetGrip`, so you can drive it from a weather system and watch cornering speed fall in real time.

## Telemetry for the HUD, audio and post FX

| Function | Use it for |
| --- | --- |
| `ATDCPlayerCar::GetSpeed01()` | motion blur amount, chromatic aberration, engine pitch |
| `ATDCPlayerCar::GetSpeedKmh()` | HUD readout |
| `ATDCPlayerCar::GetRearSlipAngleDeg()` | tyre smoke and screech when drifting |
| `ATDCPlayerCar::IsDrifting()` | camera shake, particle burst |
| `ATDCPlayerCar::GetBrakeInput()` | brake lights |
| `ATDCPlayerCar::GetZenAlpha()` | HUD fade, wind mix, vignette |
| `ATDCPlayerCar::GetDriftChain()` / `GetRunScore()` | drift HUD |
| `ATDCPlayerCar::GetDriftAngleDeg()` | spray plume, tyre audio |
| `UTDCChaseCameraComponent::GetSpeed01()` | same, from the camera side |

## Neon Horizon: Tokyo

The current design target is a high-speed, rain-slicked Tokyo at golden hour:
300+ km/h, forgiving drift physics, a Zen HUD that fades at top speed, a full Photo
Mode, and Tokyo Tower / Skytree / Mount Fuji / Rainbow Bridge as navigation
anchors. It is built from five source-only classes listed in `NEON_HORIZON.md`,
which also states plainly what is *not* there: Nanite city meshes, a wet-asphalt
material, Niagara rain and a LUT are all assets, and this project has none.

## Merge notes

This project merged two implementations of the same idea. The class names, folder
layout, property names, input contract and defaults are the original starter's, and
the implementations were replaced with the fuller versions. Specifically:

| Kept from the starter | Replaced |
| --- | --- |
| `ATDCProceduralRoad`, `ATDCPlayerCar`, `ATDCGameMode` names | the force-based toy car physics → bicycle-model tyre solver |
| `Private/` + `Public/` layout | the per-sample sinusoidal banking → curvature-derived banking |
| Input axes and keys, unchanged | `SpringArm` + `Camera` → `UTDCChaseCameraComponent` |
| `MaxSpeedKmh = 342`, `WetGrip = 0.72` | 8-line Lumen config → full Lumen/Nanite/Substrate/TSR block |
| `RoadLength`, `RoadWidth`, `SampleSpacing`, `CurveAmplitude`, `ElevationAmplitude`, `BankDegrees`, `WetAsphaltMaterial` — all still work | the placeholder `RebuildRoad` → spline-swept mesh with an editable cross-section profile |

Three behaviour changes worth knowing:

1. **Body damping dropped from 0.12/1.8 to 0.0/0.05.** Heavy angular damping is right for a toy force model but fights a real tyre solver — it would stop the car rotating into a slide.
2. **`BankDegrees` is now a maximum, not a per-sample amplitude.** Banking is measured from the road's actual curvature and clamped to `BankDegrees`, so corners bank the right way automatically.
3. **The camera replaced the SpringArm pair**, because the speed-driven FOV ramp is most of the sense of speed at 342 km/h. If you prefer the old rig, add a `USpringArmComponent` + `UCameraComponent` back in the constructor.

Also fixed while porting the same road maths to Unity: the lateral basis was
`CrossProduct(Tangent, UpVector)`, which is the **left** vector in Unreal's
left-handed basis, and the triangle winding compensated for it. The two errors
cancelled for visibility, so the road rendered — but its cross-section was mirrored
and every corner banked the wrong way. It is now `CrossProduct(UpVector, Tangent)`
with the matching winding.

The placeholder body cube is 62 cm tall, so the engine cylinders used as wheels look oversized. Adjust `Body` scale and `Wheel Radius` together when you assign a real car mesh.

## Caveats, stated plainly

- Never compiled. See the note at the top.
- The tyre model is a single-track approximation: two slip angles, two cornering forces, clamped by a friction circle from weight plus downforce. It does not simulate suspension, load transfer or tyre temperature. It feels like a fast car on a wet road and costs one rigid body per vehicle.
- `REALISM.md` explains why photorealism comes from assets and lighting, not code, and lists what to download. `CITY_SAMPLE.md` records the verified Epic City Sample + Houdini procedure, including two corrections to the usual "just download this" advice.
