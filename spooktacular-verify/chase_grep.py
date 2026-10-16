import pathlib
t = pathlib.Path('spooktacular-halloween-app/Sources/Ultimate/AbandonedMine.swift').read_text(encoding='utf-8')
i = t.find('m.attackCooldown -= Double(dt)')
print(t[i:i+700])
