import pathlib, re
root = pathlib.Path('spooktacular-halloween-app/Sources')
for fname in ['Ultimate/MazeDailyHub.swift', 'Ultimate/MazeCinematics.swift',
              'Ultimate/MineArcadeOverhaul.swift', 'Ultimate/TunnelMaze.swift',
              'Ultimate/MazeBonds.swift', 'Ultimate/ContentView.swift',
              'Ultimate/AbandonedMine.swift']:
    p = root / fname
    txt = p.read_text(encoding='utf-8', errors='ignore')
    s = re.sub(r'"(?:[^"\\]|\\.)*"', '""', txt)
    s = re.sub(r'//.*', '', s)
    bal = (s.count('{') - s.count('}'), s.count('(') - s.count(')'), s.count('[') - s.count(']'))
    print(fname + ' lines=' + str(len(txt.splitlines())) + (' OK' if bal == (0, 0, 0) else ' BAD ' + str(bal)))
# cross-refs used by new code
checks = [
    ('MiniGame type', r'(struct)\s+MiniGame\b'),
    ('MiniGameType', r'(enum)\s+MiniGameType\b'),
    ('miniGameIcon func', r'func miniGameIcon'),
    ('ArcadeRouter.supports', r'supports\('),
    ('playMiniGame', r'func playMiniGame'),
    ('MiniGame fields highScore', r'highScore'),
]
for label, pat in checks:
    found = []
    for f in root.rglob('*.swift'):
        if re.search(pat, f.read_text(encoding='utf-8', errors='ignore')):
            found.append(f.name)
    print(label + ': ' + str(found if found else 'MISSING'))
# dupes among new types
for sym in ['MazeStreakRules', 'MazeDailyHubView', 'MazeStreakFlame', 'MazeCinematicKind',
            'MazeCinematicDirector', 'MazeCinematicPhase', 'MazeCinematicShell',
            'MineSpinWheel', 'MineDailyWheelView', 'ArcadeDailyChallenge',
            'ArcadeDailyBoard', 'ArcadeShowcaseCard', 'ArcadeMarquee', 'ArcadeDailyRow',
            'MineArcadeOverhaulShowcaseView', 'MazeExpeditionCinematic', 'MazeCinematicHost',
            'MazeCinematicShowcaseView']:
    files = set()
    for f in root.rglob('*.swift'):
        for line in f.read_text(encoding='utf-8', errors='ignore').splitlines():
            if re.search(r'(struct|class|enum|actor|protocol)\s+' + sym + r'\b', line):
                files.add(f.name)
    print(sym + ': ' + str(sorted(files)) + ('' if len(files) == 1 else ' CHECK'))
