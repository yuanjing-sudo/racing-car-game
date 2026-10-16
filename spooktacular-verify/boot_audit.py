import pathlib, re
root = pathlib.Path('spooktacular-halloween-app/Sources')
# 1. total repo lines
total = 0
nfiles = 0
for f in root.rglob('*.swift'):
    total += len(f.read_text(encoding='utf-8', errors='ignore').splitlines())
    nfiles += 1
print('REPO SWIFT: ' + str(nfiles) + ' files, ' + str(total) + ' lines')
# 2. boot risks: force unwrap (!), try!, fatalError, precondition, dispatch sync main
for fname in ['App/SpooktacularApp.swift', 'Ultimate/ContentView.swift']:
    p = root / fname
    if not p.exists():
        print(fname + ' MISSING')
        continue
    lines = p.read_text(encoding='utf-8', errors='ignore').splitlines()
    print('==== ' + fname + ' (' + str(len(lines)) + ' lines) ====')
    for i, l in enumerate(lines, 1):
        s = l.strip()
        if s.startswith('//'):
            continue
        if re.search(r'try!|fatalError|precondition\(|dispatchPrecondition', s):
            print(str(i) + ' RISKY: ' + s[:130])
print('force-unwrap scan (non-optional context is fine, listing bang uses):')
for fname in ['App/SpooktacularApp.swift']:
    p = root / fname
    for i, l in enumerate(p.read_text(encoding='utf-8', errors='ignore').splitlines(), 1):
        if '!' in l and not l.strip().startswith('//') and not l.strip().startswith('import'):
            print(str(i) + ': ' + l.strip()[:130])
