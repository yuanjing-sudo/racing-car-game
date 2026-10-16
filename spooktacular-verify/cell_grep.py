import pathlib
t = pathlib.Path('spooktacular-halloween-app/Sources/Ultimate/MineSmoothKit.swift').read_text(encoding='utf-8')
i = t.find('private func sectorCell')
print(t[i:i+1500])
