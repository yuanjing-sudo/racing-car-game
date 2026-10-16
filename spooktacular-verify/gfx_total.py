import pathlib, re
root = pathlib.Path('spooktacular-halloween-app/Sources')
gfx = ['MineGhostTheater.swift', 'MineCrystalTheater.swift', 'MineLighting.swift',
       'MineParticles.swift', 'MineDioramas.swift', 'MineGhostTheater2.swift',
       'MineCrystalTheater2.swift', 'MineCinematic.swift', 'MineHUDMotion.swift',
       'MineSectorDioramas.swift', 'MineWeather.swift', 'MineBossCinema.swift',
       'MinePetFX.swift', 'MazeMotion.swift', 'MineCelebrations.swift',
       'MineWorkshopFX.swift', 'MazeSkybox.swift', 'MineTransitions.swift',
       'MineArcadeFX.swift', 'MineWaterFX.swift', 'MineFireFX.swift',
       'MineGraphicsHub.swift']
total = 0
bad = []
for fname in gfx:
    p = root / 'Ultimate' / fname
    txt = p.read_text(encoding='utf-8', errors='ignore')
    s = re.sub(r'"(?:[^"\\]|\\.)*"', '""', txt)
    s = re.sub(r'//.*', '', s)
    bal = (s.count('{') - s.count('}'), s.count('(') - s.count(')'), s.count('[') - s.count(']'))
    total += len(txt.splitlines())
    if bal != (0, 0, 0):
        bad.append(fname)
print('GRAPHICS TOTAL 22 files: ' + str(total))
print('BAD: ' + str(bad if bad else 'none'))
