import pathlib, re
p = pathlib.Path('spooktacular-halloween-app/Sources/Ultimate/AbandonedMine.swift')
lines = p.read_text(encoding='utf-8', errors='ignore').splitlines()
for i, l in enumerate(lines, 1):
    if re.search(r'struct (MineHostView|MinePickPanel|UltimateMagicView)\b|func upgradePick|player\.(gold|ores|blocksMined|pickTier)', l):
        print(str(i) + ': ' + l.strip()[:150])
