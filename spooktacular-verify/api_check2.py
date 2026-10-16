import pathlib, re
alltxt = {f.name: f.read_text(encoding='utf-8', errors='ignore')
          for f in pathlib.Path('spooktacular-halloween-app/Sources/Ultimate').glob('*.swift')}
checks = [
    ('shuffle decl', r'func shuffle'),
    ('rebirthPower decl', r'func rebirthPower'),
    ('comboMultiplier decl', r'func comboMultiplier'),
    ('streak reward decl', r'func reward\(streak'),
    ('sealCost static', r'static func sealCost'),
    ('mine streak reward', r'static func reward'),
]
for label, pat in checks:
    hits = []
    for name, txt in alltxt.items():
        for i, l in enumerate(txt.splitlines(), 1):
            if re.search(pat, l):
                hits.append(name + ':' + str(i) + ': ' + l.strip()[:100])
    print(label + ' -> ' + str(hits if hits else 'MISSING!'))
