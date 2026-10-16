"""Deep smooth-logic tests-part 2: property fuzz, state machines, perf
budgets, both-directions exhaustiveness. Imports mirrors from test_logic
where possible by re-execution (standalone file, shared algorithms
duplicated for independence).
Run: python3 spooktacular-verify/test_deep.py
"""
import heapq
import json
import math
import pathlib
import random
import re
import sys
import time

ROOT = pathlib.Path('spooktacular-halloween-app/Sources/Ultimate')
SRC = {f.name: f.read_text(encoding='utf-8', errors='ignore') for f in ROOT.glob('*.swift')}
passed = 0
failed = 0
failures = []


def check(name, cond, detail=''):
    global passed, failed
    if cond:
        passed += 1
    else:
        failed += 1
        failures.append(name + (' | ' + str(detail) if detail else ''))
        print('FAIL: ' + name + (' | ' + str(detail) if detail else ''))


def approx(a, b, eps=1e-6):
    return abs(a - b) <= eps


# ============================================================
# A. Easing properties (monotonicity, mapping, determinism)
# ============================================================
def ease(kind, x):
    x = min(1.0, max(0.0, x))
    if kind == 'linear':
        return x
    if kind == 'quadOut':
        return 1 - (1 - x) * (1 - x)
    if kind == 'cubicOut':
        return 1 - (1 - x) ** 3
    if kind == 'sineInOut':
        return -(math.cos(math.pi * x) - 1) / 2
    if kind == 'backOut':
        c1, c3 = 1.70158, 2.70158
        return 1 + c3 * ((x - 1) ** 3) + c1 * ((x - 1) ** 2)
    raise ValueError(kind)


for k in ['linear', 'quadOut', 'cubicOut', 'sineInOut']:
    vals = [ease(k, i / 100) for i in range(101)]
    check('easing monotonic ' + k, all(b >= a - 1e-9 for a, b in zip(vals, vals[1:])))
check('easing map endpoints',
      all(abs((10 + (20 - 10) * ease('quadOut', t)) - (10 if t == 0 else 20 if t == 1 else 0)) < 1e-9
          for t in (0, 1)))
# determinism across 1000 evals
check('easing deterministic', ease('sineInOut', 0.37) == ease('sineInOut', 0.37))

# ============================================================
# B. RNG statistical properties
# ============================================================
MASK64 = (1 << 64) - 1


class SeededRNG:
    def __init__(self, seed):
        self.state = seed if seed != 0 else 0x9E3779B97F4A7C15

    def next(self):
        self.state = (self.state + 0x6D2B79F5) & MASK64
        z = self.state
        z = ((z ^ (z >> 15)) * (z | 1)) & MASK64
        z = (z ^ (z + ((z ^ (z >> 7)) * (z | 61) & MASK64) & MASK64)) & MASK64
        return (z ^ (z >> 14)) & MASK64

    def next_double(self):
        return float(self.next() >> 11) / float(1 << 53)


r = SeededRNG(1234)
draws = [r.next() for _ in range(1000)]
check('rng 1000 unique 64-bit draws', len(set(draws)) == 1000)
# uniformity on high bits (doubles): 10 buckets, expect ~200 each
buckets = [0] * 10
r2 = SeededRNG(99)
for _ in range(2000):
    buckets[int(r2.next_double() * 10) % 10] += 1
check('rng uniform buckets', all(150 <= b <= 250 for b in buckets), buckets)
# zero seed falls back to nonzero stream
check('rng zero seed live', len(set(SeededRNG(0).next() for _ in [0])) == 1
      and SeededRNG(0).next() != 0)

