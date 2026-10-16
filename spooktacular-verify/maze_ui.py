import pathlib, re
p = pathlib.Path('spooktacular-halloween-app/Sources/Ultimate/TunnelMaze.swift')
lines = p.read_text(encoding='utf-8', errors='ignore').splitlines()
for i, l in enumerate(lines, 1):
    s = l.strip()
    if re.search(r'showInventory|showMap|showSettings|showQuests|ToolbarItem|navigationTitle|navigationBarTitle', s):
        print(str(i) + ': ' + s[:150])
