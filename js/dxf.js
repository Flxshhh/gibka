// Чтение чертежей DXF прямо в браузере: свой пуансон, своя матрица, контур детали.
// Понимает LINE, ARC, CIRCLE, LWPOLYLINE и POLYLINE (с дугами-bulge), INSERT (блоки). Единицы — мм.
(function () {
  const D = {};
  const RAD = Math.PI / 180;

  // ---------- Разбор файла на отрезки ----------
  function pairs(text) {
    const lines = text.split(/\r\n|\r|\n/), out = [];
    for (let i = 0; i + 1 < lines.length; i += 2) out.push([lines[i].trim(), lines[i + 1].replace(/\r$/, '')]);
    return out;
  }
  function entities(body) {
    const ents = []; let cur = null;
    for (const [c, v] of body) {
      if (c === '0') { if (cur) ents.push(cur); cur = { type: v.trim(), g: [] }; }
      else if (cur) cur.g.push([parseInt(c, 10), v.trim()]);
    }
    if (cur) ents.push(cur);
    return ents;
  }
  const fget = (e, code, def = 0, idx = 0) => { let k = 0; for (const [c, v] of e.g) if (c === code && k++ === idx) return parseFloat(v); return def; };
  const sget = (e, code, def = '') => { for (const [c, v] of e.g) if (c === code) return v; return def; };

  function parse(text) {
    const P = pairs(text), sections = {};
    for (let i = 0; i < P.length; i++) {
      if (P[i][0] === '0' && P[i][1].trim() === 'SECTION' && P[i + 1] && P[i + 1][0] === '2') {
        const name = P[i + 1][1].trim(), body = []; let j = i + 2;
        while (j < P.length && !(P[j][0] === '0' && P[j][1].trim() === 'ENDSEC')) body.push(P[j++]);
        sections[name] = body; i = j;
      }
    }
    const blocks = {}; let bl = null;
    for (const e of entities(sections.BLOCKS || [])) {
      if (e.type === 'BLOCK') { bl = { base: [fget(e, 10), fget(e, 20)], ents: [] }; blocks[sget(e, 2)] = bl; }
      else if (e.type === 'ENDBLK') bl = null;
      else if (bl) bl.ents.push(e);
    }
    return { ents: entities(sections.ENTITIES || []), blocks };
  }

  function arcPts(cx, cy, r, a0, a1, step = 3) {
    while (a1 <= a0) a1 += 360;
    const n = Math.max(2, Math.ceil((a1 - a0) / step) + 1), pts = [];
    for (let k = 0; k < n; k++) { const a = (a0 + (a1 - a0) * k / (n - 1)) * RAD; pts.push([cx + r * Math.cos(a), cy + r * Math.sin(a)]); }
    return pts;
  }
  function bulgePts(p, q, b) {
    if (Math.abs(b) < 1e-9) return [p, q];
    const ang = 4 * Math.atan(b), dx = q[0] - p[0], dy = q[1] - p[1], c = Math.hypot(dx, dy);
    if (c < 1e-12) return [p, q];
    const r = c / (2 * Math.sin(ang / 2)), mx = (p[0] + q[0]) / 2, my = (p[1] + q[1]) / 2;
    const h = r * Math.cos(ang / 2), nx = -dy / c, ny = dx / c, cx = mx + nx * h, cy = my + ny * h;
    let a0 = Math.atan2(p[1] - cy, p[0] - cx) / RAD, a1 = Math.atan2(q[1] - cy, q[0] - cx) / RAD;
    if (b < 0) [a0, a1] = [a1, a0];
    const pts = arcPts(cx, cy, Math.abs(r), a0, a1);
    return b < 0 ? pts.reverse() : pts;
  }

  // T — аффинное преобразование [a,b,c,d,e,f]: x' = a·x + c·y + e, y' = b·x + d·y + f
  function explode(ents, blocks, T, depth, out) {
    const [a, b, c, d, e_, f] = T;
    const tf = p => [a * p[0] + c * p[1] + e_, b * p[0] + d * p[1] + f];
    const add = (pts, arc) => { const q = pts.map(tf); for (let k = 0; k < q.length - 1; k++) out.push({ x1: q[k][0], y1: q[k][1], x2: q[k + 1][0], y2: q[k + 1][1], arc: !!arc }); };
    const polyAdd = (vs, bul, closed) => {
      const n = vs.length;
      for (let k = 0; k < n - 1 + (closed ? 1 : 0); k++) add(bulgePts(vs[k], vs[(k + 1) % n], bul[k] || 0), Math.abs(bul[k] || 0) > 1e-9);
    };
    let poly = null;
    for (const e of ents) {
      const t = e.type;
      if (t === 'LINE') add([[fget(e, 10), fget(e, 20)], [fget(e, 11), fget(e, 21)]], false);
      else if (t === 'ARC') {
        let cx = fget(e, 10), a0 = fget(e, 50), a1 = fget(e, 51);
        if (fget(e, 230, 1) < 0) { cx = -cx; [a0, a1] = [180 - a1, 180 - a0]; }   // нормаль (0,0,−1): дуга задана зеркально
        add(arcPts(cx, fget(e, 20), fget(e, 40), a0, a1), true);
      } else if (t === 'CIRCLE') add(arcPts(fget(e, 10) * (fget(e, 230, 1) < 0 ? -1 : 1), fget(e, 20), fget(e, 40), 0, 360), true);
      else if (t === 'LWPOLYLINE') {
        const vs = [], bul = []; let x = null;
        for (const [cc, v] of e.g) {
          if (cc === 10) x = parseFloat(v);
          else if (cc === 20 && x != null) { vs.push([x, parseFloat(v)]); bul.push(0); x = null; }
          else if (cc === 42 && vs.length) bul[vs.length - 1] = parseFloat(v);
        }
        if (fget(e, 230, 1) < 0) { vs.forEach(p => { p[0] = -p[0]; }); bul.forEach((v, i) => { bul[i] = -v; }); }
        polyAdd(vs, bul, fget(e, 70, 0) & 1);
      } else if (t === 'INSERT') {
        const name = sget(e, 2), blk = blocks[name];
        if (!blk || depth > 8 || /^\*D/i.test(name)) continue;
        let ix = fget(e, 10), sx = fget(e, 41, 1) || 1, rot = fget(e, 50, 0) * RAD;
        const iy = fget(e, 20), sy = fget(e, 42, 1) || 1, [bx, by] = blk.base;
        if (fget(e, 230, 1) < 0) { ix = -ix; sx = -sx; rot = -rot; }
        const cr = Math.cos(rot), sr = Math.sin(rot);
        const la = cr * sx, lb = sr * sx, lc = -sr * sy, ld = cr * sy, le = ix - (la * bx + lc * by), lf = iy - (lb * bx + ld * by);
        explode(blk.ents, blocks, [a * la + c * lb, b * la + d * lb, a * lc + c * ld, b * lc + d * ld, a * le + c * lf + e_, b * le + d * lf + f], depth + 1, out);
      } else if (t === 'POLYLINE') poly = { closed: fget(e, 70, 0) & 1, v: [], b: [] };
      else if (t === 'VERTEX' && poly) { poly.v.push([fget(e, 10), fget(e, 20)]); poly.b.push(fget(e, 42, 0)); }
      else if (t === 'SEQEND' && poly) { polyAdd(poly.v, poly.b, poly.closed); poly = null; }
    }
    return out;
  }

  D.segments = function (text) {
    const { ents, blocks } = parse(text);
    return explode(ents, blocks, [1, 0, 0, 1, 0, 0], 0, []).filter(s => isFinite(s.x1 + s.y1 + s.x2 + s.y2));
  };

  // ---------- Контуры ----------
  const len = s => Math.hypot(s.x2 - s.x1, s.y2 - s.y1);
  function chain(seg, tol) {
    const key = (x, y) => Math.round(x / tol) + ',' + Math.round(y / tol), adj = new Map();
    seg.forEach((s, i) => {
      if (len(s) < 1e-9) return;
      [[0, s.x1, s.y1], [1, s.x2, s.y2]].forEach(([end, x, y]) => { const k = key(x, y); if (!adj.has(k)) adj.set(k, []); adj.get(k).push([i, end]); });
    });
    const used = new Set(), loops = [];
    for (let i = 0; i < seg.length; i++) {
      if (used.has(i) || len(seg[i]) < 1e-9) continue;
      const loop = [[seg[i].x1, seg[i].y1]], start = key(seg[i].x1, seg[i].y1);
      let cur = [seg[i].x2, seg[i].y2], ok = false; used.add(i);
      for (let n = 0; n < seg.length + 5; n++) {
        loop.push(cur);
        if (key(cur[0], cur[1]) === start) { ok = true; break; }
        const nxt = (adj.get(key(cur[0], cur[1])) || []).find(x => !used.has(x[0]));
        if (!nxt) break;
        used.add(nxt[0]); const s = seg[nxt[0]];
        cur = nxt[1] === 0 ? [s.x2, s.y2] : [s.x1, s.y1];
      }
      if (ok && loop.length > 3) loops.push(loop.slice(0, -1));
    }
    return loops;
  }
  const area = p => { let a = 0; for (let i = 0; i < p.length; i++) { const q = p[(i + 1) % p.length]; a += p[i][0] * q[1] - q[0] * p[i][1]; } return a / 2; };
  const box = p => { let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity; for (const q of p) { x0 = Math.min(x0, q[0]); x1 = Math.max(x1, q[0]); y0 = Math.min(y0, q[1]); y1 = Math.max(y1, q[1]); } return { x0, y0, x1, y1, w: x1 - x0, h: y1 - y0 }; };

  // Соединить ближайшие свободные концы (разрывы в чертеже) не дальше lim
  function closeGaps(seg, lim) {
    const cnt = new Map();
    seg.forEach(s => [[s.x1, s.y1], [s.x2, s.y2]].forEach(p => { const k = p[0].toFixed(2) + ',' + p[1].toFixed(2); const o = cnt.get(k) || { n: 0, p }; o.n++; cnt.set(k, o); }));
    let free = [...cnt.values()].filter(o => o.n % 2).map(o => o.p); const extra = [];
    while (free.length > 1) {
      let best = null;
      for (let i = 0; i < free.length; i++) for (let j = i + 1; j < free.length; j++) {
        const dd = Math.hypot(free[i][0] - free[j][0], free[i][1] - free[j][1]);
        if (!best || dd < best[0]) best = [dd, i, j];
      }
      if (best[0] > lim) break;
      extra.push({ x1: free[best[1]][0], y1: free[best[1]][1], x2: free[best[2]][0], y2: free[best[2]][1], arc: false });
      free = free.filter((_, k) => k !== best[1] && k !== best[2]);
    }
    return extra;
  }

  // Самый большой замкнутый контур подходящих размеров (не рамка чертежа)
  function mainOutline(seg, sane) {
    const pick = ls => { const g = ls.filter(l => sane(box(l))); return g.length ? g.reduce((a, b) => Math.abs(area(a)) >= Math.abs(area(b)) ? a : b) : null; };
    let big = pick(chain(seg, 0.05));
    if (!big || Math.abs(area(big)) < 150) {
      const seen = new Set(), sg = seg.filter(t => { const k = [[t.x1, t.y1], [t.x2, t.y2]].map(p => p[0].toFixed(2) + ',' + p[1].toFixed(2)).sort().join('|'); if (seen.has(k)) return false; seen.add(k); return true; });
      for (const [tol, lim] of [[0.02, 12], [0.2, 12]]) {
        const b2 = pick(chain(sg.concat(closeGaps(sg, lim)), tol));
        if (b2 && Math.abs(area(b2)) > 150) { big = b2; break; }
      }
    }
    if (!big) return null;
    if (area(big) < 0) big = big.slice().reverse();
    const o = [big[0]];
    for (const p of big.slice(1)) if (Math.hypot(p[0] - o[o.length - 1][0], p[1] - o[o.length - 1][1]) > 0.01) o.push(p);
    return o;
  }

  // Упрощение ломаной (Рамер — Дуглас — Пекер): дуги из сотен точек → десятки, форма в пределах eps мм
  function rdp(pts, eps) {
    if (pts.length < 3) return pts;
    const a = pts[0], b = pts[pts.length - 1], dx = b[0] - a[0], dy = b[1] - a[1], L = Math.hypot(dx, dy) || 1e-9;
    let dmax = 0, im = 0;
    for (let i = 1; i < pts.length - 1; i++) { const d = Math.abs(dy * (pts[i][0] - a[0]) - dx * (pts[i][1] - a[1])) / L; if (d > dmax) { dmax = d; im = i; } }
    if (dmax <= eps) return [a, b];
    return rdp(pts.slice(0, im + 1), eps).slice(0, -1).concat(rdp(pts.slice(im), eps));
  }
  function rdpClosed(o, eps) {
    let k = 0, best = -1;
    o.forEach((p, i) => { const d = (p[0] - o[0][0]) ** 2 + (p[1] - o[0][1]) ** 2; if (d > best) { best = d; k = i; } });
    return rdp(o.slice(0, k + 1), eps).slice(0, -1).concat(rdp(o.slice(k).concat([o[0]]), eps).slice(0, -1));
  }
  const r2 = v => Math.round(v * 100) / 100;
  const rot90 = (o, k) => { const f = [(x, y) => [x, y], (x, y) => [-y, x], (x, y) => [-x, -y], (x, y) => [y, -x]][k]; return o.map(p => f(p[0], p[1])); };
  function xsAt(o, y) {
    const r = [];
    for (let i = 0; i < o.length; i++) { const P = o[i], Q = o[(i + 1) % o.length]; if ((P[1] - y) * (Q[1] - y) < 0) r.push(P[0] + (y - P[1]) / (Q[1] - P[1]) * (Q[0] - P[0])); }
    return r.sort((a, b) => a - b);
  }

  // ---------- Пуансон ----------
  // Контур → система программы: кромка в (0,0) внизу, хвостовик сверху и правее оси; измеряем A, H, угол и R кромки
  function normPunch(src, keepSide) {
    const b = box(src), A = b.h;
    const low = src.filter(p => p[1] <= b.y0 + 1e-3).map(p => p[0]), tx = (Math.min(...low) + Math.max(...low)) / 2;
    let o = src.map(p => [p[0] - tx, p[1] - b.y0]);
    const top = xsAt(o, A - 3);
    let tcx = top.length >= 2 ? (top[0] + top[top.length - 1]) / 2 : 0;
    if (tcx < 0 && !keepSide) { o = o.map(p => [-p[0], p[1]]).reverse(); tcx = -tcx; }   // при ручном повороте сторону не меняем
    if (area(o) < 0) o.reverse();
    const tw = top.length >= 2 ? top[top.length - 1] - top[0] : 13;
    let Hb = null;
    for (let k = Math.floor(A * 10) - 30; k > 0; k--) { const xs = xsAt(o, k / 10); if (xs.length >= 2 && xs[xs.length - 1] - xs[0] > tw * 1.25 + 1) { Hb = k / 10 + 0.05; break; } }
    // кромка: идём от нижней точки в обе стороны — пока шаги короткие и поворот плавный, это скругление; дальше — грань
    const n = o.length; let it = 0;
    o.forEach((p, i) => { if (p[1] < o[it][1] - 1e-9 || (Math.abs(p[1] - o[it][1]) < 1e-9 && Math.abs(p[0]) < Math.abs(o[it][0]))) it = i; });
    const walk = dirn => {
      let turn = 0, arclen = 0, i = it, prev = null;
      for (let c = 0; c < n; c++) {
        const j = (i + dirn + n) % n, dx = o[j][0] - o[i][0], dy = o[j][1] - o[i][1], L = Math.hypot(dx, dy);
        if (L < 1e-9) { i = j; continue; }
        const a = Math.atan2(dy, dx);
        if (prev != null) {
          const da = ((a - prev + Math.PI) % (2 * Math.PI) + 2 * Math.PI) % (2 * Math.PI) - Math.PI;
          if (L > 1.5 || Math.abs(da / RAD) > 6) return { d: [dx / L, dy / L], turn, arclen };
          turn += Math.abs(da);
        }
        arclen += L; prev = a; i = j;
        if (L > 1.5) return { d: [dx / L, dy / L], turn, arclen: arclen - L };
      }
      return { d: null, turn, arclen };
    };
    const wl = walk(-1), wr = walk(1);
    let angle = null, r = null;
    if (wl.d && wr.d) {
      angle = Math.acos(Math.max(-1, Math.min(1, wl.d[0] * wr.d[0] + wl.d[1] * wr.d[1]))) / RAD;
      if (wl.turn + wr.turn > 0.2) r = (wl.arclen + wr.arclen) / (wl.turn + wr.turn);
    }
    return { outline: o, A, Hb, tangCx: tcx, tangW: tw, angle, r };
  }
  // Насколько результат похож на пуансон с хвостовиком 13×30 сверху (для выбора, как повёрнут чертёж)
  const punchScore = m => (m.Hb ? Math.abs(m.A - m.Hb - 30) : 40) + Math.abs(m.tangW - 13) * 2 + (m.angle && m.angle <= 120 ? 0 : 15);

  function punchItem(m, name) {
    const it = { name, type: 'custom', group: 'Свой чертёж', H: r2(m.A), Hb: r2(m.Hb || Math.max(10, m.A - 30)), r: m.r ? Math.round(m.r * 10) / 10 : 0.3, L: 835,
      tangCx: r2(m.tangCx), note: 'из DXF', outline: rdpClosed(m.outline, 0.02).map(p => [r2(p[0]), r2(p[1])]) };
    if (m.angle && m.angle <= 120) it.angle = Math.round(m.angle * 10) / 10;
    return it;
  }

  D.punch = function (text, name) {
    const o = mainOutline(D.segments(text), b => Math.min(b.w, b.h) < 150 && Math.max(b.w, b.h) > 60 && Math.max(b.w, b.h) < 320);
    if (!o) return { error: 'В файле не нашлось замкнутого контура пуансона (высотой 60–320 мм). Проверьте, что профиль начерчен одной замкнутой линией в масштабе 1:1 в миллиметрах.' };
    // чертёж может быть повёрнут — берём поворот, при котором сверху хвостовик 13×30
    const best = [0, 1, 2, 3].map(k => normPunch(rot90(o, k))).reduce((a, b) => punchScore(a) <= punchScore(b) ? a : b);
    return { punch: punchItem(best, name) };
  };
  // Повернуть контур «Моего» пуансона на 90° (если чертёж распознан не той стороной) или отразить.
  // Исходный контур хранится в raw, поворот — в rk, зеркало — в mir: каждый раз считаем от исходного,
  // поэтому четыре поворота возвращают пуансон ровно в прежний вид, без накопления сдвигов.
  D.rotatePunch = function (pu, mirror) {
    const raw = pu.raw || { o: pu.outline, H: pu.H, Hb: pu.Hb, tangCx: pu.tangCx, angle: pu.angle, r: pu.r };
    const rk = mirror ? (pu.rk || 0) : ((pu.rk || 0) + 1) % 4, mir = mirror ? !pu.mir : !!pu.mir;
    let geo;
    if (!rk && !mir) geo = { outline: raw.o, H: raw.H, Hb: raw.Hb, tangCx: raw.tangCx, angle: raw.angle, r: raw.r };
    else {
      const src = mir ? raw.o.map(p => [-p[0], p[1]]).reverse() : raw.o;
      geo = punchItem(normPunch(rot90(src, rk), true), pu.name);
      geo = { outline: geo.outline, H: geo.H, Hb: geo.Hb, tangCx: geo.tangCx, angle: geo.angle, r: geo.r };
    }
    const n = Object.assign({}, pu, geo, { raw, rk, mir });
    if (!(n.angle > 0)) delete n.angle;
    return n;
  };

  // ---------- Матрица ----------
  // Ручьи на верхней грани: V-образные провалы между точками верхней площадки
  function grooves(o) {
    const n = o.length, T = Math.max(...o.map(p => p[1])), plat = o.map(p => p[1] >= T - 0.05);
    if (!plat.some(Boolean)) return [];
    let ib = 0; o.forEach((p, i) => { if (p[1] < o[ib][1]) ib = i; });
    const runs = []; let i = plat.indexOf(true);
    for (let c = 0; c < n; c++) {
      const j = (i + 1) % n;
      if (plat[i] && !plat[j]) {
        const run = [i]; let k = j;
        while (!plat[k]) { run.push(k); k = (k + 1) % n; }
        run.push(k);
        if (run.slice(1, -1).indexOf(ib) < 0) runs.push(run);
      }
      i = j;
    }
    const out = [];
    for (const run of runs) {
      let P = run.map(q => o[q]);
      if (P[0][0] > P[P.length - 1][0]) P = P.slice().reverse();
      const depth = T - Math.min(...P.map(p => p[1]));
      if (depth < 1.5) continue;
      let ib2 = 0; P.forEach((p, q) => { if (p[1] < P[ib2][1]) ib2 = q; });
      const longest = (a, b) => { let best = null; for (let q = a; q < b; q++) { const L = Math.hypot(P[q + 1][0] - P[q][0], P[q + 1][1] - P[q][1]); if (!best || L > best[0]) best = [L, q]; } return best; };
      const L1 = longest(0, ib2), L2 = longest(ib2, P.length - 1);
      if (!L1 || !L2) continue;
      const a1 = P[L1[1]], b1 = P[L1[1] + 1], a2 = P[L2[1]], b2 = P[L2[1] + 1];
      const xat = (a, b) => Math.abs(b[1] - a[1]) < 1e-6 ? null : a[0] + (T - a[1]) * (b[0] - a[0]) / (b[1] - a[1]);
      const xL = xat(a1, b1), xR = xat(a2, b2);
      if (xL == null || xR == null) continue;
      const incl1 = Math.atan2(Math.abs(b1[1] - a1[1]), Math.abs(b1[0] - a1[0])) / RAD, incl2 = Math.atan2(Math.abs(b2[1] - a2[1]), Math.abs(b2[0] - a2[0])) / RAD;
      const ang = 180 - incl1 - incl2, V = xR - xL;
      if (!(ang >= 15 && ang <= 125) || V < 3.5) continue;
      const rs = [[xL - P[0][0], incl1], [P[P.length - 1][0] - xR, incl2]].filter(t => t[0] > 0.02).map(t => t[0] / Math.tan(t[1] * RAD / 2));
      const r = Math.max(0.2, Math.min(rs.length ? Math.min(...rs) : 0.2, V * 0.35));
      out.push({ V, angle: ang, r, cx: (xL + xR) / 2, depth, top: T });
    }
    return out;
  }

  D.dies = function (text, name) {
    const o = mainOutline(D.segments(text), b => b.w > 8 && b.w < 260 && b.h > 8 && b.h < 260);
    if (!o) return { error: 'В файле не нашлось замкнутого контура матрицы. Проверьте, что профиль начерчен одной замкнутой линией в масштабе 1:1 в миллиметрах.' };
    const found = [], offs = [];
    for (let k = 0; k < 4; k++) {
      const q = rot90(o, k), b = box(q), ro = q.map(p => [p[0] - b.x0, p[1] - b.y0]);
      offs.push([b.x0, b.y0]);
      // матрица должна стоять на нижней грани: ровный участок не меньше 10% ширины
      let flat = 0;
      for (let i = 0; i < ro.length; i++) { const pv = ro[(i - 1 + ro.length) % ro.length]; if (ro[i][1] < 0.05 && pv[1] < 0.05) flat += Math.abs(ro[i][0] - pv[0]); }
      if (k && flat < 0.1 * b.w) continue;
      for (const g of grooves(ro)) {
        const key = [g.V.toFixed(1), Math.round(g.angle), g.r.toFixed(1), Math.round(g.top)].join('|');
        found.push(Object.assign(g, { rot: k, key, dup: found.some(f => f.key === key), ro, W: b.w }));
      }
    }
    const real = found.filter(g => !g.dup).sort((a, b) => a.V - b.V || a.angle - b.angle);
    if (!real.length) return { error: 'Контур найден, но V-образного ручья на его гранях нет. Если это держатель или подложка — как матрицу её использовать нельзя.' };
    // точки ручья h (кромки и дно) в координатах чертежа ручья g — чтобы подписать размеры на других гранях
    const F = [(x, y) => [x, y], (x, y) => [-y, x], (x, y) => [-x, -y], (x, y) => [y, -x]], FI = [(x, y) => [x, y], (x, y) => [y, -x], (x, y) => [-x, -y], (x, y) => [-y, x]];
    const facePts = (h, g) => [[h.cx - h.V / 2, h.top], [h.cx + h.V / 2, h.top], [h.cx, h.top - h.depth]].map(([x, y]) => {
      const p0 = FI[h.rot](x + offs[h.rot][0], y + offs[h.rot][1]), q = F[g.rot](p0[0], p0[1]);
      return [r2(q[0] - offs[g.rot][0] - g.cx), r2(q[1] - offs[g.rot][1])];
    });
    const multi = found.length > 1, manyAng = new Set(found.map(g => Math.round(g.angle))).size > 1;
    return { dies: real.map((g, i) => {
      const V = Math.round(g.V * 10) / 10, ang = Math.round(g.angle);
      const it = { name: name + (multi ? ' · V' + V + (manyAng ? ' ' + ang + '°' : '') : ''), type: 'custom', group: 'Свой чертёж', V, angle: ang, r: Math.round(g.r * 10) / 10,
        H: r2(g.top), W: Math.round(g.W * 10) / 10, vDepth: r2(g.depth) };
      if (multi) {
        it.note = 'ручей ' + (i + 1) + ' из ' + real.length + (g.rot ? ' — матрицу перевернуть другой гранью вверх' : '');
        it.others = found.filter(h => h !== g).sort((a, b) => a.V - b.V || a.angle - b.angle).map(h => Object.assign(
          { V: Math.round(h.V * 10) / 10, angle: Math.round(h.angle), r: Math.round(h.r * 10) / 10, depth: r2(h.depth) },
          h.rot === g.rot ? { dx: r2(h.cx - g.cx) } : { face: 1, pts: facePts(h, g) }));
      }
      it.outline = rdpClosed(g.ro.map(p => [p[0] - g.cx, p[1]]), 0.03).map(p => [r2(p[0]), r2(p[1])]);
      return it;
    }) };
  };

  // ---------- Контур детали ----------
  // Профиль детали: либо одна линия (ломаная с дугами или без), либо замкнутый контур листа толщиной S.
  // Возвращает отрезки (направление, длина до вершин острых углов) и, для замкнутого контура, толщину.
  D.part = function (text) {
    const seg = D.segments(text).filter(s => len(s) > 1e-6);
    if (!seg.length) return { error: 'В файле нет линий. Нужен профиль детали: ломаная линия или замкнутый контур листа.' };
    // связные цепочки: сначала от свободных концов (разомкнутые), потом замкнутые
    const tol = 0.05, key = (x, y) => Math.round(x / tol) + ',' + Math.round(y / tol), adj = new Map();
    seg.forEach((s, i) => [[0, s.x1, s.y1], [1, s.x2, s.y2]].forEach(([end, x, y]) => { const k = key(x, y); if (!adj.has(k)) adj.set(k, []); adj.get(k).push([i, end]); }));
    const used = new Set(), paths = [];
    const walk = (i, end) => {   // идём от конца end отрезка i
      const edges = []; let cur = i, e = end;
      while (true) {
        used.add(cur); const s = seg[cur];
        const a = e === 0 ? [s.x1, s.y1] : [s.x2, s.y2], b = e === 0 ? [s.x2, s.y2] : [s.x1, s.y1];
        edges.push({ a, b, arc: s.arc });
        const nxt = (adj.get(key(b[0], b[1])) || []).find(x => !used.has(x[0]));
        if (!nxt) break;
        cur = nxt[0]; e = nxt[1];
      }
      return edges;
    };
    seg.forEach((s, i) => { if (used.has(i)) return; for (const [end, x, y] of [[0, s.x1, s.y1], [1, s.x2, s.y2]]) if (adj.get(key(x, y)).length === 1) { paths.push({ edges: walk(i, end), closed: false }); return; } });
    seg.forEach((s, i) => { if (!used.has(i)) paths.push({ edges: walk(i, 0), closed: true }); });
    const plen = p => p.edges.reduce((a, e) => a + Math.hypot(e.b[0] - e.a[0], e.b[1] - e.a[1]), 0);
    const path = paths.reduce((a, b) => plen(a) >= plen(b) ? a : b);
    if (path.closed) { const f = path.edges[0].a, l = path.edges[path.edges.length - 1].b; if (Math.hypot(f[0] - l[0], f[1] - l[1]) > 0.2) path.closed = false; }

    // прямые участки: подряд идущие отрезки одного направления сливаем; дуги между ними — это гибы
    const lines = [];
    for (const e of path.edges) {
      if (e.arc) { if (lines.length) lines[lines.length - 1].arcAfter = true; continue; }
      const d = Math.atan2(e.b[1] - e.a[1], e.b[0] - e.a[0]), L = Math.hypot(e.b[0] - e.a[0], e.b[1] - e.a[1]), pv = lines[lines.length - 1];
      if (pv && !pv.arcAfter && Math.abs(Math.atan2(Math.sin(d - pv.d), Math.cos(d - pv.d))) < 0.5 * RAD) { pv.b = e.b; pv.L += L; }
      else if (L > 1e-6) lines.push({ a: e.a, b: e.b, d, L });
    }
    if (path.closed && lines.length > 2) {   // первый и последний участок могут быть одной прямой
      const f = lines[0], l = lines[lines.length - 1];
      if (!l.arcAfter && Math.abs(Math.atan2(Math.sin(f.d - l.d), Math.cos(f.d - l.d))) < 0.5 * RAD) { f.a = l.a; f.L += l.L; lines.pop(); }
    }
    if (!lines.length) return { error: 'В профиле нет прямых участков — только дуги.' };
    const dirOf = l => Math.atan2(l.b[1] - l.a[1], l.b[0] - l.a[0]);
    const cross = (p, q) => {   // точка пересечения прямых p и q (вершина острого угла)
      const d1 = [p.b[0] - p.a[0], p.b[1] - p.a[1]], d2 = [q.b[0] - q.a[0], q.b[1] - q.a[1]], den = d1[0] * d2[1] - d1[1] * d2[0];
      if (Math.abs(den) < 1e-9) return [(p.b[0] + q.a[0]) / 2, (p.b[1] + q.a[1]) / 2];
      const t = ((q.a[0] - p.a[0]) * d2[1] - (q.a[1] - p.a[1]) * d2[0]) / den;
      return [p.a[0] + t * d1[0], p.a[1] + t * d1[1]];
    };
    const apexes = ls => [ls[0].a].concat(ls.slice(0, -1).map((l, i) => cross(l, ls[i + 1])), [ls[ls.length - 1].b]);
    const toSegs = pts => {
      const out = [];
      for (let i = 0; i < pts.length - 1; i++) {
        const dx = pts[i + 1][0] - pts[i][0], dy = pts[i + 1][1] - pts[i][1], L = Math.hypot(dx, dy);
        let dir = ((Math.atan2(dy, dx) / RAD) % 360 + 360) % 360;
        if (Math.abs(dir - Math.round(dir)) < 0.05) dir = Math.round(dir) % 360; else dir = r2(dir);
        if (L > 0.01) out.push({ dir, len: r2(L) });
      }
      return out;
    };
    const check = (segs, extra) => {
      if (segs.length < 1) return { error: 'Не получилось выделить отрезки детали.' };
      for (let i = 0; i < segs.length - 1; i++) {
        const t = Math.abs(((segs[i + 1].dir - segs[i].dir) % 360 + 540) % 360 - 180);
        if (t < 0.5 || t > 179.5) return { error: 'В профиле есть разворот на 180° или лишняя точка на прямой — это не гиб. Упростите чертёж.' };
      }
      return Object.assign({ segs }, extra);
    };

    if (!path.closed) return check(toSegs(apexes(lines)), {});

    // Замкнутый контур листа: две длинные стороны и два торца длиной S. Торцы — самые короткие прямые с прямыми углами по бокам
    const n = lines.length, perp = (p, q) => Math.abs(Math.abs(Math.atan2(Math.sin(dirOf(p) - dirOf(q)), Math.cos(dirOf(p) - dirOf(q)))) - Math.PI / 2) < 4 * RAD;
    const caps = lines.map((l, i) => ({ i, L: l.L })).filter(c => perp(lines[c.i], lines[(c.i + 1) % n]) && perp(lines[c.i], lines[(c.i - 1 + n) % n])).sort((a, b) => a.L - b.L).slice(0, 2);
    if (caps.length < 2 || Math.abs(caps[0].L - caps[1].L) > 0.05 * caps[1].L + 0.02) {
      return { error: 'Замкнутый контур не похож на профиль листа: не нашлось двух торцов одинаковой длины (толщины). Начертите профиль одной линией или контуром постоянной толщины.' };
    }
    const [c1, c2] = [caps[0].i, caps[1].i].sort((a, b) => a - b);
    const sideA = lines.slice(c1 + 1, c2), sideB = lines.slice(c2 + 1).concat(lines.slice(0, c1));
    if (!sideA.length || sideA.length !== sideB.length) return { error: 'Стороны контура не совпадают по числу участков — толщина листа непостоянна или контур с вырезами.' };
    const pa = apexes(sideA), pb = apexes(sideB).reverse();
    const mid = pa.map((p, i) => [(p[0] + pb[i][0]) / 2, (p[1] + pb[i][1]) / 2]);
    return check(toSegs(mid), { S: r2((caps[0].L + caps[1].L) / 2), dimMode: 'mid' });
  };

  D.rdpClosed = rdpClosed;
  LG.DXF = D;
})();
