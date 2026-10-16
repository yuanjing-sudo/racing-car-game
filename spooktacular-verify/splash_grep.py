import pathlib, re
root = pathlib.Path('spooktacular-halloween-app/Sources')
txt = (root / 'Ultimate' / 'ContentView.swift').read_text(encoding='utf-8', errors='ignore')
i = txt.find('struct UltimateSplashView')
print(txt[i:i+2500])
