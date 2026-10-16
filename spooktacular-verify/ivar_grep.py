import pathlib
t = pathlib.Path('spooktacular-halloween-app/Sources/Ultimate/AbandonedMine.swift').read_text(encoding='utf-8')
i = t.find('lastBuildHash')
print(t[max(0, i-1200):i+200])
