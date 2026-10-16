import pathlib, re
root = pathlib.Path('spooktacular-halloween-app/Sources')
e = (root / 'Ultimate' / 'MazeExpeditions.swift').read_text(encoding='utf-8', errors='ignore')
ids = re.findall(r'id: "([\w-]+)"', e)
print('expedition ids:', len(ids))
new12 = ['first-blood','pocket-change','baby-steps','cube-curious','home-turf','thousand-club',
         'cave-scout','fork-fan','treasure-chest-10','marathon-plus','boss-hunter']
print('missing new:', [x for x in new12 if x not in ids])
q = (root / 'Ultimate' / 'MineQuests.swift').read_text(encoding='utf-8', errors='ignore')
qids = re.findall(r'id: "([\w-]+)"', q)
print('quest ids:', len(qids))
newfrost = ['frostbitten','glacier-glass','snow-day','permafrost-pro','ice-palace','deep-freeze']
print('missing frost:', [x for x in newfrost if x not in qids])
d = (root / 'Ultimate' / 'MineQuests.swift').read_text(encoding='utf-8', errors='ignore')
print('unlock quests:', [x for x in ['seal-breaker','master-key'] if x in d])
