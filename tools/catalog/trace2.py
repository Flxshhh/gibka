# Инструменты обводки пуансонов по картинкам каталога. Пути к картинкам внутри — из сессии, где делался каталог.
# Контур пуансона с картинки каталога → многоугольник в мм (кромка в (0,0), ось вертикально).
import sys, json
from PIL import Image, ImageDraw
from collections import deque
sys.path.insert(0, '.')
from trace import mask_of, largest, trace, dp

def comps(mask_pts_fn, W, H):
    seen = set(); out = []
    for y in range(H):
        for x in range(W):
            if (x, y) in seen or not mask_pts_fn(x, y): continue
            q = deque([(x, y)]); seen.add((x, y)); c = []
            while q:
                cx, cy = q.popleft(); c.append((cx, cy))
                for nx, ny in ((cx+1,cy),(cx-1,cy),(cx,cy+1),(cx,cy-1),(cx+1,cy+1),(cx-1,cy-1),(cx+1,cy-1),(cx-1,cy+1)):
                    if 0 <= nx < W and 0 <= ny < H and (nx, ny) not in seen and mask_pts_fn(nx, ny):
                        seen.add((nx, ny)); q.append((nx, ny))
            out.append(c)
    return out

def hull(points):
    pts = sorted(set(points))
    if len(pts) < 3: return pts
    cross = lambda o, a, b: (a[0]-o[0])*(b[1]-o[1]) - (a[1]-o[1])*(b[0]-o[0])
    lo, up = [], []
    for p in pts:
        while len(lo) >= 2 and cross(lo[-2], lo[-1], p) <= 0: lo.pop()
        lo.append(p)
    for p in reversed(pts):
        while len(up) >= 2 and cross(up[-2], up[-1], p) <= 0: up.pop()
        up.append(p)
    return lo[:-1] + up[:-1]

