import pathlib
t = pathlib.Path('spooktacular-halloween-app/Sources/Ultimate/AbandonedMine.swift').read_text(encoding='utf-8')
for i, l in enumerate(t.splitlines(), 1):
    s = l.strip()
    if 'isDestroyed = true' in s and '==' not in s and '!' not in s.replace('isDestroyed', ''):
        print(str(i) + ': ' + s[:110])
