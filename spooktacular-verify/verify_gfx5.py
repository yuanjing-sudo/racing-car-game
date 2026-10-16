import pathlib, re
root = pathlib.Path('spooktacular-halloween-app/Sources')
gfx = ['MineGhostTheater.swift', 'MineCrystalTheater.swift', 'MineLighting.swift',
       'MineParticles.swift', 'MineDioramas.swift', 'MineGhostTheater2.swift',
       'MineCrystalTheater2.swift', 'MineCinematic.swift', 'MineHUDMotion.swift',
       'MineSectorDioramas.swift', 'MineWeather.swift', 'MineBossCinema.swift',
       'MinePetFX.swift', 'MazeMotion.swift', 'MineCelebrations.swift',
       'MineWorkshopFX.swift', 'MazeSkybox.swift', 'MineTransitions.swift',
       'MineArcadeFX.swift', 'MineWaterFX.swift', 'MineFireFX.swift']
total = 0
bad = []
for fname in gfx + ['AbandonedMine.swift', 'TunnelMaze.swift']:
    p = root / 'Ultimate' / fname
    txt = p.read_text(encoding='utf-8', errors='ignore')
    s = re.sub(r'"(?:[^"\\]|\\.)*"', '""', txt)
    s = re.sub(r'//.*', '', s)
    bal = (s.count('{')-s.count('}'), s.count('(')-s.count(')'), s.count('[')-s.count(']'))
    n = len(txt.splitlines())
    if fname in gfx:
        total += n
    mark = '' if bal == (0,0,0) else ' BAD'
    if mark:
        bad.append(fname)
    print(fname + ' lines=' + str(n) + mark)
print('GRAPHICS TOTAL (21 files): ' + str(total))
print('BAD: ' + str(bad if bad else 'none'))
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
print('TOP-LEVEL DUPES: ' + str(dups if dups else 'none'))
