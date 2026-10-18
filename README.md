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
  postfx.js           bloom + cinematic grade + FXAA
  car.js physics.js ai.js race.js camera.js controls.js
  hud.js menu.js audio.js particles.js configurator.js utils.js
unreal/TokyoDreamCircuit/   Unreal Engine 5.5 C++ starter project
```
