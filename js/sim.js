// Симуляция гибки: расстановка листа в станке, проверка столкновений,
// подбор последовательности гибов.
(function () {
  const G = LG.G;

  function holderShape(ps, machine, mirror, height) {
    if (height <= 0) return [];
    const outline = ps.tang.length ? ps.tang : ps.outline;
    // У DXF плечико может быть на доли миллиметра выше номинальной Hb.
    const base = ps.H + (ps.custom ? 0.1 : 0);
    const top = ps.H + height;
    if (top <= base) return [];
    const highest = outline.reduce((i, p, j) => p.y > outline[i].y ? j : i, 0);
    const peak = outline[highest];
    if (peak.y <= base) return [G.rect(ps.tangCx - machine.holderW / 2, base, ps.tangCx + machine.holderW / 2, top)]
      .map(poly => mirror ? G.mirrorX(poly) : poly);

    const atY = (a, b, y) => ({ x: a.x + (b.x - a.x) * (y - a.y) / (b.y - a.y), y });
    const side = direction => {
      const points = [peak];
      for (let i = 1; i < outline.length; i++) {
        const p = outline[(highest + direction * i + outline.length) % outline.length];
        if (p.y <= base) {
          points.push(atY(points[points.length - 1], p, base));
          break;
        }
        points.push(p);
      }
      return points.reverse();
    };
    const sides = [side(1), side(-1)].sort((a, b) => a[0].x - b[0].x);
    const [left, right] = sides;
    const bounds = G.bounds(left.concat(right));
    const x0 = Math.min(ps.tangCx - machine.holderW / 2, bounds.x0 - 1);
    const x1 = Math.max(ps.tangCx + machine.holderW / 2, bounds.x1 + 1);
    let parts;
    if (top > peak.y) {
      parts = [[{ x: x0, y: base }, ...left, ...right.slice(0, -1).reverse(),
        { x: x1, y: base }, { x: x1, y: top }, { x: x0, y: top }]];
    } else {
      // Низкий зажим заканчивается до верха хвостовика, поэтому губки раздельные.
      parts = sides.map((points, i) => {
        const end = points.findIndex(p => p.y >= top);
        const edge = atY(points[end - 1], points[end], top);
        const x = i === 0 ? x0 : x1;
        return [{ x, y: base }, ...points.slice(0, end), edge, { x, y: top }];
      });
    }
    return mirror ? parts.map(G.mirrorX) : parts;
  }

  // Сечение из «Держатель пуансона.doc». Начало по посадочному плечу;
  // x = 7..20 мм — гнездо хвостовика. Недоразмеренные скосы сняты с рисунка.
  function punchMountSection(punch, mirror) {
    const profiles = [
      [[7, 0], [-7, 0], [-7, 28], [-20, 28], [-20, 100],
        [7, 100], [7, 130], [20, 130], [20, 116], [16.5, 116],
        [16.5, 104], [20, 104], [20, 32], [7, 32]],
      [[20, 85], [36, 85], [36, 22], [27, 7],
        [22.5, 7], [16.5, 12], [16.5, 14], [20, 14]],
      [[16.5, 109], [30.5, 109], [36.5, 125], [36.5, 161],
        [30.5, 167], [20, 167], [20, 152], [26.5, 152], [26.5, 133], [20, 133], [20, 112], [16.5, 112]],
      [[-20, 100], [-20, 199], [24.5, 212], [24.5, 185],
        [20, 177], [20, 132], [7, 132], [7, 100]],
      [[21.5, 137], [26.5, 137], [26.5, 133], [36.5, 133],
        [36.5, 151], [26.5, 151], [26.5, 147], [21.5, 147]]
    ];
    const offset = punch.tangCx - (G.PUNCH_FIX.TL + G.PUNCH_FIX.TW / 2);
    const parts = profiles.map(poly => poly.map(([x, y]) => ({ x: x + offset, y: punch.H + y })));
    return mirror ? parts.map(G.mirrorX) : parts;
  }

  const adapterWidth = 60, adapterBase = 20, keyWidth = 15, keyHeight = 5;

  // WPM 60: 60 × 20, выступ 15 × 5 на расстоянии 9,5 от левого края, R1 у основания.
  function dieAdapter(die) {
    if (!(die.others?.length || /^(Двухручьевые|Многоручьевые)$/.test(die.group || ''))) return null;
    const outline = die.outline || [];
    const low = outline.length ? Math.min(...outline.map(p => p[1])) : 0;
    // Сечение чуть выше подошвы даёт опорные площадки и промежутки между ними.
    const scanY = low + 0.1;
    const cuts = [];
    const edges = outline.map((a, i) => [a, outline[(i + 1) % outline.length]]);
    for (const [a, b] of edges) {
      if ((a[1] > scanY) !== (b[1] > scanY)) {
        cuts.push(a[0] + (b[0] - a[0]) * (scanY - a[1]) / (b[1] - a[1]));
      }
    }
    cuts.sort((a, b) => a - b);
    const middle = cuts.length ? (cuts[0] + cuts[cuts.length - 1]) / 2 : 0;
    const centers = [];
    for (let i = 1; i + 1 < cuts.length; i += 2) {
      if (cuts[i + 1] - cuts[i] >= keyWidth - 0.1) centers.push((cuts[i] + cuts[i + 1]) / 2);
    }
    centers.sort((a, b) => Math.abs(a - middle) - Math.abs(b - middle));
    centers.push(middle);
    const profile = [
      { x: 0, y: 0 }, { x: adapterWidth, y: 0 }, { x: adapterWidth, y: adapterBase },
      ...G.arc({ x: 24.5, y: 20 }, 1, 0, -3 * Math.PI / 2, 10),
      { x: 24.5, y: adapterBase + keyHeight }, { x: 9.5, y: adapterBase + keyHeight },
      ...G.arc({ x: 9.5, y: 20 }, 1, Math.PI / 2, -Math.PI, 10),
      { x: 0, y: adapterBase }
    ];
    // На каждом общем интервале по X обе границы линейны. Максимум
    // разности высот на его концах задаёт первый контакт без наложения.
    let best;
    for (const center of centers) {
      const poly = G.translate(profile, center - 17, 0);
      let base = edges.length ? adapterBase - low : adapterBase + keyHeight;
      for (let i = 0; i < poly.length; i++) {
        const p = poly[i], q = poly[(i + 1) % poly.length];
        for (const [a, b] of edges) {
          const left = Math.max(Math.min(p.x, q.x), Math.min(a[0], b[0]));
          const right = Math.min(Math.max(p.x, q.x), Math.max(a[0], b[0]));
          if (right - left < 1e-7) continue;
          for (const x of [left, right]) {
            const support = p.y + (q.y - p.y) * (x - p.x) / (q.x - p.x);
            const bottom = a[1] + (b[1] - a[1]) * (x - a[0]) / (b[0] - a[0]);
            base = Math.max(base, support - bottom);
          }
        }
      }
      if (!best || base < best.base - 1e-7) best = { poly, base, seated: base + low <= adapterBase + 0.05 };
    }
    return best;
  }

  function dieBase(die, machine) {
    return dieAdapter(die)?.base ?? machine.padH;
  }

  // Полка адаптера под нижней гранью матрицы и боковые бортики.
  function dieMountSection(poly, machine) {
    if (machine.padH <= 0) return [];
    const base = machine.padH;
    const lip = Math.min(machine.padH * 0.5, (G.bounds(poly).y1 - base) * 0.2);
    const rim = base + lip;
    const seating = poly.filter(p => p.y <= rim);
    poly.forEach((a, i) => {
      const b = poly[(i + 1) % poly.length];
      if ((a.y < rim) !== (b.y < rim)) {
        seating.push({ x: a.x + (b.x - a.x) * (rim - a.y) / (b.y - a.y), y: rim });
      }
    });
    const seat = G.bounds(seating);
    const wall = Math.max(2, machine.padH * 0.28);
    const left = Math.min(-machine.padW / 2, seat.x0 - wall);
    const right = Math.max(machine.padW / 2, seat.x1 + wall);
    return [{ x: left, y: 0 }, { x: right, y: 0 }, { x: right, y: rim },
      { x: seat.x1, y: rim }, { x: seat.x1, y: base }, { x: seat.x0, y: base },
      { x: seat.x0, y: rim }, { x: left, y: rim }];
  }

  // ctx: { an, S, Ri, punch (параметры), punchMirror, die (параметры), machine }
  function Sim(ctx) {
    this.ctx = ctx;
    const m = ctx.machine;
    const adapter = dieAdapter(ctx.die);
    this.dieBase = adapter?.base ?? m.padH;
    this.dieAdapterUnseated = adapter?.seated === false;
    this.die = G.dieShape(ctx.die, this.dieBase);
    this.dieTop = this.die.top;
    this.pad = adapter?.poly ?? G.rect(-m.padW / 2, 0, m.padW / 2, m.padH);
    this.table = [{ x: -70, y: 0 }, { x: 70, y: 0 }, { x: 70, y: -35 }, { x: 30, y: -35 }, { x: 30, y: -400 },
      { x: -30, y: -400 }, { x: -30, y: -35 }, { x: -70, y: -35 }];
    const ps = G.punchShape(ctx.punch);
    this.punchLocal = ctx.punchMirror ? G.mirrorX(ps.poly) : ps.poly;
    this.punchInfo = ps;
    this.tangLocal = ctx.punchMirror ? G.mirrorX(ps.tang) : ps.tang;
    this.tangCx = ctx.punchMirror ? -ps.tangCx : ps.tangCx;   // зажим держит хвостовик
    this.holderLocal = holderShape(ps, m, ctx.punchMirror, m.holderH);
    this.holderSection = punchMountSection(ps, ctx.punchMirror);
    this.padSection = adapter?.poly ?? dieMountSection(this.die.poly, m);
    this.holderView = m.holderH > 70 ? holderShape(ps, m, ctx.punchMirror, 70) : this.holderLocal;
    // Положение носика при полностью открытом прессе
    this.tipOpen = m.D - m.holderH - ps.H;
    this.nb = ctx.an.bends.length;
  }

  // Состояние листа: done — множество выполненных гибов, cur — текущий гиб, f — доля
  Sim.prototype.fracs = function (done, cur, f) {
    const fr = new Array(this.nb).fill(0);
    done.forEach(i => { fr[i] = 1; });
    if (cur != null) fr[cur] = f;
    return fr;
  };

  // Ставит лист так, чтобы гиб cur был над V, внутренней стороной вверх.
  Sim.prototype.place = function (fr, cur, mirror) {
    const { an, S, Ri } = this.ctx;
    const shape = G.sheetShape(an, fr, S, Ri);
    const arc = shape.arcs[cur];
    const rot = Math.PI / 2 - Math.atan2(arc.up.y, arc.up.x);
    const cs = Math.cos(rot), sn = Math.sin(rot);
    // Опора на плечи матрицы: наружная поверхность касается радиуса плеча
    const th = Math.min(G.deg(Math.abs(an.bends[cur].beta) * fr[cur]) / 2, Math.PI / 2 - this.die.a - 0.01);
    const ri = arc.ri, Ro = ri + S, rd = this.die.rd, V2 = this.ctx.die.V / 2;
    const ty = (rd - V2 * Math.sin(th) + (this.dieTop - rd) * Math.cos(th) + Ro) / Math.cos(th);
    const tf = p => {
      const dx = p.x - arc.center.x, dy = p.y - arc.center.y;
      let x = dx * cs - dy * sn;
      const y = dx * sn + dy * cs + ty;
      if (mirror) x = -x;
      return { x, y };
    };
    return {
      poly: shape.poly.map(tf), A: shape.A.map(tf), B: shape.B.map(tf),
      start: tf(shape.start), end: tf(shape.end),
      center: { x: 0, y: ty }, tipY: ty - ri, rotation: rot
    };
  };

  // Инструмент в положении носика tipY
  Sim.prototype.tools = function (tipY) {
    const [body, jaw, upper, beam, screw] = this.mountSection(tipY);
    return {
      punch: G.translate(this.punchLocal, 0, tipY),
      tang: G.translate(this.tangLocal, 0, tipY),
      holder: [body, jaw, upper, screw], beam
    };
  };

  Sim.prototype.mountSection = function (tipY) {
    return this.holderSection.map(poly => G.translate(poly, 0, tipY));
  };

  // Проверка столкновений листа с инструментом и станком
  Sim.prototype.collide = function (pl, tipY) {
    const { S, Ri } = this.ctx;
    const t = this.tools(tipY);
    const V2 = this.ctx.die.V / 2, rd = this.die.rd;
    const tipP = { x: 0, y: pl.tipY };
    const nearTip = p => G.dist(p, tipP) < 2 * Ri + S + 0.6;
    const nearShoulder = p => Math.abs(Math.abs(p.x) - V2) < rd + S + 0.6 && Math.abs(p.y - this.dieTop) < rd + S + 0.6;
    const res = [];
    const add = (name, hits) => { if (hits.length) res.push({ tool: name, hits }); };
    add('пуансон', G.polyHits(pl.poly, t.punch, nearTip));
    add('зажим пуансона', t.holder.flatMap(poly => G.polyHits(pl.poly, poly)));
    add('балка', G.polyHits(pl.poly, t.beam));
    add('матрица', G.polyHits(pl.poly, this.die.poly, nearShoulder));
    add('подложка', G.polyHits(pl.poly, this.padSection));
    add('стол', G.polyHits(pl.poly, this.table));
    return res;
  };

  // Проверка одного шага (гиб cur после done) в нескольких фазах.
  // Пять фаз, а не три: полка может задеть инструмент в середине хода и к концу гиба уже разойтись с ним.
  Sim.prototype.checkStep = function (done, cur, mirror, samples) {
    let all = [];
    // Пуансон с кромкой шире угла гиба этот гиб не сделает (упрётся гранями в лист) — считаем как удар
    const pa = this.ctx.punch && this.ctx.punch.angle, b = this.ctx.an.bends[cur];
    if (!samples && pa > 0 && b && b.incl < pa - 0.5) all.push({ f: 1, tool: 'угол пуансона ' + Math.round(pa) + '° шире гиба ' + Math.round(b.incl) + '°', hits: [], angle: true });
    for (const f of samples || [0, 0.25, 0.5, 0.75, 1]) {
      const pl = this.place(this.fracs(done, cur, f), cur, mirror);
      const c = this.collide(pl, pl.tipY);
      if (c.length) all = all.concat(c.map(x => Object.assign({ f }, x)));
    }
    return all;
  };

  // Сторона листа, которая смотрит вверх при гибе (A — левая по ходу профиля)
  Sim.prototype.faceUp = function (cur) { return this.ctx.an.bends[cur].beta >= 0 ? 'A' : 'B'; };

  // План: порядок гибов + ориентация. order — заданный порядок или null (авто).
  // limit — сколько вариантов перебрать в авто-режиме (порядок гибов × сторона к упору)
  Sim.prototype.plan = function (order, limit) {
    const nb = this.nb;
    if (!nb) return { steps: [], ok: true, auto: !order };
    const self = this;
    const cache = new Map();
    const check = (done, cur, mirror) => {
      const key = done.slice().sort().join(',') + '|' + cur + '|' + mirror;
      if (!cache.has(key)) cache.set(key, self.checkStep(done, cur, mirror));
      return cache.get(key);
    };
    const mkStep = (done, cur, mirror) => ({ bend: cur, mirror, hits: check(done, cur, mirror) });

    if (order) {
      // Порядок задан: ориентацию выбираем без столкновений, предпочитая прежнюю
      const steps = [];
      let prevMirror = false;
      order.forEach((cur, k) => {
        const done = order.slice(0, k);
        const opts = [prevMirror, !prevMirror].map(m => mkStep(done, cur, m));
        const best = opts.find(o => !o.hits.length) || opts.sort((a, b) => a.hits.length - b.hits.length)[0];
        steps.push(best);
        prevMirror = best.mirror;
      });
      return this.finish(steps, false);
    }

    // Авто: поиск в глубину, сначала крайние гибы, без лишних переворотов
    let nodes = 0, found = null;
    const LIMIT = limit || 4000;
    const dfs = (done, steps, prevMirror, prevFace) => {
      if (found || nodes > LIMIT) return;
      if (done.length === nb) { found = steps.slice(); return; }
      const rest = [];
      for (let i = 0; i < nb; i++) if (done.indexOf(i) < 0) rest.push(i);
      // крайние раньше; при равенстве — без переворота листа
      rest.sort((a, b) => {
        const ea = Math.min(a, nb - 1 - a), eb = Math.min(b, nb - 1 - b);
        if (ea !== eb) return ea - eb;
        const fa = self.faceUp(a) === prevFace ? 0 : 1, fb = self.faceUp(b) === prevFace ? 0 : 1;
        return fa - fb || a - b;
      });
      for (const cur of rest) {
        for (const m of [prevMirror, !prevMirror]) {
          nodes++;
          const hits = check(done, cur, m);
          if (hits.length) continue;
          steps.push({ bend: cur, mirror: m, hits });
          dfs(done.concat(cur), steps, m, self.faceUp(cur));
          steps.pop();
          if (found) return;
        }
      }
    };
    dfs([], [], false, this.faceUp(0));
    if (found) return this.finish(found, true);
    const exhaustive = nodes <= LIMIT;   // перебрали всё — значит, без ударов точно нельзя

    // Без столкновений не получилось — жадно минимизируем
    const steps = [];
    const done = [];
    let prevMirror = false;
    while (done.length < nb) {
      let best = null;
      for (let i = 0; i < nb; i++) {
        if (done.indexOf(i) >= 0) continue;
        for (const m of [prevMirror, !prevMirror]) {
          const s = mkStep(done, i, m);
          if (!best || s.hits.length < best.hits.length) best = s;
        }
      }
      steps.push(best); done.push(best.bend); prevMirror = best.mirror;
    }
    const res = this.finish(steps, true);
    res.exhaustive = exhaustive;
    return res;
  };

  // Дополняет шаги подсказками для оператора
  Sim.prototype.finish = function (steps, auto) {
    let prevFace = null, prevMirror = null;
    const done = [];
    steps.forEach((s, k) => {
      const face = this.faceUp(s.bend);
      const notes = [];
      if (k === 0) notes.push('Положите лист стороной ' + face + ' вверх');
      else {
        if (face !== prevFace) notes.push('Переверните лист (сторона ' + face + ' вверх)');
        if (s.mirror !== prevMirror) notes.push('Разверните деталь другим краем к упору');
      }
      // Какой край к упору и где упор
      const pl = this.place(this.fracs(done, s.bend, 0), s.bend, s.mirror);
      const endBack = pl.end.x > pl.start.x;
      const back = endBack ? 'конец (отрезок ' + this.ctx.an.segs.length + ')' : 'начало (отрезок 1)';
      let stop = null;
      const lim = this.dieTop + this.ctx.S + 1.5;
      for (const p of pl.poly) if (p.x > 0 && p.y <= lim && (stop === null || p.x > stop)) stop = p.x;
      // Анимация несогнутых гибов идёт по средней линии; для упора нужна длина по нейтральному слою
      if (stop != null) {
        const { an, S, K } = this.ctx;
        const d = j => G.deg(Math.abs(an.bends[j].beta)) * S * (0.5 - (K || 0.5));
        let corr = d(s.bend) / 2;
        an.bends.forEach((b, j) => {
          if (done.indexOf(j) < 0 && j !== s.bend && (endBack ? j > s.bend : j < s.bend)) corr += d(j);
        });
        stop -= corr;
      }
      s.face = face; s.notes = notes; s.backEdge = back;
      s.stop = stop != null && stop > this.ctx.die.V / 2 ? stop : null;
      s.tipContact = pl.tipY;
      prevFace = face; prevMirror = s.mirror;
      done.push(s.bend);
    });
    const ok = steps.every(s => !s.hits.length);
    return { steps, ok, auto };
  };

  Sim.dieBase = dieBase;
  LG.Sim = Sim;
})();
