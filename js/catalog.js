// Общий каталог пуансонов и матриц — одинаковый у всех, кто открывает сайт.
// Позиции каталога нельзя менять в интерфейсе: «+ Копия» переносит позицию в «Мои» для правки.
// id позиций каталога начинаются с «cat_».
//
// Пуансоны каталога wirkenrus.com, построены из параметрических моделей «Гусак» и «Прямой»
// (как если бы размеры выставили на сайте вручную). Размеры — по подписям на чертежах каталога,
// неподписанные (общая толщина, толщина шеи, длина носика) — сняты с чертежей по масштабу A.
// H — полная высота A, Hb = A − 30 (без хвостовика). Ориентация как у остальных пуансонов программы
// (хвостовик правее оси) — зеркально к картинкам каталога.
//   Гусак: W — общая толщина (6 + 7 + 13 + полка), shelf — полка справа от хвостовика, T — толщина шеи,
//          t — толщина носика у кромки (размер у кромки на чертеже), tL — его часть левее оси,
//          noseL — длина носика от кромки до начала шеи.
//   Прямой: T — толщина шеи от плоской стороны, W — общая толщина (26, если не шире).
LG.CATALOG = {
  punches: [
    // --- Гусаки TOP ---
    { id: 'cat_top_205_85_r08', name: 'TOP.205-85-R08', group: 'wirken · Гусаки TOP', type: 'goose', H: 205, Hb: 175, angle: 85, r: 0.8, W: 79, shelf: 53, T: 33, t: 9.5, tL: 4.75, noseL: 87, L: 835 },
    { id: 'cat_top_205_85_r2', name: 'TOP.205-85-R2', group: 'wirken · Гусаки TOP', type: 'goose', H: 205, Hb: 175, angle: 85, r: 2, W: 79, shelf: 53, T: 33, t: 9.5, tL: 4.75, noseL: 87, L: 835 },
    { id: 'cat_goose85_a175', name: 'Гусак 85° A175 (артикул уточнить)', group: 'wirken · Гусаки TOP', type: 'goose', H: 175, Hb: 145, angle: 85, r: 0.8, W: 72.5, shelf: 46.5, T: 27.5, t: 10.7, tL: 5.35, noseL: 89, L: 835 },
    { id: 'cat_top_175_85_r08_s', name: 'TOP.175-85-R08-S', group: 'wirken · Гусаки TOP', type: 'goose', H: 174.5, Hb: 144.5, angle: 85, r: 0.8, W: 66, shelf: 40, T: 28, t: 5.3, tL: 2.65, noseL: 81.5, L: 835 },
    { id: 'cat_top_175_75_r08', name: 'TOP.175-75-R08', group: 'wirken · Гусаки TOP', type: 'goose', H: 175, Hb: 145, angle: 75, r: 0.8, W: 76, shelf: 50, T: 41, t: 12, tL: 6, noseL: 99, L: 835 },
    { id: 'cat_top_175_75_r2', name: 'TOP.175-75-R2', group: 'wirken · Гусаки TOP', type: 'goose', H: 175, Hb: 145, angle: 75, r: 2, W: 76, shelf: 50, T: 41, t: 12, tL: 6, noseL: 99, L: 835 },
    // --- Прямые TOP ---
    { id: 'cat_top_175_60_r08', name: 'TOP.175-60-R08', group: 'wirken · Прямые TOP', type: 'straight', H: 175, Hb: 145, angle: 60, r: 0.8, W: 26, T: 18, t: 7.8, L: 835 },
    { id: 'cat_top_175_60_r2', name: 'TOP.175-60-R2', group: 'wirken · Прямые TOP', type: 'straight', H: 175, Hb: 145, angle: 60, r: 2, W: 26, T: 18, t: 7.8, L: 835 },
    { id: 'cat_top_175_60_r5', name: 'TOP.175-60-R5', group: 'wirken · Прямые TOP', type: 'straight', H: 175, Hb: 145, angle: 60, r: 5, W: 37.5, T: 37.5, t: 0, L: 835 },
    { id: 'cat_top_205_26_r08', name: 'TOP.205-26-R08', group: 'wirken · Прямые TOP', type: 'straight', H: 205, Hb: 175, angle: 26, r: 0.8, W: 26, T: 18, t: 20.6, L: 835 },
    // --- Короткие PK / DK ---
    { id: 'cat_pk_97_90_r06', name: 'PK.97-90-R06', group: 'wirken · Короткие PK / DK', type: 'straight', H: 97, Hb: 67, angle: 90, r: 0.6, W: 26, T: 15, t: 4, L: 835 },
    { id: 'cat_pk_97_90_r08', name: 'PK.97-90-R08', group: 'wirken · Короткие PK / DK', type: 'straight', H: 96.5, Hb: 66.5, angle: 90, r: 0.8, W: 26, T: 19, t: 9, L: 835 },
    { id: 'cat_pk_97_90_r025', name: 'PK.97-90-R025', group: 'wirken · Короткие PK / DK', type: 'straight', H: 96.5, Hb: 66.5, angle: 90, r: 0.25, W: 26, T: 19, t: 9, L: 835 },
    { id: 'cat_pk_114_90_r06', name: 'PK.114-90-R06', group: 'wirken · Короткие PK / DK', type: 'goose', H: 114, Hb: 84, angle: 90, r: 0.6, W: 47.5, shelf: 21.5, T: 30, t: 7, tL: 3.5, noseL: 27.5, L: 835 },
    { id: 'cat_pk_116_90_r08', name: 'PK.116-90-R08', group: 'wirken · Короткие PK / DK', type: 'straight', H: 116, Hb: 86, angle: 90, r: 0.8, W: 26, T: 16.5, t: 9, L: 835 },
    { id: 'cat_dk_116_90_r08', name: 'DK.116-90-R08', group: 'wirken · Короткие PK / DK', type: 'straight', H: 116, Hb: 86, angle: 90, r: 0.8, W: 26, T: 17.5, t: 9.8, L: 835 }
  ],
  // Матрицы — точные контуры из DXF, см. catalog-dies.js
  dies: []
};
