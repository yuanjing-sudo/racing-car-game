import pathlib
t = pathlib.Path('spooktacular-halloween-app/Sources/Ultimate/MineLore.swift').read_text(encoding='utf-8')
i = t.find('private func hint(')
print(t[i:i+1100])
j = t.find('critters: manager.critters')
print('....')
print(t[j-200:j+400])
