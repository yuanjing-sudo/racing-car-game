import pathlib, re
root = pathlib.Path('spooktacular-halloween-app/Sources')
for fname in ['Ultimate/MineGameFX.swift', 'Ultimate/MazeExpeditions.swift',
              'Ultimate/MineQuests.swift', 'Ultimate/MineLore.swift',
              'Ultimate/MineCodex.swift', 'Ultimate/MineDioramas.swift',
              'Ultimate/AbandonedMine.swift', 'Ultimate/ContentView.swift']:
    p = root / fname
    txt = p.read_text(encoding='utf-8', errors='ignore')
    s = re.sub(r'"(?:[^"\\]|\\.)*"', '""', txt)
    s = re.sub(r'//.*', '', s)
    bal = (s.count('{') - s.count('}'), s.count('(') - s.count(')'), s.count('[') - s.count(']'))
    print(fname + ' lines=' + str(len(txt.splitlines())) + (' OK' if bal == (0, 0, 0) else ' BAD ' + str(bal)))
q = (root / 'Ultimate' / 'MazeExpeditions.swift').read_text(encoding='utf-8', errors='ignore')
print('maze expeditions: ' + str(q.count('MazeExpedition(')))
mq = (root / 'Ultimate' / 'MineQuests.swift').read_text(encoding='utf-8', errors='ignore')
print('mine quests: ' + str(mq.count('MineQuest(')))
lo = (root / 'Ultimate' / 'MineLore.swift').read_text(encoding='utf-8', errors='ignore')
print('lore echoes: ' + str(len(re.findall(r'id: "echo-\d+"', lo))))
