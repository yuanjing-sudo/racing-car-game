# Making it look real

Your request was "stunning, realistic, like real life 3D and cinematic". Here is
the honest answer to what that actually takes, and what is already wired up.

## The uncomfortable truth first

Photorealism is **mostly assets and lighting, not code**. The engine features are
free and already enabled in `Config/DefaultEngine.ini`. What costs money and time
is high-poly, correctly-scanned geometry and materials. No amount of shader
sourcing makes an untextured box look like a Tokyo highway.

None of the assets below can be downloaded or installed from the Android device
this project was written on. Every one is a large binary package needing an Epic
account and a desktop machine, and some are paid. What follows is the shopping
list and the settings to apply.

## Already enabled in this project

No extra download — these ship with UE5 and are switched on in
`Config/DefaultEngine.ini`:

| Feature | What it gives you |
| --- | --- |
| **Lumen** (GI + hardware-RT reflections) | Bounces light off wet asphalt. The single biggest realism win. |
| **Nanite** | Renders film-grade meshes with no LOD popping. |
| **Virtual Shadow Maps** | Crisp contact shadows from every neon sign. |
| **Substrate** | Layered physically-based materials (clearcoat over flake over base). |
| **TSR** | Clean temporal anti-aliasing at 340 km/h. |
| **Volumetric Fog** | Light shafts through rain and under street lamps. |
| **Motion Blur** | The speed sensation. Tuned via `r.MotionBlur.Amount`. |
| **Sky Atmosphere** | Physically correct sky, aerial perspective, sun angle. |

## Required hardware

Lumen with hardware ray tracing and Nanite realistically wants:

- **GPU**: RTX 3060 / RX 6700 XT or better. RTX 4070+ for 1440p high refresh.
- **VRAM**: 8 GB minimum. Wet-road Lumen reflections are VRAM-hungry.
- **System RAM**: 32 GB comfortable; 16 GB works for a small track.
- **Disk**: engine ~120 GB, plus ~60 GB per large asset pack.

On a GTX 10-series card, turn off `r.Lumen.HardwareRayTracing` and `r.RayTracing`
for software Lumen — still good, roughly half the cost.

## Assets — the part that actually makes it look real

Links are to official sources. Availability and pricing change; check before
relying on any of them.

### Free, and start here

| Resource | What it is | Where |
| --- | --- | --- |
| **Quixel Megascans** | Thousands of scanned, tiled surfaces. Free for UE. Your asphalt, concrete, kerbs and puddles come from here. | Fab (fab.com) |
| **Epic's City Sample** | The Matrix Awakens city: a full procedural metropolis with Nanite buildings and a drivable simulation. The closest free thing to what you described. Also ships Epic's Houdini city-generation tooling — see `CITY_SAMPLE.md`. | Epic Games Launcher / Fab |
| **Electric Dreams Environment** | Epic's procedural nature/road sample demonstrating PCG, Substrate and Lumen together. | Epic Games Launcher |
| **Automotive Materials / Automotive Configurator** | Epic's car paint, glass, chrome and interior shaders, Substrate-aware. | Epic Games Launcher |
| **Poly Haven** | CC0 HDRIs and textures. | polyhaven.com |
| **ambientCG** | CC0 PBR textures, including wet-road sets. | ambientcg.com |

### Paid, if the budget exists

| Resource | Why |
| --- | --- |
| **SpeedTree** | Foliage. Nothing free matches it for cherry blossom trees. |
| **Substance 3D Designer / Painter** | Custom wet asphalt with tyre-worn tracks and puddles that Lumen reflections read correctly. |
| **Fab marketplace car models** | Rigged, Nanite-ready vehicles with LODs and interiors. |
| **Houdini** (Indie licence) | The road/city generation pipeline. `ATDCProceduralRoad` is the lightweight stand-in — see `CITY_SAMPLE.md` for the real thing. |

### Plugins already enabled in the `.uproject`

Not used by the C++ yet — turn them on as you grow:

- **ChaosVehiclesPlugin** — if you want a skeletal-mesh car with real suspension
  instead of the single-rigid-body model in `ATDCPlayerCar.cpp`.
- **PCG** — scatter city, trees and crowds across the circuit. Electric Dreams
  shows the pattern.
- **GeometryScripting** — runtime mesh editing and boolean track construction.
- **Niagara** — rain, tyre spray, sparks, exhaust heat haze.
- **MovieRenderPipeline** — offline cinematic output. This is how you get a
  "cinematic" result rather than a game screenshot.

## The settings that matter most, in priority order

If you only do five things:

1. **Manual exposure.** Auto exposure is the most common reason UE scenes look
   "gamey". In the Post Process Volume set `Exposure > Metering Mode = Manual`,
   `EV100 ≈ 13`. Brightness stays locked and the image reads as photographic.
2. **Real light intensity units.** `DirectionalLight > Intensity Units = Lux`,
   ~100000 for a sunny sky or ~5–20 for neon-only night. Default "unitless"
   intensity is physically meaningless and flattens everything.
3. **Nanite + Virtual Shadow Maps on every static mesh.** Free quality, no LOD
   authoring.
4. **Motion blur and film grain, sparingly.** `r.MotionBlur.Amount 0.35` and a low
   grain amount. This sells speed and hides Lumen noise.
5. **Movie Render Queue, not a screenshot.** Temporal sub-sampling (e.g. 8
   spatial × 8 temporal samples) removes Lumen shimmer and TSR artifacts for
   output video. Real-time play will always be noisier than an offline render.

## Driving the effects from the car

| Function | Use it for |
| --- | --- |
| `ATDCPlayerCar::GetSpeed01()` | motion blur amount, chromatic aberration, FOV, engine pitch |
| `ATDCPlayerCar::GetSpeedKmh()` / `GetAbsoluteSpeedKmh()` | HUD, audio |
| `ATDCPlayerCar::GetRearSlipAngleDeg()` | tyre smoke and screech when drifting |
| `ATDCPlayerCar::IsDrifting()` | camera shake, particle burst |
| `ATDCPlayerCar::GetBrakeInput()` | brake lights |
| `UTDCChaseCameraComponent::GetSpeed01()` | convenient from the camera side |

## What this is not

To be blunt about the limits of what was delivered:

- It is **not compiled**. No UE install exists on the device that wrote it.
- It is **not a game** — no menus, no lap timing, no AI opponents, no sound.
- It is **not photorealistic on its own**. It is the skeleton and the settings;
  the realism comes from the Megascans textures, the City Sample buildings and
  the lighting discipline described above.
- The tyre model is an approximation, not a simulation. See the README.

Closing that gap is desktop work in the editor. This project exists so that work
can start immediately rather than from an empty screen.
