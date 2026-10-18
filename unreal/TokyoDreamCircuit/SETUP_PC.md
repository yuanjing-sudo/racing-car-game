# Do this — the PC setup runbook

Your four steps, checked and corrected, with exact click paths. **Read the verdict
column first**: two of the four are not what they look like.

| # | Your step | Verdict |
|---|---|---|
| 1 | Download Unreal Engine 5 (Free) | ✅ **Correct.** Via Epic Games Launcher. ~123 GB during download/install. |
| 2 | Download the City Sample — "contains the exact Python/Houdini scripts for city generation" | ⚠️ **Right idea, wrong detail.** It ships Epic's Houdini tooling, but they are **Houdini Digital Assets (HDAs) + PDG**, *not* Python scripts. Also: it is not a "download the ZIP" — you claim it on **Fab**, then install it from the Launcher. |
| 3 | Download the "Matrix Awakens" demo project | ❌ **This download does not exist.** The Matrix Awakens was a PS5/Xbox tech demo. **The City Sample *is* its project form** — same city, released as an editable UE project. There is no second, separate project. *(A fan-made PC rebuild exists on itch.io; it is not Epic's.)* |
| 4 | Look at the Chaos Vehicle template | ✅ **Correct** — and it is a *template*, not an installed package. You create a project from it. Walkthrough below. |

**Net result: two downloads, not four — UE5 and the City Sample.**

---

## Why this cannot be done from this device

Stated once, precisely, because it is not a policy preference — it is a hard
technical wall that was verified:

| Check | Result |
|---|---|
| Architecture | `aarch64` (ARM64). UE5 ships x86-64 only. |
| Epic Games Launcher | No Android build. `unrealengine.com/download` states it outright: *"Sorry, downloads are not available on mobile devices."* |
| Wine / box64 / qemu-x86_64 | None installed, none viable — even emulated, UE5 needs DX12/Vulkan, 8 GB+ VRAM and ~123 GB. |
| City Sample requirements | Epic's own spec: **Windows 10 + DX12, 12-core CPU @ 3.4 GHz, 64 GB RAM, RTX 2080 / RX 6000+, 8 GB VRAM, SSD.** |
| Free space here | 154 GB on `/sdcard` — enough on paper, but there is nothing to run it on. |

Everything in this folder is source text written on that device. Nothing here has
been compiled, and it cannot be until you are on a PC.

---

## Step 1 — Unreal Engine 5

1. Go to **https://www.unrealengine.com/download** on the PC.
2. Download and install the **Epic Games Launcher** (Windows or macOS; there is a
   downloadable Linux build too, though Epic only fully supports Win/macOS).
3. Sign in / create a free Epic account.
4. **Unreal Engine** tab → **Library** → **+** → pick **5.5**.
   - Install **5.5** specifically: `TokyoDreamCircuit.uproject` has
     `"EngineAssociation": "5.5"`. A different minor version will offer to
     convert the project — usually fine, but 5.5 is what the config targets.
5. **Optional, saves ~50–70 GB.** Click the dropdown next to the version →
   **Options** → untick target platforms you do not need (**Android, iOS, Linux,
   and the console platforms**). Unreal's own docs note this takes a default
   install from ~123 GB down to roughly 55 GB.

**Storage reality:** the quoted ~123 GB includes the downloaded installer, which
Unreal removes after install — the settled footprint is around 60 GB. Keep at
least **80 GB free** before you start.

## Step 2 — City Sample, the right way

The Launcher has no "City Sample" button. The correct path, per Epic's
documentation, is:

1. Go to **https://www.fab.com** and find **City Sample**.
2. Click **Add to My Library** (it is free — this is the step everyone misses,
   and without it nothing appears in the Launcher).
3. Open the **Epic Games Launcher** → **Unreal Engine** → **Library** →
   **Fab Library**. City Sample is now listed there.
4. **Create** it, choosing a **different Unreal version than the one it defaults
   to if prompted**, and an install location **on an SSD** — the docs are
   explicit that Nanite and Virtual Shadow Maps need SSD speeds.
5. Expect a large download and a large project. Budget **~100 GB+** on top of the
   engine.

Inside the project folder you will find **`CitySample_HoudiniFiles.zip`** — that
is step 2's "city generation scripts", and they are HDAs + PDG, not Python.
Full procedure and the gotchas: **`CITY_SAMPLE.md`** in this folder.

## Step 3 — nothing to do

The Matrix Awakens project does not exist as a separate download. Step 2 already
gave you it. Skip step 3 entirely.

---

## Step 4 — the Chaos Vehicle template, walked through

This one you asked to "look at", so here is the inspection, done for you.

**What "the Chaos Vehicle template" actually is:** not a package you install. It
appears in the **New Project** dialog: **Games** category → **Vehicle**. In UE 5.5
the dialog offers **Blank** and **Vehicle** under Games; the Vehicle template
ships both an **off-road** and a **sports** variant.

**What it contains:**

| Asset | What it is |
|---|---|
| `WheeledVehiclePawn` Blueprints | The car pawns. Both variants derive from the engine class `AWheeledVehiclePawn`. |
| Skeletal meshes | The car bodies, with **wheel bones** — 4 wheels plus a root. |
| Physics assets | A **sphere collider per wheel** and a **convex hull chassis**. The vehicle will not drive without this. |
| `ChaosVehicleWheel` Blueprints | One per axle type (front / rear). Radius, width, friction multiplier, max steer angle, and the `Affected By Handbrake` / `Affected By Engine` / `Affected By Steering` flags. |
| Anim Blueprint (`VehicleAnimationInstance`) | Rotates the wheel bones to match simulated wheel speeds. Must be parent class `VehicleAnimationInstance`. |
| HUD widget | Gear and speed, under `Content/VehicleTemplate/UI/`. |
| Test level | Ramps and terrain for driving it immediately. |

Typical starting values seen in the wheel Blueprints: **wheel width ~65, friction
force multiplier ~12, max steer angle / affected-by-steering ~65°**.

**The trap that wastes everyone's afternoon:** the template works because of the
**skeletal mesh + physics asset pairing**. The physics asset's wheel bodies must
be named to match the bones, and the wheel Blueprints' `Bone Name` must match
those bodies. If any of those three names disagree, the car spawns and does not
move. This is the number one reason people conclude "Chaos Vehicles is broken".

**Requirements:** the **ChaosVehiclesPlugin**. It is already enabled in this
project's `.uproject`.

### How to use it with what is already here

Two routes.

**Route A — migrate the template's vehicle in.** Create a throwaway project from
**Games → Vehicle**, then in its Content Browser select the vehicle Blueprints,
skeletal mesh, physics asset and wheel Blueprints → right-click → **Asset
Actions → Migrate** → point at this project's `Content`. Then set
`DefaultPawnClass` to the migrated pawn.

**Route B — build a Chaos vehicle from scratch in this project.** Follow Epic's
documentation, *How to Set up Vehicles in Unreal Engine*: create a
`WheeledVehiclePawn` Blueprint, a `ChaosVehicleWheel` Blueprint per axle, assign
the skeletal mesh and physics asset, and set the wheel bones to match.

### Which car to use — the actual trade-off

| | `ATDCPlayerCar` (already here) | Chaos Vehicle template |
|---|---|---|
| Setup | Works now, zero authoring | Needs a skeletal mesh, wheel bones, a physics asset and matched names |
| Physics | One rigid body, bicycle-model tyre solver, slip angles, friction circle, wet-grip blending | Real suspension, per-wheel tyre forces, engine/gearbox/differential |
| Wet handling | `Wetness` 0→1 blends dry grip toward `WetGrip` — a first-class feature | Set per physical material; needs authoring |
| Panel/livery, doors, interior | No | Yes — it is a skeletal mesh |
| Vehicle count | Cheap, scales to many | Heavier |

**Recommendation: keep `ATDCPlayerCar` as the default and treat Chaos as an
upgrade path.** The template's headline advantage is a *skeletal* car — animated
suspension, doors, steering wheel, damage. That is exactly what you need once you
have a real car model, and exactly what you do not need while your car is a
scaled cube. The code is already arranged for it:
`ATDCPlayerCar::bPhysicsEnabled` hands the body over to another system, and
`TokyoDreamCircuit.Build.cs` has the Chaos dependency lines commented and ready.

Start with Route A once you have a real vehicle mesh. Until then, `ATDCPlayerCar`
gets you driving today, with wet-grip behaviour the template does not give you
for free.

---

## Storage budget

Plan for a big install. Numbers are Epic's and community-reported; treat them as
estimates, not guarantees.

| Item | Approx. size |
|---|---|
| Unreal Engine 5.5 (default) | ~123 GB peak, ~60 GB settled |
| Unreal Engine 5.5 (platforms unticked) | ~55 GB |
| Epic Games Launcher | ~1 GB |
| City Sample project | Large — budget 50–100 GB+ |
| City Sample generated data (if you run **Part 1**) | +2 GB small city, 5–10 GB larger |
| Visual Studio 2022 (C++ workload) | ~10–20 GB |
| **Working total to be safe** | **~250 GB free, on an SSD** |

---

## Checklist

- [ ] Free up ~250 GB on an SSD
- [ ] Install Epic Games Launcher
- [ ] Install Unreal Engine **5.5**, unticking unneeded platforms
- [ ] Install **Visual Studio 2022** with the *Game development with C++* workload
- [ ] On **Fab**, *Add to My Library* → **City Sample**, then install it from the Launcher's Fab Library (SSD)
- [ ] *(Skip "Matrix Awakens" — it does not exist)*
- [ ] Create a throwaway project from **Games → Vehicle** and drive the template
- [ ] On this repo: `unreal/TokyoDreamCircuit/` → right-click the `.uproject` → **Generate Visual Studio project files** → open → allow C++ to compile
- [ ] Follow this folder's **`README.md`** to build the night map, then **`REALISM.md`** for the look
