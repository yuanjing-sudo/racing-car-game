# `js/gfx/` — Advanced Graphics Subsystem

This document is the **interface contract** for the `js/gfx/` rendering subsystem.
Every module in this folder must follow it so the orchestrator can wire everything
together without special-casing individual files.

## Project

* **VELOCE GT-R** — a browser racing game built directly on **Three.js r160**.
* No build step. Files are plain ES modules served over HTTP.
* Imports use the bare specifiers provided by the page's import map:
  ```js
  import * as THREE from 'three';
  import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';
  import { FullScreenQuad } from 'three/addons/postprocessing/Pass.js';
  ```
* No TypeScript, no npm packages, no bundler, no external assets (textures are
  generated procedurally on a `<canvas>`).

## Style

* 2-space indent, semicolons, single quotes.
* A JSDoc block on every exported symbol describing **what the technique is** and
  why it is used.
* 350–900 lines per file. Write real, working, well-commented code — never filler.
* Reuse scratch objects; **never allocate inside the per-frame path**.
* Prefer `InstancedMesh`, half-float render targets and typed arrays.
* Never throw at import time; degrade gracefully if a feature is unavailable.
* Do not change files outside your assigned list.

## Layout

```
js/gfx/
  index.js            orchestrator (owned by the integrator, not subagents)
  post/               post-processing effects
    index.js          post pipeline (owned by the integrator)
|
  sky.js              atmospheric sky
  volumetrics.js      volumetric fog + light shafts
  weatherfx.js        advanced weather
  lighting.js         artistic lighting rig
  shadows.js          shadow management
  reflections.js      planar + probe reflections
  props.js            road furniture & architecture
  decals.js          road markings & dynamic decals
  dynamicprops.js     animated world: air traffic, turbines, fountains, searchlights
  screens.js          trackside LED media: jumbotrons, ribbons, timing tower
  roaddetail.js       asphalt wear: patches, tar snakes, seams, drains, marbles
  crew.js             marshals, camera operators, photographers
  kerbs.js            raised bevelled apex kerbs
  traffic.js          signalised crossings + civilian traffic
  cones.js            collidable work-zone cones
  skyline.js          city skyline: towers, podiums, signs, beacons (city, tokyo)
  rural.js            farmland, hedgerows, farmsteads, leaves (countryside, forest)
  wilds.js            rock and snow, mesas and saguaro, coast and lighthouse
                      (alpine, desert, coastal)
  geometry.js         geometry helper library
  car.js              detailed procedural hypercar
  materials.js        advanced PBR material library
  particles.js        advanced particle systems
  cinematic.js        cinematic camera director
```

## Post-effect contract

Every file in `js/gfx/post/` **except** `index.js` exports exactly one factory:

```js
/**
 * @param {{ width:number, height:number }} opts
 * @returns {PostEffect}
 */
export function createXxxEffect(opts = {}) { /* ... */ }
```

A `PostEffect` is a plain object with this shape:

```js
{
  name: string,                 // stable id, e.g. 'gtao'
  passes: THREE.Pass[],         // Passes inserted into the composer, in order
  setSize(width, height): void, // resize internal render targets
  update(dt, ctx): void,        // push per-frame uniforms
  setEnabled(enabled): void,    // toggle (keep the pass in the chain)
  dispose(): void               // release render targets / materials
}
```

Rules:

* Work in **linear HDR** space. Three.js applies tone mapping at the end via the
  `OutputPass`, so **your shaders must not tone-map**.
* Each module is **self-contained** — import only `three` and `three/addons/*`.
  Do not import sibling effect files or `common.js`.
* Guard against missing `ctx.depthTexture` (skip the effect when absent).
* Keep the pass count small; multi-pass effects may return several entries in
  `passes` (e.g. bloom: prefilter → blur H ×N → blur V ×N → composite).

### `ctx` passed to `update(dt, ctx)`

```js
{
  renderer, scene, camera,
  width, height, deltaTime, elapsed,
  depthTexture,          // THREE.DepthTexture | null  (linear-ish depth of the scene)
  cameraNear, cameraFar, // numbers, for depth linearisation
  sunDirection,          // THREE.Vector3 — normalised, points TOWARD the sun
  sunColor,              // THREE.Color
  isNight,               // boolean
  wetness,               // 0..1 road wetness
  speed01,               // 0..1 player speed
  exposure,              // renderer.toneMappingExposure
  settings,              // see "Quality settings"
}
```

## Quality settings object

```js
{
  quality: 'low' | 'medium' | 'high' | 'ultra',
  gtao: true, ssr: true, bloom: true, lensflare: true, godrays: true,
  dof: true, motionblur: true, colorgrade: true, smaa: true,
  volumetricFog: true, reflections: true, decals: true, shadows: true,
  bloomStrength: number, ssrIntensity: number, /** ... */
}
```

## Non-post module contract

Modules outside `post/` export one factory each that takes its dependencies and
returns an object with at least:

```js
{
  update(dt, ctx): void,   // per-frame
  setSize?(w, h): void,
  dispose(): void,
}
```

Typically they also expose a `group` (a `THREE.Group` already added to the scene
by the module) and domain-specific setters such as `setTheme(...)`,
`setWeather(...)`, `setQuality(...)`.

## Defensive rules

* Wrap optional WebGL2 features in `try/catch` and fall back.
* Clamp all user/quality inputs.
* Free every render target and material in `dispose()`.
* Do not assume `ctx.depthTexture` exists — check first.

## Testing (required)

`node --check` parses `.js` as CommonJS and rejects `import`, so verify via a
`.mjs` copy:

```bash
cp js/gfx/yourfile.js /data/data/com.termux/files/usr/tmp/opencode/chk_$$.mjs
node --check /data/data/com.termux/files/usr/tmp/opencode/chk_$$.mjs
```

Fix **all** syntax errors before finishing.
