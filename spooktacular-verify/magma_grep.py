import pathlib
t = pathlib.Path('spooktacular-halloween-app/Sources/Ultimate/MineQuests.swift').read_text(encoding='utf-8')
i = t.find('id: "magma-walker"')
print(t[i:i+700])
