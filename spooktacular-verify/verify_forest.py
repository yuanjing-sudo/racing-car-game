import pathlib, re
root = pathlib.Path('spooktacular-halloween-app/Sources')
p = root / 'Ultimate' / 'MineSpookyForest.swift'
txt = p.read_text(encoding='utf-8', errors='ignore')
s = re.sub(r'"(?:[^"\\]|\\.)*"', '""', txt)
s = re.sub(r'//.*', '', s)
bal = (s.count('{') - s.count('}'), s.count('(') - s.count(')'), s.count('[') - s.count(']'))
print('MineSpookyForest lines=' + str(len(txt.splitlines())) + ' balance=' + str(bal))
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
mine_dupes = [d for d in dups if 'MineSpookyForest' in d[1] or 'MineSpookyForest' in d[2]]
print('FOREST DUPES: ' + str(mine_dupes if mine_dupes else 'none'))
print('ALL TOP DUPES: ' + str(dups if dups else 'none'))
