import pathlib, re
for fname in ['TunnelMaze.swift', 'AbandonedMine.swift']:
    p = pathlib.Path('spooktacular-halloween-app/Sources/Ultimate') / fname
    txt = p.read_text(encoding='utf-8', errors='ignore')
    stripped = re.sub(r'"(?:[^"\\]|\\.)*"', '""', txt)
    stripped = re.sub(r'//.*', '', stripped)
    bal = (stripped.count('{')-stripped.count('}'), stripped.count('(')-stripped.count(')'), stripped.count('[')-stripped.count(']'))
    print(fname, 'balance', bal, 'OK' if bal == (0,0,0) else 'BAD', '| lines', len(txt.splitlines()))
# Requirement checks
tm = pathlib.Path('spooktacular-halloween-app/Sources/Ultimate/TunnelMaze.swift').read_text(encoding='utf-8', errors='ignore')
am = pathlib.Path('spooktacular-halloween-app/Sources/Ultimate/AbandonedMine.swift').read_text(encoding='utf-8', errors='ignore')
checks = [
    ('TM longer maze (160)', 'mazeSize: Int = 160' in tm),
    ('TM wider tunnels (width 4)', 'width: 4' in tm),
    ('TM endless haulage fn', 'generateEndlessHaulage()' in tm),
    ('TM no blocking veil', 'background(Color.black.opacity(0.85))' not in tm),
    ('TM god-mode flag', 'mineGodMode' in tm),
    ('TM gameOver disabled', 'Disabled in the endless mine' in tm),
    ('TM reset keeps position', 'intentionally kept' in tm),
    ('TM no teleport to origin', 'player.position = SCNVector3(0, 2, 0)' not in tm),
    ('AM longer tunnels (60)', 'abs(z) <= 60' in am),
    ('AM bound 60', 'let bound: Float = 60' in am),
    ('AM world B=120', 'let B = 120' in am),
    ('AM instant play', 'worldReady = true' in am),
    ('AM no fullscreen veil', 'Color.black.ignoresSafeArea()' not in am),
    ('AM god-mode locked', 'lifeLossEnabled = false' in am),
    ('AM no entrance teleport', 'player.position = SCNVector3(0, 1.0, -15)' not in am),
    ('AM settings locked', 'locked ON' in am),
]
for name, ok in checks:
    print(('PASS' if ok else 'FAIL') + ' | ' + name)
