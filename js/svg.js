// Помощники для рисования SVG. В мире y вверх, в SVG — вниз: y инвертируется при выводе.
(function () {
  const SV = {};
  const f = n => (Math.round(n * 1000) / 1000).toString();

  SV.d = function (pts, closed) {
    if (!pts.length) return '';
    let s = 'M' + f(pts[0].x) + ' ' + f(-pts[0].y);
    for (let i = 1; i < pts.length; i++) s += 'L' + f(pts[i].x) + ' ' + f(-pts[i].y);
    return s + (closed ? 'Z' : '');
  };

  SV.path = (pts, cls, closed = true, extra = '') =>
    '<path class="' + cls + '" d="' + SV.d(pts, closed) + '" ' + extra + '/>';

  SV.line = (a, b, cls) =>
    '<line class="' + cls + '" x1="' + f(a.x) + '" y1="' + f(-a.y) + '" x2="' + f(b.x) + '" y2="' + f(-b.y) + '"/>';

  SV.text = (p, s, fs, cls = 'dim-t', anchor = 'middle', rot = 0) =>
    '<text class="' + cls + '" x="' + f(p.x) + '" y="' + f(-p.y) + '" font-size="' + f(fs) + '" text-anchor="' + anchor +
    '" dominant-baseline="middle"' + (rot ? ' transform="rotate(' + f(rot) + ' ' + f(p.x) + ' ' + f(-p.y) + ')"' : '') + '>' + s + '</text>';

  SV.circle = (c, r, cls) => '<circle class="' + cls + '" cx="' + f(c.x) + '" cy="' + f(-c.y) + '" r="' + f(r) + '"/>';

  // Размерная линия между p1 и p2, сдвинутая на off влево от направления p1→p2
  SV.dim = function (p1, p2, off, text, fs) {
    const dx = p2.x - p1.x, dy = p2.y - p1.y, L = Math.hypot(dx, dy) || 1;
    const nx = -dy / L * off, ny = dx / L * off;
    const a = { x: p1.x + nx, y: p1.y + ny }, b = { x: p2.x + nx, y: p2.y + ny };
    const ux = dx / L, uy = dy / L, ah = fs * 0.55, aw = fs * 0.22;
    const arrow = (p, s) => {
      const q = { x: p.x + s * ux * ah, y: p.y + s * uy * ah };
      return SV.path([p, { x: q.x - uy * aw, y: q.y + ux * aw }, { x: q.x + uy * aw, y: q.y - ux * aw }], 'dim-a');
    };
    const ext = (p, q) => SV.line(p, { x: q.x + Math.sign(off) * nx / Math.abs(off || 1) * fs * 0.3, y: q.y + Math.sign(off) * ny / Math.abs(off || 1) * fs * 0.3 }, 'dim-e');
    let ang = -Math.atan2(dy, dx) * 180 / Math.PI;
    if (ang > 90) ang -= 180; if (ang < -90) ang += 180;
    const m = { x: (a.x + b.x) / 2 + nx / Math.abs(off || 1) * fs * 0.6, y: (a.y + b.y) / 2 + ny / Math.abs(off || 1) * fs * 0.6 };
    return ext(p1, a) + ext(p2, b) + SV.line(a, b, 'dim-l') + arrow(a, 1) + arrow(b, -1) + SV.text(m, text, fs, 'dim-t', 'middle', ang);
  };

  // viewBox по габаритам (в мировых координатах) с полями
  SV.viewBox = function (b, pad) {
    const w = b.x1 - b.x0 + 2 * pad, h = b.y1 - b.y0 + 2 * pad;
    return f(b.x0 - pad) + ' ' + f(-b.y1 - pad) + ' ' + f(w) + ' ' + f(h);
  };

  SV.fmt = (n, d = 1) => {
    const s = (+n).toFixed(d);
    return s.indexOf('.') >= 0 ? s.replace(/\.?0+$/, '') : s;
  };

  LG.SV = SV;
})();
