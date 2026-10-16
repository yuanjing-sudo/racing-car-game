import pathlib, re
base = pathlib.Path('spooktacular-halloween-app/Sources')
spots = [
    ('Ultimate/TunnelMaze.swift', 'mazeWalkable'), ('Ultimate/TunnelMaze.swift', 'chaseViaStar'),
    ('Ultimate/TunnelMaze.swift', 'pathCache'), ('Ultimate/TunnelMaze.swift', 'MazeCinematicHost'),
    ('Ultimate/AbandonedMine.swift', 'func unlockCave'), ('Ultimate/AbandonedMine.swift', 'pickBlockOnRay'),
    ('Ultimate/AbandonedMine.swift', 'destroyedCount'), ('Ultimate/AbandonedMine.swift', 'MineEventDirector'),
    ('Ultimate/AbandonedMine.swift', 'func sellFish'), ('Ultimate/AbandonedMine.swift', 'func hatchPet'),
    ('Ultimate/AbandonedMine.swift', 'func doRebirth'), ('Ultimate/AbandonedMine.swift', 'frostPockets'),
    ('Ultimate/ContentView.swift', 'ArcadeShowcaseCard'),
    ('Ultimate/ContentView.swift', 'ArcadeMarquee'), ('App/SpooktacularApp.swift', 'MineBootSequenceView'),
]
ok = 0
for fname, sym in spots:
    t = (base / fname).read_text(encoding='utf-8', errors='ignore')
    found = sym in t
    ok += 1 if found else 0
    if not found:
        print('MISSING SYMBOL: ' + sym + ' in ' + fname)
print('SPOT CHECKS: ' + str(ok) + '/' + str(len(spots)))
bad = []
nfiles = 0
for f in base.rglob('*.swift'):
    nfiles += 1
    txt = f.read_text(encoding='utf-8', errors='ignore')
    s = re.sub(r'"(?:[^"\\]|\\.)*"', '""', txt)
    s = re.sub(r'//.*', '', s)
    bal = (s.count('{') - s.count('}'), s.count('(') - s.count(')'), s.count('[') - s.count(']'))
    if bal != (0, 0, 0):
        bad.append((f.name, bal))
print('REPO FILES: ' + str(nfiles) + ' UNBALANCED: ' + str(bad if bad else 'none'))
