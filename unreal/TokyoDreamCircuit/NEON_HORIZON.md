# Neon Horizon: Tokyo

> Drive the postcard. A 300 km/h hypercar, a rain-slicked Tokyo at golden hour,
> and a skyline you navigate by.

This is the design target for the Unreal build of Tokyo Dream Circuit. Everything
described here is implemented as C++ source in this project. **Nothing has been
compiled or rendered** — there is no Unreal Editor for Android — so treat the code
as a careful first draft, not a verified build. The other two ports (Unity, Godot)
do not have this layer yet.

The rule that shaped every decision: **no imported assets**. No meshes, textures,
audio, Niagara systems or material assets. Geometry is generated into
`UProceduralMeshComponent`s, colours come from the engine's
`/Engine/BasicShapes/BasicShapeMaterial`, and the engine audio is synthesised. The
one thing that is genuinely asset-gated — a wet-asphalt material — is described at
the end rather than faked.

## The five pieces

| Feature | Class | File |
| --- | --- | --- |
| Golden-hour sky, sun, fog, film grade | `ATDCGoldenHour` | `TDCGoldenHour.h/.cpp` |
| Skyline, Tokyo Tower, Skytree, Fuji, Rainbow Bridge, torii | `ATDCWorldLandmarks` | `TDCWorldLandmarks.h/.cpp` |
| Rain, wheel spray, grip wetness | `ATDCWeatherSystem` | `TDCWeatherSystem.h/.cpp` |
| Zen HUD, drift score, landmark compass | `ATDCHUD` | `TDCHUD.h/.cpp` |
| Photo Mode | `UTDCPhotoModeComponent`, `ATDCPhotoPawn` | `TDCPhotoModeComponent.h/.cpp`, `TDCPhotoPawn.h/.cpp` |

`ATDCGameMode` spawns the first three if the level has none, and sets the HUD
class. A level with a `PlayerStart` and nothing else runs the whole set-up.

## Controls

| Input | On foot | In Photo Mode |
| --- | --- | --- |
| W / S | throttle / reverse | fly forward / back |
| A / D | steer | fly left / right |
| E / Q | — | fly up / down |
| Mouse | — | look |
| Mouse wheel | — | focal length |
| Space | brake | — |
| Left Shift | handbrake | boost (6x) |
| P | enter Photo Mode | exit |
| F12 | — | capture (200% HighResShot) |
| Z / X | — | aperture down / up (1/3 stop) |
| PgUp / PgDn | — | focus far / near |

Gamepad and arrow keys keep working for the car.

## Zen

`ATDCPlayerCar::ZenAlpha` is a smoothstep from `ZenStartKmh` (250) to `ZenFullKmh`
(315). At 315 the HUD has faded to almost nothing: speed, gear, rpm, drift score
and compass all scale by `1 - 0.88 * ZenAlpha`, leaving a single `Z E N` mark. The
road, the rain and the skyline are untouched. It is deliberately a *readability*
feature, not a filter: nothing is blurred or desaturated to hide the road.

The HUD is drawn in `AHUD::DrawHUD` with the canvas, so there is no UMG asset and
no widget tree. Landmark chips sit along the top edge within ±75° of the camera
yaw, with live distance in kilometres.

## Drift assist and scoring

The tyre model is unchanged: a single-track bicycle model with a friction circle.
Two things were added around it.

**Assist.** Above 40 km/h, when the car is more than 5° sideways, a yaw torque
nudges the body toward its velocity. The gain fades in with slip and speed, is
capped at `DriftAssistMaxTorque`, and drops to 15% while the handbrake is held, so
you can still start a slide. This is the opposite-lock a good driver applies,
expressed as a torque — it makes a 300 km/h slide recoverable without making the
car feel like it is on rails.

**Score.** A drift is a real slide: more than 8° of slip, above 60 km/h, without
the handbrake. The score rate scales with slip angle, speed and a chain multiplier
that climbs every 0.9 s up to ×8. The chain survives 1.6 s after the tyres grip
again (draining at 2.5×), so linking two corners pays and a straight-line flick
does not.

## The city

`ATDCWorldLandmarks` builds eleven procedural meshes, one per material, so the
whole city is eleven draw calls plus lights.

- **Tokyo Tower** — 333 m. Four legs with a concave taper, twelve lattice levels
  with X-bracing, every third ring white, two observation decks with warm glazing
  bands, a tapered mast and antenna, and red aviation lights.
- **Tokyo Skytree** — 634 m. Three tapering white sections, seven service rings,
  two decks, cool floodlighting.
- **Mount Fuji** — 1.9 km high with a 5.2 km radius, built as a radial profile
  with a concave exponent, 7.8 km north, plus a separate snow-cap mesh lifted 1.8 m
  off the rock to avoid z-fighting. The config raises `r.DefaultFarClipPlane` to
  40 km so it is not clipped.