def run(path, box, A, band_mm=8, name=''):
    band_mm = BANDS.get(name, band_mm)
    im = Image.open(path).convert('RGB'); crop = im.crop(box); W, H = crop.size; cp = crop.load()
    m = largest(mask_of(path, box)); mp = m.load()
    rows = {}
    for y in range(H):
        xs = [x for x in range(W) if mp[x, y]]
        if xs: rows[y] = (xs[0], xs[-1])
    ytop = min(rows); ybot = max(rows)
    # кончик: самый крупный чёрный сгусток ниже/около низа заливки
    xmin = min(v[0] for v in rows.values()); xmax = max(v[1] for v in rows.values())
    y0 = max(0, ybot - 40)
    sub = lambda x, y: y >= y0 and xmin - 20 <= x <= xmax + 20 and max(cp[x, y]) < 60
    blobs = [c for c in comps(sub, W, H) if len(c) > 25]
    blob = max(blobs, key=len)
    ty = max(p[1] for p in blob); tx = sum(p[0] for p in blob if p[1] >= ty - 2) / len([p for p in blob if p[1] >= ty - 2])
    # плечико: строка, где ширина резко растёт относительно хвостовика
    widths = [(y, rows[y][1] - rows[y][0]) for y in sorted(rows)]
    tangw = sorted(w for y, w in widths[5:40])[len(widths[5:40]) // 2]
    ysh = next(y for y, w in widths if y > ytop + 20 and w > tangw * 1.45)
    s = (A - 30) / (ty - ysh)                # мм на пиксель
    A_img = (ty - ytop) * s
    # нос: выпуклая оболочка нижней полосы заливки + кончик (заливка у кромки почти белая)
    band = int(band_mm / s)
    lowpts = [(x, y) for y in range(ybot - band, ybot + 1) if y in rows for x in rows[y]]
    hp = hull(lowpts + [(round(tx), ty)])
    d = ImageDraw.Draw(m); d.polygon(hp, fill=255)
    pts = trace(m)
    # сгладить границу скользящим средним (кольцевым), углы почти не страдают при малом окне
    n = len(pts); w = 10
    sm = [(sum(pts[(j + k) % n][0] for k in range(-w, w + 1)) / (2 * w + 1),
           sum(pts[(j + k) % n][1] for k in range(-w, w + 1)) / (2 * w + 1)) for j in range(n)]
    # кончик держим точно: ближайшую к нему точку возвращаем на место
    jt = min(range(n), key=lambda j: (pts[j][0] - tx) ** 2 + (pts[j][1] - ty) ** 2); sm[jt] = (tx, ty)
    i = len(sm) // 2
    eps = 1.4 / s                            # допуск ~1.4 мм
    sp = dp(sm[:i+1], eps)[:-1] + dp(sm[i:] + [sm[0]], eps)[:-1]
    mm = [((x - tx) * s, (ty - y) * s) for x, y in sp]
    Hb = A - 30
    # центр хвостовика по маске (10..20 мм над плечиком)
    tys = [y for y in rows if ysh - 20 / s <= y <= ysh - 8 / s]
    tcx = (sum((rows[y][0] + rows[y][1]) / 2 for y in tys) / len(tys) - tx) * s
    tl, tr = tcx - 6.5, tcx + 6.5
    # тело: отрезаем всё выше плечика (Сазерленд–Ходжмен по полуплоскости y <= Hb)
    body = []
    for i2 in range(len(mm)):
        P, Q = mm[i2], mm[(i2 + 1) % len(mm)]
        pin, qin = P[1] <= Hb, Q[1] <= Hb
        if pin: body.append(P)
        if pin != qin:
            t = (Hb - P[1]) / (Q[1] - P[1]); body.append((P[0] + t * (Q[0] - P[0]), Hb))
    # вставляем хвостовик в верхнюю кромку тела (паз слева, как на чертежах каталога)
    out = None
    for i2 in range(len(body)):
        P, Q = body[i2], body[(i2 + 1) % len(body)]
        lo, hi = min(P[0], Q[0]), max(P[0], Q[0])
        if abs(P[1] - Hb) < 1e-6 and abs(Q[1] - Hb) < 1e-6 and lo <= tl + 3 and hi >= tr - 3:
            # хвостовик заподлицо с краем тела — прижимаем к краю, ширина остаётся 13
            if tl < lo: tl, tr = lo, lo + 13
            if tr > hi: tl, tr = hi - 13, hi
            n0, n1 = 5, 13
            seq = [(tr, Hb), (tr, A), (tl, A), (tl, Hb + n1), (tl + 3, Hb + n1), (tl + 3, Hb + n0), (tl, Hb + n0), (tl, Hb)]
            if P[0] < Q[0]: seq = seq[::-1]
            out = body[:i2 + 1] + seq + body[i2 + 1:]
            break
    if out is None: raise RuntimeError('не нашёл верхнюю кромку под хвостовик')
    mm = [[round(-x, 2), round(y, 2)] for x, y in reversed(out)]
    tcx = -(tl + tr) / 2
    # обрезать хвостовик сверху до A (на случай обрезанного скриншота — дорисуем прямоугольником)
    # предпросмотр
    pv = crop.copy(); dd = ImageDraw.Draw(pv)
    dd.line(sp + [sp[0]], fill=(230, 30, 30), width=2)
    dd.ellipse((tx-5, ty-5, tx+5, ty+5), outline=(0, 160, 0), width=2)
    dd.line((0, ysh, W, ysh), fill=(0, 120, 255), width=1)
    pv.save('pv_' + name + '.png')
    return {'name': name, 'A_given': A, 'A_img': round(A_img, 1), 'tang_w_mm': round(tangw * s, 1),
            'scale': s, 'npts': len(mm), 'outline': mm, 'clipped_top': ytop <= 2, 'tangCx': round(tcx, 2)}

BANDS = {'TOP.205-85-R08': 62, 'UNNAMED-85': 56, 'TOP.175-85-R08-S': 52, 'TOP.175-75-R08': 62, 'TOP.205-26-R08': 40, 'PK.114-90-R06': 22, 'TOP.175-60-R08': 14}

if __name__ == '__main__':
    U = '/root/.claude/uploads/6d6ef4b8-e22c-5e53-b936-066f34d11ead/'
    k = 1179 / 923
    D = lambda a, b: (70, int(a * k), 1110, int(b * k))
    jobs = [
        ('TOP.205-85-R08', '41d314a2-image.jpg', (60, 10, 1110, 1310), 205),
        ('UNNAMED-85', '4632c50b-image.jpg', (60, 10, 1130, 1340), 175),
        ('TOP.175-85-R08-S', '00d46815-image.png', D(290, 1300), 174.5),
        ('TOP.175-75-R08', '4ee21eea-image.png', D(325, 1380), 175),
        ('TOP.175-60-R08', '3149c4ec-image.png', D(282, 1385), 175),
        ('TOP.175-60-R5', '4b3f35d5-image.png', D(345, 1400), 175),
        ('PK.97-90-R06', '71a0492a-image.png', D(332, 1390), 97),
        ('TOP.205-26-R08', '8b3f0515-image.png', D(281, 1300), 205),
        ('PK.97-90-R08', 'd4ee3d35-image.png', D(318, 1375), 96.5),
        ('PK.114-90-R06', 'e3162a96-image.png', D(297, 1355), 114),
        ('PK.116-90-R08', 'a197154b-image.png', D(281, 1210), 116),
        ('DK.116-90-R08', 'a27a972f-image.png', D(405, 1465), 116),
    ]
    only = sys.argv[1:]
    res = {}
    for name, f, box, A in jobs:
        if only and name not in only: continue
        try:
            r = run(U + f, box, A if A else 205, name=name)
            res[name] = r
            print(name, {k2: r[k2] for k2 in ('A_given', 'A_img', 'tang_w_mm', 'npts', 'clipped_top')})
        except Exception as e:
            print(name, 'ERROR', repr(e))
    json.dump(res, open('outlines.json' if not only else 'outlines_part.json', 'w'))
