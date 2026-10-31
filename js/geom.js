// Геометрия: векторы, полигоны, пересечения, форма листа и инструмента.
// Система координат: x — вправо (к упору, назад), y — вверх, единицы — мм.
(function () {
  const G = {};
  const RAD = Math.PI / 180;
  G.RAD = RAD;
  G.deg = d => d * RAD;

  // Нормализация угла в градусах в диапазон (-180, 180]
  G.norm180 = function (d) {
    d = ((d % 360) + 360) % 360;
    return d > 180 ? d - 360 : d;
  };

  G.dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);
  const N = d => ({ x: -Math.sin(d), y: Math.cos(d) }); // левая нормаль к направлению d

  // Пересечение отрезков p1p2 и p3p4 (строго внутри, касания концами не считаются)
  G.segIntersect = function (p1, p2, p3, p4) {
    const d1x = p2.x - p1.x, d1y = p2.y - p1.y;
    const d2x = p4.x - p3.x, d2y = p4.y - p3.y;
    const den = d1x * d2y - d1y * d2x;
    if (Math.abs(den) < 1e-12) return null;
    const ex = p3.x - p1.x, ey = p3.y - p1.y;
    const t = (ex * d2y - ey * d2x) / den;
    const u = (ex * d1y - ey * d1x) / den;
    const e = 1e-6;
    if (t <= e || t >= 1 - e || u <= e || u >= 1 - e) return null;
    return { x: p1.x + t * d1x, y: p1.y + t * d1y };
  };

  G.bounds = function (pts, b) {
    b = b || { x0: Infinity, y0: Infinity, x1: -Infinity, y1: -Infinity };
    for (const p of pts) {
      if (p.x < b.x0) b.x0 = p.x; if (p.x > b.x1) b.x1 = p.x;
      if (p.y < b.y0) b.y0 = p.y; if (p.y > b.y1) b.y1 = p.y;
    }
    return b;
  };

  // Все точки пересечения контуров A и B (замкнутые полигоны)
  G.polyHits = function (A, B, ignore) {
    const hits = [];
    const bb = G.bounds(B);
    for (let i = 0; i < A.length; i++) {
      const a1 = A[i], a2 = A[(i + 1) % A.length];
      // быстрый отсев по габаритам
      if (Math.max(a1.x, a2.x) < bb.x0 || Math.min(a1.x, a2.x) > bb.x1 ||
          Math.max(a1.y, a2.y) < bb.y0 || Math.min(a1.y, a2.y) > bb.y1) continue;
      for (let j = 0; j < B.length; j++) {
        const p = G.segIntersect(a1, a2, B[j], B[(j + 1) % B.length]);
        if (p && !(ignore && ignore(p))) hits.push(p);
      }
    }
    return hits;
  };

  // Площадь полигона (формула шнурования), мм²
  G.area = function (pts) {
    let a = 0;
    for (let i = 0; i < pts.length; i++) {
      const p = pts[i], q = pts[(i + 1) % pts.length];
      a += p.x * q.y - q.x * p.y;
    }
    return Math.abs(a) / 2;
  };

  G.translate = (pts, dx, dy) => pts.map(p => ({ x: p.x + dx, y: p.y + dy }));
  G.mirrorX = pts => pts.map(p => ({ x: -p.x, y: p.y })).reverse();
  G.rect = (x0, y0, x1, y1) => [{ x: x0, y: y0 }, { x: x1, y: y0 }, { x: x1, y: y1 }, { x: x0, y: y1 }];

  // Дуга окружности: от угла a0 до a1 (рад), шаг ~stepDeg
  G.arc = function (c, r, a0, a1, stepDeg) {
    const n = Math.max(1, Math.ceil(Math.abs(a1 - a0) / G.deg(stepDeg || 10)));
    const pts = [];
    for (let i = 0; i <= n; i++) {
      const a = a0 + (a1 - a0) * i / n;
      pts.push({ x: c.x + r * Math.cos(a), y: c.y + r * Math.sin(a) });
    }
    return pts;
  };

  function dedupe(pts) {
    const out = [];
    for (const p of pts) {
      const q = out[out.length - 1];
      if (!q || Math.abs(q.x - p.x) > 1e-9 || Math.abs(q.y - p.y) > 1e-9) out.push(p);
    }
    if (out.length > 2 && G.dist(out[0], out[out.length - 1]) < 1e-9) out.pop();
    return out;
  }

  // Форма листа по результатам расчёта развёртки.
  // fracs[i] — доля выполненного гиба i (0 — плоско, 1 — готово).
  // Возвращает средную линию, контур и данные по каждому гибу.
  G.sheetShape = function (an, fracs, S, Ri) {
    const segs = an.segs, bends = an.bends;
    const rm = Ri + S / 2; // радиус средней линии в гибе
    let p = { x: 0, y: 0 };
    let d = G.deg(segs[0].dir);
    const mid = [{ p, d }];
    const arcs = [];
    for (let i = 0; i < segs.length; i++) {
      const L = Math.max(0, segs[i].straight);
      p = { x: p.x + L * Math.cos(d), y: p.y + L * Math.sin(d) };
      mid.push({ p, d });
      if (i < bends.length) {
        const bt = G.deg(bends[i].beta);
        const sg = bt >= 0 ? 1 : -1;          // +1 — поворот влево (против часовой)
        // Длина дуги сохраняется: недогнутый гиб — дуга большего радиуса той же длины
        const b = sg * Math.max(1e-4, Math.abs(bt * (fracs ? fracs[i] : 1)));
        const La = Math.abs(bt) * rm;
        const r = La / Math.abs(b);
        const n0 = N(d);
        const c = { x: p.x + sg * r * n0.x, y: p.y + sg * r * n0.y }; // центр гиба
        const steps = Math.max(1, Math.ceil(Math.abs(b) / G.deg(6)));
        for (let s = 1; s <= steps; s++) {
          const ds = d + b * s / steps, n = N(ds);
          mid.push({ p: { x: c.x - sg * r * n.x, y: c.y - sg * r * n.y }, d: ds });
        }
        const nm = N(d + b / 2);
        // up — направление от вершины гиба к центру (внутренняя сторона); ri — текущий внутр. радиус
        arcs.push({ center: c, up: { x: sg * nm.x, y: sg * nm.y }, sign: sg, ri: r - S / 2 });
        d += b;
        p = mid[mid.length - 1].p;
      }
    }
    // Смещаем среднюю линию на ±S/2: сторона A — слева по ходу, B — справа
    const h = S / 2, A = [], B = [];
    for (const m of mid) {
      const n = N(m.d);
      A.push({ x: m.p.x + h * n.x, y: m.p.y + h * n.y });
      B.push({ x: m.p.x - h * n.x, y: m.p.y - h * n.y });
    }
    return {
      mid: mid.map(m => m.p), A, B,
      poly: dedupe(A.concat(B.slice().reverse())),
      arcs, start: mid[0].p, end: mid[mid.length - 1].p
    };
  };

  // Контур пуансона (схема «гусак» по образцу WIRKEN).
  // Ось нагрузки x=0 проходит через кромку; самая нижняя точка кромки — (0,0).
  // Слева размеры фиксированы: край пуансона в 7 мм левее оси, хвостовик 13 мм начинается в 6 мм правее оси.
  // Справа задаются: общая толщина W (от левого края), толщина шеи T, толщина носика t.
  G.PUNCH_FIX = { XL: -6, TL: 7, TW: 13, TH: 30 };   // край 6 мм левее оси, хвостовик 7 мм правее оси
  // type: 'goose' — справа общая толщина W и фаска; 'straight' — правая грань идёт от хвостовика прямо вниз под 90°.
  // Прямой пуансон (по фото): хвостовик и правая грань — одна плоскость (x = 20 от оси),
  // левый край в 6 мм от оси, с левой стороны плечико, скос 45° и шейка (выемка), внизу носик
  // расширяется обратно к левому краю и сходится к кромке. Кромка симметрична: грани по ±угол/2.
  G.straightShape = function (pp) {
    const { XL, TL, TW, TH } = G.PUNCH_FIX;
    const xF = XL, xT = TL + TW;                               // левый край (−6) и плоская сторона (20)
    const a = G.deg(Math.max(10, Math.min(170, pp.angle))) / 2;
    const r = Math.max(0, pp.r);
    const Hb = Math.max(40, pp.Hb);
    const T = Math.max(3, Math.min(pp.T || 17, xT - xF));      // толщина шеи — от плоской стороны
    let xN = xT - T;                                           // левая грань шеи
    const sh0 = 10;                                            // высота левого плечика
    const yB = -xF / Math.tan(a);                              // носик доходит до левого края
    let yNb = yB + (xN - xF);                                  // низ шеи (скос 45° внутрь)
    let yNt = Hb - sh0 - (xN - xF);                            // верх шеи (скос 45° от плечика)
    if (yNt - yNb < 2) { xN = xF; yNb = yB; yNt = Hb - sh0; }  // выемке не хватает места — без неё
    const yRf = Math.min(Hb - 1, xT / Math.tan(a));            // правая грань носика доходит до плоской стороны
    const cy = r / Math.sin(a), lift = cy - r;
    const tip = r > 0 ? G.arc({ x: 0, y: cy }, r, -Math.PI + a, -a, 8) : [{ x: 0, y: 0 }];
    const n0 = Math.min(5, TH * 0.2), n1 = Math.min(13, TH * 0.6);
    const left = [{ x: xF, y: Hb }, { x: xF, y: Hb - sh0 }, { x: xN, y: yNt }, { x: xN, y: yNb }, { x: xF, y: yB }];
    const body = tip.concat([{ x: xT, y: yRf }, { x: xT, y: Hb }], left);
    const tang = [{ x: TL, y: Hb }, { x: xT, y: Hb }, { x: xT, y: Hb + n0 }, { x: xT - 3, y: Hb + n0 },
      { x: xT - 3, y: Hb + n1 }, { x: xT, y: Hb + n1 }, { x: xT, y: Hb + TH }, { x: TL, y: Hb + TH }];
    const outline = tip.concat([{ x: xT, y: yRf }, { x: xT, y: Hb + n0 }, { x: xT - 3, y: Hb + n0 },
      { x: xT - 3, y: Hb + n1 }, { x: xT, y: Hb + n1 }, { x: xT, y: Hb + TH }, { x: TL, y: Hb + TH }, { x: TL, y: Hb }], left);
    const shf = pts => dedupe(G.translate(pts, 0, -lift));
    return {
      poly: shf(body), tang: shf(tang), outline: shf(outline),
      H: Hb - lift, Htot: Hb + TH - lift, tangH: TH, tangCx: TL + TW / 2,
      goose: false, x0: xF, x1: xT, width: xT - xF, xNL: xN, xR: xT, T: xT - xN, t: 0, tL: 0, tR: 0, TL, TW, TR: xT,
      noseL: 0, ht: 0, htL: 0, htR: 0,
      yNbL: yNb - lift, yNbR: yRf - lift, yNT: yNt - lift, yRT: Hb - lift
    };
  };

  G.punchShape = function (pp) {
    const goose = pp.type !== 'straight';
    if (!goose) return G.straightShape(pp);
    const { XL, TL } = G.PUNCH_FIX;
    const TW = G.PUNCH_FIX.TW;                            // ширина хвостовика — постоянная
    const TR = TL + TW;                                   // правый край хвостовика
    const a = G.deg(Math.max(10, Math.min(170, pp.angle))) / 2;
    const r = Math.max(0, pp.r);
    const t = Math.max(1, pp.t || 8);                     // толщина носика у кромки
    const Hb = Math.max(40, pp.Hb);                       // высота без хвостовика
    const tangH = G.PUNCH_FIX.TH;                         // длина хвостовика — постоянная
    const xR = goose ? Math.max(XL + pp.W, TR + 2) : TR;   // правая грань; у прямого — заподлицо с хвостовиком
    const T = Math.max(3, Math.min(pp.T, xR - XL));
    const xNL = xR - T;                                   // левая грань шеи
    // Кончик: слева от оси tL, справа tR. У гусака tL задаётся, у прямого справа от кромки 0 (заподлицо)
    const tL = goose ? (pp.tL > 0 ? Math.min(Math.max(0.3, pp.tL), t - 0.3) : t / 2) : t / 2;
    const tR = goose ? t - tL : 0;
    const htL = tL / Math.tan(a), htR = tR / Math.tan(a);
    const ht = Math.max(htL, htR);                        // высота клина кромки
    const hs = Math.min(20, Hb * 0.15);                   // высота левого плечика
    const ySL = Hb - hs;
    const yNT = ySL - Math.max(0, xNL - XL) * 0.5;        // верх шеи слева (скос выемки ~27°)
    const c = goose ? Math.max(0, Math.min(15, xR - TR - 1)) : 0;   // фаска справа сверху (у прямого нет)
    const yRT = Hb - c;
    // Низ шеи: правая грань носика под 45°, левая — под 30° от вертикали
    let dR = Math.max(0, xR - tR);
    // Длина носика — левая грань от кромки до начала шеи: задаёт, где начинается выемка
    const noseL = pp.noseL > 0 ? pp.noseL : Math.hypot(xNL, htL + Math.abs(xNL + tL) / Math.tan(G.deg(30)));
    let dL = Math.max(1, Math.sqrt(Math.max(0, noseL * noseL - xNL * xNL)) - htL);
    const k = Math.min(1, (yRT - 2 - htR) / Math.max(dR, 1e-6), (yNT - 2 - htL) / Math.max(dL, 1e-6));
    if (k < 1) { dR *= Math.max(0.05, k); dL *= Math.max(0.05, k); }
    const yNbR = htR + dR, yNbL = htL + dL;

    // Скругление кромки радиусом r
    const cy = r / Math.sin(a);
    const lift = cy - r;
    let tip = r > 0 ? G.arc({ x: 0, y: cy }, r, -Math.PI + a, -a, 8) : [{ x: 0, y: 0 }];
    const rx = r * Math.cos(a) + 0.01;                    // полуширина скругления у кромки
    const wR = tR > rx ? [{ x: tR, y: htR }] : [];
    const wL = tL > rx ? [{ x: -tL, y: htL }] : [];

    const body = tip.concat([
      ...wR, { x: xR, y: yNbR }, { x: xR, y: yRT }, { x: xR - c, y: Hb },
      { x: XL, y: Hb }, { x: XL, y: ySL }, { x: xNL, y: yNT }, { x: xNL, y: yNbL }, ...wL]);
    // Хвостовик с пазом безопасности справа
    const n0 = Math.min(5, tangH * 0.2), n1 = Math.min(13, tangH * 0.6);
    const tang = [{ x: TL, y: Hb }, { x: TR, y: Hb }, { x: TR, y: Hb + n0 }, { x: TR - 3, y: Hb + n0 },
      { x: TR - 3, y: Hb + n1 }, { x: TR, y: Hb + n1 }, { x: TR, y: Hb + tangH }, { x: TL, y: Hb + tangH }];
    // Общий контур для чертежа и 3D
    const outline = tip.concat([
      ...wR, { x: xR, y: yNbR }, { x: xR, y: yRT }, { x: xR - c, y: Hb },
      { x: TR, y: Hb }, { x: TR, y: Hb + n0 }, { x: TR - 3, y: Hb + n0 }, { x: TR - 3, y: Hb + n1 }, { x: TR, y: Hb + n1 },
      { x: TR, y: Hb + tangH }, { x: TL, y: Hb + tangH }, { x: TL, y: Hb },
      { x: XL, y: Hb }, { x: XL, y: ySL }, { x: xNL, y: yNT }, { x: xNL, y: yNbL }, ...wL]);
    const sh = pts => dedupe(G.translate(pts, 0, -lift));
    return {
      poly: sh(body), tang: sh(tang), outline: sh(outline),
      H: Hb - lift, Htot: Hb + tangH - lift, tangH, tangCx: TL + TW / 2,
      goose, x0: XL, x1: xR, width: xR - XL, xNL, xR, T, t, tL, tR, TL, TW, TR, noseL: Math.hypot(xNL, yNbL),
      ht: ht - lift, htL: htL - lift, htR: htR - lift,
      yNbL: yNbL - lift, yNbR: yNbR - lift, yNT: yNT - lift, yRT: yRT - lift
    };
  };

  // Контур матрицы: низ на baseY, верх на baseY+H, ось V по x=0.
  G.dieShape = function (dd, baseY) {
    const top = baseY + dd.H;
    const a = G.deg(Math.max(20, Math.min(170, dd.angle))) / 2;
    const rd = Math.max(0.1, dd.r);
    const V = dd.V, W = Math.max(dd.W, V + 2 * rd + 2);
    const c = { x: V / 2, y: top - rd };
    const tp = { x: c.x - rd * Math.cos(a), y: c.y + rd * Math.sin(a) };
    const vy = tp.y - (tp.x / Math.sin(a)) * Math.cos(a);   // дно V
    const bottomY = Math.max(vy, baseY + 2);
    const right = G.arc(c, rd, Math.PI / 2, Math.PI - a, 10);           // от верха к грани V
    const left = G.arc({ x: -c.x, y: c.y }, rd, a, Math.PI / 2, 10);    // зеркально
    const pts = [{ x: -W / 2, y: baseY }, { x: W / 2, y: baseY }, { x: W / 2, y: top }]
      .concat(right, [{ x: 0, y: bottomY }], left, [{ x: -W / 2, y: top }]);
    return { poly: dedupe(pts), top, vDepth: top - vy, shoulder: c, rd, a, W };
  };

  LG.G = G;
})();
