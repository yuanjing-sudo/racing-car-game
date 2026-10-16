import pathlib, re
t = pathlib.Path('spooktacular-halloween-app/Sources/Ultimate/MineLore.swift').read_text(encoding='utf-8')
ids = re.findall(r'id: "echo-\d+"', t)
print(ids)
print('count:', len(ids))
