# VELOCE GT-R — Racing Game

A cinematic, browser-based 3D racing simulator built on [Three.js](https://threejs.org/).
Everything in the scene is generated procedurally at load time (tracks, terrain,
scenery, PBR materials, weather and lighting), so there are no external art assets
to fetch.

## Running it

The game is a static site with ES modules and an import map for Three.js, so it must
be served over HTTP (opening `index.html` from `file://` will not work):

```bash
python3 -m http.server 8000      # or: npx serve
# then open http://localhost:8000
```

**Controls:** WASD / arrows drive · Space handbrake · Shift handbrake · `C` camera ·
`N` nitro · `M` mute · `H` toggle HUD · `Esc` pause.

## Tracks

| Track | Character |
| --- | --- |
| Alpine Pass | Mountain hairpins with snow peaks |
| Coastal Highway | Seaside cliffs and ocean views |
| Desert Storm | Sand dunes and canyon sweeps |
| Forest Rally | Dense woodland technical stage |
| City Circuit | Night street racing through downtown |
| **Tokyo Dream Circuit** | **Rain-slicked neon night through Tokyo** |
| Countryside Sprint | Rolling hills and farmland |

### Tokyo Dream Circuit

The Tokyo Dream Circuit is authored as a single pass of cinematic neon night:

* **Soaked, mirror-like tarmac** — the strongest wet-asphalt preset in the game
  (`metalness` 0.66, `envMapIntensity` 2.35) so the puddle roughness map turns the
  road into a mirror of the skyline.
* **Layered skyline** — a dense ring of tall towers lining the circuit plus a
  distant skyline ring with lit window sheets and over-bright neon crowns.
* **Landmarks** — a red-and-white lattice broadcast tower (Tokyo Tower) and a hazy
  Mount Fuji silhouette on the horizon.
* **Vertical neon signage** — katakana billboards on mounting poles that face the
  racing line, tuned to bleed through the bloom pass.
* **Atmosphere** — rain weather, a wet 19:36 dusk, sakura trees and a reduced fog
  scale so the skyline stays legible through the downpour.

The track is closed (no gaps) and flat, with the same checkpoint/sector logic as the
other circuits. The above parameters live in `js/main.js` (`startRace` /
`startFreeRoam`), `js/track.js`, `js/materials.js` and `js/scenery.js`.

## Unreal Engine 5 project

A **UE5.5 C++ starter scaffold** for the same circuit lives in
[`unreal/TokyoDreamCircuit/`](unreal/TokyoDreamCircuit/) — a procedural,
collision-enabled road, an input-driven physics car, the game mode and the config
needed to open the project directly in Unreal Engine 5.5.

> Unreal Engine cannot build or run on the Android/Termux device this was authored
> on. To build it, open the `.uproject` on a desktop with **Unreal Engine 5.5** and
> **Visual Studio 2022** (Game development with C++ workload) or Xcode. See that
> folder's `README.md` and `SCENE_SETUP_CHECKLIST.txt` for the setup steps.

## Unity project

A **Unity 6.3 LTS** port lives in [`unity/TokyoDreamCircuit/`](unity/TokyoDreamCircuit/) —
the same road maths, the same SI car physics and the same numbers as the Unreal
version, in C#. Its `TDCSceneBootstrap` component builds the entire scene at runtime
(road, car, chase camera, night lighting), so unlike the Unreal version there is no
level to assemble by hand.

> Unity likewise cannot run on the Android device this was authored on. Open the
> folder in **Unity Hub** (any Unity 6 LTS) and see that folder's `README.md` for the
> two-step start, or `REALISM_UNITY.md` for the HDRP cinematic setup and an honest
> map of what Unity does and does not have an equivalent for.

## Advanced graphics engine

An optional, self-contained rendering subsystem lives in
[`js/gfx/`](js/gfx/) and is wired into the game by `main.js`. It replaces the
old bloom + grade + FXAA stack with a full HDR pipeline and adds a physically
motivated world layer on top of the existing track and scenery:

| Area | Modules | What it does |
| --- | --- | --- |
| **World** | `sky.js`, `volumetrics.js`, `lighting.js`, `shadows.js` | raymarched atmosphere with sun/moon discs, height fog with light shafts, a pooled street-light/neon rig, cascaded shadow maps |
| **Post** | `post/*.js` | GTAO, screen-space reflections, god rays, bloom, lens flare, depth of field, motion blur, colour grade, SMAA — chained in linear HDR, tone-mapped once at the end |
| **Content** | `props.js`, `geometry.js`, `decals.js`, `weatherfx.js`, `particles.js` | start-light gantry, sponsor gantries, grandstands with a crowd, pit building, catch fencing, tyre walls, marshal posts, billboards, floodlights; ring-buffered skid trails; splash ripples, wind streaks and lightning; six particle pools |
| **Look** | `materials.js`, `reflections.js` | procedural PBR library with a shared wetness blend; PMREM image-based lighting baked per theme |

The engine is defensive: each sub-system is created behind a guard, so if one
fails to initialise the rest of the game carries on unchanged. Quality tiers
(`low` → `ultra`) are chosen from the device's resolution and memory and can be
changed at runtime. See [`js/gfx/CONVENTIONS.md`](js/gfx/CONVENTIONS.md) for the
module interface contract.

## Project layout

```
index.html            entry point + import map
css/style.css         UI, HUD, menu and track-tile styling
js/
  main.js             bootstrap + game loop
  track.js            procedural circuit generation and themes
  scenery.js          terrain, foliage, city and Tokyo landmarks
  materials.js        procedural PBR materials (asphalt, paint, glass…)
  weather.js          sky, time of day, rain/snow/petals, fog
  postfx.js           compatibility shim over the graphics engine
  car.js physics.js ai.js race.js camera.js controls.js
  hud.js menu.js audio.js configurator.js utils.js
  gfx/                advanced graphics engine (see above)
    index.js sky.js volumetrics.js lighting.js shadows.js
    materials.js reflections.js props.js geometry.js decals.js
    particles.js weatherfx.js CONVENTIONS.md
    post/             HDR post-processing chain (9 effects + orchestrator)
unreal/TokyoDreamCircuit/   Unreal Engine 5.5 C++ starter project
unity/TokyoDreamCircuit/    Unity 6.3 LTS C# port (same car and road maths)
```
