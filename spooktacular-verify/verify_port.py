import pathlib, re
root = pathlib.Path('spooktacular-halloween-app/Sources')
am = (root / 'Ultimate' / 'AbandonedMine.swift').read_text(encoding='utf-8', errors='ignore')
s = re.sub(r'"(?:[^"\\]|\\.)*"', '""', am)
s = re.sub(r'//.*', '', s)
bal = (s.count('{')-s.count('}'), s.count('(')-s.count(')'), s.count('[')-s.count(']'))
print('AbandonedMine balance ' + str(bal) + (' OK' if bal == (0,0,0) else ' BAD') + ' lines ' + str(len(am.splitlines())))
checks = [
    ('Fork styles 4', all(x in am for x in ['MNForkStyle', 'yFork', 'tJunction', 'crossroads', 'roundabout', 'Forkroad raised'])),
    ('Crystal caves+shapes', all(x in am for x in ['MNCrystalCave', 'MNCrystalShape', 'cube, spike, orb', 'checkCaveHarvest', 'fully harvested'])),
    ('Closet registry+kinds', all(x in am for x in ['MNClosetCache', 'MNClosetKind', 'mineClosets', 'closetKind(at:', 'isOpened = true'])),
    ('Frontier growth', all(x in am for x in ['expandMineFrontier', 'nearestAirCell', 'caveFloorSpots', 'mineCaves.count < 24', 'mineClosets.count < 60'])),
    ('Frontier critters+fanfare', all(x in am for x in ['wandered in from the new tunnels', 'critters.count < 8'])),
    ('Critter ore gifts', all(x in am for x in ['oreGifts', 'Rare encounter: Boxy'])),
    ('Static registries', all(x in am for x in ['registerStaticClosets', 'registerStaticCaves'])),
    ('Tycoon kept', all(x in am for x in ['sellBackpack', 'doRebirth', 'hatchPet', 'upgradeBackpack'])),
    ('God-mode kept', 'lifeLossEnabled = false' in am and 'player.position = SCNVector3(0, 1.0, -15)' not in am),
    ('No fullscreen veil', 'Color.black.ignoresSafeArea()' not in am),
]
f = 0
for n, ok in checks:
    print(('PASS' if ok else 'FAIL') + ' | ' + n)
    f += 0 if ok else 1
# new-type collisions
for sym in ['MNForkStyle', 'MNCrystalShape', 'MNCrystalCave', 'MNClosetKind', 'MNClosetCache']:
    hits = [(fp.name, len(re.findall(r'\b' + sym + r'\b', fp.read_text(encoding='utf-8', errors='ignore')))) for fp in root.rglob('*.swift')]
    hits = [h for h in hits if h[1] > 0]
    print(sym + ': ' + str(hits) + (' OK' if len(hits) == 1 and hits[0][0] == 'AbandonedMine.swift' else ' CHECK'))
print('RESULT: ' + ('ALL PASS' if f == 0 else str(f) + ' FAILURES'))
