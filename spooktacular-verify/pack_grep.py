import pathlib
t = pathlib.Path('spooktacular-halloween-app/Sources/Ultimate/AbandonedMine.swift').read_text(encoding='utf-8')
for i, l in enumerate(t.splitlines(), 1):
    if 'backpackCapacity' in l or 'backpackFull' in l:
        print(str(i) + ': ' + l.strip()[:140])
