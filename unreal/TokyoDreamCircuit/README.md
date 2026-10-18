# Tokyo Dream Circuit — UE5 starter
**Requirements:** Unreal Engine 5.5 and Visual Studio 2022 with the Game development with C++ workload. Enable the built-in Procedural Mesh Component plugin if prompted.

## Setup
1. Extract the ZIP. Right-click the `.uproject` and choose Generate Visual Studio project files.
2. Open the project and allow C++ compilation.
3. Create `Content/Maps/TokyoNightRun`.
4. Place `TDCProceduralRoad` at the world origin. Adjust road length, width, bank and elevation in Details.
5. Place `TDCPlayerCar` above the start of the road (Z around 250), facing +X. Press Play.
6. Add Directional Light, Sky Atmosphere, Sky Light, Exponential Height Fog and a Post Process Volume. Lock exposure and tune sunset, bloom and motion blur.
7. Create a wet asphalt material and assign it to `WetAsphaltMaterial`: dark asphalt, high-frequency normal, puddle mask and variable roughness (about 0.05–0.3).
8. Import licensed art for the hypercar, Tokyo skyline, Tokyo Tower, Mount Fuji, sakura, Japanese road signs, rails and pillars.

**Controls:** W throttle, S reverse, A/D steer, Space brake, Left Shift handbrake.

**Scope:** This is a source scaffold, not a finished AAA game. The road is procedural and collision-enabled. The fallback car is a physics-driven cube with approximate wet lateral grip, not a Chaos Wheeled Vehicle. Real suspension/tire behavior requires Chaos Vehicles, a skeletal vehicle mesh, wheel blueprints, tire friction curves, transmission and differential. Tokyo art assets and final vehicle art are not included. This package has not been compiled in an Unreal installation here; engine-version-specific issues may need fixing.

**Cinematic art pass:** Enable Lumen GI/reflections and Virtual Shadow Maps; use fixed exposure, restrained bloom, fog and speed-sensitive motion blur. Add lane decals, curbs, guardrails, puddles, drainage, expansion joints, skyline layers, tower, Fuji silhouette, sakura and distant traffic. No paid or copyrighted assets included.
