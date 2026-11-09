// Симуляция гибки: расстановка листа в станке, проверка столкновений,
// подбор последовательности гибов.
(function () {
  const G = LG.G;

  // ctx: { an, S, Ri, punch (параметры), punchMirror, die (параметры), machine }
  function Sim(ctx) {
    this.ctx = ctx;
    const m = ctx.machine;
    this.dieBase = m.padH;
    this.die = G.dieShape(ctx.die, m.padH);
    this.dieTop = this.die.top;
    this.pad = G.rect(-m.padW / 2, 0, m.padW / 2, m.padH);
    this.table = [{ x: -70, y: 0 }, { x: 70, y: 0 }, { x: 70, y: -35 }, { x: 30, y: -35 }, { x: 30, y: -400 },
      { x: -30, y: -400 }, { x: -30, y: -35 }, { x: -70, y: -35 }];
    const ps = G.punchShape(ctx.punch);
    this.punchLocal = ctx.punchMirror ? G.mirrorX(ps.poly) : ps.poly;
    this.punchInfo = ps;
    this.tangLocal = ctx.punchMirror ? G.mirrorX(ps.tang) : ps.tang;
    this.tangCx = ctx.punchMirror ? -ps.tangCx : ps.tangCx;   // зажим держит хвостовик
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
      center: { x: 0, y: ty }, tipY: ty - ri
    };
  };

  // Инструмент в положении носика tipY
  Sim.prototype.tools = function (tipY) {
    const m = this.ctx.machine, H = this.punchInfo.H;
    const hy = tipY + H;
    return {
      punch: G.translate(this.punchLocal, 0, tipY),
      tang: G.translate(this.tangLocal, 0, tipY),
      holder: G.rect(this.tangCx - m.holderW / 2, hy, this.tangCx + m.holderW / 2, hy + m.holderH),
      beam: G.rect(this.tangCx - 45, hy + m.holderH, this.tangCx + 45, hy + m.holderH + 600)
    };
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
    add('зажим пуансона', G.polyHits(pl.poly, t.holder));
    add('балка', G.polyHits(pl.poly, t.beam));
    add('матрица', G.polyHits(pl.poly, this.die.poly, nearShoulder));
    add('подложка', G.polyHits(pl.poly, this.pad));
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
        if (face !== prevFace) notes.push('⟳ Переверните лист (сторона ' + face + ' вверх)');
        if (s.mirror !== prevMirror) notes.push('⇄ Разверните деталь другим краем к упору');
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

  LG.Sim = Sim;
})();
