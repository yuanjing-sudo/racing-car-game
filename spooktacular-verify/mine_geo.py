import pathlib, re
p = pathlib.Path('spooktacular-halloween-app/Sources/Ultimate/AbandonedMine.swift')
lines = p.read_text(encoding='utf-8', errors='ignore').splitlines()
for i, l in enumerate(lines, 1):
    if re.search(r'SCN(Box|Pyramid|Sphere|Cone|Cylinder)|func (rebuild|syncBlocks|blockNode|monsterNode|spawnCritter|updateCritter)', l):
        print(str(i) + ': ' + l.strip()[:150])
print('==== spawn/update monsters ====')
for n in [996, 1010, 1025]:
    print('---- around ' + str(n) + ' ----')
    for i in range(n-1, min(n+45, len(lines))):
        print(str(i+1) + ': ' + lines[i].strip()[:140])
