import pathlib, re
root = pathlib.Path('spooktacular-halloween-app/Sources')
newfiles = ['MineSmoothKit.swift', 'MineQuests.swift', 'MineCodex.swift',
            'MazeExpeditions.swift', 'MazeBonds.swift', 'SpookyGameFeel.swift',
            'MazeBestiary.swift', 'MineLore.swift']
total = 0
bad = []
for fname in newfiles + ['AbandonedMine.swift', 'TunnelMaze.swift']:
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
print('NEW-FILE TOTAL: ' + str(total))
print('BAD: ' + str(bad if bad else 'none'))
# sanity: quest + expedition counts
q = (root / 'Ultimate' / 'MineQuests.swift').read_text(encoding='utf-8', errors='ignore')
print('mine quests: ' + str(q.count('MineQuest(') - 1))
e = (root / 'Ultimate' / 'MazeExpeditions.swift').read_text(encoding='utf-8', errors='ignore')
print('maze expeditions: ' + str(e.count('MazeExpedition(') - 1))
lo = (root / 'Ultimate' / 'MineLore.swift').read_text(encoding='utf-8', errors='ignore')
print('lore echoes: ' + str(lo.count('MineLoreFragment(') - 1))
be = (root / 'Ultimate' / 'MazeBestiary.swift').read_text(encoding='utf-8', errors='ignore')
import re as _re
print('bestiary notes: ' + str(len(_re.findall(r'MazeBestiaryNote\(', be))))
