import pathlib, re
root = pathlib.Path('spooktacular-halloween-app/Sources/Ultimate')
expected = ['SpooktacularApp.swift', 'ContentView.swift', 'TunnelMaze.swift',
    'AbandonedMine.swift', 'GhostCapture.swift', 'SpookyMusic.swift', 'SmoothClock.swift',
    'SpookyProEngine.swift', 'MineSmoothKit.swift', 'MineQuests.swift', 'MineCodex.swift',
    'MineLore.swift', 'MazeExpeditions.swift', 'MazeBonds.swift', 'MazeBestiary.swift',
    'SpookyGameFeel.swift', 'MineGhostTheater.swift', 'MineCrystalTheater.swift',
    'MineLighting.swift', 'MineParticles.swift', 'MineDioramas.swift', 'MineGhostTheater2.swift',
    'MineCrystalTheater2.swift', 'MineCinematic.swift', 'MineHUDMotion.swift',
    'MineSectorDioramas.swift', 'MineWeather.swift', 'MineBossCinema.swift', 'MinePetFX.swift',
    'MazeMotion.swift', 'MineCelebrations.swift', 'MineWorkshopFX.swift', 'MazeSkybox.swift',
    'MineTransitions.swift', 'MineArcadeFX.swift', 'MineWaterFX.swift', 'MineFireFX.swift',
    'MineGraphicsHub.swift', 'MineSpookyForest.swift', 'SpookyStore.swift',
    'MineBootSequence.swift', 'MineDailyHub.swift', 'MazeDailyHub.swift', 'MazeCinematics.swift',
    'MineArcadeOverhaul.swift', 'MineGameFX.swift', 'MineAlgorithms.swift', 'MineNetLoop.swift',
    'MineMotionEngine.swift', 'MineChoreography.swift', 'MineLoopKit.swift',
    'MineFishing.swift', 'MineEvents.swift', 'MineAchievements.swift', 'MineRelics.swift']
missing = []
total = 0
for name in expected:
    p = root / name if (root / name).exists() else root.parent / 'App' / name
    if not p.exists():
        # search anywhere
        hits = list(pathlib.Path('spooktacular-halloween-app/Sources').rglob(name))
        if not hits:
            missing.append(name)
            continue
        p = hits[0]
    total += len(p.read_text(encoding='utf-8', errors='ignore').splitlines())
print('EXPECTED FILES: ' + str(len(expected)) + ' MISSING: ' + str(missing if missing else 'none'))
print('EXPECTED-FILE LINES: ' + str(total))
# feature spot checks (symbol -> file)
spots = [
    ('TunnelMaze.swift', 'mazeWalkable'), ('TunnelMaze.swift', 'chaseViaStar'),
    ('TunnelMaze.swift', 'pathCache'), ('TunnelMaze.swift', 'MazeCinematicHost'),
    ('AbandonedMine.swift', 'func unlockCave'), ('AbandonedMine.swift', 'pickBlockOnRay'),
    ('AbandonedMine.swift', 'destroyedCount'), ('AbandonedMine.swift', 'MineEventDirector'),
    ('AbandonedMine.swift', 'func sellFish'), ('AbandonedMine.swift', 'func hatchPet'),
    ('AbandonedMine.swift', 'func doRebirth'), ('AbandonedMine.swift', 'Frostfall'),
    ('AbandonedMine.swift', 'frostPockets'), ('ContentView.swift', 'ArcadeShowcaseCard'),
    ('ContentView.swift', 'ArcadeMarquee'), ('App/SpooktacularApp.swift', 'MineBootSequenceView'),
]
ok = 0
for fname, sym in spots:
    t = (pathlib.Path('spooktacular-halloween-app/Sources') / fname).read_text(encoding='utf-8', errors='ignore')
    found = sym in t
    ok += 1 if found else 0
    if not found:
        print('MISSING SYMBOL: ' + sym + ' in ' + fname)
print('SPOT CHECKS: ' + str(ok) + '/' + str(len(spots)))
# full-repo balance
bad = []
nfiles = 0
for f in pathlib.Path('spooktacular-halloween-app/Sources').rglob('*.swift'):
    nfiles += 1
    txt = f.read_text(encoding='utf-8', errors='ignore')
    s = re.sub(r'"(?:[^"\\]|\\.)*"', '""', txt)
    s = re.sub(r'//.*', '', s)
    bal = (s.count('{') - s.count('}'), s.count('(') - s.count(')'), s.count('[') - s.count(']'))
    if bal != (0, 0, 0):
        bad.append((f.name, bal))
print('REPO FILES: ' + str(nfiles) + ' UNBALANCED: ' + str(bad if bad else 'none'))