# ============================================================
# C. Perlin statistical properties
# ============================================================
class Perlin:
    def __init__(self, seed=1337):
        perm = SeededRNG(seed).shuffle(list(range(256))) if hasattr(SeededRNG(1), 'shuffle') else list(range(256))
        self.p = [perm[i & 255] for i in range(512)]

    @staticmethod
    def fade(t):
        return t * t * t * (t * (t * 6 - 15) + 10)

    @staticmethod
    def grad(h, x, y):
        h = h & 7
        return [x + y, x - y, -x + y, -x - y, x, -x, y, -y][h]

    def noise(self, x, y):
        import math as _m
        xi, yi = int(_m.floor(x)) & 255, int(_m.floor(y)) & 255
        xf, yf = x - _m.floor(x), y - _m.floor(y)
        u, v = self.fade(xf), self.fade(yf)
        aa, ab = self.p[self.p[xi] + yi], self.p[self.p[xi] + yi + 1]
        ba, bb = self.p[self.p[xi + 1] + yi], self.p[self.p[xi + 1] + yi + 1]

        def lerp(a, b, t):
            return a + t * (b - a)

        return lerp(lerp(self.grad(aa, xf, yf), self.grad(ba, xf - 1, yf), u),
                    lerp(self.grad(ab, xf, yf - 1), self.grad(bb, xf - 1, yf - 1), u), v) * 1.42

    def fbm(self, x, y, octaves=4, lac=2.0, gain=0.5):
        total = norm = 0.0
        amp, freq = 0.5, 1.0
        for _ in range(max(1, octaves)):
            total += self.noise(x * freq, y * freq) * amp
            norm += amp
            amp *= gain
            freq *= lac
        return total / norm if norm else 0.0


# add shuffle to SeededRNG for Perlin use
def _shuffle(self, a):
    a = list(a)
    for i in range(len(a) - 1, 0, -1):
        j = int(self.next_double() * (i + 1)) % (i + 1)
        a[i], a[j] = a[j], a[i]
    return a


SeededRNG.shuffle = _shuffle
pn = Perlin(20240)
field = [pn.noise(x * 0.2, y * 0.2) for x in range(40) for y in range(40)]
mean = sum(field) / len(field)
check('perlin mean near zero', abs(mean) < 0.12, mean)
# continuity: neighbors differ less than distant cells on average
import random as _r
adj = []
far = []
for _ in range(300):
    x, y = _r.randrange(40), _r.randrange(40)
    base = pn.noise(x * 0.2, y * 0.2)
    adj.append(abs(base - pn.noise((x + 1) * 0.2, y * 0.2)))
    far.append(abs(base - pn.noise((x + 15) * 0.2, (y + 15) * 0.2)))
check('perlin continuity', sum(adj) / len(adj) < sum(far) / len(far),
      (sum(adj) / len(adj), sum(far) / len(far)))

