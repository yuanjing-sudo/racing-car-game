import pathlib, re
p = pathlib.Path('spooktacular-halloween-app/Sources/Ultimate/TunnelMaze.swift')
txt = p.read_text(encoding='utf-8', errors='ignore')
lines = txt.splitlines()
print('TOTAL', len(lines))
pats = ['digging','mega maze','Mega Maze','waiting','Waiting','isLoading','loading','generateMaze','generateTunnel','mazeSize','mazeLength','tunnelLength','depth','maxDepth','die','death','killPlayer','respawn','origin','health','takeDamage','damagePlayer','lives','isDead','gameOver','startPosition','spawnPoint','originial','original']
for pat in pats:
    hits = [(i+1, l.strip()[:160]) for i, l in enumerate(lines) if re.search(pat, l, re.I)]
    if hits:
        print('--- ' + pat + f' ({len(hits)}) ---')
        for n, l in hits[:25]:
            print(f'{n}: {l}')
# also second file
for fname in ['AbandonedMine.swift','HauntedMaze.swift']:
    q = pathlib.Path('spooktacular-halloween-app/Sources/Ultimate') / fname
    if q.exists():
        t = q.read_text(encoding='utf-8', errors='ignore').splitlines()
        print('==== ' + fname + ' TOTAL ' + str(len(t)) + ' ====')
        for pat in ['digging','mega','waiting','isLoading','die','death','respawn','origin','takeDamage','gameOver','tunnelLength','mazeLength','maxDepth']:
            hits = [(i+1, l.strip()[:150]) for i, l in enumerate(t) if re.search(pat, l, re.I)]
            if hits:
                print('-- ' + pat + f' ({len(hits)}) --')
                for n, l in hits[:12]:
                    print(f'{n}: {l}')
