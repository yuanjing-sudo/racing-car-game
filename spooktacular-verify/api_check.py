import pathlib, re
root = pathlib.Path('spooktacular-halloween-app/Sources/Ultimate')
alltxt = {f.name: f.read_text(encoding='utf-8', errors='ignore') for f in root.glob('*.swift')}


def find(pat, files=None):
    out = []
    for name, txt in alltxt.items():
        if files and name not in files:
            continue
        for i, l in enumerate(txt.splitlines(), 1):
            if re.search(pat, l):
                out.append(name + ':' + str(i) + ': ' + l.strip()[:110])
    return out


checks = [
    ('applyXP decl', r'func applyXP'),
    ('captureScore decl', r'func captureScore'),
    ('compact decl', r'func compact'),
    ('fbm decl', r'func fbm'),
    ('braid decl', r'func braid'),
    ('sealCost decl', r'func sealCost'),
    ('drill pick case', r'case drill'),
    ('hint decl', r'var hint'),
    ('targetOf decl', r'func targetOf'),
    ('fractionOf decl', r'func fractionOf'),
    ('smooth decl', r'func smooth'),
    ('findPath decl', r'func findPath'),
    ('castVoxel decl', r'func castVoxel'),
    ('rayDistance decl', r'func rayDistance'),
    ('roll decl', r'func roll\(\)'),
    ('hatch decl', r'func hatch'),
    ('nextThreshold decl', r'func nextThreshold'),
    ('daysBetween decl', r'func daysBetween'),
    ('spooky load decl', r'func load'),
]
for label, pat in checks:
    hits = find(pat)
    print(label + ' -> ' + str(hits if hits else 'MISSING!'))
