import pathlib, re
root = pathlib.Path('spooktacular-halloween-app/Sources')
files = ['Ultimate/MineContracts.swift', 'Ultimate/MineTimeTrials.swift',
         'Ultimate/MazeBossRush.swift', 'Ultimate/MineGemCutting.swift',
         'Ultimate/MazeCompanions.swift', 'Ultimate/MineWeatherMachine.swift',
         'Ultimate/MazeTunnelThemes.swift', 'Ultimate/MineBank.swift',
         'Ultimate/MazeTrinkets.swift', 'Ultimate/MineDeepDive.swift',
         'Ultimate/TunnelMaze.swift', 'Ultimate/MazeBonds.swift',
         'Ultimate/AbandonedMine.swift']
total = 0
for fname in files:
    p = root / fname
    txt = p.read_text(encoding='utf-8', errors='ignore')
    s = re.sub(r'"(?:[^"\\]|\\.)*"', '""', txt)
    s = re.sub(r'//.*', '', s)
    bal = (s.count('{') - s.count('}'), s.count('(') - s.count(')'), s.count('[') - s.count(']'))
    n = len(txt.splitlines())
    if 'Mine' in fname or 'Maze' in fname:
        if fname not in ('Ultimate/TunnelMaze.swift', 'Ultimate/MazeBonds.swift',
                         'Ultimate/AbandonedMine.swift'):
            total += n
    print(fname + ' lines=' + str(n) + (' OK' if bal == (0, 0, 0) else ' BAD ' + str(bal)))
print('NEW-FILE TOTAL (10 files): ' + str(total))
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
keys = ['Contract', 'Trial', 'Rush', 'Gem', 'Companion', 'Beacon', 'Theme',
        'Bank', 'Trinket', 'Dive', 'Relic', 'Fish', 'Pet']
newdups = [d for d in dups if any(k in d[0] for k in keys)]
print('NEW DUPES: ' + str(newdups if newdups else 'none'))
print('ALL TOP DUPES: ' + str(dups if dups else 'none'))
