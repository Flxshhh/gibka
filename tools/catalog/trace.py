# Обводка контура пуансона на картинке каталога → многоугольник в мм.
# Пуансон: голубоватая серая заливка (b - r в 2..14) или почти чёрный кончик; фон и штриховка — нейтрально-серые.
import sys, json
from PIL import Image, ImageFilter
from collections import deque

def mask_of(path, box):
    im = Image.open(path).convert('RGB').crop(box)
    W, H = im.size; px = im.load()
    m = Image.new('L', (W, H), 0); mp = m.load()
    for y in range(H):
        for x in range(W):
            r, g, b = px[x, y]
            tint = max(g, b) - r
            if (1 <= tint <= 14 and 90 < r < 253) or (r < 70 and g < 70 and b < 75):
                mp[x, y] = 255
    # убрать тонкие линии и шум, закрыть мелкие дыры
    m = m.filter(ImageFilter.MinFilter(7)).filter(ImageFilter.MaxFilter(7))     # сначала убрать линии штриховки
    m = m.filter(ImageFilter.MaxFilter(9)).filter(ImageFilter.MinFilter(9))     # потом закрыть мелкие дыры
    return m

def largest(m):
    W, H = m.size; mp = m.load(); seen = bytearray(W * H); best = []
    for y in range(H):
        for x in range(W):
            if mp[x, y] and not seen[y * W + x]:
                comp = []; q = deque([(x, y)]); seen[y * W + x] = 1
                while q:
                    cx, cy = q.popleft(); comp.append((cx, cy))
                    for nx, ny in ((cx+1,cy),(cx-1,cy),(cx,cy+1),(cx,cy-1)):
                        if 0 <= nx < W and 0 <= ny < H and mp[nx, ny] and not seen[ny*W+nx]:
                            seen[ny*W+nx] = 1; q.append((nx, ny))
                if len(comp) > len(best): best = comp
    out = Image.new('L', (W, H), 0); op = out.load()
    for x, y in best: op[x, y] = 255
    # заполнить дыры: всё, что не достижимо снаружи
    outside = bytearray(W * H); q = deque()
    for x in range(W):
        for y in (0, H-1): q.append((x, y))
    for y in range(H):
        for x in (0, W-1): q.append((x, y))
    while q:
        x, y = q.popleft()
        if 0 <= x < W and 0 <= y < H and not outside[y*W+x] and not op[x, y]:
            outside[y*W+x] = 1
            q.extend(((x+1,y),(x-1,y),(x,y+1),(x,y-1)))
    for y in range(H):
        for x in range(W):
            if not outside[y*W+x]: op[x, y] = 255
    return out

def trace(m):
    # обход границы (Moore) по часовой, начиная с самой верхней-левой точки
    W, H = m.size; mp = m.load()
    inside = lambda x, y: 0 <= x < W and 0 <= y < H and mp[x, y] > 0
    start = next((x, y) for y in range(H) for x in range(W) if inside(x, y))
    dirs = [(1,0),(1,1),(0,1),(-1,1),(-1,0),(-1,-1),(0,-1),(1,-1)]
    pts = [start]; cur = start; d = 6
    for _ in range(200000):
        for k in range(8):
            nd = (d + 6 + k) % 8   # начинаем поиск слева от направления
            nx, ny = cur[0] + dirs[nd][0], cur[1] + dirs[nd][1]
            if inside(nx, ny):
                cur = (nx, ny); d = nd; break
        if cur == start: break
        pts.append(cur)
    return pts

def dp(pts, eps):
    # упрощение ломаной (Дуглас–Пекер), итеративно
    if len(pts) < 3: return pts
    keep = [False] * len(pts); keep[0] = keep[-1] = True; st = [(0, len(pts) - 1)]
    while st:
        a, b = st.pop(); ax, ay = pts[a]; bx, by = pts[b]
        dx, dy = bx - ax, by - ay; L = (dx*dx + dy*dy) ** .5 or 1
        best, bi = 0, -1
        for i in range(a + 1, b):
            px_, py_ = pts[i]; dd = abs(dy*px_ - dx*py_ + bx*ay - by*ax) / L
            if dd > best: best, bi = dd, i
        if best > eps: keep[bi] = True; st += [(a, bi), (bi, b)]
    return [p for p, k in zip(pts, keep) if k]

if __name__ == '__main__':
    path, x0, y0, x1, y1 = sys.argv[1], *map(int, sys.argv[2:6])
    m = largest(mask_of(path, (x0, y0, x1, y1)))
    m.save(sys.argv[6])
    pts = trace(m)
    # замкнуть: упрощаем как две половины
    i = len(pts) // 2
    s = dp(pts[:i+1], 1.2)[:-1] + dp(pts[i:] + [pts[0]], 1.2)[:-1]
    ys = [p[1] for p in pts]; ytip = max(ys); ytop = min(ys)
    bottom = [p[0] for p in pts if p[1] >= ytip - 1]
    xtip = sum(bottom) / len(bottom)
    print(json.dumps({'n': len(pts), 'simp': len(s), 'ytop': ytop, 'ytip': ytip, 'xtip': xtip, 'pts': s}))
