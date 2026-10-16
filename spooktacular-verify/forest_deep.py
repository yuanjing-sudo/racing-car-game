import pathlib, re
root = pathlib.Path('spooktacular-halloween-app/Sources')
fp = root / 'Ultimate' / 'MineSpookyForest.swift'
txt = fp.read_text(encoding='utf-8', errors='ignore')
print('FOREST LINES: ' + str(len(txt.splitlines())))
# every Capitalized identifier used in forest file must be declared somewhere
alldecls = set()
for f in root.rglob('*.swift'):
    for m in re.finditer(r'(?:struct|class|enum|actor|protocol)\s+(\w+)', f.read_text(encoding='utf-8', errors='ignore')):
        alldecls.add(m.group(1))
# union SwiftUI/Foundation globals we rely on
stdlib = {'UUID', 'Date', 'Timer', 'Calendar', 'CGFloat', 'Double', 'Float', 'Int', 'Bool', 'String',
          'CGRect', 'CGPoint', 'CGSize', 'UnitPoint', 'Path', 'Color', 'LinearGradient', 'RadialGradient',
          'Gradient', 'Angle', 'DispatchQueue', 'UserDefaults', 'Canvas', 'GraphicsContext',
          'TimelineView', 'GeometryReader', 'UnevenRoundedRectangle'}
used = set(re.findall(r'\b([A-Z][A-Za-z0-9]+)\b', txt))
# filter member accesses like .red (lowercase start already excluded) and property types defined in-file
infile = set(re.findall(r'(?:struct|class|enum|actor|protocol)\s+(\w+)', txt))
missing = sorted(u for u in used if u not in alldecls and u not in stdlib and u not in infile)
print('IN-FILE TYPES: ' + str(sorted(infile)))
print('POSSIBLY MISSING: ' + str(missing if missing else 'none'))
# risky patterns
for i, l in enumerate(txt.splitlines(), 1):
    s = l.strip()
    if 'onTapGesture { _ in' in s or 'onTapGesture {_ in' in s:
        print('RISKY onTapGesture with param at line ' + str(i))
    if re.search(r'\.font\(\.system\(size: \[[0-9]', s):
        print('RISKY int array font size at line ' + str(i))
    if 'fatalError' in s:
        print('FATALERROR at line ' + str(i))
print('pattern scan done')