- **Rainbow Bridge** — a 900 m deck, two 123 m towers, two parabolic main cables
  sampled as beams, side-span cables and 56 hangers per side.
- **Torii** — a ring of 12 vermilion gates, each 16 m tall, just outside the
  circuit and facing the track.
- **Skyline** — 220 deterministic set-back towers between 1.8× and 3.6× the
  circuit radius, with lit floor bands, rooftop plant, antennas and neon signage
  facing the circuit. `Seed` fixes the layout: same seed, same city.
- **Navigation** — the four landmarks are registered with name, position and
  height, and the HUD reads them for the compass.

Every mesh has collision disabled: the circuit is the road, not the city.

## Lighting and grade

`ATDCGoldenHour` owns a directional light at 7° elevation, flagged as the
atmosphere sun; a sky atmosphere with boosted Mie scattering for the haze; a
real-time-capture sky light; volumetric height fog with warm inscattering; and an
unbound post-process volume with:

- bloom with a negative threshold, so neon and aviation lights bloom;
- a warm-highlight, cyan-shadow grade (`ColorSaturation`, `ColorContrast`,
  `ColorGain`, `ColorOffset`);
- vignette 0.55, film grain 0.22, chromatic aberration 0.8, motion blur 0.45;
- a 36 mm, f/4, 30 m focus depth of field for the chase camera.

Photo Mode's camera overrides the lens values, so the grade stays consistent
between driving and shooting.

## Rain and wet grip

`ATDCWeatherSystem` keeps `MaxDrops` (default 2400) instance transforms in a box
that follows the player camera, wraps them in X/Y and recycles them at the top.
One `BatchUpdateInstancesTransforms` per frame. The streaks are thin cubes, lit by
the scene, so they catch the golden sun and the neon instead of being an unlit
white sprite. When Photo Mode slows world time, the rain hangs without any special
case.

Wheel spray is a second pool of 340 puffs thrown from the rear wheels. The rate
scales with speed, wetness and drift angle, so a slide throws a visible plume.

Wetness drives `ATDCPlayerCar::Wetness` (grip, via the existing tyre model) and,
if the road material declares them, three scalar parameters:

| Parameter | Meaning |
| --- | --- |
| `Wetness` | 0–1 overall |
| `RainIntensity` | 0–1 raw rain |
| `PuddleMask` | 0–1 puddle coverage |

A material that does not declare them ignores the write; nothing breaks.

## Photo Mode

`P` unpossesses the car, spawns `ATDCPhotoPawn` at the current camera and slows
world time to `0.0001×`. The pawn moves on `FApp::GetDeltaTime()`, so the
photographer flies at normal speed while the world is a still frame. The car's
synthesised audio is stopped, because a frozen engine note is not a photograph.

The lens is physical: a 36 mm sensor with a real f-stop and focus distance, applied
to the camera's post-process overrides. The camera constrains to 2.39:1, and the
HUD swaps to a thirds grid, corner brackets, live lens readout and controls.

`F12` runs `HighResShot 2`: a 200% render, downsampled, written to
`Saved/Screenshots`. That is a clean still rather than a viewport grab.

## Honest limits

- **Never compiled, never rendered.** Expect small API fixes on the first build.
- **Procedural meshes are not Nanite.** Nanite applies to imported Static Meshes.
  The city here is a readable procedural stand-in, not a Nanite city kit. The
  project config enables Nanite and Lumen, but this geometry will not use Nanite.
- **No material assets.** Neon is coloured geometry plus real rect lights, not an
  emissive material; nothing here has a custom shader. A real wet-asphalt material
  (dark albedo, high-frequency normal, roughness 0.05–0.3, puddle mask) is the
  single biggest visual upgrade available and needs to be authored in the editor.
- **Rain is instanced geometry, not Niagara.** It reads well in motion and costs one
  batch update, but it has no splashes on the road, no ripples and no lens drops.
- **No LUT grade, no lens dirt, no custom bloom kernel.** Those are assets.
- **The skyline does not collide** with the car.
- **Audio is synthesised** and has no rain or city layer yet; the weather system
  could drive one, but there is no rain asset.

## Knobs

| Want | Knob |
| --- | --- |
| Denser city | `SkylineBlocks` (220 → 400) |
| Taller city | `SkylineBlocks` height range in `BuildSkyline` |
| More rain | `RainIntensity`, `MaxDrops` |
| Cheaper rain | `MaxDrops`, `RainRadius` |
| More neon lights | `NeonLightBudget` (18) |
| No neon lights | `bNeonLights` |
| Later sunset | `SunElevationDegrees` (0–90) |
| Warmer grade | `SunColor`, `FogInscattering` |
| Harsher Zen | `ZenStartKmh`, `ZenFullKmh` |
| More/less drift help | `DriftAssistStrength`, `DriftAssistMaxTorque` |
| Fixed city | `Seed` |
