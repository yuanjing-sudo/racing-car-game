import pathlib, re
p = pathlib.Path('spooktacular-halloween-app/Sources/Ultimate/TunnelMaze.swift')
lines = p.read_text(encoding='utf-8', errors='ignore').splitlines()
for i, l in enumerate(lines, 1):
    if re.search(r'func (placeTunnelBlocks|placeRoomBlocks|placeLights|syncNodes|rebuildNodes|updateNodes|addMonsterNode|addTreasureNode|nodeFor|makeNode|spawnMonsterNode|renderMonsters|renderTreasures)', l):
        print(str(i) + ': ' + l.strip()[:140])
print('---- MonsterType switches ----')
txt = '\n'.join(lines)
for m in re.finditer(r'switch [^\n]*\n(?:.*\n){1,3}', txt):
    pass
# find all 'case .slime' occurrences to locate exhaustive switches
for i, l in enumerate(lines, 1):
    if '.slime' in l or 'MonsterType.allCases' in l or 'case .elderGuardian' in l:
        print(str(i) + ': ' + l.strip()[:140])
