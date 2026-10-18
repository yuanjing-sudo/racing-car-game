# City Sample and Houdini — verified setup notes

This file records the Epic City Sample + Houdini procedure, checked against
Epic's own documentation, so it is ready when you reach a PC. **None of it can
run on the Android device this project was written on.**

## The four-step download list, checked

| # | Step | Verdict |
|---|---|---|
| 1 | Download Unreal Engine 5 | **Correct.** Free. Approx. 120 GB installed. |
| 2 | Download "City Sample" — contains the Python/Houdini scripts for city generation | **Correct in substance, wrong in detail.** The City Sample does ship Epic's Houdini tooling, but it is **Houdini Digital Assets (HDAs) + PDG**, not Python scripts. File: `CitySample_HoudiniFiles.zip`, inside the project folder. |
| 3 | Download the "Matrix Awakens" demo project | **This download does not exist.** The Matrix Awakens was a PS5/Xbox Series tech demo. The **City Sample *is* the project form of it** — same city, released as an editable UE project. There is no second, separate "Matrix Awakens demo project" on the Launcher or Fab. (A fan-made PC rebuild exists on itch.io; it is not Epic's.) |
| 4 | Look at the Chaos Vehicle template | **Correct.** `New Project > Games > Vehicle`. Uses Chaos Vehicles with a skeletal rig and suspension. |

So the list collapses to **two downloads: UE5 and City Sample.**

## What the City Sample contains

Source: Epic's official guide,
[City Sample Quick Start — Generating a City and Freeway using Houdini](https://dev.epicgames.com/documentation/unreal-engine/city-sample-quick-start-for-generating-a-city-and-freeway-using-houdini)

- `CitySample_HoudiniFiles.zip` — Epic's Houdini source files for the *Small_City*
  example.
- Custom **Houdini Digital Assets** (`.hda`), shown in Houdini's Asset Manager as
  "Sample Houdini Operators":
  - **City Layout** — street grid from a boundary curve plus arterial splines
  - **City Zone** — building height/density zones per district
  - **Freeway Util Curve Attribute** — 4- or 6-lane freeway, open or closed loop
  - **City Processor** — assembles everything and exports the caches
  - **City_Lot_Processor** — lots and building volumes (style, height, setbacks)
- A **PDG** (Procedural Dependency Graph) path that parallelises building
  generation for large cities.

Two-part process: **Part 1** generates the city in Houdini and exports geometry +
Point Cloud Alembics (PBC). **Part 2** imports that into the UE City Sample
project. Part 1 is the page linked above; Part 2 is
[Generating a City and Freeway in Unreal Engine 5](https://dev.epicgames.com/documentation/unreal-engine/city-sample-quick-start-for-generating-a-city-and-freeway-in-unreal-engine-5).

## Prerequisites — read this before starting

| Requirement | Detail |
|---|---|
| OS | **Windows 10.** Epic explicitly state the Houdini workflow and source files are *untested* on Mac and Linux and may not work. |
| Houdini | SideFX Houdini. Epic developed the City Sample against **18.5.532** and recommend that exact version. Run it once before configuring, so it generates its startup files. |
| Houdini licence | Houdini is commercial software. The free Apprentice tier is non-commercial only. Verify the licence covers your use. |
| Disk | ~2 GB to extract and generate small cities; **5–10 GB** for larger ones. On top of UE5 (~120 GB) and the City Sample project, one of the largest samples Epic ships. |
| GPU | See the recommended specs in Epic's City Sample documentation. Nanite + Lumen at city scale is demanding. |

## Part 1 — condensed Houdini checklist

The steps, and the places people get stuck:

1. In the City Sample project folder, find `CitySample_HoudiniFiles.zip` and
   extract it. You get a `Small_City` folder.
2. Put your working copy somewhere outside the project, e.g. `D:\CitySampleSource`.
3. Edit `C:\Users\<you>\Documents\houdini18.5\houdini.env` and append:
   ```
   HOUDINI_PATH = D:/CitySampleSource/Small_City/houdini;&
   ```
   **Use forward slashes**, and replace the path with yours. This is the single
   most common failure — get it wrong and the operators never appear.
4. Restart Houdini. Open `Asset > Asset Manager` and confirm the `.hda` files are
   listed under *Scanned Asset Library Directories*.
5. Create a city folder (e.g. `MyCity`) and **copy** `Small_City\houdini` into it
   so you never overwrite Epic's originals.
6. Build the layout: a **Geometry** object containing a **Curve** (the city
   boundary — the sample's Small City is ~1 km across, Big City ~5 km), wired into
   **City Layout** input 1. Name the city in the node's `City Name` field.
7. Add a second **Curve** for arterial roads → **City Layout** input 2. Multiple
   arteries go through a **Merge** first.
8. Add **City Zone** curves → **City Layout** input 3 to control where the tall
   buildings are. Enable `preview_zones` to see them.
9. Draw a freeway curve → **Freeway Util Curve Attribute** (4 or 6 lanes, `Closed`
   for a loop). Its ends must meet the arterial roads.
10. Wire **City Layout** (output 2) and the freeway node into **City Processor**.
    Switch Houdini to **Manual** update before cooking, then back to **Auto** —
    cooking takes several minutes.
11. Freeway-to-street connections live deep in the graph:
    `City Processor > FREEWAY > connections_blank > all_connections >
    connection_set_1`. Right-click and **Allow Editing of Contents** first.
    Lane counts must match between the freeway and the street it joins.
12. Export: tick **use PDG**, run the three stages, then **EXPORT ALL PBC**.
    Without PDG, run `process city without PDG`, check the *Caches and Exports*
    tab reads from disk, then export.

## How this connects to what is already built here

`ATDCProceduralRoad` + `ATDCPlayerCar` are the **lightweight path**: no Houdini, no
120 GB engine sample, a procedural road from a spline and a car you can drive
immediately. It exists so you have something working on day one.

The City Sample is the **heavyweight path**: a real 5 km city with a freeway
network, buildings, traffic and crowd simulation.

| Concern | This project | City Sample |
|---|---|---|
| Road geometry | `ATDCProceduralRoad`, spline-swept, `BankDegrees` as a max | Houdini `City Layout` + `Freeway Util Curve Attribute` |
| City buildings | none yet | `City_Lot_Processor` with Nanite building volumes |
| Traffic / crowd | none | built in |
| Car | `ATDCPlayerCar`, single rigid body, wet-grip model | Chaos Vehicle template, skeletal rig |

**Worth knowing:** Epic expose `Interpolation`, `Elevation` and `Banking` on the
freeway connection sets — the same three axes `ATDCProceduralRoad` exposes. So you
can build your circuit as a **closed 6-lane freeway loop in Houdini** (the
Freeway operator supports closed loops), export it, and drop `ATDCPlayerCar` onto
Epic's road quality. That is the strongest combination available: Epic's road,
your vehicle physics.

## The blocker, restated

Every step here requires the Epic Games Launcher and/or Houdini on Windows or
Linux. There is no Android build of either. This device can only write the
procedure down, which is what this file is.
