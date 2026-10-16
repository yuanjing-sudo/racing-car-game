import pathlib, re
root = pathlib.Path('spooktacular-halloween-app/Sources')
for fname in ['Ultimate/MineAlgorithms.swift', 'Ultimate/MineNetLoop.swift',
              'Ultimate/TunnelMaze.swift', 'Ultimate/AbandonedMine.swift']:
    p = root / fname
    txt = p.read_text(encoding='utf-8', errors='ignore')
    s = re.sub(r'"(?:[^"\\]|\\.)*"', '""', txt)
    s = re.sub(r'//.*', '', s)
    bal = (s.count('{') - s.count('}'), s.count('(') - s.count(')'), s.count('[') - s.count(']'))
    print(fname + ' lines=' + str(len(txt.splitlines())) + (' OK' if bal == (0, 0, 0) else ' BAD ' + str(bal)))
seen = {}
dups = []
for f in sorted(root.rglob('*.swift')):
    for line in f.read_text(encoding='utf-8', errors='ignore').splitlines():
        m = re.match(r'\s*(?:public|private|final|open)?\s*(struct|class|enum|actor|protocol)\s+(\w+)', line)
        if m and not line.strip().startswith('//'):
            indent = len(line) - len(line.lstrip())
            if indent == 0:
                n = m.group(2)
                if n in seen:
                    dups.append((n, seen[n], f.name))
                else:
                    seen[n] = f.name
newdups = [d for d in dups if d[0] in ('SeededRNG', 'PerlinNoise', 'CarveCell', 'MazeCarveResult',
    'MazeCarver', 'AStarPathfinder', 'MineRaycaster', 'MineNoiseShowcase',
    'MineCarverShowcase', 'MineCarveGrid', 'MineAStarShowcase', 'MineRaycastShowcase',
    'MineAlgorithmsShowcaseView', 'MineNetCommand', 'MineNetEvent', 'MineAuthority',
    'MineRelayDemo', 'MineNetShowcaseView')]
print('NEW-TYPE DUPES: ' + str(newdups if newdups else 'none'))
print('ALL TOP DUPES: ' + str(dups if dups else 'none'))
