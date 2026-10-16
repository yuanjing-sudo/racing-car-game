import pathlib, re
for fname in ['Tests/SpookyLogicTests.swift', 'project.yml']:
    p = pathlib.Path('spooktacular-halloween-app') / fname
    txt = p.read_text(encoding='utf-8', errors='ignore')
    print(fname + ' lines=' + str(len(txt.splitlines())))
    if fname.endswith('.swift'):
        s = re.sub(r'"(?:[^"\\]|\\.)*"', '""', txt)
        s = re.sub(r'//.*', '', s)
        bal = (s.count('{') - s.count('}'), s.count('(') - s.count(')'), s.count('[') - s.count(']'))
        print('  balance: ' + str(bal) + (' OK' if bal == (0, 0, 0) else ' BAD'))
# YAML sanity: indentation consistent, test target present
yml = pathlib.Path('spooktacular-halloween-app/project.yml').read_text(encoding='utf-8')
print('has Tests target: ' + str('HalloweenSpooktacularUltimateTests' in yml))
print('has unit-test type: ' + str('bundle.unit-test' in yml))
bad_indent = [i + 1 for i, l in enumerate(yml.splitlines())
              if l.strip() and (len(l) - len(l.lstrip())) % 2 == 1]
print('odd-indent YAML lines: ' + str(bad_indent if bad_indent else 'none'))
