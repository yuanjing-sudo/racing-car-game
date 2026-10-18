# Making it look real in Unity

The Unreal version of this project has a sibling file, `../../unreal/TokyoDreamCircuit/REALISM.md`.
This is the Unity equivalent, and it starts with the same uncomfortable truth.

## The uncomfortable truth first

Photorealism is **mostly assets and lighting, not code**. The engine features are
free; the cost is high-quality scanned geometry and materials, and the discipline to
light a scene in physical units. No script here makes an untextured box look like a
Tokyo highway.

None of the assets below can be downloaded or installed from the Android device
this was written on. What follows is the shopping list and the settings to apply.

## What Unity gives you, against the Unreal feature set

Being straight about the equivalence, because the Unreal side named Lumen and
Nanite and Unity does not have either word:

| Unreal | Unity equivalent | Notes |
| --- | --- | --- |
| **Lumen** global illumination | **Adaptive Probe Volumes** (APV), or Screen Space Global Illumination | APV is the modern path and the closest match. Neither is quite Lumen's quality at large scale. |
| **Lumen** reflections / HW ray tracing | **Ray tracing** (DXR) in HDRP, or **Screen Space Reflections** | RT reflections need an RTX-class GPU. SSR is the cheap fallback, and wet asphalt is exactly where SSR breaks down. |
| **Nanite** | **Nothing equivalent** | This is the real gap. You must author LODs, or use HLOD/impostors for distant city geometry. Budget time for it. |
| **Virtual Shadow Maps** | HDRP shadow settings + Contact Shadows | Cheaper, and less forgiving of large shadow distances. |
| **Substrate** | HDRP Lit + **Shader Graph** | Achievable, more authoring by hand. |
| **TSR** | **TAA** or DLSS/FSR upscaling | TAA is the closest free option. |
| **Volumetric Fog** | HDRP **Volumetric Fog** + Local Volumetric Fog, Volumetric Clouds | Genuinely good, and light shafts are the single biggest night-scene win. |
| **Movie Render Queue** | **Recorder** + **Sequencer** (Sequence Recorder) | Offline rendering with accumulated samples. This is how you get "cinematic". |
| **Chaos Vehicles** | [WheelCollider](https://docs.unity3d.com/ScriptReference/WheelCollider.html) or a vehicle asset | For a skeletal suspension car. `TDCPlayerCar` is the single-rigid-body alternative. |

## Required hardware

HDRP with ray tracing wants roughly the same machine as Lumen does:

- **GPU:** RTX 3060 / RX 6700 XT or better. RTX 4070+ for 1440p high refresh.
- **VRAM:** 8 GB minimum. Wet-road reflections are VRAM-hungry.
- **System RAM:** 32 GB comfortable; 16 GB works for a small track.
- **Disk:** Editor 25–40 GB, plus 10–50 GB per large asset pack.

Without ray tracing, HDRP still looks good with SSR and APV — that is the sensible
target on a mid-range card.

## Turning on HDRP — the six steps

This is the one part that cannot be done in code, because the pipeline asset has to
be created by the Editor and referenced in project settings.

1. **Window → Package Manager → Unity Registry → High Definition RP → Install.**
   Install it from the UI rather than by editing `Packages/manifest.json`: the
   Package Manager picks the version that matches your Editor, which this project
   deliberately does not guess at. (That is also why no `manifest.json` is
   committed here.)
2. **Assets → Create → Rendering → HDRP Asset.** Name it `TDC_HDRP`.
3. Open its inspector and set **Lighting → Screen Space Global Illumination** on
   (fallback GI), and **Lighting → Volumetric Fog** on. Turn on **Ray Tracing** if
   your GPU supports it and you want real reflections at speed.
4. **Edit → Project Settings → Graphics** → assign `TDC_HDRP` as the
   Scriptable Render Pipeline Settings.
5. **Edit → Project Settings → Quality** → assign the same HDRP asset to each
   quality level you use.
6. Create a **Volume** (GameObject → Volume → Global Volume) with a new profile, and
   add the overrides from the next section.

Existing Built-in materials will show as pink. Reassign them: the road, car and
ground are created at runtime by `TDCMaterials`, which already detects HDRP and uses
`HDRP/Lit`, so a fresh Play produces correct materials with no manual work.

## The settings that matter most, in priority order

If you only do five things:

1. **Manual exposure.** Auto exposure is the most common reason a Unity scene reads
   as "gamey". In the Volume: **Exposure → Mode = Manual, EV100 ≈ 12** for a night
   city with neon, or ≈ 9 for a darker run. Brightness then stays locked and the
   image reads as photographic.
2. **Physical light units.** In HDRP a directional light is in **lux**. Moonlight is
   genuinely tiny (well under 1 lux), so a night scene is lit almost entirely by
   neon and street lighting — that is what makes it look like Tokyo rather than a
   dim version of day. `TDCSceneBootstrap` sets the moon in lux automatically when it
   detects HDRP; `moonIntensity` still means brighter/dimmer in both pipelines.
3. **Adaptive Probe Volumes** for indirect light. This is what makes the wet road
   pick up the colour of the neon above it, and it is the closest thing Unity has to
   Lumen. Bake them from **Window → Rendering → Lighting**.
4. **Volumetric fog and clouds.** Light shafts under street lamps and through the
   skyline. Cheap, and transformative at night. The bootstrap already sets Built-in
   fog so the non-HDRP path is not bare.
5. **Recorder, not a screenshot.** For output video, record through **Window →
   General → Recorder** with accumulation, or render a **Sequence** with temporal
   sampling. Real-time play will always be noisier than an offline render.

## Assets

Availability and pricing change; check before relying on any of these.

| Resource | What it is | Where |
| --- | --- | --- |
| **Quixel Megascans** | Thousands of scanned surfaces. Asphalt, concrete, kerbs, puddles. Free, and now on Fab with Unity support — the same source the Unreal project uses, so both projects can share the look. | fab.com |
| **Unity HDRP sample scenes** | *The Courtyard* and *Terrain Demo* show HDRP lit properly. *Spaceship* and *Factory* show industrial wet/reflective surfaces. Free, and the fastest way to learn what your settings should look like. | Unity Hub → Samples |
| **Poly Haven** | CC0 HDRIs and textures. Every night scene needs a real HDRI sky. | polyhaven.com |
| **ambientCG** | CC0 PBR textures, including wet-road sets. | ambientcg.com |
| **Unity Asset Store** | Vehicle models, urban packs, street furniture. Quality is uneven — check the LODs and the licence. | assetstore.unity.com |
| **Blender** | Free. For making the road segments, kerbs, rails and Tokyo Tower yourself. | blender.org |

For a **skeletal, suspension car**, Unity's [WheelCollider](https://docs.unity3d.com/ScriptReference/WheelCollider.html)
is the built-in route and pairs with the same physics you already have; several
vehicle assets also include a tyre model. `TDCPlayerCar` is deliberately
independent of all of that so you can swap.

## Driving the effects from the car

| Member | Use it for |
| --- | --- |
| `TDCPlayerCar.Speed01` | motion blur amount, chromatic aberration, FOV, engine pitch |
| `TDCPlayerCar.SpeedKmh` / `AbsoluteSpeedKmh` | HUD, audio |
| `TDCPlayerCar.RearSlipAngleDeg` | tyre smoke and screech when drifting |
| `TDCPlayerCar.IsDrifting` | camera shake, particle burst |
| `TDCPlayerCar.BrakeInput` | brake lights |
| `TDCPlayerCar.wetness` | driving rain, spray, reflective sheen — blend it over time |
| `TDCChaseCamera.Speed01` | the same figure, read from the camera side |

`wetness` is the interesting one: it blends dry grip toward `wetGrip`, so a weather
system can raise it as the rain builds and cornering speed falls in real time.

## What this is not

To be blunt about the limits of what was delivered:

- It is **not compiled**. No Unity install exists on the device that wrote it.
- It is **not a game** — no menus, lap timing, AI opponents or audio.
- It is **not photorealistic on its own**. It is the skeleton and the settings; the
  realism is Megascans textures, a real HDRI, APV baking and the exposure discipline
  above.
- It has **no Nanite equivalent**, so city-scale geometry needs authored LODs. That
  is a real, unavoidable difference from the Unreal version.
- The tyre model is an approximation, not a simulation. See the README.

Closing that gap is desktop work in the Editor. This project exists so that work can
start immediately rather than from an empty scene.