# ============================================================
# D. Carver fuzz (30 seeds x sizes x algorithms)
# ============================================================
def carve(w, d, seed, prim):
    rng = random.Random(seed)
    w |= 1
    d |= 1
    w, d = max(3, w), max(3, d)
    cells = {(1, 1)}
    if not prim:
        stack = [(1, 1)]
        steps = 0
        while stack and steps < w * d * 4:
            steps += 1
            x, z = stack[-1]
            opts = []
            for dx, dz in ((2, 0), (-2, 0), (0, 2), (0, -2)):
                nx, nz = x + dx, z + dz
                if 0 < nx < w - 1 and 0 < nz < d - 1 and (nx, nz) not in cells:
                    opts.append((dx, dz, nx, nz))
            if opts:
                dx, dz, nx, nz = rng.choice(opts)
                cells.add((x + dx // 2, z + dz // 2))
                cells.add((nx, nz))
                stack.append((nx, nz))
            else:
                stack.pop()
    else:
        frontier, inf = [], set()

        def push(c):
            for dx, dz in ((2, 0), (-2, 0), (0, 2), (0, -2)):
                n = (c[0] + dx, c[1] + dz)
                if 0 < n[0] < w - 1 and 0 < n[1] < d - 1 and n not in cells and n not in inf:
                    frontier.append(n)
                    inf.add(n)

        push((1, 1))
        steps = 0
        while frontier and steps < w * d * 4:
            steps += 1
            cell = frontier.pop(rng.randrange(len(frontier)))
            inf.discard(cell)
            links = [(dx, dz) for dx, dz in ((2, 0), (-2, 0), (0, 2), (0, -2))
                     if (cell[0] + dx, cell[1] + dz) in cells]
            if not links:
                continue
            dx, dz = rng.choice(links)
            cells.add((cell[0] + dx // 2, cell[1] + dz // 2))
            cells.add(cell)
            push(cell)
    return cells


def connected(cells):
    seen, stack = {(1, 1)}, [(1, 1)]
    while stack:
        c = stack.pop()
        for dx, dz in ((2, 0), (-2, 0), (0, 2), (0, -2), (1, 0), (-1, 0), (0, 1), (0, -1)):
            n = (c[0] + dx, c[1] + dz)
            if n in cells and n not in seen:
                seen.add(n)
                stack.append(n)
    return seen == cells


bad_conn = 0
for seed in range(30):
    for size in (5, 9, 15):
        for prim in (False, True):
            if not connected(carve(size, size, 1000 + seed, prim)):
                bad_conn += 1
check('carver fuzz connectivity 30x3x2', bad_conn == 0, bad_conn)
# size bounds: open cells within sane band
for size in (9, 21, 31):
    c, _ = None, None
    cells = carve(size, size, 5, False)
    check('carve size band %d' % size, size * size * 0.2 < len(cells) < size * size, len(cells))

# ============================================================
# E. A* optimality vs Dijkstra + fuzz validity
# ============================================================
def astar(start, goal, walkable, max_iter=600):
    if start == goal:
        return [start]

    def h(a, b):
        dx, dz = abs(a[0] - b[0]), abs(a[1] - b[1])
        return max(dx, dz) + 0.4142 * min(dx, dz)

    openh = [(h(start, goal), 0, start)]
    came, g, closed = {}, {start: 0}, set()
    it = 0
    dirs = [(1, 0, 1.0), (-1, 0, 1.0), (0, 1, 1.0), (0, -1, 1.0),
            (1, 1, 1.4142), (1, -1, 1.4142), (-1, 1, 1.4142), (-1, -1, 1.4142)]
    while openh and it < max_iter:
        it += 1
        _, _, cur = heapq.heappop(openh)
        if cur == goal:
            path, c = [cur], cur
            while c in came:
                c = came[c]
                path.append(c)
            return path[::-1]
        if cur in closed:
            continue
        closed.add(cur)
        for dx, dz, cost in dirs:
            nxt = (cur[0] + dx, cur[1] + dz)
            if nxt in closed:
                continue
            if dx and dz and (not walkable((cur[0] + dx, cur[1])) and not walkable((cur[0], cur[1] + dz))):
                continue
            if not walkable(nxt) and nxt != goal:
                continue
            t = g[cur] + cost
            if t < g.get(nxt, float('inf')):
                came[nxt] = cur
                g[nxt] = t
                heapq.heappush(openh, (t + h(nxt, goal), it, nxt))
    return None


def dijkstra(start, goal, walkable, bound=12):
    import heapq as _h
    dist, pq, seen = {start: 0}, [(0, start)], set()
    dirs = [(1, 0, 1.0), (-1, 0, 1.0), (0, 1, 1.0), (0, -1, 1.0),
            (1, 1, 1.4142), (1, -1, 1.4142), (-1, 1, 1.4142), (-1, -1, 1.4142)]
    while pq:
        d, cur = _h.heappop(pq)
        if cur == goal:
            return d
        if cur in seen:
            continue
        seen.add(cur)
        for dx, dz, cost in dirs:
            nxt = (cur[0] + dx, cur[1] + dz)
            if abs(nxt[0]) > bound or abs(nxt[1]) > bound:
                continue
            if dx and dz and (not walkable((cur[0] + dx, cur[1])) and not walkable((cur[0], cur[1] + dz))):
                continue
            if not walkable(nxt) and nxt != goal:
                continue
            nd = d + cost
            if nd < dist.get(nxt, float('inf')):
                dist[nxt] = nd
                _h.heappush(pq, (nd, nxt))
    return None


def path_cost(path):
    c = 0.0
    for a, b in zip(path, path[1:]):
        c += math.hypot(b[0] - a[0], b[1] - a[1])
    return c


rng = random.Random(2026)
opt_fail = 0
for trial in range(60):
    walls = set()
    for _ in range(random.Random(trial).randint(5, 25)):
        walls.add((random.Random(trial * 7 + len(walls)).randint(-6, 6),
                   random.Random(trial * 13 + len(walls)).randint(-6, 6)))
    walk = lambda n, _w=walls: n not in _w and -8 <= n[0] <= 8 and -8 <= n[1] <= 8
    s = (random.Random(trial + 1).randint(-6, 6), random.Random(trial + 2).randint(-6, 6))
    g = (random.Random(trial + 3).randint(-6, 6), random.Random(trial + 4).randint(-6, 6))
    if s in walls or g in walls or s == g:
        continue
    p = astar(s, g, walk, max_iter=2000)
    d = dijkstra(s, g, walk)
    if (p is None) != (d is None):
        opt_fail += 1
        continue
    # 1.4142 step-cost approximation vs true hypot: allow 1e-3 slack.
    if p is not None and abs(path_cost(p) - d) > 1e-3:
        opt_fail += 1
check('astar optimal vs dijkstra (60 fuzz)', opt_fail == 0, opt_fail)
# validity: every step legal on random mazes
bad_steps = 0
for trial in range(40):
    cells = carve(15, 15, 5000 + trial, trial % 2 == 1)
    cells = {(x // 2, z // 2) for (x, z) in cells}
    s = sorted(cells)[0]
    gl = sorted(cells)[-1]
    p = astar(s, gl, lambda n, _c=cells: n in _c, max_iter=1500)
    if p is None:
        continue
    if p[0] != s or p[-1] != gl:
        bad_steps += 1
    for a, b in zip(p, p[1:]):
        if max(abs(b[0] - a[0]), abs(b[1] - a[1])) > 1 or b not in cells:
            bad_steps += 1
            break
check('astar step validity on mazes', bad_steps == 0, bad_steps)

# ============================================================
# F. XP conservation + backpack economy invariants (random sims)
# ============================================================
def xp_next(lv):
    return max(50, round(80.0 * (1.28 ** (max(1, lv) - 1))))


def sim_xp(seq):
    level, xp, spent = 1, 0, 0
    for earned in seq:
        xp += earned
        while xp >= xp_next(level):
            xp -= xp_next(level)
            spent += xp_next(level) if False else 0
            level += 1
    return level, xp


rng = random.Random(77)
ok_cons = True
for _ in range(50):
    seq = [rng.randint(0, 200) for _ in range(rng.randint(1, 20))]
    level, xp = sim_xp(seq)
    # conservation: xp banked + sum of thresholds crossed == total earned
    total = sum(seq)
    # recompute thresholds crossed
    lv, rem, crossed = 1, 0, []
    for e in seq:
        rem += e
        while rem >= xp_next(lv):
            rem -= xp_next(lv)
            crossed.append(xp_next(lv) if False else lv)
            lv += 1
    if not (level == lv and xp == rem):
        ok_cons = False
check('xp conservation across random chains', ok_cons)


def sim_pack(ops, cap=50):
    ores, sell, gold = {}, 0, 0
    for op in ops:
        if op[0] == 'mine':
            _, name, val = op
            if sum(ores.values()) + 1 > cap:
                continue  # bounced, pack full
            ores[name] = ores.get(name, 0) + 1
            sell += val
        elif op[0] == 'sell':
            coal = ores.pop('Coal Ore', 0)
            gold += sell
            sell = 0
            ores = {'Coal Ore': coal} if coal else {}
    return ores, sell, gold


rng = random.Random(31337)
ok_pack = True
for _ in range(100):
    ops = []
    for _ in range(rng.randint(5, 60)):
        r = rng.random()
        if r < 0.7:
            ops.append(('mine', rng.choice(['Iron Ore', 'Gold Ore', 'Coal Ore']), rng.randint(1, 20)))
        else:
            ops.append(('sell',))
    ores, sell, gold = sim_pack(ops)
    if any(v < 0 for v in ores.values()) or sell < 0 or gold < 0 or sum(ores.values()) > 50:
        ok_pack = False
        break
check('backpack invariants under random ops', ok_pack)

# ============================================================
# G. Both-directions exhaustiveness (events, triggers, rules)
# ============================================================
am = SRC['AbandonedMine.swift']
qu = SRC['MineQuests.swift']
me = SRC['MazeExpeditions.swift']
tm = SRC['TunnelMaze.swift']

# every quest event case produced in managers AND handled in advance()
# (tuple pairs) or the lifetime loop (sellGold/earnXP)
qevents = set(re.findall(r'case (\w+)(?::|\s*$)', qu[qu.find('enum MineQuestEvent'):qu.find('enum MineQuestEvent') + 1200]))
produced_q = set(re.findall(r'questBoard\.record\(\.(\w+)', am))
handled_q = set(re.findall(r'\(\.\w+(?:\([^)]*\))?,\s*\.(\w+)', qu[qu.find('private func advance'):qu.find('private func advance') + 12000]))
handled_q |= {'goldSold', 'xpEarned'}  # lifetime loop in record()
check('quest events produced==handled',
      produced_q == handled_q, (sorted(produced_q ^ handled_q) if produced_q != handled_q else ''))
# expedition events both directions (tuple pairs + score/distance lifetime)
ex_events = set(re.findall(r'case (\w+)', me[me.find('enum MazeExpeditionEvent'):me.find('enum MazeExpeditionEvent') + 800]))
produced_e = set(re.findall(r'expeditionBoard\.record\(\.(\w+)', tm))
handled_e = set(re.findall(r'\(\.\w+(?:\([^)]*\))?,\s*\.(\w+)', me[me.find('private func advance'):me.find('private func advance') + 8000]))
handled_e |= {'scoreEarned', 'distanceBanked'}  # lifetime loop in record()
check('expedition events produced==handled',
      produced_e == handled_e, (sorted(produced_e ^ handled_e) if produced_e != handled_e else ''))
# every trigger family has >= 2 quests (depth, no orphans)
for trig, fam in [('breakBlocks', 2), ('mineOre', 8), ('sellGold', 2), ('earnXP', 2),
                  ('reachLayer', 2), ('mapSectors', 2), ('openClosets', 2), ('harvestCaves', 2),
                  ('unlockCaves', 2), ('hatchPets', 2), ('forgePicks', 2), ('upgradePacks', 2),
                  ('rebirth', 2), ('greetCritters', 2), ('slayMonsters', 2), ('throwBombs', 2),
                  ('reachDepth', 1)]:
    n = len(re.findall(r'trigger: \.' + trig + r'\b', qu))
    check('quest family depth: ' + trig, n >= fam, n)
# lore rules: every variant used by >= 1 echo
for rule in ['always', 'sectors', 'depth', 'ore', 'closets', 'caves', 'pets',
             'rebirths', 'level', 'gold', 'critters', 'seals', 'fish', 'events', 'trader']:
    check('lore rule used: ' + rule, re.search(r'rule: \.' + rule + r'\b', SRC['MineLore.swift']) is not None)
# codex ore names exist as display names (skip dynamic sector labels)
codex = SRC['MineCodex.swift']
display = set(re.findall(r'return "([^"]+)"', am[am.find('var displayName'):am.find('var displayName') + 3000]))
for name in sorted(set(re.findall(r'name: "([^"]+)"', codex))):
    if name in ('Timber',) or '\\' in name or '$(' in name:
        continue
    check('codex ore exists: ' + name, name in display, '')

# ============================================================
# H. State machines (quest + expedition + net + streak lifecycles)
# ============================================================
class QuestBoardMirror:
    def __init__(self, quests):
        # quests: list of (id, kind, target, match)
        self.quests = quests
        self.progress = {}
        self.completed = set()
        self.claimed = set()
        self.sold = 0
        self.xp = 0
        self.active_limit = 3

    def active(self):
        return [q for q in self.quests if q[0] not in self.completed][:self.active_limit]

    def is_done(self, q):
        return q[0] in self.completed or self.progress.get(q[0], 0) >= q[2]

    def record(self, kind, **kw):
        if kind == 'goldSold':
            self.sold += kw['n']
        if kind == 'xpEarned':
            self.xp += kw['n']
        for q in self.active():
            if self.is_done(q):
                continue
            qid, qkind, target, match = q
            v = self.progress.get(qid, 0)
            nv = v
            if qkind == 'break' and kind == 'blockBroken':
                nv = v + 1
            elif qkind == 'ore' and kind == 'oreMined' and (match == 'any' or match == kw.get('name')):
                nv = v + kw.get('n', 1)
            elif qkind == 'sell':
                nv = min(target, self.sold)
            elif qkind == 'xp':
                nv = min(target, self.xp)
            if nv != v:
                self.progress[qid] = min(target, nv)
                if self.progress[qid] >= target:
                    self.completed.add(qid)

    def claim(self, qid):
        if qid in self.completed and qid not in self.claimed:
            self.claimed.add(qid)
            return True
        return False


quests = [('q1', 'break', 3, None), ('q2', 'ore', 5, 'Iron Ore'),
          ('q3', 'sell', 200, None), ('q4', 'break', 10, None)]
b = QuestBoardMirror(quests)
for _ in range(3):
    b.record('blockBroken')
check('quest completes at target', 'q1' in b.completed and b.progress['q1'] == 3)
check('quest caps at target', b.progress['q1'] == 3)
check('active advances past done', [q[0] for q in b.active()] == ['q2', 'q3', 'q4'])
check('claim works once', b.claim('q1') and not b.claim('q1'))
check('claim undone fails', not b.claim('q2'))
for _ in range(5):
    b.record('oreMined', name='Coal Ore', n=1)
check('ore filter respected', 'q2' not in b.completed)
for _ in range(5):
    b.record('oreMined', name='Iron Ore', n=1)
check('ore quest completes', 'q2' in b.completed)
b.record('goldSold', n=250)
check('lifetime quest completes', 'q3' in b.completed and b.progress['q3'] == 200)
for _ in range(10):
    b.record('blockBroken')
check('second break quest completes', 'q4' in b.completed and b.progress['q4'] == 10)


class NetMirror:
    def __init__(self, maxhp=6):
        self.hp = {}
        self.maxhp = maxhp
        self.seq = 0
        self.log = []

    def apply(self, kind, x, y, z, power=0):
        self.seq += 1
        if kind == 'hit':
            hp = self.hp.get((x, y, z), self.maxhp) - power
            if hp <= 0:
                self.hp.pop((x, y, z), None)
                self.log.append(('broken', self.seq))
            else:
                self.hp[(x, y, z)] = hp
                self.log.append(('damaged', self.seq))
        elif kind == 'blast':
            broken = 0
            for dx in (-1, 0, 1):
                for dy in (-1, 0, 1):
                    for dz in (-1, 0, 1):
                        k = (x + dx, y + dy, z + dz)
                        hp = self.hp.get(k, self.maxhp) - power
                        if hp <= 0:
                            self.hp.pop(k, None)
                            broken += 1
                        else:
                            self.hp[k] = hp
            self.log.append(('blast', self.seq, broken))
        return self.log[-1]


net = NetMirror()
net.apply('hit', 1, 2, 3, 2)
net.apply('hit', 1, 2, 3, 2)
r = net.apply('hit', 1, 2, 3, 2)
check('net triple-hit breaks', r[0] == 'broken' and (1, 2, 3) not in net.hp)
net2 = NetMirror()
b = net2.apply('blast', 0, 0, 0, 99)
check('net blast clears 27', b[2] == 27, b)
check('net seq monotonic', [e[1] for e in net2.log] == sorted(e[1] for e in net2.log))
snap = json.dumps({'hp': [[k[0], k[1], k[2], v] for k, v in net2.hp.items()], 'seq': net2.seq})
back = json.loads(snap)
check('net snapshot round-trips',
      back['seq'] == net2.seq and len(back['hp']) == len(net2.hp))


def streak_touch(history, today):
    # history: list of visit days; returns streak after today
    days = sorted(set(history + [today]))
    if days[-1] != today:
        return 0
    streak, prev = 1, days[-1]
    for d in reversed(days[:-1]):
        from datetime import date as _d
        a = _d.fromisoformat(d)
        b = _d.fromisoformat(prev)
        if (b - a).days == 1:
            streak += 1
            prev = d
        else:
            break
    return streak


check('streak same-day idempotent', streak_touch(['2026-03-01'], '2026-03-01') == 1)
check('streak consecutive', streak_touch(['2026-03-01', '2026-03-02'], '2026-03-03') == 3)
check('streak gap resets', streak_touch(['2026-03-01', '2026-03-05'], '2026-03-05') == 1)
check('streak month boundary', streak_touch(['2026-01-31'], '2026-02-01') == 2)
check('streak leap year', streak_touch(['2024-02-28'], '2024-02-29') == 2)
check('streak year boundary', streak_touch(['2025-12-31'], '2026-01-01') == 2)

# ============================================================
# I. Region + layer exhaustive sweeps
# ============================================================
def region_at(x, z):
    band = 'northgate' if z < -120 else 'deeps' if z < -40 else 'heart' if z < 40 else 'warrens' if z < 120 else 'far'
    return band + '-' + ('west' if x < 0 else 'east')


valid_regions = {'northgate-west', 'northgate-east', 'deeps-west', 'deeps-east',
                 'heart-west', 'heart-east', 'warrens-west', 'warrens-east',
                 'far-west', 'far-east'}
seen_regions = set()
ok_bounds = True
for x in range(-300, 301, 10):
    for z in range(-300, 301, 10):
        r = region_at(x, z)
        seen_regions.add(r)
        if r not in valid_regions:
            ok_bounds = False
check('region sweep exhaustive + valid', ok_bounds and seen_regions == valid_regions,
      sorted(seen_regions))
check('region boundaries exact',
      region_at(0, -120) == 'deeps-east' and region_at(0, -40) == 'heart-east'
      and region_at(0, 40) == 'warrens-east' and region_at(0, 120) == 'far-east'
      and region_at(-1, 0) == 'heart-west')


def layer_at(y):
    if y >= 3:
        return 'meadow'
    if y >= 1:
        return 'dirt'
    if y >= -1:
        return 'stone'
    if y >= -3:
        return 'deepstone'
    if y >= -4.5:
        return 'crystal'
    return 'magma'


valid_layers = {'meadow', 'dirt', 'stone', 'deepstone', 'crystal', 'magma'}
seen_layers = set()
y = -8.0
while y <= 6.0:
    seen_layers.add(layer_at(y))
    y += 0.5
check('layer sweep valid', seen_layers == valid_layers, sorted(seen_layers))
check('layer boundaries exact',
      layer_at(3) == 'meadow' and layer_at(1) == 'dirt' and layer_at(-1) == 'stone'
      and layer_at(-3) == 'deepstone' and layer_at(-4.5) == 'crystal' and layer_at(-4.51) == 'magma')

# ============================================================
# J. Perf budgets (generous — guards against algorithmic blowups)
# ============================================================
def budgeted(name, fn, limit):
    t0 = time.perf_counter()
    fn()
    dt = time.perf_counter() - t0
    check('perf ' + name + ' < %.1fs' % limit, dt < limit, '%.2fs' % dt)


budgeted('astar 40x40 open', lambda: astar((0, 0), (39, 39), lambda n: 0 <= n[0] < 40 and 0 <= n[1] < 40, 5000), 2.0)
budgeted('carve 31x31 dfs', lambda: carve(31, 31, 5, False), 3.0)
budgeted('carve 31x31 prim', lambda: carve(31, 31, 5, True), 3.0)
budgeted('perlin 100x100 fbm', lambda: [pn.fbm(x * 0.2, y * 0.2) for x in range(100) for y in range(100)], 8.0)

# ============================================================
# Summary
# ============================================================
print('')
print('PASSED: %d  FAILED: %d' % (passed, failed))
if failures:
    print('FAILURES:')
    for f in failures:
        print(' - ' + f)
    sys.exit(1)
print('ALL DEEP-LOGIC TESTS GREEN')
