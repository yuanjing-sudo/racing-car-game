import pathlib
for fname in ['AbandonedMine.swift', 'TunnelMaze.swift']:
    p = pathlib.Path('spooktacular-halloween-app/Sources/Ultimate') / fname
    lines = p.read_text(encoding='utf-8', errors='ignore').splitlines()
    print('==== ' + fname + ' ====')
    for i, l in enumerate(lines, 1):
        s = l.strip()
        low = s.lower()
        if ('health -' in s or 'health-=' in s.replace(' ', '') or 'isalive = false' in low or 'isgameover = true' in low or 'position = scnvector3(0' in low or 'digging the' in low):
            print(str(i) + ': ' + s[:150])
