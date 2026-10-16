import pathlib, re
p = pathlib.Path('spooktacular-halloween-app/Sources/Ultimate/AbandonedMine.swift')
lines = p.read_text(encoding='utf-8', errors='ignore').splitlines()
for i, l in enumerate(lines, 1):
    s = l.strip()
    if re.search(r'struct \w*(Mine|Host|Ultimate).*(View|Host)\b', s) or 'showPickPanel' in s or 'showSpellbook' in s or 'scareFlash' in s or '.onAppear' in s:
        print(str(i) + ': ' + s[:150])
