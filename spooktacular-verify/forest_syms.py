import pathlib, re
root = pathlib.Path('spooktacular-halloween-app/Sources')
needed = ['MineGhostKind', 'MineGhostBody', 'MineGhostSheet', 'MineGhostEye',
          'MineWailRings', 'MazeStars', 'MineParticleShape', 'MineShimmerBar',
          'SpookyHaptics', 'MineGhostPhase']
for sym in needed:
    found = []
    for f in root.rglob('*.swift'):
        for line in f.read_text(encoding='utf-8', errors='ignore').splitlines():
            if re.search(r'(struct|class|enum|actor|protocol)\s+' + sym + r'\b', line):
                found.append(f.name)
    print(sym + ' -> ' + str(found if found else 'MISSING!'))
# also confirm no other file uses the new forest type names already
for sym in ['MineWindGust', 'MineOwlFlyby', 'MineForestShootingStars', 'MineForestSkyDirector', 'MineGhostHD']:
    found = []
    for f in root.rglob('*.swift'):
        for line in f.read_text(encoding='utf-8', errors='ignore').splitlines():
            if re.search(r'(struct|class|enum|actor|protocol)\s+' + sym + r'\b', line):
                found.append(f.name)
    print(sym + ' declared in: ' + str(found))
