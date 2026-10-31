// Инженерные расчёты: подбор V по таблице, Ri, B, усилие, K-фактор, развёртка.
(function () {
  const T = LG.TABLE, G = LG.G;
  const C = {};

  // Ближайшая строка таблицы по толщине
  C.findRow = function (S) {
    let best = T.rows[0], bd = Infinity;
    for (const r of T.rows) {
      const d = Math.abs(r.S - S);
      if (d < bd) { bd = d; best = r; }
    }
    return { row: best, exact: bd < 1e-6 };
  };

  // Варианты раскрытия V для толщины S (усилие пересчитывается ~S², если S нет в таблице)
  C.vOptions = function (S) {
    const { row } = C.findRow(S);
    const k = (S / row.S) ** 2;
    return row.F.map((f, i) => ({ V: T.V[row.start + i], F: f * k }));
  };

  // «Среднее» значение из доступных вариантов
  C.recommendedV = function (S) {
    const o = C.vOptions(S);
    return o[Math.round((o.length - 1) / 2)].V;
  };

  // Линейная интерполяция столбца таблицы по V
  C.byV = function (V, arr) {
    const X = T.V;
    if (V <= X[0]) return arr[0] * V / X[0];
    if (V >= X[X.length - 1]) return arr[arr.length - 1] * V / X[X.length - 1];
    for (let i = 0; i < X.length - 1; i++) {
      if (V <= X[i + 1]) {
        const t = (V - X[i]) / (X[i + 1] - X[i]);
        return arr[i] + t * (arr[i + 1] - arr[i]);
      }
    }
    return arr[arr.length - 1];
  };

  C.riFor = (V, mat) => C.byV(V, T.Ri) * LG.MATERIALS[mat].r;

  // Коэффициент к B по внутреннему углу (интерполяция таблицы углов)
  C.angleCoef = function (incl) {
    const A = LG.ANGLE_B;
    if (incl <= A[0][0]) return A[0][1];
    if (incl >= A[A.length - 1][0]) return A[A.length - 1][1];
    for (let i = 0; i < A.length - 1; i++) {
      if (incl <= A[i + 1][0]) {
        const t = (incl - A[i][0]) / (A[i + 1][0] - A[i][0]);
        return A[i][1] + t * (A[i + 1][1] - A[i][1]);
      }
    }
    return 1;
  };

  // Усилие на метр, кН/м
  C.forcePerM = function (S, V, mat) {
    const { row, exact } = C.findRow(S);
    const j = T.V.indexOf(V) - row.start;
    let F, src;
    if (T.V.indexOf(V) >= 0 && j >= 0 && j < row.F.length) {
      F = row.F[j] * (S / row.S) ** 2;
      src = exact ? 'по таблице' : 'по таблице, пересчёт ~S²';
    } else {
      F = 1.42 * 420 * S * S / V;   // классическая формула воздушной гибки, Н/мм = кН/м
      src = 'по формуле 1.42·R·S²/V (V вне таблицы)';
    }
    return { F: F * LG.MATERIALS[mat].force, src };
  };

  // K-фактор (положение нейтрального слоя) по DIN 6935: k = 0.65 + 0.5·lg(Ri/S), K = k/2
  C.kFactor = function (Ri, S) {
    const k = 0.65 + 0.5 * Math.log10(Math.max(Ri, 0.01) / S);
    return Math.min(0.5, Math.max(0.2, k / 2));
  };

  // Анализ профиля детали: углы гибов, длины, развёртка, проверки
  C.analyze = function (part, ctx) {
    const S = ctx.S, Ri = ctx.Ri, K = ctx.K;
    const errors = [], warnings = [];
    const segs = part.segs.map(s => ({ dir: +s.dir, len: +s.len }));
    const nb = Math.max(0, segs.length - 1);
    const bends = [];
    for (let i = 0; i < nb; i++) {
      const beta = G.norm180(segs[i + 1].dir - segs[i].dir);
      const abs = Math.abs(beta);
      const b = { i, beta, abs, incl: 180 - abs, warnings: [], errors: [] };
      if (abs < 0.5) b.errors.push('отрезки ' + (i + 1) + ' и ' + (i + 2) + ' в одном направлении — гиба нет, объедините их');
      if (abs > 179.5) b.errors.push('разворот на 180° — это не гиб');
      b.t = (S / 2) * Math.tan(G.deg(abs) / 2);           // от наружной поверхности до средней линии
      b.sb = (Ri + S / 2) * Math.tan(G.deg(abs) / 2);     // отступ до касания дуги
      b.arc = G.deg(abs) * (Ri + K * S);                  // длина нейтрального слоя в гибе
      bends.push(b);
    }
    // Длины до виртуальных вершин по средней линии
    segs.forEach((s, i) => {
      let mid = s.len;
      for (const b of [bends[i - 1], bends[i]]) {
        if (!b) continue;
        if (part.dimMode === 'outer') mid -= b.t;
        else if (part.dimMode === 'inner') mid += b.t;
      }
      s.midLen = mid;
      s.outerLen = s.len + [bends[i - 1], bends[i]].reduce((acc, b) => {
        if (!b) return acc;
        return acc + (part.dimMode === 'outer' ? 0 : part.dimMode === 'inner' ? 2 * b.t : b.t);
      }, 0);
      s.straight = mid - (bends[i - 1] ? bends[i - 1].sb : 0) - (bends[i] ? bends[i].sb : 0);
      if (!(s.len > 0)) errors.push('Отрезок ' + (i + 1) + ': длина должна быть больше 0');
      else if (s.straight < -1e-6) errors.push('Отрезок ' + (i + 1) + ' слишком короткий для радиуса гиба (не хватает ' + (-s.straight).toFixed(2) + ' мм)');
    });
    // Развёртка и положения линий гиба от начала заготовки
    let pos = 0, flat = 0;
    segs.forEach((s, i) => {
      pos += Math.max(0, s.straight);
      if (bends[i]) {
        bends[i].pos = pos + bends[i].arc / 2;
        pos += bends[i].arc;
      }
    });
    flat = pos;
    // Проверка минимальной полки B
    bends.forEach(b => {
      b.Bmin = C.byV(ctx.V, T.B) * C.angleCoef(b.incl);
      const fl = Math.min(segs[b.i].outerLen, segs[b.i + 1].outerLen);
      if (fl + 1e-6 < b.Bmin) b.warnings.push('полка ' + fl.toFixed(1) + ' мм меньше минимальной B=' + b.Bmin.toFixed(1) + ' мм — не ляжет на матрицу V' + ctx.V);
      if (ctx.dieAngle && b.incl < ctx.dieAngle - 0.5) b.errors.push('угол ' + b.incl.toFixed(0) + '° острее угла матрицы ' + ctx.dieAngle + '°');
      if (ctx.punchAngle && b.incl < ctx.punchAngle - 0.5) b.warnings.push('угол ' + b.incl.toFixed(0) + '° острее угла пуансона ' + ctx.punchAngle + '°');
      b.errors.forEach(e => errors.push('Гиб ' + (b.i + 1) + ': ' + e));
      b.warnings.forEach(w => warnings.push('Гиб ' + (b.i + 1) + ': ' + w));
    });
    if (segs.length < 2) warnings.push('Добавьте хотя бы 2 отрезка — иначе гнуть нечего');
    return { segs, bends, flat, errors, warnings };
  };

  LG.C = C;
})();
