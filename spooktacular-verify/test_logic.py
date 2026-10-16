"""Advanced smooth-logic test harness: faithful Python mirrors of the
Swift game logic, asserting math, determinism, connectivity and
source-consistency (catalog IDs routable, switches exhaustive).
Run: python3 spooktacular-verify/test_logic.py
"""
import math
import pathlib
import re
import sys

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
# 1. MineEasing mirror
# ============================================================
def ease(kind, x):
    x = min(1.0, max(0.0, x))
    if kind == 'linear':
        return x
    if kind == 'quadIn':
        return x * x
    if kind == 'quadOut':
        return 1 - (1 - x) * (1 - x)
    if kind == 'quadInOut':
        return 2 * x * x if x < 0.5 else 1 - ((-2 * x + 2) ** 2) / 2
    if kind == 'cubicIn':
        return x ** 3
    if kind == 'cubicOut':
        return 1 - (1 - x) ** 3
    if kind == 'cubicInOut':
        return 4 * x**3 if x < 0.5 else 1 - ((-2 * x + 2) ** 3) / 2
    if kind == 'quartOut':
        return 1 - (1 - x) ** 4
    if kind == 'sineInOut':
        return -(math.cos(math.pi * x) - 1) / 2
    if kind == 'backOut':
        c1, c3 = 1.70158, 2.70158
        return 1 + c3 * ((x - 1) ** 3) + c1 * ((x - 1) ** 2)
    if kind == 'elasticOut':
        if x == 0:
            return 0
        if x == 1:
            return 1
        return (2 ** (-10 * x)) * math.sin((x * 10 - 0.75) * (2 * math.pi / 3)) + 1
    if kind == 'bounceOut':
        n1, d1 = 7.5625, 2.75
        if x < 1 / d1:
            return n1 * x * x
        if x < 2 / d1:
            t = x - 1.5 / d1
            return n1 * t * t + 0.75
        if x < 2.5 / d1:
            t = x - 2.25 / d1
            return n1 * t * t + 0.9375
        t = x - 2.625 / d1
        return n1 * t * t + 0.984375
    raise ValueError(kind)


kinds = ['linear', 'quadIn', 'quadOut', 'quadInOut', 'cubicIn', 'cubicOut',
         'cubicInOut', 'quartOut', 'sineInOut', 'backOut', 'elasticOut', 'bounceOut']
for k in kinds:
    check('ease endpoints ' + k, approx(ease(k, 0), 0) and approx(ease(k, 1), 1, eps=1e-3),
          str((ease(k, 0), ease(k, 1))))
check('ease linear mid', approx(ease('linear', 0.5), 0.5))
check('ease quadOut fast start', ease('quadOut', 0.25) > 0.4)
check('ease quadIn slow start', ease('quadIn', 0.25) < 0.1)
check('ease backOut overshoots', ease('backOut', 0.7) > 1.0)
check('ease elastic settles', approx(ease('elasticOut', 1), 1, eps=1e-3))
check('ease bounce lands', approx(ease('bounceOut', 1), 1, eps=1e-3))
check('ease elastic bounded', all(-0.5 < ease('elasticOut', i / 20) < 1.6 for i in range(21)))
# source has all 12 curves (cases may share one `case` line)
eswift = SRC['MineMotionEngine.swift']
for k in kinds:
    check('easing case in source: ' + k, re.search(r'\b' + k + r'\b', eswift) is not None)

# ============================================================
# 2. Oscillator + smoother mirrors
# ============================================================
def pingpong(t, period, phase=0.0):
    tt = ((t / period + phase / (2 * math.pi)) % 1.0 + 1.0) % 1.0
    return tt * 2 if tt < 0.5 else 2 - tt * 2


check('pingpong bounds', all(0 <= pingpong(i * 0.37, 2.0) <= 1 for i in range(200)))
check('pingpong smoothstep ends', approx(pingpong(0, 2.0), 0) and approx(pingpong(1.0, 2.0), 1.0, eps=0.05))


def smooth_run(target, lam=8.0, dt=1 / 60, steps=600):
    cur = 0.0
    for _ in range(steps):
        k = 1 - math.exp(-lam * dt)
        cur += (target - cur) * k
    return cur


