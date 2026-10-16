import pathlib, re
root = pathlib.Path('spooktacular-halloween-app/Sources')
valid = {'tap', 'light', 'medium', 'heavy', 'reward', 'warning', 'error', 'levelUp'}
bad = []
for f in root.rglob('*.swift'):
    for i, l in enumerate(f.read_text(encoding='utf-8', errors='ignore').splitlines(), 1):
        for m in re.finditer(r'SpookyHaptics\.play\(\.(\w+)', l):
            if m.group(1) not in valid:
                bad.append((f.name, i, m.group(1)))
print('BAD HAPTICS: ' + str(bad if bad else 'none'))
# balance check on touched files
for fname in ['SpookyStore.swift', 'MineBootSequence.swift', 'MineDailyHub.swift',
              'AbandonedMine.swift', 'App/SpooktacularApp.swift']:
    p = root / fname
    txt = p.read_text(encoding='utf-8', errors='ignore')
    s = re.sub(r'"(?:[^"\\]|\\.)*"', '""', txt)
    s = re.sub(r'//.*', '', s)
    bal = (s.count('{') - s.count('}'), s.count('(') - s.count(')'), s.count('[') - s.count(']'))
    print(fname + ' lines=' + str(len(txt.splitlines())) + (' OK' if bal == (0, 0, 0) else ' BAD ' + str(bal)))
# new type dupes
names = ['SpookyStore', 'SpookyBootPhase', 'SpookyBootScript', 'MineBootSequenceView',
         'MineWelcomeCard', 'MineStreakRules', 'MineDailyHubView']
for sym in names:
    files = set()
    for f in root.rglob('*.swift'):
        for line in f.read_text(encoding='utf-8', errors='ignore').splitlines():
            if re.search(r'(struct|class|enum|actor|protocol)\s+' + sym + r'\b', line):
                files.add(f.name)
    print(sym + ': ' + str(sorted(files)) + ('' if len(files) == 1 else ' CHECK'))
