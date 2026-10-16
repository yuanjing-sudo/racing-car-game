import pathlib, re
root = pathlib.Path('spooktacular-halloween-app/Sources')
newfiles = ['MineLighting.swift', 'MineParticles.swift', 'MineDioramas.swift',
            'MineGhostTheater2.swift', 'MineCrystalTheater2.swift',
            'MineCinematic.swift', 'MineHUDMotion.swift',
            'MineGhostTheater.swift', 'MineCrystalTheater.swift']
total = 0
bad = []
for fname in newfiles + ['AbandonedMine.swift']:
    p = root / 'Ultimate' / fname
    txt = p.read_text(encoding='utf-8', errors='ignore')
    s = re.sub(r'"(?:[^"\\]|\\.)*"', '""', txt)
    s = re.sub(r'//.*', '', s)
    bal = (s.count('{')-s.count('}'), s.count('(')-s.count(')'), s.count('[')-s.count(']'))
    n = len(txt.splitlines())
    if fname in newfiles:
        total += n
    mark = '' if bal == (0,0,0) else ' BAD'
    if mark:
        bad.append(fname)
    print(fname + ' lines=' + str(n) + mark)
print('GRAPHICS TOTAL (9 theater files): ' + str(total))
print('BAD: ' + str(bad if bad else 'none'))
# declarations-per-file sanity + dup scan for new types
pat = re.compile(r'^(?:public|private|final|open)?\s*(?:struct|class|enum|actor|protocol)\s+(\w+)', re.M)
seen = {}
dups = []
for f in sorted(root.rglob('*.swift')):
    txt = f.read_text(encoding='utf-8', errors='ignore')
    for line in txt.splitlines():
        m = re.match(r'\s*(?:public|private|final|open)?\s*(struct|class|enum|actor|protocol)\s+(\w+)', line)
        if m and not line.strip().startswith('//'):
            indent = len(line) - len(line.lstrip())
            if indent == 0:
                n = m.group(2)
                if n in seen:
                    dups.append((n, seen[n], f.name))
                else:
                    seen[n] = f.name
print('TOP-LEVEL DUPES: ' + str(dups if dups else 'none'))
