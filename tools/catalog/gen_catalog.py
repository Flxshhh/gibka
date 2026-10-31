# Сборка js/catalog.js из обведённых контуров
import json, re
d = json.load(open('/tmp/claude-0/-home-user/6d6ef4b8-e22c-5e53-b936-066f34d11ead/scratchpad/cat/outlines.json'))
# (контур, название (без радиуса, если вариантов несколько), группа, A, угол, радиусы, примечание)
items = [
  ('TOP.205-85-R08', 'TOP.205-85', 'Гусаки TOP', 205, 85, [0.8, 2], ''),
  ('UNNAMED-85', 'Гусак 85° A175 (артикул уточнить)', 'Гусаки TOP', 175, 85, [0.8], 'на скриншоте без названия; A≈175 по пропорциям'),
  ('TOP.175-85-R08-S', 'TOP.175-85-R08-S', 'Гусаки TOP', 174.5, 85, [0.8], ''),
  ('TOP.175-75-R08', 'TOP.175-75', 'Гусаки TOP', 175, 75, [0.8, 2], ''),
  ('TOP.175-60-R08', 'TOP.175-60', 'Прямые TOP', 175, 60, [0.8, 2], ''),
  ('TOP.175-60-R5', 'TOP.175-60-R5', 'Прямые TOP', 175, 60, [5], ''),
  ('TOP.205-26-R08', 'TOP.205-26-R08', 'Прямые TOP', 205, 26, [0.8], ''),
  ('PK.97-90-R06', 'PK.97-90-R06', 'Короткие PK / DK', 97, 90, [0.6], ''),
  ('PK.97-90-R08', 'PK.97-90', 'Короткие PK / DK', 96.5, 90, [0.8, 0.25], ''),
  ('PK.114-90-R06', 'PK.114-90-R06', 'Короткие PK / DK', 114, 90, [0.6], ''),
  ('PK.116-90-R08', 'PK.116-90-R08', 'Короткие PK / DK', 116, 90, [0.8], ''),
  ('DK.116-90-R08', 'DK.116-90-R08', 'Короткие PK / DK', 116, 90, [0.8], ''),
]
rtag = lambda r: 'R0' + ('%g' % r).split('.')[1] if r < 1 else 'R%g' % r
out = []
for key, art, grp, A, ang, radii, note in items:
    r0 = d[key]
    for r in radii:
        nm = art if len(radii) == 1 else art + '-' + rtag(r)
        pid = 'cat_goose85_a175' if 'артикул' in art else 'cat_' + re.sub(r'[^a-z0-9]+', '_', nm.lower()).strip('_')
        out.append(dict(id=pid, name=nm, group=grp, type='custom', H=A, Hb=round(A - 30, 2), angle=ang, r=r,
                        L=835, tangCx=r0['tangCx'], note=note, outline=r0['outline']))
js = ['// Общий каталог пуансонов и матриц — одинаковый у всех, кто открывает сайт.',
      '// Позиции каталога нельзя менять в интерфейсе: «+ Копия» переносит позицию в «Мои» для правки.',
      '// id позиций каталога начинаются с «cat_».',
      '// Пуансоны: контуры обведены по чертежам каталога wirkenrus.com (type: custom). Координаты в мм:',
      '// кромка в (0,0), ось нагрузки вертикально, хвостовик 13×30 правее оси (как у остальных пуансонов программы,',
      '// т.е. зеркально к картинкам каталога). H — полная высота A, Hb = A − 30 (без хвостовика).',
      'LG.CATALOG = {', '  punches: [']
for i, it in enumerate(out):
    o = it.pop('outline')
    head = json.dumps(it, ensure_ascii=False)[:-1]
    js.append('    ' + head + ', "outline": [' + ','.join('[%g,%g]' % (p[0], p[1]) for p in o) + ']}' + (',' if i < len(out) - 1 else ''))
js += ['  ],', '  // Матрицы — пока образцы, заменим позициями каталога', '  dies: [',
       "    { id: 'cat_v12', name: 'V12 86°', V: 12, angle: 86, r: 1.0, H: 60, W: 36 },",
       "    { id: 'cat_v16', name: 'V16 86°', V: 16, angle: 86, r: 1.5, H: 60, W: 40 },",
       "    { id: 'cat_v25', name: 'V25 86°', V: 25, angle: 86, r: 2.5, H: 70, W: 55 },",
       "    { id: 'cat_v40', name: 'V40 86°', V: 40, angle: 86, r: 3.5, H: 80, W: 80 }",
       '  ]', '};', '']
open('/home/user/gibka/js/catalog.js', 'w').write('\n'.join(js))
print(len(out), 'punches;', ' '.join(o['name'] for o in out))
