import pathlib, re
for fname in ['TunnelMaze.swift', 'AbandonedMine.swift']:
    p = pathlib.Path('spooktacular-halloween-app/Sources/Ultimate') / fname
    txt = p.read_text(encoding='utf-8', errors='ignore')
    stripped = re.sub(r'"(?:[^"\\]|\\.)*"', '""', txt)
    stripped = re.sub(r'//.*', '', stripped)
    bal = (stripped.count('{')-stripped.count('}'), stripped.count('(')-stripped.count(')'), stripped.count('[')-stripped.count(']'))
    print(fname + ' balance ' + str(bal) + (' OK' if bal == (0,0,0) else ' BAD') + ' | lines ' + str(len(txt.splitlines())))
tm = pathlib.Path('spooktacular-halloween-app/Sources/Ultimate/TunnelMaze.swift').read_text(encoding='utf-8', errors='ignore')
am = pathlib.Path('spooktacular-halloween-app/Sources/Ultimate/AbandonedMine.swift').read_text(encoding='utf-8', errors='ignore')
checks = [
    ('TM forkroads', 'generateForkroads()' in tm and 'ForkStyle' in tm),
    ('TM Y/T/Cross/Roundabout', all(s in tm for s in ['yFork', 'tJunction', 'crossroads', 'roundabout'])),
    ('TM crystal caves + 3 shapes', all(s in tm for s in ['CrystalCave', 'crystalCube', 'crystalSpike', 'crystalOrb', 'SCNPyramid'])),
    ('TM closets + fake kind', all(s in tm for s in ['ClosetCache', 'closetCrate', '.fake', 'openCloset'])),
    ('TM frontier growth', all(s in tm for s in ['expandFrontierIfNeeded', 'frontierKeys', 'maxFrontierTunnels'])),
    ('TM boxy animals (5)', all(s in tm for s in ['boxyMole', 'boxyBat', 'boxyAxolotl', 'boxyFox', 'goldenWisp', 'isBoxy', 'spawnBoxyAnimal'])),
    ('TM boxy cube body', 'chamferRadius: 0.08' in tm),
    ('TM gem loot from crystals', 'isHarvested' in tm),
    ('TM god-mode kept', 'mineGodMode' in tm and 'player.position = SCNVector3(0, 2, 0)' not in tm),
    ('TM no blocking veil', 'background(Color.black.opacity(0.85))' not in tm),
    ('AM crystal blocks', all(s in am for s in ['crystalCube', 'crystalSpike', 'crystalOrb', 'SCNPyramid', 'inCrystalCave'])),
    ('AM closet crates + loot', all(s in am for s in ['closetCrate', 'openMineCloset', 'Fake closet'])),
    ('AM critters', all(s in am for s in ['MNBoxyCritter', 'spawnBoxyCritters', 'updateCritters', 'syncCritters', 'critterNode'])),
    ('AM god-mode kept', 'lifeLossEnabled = false' in am and 'player.position = SCNVector3(0, 1.0, -15)' not in am),
    ('AM no fullscreen veil', 'Color.black.ignoresSafeArea()' not in am),
]
fails = 0
for name, ok in checks:
    print(('PASS' if ok else 'FAIL') + ' | ' + name)
    if not ok:
        fails += 1
print('RESULT: ' + ('ALL PASS' if fails == 0 else str(fails) + ' FAILURES'))
