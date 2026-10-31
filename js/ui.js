// Интерфейс приложения: состояние, вкладки, формы, отрисовка, плеер симуляции.
(function () {
  const C = LG.C, G = LG.G, SV = LG.SV;
  const $ = (s, r = document) => r.querySelector(s);
  const $$ = (s, r = document) => Array.from(r.querySelectorAll(s));
  const esc = s => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const clone = o => JSON.parse(JSON.stringify(o));
  const uid = p => p + Math.random().toString(36).slice(2, 9);
  const uniq = a => a.filter((x, i) => a.indexOf(x) === i);
  const fmt = SV.fmt;

  // ---------- Хранилище ----------
  const KEY = 'lg.v1.';
  function load(k, def) {
    try { const v = localStorage.getItem(KEY + k); return v ? JSON.parse(v) : clone(def); } catch (e) { return clone(def); }
  }
  function store(k, v) { try { localStorage.setItem(KEY + k, JSON.stringify(v)); } catch (e) { /* без хранилища тоже работаем */ } }

  const ST = {
    punches: load('punches', LG.DEFAULT_PUNCHES),
    dies: load('dies', LG.DEFAULT_DIES),
    machine: Object.assign(clone(LG.DEFAULT_MACHINE), load('machine', {})),
    parts: load('parts', []),
    part: Object.assign(clone(LG.DEFAULT_PART), load('part', {})),
    ui: Object.assign({ tab: 'part', pview: 'draw', segMode: 'straight', segAngle: 45, segLen: 20, editPunch: null, editDie: null }, load('ui', {}))
  };
  // Пуансоны старого формата (до схемы WIRKEN) заменяем стандартными
  ST.punches = ST.punches.filter(p => p.Hb > 0 && p.W > 0);
  if (!ST.punches.length) ST.punches = clone(LG.DEFAULT_PUNCHES);
  // Толщину носика заменили длиной носика: переносим текущую форму в новый параметр
  ST.punches.forEach(p => {
    if (!(p.t > 0)) p.t = 8;
    if (!(p.tL > 0)) p.tL = p.t / 2;
    p.H = +(p.Hb + G.PUNCH_FIX.TH).toFixed(3);          // хвостовик постоянный: 30 мм
    p.shelf = +(p.W + G.PUNCH_FIX.XL - G.PUNCH_FIX.TL - G.PUNCH_FIX.TW).toFixed(3);
    delete p.tw; delete p.tangH;
    if (!p.type) {
      // Раньше все были «гусаками»; где шея во всю ширину — это прямой, ширину считаем от края хвостовика
      p.type = p.T < p.W ? 'goose' : 'straight';
    }
    // Прямой по фото: шея 17 мм (раньше шея была во всю ширину 26)
    if (p.type === 'straight') { p.W = 26; if (!(p.T < 26)) p.T = 17; }
    if (!(p.noseL > 0)) p.noseL = Math.round(G.punchShape(p).noseL);
  });
  // Один раз: сохранённый «Прямой …» (его могли переключить в гусак) делаем прямым по фото
  // и ставим первым — от него делаются копии. Название, высоты, угол, R и длину не трогаем.
  if (!ST.ui.migStraightPhoto) {
    ST.punches.forEach(p => {
      if (p.id === 'p_straight' || /^\s*прям/i.test(p.name || '')) { p.type = 'straight'; p.W = 26; p.T = 17; }
    });
    const i = ST.punches.findIndex(p => p.type === 'straight');
    if (i > 0) ST.punches.unshift(ST.punches.splice(i, 1)[0]);
    ST.ui.migStraightPhoto = true;
    try {
      localStorage.setItem(KEY + 'punches', JSON.stringify(ST.punches));
      localStorage.setItem(KEY + 'ui', JSON.stringify(ST.ui));
    } catch (e) { /* без хранилища — просто применится при следующем открытии */ }
  }

  let saveTimer = null;
  function saveAll() {
    clearTimeout(saveTimer);
    saveTimer = setTimeout(() => {
      store('punches', ST.punches); store('dies', ST.dies); store('machine', ST.machine);
      store('parts', ST.parts); store('part', ST.part); store('ui', ST.ui);
    }, 200);
  }

  function toast(msg) {
    const t = $('#toast');
    t.textContent = msg; t.classList.add('show');
    clearTimeout(toast.tm); toast.tm = setTimeout(() => t.classList.remove('show'), 2000);
  }

  // Подтверждение вторым нажатием (системные окна подтверждения на странице Claude не работают)
  function armed(btn, text) {
    if (btn.dataset.armed === '1') { btn.dataset.armed = ''; btn.textContent = btn.dataset.orig; return true; }
    btn.dataset.orig = btn.textContent; btn.dataset.armed = '1'; btn.textContent = text;
    setTimeout(() => { if (btn.dataset.armed === '1') { btn.dataset.armed = ''; btn.textContent = btn.dataset.orig; } }, 3000);
    return false;
  }

  // ---------- Контекст расчёта ----------
  function autoDie(V) {
    return { id: 'auto', name: 'Авто V' + V, V, angle: 86, r: Math.round(Math.max(0.6, V * 0.09) * 10) / 10,
      H: Math.max(50, Math.round(V * 0.9 + 35)), W: Math.round(V + 2 * Math.max(10, V * 0.45)) };
  }

  function resolve() {
    const p = ST.part;
    const S = Math.max(0.1, +p.S || 1);
    const punch = ST.punches.find(x => x.id === p.punchId) || ST.punches[0];
    const opts = C.vOptions(S);
    let die, V;
    if (p.dieId === 'auto' || !ST.dies.find(d => d.id === p.dieId)) {
      if (p.V && !opts.some(o => o.V === p.V)) p.V = null;
      V = p.V || C.recommendedV(S);
      die = autoDie(V);
    } else {
      die = ST.dies.find(d => d.id === p.dieId);
      V = die.V;
    }
    const riTable = C.riFor(V, p.material);
    const Ri = p.riOverride > 0 ? +p.riOverride : Math.max(riTable, punch ? punch.r : 0);
    const K = p.kOverride > 0 ? +p.kOverride : C.kFactor(Ri, S);
    const force = C.forcePerM(S, V, p.material);
    const an = C.analyze(p, { S, Ri, K, V, dieAngle: die.angle, punchAngle: punch && punch.angle });
    const fullKN = force.F * (+p.L || 0) / 1000;
    return { S, punch, die, V, opts, riTable, Ri, K, force, fullKN, ton: fullKN / 9.81, an,
      B90: C.byV(V, LG.TABLE.B), auto: p.dieId === 'auto' || die.id === 'auto' };
  }

  // ---------- Поле с кнопками − / + ----------
  function stepper(obj, key, val, step, min, dec, label, cls) {
    return '<div class="field' + (cls ? ' ' + cls : '') + '">' + (label ? '<label>' + label + '</label>' : '') +
      '<div class="stepper" data-obj="' + obj + '" data-key="' + key + '" data-step="' + step + '" data-min="' + min + '" data-dec="' + dec + '">' +
      '<button type="button" data-d="-1" aria-label="меньше">−</button>' +
      '<input type="number" inputmode="decimal" step="any" value="' + fmt(val, dec) + '">' +
      '<button type="button" data-d="1" aria-label="больше">+</button></div></div>';
  }

  function target(obj) {
    if (obj === 'part') return ST.part;
    if (obj === 'machine') return ST.machine;
    if (obj === 'ui') return ST.ui;
    if (obj === 'punch') return ST.punches.find(x => x.id === ST.ui.editPunch);
    if (obj === 'die') return ST.dies.find(x => x.id === ST.ui.editDie);
    if (obj.indexOf('seg:') === 0) return ST.part.segs[+obj.slice(4)];
    return null;
  }

  // После изменения значения — обновить то, что от него зависит
  function onValue(obj, key) {
    saveAll();
    if (obj === 'punch') {
      // Длина хвостовика связана с высотами: H = высота без хвостовика + длина хвостовика
      const pu = curPunch();
      if (pu) {
        const F = G.PUNCH_FIX, base = -F.XL + F.TL + F.TW;   // 6 + 7 + 13
        // Хвостовик постоянный (30 мм): общая высота = без хвостовика + 30
        if (key === 'H') pu.Hb = +(pu.H - F.TH).toFixed(3);
        else if (key === 'Hb') pu.H = +(pu.Hb + F.TH).toFixed(3);
        // Общая толщина = 6 + 7 + 13 + полка справа
        if (key === 'shelf') pu.W = +(base + pu.shelf).toFixed(3);
        else if (key === 'W') pu.shelf = +(pu.W - base).toFixed(3);
        ['H', 'Hb', 'W', 'shelf'].forEach(k => {
          if (k === key) return;
          const inp = $('.stepper[data-obj="punch"][data-key="' + k + '"] input');
          if (inp) inp.value = fmt(pu[k], 1);
        });
      }
      renderPunchView(); renderPunchSide();
    }
    else if (obj === 'die' || obj === 'machine') renderDieView();
    else if (obj === 'part' || obj.indexOf('seg:') === 0) {
      if (ST.ui.tab === 'part') renderPartOutputs();
      if (ST.ui.tab === 'sim') renderSimOutputs();
    }
  }

  document.addEventListener('click', e => {
    const b = e.target.closest('.stepper button');
    if (!b) return;
    const st = b.parentElement, inp = $('input', st);
    const step = +st.dataset.step, min = +st.dataset.min, dec = +st.dataset.dec;
    let v = (+inp.value || 0) + step * (+b.dataset.d);
    v = Math.max(min, Math.round(v / step) * step);
    v = +v.toFixed(Math.max(dec, 3));
    inp.value = fmt(v, dec);
    const t = target(st.dataset.obj);
    if (t) { t[st.dataset.key] = v; onValue(st.dataset.obj, st.dataset.key); }
  });
  document.addEventListener('input', e => {
    const st = e.target.closest('.stepper');
    if (!st) return;
    const v = parseFloat(String(e.target.value).replace(',', '.'));
    if (!isFinite(v) || v < +st.dataset.min) return;
    const t = target(st.dataset.obj);
    if (t) { t[st.dataset.key] = v; onValue(st.dataset.obj, st.dataset.key); }
  });
  document.addEventListener('change', e => {
    const st = e.target.closest('.stepper');
    if (!st) return;
    const t = target(st.dataset.obj);
    if (t) e.target.value = fmt(t[st.dataset.key], +st.dataset.dec);
  });

  // ---------- Вкладки ----------
  function setTab(t) {
    ST.ui.tab = t; saveAll();
    PLAYER.pause();
    $$('.tabs button').forEach(b => b.classList.toggle('on', b.dataset.tab === t));
    $$('.tab').forEach(s => { s.hidden = s.id !== 'tab-' + t; });
    if (t === 'punch') renderPunchTab();
    if (t === 'part') renderPartTab();
    if (t === 'sim') renderSimTab();
    if (t === 'dies') renderDiesTab();
    if (t === 'table') renderTable();
  }

  // =====================================================================
  // ПУАНСОНЫ: список слева, чертёж / 3D, параметры
  // =====================================================================
  const PUNCH_F = [['L', 'Длина пуансона, мм', 5, 10, 0], ['H', 'Общая высота H', 1, 45, 1], ['Hb', 'Высота без хвостовика', 1, 40, 1],
    ['angle', 'Угол кромки, °', 0.5, 10, 1], ['W', 'Общая толщина', 1, 28, 1], ['T', 'Толщина шеи', 0.5, 3, 1],
    ['shelf', 'Полка справа от хвостовика', 1, 2, 1],
    ['tL', 'Ширина кончика слева от оси', 0.5, 0.3, 1], ['noseL', 'Длина носика (слева)', 1, 5, 1], ['r', 'Радиус кромки R', 0.1, 0, 2]];
  let view3d = null;

  function curPunch() {
    if (!ST.punches.find(x => x.id === ST.ui.editPunch)) ST.ui.editPunch = (ST.punches[0] || {}).id;
    return target('punch');
  }

  function renderPunchTab() {
    const pu = curPunch();
    renderPunchSide();
    $('#punchForm').innerHTML = pu
      ? '<div class="field span2"><label>Название</label><input type="text" id="punchName" value="' + esc(pu.name) + '"></div>' +
        '<div class="field span2 muted small">Тип: <b>' + (pu.type === 'straight' ? 'прямой' : 'гусак') + '</b></div>' +
        PUNCH_F.filter(f => pu.type !== 'straight' || ['W', 'shelf', 'tL', 'noseL'].indexOf(f[0]) < 0).map(f => stepper('punch', f[0], pu[f[0]], f[2], f[3], f[4], f[1])).join('')
      : '<p class="muted">Нет пуансонов</p>';
    $$('[data-pview]').forEach(b => b.classList.toggle('on', b.dataset.pview === ST.ui.pview));
    renderPunchView();
  }

  // Мини-эскиз пуансона для списка
  function punchThumb(pu) {
    const ps = G.punchShape(pu);
    return '<svg class="thumb" viewBox="' + SV.viewBox(G.bounds(ps.outline), 4) + '">' + SV.path(ps.outline, 'm-punch') + '</svg>';
  }

  function renderPunchSide() {
    $('#punchSide').innerHTML = ST.punches.map(x =>
      '<button type="button" class="side-item' + (x.id === ST.ui.editPunch ? ' on' : '') + '" data-pick-punch="' + x.id + '">' +
      punchThumb(x) + '<span><b>' + esc(x.name) + '</b><span class="muted small">H' + fmt(x.H, 1) + ' · ' + fmt(x.angle, 1) + '° · R' + fmt(x.r, 2) + ' · ' + fmt(x.W, 1) + ' мм</span></span></button>').join('');
  }

  function punchMass(pu, ps) {
    const area = G.area(ps.outline);
    return area * pu.L * 7.85e-6; // сталь 7.85 г/см³
  }

  function renderPunchView() {
    if (ST.ui.tab !== 'punch') return;
    const pu = curPunch();
    if (!pu) return;
    const ps = G.punchShape(pu);
    $('#punchMass').textContent = 'Ширина ' + fmt(ps.width, 1) + ' мм · длина ' + fmt(pu.L, 0) + ' мм · масса ≈ ' + fmt(punchMass(pu, ps), 1) + ' кг';
    const is3d = ST.ui.pview === '3d';
    $('#punchSvg').toggleAttribute('hidden', is3d); // у SVG нет свойства .hidden
    $('#punch3d').hidden = !is3d;
    $('#punch3dHint').hidden = !is3d;
    if (is3d) {
      if (!view3d) view3d = new LG.View3D($('#punch3d'));
      view3d.setShape([ps.outline], pu.L);
      return;
    }
    // Чертёж с размерами: слева фиксировано 7 + 6 + 13, справа — регулируемые
    const fx = G.PUNCH_FIX, top = ps.Htot, fs = ps.Htot / 18;
    let h = SV.path(ps.outline, 'm-punch');
    h += SV.line({ x: 0, y: -fs * 1.5 }, { x: 0, y: top + fs }, 'axis');
    h += SV.text({ x: -fs * 0.5, y: top + fs * 1.6 }, 'ось', fs * 0.6, 'lbl-s');
    // верхний ряд: 7 | 6 | 13, выше — общая толщина
    const y1 = top + fs * 2.6, y2 = top + fs * 5;
    // у гусака справа от хвостовика есть полка — показываем её длину до правого края
    if (ps.goose && ps.xR - ps.TR > 0.05) h += SV.dim({ x: ps.TR, y: ps.H }, { x: ps.xR, y: ps.H }, y1 - ps.H, fmt(ps.xR - ps.TR, 1), fs * 0.75);
    h += SV.dim({ x: ps.x0, y: ps.H }, { x: ps.x1, y: ps.H }, y2 - ps.H, fmt(ps.width, 1), fs);
    // высоты справа
    h += SV.dim({ x: ps.x1, y: 0 }, { x: ps.x1, y: top }, -(fs * 4.6), 'H ' + fmt(pu.H, 1), fs);
    h += SV.dim({ x: ps.x1, y: 0 }, { x: ps.x1, y: ps.H }, -(fs * 2), 'без хв. ' + fmt(pu.Hb, 1), fs * 0.85);
    // толщина шеи — поперёк самой шеи
    const yn = (Math.max(ps.yNbL, ps.yNbR) + Math.min(ps.yNT, ps.yRT)) / 2;
    h += SV.dim({ x: ps.xNL, y: yn }, { x: ps.xR, y: yn }, 0.01, fmt(ps.T, 1), fs * 0.9);
    // толщина носика у кромки
    // под кромкой (у гусака): ширина кончика слева от оси
    if (ps.goose) h += SV.dim({ x: -ps.tL, y: 0 }, { x: 0, y: 0 }, -fs * 1.5, 'слева ' + fmt(ps.tL, 1), fs * 0.65);
    // толщина носика
    // длина носика — вдоль левой грани от кромки до начала шеи
    if (ps.goose) h += SV.dim({ x: 0, y: 0 }, { x: ps.xNL, y: ps.yNbL }, fs * 1.4, fmt(ps.noseL, 1), fs * 0.85);
    h += SV.text({ x: fs * 2.8, y: fs * 1.4 }, fmt(pu.angle, 1) + '°', fs * 0.9, 'lbl');
    h += SV.line({ x: 0, y: 0 }, { x: -fs * 3, y: -fs * 1.4 }, 'dim-l');
    h += SV.text({ x: -fs * 4.2, y: -fs * 1.6 }, 'R' + fmt(pu.r, 2), fs * 0.8, 'lbl');
    if (ps.xNL > 0) h += SV.text({ x: ps.xNL / 2, y: ps.yNT + fs * 0.2 }, 'выемка ' + fmt(ps.xNL, 1), fs * 0.55, 'lbl-s');
    const b = G.bounds(ps.outline);
    b.x0 -= fs * 5; b.x1 += fs * 6; b.y0 -= fs * 4.6; b.y1 += fs * 6.2;
    $('#punchSvg').setAttribute('viewBox', SV.viewBox(b, 0));
    $('#punchSvg').innerHTML = h;
  }

  function bindPunchTab() {
    const root = $('#tab-punch');
    root.addEventListener('click', e => {
      const pick = e.target.closest('[data-pick-punch]');
      if (pick) { ST.ui.editPunch = pick.dataset.pickPunch; saveAll(); renderPunchTab(); return; }
      const pv = e.target.closest('[data-pview]');
      if (pv) { ST.ui.pview = pv.dataset.pview; saveAll(); renderPunchTab(); return; }
      const t = e.target;
      if (t.id === 'punchNew') {
        const src = curPunch() || LG.DEFAULT_PUNCHES[0];
        const n = Object.assign(clone(src), { id: uid('p_'), name: src.name + ' (копия)' });
        ST.punches.push(n); ST.ui.editPunch = n.id;
      } else if (t.id === 'punchDel') {
        if (ST.punches.length <= 1) { toast('Последний пуансон удалить нельзя'); return; }
        if (!armed(t, 'Точно удалить?')) return;
        ST.punches = ST.punches.filter(x => x.id !== ST.ui.editPunch);
      } else return;
      saveAll(); renderPunchTab();
    });
    root.addEventListener('input', e => {
      if (e.target.id !== 'punchName') return;
      const o = curPunch();
      if (o) { o.name = e.target.value; saveAll(); renderPunchSide(); }
    });
  }

  // =====================================================================
  // КОНСТРУКТОР ДЕТАЛИ
  // =====================================================================
  const STRAIGHT = [[90, '↑', 'вверх'], [180, '←', 'влево'], [0, '→', 'вправо'], [270, '↓', 'вниз']];
  const DIAG = [['ul', '↖', 'вверх-влево'], ['ur', '↗', 'вверх-вправо'], ['dl', '↙', 'вниз-влево'], ['dr', '↘', 'вниз-вправо']];
  const diagDir = (q, a) => ({ ur: a, ul: 180 - a, dl: 180 + a, dr: 360 - a }[q]);

  // Подпись направления: стрелка и угол к горизонтали
  function dirLabel(dir) {
    const d = ((dir % 360) + 360) % 360;
    const s = STRAIGHT.find(x => Math.abs(x[0] - d) < 0.01);
    if (s) return s[1] + ' ' + s[2];
    const q = d < 90 ? 'ur' : d < 180 ? 'ul' : d < 270 ? 'dl' : 'dr';
    const a = d < 90 ? d : d < 180 ? 180 - d : d < 270 ? d - 180 : 360 - d;
    const g = DIAG.find(x => x[0] === q);
    return g[1] + ' ' + fmt(a, 1) + '° ' + g[2];
  }

  const PRESETS = {
    'Г-профиль 40×40': [[0, 40], [90, 40]],
    'П-профиль 40×60×40': [[90, 40], [0, 60], [270, 40]],
    'Z-профиль 30×40×30': [[0, 30], [90, 40], [0, 30]],
    'С-профиль с загибами': [[180, 15], [270, 40], [0, 60], [90, 40], [180, 15]],
    'Шляпа (омега)': [[0, 20], [90, 30], [0, 40], [270, 30], [0, 20]]
  };

  function renderPartTab() {
    const p = ST.part, u = ST.ui;
    $('#sheetForm').innerHTML =
      stepper('part', 'S', p.S, 0.1, 0.1, 2, 'Толщина S, мм') +
      '<div class="field"><label>Материал</label><select id="matSel">' +
      Object.keys(LG.MATERIALS).map(k => '<option value="' + k + '"' + (k === p.material ? ' selected' : '') + '>' + LG.MATERIALS[k].name + '</option>').join('') + '</select></div>' +
      stepper('part', 'L', p.L, 10, 1, 0, 'Длина гиба (вдоль линии), мм') +
      '<div class="field"><label>Размеры заданы</label><select id="dimSel">' +
      [['outer', 'по наружной стороне'], ['inner', 'по внутренней стороне'], ['mid', 'по средней линии']]
        .map(o => '<option value="' + o[0] + '"' + (o[0] === p.dimMode ? ' selected' : '') + '>' + o[1] + '</option>').join('') + '</select></div>';

    let h = '<div class="seg-tabs wide2">' +
      '<button type="button" data-segmode="straight" class="' + (u.segMode === 'straight' ? 'on' : '') + '">Без угла</button>' +
      '<button type="button" data-segmode="angle" class="' + (u.segMode === 'angle' ? 'on' : '') + '">С углом</button></div>';
    h += stepper('ui', 'segLen', u.segLen, 1, 0.1, 2, 'Длина отрезка, мм');
    if (u.segMode === 'angle') {
      h += '<div class="field"><label>Угол к горизонтали</label><div class="chips-sel">' +
        [30, 45, 60].map(a => '<button type="button" data-segangle="' + a + '" class="' + (u.segAngle === a ? 'on' : '') + '">' + a + '°</button>').join('') + '</div></div>';
      h += '<div class="field"><label>Направление — нажмите, чтобы добавить</label><div class="pad4">' +
        DIAG.map(d => '<button type="button" class="big" data-adddiag="' + d[0] + '" title="' + d[2] + '">' + d[1] + '</button>').join('') + '</div></div>';
    } else {
      h += '<div class="field"><label>Направление — нажмите, чтобы добавить</label><div class="pad-cross">' +
        STRAIGHT.map(d => '<button type="button" class="big d' + d[0] + '" data-adddir="' + d[0] + '" title="' + d[2] + '">' + d[1] + '</button>').join('') + '</div></div>';
    }
    h += '<div class="field"><label>Или готовый шаблон</label><select id="presetSel"><option value="">Выбрать…</option>' +
      Object.keys(PRESETS).map(k => '<option>' + k + '</option>').join('') + '</select></div>';
    $('#addForm').innerHTML = h;

    $('#partsForm').innerHTML =
      '<div class="field"><label>Название детали</label><input type="text" id="partName" value="' + esc(p.name || '') + '"></div>' +
      '<div class="row"><button type="button" id="partSave">Сохранить деталь</button><button type="button" class="ghost" id="partNew">Новая пустая деталь</button></div>' +
      (ST.parts.length
        ? '<div class="field"><label>Сохранённые</label><div class="row"><select id="partList">' +
          ST.parts.map((x, i) => '<option value="' + i + '">' + esc(x.name) + '</option>').join('') +
          '</select><button type="button" id="partLoad">Открыть</button><button type="button" class="ghost" id="partDel">Удалить</button></div></div>'
        : '<p class="muted">Сохранённых деталей пока нет.</p>');
    renderPartOutputs();
  }

  // Все направления для выбора у отрезка: 4 прямых + диагонали 30/45/60
  const DIR_OPTS = STRAIGHT.map(d => d[0]).concat([].concat(...DIAG.map(q => [30, 45, 60].map(a => diagDir(q[0], a)))));

  // Курсор — точка детали, куда добавляются новые отрезки (0 — начало, n — конец)
  function cursorPos() {
    const n = ST.part.segs.length, c = ST.ui.cursor;
    return c == null || c > n || c < 0 ? n : c;
  }
  function cursorText() {
    const n = ST.part.segs.length, c = cursorPos();
    if (!n) return 'первый отрезок';
    if (c === n) return 'в конец детали';
    if (c === 0) return 'в начало детали';
    return 'между отрезками ' + c + ' и ' + (c + 1);
  }
  function setCursor(c) {
    ST.ui.cursor = c >= ST.part.segs.length ? null : c;
    saveAll(); renderPartOutputs();
  }

  function renderSegList() {
    const p = ST.part, c = cursorPos();
    const mark = '<div class="ins-mark">＋ новые отрезки добавятся сюда</div>';
    let h = c === 0 && p.segs.length ? mark : '';
    p.segs.forEach((s, i) => {
      const opts = DIR_OPTS.indexOf(((s.dir % 360) + 360) % 360) >= 0 ? DIR_OPTS : DIR_OPTS.concat([s.dir]);
      h += '<div class="seg" data-i="' + i + '"><button type="button" class="seg-n" data-cur="' + (i + 1) + '" title="Достраивать после этого отрезка">' + (i + 1) + '</button>' +
        '<select class="seg-dir" data-segdir="' + i + '" aria-label="Направление отрезка ' + (i + 1) + '">' +
        opts.map(d => '<option value="' + d + '"' + (Math.abs(G.norm180(d - s.dir)) < 0.01 ? ' selected' : '') + '>' + dirLabel(d) + '</option>').join('') + '</select>' +
        stepper('seg:' + i, 'len', s.len, 1, 0.1, 2, '') +
        '<button type="button" class="ghost del" data-del="' + i + '" title="Удалить отрезок">✕</button></div>';
      if (c === i + 1 && c < p.segs.length) h += mark;
    });
    $('#segList').innerHTML = h;
    $('#curInfo').innerHTML = 'Добавлять: <b>' + cursorText() + '</b>' +
      (c < p.segs.length ? ' <button type="button" class="link" data-cur="end">в конец</button>' : '');
  }

  function addSeg(dir) {
    const p = ST.part, len = +ST.ui.segLen;
    if (!(len > 0)) { toast('Задайте длину больше 0'); return; }
    const c = cursorPos();
    // От начала детали отрезок рисуется наружу по стрелке, а в профиле он идёт к старому началу — разворачиваем
    if (c === 0 && p.segs.length) dir = (dir + 180) % 360;
    const prev = p.segs[c - 1], next = p.segs[c];
    const turn = s => s ? Math.abs(G.norm180(dir - s.dir)) : null;
    if ((prev && Math.abs(turn(prev) - 180) < 0.01) || (next && Math.abs(turn(next) - 180) < 0.01)) {
      toast('Развернуть назад на 180° нельзя — это не гиб'); return;
    }
    if (prev && turn(prev) < 0.01) { prev.len = +(prev.len + len).toFixed(3); toast('То же направление — отрезок ' + c + ' удлинён'); }
    else if (next && turn(next) < 0.01) { next.len = +(next.len + len).toFixed(3); toast('То же направление — отрезок ' + (c + 1) + ' удлинён'); }
    else {
      p.segs.splice(c, 0, { dir, len });
      if (ST.ui.cursor != null) ST.ui.cursor = c === 0 ? 0 : c + 1;   // курсор идёт за новым отрезком (в начале остаётся в начале)
    }
    p.order = null;
    saveAll(); renderPartOutputs();
  }

  function renderPartOutputs() {
    if (ST.ui.tab !== 'part') return;
    renderSegList();
    const r = resolve(), an = r.an, p = ST.part;
    renderProfile(r);
    let h = '';
    if (!p.segs.length) h = '<p class="muted">Деталь пока пустая.</p>';
    else {
      h += '<div class="flat-v">Длина заготовки: <b>' + fmt(an.flat, 2) + ' мм</b></div>';
      h += '<div class="muted small">Ri = ' + fmt(r.Ri, 2) + ' мм, K = ' + fmt(r.K, 3) + ' — от матрицы V' + fmt(r.V, 1) + ' (меняется во вкладке «Симуляция»)</div>';
      if (an.bends.length) {
        h += '<div class="muted" style="margin-top:8px">Линии гиба от начала заготовки:</div><div class="chips">' +
          an.bends.map(b => '<span class="chip">Г' + (b.i + 1) + ' · ' + fmt(b.incl, 0) + '° : ' + fmt(b.pos, 2) + ' мм</span>').join('') + '</div>';
        h += flatStrip(an);
      }
      const msgs = an.errors.map(e => '<li class="bad">' + esc(e) + '</li>').concat(an.warnings.map(w => '<li class="warn">' + esc(w) + '</li>'));
      if (msgs.length) h += '<ul class="msgs">' + msgs.join('') + '</ul>';
    }
    $('#partCalc').innerHTML = h;
  }

  // Полоска развёртки с линиями гиба
  function flatStrip(an) {
    if (!(an.flat > 0)) return '';
    const W = 300, k = W / an.flat;
    let s = '<svg class="strip" viewBox="-4 -14 ' + (W + 8) + ' 34"><rect x="0" y="0" width="' + W + '" height="14" class="strip-r"/>';
    an.bends.forEach(b => {
      const x = b.pos * k;
      s += '<line x1="' + x + '" y1="-3" x2="' + x + '" y2="17" class="strip-l"/><text x="' + x + '" y="-6" class="strip-t">Г' + (b.i + 1) + '</text>';
    });
    return s + '</svg>';
  }

  function renderProfile(r) {
    const an = r.an, svg = $('#profileSvg');
    if (!an.segs.length) {
      svg.setAttribute('viewBox', '0 0 300 160');
      svg.innerHTML = '<text x="150" y="70" class="empty-t" text-anchor="middle">Пустая деталь</text>' +
        '<text x="150" y="95" class="empty-s" text-anchor="middle">добавьте первый отрезок кнопками слева</text>';
      return;
    }
    if (an.errors.some(e => /длина должна/.test(e))) { svg.innerHTML = ''; return; }
    const shape = G.sheetShape(an, null, r.S, r.Ri);
    const sharp = [{ x: 0, y: 0 }];
    an.segs.forEach(s => {
      const q = sharp[sharp.length - 1], d = G.deg(s.dir);
      sharp.push({ x: q.x + s.midLen * Math.cos(d), y: q.y + s.midLen * Math.sin(d) });
    });
    const b = G.bounds(shape.poly.concat(sharp));
    const size = Math.max(b.x1 - b.x0, b.y1 - b.y0, 10);
    const fs = size / 16;
    const cx = (b.x0 + b.x1) / 2, cy = (b.y0 + b.y1) / 2;
    let h = SV.path(shape.poly, 'sheet') + SV.path(shape.A, 'faceA', false);
    an.segs.forEach((s, i) => {
      const a = sharp[i], c = sharp[i + 1];
      const m = { x: (a.x + c.x) / 2, y: (a.y + c.y) / 2 };
      const d = G.deg(s.dir), n = { x: -Math.sin(d), y: Math.cos(d) };
      let sgn = (n.x * (cx - m.x) + n.y * (cy - m.y)) > 0 ? -1 : 1;
      if (an.segs.length === 1) sgn = 1;
      const pos = { x: m.x + sgn * n.x * (fs * 1.1 + r.S), y: m.y + sgn * n.y * (fs * 1.1 + r.S) };
      let ang = G.norm180(-s.dir); if (ang > 90) ang -= 180; if (ang < -90) ang += 180;
      h += SV.text(pos, fmt(s.len, 2), fs, 'lbl', 'middle', ang);
    });
    an.bends.forEach((bd, i) => {
      const c = shape.arcs[i].center, up = shape.arcs[i].up;
      h += SV.text({ x: c.x + up.x * fs * 1.3, y: c.y + up.y * fs * 1.3 }, 'Г' + (i + 1) + ' · ' + fmt(bd.incl, 0) + '°', fs * 0.75, 'lbl-b');
    });
    h += SV.text({ x: shape.start.x, y: shape.start.y - fs * 0.9 }, 'начало', fs * 0.6, 'lbl-s');
    // Точки, с которых можно достраивать: начало, каждый изгиб, конец
    const cur = cursorPos();
    sharp.forEach((pt, i) => {
      h += '<g class="vtx' + (i === cur ? ' on' : '') + '" data-vtx="' + i + '"><title>' +
        (i === 0 ? 'Достраивать от начала' : i === sharp.length - 1 ? 'Достраивать от конца' : 'Достраивать от изгиба Г' + i) + '</title>' +
        SV.circle(pt, fs * 0.75, 'vtx-hit') + SV.circle(pt, fs * (i === cur ? 0.42 : 0.28), 'vtx-dot') + '</g>';
    });
    const bb = G.bounds(shape.poly, G.bounds(sharp));
    bb.x0 -= fs * 3; bb.x1 += fs * 3; bb.y0 -= fs * 2.5; bb.y1 += fs * 2.5;
    svg.setAttribute('viewBox', SV.viewBox(bb, 0));
    svg.innerHTML = h;
  }

  function bindPartTab() {
    const root = $('#tab-part');
    root.addEventListener('change', e => {
      const id = e.target.id, p = ST.part;
      if (id === 'matSel') p.material = e.target.value;
      else if (id === 'dimSel') p.dimMode = e.target.value;
      else if (id === 'partName') { p.name = e.target.value; saveAll(); return; }
      else if (e.target.dataset.segdir != null) { p.segs[+e.target.dataset.segdir].dir = +e.target.value; p.order = null; }
      else if (id === 'presetSel') {
        const pr = PRESETS[e.target.value];
        if (pr) { p.segs = pr.map(x => ({ dir: x[0], len: x[1] })); p.order = null; ST.ui.cursor = null; }
        e.target.value = '';
      } else return;
      saveAll(); renderPartOutputs();
    });
    root.addEventListener('click', e => {
      const p = ST.part, t = e.target;
      const q = sel => t.closest(sel);
      if (q('[data-segmode]')) { ST.ui.segMode = q('[data-segmode]').dataset.segmode; saveAll(); renderPartTab(); return; }
      if (q('[data-segangle]')) { ST.ui.segAngle = +q('[data-segangle]').dataset.segangle; saveAll(); renderPartTab(); return; }
      if (q('[data-adddir]')) { addSeg(+q('[data-adddir]').dataset.adddir); return; }
      if (q('[data-adddiag]')) { addSeg(diagDir(q('[data-adddiag]').dataset.adddiag, ST.ui.segAngle)); return; }
      if (q('[data-del]')) {
        const i = +q('[data-del]').dataset.del;
        p.segs.splice(i, 1); p.order = null;
        if (ST.ui.cursor != null && ST.ui.cursor > i) ST.ui.cursor--;
        saveAll(); renderPartOutputs(); return;
      }
      if (q('[data-vtx]')) { setCursor(+q('[data-vtx]').dataset.vtx); return; }
      if (q('[data-cur]')) { const v = q('[data-cur]').dataset.cur; setCursor(v === 'end' ? Infinity : +v); return; }
      if (t.id === 'goBend') {
        const r = resolve();
        if (!r.an.bends.length) { toast('Нужно хотя бы 2 отрезка — иначе гнуть нечего'); return; }
        if (r.an.errors.length) { toast('Сначала исправьте ошибки в детали'); return; }
        setTab('sim');
        $('#simCard').scrollIntoView({ behavior: 'smooth', block: 'start' });
        PLAYER.play();
        return;
      }
      switch (t.id) {
        case 'segUndo': {
          if (!p.segs.length) break;
          const c = cursorPos();
          p.segs.splice(Math.max(0, c - 1), 1); p.order = null;
          if (ST.ui.cursor != null) ST.ui.cursor = Math.max(0, c - 1);
          saveAll(); renderPartOutputs(); break;
        }
        case 'segClear':
          if (!p.segs.length || !armed(t, 'Точно очистить?')) return;
          p.segs = []; p.order = null; ST.ui.cursor = null; saveAll(); renderPartOutputs(); break;
        case 'partSave': {
          const name = ($('#partName').value || 'Деталь').trim();
          p.name = name;
          const i = ST.parts.findIndex(x => x.name === name);
          if (i >= 0) ST.parts[i] = clone(p); else ST.parts.push(clone(p));
          saveAll(); renderPartTab(); toast('Деталь «' + name + '» сохранена');
          break;
        }
        case 'partNew':
          ST.part = Object.assign(clone(LG.DEFAULT_PART), { S: p.S, material: p.material, L: p.L, dimMode: p.dimMode,
            punchId: p.punchId, punchMirror: p.punchMirror, dieId: p.dieId, V: p.V });
          ST.ui.cursor = null; saveAll(); renderPartTab(); break;
        case 'partLoad': {
          const x = ST.parts[+$('#partList').value];
          if (x) { ST.part = Object.assign(clone(LG.DEFAULT_PART), clone(x)); ST.ui.cursor = null; saveAll(); renderPartTab(); toast('Открыта «' + x.name + '»'); }
          break;
        }
        case 'partDel': {
          const i = +$('#partList').value;
          if (ST.parts[i] && armed(t, 'Точно удалить?')) { ST.parts.splice(i, 1); saveAll(); renderPartTab(); }
          break;
        }
      }
    });
  }

  // =====================================================================
  // СИМУЛЯЦИЯ
  // =====================================================================
  let R = null;
  function renderSimTab() {
    const p = ST.part, r = resolve();
    const vSel = r.auto
      ? '<div class="field"><label>Раскрытие V (по таблице для S=' + fmt(r.S, 2) + ')</label><select id="vSel">' +
        '<option value="">Среднее — V' + C.recommendedV(r.S) + '</option>' +
        r.opts.map(o => '<option value="' + o.V + '"' + (p.V === o.V ? ' selected' : '') + '>V' + o.V + ' · ' + fmt(o.F, 0) + ' кН/м</option>').join('') +
        '</select></div>'
      : '';
    $('#toolForm').innerHTML =
      '<div class="field"><label>Пуансон</label><select id="punchSel">' +
      ST.punches.map(x => '<option value="' + x.id + '"' + (x.id === (r.punch && r.punch.id) ? ' selected' : '') + '>' + esc(x.name) + '</option>').join('') + '</select></div>' +
      '<div class="field"><label>Выемка пуансона (гусак)</label><select id="mirSel">' +
      '<option value="0"' + (!p.punchMirror ? ' selected' : '') + '>к оператору</option>' +
      '<option value="1"' + (p.punchMirror ? ' selected' : '') + '>к упору</option></select></div>' +
      '<div class="field"><label>Матрица</label><select id="dieSel"><option value="auto">Авто по таблице</option>' +
      ST.dies.map(x => '<option value="' + x.id + '"' + (x.id === p.dieId ? ' selected' : '') + '>' + esc(x.name) + '</option>').join('') + '</select></div>' +
      vSel +
      stepper('part', 'riOverride', p.riOverride || 0, 0.1, 0, 2, 'Ri вручную, мм (0 — авто)') +
      stepper('part', 'kOverride', p.kOverride || 0, 0.01, 0, 2, 'K-фактор вручную (0 — авто)');
    renderSimOutputs();
  }

  function renderSimOutputs() {
    if (ST.ui.tab !== 'sim') return;
    R = resolve();
    renderCalc();
    buildPlan();
    renderBends();
  }

  const kv = (k, v) => '<div class="k">' + k + '</div><div class="v">' + v + '</div>';
  function renderCalc() {
    const r = R, p = ST.part;
    const over = r.ton > ST.machine.maxTon;
    let h = '<div class="kv">' +
      kv('Лист', fmt(r.S, 2) + ' мм · ' + LG.MATERIALS[p.material].name.split(',')[0]) +
      kv('Матрица', 'V' + fmt(r.V, 1) + ' · ' + fmt(r.die.angle, 0) + '° · R' + fmt(r.die.r, 1) + (r.auto ? ' <span class="muted">(авто)</span>' : '')) +
      kv('Мин. полка B', fmt(r.B90, 1) + ' мм <span class="muted">(90°)</span>') +
      kv('Ri', fmt(r.Ri, 2) + ' мм' + (p.riOverride > 0 ? ' <span class="muted">(вручную)</span>' : ' <span class="muted">(табл. ' + fmt(r.riTable, 2) + ')</span>')) +
      kv('K-фактор', fmt(r.K, 3)) +
      kv('Усилие', fmt(r.force.F, 0) + ' кН/м <span class="muted">(' + r.force.src + ')</span>') +
      kv('На ' + fmt(p.L, 0) + ' мм', '<b class="' + (over ? 'bad' : '') + '">' + fmt(r.fullKN, 1) + ' кН ≈ ' + fmt(r.ton, 1) + ' т</b>' + (over ? ' — больше, чем может пресс (' + ST.machine.maxTon + ' т)' : '')) +
      kv('Заготовка', fmt(r.an.flat, 2) + ' мм') +
      '</div>';
    const msgs = r.an.errors.map(e => '<li class="bad">' + esc(e) + '</li>').concat(r.an.warnings.map(w => '<li class="warn">' + esc(w) + '</li>'));
    if (msgs.length) h += '<ul class="msgs">' + msgs.join('') + '</ul>';
    $('#calcOut').innerHTML = h;
  }

  function renderBends() {
    const pl = PLAYER.plan, an = R.an;
    const box = $('#bendOut');
    if (!an.segs.length) { box.innerHTML = '<p class="muted">Деталь пустая — постройте её во вкладке «Конструктор детали».</p>'; return; }
    if (!an.bends.length) { box.innerHTML = '<p class="muted">Нет гибов — добавьте ещё отрезок в конструкторе.</p>'; return; }
    if (!pl) { box.innerHTML = '<p class="bad">Исправьте ошибки в детали, чтобы построить последовательность.</p>'; return; }
    const auto = !ST.part.order;
    let h = '';
    if (!pl.ok) {
      const bad = pl.steps.filter(s => s.hits.length);
      h += '<div class="alert"><b>⛔ Без удара согнуть не получается.</b><div>' + bad.map(s => 'Гиб Г' + (s.bend + 1) + ' (шаг ' + (pl.steps.indexOf(s) + 1) + ') ударяется: ' + uniq(s.hits.map(x => x.tool)).join(', ')).join('<br>') + '</div>' +
        '<div class="small">' + (auto
          ? (pl.exhaustive ? 'Проверены все порядки гибов и все положения детали (развернуть другим краем к упору, перевернуть лист). Показан вариант с наименьшим числом ударов.'
                           : 'Проверено несколько тысяч вариантов порядка и положения детали — без ударов не нашлось.')
          : 'Это ваш порядок гибов — нажмите «Подобрать авто», чтобы перебрать все варианты.') + '</div>';
      if (PLAYER.alts && PLAYER.alts.length) {
        h += '<div class="alts">Без ударов получится с инструментом: ' + PLAYER.alts.map((a, i) =>
          '<button type="button" class="sm" data-alt="' + i + '">' + esc(a.name) + ' · выемка ' + (a.mirror ? 'к упору' : 'к оператору') + '</button>').join(' ') + '</div>';
      } else if (auto) h += '<div class="small">Ни один пуансон из библиотеки не подходит — нужен другой инструмент или другая деталь.</div>';
      h += '</div>';
    }
    h += '<div class="row between"><div>' + (auto
      ? (pl.ok ? '✅ Порядок подобран автоматически, столкновений нет' : '⚠️ Без столкновений подобрать не удалось — см. красные шаги')
      : (pl.ok ? '✅ Ваш порядок, столкновений нет' : '⚠️ В вашем порядке есть столкновения')) +
      '</div>' + (auto ? '' : '<button type="button" id="orderAuto">Подобрать авто</button>') + '</div>';
    h += '<div class="tbl-wrap"><table class="bends"><thead><tr><th>Шаг</th><th>Гиб</th><th>Угол</th><th>Действие оператора</th><th>Упор</th><th>Статус</th><th></th></tr></thead><tbody>';
    pl.steps.forEach((s, k) => {
      const b = an.bends[s.bend];
      const st = s.hits.length ? '<span class="bad">удар: ' + uniq(s.hits.map(x => x.tool)).join(', ') + '</span>' : '<span class="good">ок</span>';
      h += '<tr class="' + (s.hits.length ? 'row-bad' : '') + '"><td><button type="button" class="link" data-goto="' + k + '">' + (k + 1) + ' ▶</button></td>' +
        '<td>Г' + (s.bend + 1) + '</td><td>' + fmt(b.incl, 0) + '°</td>' +
        '<td>' + s.notes.map(esc).join('<br>') + '<div class="muted">К упору: ' + s.backEdge + '</div></td>' +
        '<td>' + (s.stop != null ? fmt(s.stop, 1) + ' мм' : '—') + '</td><td>' + st + '</td>' +
        '<td class="nowrap"><button type="button" class="ghost sm" data-mv="-1" data-k="' + k + '" title="Раньше">↑</button>' +
        '<button type="button" class="ghost sm" data-mv="1" data-k="' + k + '" title="Позже">↓</button></td></tr>';
    });
    h += '</tbody></table></div><p class="muted small">Упор — расстояние от оси пуансона до точки касания заднего упора. Стрелками ↑↓ можно задать свой порядок.</p>';
    box.innerHTML = h;
  }

  function bindSimTab() {
    const root = $('#tab-sim');
    root.addEventListener('change', e => {
      const id = e.target.id, p = ST.part;
      if (id === 'punchSel') p.punchId = e.target.value;
      else if (id === 'mirSel') p.punchMirror = e.target.value === '1';
      else if (id === 'dieSel') p.dieId = e.target.value;
      else if (id === 'vSel') p.V = e.target.value ? +e.target.value : null;
      else return;
      saveAll(); renderSimTab();
    });
    root.addEventListener('click', e => {
      const p = ST.part;
      if (e.target.id === 'orderAuto') { p.order = null; saveAll(); renderSimOutputs(); return; }
      const alt = e.target.closest('[data-alt]');
      if (alt) {
        const a = PLAYER.alts[+alt.dataset.alt];
        p.punchId = a.id; p.punchMirror = a.mirror; p.order = null;
        saveAll(); renderSimTab(); toast('Пуансон: ' + a.name); return;
      }
      const mv = e.target.closest('[data-mv]');
      if (mv) {
        const order = PLAYER.plan.steps.map(s => s.bend);
        const k = +mv.dataset.k, d = +mv.dataset.mv;
        if (k + d < 0 || k + d >= order.length) return;
        [order[k], order[k + d]] = [order[k + d], order[k]];
        p.order = order; saveAll(); renderSimOutputs(); return;
      }
      const go = e.target.closest('[data-goto]');
      if (go) { PLAYER.seek(+go.dataset.goto * PLAYER.dur); $('#simCard').scrollIntoView({ behavior: 'smooth', block: 'start' }); }
    });
    $('#simPlay').addEventListener('click', () => PLAYER.playing ? PLAYER.pause() : PLAYER.play());
    $('#simPrev').addEventListener('click', () => {
      PLAYER.pause();
      const k = Math.floor(PLAYER.t / PLAYER.dur - 1e-6);
      PLAYER.seek(Math.max(0, (PLAYER.t % PLAYER.dur < 0.05 ? k - 1 : k)) * PLAYER.dur);
    });
    $('#simNext').addEventListener('click', () => {
      PLAYER.pause();
      PLAYER.seek(Math.min(PLAYER.total(), (Math.floor(PLAYER.t / PLAYER.dur + 1e-6) + 1) * PLAYER.dur));
    });
    $('#simSlider').addEventListener('input', e => { PLAYER.pause(); PLAYER.seek(e.target.value / 1000 * PLAYER.total()); });
    $('#simSpeed').addEventListener('change', e => { PLAYER.speed = +e.target.value; });
    $('#simZoom').addEventListener('change', e => {
      PLAYER.zoom = e.target.value;
      if (PLAYER.sim && PLAYER.plan) PLAYER.view = computeView(PLAYER.sim, PLAYER.plan);
      drawFrame();
    });
  }

  // ---------- Плеер ----------
  const PLAYER = {
    sim: null, plan: null, t: 0, dur: 4, playing: false, speed: 1, last: 0, view: null, zoom: 'close',
    total() { return this.plan ? this.plan.steps.length * this.dur : 0; },
    seek(t) { this.t = Math.max(0, Math.min(this.total(), t)); drawFrame(); },
    play() {
      if (!this.plan || !this.plan.steps.length) return;
      if (this.t >= this.total() - 1e-6) this.t = 0;
      this.playing = true; this.last = performance.now(); updateBtn(); requestAnimationFrame(tick);
    },
    pause() { this.playing = false; updateBtn(); }
  };
  function tick(now) {
    if (!PLAYER.playing) return;
    PLAYER.t += Math.max(0, now - PLAYER.last) / 1000 * PLAYER.speed;  // метка кадра может быть раньше нажатия
    PLAYER.last = now;
    if (PLAYER.t >= PLAYER.total()) { PLAYER.t = PLAYER.total(); PLAYER.playing = false; updateBtn(); }
    drawFrame();
    if (PLAYER.playing) requestAnimationFrame(tick);
  }
  function updateBtn() { const b = $('#simPlay'); if (b) b.textContent = PLAYER.playing ? '⏸ Пауза' : '▶ Гнуть'; }

  function buildPlan() {
    const r = R;
    PLAYER.pause();
    if (r.an.errors.length || !r.an.bends.length || !r.punch) { PLAYER.plan = null; PLAYER.sim = null; drawFrame(); return; }
    const sim = new LG.Sim({ an: r.an, S: r.S, Ri: r.Ri, K: r.K, punch: r.punch, punchMirror: !!ST.part.punchMirror, die: r.die, machine: ST.machine });
    let order = ST.part.order;
    if (order && (order.length !== r.an.bends.length || uniq(order).length !== order.length || order.some(i => i >= r.an.bends.length))) order = null;
    PLAYER.sim = sim;
    PLAYER.plan = sim.plan(order);
    PLAYER.alts = PLAYER.plan.ok ? [] : findAlternatives(r);
    PLAYER.t = 0;
    PLAYER.view = computeView(sim, PLAYER.plan);
    drawFrame();
  }

  // Если с текущим инструментом гнуть не получается — пробуем выемку с другой стороны и другие пуансоны
  function findAlternatives(r) {
    const out = [];
    ST.punches.forEach(pu => [false, true].forEach(m => {
      if (pu.id === r.punch.id && m === !!ST.part.punchMirror) return;
      const sim = new LG.Sim({ an: r.an, S: r.S, Ri: r.Ri, K: r.K, punch: pu, punchMirror: m, die: r.die, machine: ST.machine });
      if (sim.plan(null, 1500).ok) out.push({ id: pu.id, name: pu.name, mirror: m });
    }));
    return out;
  }

  function computeView(sim, plan) {
    const m = ST.machine;
    PLAYER.openY = sim.tipOpen;
    if (PLAYER.zoom === 'close') {
      // Крупно: лист, верх матрицы и пуансон целиком; пуансон поднимается ровно настолько, чтобы освободить лист
      let c = { x0: Infinity, y0: Infinity, x1: -Infinity, y1: -Infinity };
      const dn = [];
      let tipMax = -Infinity;
      plan.steps.forEach(s => {
        for (const f of [0, 1]) {
          const pl = sim.place(sim.fracs(dn, s.bend, f), s.bend, s.mirror);
          c = G.bounds(pl.poly, c);
          tipMax = Math.max(tipMax, pl.tipY);
        }
        if (s.stop != null) c = G.bounds([{ x: s.stop + 10, y: sim.dieTop }], c);
        dn.push(s.bend);
      });
      const V = sim.ctx.die.V;
      PLAYER.openY = Math.min(sim.tipOpen, Math.max(c.y1, tipMax) + 15);
      c = G.bounds([{ x: -V, y: sim.dieTop }, { x: V, y: sim.dieTop }], c);
      const t = sim.tools(PLAYER.openY);
      c = G.bounds(t.punch.concat(t.tang), c);
      const size = Math.max(c.x1 - c.x0, c.y1 - c.y0, 30);
      c.y0 = Math.min(c.y0, sim.dieTop - size * 0.12);
      c.y1 += size * 0.08;
      const w2 = (c.x1 - c.x0) * 0.08 + 4;
      c.x0 -= w2; c.x1 += w2;
      return c;
    }
    let b = G.bounds(sim.die.poly);
    b = G.bounds([{ x: -60, y: -30 }, { x: 60, y: -30 }], b);
    const done = [];
    plan.steps.forEach(s => {
      for (const f of [0, 1]) b = G.bounds(sim.place(sim.fracs(done, s.bend, f), s.bend, s.mirror).poly, b);
      done.push(s.bend);
    });
    b.y1 = Math.max(b.y1, sim.tipOpen + sim.punchInfo.H + Math.min(m.holderH, 60));
    b.y0 = Math.min(b.y0, -30);
    const w = b.x1 - b.x0;
    b.x0 -= w * 0.06; b.x1 += w * 0.06;
    return b;
  }

  const ease = x => x < 0 ? 0 : x > 1 ? 1 : x * x * (3 - 2 * x);

  function drawFrame() {
    const svg = $('#simSvg'), hud = $('#simHud'), slider = $('#simSlider');
    const sim = PLAYER.sim, plan = PLAYER.plan;
    if (!sim || !plan || !plan.steps.length) {
      svg.innerHTML = '';
      hud.innerHTML = '<span class="muted">Постройте деталь с хотя бы одним гибом во вкладке «Конструктор детали» — здесь появится гибка.</span>';
      return;
    }
    const n = plan.steps.length, T = PLAYER.total();
    const k = Math.max(0, Math.min(n - 1, Math.floor(PLAYER.t / PLAYER.dur)));
    const u = Math.min(1, (PLAYER.t - k * PLAYER.dur) / PLAYER.dur);
    const s = plan.steps[k];
    const done = plan.steps.slice(0, k).map(x => x.bend);
    let f = 0, tip, slide = 0, phase;
    const contact0 = sim.place(sim.fracs(done, s.bend, 0), s.bend, s.mirror).tipY;
    const contact1 = sim.place(sim.fracs(done, s.bend, 1), s.bend, s.mirror).tipY;
    const open = Math.max(PLAYER.openY || sim.tipOpen, contact0 + 5);
    if (u < 0.15) { phase = 'Укладка листа'; slide = 1 - ease(u / 0.15); tip = open; }
    else if (u < 0.35) { phase = 'Подвод пуансона'; tip = open + (contact0 - open) * ease((u - 0.15) / 0.2); }
    else if (u < 0.8) { phase = 'Гибка'; f = ease((u - 0.35) / 0.45); tip = null; }
    else { phase = 'Возврат'; f = 1; tip = contact1 + (open - contact1) * ease((u - 0.8) / 0.2); }
    const pl = sim.place(sim.fracs(done, s.bend, f), s.bend, s.mirror);
    if (tip == null) tip = pl.tipY;
    const dx = -slide * 120;
    const sheet = G.translate(pl.poly, dx, 0), face = G.translate(s.face === 'A' ? pl.A : pl.B, dx, 0);
    const hits = slide > 0 ? [] : sim.collide(pl, tip);
    const t = sim.tools(tip);
    const hitTools = hits.map(h => h.tool);
    const cls = name => hitTools.indexOf(name) >= 0 ? ' hit' : '';
    const v = PLAYER.view;
    const fs = (v.y1 - v.y0) / 32;

    let h = SV.path(sim.table, 'm-table' + cls('стол')) + SV.path(sim.pad, 'm-pad' + cls('подложка')) +
      SV.path(sim.die.poly, 'm-die' + cls('матрица')) + SV.line({ x: 0, y: v.y0 }, { x: 0, y: v.y1 }, 'axis');
    if (s.stop != null && slide === 0 && u < 0.8) {
      const y = sim.dieTop;
      h += SV.path(G.rect(s.stop, y - fs * 0.4, s.stop + fs * 0.45, y + ST.part.S + fs * 1.2), 'gauge');
      h += SV.text({ x: s.stop + fs * 0.25, y: y - fs * 0.9 }, 'упор ' + fmt(s.stop, 1), fs * 0.6, 'lbl-s');
    }
    h += SV.path(t.beam, 'm-beam' + cls('балка')) + SV.path(t.holder, 'm-holder' + cls('зажим пуансона')) +
      SV.path(t.tang, 'm-tang') + SV.path(t.punch, 'm-punch' + cls('пуансон')) +
      SV.path(sheet, 'sheet' + (hits.length ? ' hit' : '')) + SV.path(face, 'faceUp', false);
    hits.forEach(x => x.hits.forEach(p => { h += SV.circle(p, fs * 0.35, 'hitpt'); }));
    svg.setAttribute('viewBox', SV.viewBox(v, 4));
    svg.innerHTML = h;

    const b = R.an.bends[s.bend];
    hud.innerHTML = '<div class="hud-t">Шаг ' + (k + 1) + ' из ' + n + ' · Гиб Г' + (s.bend + 1) + ' на ' + fmt(b.incl, 0) + '° · <span class="muted">' + phase + '</span></div>' +
      '<div>' + s.notes.map(esc).concat(['к упору ' + s.backEdge]).concat(s.stop != null ? ['упор ' + fmt(s.stop, 1) + ' мм'] : []).join(' · ') + '</div>' +
      (hits.length ? '<div class="bad">Столкновение: ' + uniq(hitTools).join(', ') + '</div>' : '');
    if (slider && document.activeElement !== slider) slider.value = T ? Math.round(PLAYER.t / T * 1000) : 0;
  }

  // =====================================================================
  // МАТРИЦЫ И СТАНОК
  // =====================================================================
  const DIE_F = [['V', 'Раскрытие V', 1, 2, 1], ['angle', 'Угол V, °', 1, 20, 1], ['r', 'Радиус плеча', 0.1, 0.1, 2],
    ['H', 'Высота', 1, 10, 1], ['W', 'Ширина', 1, 10, 1]];
  const MACH_F = [['D', 'Открытая высота (стол → балка)', 5, 100, 0], ['holderH', 'Высота крепления пуансона', 5, 0, 0],
    ['holderW', 'Ширина крепления', 5, 10, 0], ['padH', 'Высота подложки', 1, 0, 0], ['padW', 'Ширина подложки', 5, 10, 0],
    ['maxTon', 'Макс. усилие пресса, т', 5, 1, 0]];

  function renderDiesTab() {
    if (!ST.dies.find(x => x.id === ST.ui.editDie)) ST.ui.editDie = (ST.dies[0] || {}).id;
    const di = target('die');
    $('#dieList').innerHTML = ST.dies.map(x => '<button type="button" class="pill' + (x.id === ST.ui.editDie ? ' on' : '') + '" data-pick-die="' + x.id + '">' + esc(x.name) + '</button>').join('');
    $('#dieForm').innerHTML = di ? '<div class="field span2"><label>Название</label><input type="text" id="dieName" value="' + esc(di.name) + '"></div>' +
      DIE_F.map(f => stepper('die', f[0], di[f[0]], f[2], f[3], f[4], f[1])).join('') : '<p class="muted">Нет матриц</p>';
    $('#machForm').innerHTML = MACH_F.map(f => stepper('machine', f[0], ST.machine[f[0]], f[2], f[3], f[4], f[1])).join('');
    renderDieView();
  }

  function renderDieView() {
    if (ST.ui.tab !== 'dies') return;
    const di = target('die');
    if (!di) return;
    const ds = G.dieShape(di, 0);
    const fs = Math.max(ds.W, di.H) / 14;
    let h = SV.path(ds.poly, 'm-die');
    h += SV.dim({ x: -di.V / 2, y: ds.top }, { x: di.V / 2, y: ds.top }, fs * 1.2, 'V ' + fmt(di.V, 1), fs);
    h += SV.dim({ x: -ds.W / 2, y: 0 }, { x: ds.W / 2, y: 0 }, -fs * 1.4, fmt(ds.W, 1), fs);
    h += SV.dim({ x: ds.W / 2, y: 0 }, { x: ds.W / 2, y: ds.top }, -fs * 1.4, 'H ' + fmt(di.H, 1), fs);
    h += SV.text({ x: 0, y: ds.top - ds.vDepth - fs * 0.9 }, fmt(di.angle, 0) + '°', fs * 0.9, 'lbl');
    h += SV.text({ x: di.V / 2 + fs * 2.2, y: ds.top + fs * 0.6 }, 'R' + fmt(di.r, 2), fs * 0.75, 'lbl');
    const b = G.bounds(ds.poly);
    b.x0 -= fs * 2; b.x1 += fs * 3.5; b.y0 -= fs * 3; b.y1 += fs * 3.5;
    $('#dieSvg').setAttribute('viewBox', SV.viewBox(b, 0));
    $('#dieSvg').innerHTML = h;
  }

  function bindDiesTab() {
    const root = $('#tab-dies');
    root.addEventListener('click', e => {
      const t = e.target;
      if (t.dataset.pickDie) { ST.ui.editDie = t.dataset.pickDie; saveAll(); renderDiesTab(); return; }
      switch (t.id) {
        case 'dieNew': {
          const src = target('die') || LG.DEFAULT_DIES[0];
          const n = Object.assign(clone(src), { id: uid('d_'), name: src.name + ' (копия)' });
          ST.dies.push(n); ST.ui.editDie = n.id; break;
        }
        case 'dieDel':
          if (ST.dies.length <= 1) { toast('Последнюю матрицу удалить нельзя'); return; }
          if (!armed(t, 'Точно удалить?')) return;
          ST.dies = ST.dies.filter(x => x.id !== ST.ui.editDie);
          break;
        case 'exportBtn': exportJSON(); return;
        case 'copyBtn': copyJSON(); return;
        case 'importTextBtn': importText($('#backupText').value); return;
        case 'importBtn': $('#importFile').click(); return;
        case 'resetBtn':
          if (!armed(t, 'Нажмите ещё раз — ваш инструмент удалится')) return;
          ST.punches = clone(LG.DEFAULT_PUNCHES); ST.dies = clone(LG.DEFAULT_DIES); ST.machine = clone(LG.DEFAULT_MACHINE);
          toast('Инструмент и станок сброшены');
          break;
        default: return;
      }
      saveAll(); renderDiesTab();
    });
    root.addEventListener('input', e => {
      if (e.target.id !== 'dieName') return;
      const o = target('die');
      if (o) { o.name = e.target.value; saveAll(); const b = $('#dieList .on'); if (b) b.textContent = o.name; }
    });
    $('#importFile').addEventListener('change', e => {
      const file = e.target.files[0];
      if (!file) return;
      const rd = new FileReader();
      rd.onload = () => { importText(rd.result); e.target.value = ''; };
      rd.readAsText(file);
    });
  }

  // Резервная копия — текстом: скачивание файлов на странице Claude заблокировано
  function exportJSON() {
    const data = { app: 'listogib', version: 1, punches: ST.punches, dies: ST.dies, machine: ST.machine, parts: ST.parts };
    $('#backupText').value = JSON.stringify(data);
    $('#copyBtn').hidden = false;
  }
  function copyJSON() {
    const ta = $('#backupText');
    const fallback = () => { ta.select(); toast('Текст выделен — нажмите Ctrl+C'); };
    try {
      navigator.clipboard.writeText(ta.value).then(() => toast('Скопировано — сохраните текст, например, в заметки'), fallback);
    } catch (err) { fallback(); }
  }
  function importText(txt) {
    try {
      const d = JSON.parse(txt);
      if (Array.isArray(d.punches) && d.punches.length) ST.punches = d.punches;
      if (Array.isArray(d.dies) && d.dies.length) ST.dies = d.dies;
      if (d.machine) ST.machine = Object.assign(clone(LG.DEFAULT_MACHINE), d.machine);
      if (Array.isArray(d.parts)) ST.parts = d.parts;
      saveAll(); renderDiesTab(); toast('Загружено');
    } catch (err) { toast('Не получилось прочитать копию: проверьте, что текст вставлен целиком'); }
  }

  // =====================================================================
  // ТАБЛИЦА
  // =====================================================================
  function renderTable() {
    const T = LG.TABLE, r = resolve();
    const { row } = C.findRow(r.S);
    const vi = T.V.indexOf(r.V);
    let h = '<div class="tbl-wrap"><table class="force"><thead>' +
      '<tr><th>V</th>' + T.V.map((v, i) => '<th class="' + (i === vi ? 'sel' : '') + '">' + v + '</th>').join('') + '</tr>' +
      '<tr><th>B</th>' + T.B.map((v, i) => '<td class="hb' + (i === vi ? ' sel' : '') + '">' + fmt(v, 1) + '</td>').join('') + '</tr>' +
      '<tr><th>Ri</th>' + T.Ri.map((v, i) => '<td class="hb' + (i === vi ? ' sel' : '') + '">' + fmt(v, 1) + '</td>').join('') + '</tr>' +
      '</thead><tbody>';
    T.rows.forEach(rw => {
      h += '<tr class="' + (rw === row ? 'sel-row' : '') + '"><th>' + fmt(rw.S, 1) + '</th>';
      T.V.forEach((v, i) => {
        const j = i - rw.start;
        const val = j >= 0 && j < rw.F.length ? rw.F[j] : '';
        const mid = j === Math.round((rw.F.length - 1) / 2);
        h += '<td class="' + (val !== '' ? 'has' : '') + (mid ? ' mid' : '') + (rw === row && i === vi ? ' pick' : '') + '">' + val + '</td>';
      });
      h += '</tr>';
    });
    $('#tableOut').innerHTML = h + '</tbody></table></div>';
  }

  // ---------- Запуск ----------
  function init() {
    $$('.tabs button').forEach(b => b.addEventListener('click', () => setTab(b.dataset.tab)));
    bindPunchTab(); bindPartTab(); bindSimTab(); bindDiesTab();
    setTab(['punch', 'part', 'sim', 'dies', 'table'].indexOf(ST.ui.tab) >= 0 ? ST.ui.tab : 'part');
  }

  LG.UI = { ST, resolve, PLAYER, setTab };
  document.addEventListener('DOMContentLoaded', init);
})();
