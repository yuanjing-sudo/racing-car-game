import pathlib, re
p = pathlib.Path('spooktacular-halloween-app/Sources/Ultimate/MineLore.swift')
txt = p.read_text(encoding='utf-8', errors='ignore')
i = txt.find('static func unlocked(')
print(txt[i-400:i+700])
