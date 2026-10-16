import pathlib, re
root = pathlib.Path('spooktacular-halloween-app/Sources')
for fname in ['Ultimate/MineMotionEngine.swift', 'Ultimate/MineChoreography.swift',
              'Ultimate/MineLoopKit.swift', 'Ultimate/AbandonedMine.swift',
              'Ultimate/MineCrystalTheater.swift', 'Ultimate/MineGhostTheater.swift',
              'Ultimate/MineParticles.swift', 'Ultimate/MineSpookyForest.swift']:
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
newdups = [d for d in dups if 'Motion' in d[0] or 'Choreo' in d[0] or 'Loop' in d[0] or 'Orchestra' in d[0]
           or 'Tween' in d[0] or 'Easing' in d[0] or 'Spring' in d[0] or 'Smoother' in d[0]
           or 'Stopwatch' in d[0] or 'Beat' in d[0] or 'Oscill' in d[0] or 'Canon' in d[0]
           or 'ParadeDrill' in d[0] or 'Ritual' in d[0] or 'Cannonade' in d[0] or 'Wave' in d[0]]
print('NEW DUPES: ' + str(newdups if newdups else 'none'))
print('ALL TOP DUPES: ' + str(dups if dups else 'none'))
