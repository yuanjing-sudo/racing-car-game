import pathlib, re
root = pathlib.Path('spooktacular-halloween-app/Sources')
# new symbols must be unique
for sym in ['CrystalShape', 'CrystalCave', 'ClosetKind', 'ClosetCache', 'ForkStyle', 'MNBoxyCritter', 'crystalType', 'inCrystalCave']:
    hits = []
    for f in root.rglob('*.swift'):
        txt = f.read_text(encoding='utf-8', errors='ignore')
        c = len(re.findall(r'\b' + sym + r'\b', txt))
        if c:
            hits.append((f.name, c))
    print(sym + ': ' + str(hits))
print('---- MonsterType/MNBlockType/MNMonsterKind refs outside home files ----')
for f in root.rglob('*.swift'):
    txt = f.read_text(encoding='utf-8', errors='ignore')
    for i, l in enumerate(txt.splitlines(), 1):
        if re.search(r'MonsterType|MNMonsterKind', l) and f.name not in ('TunnelMaze.swift', 'AbandonedMine.swift'):
            print(f.name + ':' + str(i) + ': ' + l.strip()[:120])
        if re.search(r'MNBlockType', l) and f.name != 'AbandonedMine.swift':
            print(f.name + ':' + str(i) + ': ' + l.strip()[:120])
print('done')
