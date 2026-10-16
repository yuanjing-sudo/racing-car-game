import pathlib, re
root = pathlib.Path('spooktacular-halloween-app/Sources')
names = ['MineLoreFragment','MineLoreRule','MineLoreCatalog','MineLoreView','MineMapView',
         'SpookySectorMood','MineSettingsView','MazeBestiary','MazeBestiaryNote','MazeBestiaryView',
         'MineTutorialStep','MineTutorialState','MineQuestKind','MineQuestTrigger','MineQuestCatalog',
         'MineCritterEntry','MineCritterGuide','MineLayerEntry','MineLayerGuide','MazeRegionAtlas',
         'MineChunkStreamer','MineCodexEntry']
pat = re.compile(r'(?:struct|class|enum|protocol)\s+(\w+)')
for sym in names:
    files = set()
    for f in root.rglob('*.swift'):
        for m in pat.finditer(f.read_text(encoding='utf-8', errors='ignore')):
            if m.group(1) == sym:
                files.add(f.name)
    print(sym + ': ' + str(sorted(files)) + ('' if len(files) == 1 else ' <-- CHECK'))
