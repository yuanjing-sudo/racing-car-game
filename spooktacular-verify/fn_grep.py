import pathlib, re
p = pathlib.Path('spooktacular-halloween-app/Sources/Ultimate/TunnelMaze.swift')
lines = p.read_text(encoding='utf-8', errors='ignore').splitlines()
for i, l in enumerate(lines, 1):
    if re.search(r'func (attackMonster|mineBlock|exploreTunnel|checkLevelUp|generateInitialNotifications|startTimers)\b', l):
        print(str(i) + ': ' + l.strip()[:140])
