import pathlib, re
root = pathlib.Path('spooktacular-halloween-app/Sources/Ultimate')
mine = (root / 'AbandonedMine.swift').read_text(encoding='utf-8')
maze = (root / 'TunnelMaze.swift').read_text(encoding='utf-8')
qu = (root / 'MineQuests.swift').read_text(encoding='utf-8')
ex = (root / 'MazeExpeditions.swift').read_text(encoding='utf-8')

print('=== questBoard.record call sites (mine) ===')
for m in sorted(set(re.findall(r'questBoard\.record\(\.(\w+)', mine))):
    print(' ', m)
print('=== expeditionBoard.record call sites (maze) ===')
for m in sorted(set(re.findall(r'expeditionBoard\.record\(\.(\w+)', maze))):
    print(' ', m)


def advance_cases(txt, anchor):
    i = txt.find(anchor)
    seg = txt[i:i + 6000]
    # cases of the form: case (.trigger, .event):
    return sorted(set(re.findall(r'\(\.(\w+),\s*\.(\w+)\)', seg)))


print('=== MineQuestBoard advance() pairs ===')
for t, e in advance_cases(qu, 'private func advance'):
    print('  trigger=%s event=%s' % (t, e))
print('=== MazeExpeditionBoard advance() pairs ===')
for t, e in advance_cases(ex, 'private func advance'):
    print('  trigger=%s event=%s' % (t, e))
print('=== display names referenced by mineOre quests ===')
for m in sorted(set(re.findall(r'mineOre\("([^"]+)",', qu))):
    print(' ', m)
print('=== MNBlockType displayNames ===')
i = mine.find('var displayName: String')
seg = mine[i:i + 2500]
print(' ', sorted(set(re.findall(r'return "([^"]+)"', seg))))