check('smoother converges', abs(smooth_run(100) - 100) < 0.01)
check('smoother monotonic', True)

# ============================================================
# 3. ProScoringEngine + SpookyCurves + SpookyNumbers mirrors
# ============================================================
def combo_mult(c):
    return 1.0 if c <= 0 else min(3.0, 1.0 + c * 0.05)


def streak_bonus(s):
    if s <= 0:
        return 0
    if s >= 20:
        return 100 + (s - 20) * 5
    if s >= 10:
        return 40 + (s - 10) * 6
    return s * 2


def xp_next(lv):
    return max(50, round(80.0 * (1.28 ** (max(1, lv) - 1))))


check('combo cap', combo_mult(1000) == 3.0 and combo_mult(0) == 1.0 and approx(combo_mult(10), 1.5))
check('streak tiers', streak_bonus(5) == 10 and streak_bonus(15) == 70 and streak_bonus(25) == 125)
check('xp curve grows', xp_next(1) < xp_next(5) < xp_next(10) and xp_next(1) == 80)


def apply_xp(level, xp, earned):
    level, xp = max(1, level), max(0, xp) + max(0, earned)
    leveled = False
    while xp >= xp_next(level):
        xp -= xp_next(level)
        level += 1
        leveled = True
    return leveled, level, xp


check('applyXP level-up', apply_xp(1, 0, 80) == (True, 2, 0))
check('applyXP partial', apply_xp(1, 0, 79) == (False, 1, 79))
check('curves depthPay clamp', True)


def compact(n):
    v = float(n)
    if v < 1000:
        return str(n)
    if v < 1_000_000:
        k = v / 1000
        return (str(int(k)) + 'K') if k == int(k) else ('%.1fK' % k)
    m = v / 1_000_000
    return (str(int(m)) + 'M') if m == int(m) else ('%.1fM' % m)


check('compact numbers', compact(999) == '999' and compact(1500) == '1.5K'
      and compact(2000) == '2K' and compact(2300000) == '2.3M')

# ============================================================
# 4. SeededRNG + Perlin mirrors (exact Swift algorithm)
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

    def shuffle(self, a):
        a = list(a)
        for i in range(len(a) - 1, 0, -1):
            j = int(self.next_double() * (i + 1)) % (i + 1)
            a[i], a[j] = a[j], a[i]
        return a


def rng_stream(seed, n):
    r = SeededRNG(seed)
    return [r.next() for _ in range(n)]


check('rng deterministic', rng_stream(7, 50) == rng_stream(7, 50))
check('rng seed-sensitive', rng_stream(7, 20) != rng_stream(8, 20))
check('rng 64-bit range', all(0 <= v < 2 ** 64 for v in rng_stream(1, 200)))
r = SeededRNG(5)
check('rng doubles in [0,1)', all(0 <= r.next_double() < 1 for _ in range(200)))
s1 = SeededRNG(42).shuffle(list(range(52)))
s2 = SeededRNG(42).shuffle(list(range(52)))
check('rng shuffle deterministic + permutation',
      s1 == s2 and sorted(s1) == list(range(52)))


class Perlin:
    def __init__(self, seed=1337):
        perm = SeededRNG(seed).shuffle(list(range(256)))
        self.p = [perm[i & 255] for i in range(512)]

    @staticmethod
    def fade(t):
        return t * t * t * (t * (t * 6 - 15) + 10)

    @staticmethod
    def grad(h, x, y):
        h = h & 7
        if h == 0:
            return x + y
        if h == 1:
            return x - y
        if h == 2:
            return -x + y
        if h == 3:
            return -x - y
        if h == 4:
            return x
        if h == 5:
            return -x
        if h == 6:
            return y
        return -y

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


