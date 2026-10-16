import pathlib, re
root = pathlib.Path('spooktacular-halloween-app/Sources')
total_new = 0
for fname in ['MineSmoothKit.swift', 'MineQuests.swift', 'MineCodex.swift',
              'MazeExpeditions.swift', 'MazeBonds.swift', 'SpookyGameFeel.swift',
              'AbandonedMine.swift', 'TunnelMaze.swift']:
    p = root / 'Ultimate' / fname
    txt = p.read_text(encoding='utf-8', errors='ignore')
    s = re.sub(r'"(?:[^"\\]|\\.)*"', '""', txt)
    s = re.sub(r'//.*', '', s)
    bal = (s.count('{')-s.count('}'), s.count('(')-s.count(')'), s.count('[')-s.count(']'))
    n = len(txt.splitlines())
    if 'Mine' in fname or 'Maze' in fname or 'Spooky' in fname:
        if fname not in ('AbandonedMine.swift', 'TunnelMaze.swift'):
            total_new += n
    print(fname + ' lines=' + str(n) + ' balance=' + str(bal) + (' OK' if bal == (0,0,0) else ' BAD'))
print('NEW-FILE TOTAL: ' + str(total_new))
# duplicate top-level types across all files
pat = re.compile(r'^(?:public|private|final|open)?\s*(?:struct|class|enum|actor|protocol)\s+(\w+)', re.M)
seen = {}
dups = []
for f in sorted(root.rglob('*.swift')):
    for m in pat.finditer(f.read_text(encoding='utf-8', errors='ignore')):
        n = m.group(1)
        if n in seen:
            dups.append((n, seen[n], f.name))
        else:
            seen[n] = f.name
print('DUPES: ' + str(dups if dups else 'none'))
# hook spot-checks
am = (root / 'Ultimate' / 'AbandonedMine.swift').read_text(encoding='utf-8', errors='ignore')
tm = (root / 'Ultimate' / 'TunnelMaze.swift').read_text(encoding='utf-8', errors='ignore')
hooks = [
    ('mine questBoard prop', '@Published var questBoard' in am),
    ('mine wiring onReward', 'questBoard.onReward' in am),
    ('mine journal sheets', 'MineQuestView(board:' in am and 'MineCodexView(manager:' in am and 'MinePerfPanel(' in am),
    ('mine tutorial overlay', 'MineTutorialView(tutorial:' in am),
    ('maze expedition prop', '@Published var expeditionBoard' in tm),
    ('maze journal sheet', 'MazeJournalView(' in tm),
    ('maze feed func', 'func feedNearbyBoxy' in tm),
    ('maze region tick', 'expeditionTick()' in tm),
    ('quests file refs MineQuestEvent only (no manager import)', 'MineManager' not in (root / 'Ultimate' / 'MineQuests.swift').read_text(encoding='utf-8', errors='ignore')),
]
f = 0
for n, ok in hooks:
    print(('PASS' if ok else 'FAIL') + ' | ' + n)
    f += 0 if ok else 1
print('HOOKS: ' + ('ALL PASS' if f == 0 else str(f) + ' FAILURES'))
