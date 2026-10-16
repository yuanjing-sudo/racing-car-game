import pathlib, re
p = pathlib.Path('spooktacular-halloween-app/Sources/Ultimate/AbandonedMine.swift')
lines = p.read_text(encoding='utf-8', errors='ignore').splitlines()
for i, l in enumerate(lines, 1):
    s = l.strip()
    if re.search(r'manager\.torches|torches|rockGroups|lastTorch|torchNodes', s) and ('func ' in s or 'manager.torches' in s or 'let ' in s or 'var ' in s or 'if ' in s or 'for ' in s):
        print(str(i) + ': ' + s[:150])
