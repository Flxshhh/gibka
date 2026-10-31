// 3D-просмотр пуансона: контур вытягивается на длину инструмента (three.js).
(function () {
  function View3D(el) {
    this.el = el;
    this.ok = typeof THREE !== 'undefined';
    if (!this.ok) {
      el.innerHTML = '<p class="muted pad">3D недоступно: не загрузилась библиотека three.js (нужен интернет).</p>';
      return;
    }
    const r = this.renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    r.setPixelRatio(Math.min(2, window.devicePixelRatio || 1));
    el.appendChild(r.domElement);
    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(35, 1, 1, 20000);
    this.scene.add(new THREE.HemisphereLight(0xffffff, 0x8899aa, 0.75));
    const d1 = new THREE.DirectionalLight(0xffffff, 0.75); d1.position.set(1, 2, 1.5); this.scene.add(d1);
    const d2 = new THREE.DirectionalLight(0xffffff, 0.3); d2.position.set(-1.5, -0.5, -1); this.scene.add(d2);
    this.group = new THREE.Group();
    this.scene.add(this.group);
    this.theta = -0.45; this.phi = 1.1; this.radius = 1000; this.target = new THREE.Vector3();
    this.bindControls();
    if (typeof ResizeObserver !== 'undefined') new ResizeObserver(() => this.resize()).observe(el);
  }

  // Простое вращение камеры вокруг детали: тянуть — крутить, колесо/щипок — масштаб
  View3D.prototype.bindControls = function () {
    const c = this.renderer.domElement, pts = new Map();
    let pinch = 0;
    c.style.touchAction = 'none';
    c.addEventListener('pointerdown', e => { c.setPointerCapture(e.pointerId); pts.set(e.pointerId, { x: e.clientX, y: e.clientY }); });
    c.addEventListener('pointermove', e => {
      const p = pts.get(e.pointerId);
      if (!p) return;
      if (pts.size === 1) {
        this.theta -= (e.clientX - p.x) * 0.008;
        this.phi = Math.max(0.1, Math.min(Math.PI - 0.1, this.phi - (e.clientY - p.y) * 0.008));
      } else if (pts.size === 2) {
        const o = [...pts.entries()].find(([k]) => k !== e.pointerId)[1];
        const d = Math.hypot(e.clientX - o.x, e.clientY - o.y);
        if (pinch) this.radius = Math.max(50, this.radius * pinch / d);
        pinch = d;
      }
      pts.set(e.pointerId, { x: e.clientX, y: e.clientY });
      this.render();
    });
    const up = e => { pts.delete(e.pointerId); pinch = 0; };
    c.addEventListener('pointerup', up); c.addEventListener('pointercancel', up);
    c.addEventListener('wheel', e => { e.preventDefault(); this.radius = Math.max(50, this.radius * (e.deltaY > 0 ? 1.1 : 0.9)); this.render(); }, { passive: false });
  };

  // poly — контур в мм (x, y), length — длина пуансона
  View3D.prototype.setShape = function (polys, length, color) {
    if (!this.ok) return;
    while (this.group.children.length) {
      const o = this.group.children.pop();
      o.geometry && o.geometry.dispose();
    }
    const mat = new THREE.MeshStandardMaterial({ color: color || 0x9fb4cf, metalness: 0.35, roughness: 0.45 });
    const edgeMat = new THREE.LineBasicMaterial({ color: 0x2c4f86 });
    polys.forEach(poly => {
      const sh = new THREE.Shape(poly.map(p => new THREE.Vector2(p.x, p.y)));
      const g = new THREE.ExtrudeGeometry(sh, { depth: length, bevelEnabled: false });
      g.translate(0, 0, -length / 2);
      this.group.add(new THREE.Mesh(g, mat));
      this.group.add(new THREE.LineSegments(new THREE.EdgesGeometry(g, 25), edgeMat));
    });
    const box = new THREE.Box3().setFromObject(this.group);
    box.getCenter(this.target);
    const size = box.getSize(new THREE.Vector3()).length();
    this.radius = size * 1.6;
    this.resize();
  };

  View3D.prototype.resize = function () {
    if (!this.ok) return;
    const w = this.el.clientWidth, h = this.el.clientHeight;
    if (!w || !h) return;
    this.renderer.setSize(w, h, false);
    this.renderer.domElement.style.width = '100%';
    this.renderer.domElement.style.height = '100%';
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    this.render();
  };

  View3D.prototype.render = function () {
    if (!this.ok) return;
    const s = Math.sin(this.phi);
    this.camera.position.set(
      this.target.x + this.radius * s * Math.sin(this.theta),
      this.target.y + this.radius * Math.cos(this.phi),
      this.target.z + this.radius * s * Math.cos(this.theta));
    this.camera.lookAt(this.target);
    this.renderer.render(this.scene, this.camera);
  };

  LG.View3D = View3D;
})();
