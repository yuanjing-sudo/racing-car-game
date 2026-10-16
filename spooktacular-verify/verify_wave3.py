import pathlib, re
root = pathlib.Path('spooktacular-halloween-app/Sources')
for fname in ['Ultimate/MineFishing.swift', 'Ultimate/MineEvents.swift',
              'Ultimate/MineAchievements.swift', 'Ultimate/MineRelics.swift',
              'Ultimate/MineLore.swift', 'Ultimate/MineSmoothKit.swift',
              'Ultimate/MineCodex.swift', 'Ultimate/MineDioramas.swift',
              'Ultimate/MineQuests.swift', 'Ultimate/AbandonedMine.swift']:
    p = root / fname
    txt = p.read_text(encoding='utf-8', errors='ignore')
    s = re.sub(r'"(?:[^"\\]|\\.)*"', '""', txt)
    s = re.sub(r'//.*', '', s)
    bal = (s.count('{') - s.count('}'), s.count('(') - s.count(')'), s.count('[') - s.count(']'))
    print(fname + ' lines=' + str(len(txt.splitlines())) + (' OK' if bal == (0, 0, 0) else ' BAD ' + str(bal)))
seen = {}
dups = []
for f in sorted(root.rglob('*.swift')):
    for line in f.read_text(encoding='utf-8', errors='ignore').splitlines():
        m = re.match(r'\s*(?:public|private|final|open)?\s*(struct|class|enum|actor|protocol)\s+(\w+)', line)
        if m and not line.strip().startswith('//'):
            indent = len(line) - len(line.lstrip())
            if indent == 0:
                n = m.group(2)
                if n in seen:
                    dups.append((n, seen[n], f.name))
                else:
                    seen[n] = f.name
newdups = [d for d in dups if d[0].startswith('MNRelic') or d[0].startswith('MineEvent') or d[0].startswith('MineMerchant') or d[0].startswith('MNFish') or d[0].startswith('MNRod') or d[0].startswith('MineAchievement') or 'Fish' in d[0] or 'Relic' in d[0]]
print('NEW DUPES: ' + str(newdups if newdups else 'none'))
print('ALL TOP DUPES: ' + str(dups if dups else 'none'))
am = (root / 'Ultimate' / 'AbandonedMine.swift').read_text(encoding='utf-8', errors='ignore')
for sym in ['fishCaught', 'rodTier', 'fishing = MNFishingState', 'relics: [MNRelic]',
            'equippedRelics', 'eventDirector = MineEventDirector', 'merchantDeals',
            'fishMarketBest', 'achBoard = MineAchievementBoard', 'destroyedCount']:
    print(('HAVE ' if sym in am else 'MISSING ') + sym)
