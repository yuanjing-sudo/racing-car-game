import pathlib, re
q = pathlib.Path('spooktacular-halloween-app/Sources/Ultimate/MineQuests.swift').read_text(encoding='utf-8')
for pat in [r'case \.reachDepth.*', r'reachDepth.*return', r'magma-walker.*', r'depthReached']:
    print('--- ' + pat)
    for m in re.finditer(pat, q):
        s = q[max(0, m.start() - 120):m.start() + 160].replace('\n', ' | ')
        print('   ' + s[:200])
