import pathlib, re
root = pathlib.Path('spooktacular-halloween-app/Sources')
for f in root.rglob('*.swift'):
    txt = f.read_text(encoding='utf-8', errors='ignore')
    for i, l in enumerate(txt.splitlines(), 1):
        s = l.strip()
        if re.search(r'struct Ultimate(MiniGame|Arcade|Games).*View|struct Arcade\w*View|MiniGameType|func play|selectedGame|showGame', s):
            print(f.name + ':' + str(i) + ': ' + s[:130])
