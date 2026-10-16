import pathlib, re
root = pathlib.Path('spooktacular-halloween-app/Sources')
newfiles = ['MineSmoothKit.swift', 'MineQuests.swift', 'MineCodex.swift',
            'MazeExpeditions.swift', 'MazeBonds.swift', 'SpookyGameFeel.swift',
            'MazeBestiary.swift', 'MineLore.swift',
            'MineGhostTheater.swift', 'MineCrystalTheater.swift']
total = 0
bad = []
for fname in newfiles + ['AbandonedMine.swift', 'TunnelMaze.swift']:
    p = root / 'Ultimate' / fname
    txt = p.read_text(encoding='utf-8', errors='ignore')
    s = re.sub(r'"(?:[^"\\]|\\.)*"', '""', txt)
    s = re.sub(r'//.*', '', s)
    bal = (s.count('{')-s.count('}'), s.count('(')-s.count(')'), s.count('[')-s.count(']'))
    n = len(txt.splitlines())
    if fname in newfiles:
        total += n
    mark = '' if bal == (0,0,0) else ' BAD'
    if mark:
        bad.append(fname)
    print(fname + ' lines=' + str(n) + mark)
print('NEW-FILE TOTAL: ' + str(total))
print('BAD: ' + str(bad if bad else 'none'))
# new theater type uniqueness (top-level only: no leading indent)
for sym in ['MineGhostKind','MineGhostPhase','MineGhostActor','MineGhostDirector','MineGhostBody',
            'MineGhostSheet','MineGhostSprite','MineGhostFace','MineGhostEye','MineGhostProp',
            'MineWailRings','MineWailFlash','MineEctoplasmTrail','MineHauntedMist','MineSpectralGlow',
            'MineGhostScare','MineGhostEncounterCard','MineGhostRadar','MineAmbientHaunt','MineBooBurst',
            'MineGhostShowcaseView','MineCrystalAnimPhase','MineDoorStyle','MineUnlockPhase','MineHarvestPhase',
            'MineAnimatedCube','MineCubeCluster','MineAnimatedSpike','Triangle','MineSpikePair',
            'MineAnimatedOrb','MineOrbConstellation','MineCaveShimmer','MineLightShafts','MineLockedDoor',
            'MineUnlockCeremony','MineHarvestBurst','MineLockedCavePanel','MineCrystalShowcaseView']:
    files = set()
    for f in root.rglob('*.swift'):
        for m in re.finditer(r'^' + sym + r'\b', f.read_text(encoding='utf-8', errors='ignore'), re.M):
            # confirm it is a declaration line
            files.add(f.name)
    # filter: only count files where it is declared (struct/class/enum before it on same line)
    decl = set()
    for f in root.rglob('*.swift'):
        for line in f.read_text(encoding='utf-8', errors='ignore').splitlines():
            if re.search(r'(struct|class|enum)\s+' + sym + r'\b', line):
                decl.add(f.name)
    flag = '' if len(decl) == 1 else ' <-- CHECK ' + str(sorted(decl))
    print(sym + ': ' + str(sorted(decl)) + flag)
