import pathlib, re
p = pathlib.Path('spooktacular-halloween-app/Sources/Ultimate/MineAlgorithms.swift')
lines = p.read_text(encoding='utf-8', errors='ignore').splitlines()
for i, l in enumerate(lines, 1):
    if 'y:' in l and ('Node(' in l or '.init(x:' in l):
        print(str(i) + ': ' + l.strip()[:120])
