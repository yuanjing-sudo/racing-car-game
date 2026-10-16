import pathlib
t = pathlib.Path('spooktacular-halloween-app/Sources/Ultimate/MineFishing.swift').read_text(encoding='utf-8')
for sym in ['func sellFish', 'func fishStrike', 'func upgradeRod', 'func fishCast']:
    print(('HAVE ' if sym in t else 'MISSING ') + sym)
