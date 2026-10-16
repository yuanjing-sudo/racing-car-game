import pathlib, re
t = pathlib.Path('spooktacular-halloween-app/Sources/Ultimate/AbandonedMine.swift').read_text(encoding='utf-8')
i = t.find('enum MNPickTier')
print(t[i:i+400])
