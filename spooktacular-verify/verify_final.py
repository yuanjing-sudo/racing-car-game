import pathlib, re
root = pathlib.Path('spooktacular-halloween-app/Sources')
newfiles = ['MineSmoothKit.swift', 'MineQuests.swift', 'MineCodex.swift',
            'MazeExpeditions.swift', 'MazeBonds.swift', 'SpookyGameFeel.swift',
            'MazeBestiary.swift']
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
print('BAD FILES: ' + str(bad if bad else 'none'))
# float/double suspect patterns in new files
for fname in newfiles:
    txt = (root / 'Ultimate' / fname).read_text(encoding='utf-8', errors='ignore')
    for i, l in enumerate(txt.splitlines(), 1):
        st = l.strip()
        if re.search(r'Float\(.*difficulty', st) or re.search(r'dist < [0-9]', st):
            print(fname + ':' + str(i) + ': ' + st[:120])
print('scan done')
