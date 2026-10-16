import pathlib, re
t = pathlib.Path('spooktacular-halloween-app/Sources/Ultimate/AbandonedMine.swift').read_text(encoding='utf-8')
print('isGem in mine file:', 'isGem' in t)
for i, l in enumerate(t.splitlines(), 1):
    if 'var isGem' in l or 'var isOre' in l:
        print(str(i) + ': ' + l.strip()[:100])
