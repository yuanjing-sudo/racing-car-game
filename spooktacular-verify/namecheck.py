import pathlib, re
root = pathlib.Path('spooktacular-halloween-app/Sources')
names = '''MineFrameMonitor MineSpatialHash MineNotificationQueue MineQualitySettings
MineChunkStreamer MinePerfPanel MineFrameBadge MineQuest MineQuestKind MineQuestEvent
MineQuestBoard MineQuestView MineCodex MineCodexEntry MineCodexView MineOreEntry
MazeExpedition MazeExpeditionKind MazeExpeditionBoard MazeExpeditionView MazeRegion
MazeRegionDirector MazeRegionBanner BoxyBond BoxyBondLedger BoxyBondView SpookyHaptics
SpookyNumbers SpookyCurves SpookyNames AtmospherePreset SpookyToast ToastView
MineTutorial MineTutorialView MineStatTracker'''.split()
alltypes = set()
pat = re.compile(r'(?:struct|class|enum|protocol)\s+(\w+)')
for f in root.rglob('*.swift'):
    for m in pat.finditer(f.read_text(encoding='utf-8', errors='ignore')):
        alltypes.add(m.group(1))
clash = [n for n in names if n in alltypes]
print('CLASHES: ' + str(clash if clash else 'none'))
print('total existing types: ' + str(len(alltypes)))
