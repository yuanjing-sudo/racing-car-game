import pathlib
t = pathlib.Path('spooktacular-halloween-app/Sources/Ultimate/MineNetLoop.swift').read_text(encoding='utf-8')
print('eventIcon defs:', t.count('private func eventIcon'))
print('netStat defs:', t.count('private func netStat'))
print('has stray background-after-return:', '.background(Color(.secondarySystemBackground))\n        .cornerRadius(10)\n    }\n\n    private func eventIcon' in t)
print('total lines:', len(t.splitlines()))