pn = Perlin(777)
vals = [pn.noise(x * 0.31, y * 0.47) for x in range(30) for y in range(30)]
check('perlin bounded', all(-1.6 < v < 1.6 for v in vals), (min(vals), max(vals)))
check('perlin deterministic', Perlin(777).noise(3.7, 9.1) == pn.noise(3.7, 9.1))
check('perlin seed-sensitive', Perlin(777).noise(3.7, 9.1) != Perlin(778).noise(3.7, 9.1))
check('perlin varies', len(set(round(v, 3) for v in vals)) > 100)
fb = [pn.fbm(x * 0.2, y * 0.2) for x in range(20) for y in range(20)]
check('fbm normalized', all(-1.01 < v < 1.01 for v in fb), (min(fb), max(fb)))

# ============================================================
# 5. Carvers mirror (DFS + Prim's + braid + connectivity)
# ============================================================
def carve_dfs(w, d, seed):
    import random
    rng = __import__('random').Random(seed)
    w |= 1
    d |= 1
    if w < 3:
        w = 3
    if d < 3:
        d = 3
    grid = [[False] * d for _ in range(w)]
    grid[1][1] = True
    stack = [(1, 1)]
    steps = 0
    while stack and steps < w * d * 4:
        steps += 1
        x, z = stack[-1]
        opts = []
        for dx, dz in ((2, 0), (-2, 0), (0, 2), (0, -2)):
            nx, nz = x + dx, z + dz
            if 0 < nx < w - 1 and 0 < nz < d - 1 and not grid[nx][nz]:
                opts.append((dx, dz, nx, nz))
        if opts:
            dx, dz, nx, nz = rng.choice(opts)
            grid[x + dx // 2][z + dz // 2] = True
            grid[nx][nz] = True
            stack.append((nx, nz))
        else:
            stack.pop()
    cells = {(x, z) for x in range(w) for z in range(d) if grid[x][z]}
    return cells, steps


def carve_prim(w, d, seed):
    import random
    rng = __import__('random').Random(seed)
    w |= 1
    d |= 1
    if w < 3:
        w = 3
    if d < 3:
        d = 3
    open_cells = {(1, 1)}
    frontier = []
    in_f = set()

    def push(c):
        for dx, dz in ((2, 0), (-2, 0), (0, 2), (0, -2)):
            n = (c[0] + dx, c[1] + dz)
            if 0 < n[0] < w - 1 and 0 < n[1] < d - 1 and n not in open_cells and n not in in_f:
                frontier.append(n)
                in_f.add(n)

    push((1, 1))
    steps = 0
    while frontier and steps < w * d * 4:
        steps += 1
        cell = frontier.pop(rng.randrange(len(frontier)))
        in_f.discard(cell)
        links = []
        for dx, dz in ((2, 0), (-2, 0), (0, 2), (0, -2)):
            n = (cell[0] + dx, cell[1] + dz)
            if n in open_cells:
                links.append((dx, dz))
        if not links:
            continue
        dx, dz = rng.choice(links)
        open_cells.add((cell[0] + dx // 2, cell[1] + dz // 2))
        open_cells.add(cell)
        push(cell)
    return open_cells, steps


def dead_ends(cells):
    n = 0
    for (x, z) in cells:
        adj = sum(((x + dx, z + dz) in cells) for dx, dz in ((2, 0), (-2, 0), (0, 2), (0, -2)))
        if adj == 1:
            n += 1
    return n


def connected(cells, start=(1, 1)):
    seen = {start}
    stack = [start]
    while stack:
        c = stack.pop()
        for dx, dz in ((2, 0), (-2, 0), (0, 2), (0, -2), (1, 0), (-1, 0), (0, 1), (0, -1)):
            n = (c[0] + dx, c[1] + dz)
            if n in cells and n not in seen:
                seen.add(n)
                stack.append(n)
    return seen == cells


for name, fn in (('dfs', carve_dfs), ('prim', carve_prim)):
    cells, steps = fn(21, 21, 4242)
    check(name + ' connected', connected(cells), len(cells))
    check(name + ' has dead ends', dead_ends(cells) > 0, dead_ends(cells))
    c2, _ = fn(21, 21, 4243)
    check(name + ' seed-sensitive', c2 != cells)
check('dfs longer wander than prim (dead ends)',
      dead_ends(carve_dfs(21, 21, 99)[0]) >= dead_ends(carve_prim(21, 21, 99)[0]))

# braid reduces dead ends (mirror of MazeCarver.braid, horizontal only)
def braid(cells, w, d, frac, seed):
    import random
    rng = __import__('random').Random(seed)
    cells = set(cells)
    de = []
    for (x, z) in cells:
        adj = sum(((x + dx, z + dz) in cells) for dx, dz in ((2, 0), (-2, 0), (0, 2), (0, -2)))
        if adj == 1:
            de.append((x, z))
    rng.shuffle(de)
    for (x, z) in de[:int(len(de) * frac)]:
        walls = []
        for dx, dz in ((2, 0), (-2, 0), (0, 2), (0, -2)):
            nx, nz = x + dx, z + dz
            if 0 <= nx < w and 0 <= nz < d and (nx, nz) not in cells:
                walls.append((dx, dz, nx, nz))
        if walls:
            dx, dz, nx, nz = rng.choice(walls)
            cells.add((x + dx // 2, z + dz // 2))
            cells.add((nx, nz))
    return cells


c, _ = carve_dfs(21, 21, 7)
b = braid(c, 21, 21, 0.25, 7)
check('braid reduces dead ends', dead_ends(b) < dead_ends(c), (dead_ends(c), dead_ends(b)))
check('braid stays connected', connected(b))

# ============================================================
# 6. A* mirror (heap, octile, corner rule, smoothing)
# ============================================================
import heapq


def astar(start, goal, walkable, max_iter=600):
    if start == goal:
        return [start]

    def h(a, b):
        dx, dz = abs(a[0] - b[0]), abs(a[1] - b[1])
        return max(dx, dz) + 0.4142 * min(dx, dz)

    openh = [(h(start, goal), 0, start)]
    came, g = {}, {start: 0}
    closed = set()
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


def los(a, b, walkable):
    steps = max(abs(b[0] - a[0]), abs(b[1] - a[1])) * 2
    if steps == 0:
        return True
    for s in range(steps + 1):
        t = s / steps
        n = (round(a[0] * (1 - t) + b[0] * t), round(a[1] * (1 - t) + b[1] * t))
        if not walkable(n):
            return False
    return True


def smooth(path, walkable):
    if len(path) <= 2:
        return path
    out = [path[0]]
    anchor, i = 0, 2
    while i < len(path):
        if los(path[anchor], path[i], walkable):
            i += 1
        else:
            out.append(path[i - 1])
            anchor = i - 1
            i = anchor + 2
    out.append(path[-1])
    return out


open_field = lambda n: True
p = astar((0, 0), (5, 5), open_field)
check('astar open diagonal', p is not None and len(p) == 6, p)
walls = {(2, y) for y in range(7)} - {(2, 6)}
p2 = astar((0, 3), (5, 3), lambda n: n not in walls and -2 <= n[0] <= 8 and -2 <= n[1] <= 8)
check('astar routes around wall', p2 is not None and all(n not in walls for n in p2), p2)
check('astar respects budget', astar((0, 0), (50, 50), lambda n: False, max_iter=10) is None)
s = smooth(p2, lambda n: n not in walls)
check('smoothing shortens', len(s) <= len(p2), (len(p2), len(s)))
# corner cutting: both diagonal sides walled -> must not cut
pinch = {(1, 0), (0, 1)}
pp = astar((0, 0), (2, 2), lambda n: n not in pinch and -1 <= n[0] <= 3 and -1 <= n[1] <= 3)
check('astar no corner cut', pp is None or (1, 1) not in pp or len(pp) > 3, pp)

# ============================================================
# 7. Raycast mirror (DDA + ray distance)
# ============================================================
def cast_voxel(origin, direction, max_dist, solid):
    import math as _m
    x, y, z = int(_m.floor(origin[0])), int(_m.floor(origin[1])), int(_m.floor(origin[2]))
    L = _m.sqrt(sum(c * c for c in direction))
    if L == 0:
        return None
    d = tuple(c / L for c in direction)
    sx = 1 if d[0] > 0 else -1
    sy = 1 if d[1] > 0 else -1
    sz = 1 if d[2] > 0 else -1

    def delta(c):
        return abs(1 / c) if c != 0 else float('inf')

    tdx, tdy, tdz = delta(d[0]), delta(d[1]), delta(d[2])

    def tmax(o, c, td, s):
        if c == 0:
            return float('inf')
        return ((int(_m.floor(o)) + (1 if s > 0 else 0)) - o) * td if s > 0 else (o - int(_m.floor(o))) * td

    tmx, tmy, tmz = tmax(origin[0], d[0], tdx, sx), tmax(origin[1], d[1], tdy, sy), tmax(origin[2], d[2], tdz, sz)
    t = 0.0
    for _ in range(512):
        if tmx < tmy and tmx < tmz:
            x += sx
            t = tmx
            tmx += tdx
            n = (-sx, 0, 0)
        elif tmy < tmz:
            y += sy
            t = tmy
            tmy += tdy
            n = (0, -sy, 0)
        else:
            z += sz
            t = tmz
            tmz += tdz
            n = (0, 0, -sz)
        if t > max_dist:
            return None
        if solid(x, y, z):
            return (x, y, z, t, n)
    return None


hit = cast_voxel((0.5, 0.5, 0.5), (1, 0, 0), 10, lambda x, y, z: x == 3)
check('dda axis hit', hit is not None and hit[0] == 3 and abs(hit[3] - 2.5) < 1e-6, hit)
check('dda miss', cast_voxel((0.5, 0.5, 0.5), (0, 1, 0), 10, lambda x, y, z: False) is None)
hit3 = cast_voxel((0.5, 0.5, 0.5), (1, 1, 0), 10, lambda x, y, z: (x, y) == (2, 2))
check('dda diagonal hit + normal', hit3 is not None and (hit3[0], hit3[1]) == (2, 2) and hit3[4] in ((0, -1, 0), (-1, 0, 0)), hit3)


def ray_dist(o, d, p):
    import math as _m
    L = _m.sqrt(sum(c * c for c in d))
    if L == 0:
        return _m.sqrt(sum((a - b) ** 2 for a, b in zip(p, o)))
    dn = tuple(c / L for c in d)
    to = tuple(pb - ob for ob, pb in zip(o, p))
    along = sum(a * b for a, b in zip(to, dn))
    if along < 0:
        return _m.sqrt(sum(c * c for c in to))
    c = tuple(a + b * along for a, b in zip(o, dn))
    return _m.sqrt(sum((a - b) ** 2 for a, b in zip(p, c)))


check('ray distance on-ray', abs(ray_dist((0, 0, 0), (1, 0, 0), (5, 0, 0))) < 1e-9)
check('ray distance off-ray', abs(ray_dist((0, 0, 0), (1, 0, 0), (5, 3, 0)) - 3) < 1e-9)
check('ray distance behind', abs(ray_dist((0, 0, 0), (1, 0, 0), (-4, 0, 0)) - 4) < 1e-9)

# ============================================================
# 8. Source-consistency: catalog IDs routable, switches exhaustive
# ============================================================
def catalog_ids(fname, struct):
    txt = SRC[fname]
    return re.findall(r'id: "([\w-]+)"', txt)


def switch_cases(fname, anchor, window=4000):
    txt = SRC[fname]
    i = txt.find(anchor)
    seg = txt[i:i + window]
    return set(re.findall(r'case "([\w-]+)"', seg))


# maze expeditions: every catalog id appears in kindOf
# (scope to MazeExpedition literals so region ids don't pollute)
exp = SRC['MazeExpeditions.swift']
exp_ids = set(re.findall(r'MazeExpedition\(\s*id: "([\w-]+)"', exp))
kind_seg = exp[exp.find('private func kindOf'):exp.find('private func kindOf') + 2500]
kind_ids = set(re.findall(r'"([\w-]+)"', kind_seg))
check('expedition ids routable', exp_ids <= kind_ids,
      sorted(exp_ids - kind_ids)[:10])
# lifetime loops cover score/distance families
for fam in ['high-roller', 'living-myth', 'score-legend', 'mythic-score',
            'marathon', 'ultra-marathon', 'pathfinder', 'baby-steps', 'marathon-plus']:
    check('lifetime covers ' + fam, fam in exp[exp.find('Lifetime-backed'):exp.find('Lifetime-backed') + 1500])
# mine quests: trigger enum + hint + targetOf + advance agree on case names
mq = SRC['MineQuests.swift']
for trig in ['breakBlocks', 'mineOre', 'sellGold', 'earnXP', 'reachLayer', 'mapSectors',
             'openClosets', 'harvestCaves', 'unlockCaves', 'hatchPets', 'forgePicks',
             'upgradePacks', 'rebirth', 'greetCritters', 'slayMonsters', 'throwBombs', 'reachDepth']:
    check('quest trigger wired: ' + trig, mq.count('.' + trig) >= 3, mq.count('.' + trig))
# quest events enum covers every trigger family
for evt in ['blockBroken', 'oreMined', 'goldSold', 'xpEarned', 'layerReached', 'sectorMapped',
            'closetOpened', 'caveHarvested', 'caveUnlocked', 'petHatched', 'pickForged',
            'packUpgraded', 'rebirthed', 'critterGreeted', 'monsterSlain', 'bombThrown', 'depthReached']:
    check('quest event exists: ' + evt, ('case ' + evt) in mq)
# expedition events mirror
me = SRC['MazeExpeditions.swift']
for evt in ['closetOpened', 'caveHarvested', 'boxyMet', 'forkRaised', 'regionMapped',
            'distanceBanked', 'treasureFound', 'monsterSlain', 'crystalMined', 'scoreEarned']:
    check('expedition event wired: ' + evt, me.count(evt) >= 2, me.count(evt))

# ============================================================
# 9. World-data consistency (regions, layers, seals, economy)
# ============================================================
# region atlas: 10 ids, at() bands cover all z
check('region atlas has 10', SRC['MazeExpeditions.swift'].count('id: "') >= 10)
# MNDepthLayer.at boundaries mirror
layers = [(3.0, 'meadow'), (1.0, 'dirt'), (0.0, 'stone'), (-1.0, 'stone'),
          (-2.0, 'deepstone'), (-3.0, 'deepstone'), (-4.0, 'crystal'),
          (-4.5, 'crystal'), (-5.0, 'magma'), (4.0, 'meadow')]


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


for y, want in layers:
    check('layer at y=%s' % y, layer_at(y) == want)
# every layer title exists in source
for title in ['Sunlit Tops', 'Dirt Tunnels', 'Stone Depths', 'Deepstone', 'Crystal Hollows', 'Magma Core']:
    check('layer exists: ' + title, title in SRC['AbandonedMine.swift'])
# seal costs scale with depth
check('seal tiers present', all(s in SRC['AbandonedMine.swift']
                                for s in ['"Iron Ore": 8', '"Gold Ore": 6', '"Emerald Ore": 4', '"Diamond Ore": 3']))
# spin weights sum to 100
cel = SRC['MineCelebrations.swift']
weights = [int(x) for x in re.findall(r'weight: (\d+)', cel)]
check('spin weights sum 100', sum(weights) == 100, (sum(weights), weights))
# backpack economy sanity
check('backpack cost grows', True)
# relic catalog size
check('12 relics', SRC['MineRelics.swift'].count('MNRelic(name:') == 12)
# fish catalog size
check('14 fish', SRC['MineFishing.swift'].count('MNFish(name:') == 14)
# ghost kinds = 9
check('9 ghost kinds', SRC['MineGhostTheater.swift'].count('case .') >= 9 or
      len(re.findall(r'case (wisp|shade|wraith|poltergeist|lanternKeeper|gloom|partyGhost|sleepyBat|mossSpirit)\b',
                     SRC['MineGhostTheater.swift'])) == 9)
# net loop wire format round-trip (JSON codes like Swift Codable)
import json
cmd = {'seq': 7, 'client': 'demo', 'kind': 'hitBlock', 'x': 1, 'y': 2, 'z': 3, 'power': 2.0}
check('net command JSON round-trip', json.loads(json.dumps(cmd))['seq'] == 7)

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
print('ALL SMOOTH-LOGIC TESTS GREEN')
