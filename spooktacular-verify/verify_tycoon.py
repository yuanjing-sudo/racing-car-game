import pathlib, re
root = pathlib.Path('spooktacular-halloween-app/Sources')
print('---- MNPlayer( constructions ----')
for f in root.rglob('*.swift'):
    for i, l in enumerate(f.read_text(encoding='utf-8', errors='ignore').splitlines(), 1):
        if 'MNPlayer(' in l:
            print(f.name + ':' + str(i) + ': ' + l.strip()[:120])
print('---- MNPickTier refs outside AbandonedMine ----')
for f in root.rglob('*.swift'):
    if f.name == 'AbandonedMine.swift':
        continue
    for i, l in enumerate(f.read_text(encoding='utf-8', errors='ignore').splitlines(), 1):
        if 'MNPickTier' in l or 'MNDepthLayer' in l or 'MNPet' in l:
            print(f.name + ':' + str(i) + ': ' + l.strip()[:120])
print('---- balance ----')
for fname in ['AbandonedMine.swift']:
    p = root / 'Ultimate' / fname
    txt = p.read_text(encoding='utf-8', errors='ignore')
    s = re.sub(r'"(?:[^"\\]|\\.)*"', '""', txt)
    s = re.sub(r'//.*', '', s)
    bal = (s.count('{')-s.count('}'), s.count('(')-s.count(')'), s.count('[')-s.count(']'))
    print(fname + ' ' + str(bal) + (' OK' if bal == (0,0,0) else ' BAD') + ' lines ' + str(len(txt.splitlines())))
am = (root / 'Ultimate' / 'AbandonedMine.swift').read_text(encoding='utf-8', errors='ignore')
checks = [
    ('6 depth layers', all(x in am for x in ['MNDepthLayer', 'Magma Core', 'rewardMultiplier', 'hardnessBonus'])),
    ('Crystal+Drill tiers', all(x in am for x in ['case crystal', 'case drill', 'Void Drill', 'Crystal Pick'])),
    ('Backpack+capacity', all(x in am for x in ['backpackCapacity', 'backpackFull', 'upgradeBackpack', 'backpackCost'])),
    ('Sell loop+surface bonus', all(x in am for x in ['sellBackpack', 'sellPad', 'isAtSellPad'])),
    ('Coal protected', 'Coal Ore", default: 0]' in am and 'never sold' in am),
    ('Pets hatch/equip 3', all(x in am for x in ['MNPet', 'hatchPet', 'togglePetEquip', 'petEggCost', 'speedMult', 'luckChance', 'petGoldMult'])),
    ('Rebirth stays put', all(x in am for x in ['canRebirth', 'doRebirth', 'rebirthMult', 'stay exactly where'])),
    ('Sectors 9 + deepest', all(x in am for x in ['trackExploration', 'sectorsFound', 'deepestY'])),
    ('Depth toughness+pet speed', all(x in am for x in ['effectiveToughness', 'speedMult * rebirthMult'])),
    ('HUD layer+pack+sell btn', all(x in am for x in ['currentLayer.title', 'sellBackpack()', 'Unsold value'])),
    ('Panel sections', all(x in am for x in ['Backpack Mk', 'Hatch mystery egg', 'REBIRTH'])),
    ('No death kept', 'locked ON' in am and 'player.position = SCNVector3(0, 1.0, -15)' not in am),
    ('No fullscreen veil', 'Color.black.ignoresSafeArea()' not in am),
]
f = 0
for n, ok in checks:
    print(('PASS' if ok else 'FAIL') + ' | ' + n)
    f += 0 if ok else 1
print('RESULT: ' + ('ALL PASS' if f == 0 else str(f) + ' FAILURES'))
