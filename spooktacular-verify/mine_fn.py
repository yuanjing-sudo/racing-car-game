import pathlib, re
p = pathlib.Path('spooktacular-halloween-app/Sources/Ultimate/AbandonedMine.swift')
lines = p.read_text(encoding='utf-8', errors='ignore').splitlines()
for i, l in enumerate(lines, 1):
    if re.search(r'func (mine|tapMine|hitBlock|breakBlock|blast|updateMonsters|topUpMonsters|spawnMonsters|attackPlayer|pointIsAir|tryMove)\w*', l):
        print(str(i) + ': ' + l.strip()[:150])
print('---- MNMonsterKind switches ----')
for i, l in enumerate(lines, 1):
    if 'MNMonsterKind' in l and ('switch' in l or 'case' in l):
        print(str(i) + ': ' + l.strip()[:150])
