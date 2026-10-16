import pathlib, re
for fname in ['TunnelMaze.swift', 'AbandonedMine.swift']:
    p = pathlib.Path('spooktacular-halloween-app/Sources/Ultimate') / fname
    txt = p.read_text(encoding='utf-8', errors='ignore')
    print('######## ' + fname + ' (' + str(len(txt.splitlines())) + ' lines) ########')
    # top-level + nested type declarations with line numbers
    for i, l in enumerate(txt.splitlines(), 1):
        m = re.match(r'\s*(?:public|private|final|open)?\s*(struct|class|enum|actor|protocol)\s+(\w+)', l)
        if m:
            indent = len(l) - len(l.lstrip())
            print(f'{i}: indent={indent} {m.group(1)} {m.group(2)} :: {l.strip()[:110]}')
