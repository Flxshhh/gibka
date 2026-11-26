// Кинематическая модель развёртки. Координаты DXF (x,y) лежат в плоскости XZ.
(function () {
  const tol = 0.005;
  const key = p => Math.round(p.x / tol) + ',' + Math.round(p.y / tol);
  const edgeKey = (a, b) => [key(a), key(b)].sort().join(':');
  const cross = (a, b, p) => (b.x-a.x)*(p.y-a.y) - (b.y-a.y)*(p.x-a.x);
  const distance = (a,b) => Math.hypot(a.x-b.x,a.y-b.y);
  const side = (l,p) => cross(l[0],l[1],p) / distance(...l);
  function contains(loop,p) {
    let inside = false;
    loop.forEach((a,i) => {
      const b = loop[(i+1)%loop.length];
      if ((a.y>p.y)!==(b.y>p.y) && p.x < a.x+(p.y-a.y)*(b.x-a.x)/(b.y-a.y)) inside = !inside;
    });
    return inside;
  }

  // Объединяем только соприкасающиеся коллинеарные отрезки одной разметки.
  function axes(lines) {
    const result = [];
    for (const raw of lines) {
      let line = raw.slice().sort((a,b) => a.x-b.x || a.y-b.y);
      if (distance(...line) < tol) continue;
      for (let i=result.length-1; i>=0; i--) {
        const other=result[i];
        if (other.some(p=>Math.abs(side(line,p))>tol)) continue;
        const dx=line[1].x-line[0].x, dy=line[1].y-line[0].y;
        const project=p=>((p.x-line[0].x)*dx+(p.y-line[0].y)*dy)/distance(...line);
        const ends=other.map(project);
        if (Math.min(...ends)>distance(...line)+tol || Math.max(...ends)<-tol) continue;
        const pts=line.concat(other).sort((a,b)=>project(a)-project(b));
        line=[pts[0],pts[3]];
        result.splice(i,1);
      }
      result.push(line);
    }
    return result;
  }

  function split(poly,line) {
    const d=poly.map(p=>side(line,p));
    if (!d.some(x=>x>tol) || !d.some(x=>x< -tol)) return [poly];
    const pos=[], neg=[];
    poly.forEach((p,i)=>{
      const j=(i+1)%poly.length, q=poly[j];
      if (d[i]>=-tol) pos.push(p);
      if (d[i]<=tol) neg.push(p);
      if ((d[i]>tol && d[j]<-tol)||(d[i]<-tol && d[j]>tol)) {
        const t=d[i]/(d[i]-d[j]), mid={x:p.x+t*(q.x-p.x),y:p.y+t*(q.y-p.y)};
        pos.push(mid); neg.push(mid);
      }
    });
    return [pos,neg];
  }

  function topology(flat,lines) {
    if (!lines.length) throw Error('В развёртке нет линий гиба на слое BEND.');
    const loops=flat.contours.map(loop=>loop.map(p=>new THREE.Vector2(p.x,p.y)));
    const outside=loops.filter(loop=>!loops.some(other=>other!==loop && contains(other,loop[0])));
    if (outside.length!==1) throw Error('Для гибки выберите развёртку одной связной детали.');
    const holes=loops.filter(l=>l!==outside[0]), points=outside[0].concat(...holes);
    let cells=THREE.ShapeUtils.triangulateShape(outside[0],holes).map(t=>t.map(i=>points[i]));
    for (const line of lines) cells=cells.flatMap(c=>split(c,line));
    const neighbors=cells.map(()=>[]), pending=new Map(), joints=[];
    cells.forEach((poly,i)=>poly.forEach((a,k)=>{
      const b=poly[(k+1)%poly.length], id=edgeKey(a,b);
      if (!pending.has(id)) {pending.set(id,{i,a,b});return;}
      const other=pending.get(id); pending.delete(id);
      const onSegment=(l,p)=>distance(l[0],p)+distance(l[1],p)<=distance(...l)+tol;
      const hinge=lines.findIndex(l=>Math.abs(side(l,a))<=tol && Math.abs(side(l,b))<=tol &&
        onSegment(l,a) && onSegment(l,b));
      if (hinge>=0) joints.push({hinge,i,j:other.i,a,b});
      else {neighbors[i].push(other.i);neighbors[other.i].push(i);}
    }));
    const owner=[], panels=[];
    for(let i=0;i<cells.length;i++){
      if(owner[i]!=null) continue;
      const id=panels.length, stack=[i], panel={cells:[],edges:[],links:[]}; panels.push(panel);owner[i]=id;
      while(stack.length){
        const n=stack.pop();panel.cells.push(cells[n]);
        for(const j of neighbors[n]) if(owner[j]==null){owner[j]=id;stack.push(j);}
      }
    }
    for(const e of pending.values()) panels[owner[e.i]].edges.push([e.a,e.b]);
    const hinges=lines.map((l,i)=>{
      const pairs=joints.filter(j=>j.hinge===i);
      const ids=[...new Set(pairs.flatMap(j=>[owner[j.i],owner[j.j]]))];
      if(ids.length!==2) throw Error('Г'+(i+1)+': линия должна разделять лист на две полки. Проверьте окончания и пересечения линий BEND.');
      const sample=cells[pairs[0].i].find(p=>Math.abs(side(l,p))>tol);
      if(!sample) throw Error('Не удаётся определить сторону гиба Г'+(i+1));
      const first=owner[pairs[0].i];
      const left=side(l,sample)>0?first:ids.find(id=>id!==first);
      const right=ids.find(id=>id!==left);
      panels[right].links.push({to:left,i,sign:1});panels[left].links.push({to:right,i,sign:-1});
      return {right,left,line:l,segments:pairs.map(j=>[j.a,j.b])};
    });
    if(panels.length!==hinges.length+1) throw Error('Для этой сети пересекающихся линий нельзя построить независимые гибы.');
    return {panels,hinges};
  }

  const vector=p=>new THREE.Vector3(p.x,0,p.y);
  // Два цельных инструмента и один комплект секций 805 мм. Каждую
  // физическую секцию можно использовать лишь один раз в одной установке.
  const stock = [835, 415, 370, 100, 100, 100, 50, 40, 20, 15, 10];
  const assemblies = new Map([[0, []]]);
  for (const length of stock) {
    for (const [sum, pieces] of [...assemblies]) {
      const next = sum + length;
      if (!assemblies.has(next) || assemblies.get(next).length > pieces.length + 1) {
        assemblies.set(next, [...pieces, length]);
      }
    }
  }
  const sizes = [...assemblies.keys()].filter(Boolean).sort((a,b)=>b-a);

  function model(flat, sim, order = null, planOnly = false) {
    const lines=axes(flat.bends), {panels,hinges}=topology(flat,lines);
    const angles = lines.map((_, i) => flat.angles?.[i] ?? 90);
    if (angles.some(a => !Number.isFinite(a) || Math.abs(a) < 0.1 || Math.abs(a) > 175)) {
      throw Error('Проверьте углы поворота в конструкторе детали.');
    }
    const span=Math.max(1,...flat.contours.map(c=>{const b=LG.G.bounds(c);return Math.hypot(b.x1-b.x0,b.y1-b.y0);}));
    const transform=(done,cur,f,mirror)=>{
      const h=hinges[cur], [a,b]=h.line, d=distance(a,b), dx=(b.x-a.x)/d, dz=(b.y-a.y)/d;
      const face=Math.sign(angles[cur]), flip=mirror?-1:1;
      // Приводим текущую ось к Z станка собственным вращением (без отражения сетки).
      const setup=new THREE.Matrix4().set(-dz*flip,0,dx*flip,0, 0,face,0,0,
        -dx*face*flip,0,-dz*face*flip,0, 0,0,0,1);
      setup.multiply(new THREE.Matrix4().makeTranslation(-(a.x+b.x)/2,0,-(a.y+b.y)/2));
      const half=LG.G.deg(Math.abs(angles[cur])*f/2);
      setup.premultiply(new THREE.Matrix4().makeRotationZ(-half*flip));
      const tip=sim.dieTop - sim.ctx.die.V/2*Math.tan(half) + sim.ctx.S/Math.max(0.05,Math.cos(half));
      setup.premultiply(new THREE.Matrix4().makeTranslation(0,tip-sim.ctx.S/(2*Math.cos(half)),0));
      const matrices=[]; matrices[h.right]=setup;
      const stack=[h.right];
      while(stack.length){
        const id=stack.pop();
        for(const link of panels[id].links){
          if(matrices[link.to]) continue;
          const [start,end]=lines[link.i], axis=vector(end).sub(vector(start)).normalize();
          const angle=LG.G.deg(angles[link.i])*(link.i===cur?f:done.includes(link.i)?1:0);
          const rot=new THREE.Matrix4().makeTranslation(start.x,0,start.y)
            .multiply(new THREE.Matrix4().makeRotationAxis(axis,-link.sign*angle))
            .multiply(new THREE.Matrix4().makeTranslation(-start.x,0,-start.y));
          matrices[link.to]=matrices[id].clone().multiply(rot);stack.push(link.to);
        }
      }
      if(matrices.filter(Boolean).length!==panels.length) throw Error('Обнаружены несвязанные панели.');
      return {matrices,tip};
    };
    const toolLength = span * 1.15;
    const count = Math.max(1, Math.floor((toolLength + 50) / 200));
    const centers = Array.from({ length: count }, (_, i) => (i - (count - 1) / 2) * 200);
    const full = [[-toolLength / 2, toolLength / 2]];
    const mounts = centers.map(z => [z - 75, z + 75]);
    // Берём рабочий отрезок в материале, даже если разметка BEND в DXF длиннее.
    const seats = hinges.map((hinge,i) => {
      const [a,b] = lines[i], length = distance(a,b);
      const project = p => ((p.x-a.x)*(b.x-a.x)+(p.y-a.y)*(b.y-a.y))/length - length/2;
      const ends = hinge.segments.flat().map(project);
      const lo = Math.min(...ends), hi = Math.max(...ends);
      const width = hi-lo;
      const fitting = sizes.filter(n => n <= width+1e-6);
      return { width, midpoint:(lo+hi)/2, fitting };
    });
    function assembly(cur, mirror, size) {
      const seat = seats[cur];
      const center = -Math.sign(angles[cur])*(mirror?-1:1)*seat.midpoint;
      let z = center-size/2;
      const pieces = (assemblies.get(size)||[]).map(length => {
        const at = z+length/2; z += length;
        return {length,center:at};
      });
      return {size, pieces, width:seat.width, ranges:size?[[center-size/2,center+size/2]]:[]};
    }
    function clipPlane(poly, value, sign, axis='z') {
      const result = [];
      poly.forEach((a, i) => {
        const b = poly[(i + 1) % poly.length];
        const inside = sign * (a[axis] - value) >= 0;
        if (inside) result.push(a);
        if (inside !== (sign * (b[axis] - value) >= 0)) result.push(a.clone().lerp(b, (value - a[axis]) / (b[axis] - a[axis])));
      });
      return result;
    }
    function contacts(state, punchY, cur, f, setup) {
      const hit = new Set(), t = sim.tools(punchY);
      const angle = 180 - Math.abs(angles[cur]) * f;
      if (sim.ctx.punch.angle > angle + 0.5 || sim.ctx.die.angle > angle + 0.5) hit.add('угол инструмента');
      const tools = [
        ['пуансон', t.punch, setup.ranges], ['пуансон', t.tang, setup.ranges], ['матрица', sim.die.poly, full],
        ['балка', t.beam, full], ...t.holder.map(p => ['держатель', p, mounts]),
        ['подложка', sim.padSection, full], ['переходник', sim.adapter, full], ['стол', sim.table, full]
      ].filter(([, poly]) => poly.length).map(([name,poly,ranges])=>({name,poly,ranges,box:LG.G.bounds(poly)}));
      panels.forEach((panel, i) => {
        const normal = new THREE.Vector3(0,sim.ctx.S/2,0).applyMatrix4(state.matrices[i])
          .sub(new THREE.Vector3().setFromMatrixPosition(state.matrices[i]));
        for (const cell of panel.cells) {
          const mid = cell.map(p => vector(p).applyMatrix4(state.matrices[i]));
          const faces = [mid];
          if (Math.abs(normal.z)>tol) {
            faces.push(mid.map(p=>p.clone().add(normal)),mid.map(p=>p.clone().sub(normal)));
          }
          for (const world of faces) {
            const box = LG.G.bounds(world), zs = world.map(p => p.z);
            const z0 = Math.min(...zs), z1 = Math.max(...zs);
            for (const tool of tools) {
              const {name,poly,ranges} = tool;
              if (hit.has(name) || box.x1 < tool.box.x0 || box.x0 > tool.box.x1 ||
                  box.y1 < tool.box.y0 || box.y0 > tool.box.y1) continue;
              const skip = p => name === 'пуансон' ? Math.hypot(p.x,p.y-punchY) < sim.ctx.Ri+sim.ctx.S+1 :
                name === 'матрица' && Math.abs(p.x)<sim.ctx.die.V/2+sim.ctx.S && p.y>=state.tip-sim.ctx.S-1;
              for (const [lo,hi] of ranges) {
                if (z1 <= lo + 1e-7 || z0 >= hi - 1e-7) continue;
                let face = world;
                if (z0 < lo) face = clipPlane(face,lo,1);
                if (z1 > hi) face = clipPlane(face,hi,-1);
                if (face.length && (LG.G.polyHits(face,poly,skip).length ||
                    face.some(p=>contains(poly,p) && !skip(p)) || poly.some(p=>contains(face,p) && !skip(p)))) {
                  hit.add(name); break;
                }
              }
            }
          }
        }
      });
      return [...hit];
    }
    const choices = new Map();
    const choiceKey = (done,cur,mirror) => [done.slice().sort((a,b)=>a-b).join(','),cur,+mirror].join('|');
    function checkStep(done,cur,mirror) {
      const seat=seats[cur];
      // Если торцы задевают готовую полку, проверяем ближайшую более
      // короткую сборку. Не перебираем произвольно короткие пуансоны.
      const candidates=seat.fitting.slice(0,done.length?2:1);
      if (!candidates.length) candidates.push(0);
      const samples=[0,0.25,0.5,0.75,1].map(f=>({f,state:transform(done,cur,f,mirror)}));
      let best;
      for (const size of candidates) {
        const setup=assembly(cur,mirror,size), hits=new Map();
        if (!size || seat.width > sizes[0]+tol) hits.set('длина', {tool:'недостаточно секций',f:0,angle:true});
        for (const {f,state} of samples) {
          for (const tool of contacts(state,state.tip,cur,f,setup)) {
            if (!hits.has(tool)) hits.set(tool,{tool,f});
          }
        }
        if (!best || hits.size < best.hits.length) best={setup,hits:[...hits.values()]};
        if (!hits.has('пуансон')) break;
      }
      choices.set(choiceKey(done,cur,mirror),best.setup);
      return best.hits;
    }
    // Для развёртки номера из DXF не задают пространственный порядок.
    // Сначала пробуем крайние полки и линии с тем же направлением подачи.
    const directions = lines.map(([a, b]) => Math.atan2(b.y - a.y, b.x - a.x));
    function setupCost(i, previous) {
      const h = hinges[i];
      const interior = Math.min(panels[h.left].links.length, panels[h.right].links.length) - 1;
      if (!previous) return interior;
      const last = previous.bend;
      return interior + Math.abs(Math.sin(directions[i] - directions[last])) +
        (Math.sign(angles[i]) === Math.sign(angles[last]) ? 0 : 1);
    }
    const planner = {
      nb: lines.length,
      faceUp: i => angles[i] >= 0 ? 'A' : 'B',
      checkStep,
      compareNext(a, b, steps) {
        const last = steps[steps.length - 1];
        return setupCost(a, last) - setupCost(b, last) || a - b;
      },
      finish: (steps, auto) => ({ steps, auto, ok: steps.every(s => !s.hits.length) })
    };
    const manual = Array.isArray(order) && order.length===lines.length &&
      new Set(order).size===lines.length && order.every(i=>Number.isInteger(i)&&i>=0&&i<lines.length);
    const plan=LG.Sim.prototype.plan.call(planner,manual?order:null,160);
    if (planOnly) return {plan};
    // Ищем заднюю кромку в полосе каждого пальца на высоте выбранной матрицы.
    // На развёртке с вырезом эти две координаты X могут различаться.
    function gaugeSetup(done, step) {
      const {width, ranges} = step.setup;
      const center = ranges.length ? (ranges[0][0] + ranges[0][1]) / 2 :
        -Math.sign(angles[step.bend]) * (step.mirror ? -1 : 1) * seats[step.bend].midpoint;
      const depth = Math.min(42, width * 0.22);
      const fingers = [-1,1].map(side => ({z:center + side * width * 0.22, depth, stop:null}));
      let retreat = 35;
      let rail;
      for (let sample = 0; sample <= 16; sample++) {
        const pose = transform(done, step.bend, sample / 16, step.mirror);
        panels.forEach((panel,i) => {
          const mat = pose.matrices[i];
          const normal = new THREE.Vector3().setFromMatrixColumn(mat,1).multiplyScalar(sim.ctx.S / 2);
          for (const cell of panel.cells) {
            const mid = cell.map(p => vector(p).applyMatrix4(mat));
            for (const sign of [-1,1]) {
              const surface = mid.map(p => p.clone().addScaledVector(normal, sign));
              const band = clipPlane(clipPlane(surface,sim.dieTop-tol,1,'y'),sim.dieTop+31,-1,'y');
              if (!band.length) continue;
              for (const finger of fingers) {
                const strip = clipPlane(clipPlane(band,finger.z-depth/2,1),finger.z+depth/2,-1);
                if (!strip.length) continue;
                if (!sample) {
                  const nose = clipPlane(strip,sim.dieTop+16,-1,'y');
                  for (const p of nose) if (p.x>0) finger.stop = Math.max(finger.stop ?? 0,p.x);
                } else if (finger.stop != null) {
                  for (const p of strip) retreat = Math.max(retreat,p.x-finger.stop+5);
                }
              }
            }
          }
        });
        if (!sample) rail = Math.max(LG.G.bounds(sim.die.poly.concat(sim.adapter,sim.padSection)).x1+35,
          ...fingers.map(f => (f.stop ?? 0)+45));
      }
      return {fingers,rail,retreat};
    }
    const done=[];
    for (const [k,step] of plan.steps.entries()) {
      step.setup=choices.get(choiceKey(done,step.bend,step.mirror));
      step.gauge = gaugeSetup(done,step);
      step.face = planner.faceUp(step.bend);
      const previous = plan.steps[k-1];
      step.turn = previous ? Math.abs(LG.G.norm180((directions[step.bend]-directions[previous.bend])*180/Math.PI +
        (step.mirror!==previous.mirror?180:0))) : 0;
      step.flip = !!previous && step.face !== previous.face;
      step.notes = [];
      if (step.flip) step.notes.push('Переверните лист');
      if (step.turn>.5) step.notes.push('Поворот на '+Math.round(step.turn)+'°');
      done.push(step.bend);
    }
    return {lines,angles,panels,hinges,span,transform,contacts,toolLength,centers,plan};
  }
  LG.FlatFold={axes,model,vector};
})();

// Проигрыватель пространственной гибки: поверхности строятся один раз,
// на кадре меняются только жёсткие преобразования панелей.
(function () {
  const F=LG.FlatFold;
  function panelMesh(panel,S) {
    const pos=[];
    function tri(a,b,c,ya,yb,yc) { pos.push(a.x,ya,a.y,b.x,yb,b.y,c.x,yc,c.y); }
    for(const poly of panel.cells) for(let i=1;i+1<poly.length;i++){
      tri(poly[0],poly[i],poly[i+1],S/2,S/2,S/2);
      tri(poly[0],poly[i+1],poly[i],-S/2,-S/2,-S/2);
    }
    for(const [a,b] of panel.edges){
      tri(a,b,a,-S/2,-S/2,S/2);tri(a,b,b,S/2,-S/2,S/2);
    }
    const geometry=new THREE.BufferGeometry();
    geometry.setAttribute('position',new THREE.Float32BufferAttribute(pos,3));
    geometry.computeVertexNormals();
    const mesh=new THREE.Mesh(geometry,new THREE.MeshStandardMaterial({color:0x60809d,side:THREE.DoubleSide}));
    mesh.matrixAutoUpdate=false;
    return mesh;
  }

  function rigidBetween(a,b,t){
    const q=new THREE.Quaternion().setFromRotationMatrix(a);
    q.slerp(new THREE.Quaternion().setFromRotationMatrix(b),t);
    const p=new THREE.Vector3().setFromMatrixPosition(a).lerp(new THREE.Vector3().setFromMatrixPosition(b),t);
    return new THREE.Matrix4().compose(p,q,new THREE.Vector3(1,1,1));
  }

  F.scene=function(view,m,sim,report){
    const meshes=m.panels.map(p=>panelMesh(p,sim.ctx.S));
    meshes.forEach(mesh=>view.group.add(mesh));
    const marks = m.hinges.map(hinge => {
      const points = [];
      for (const segment of hinge.segments) {
        for (const y of [-sim.ctx.S / 2, sim.ctx.S / 2]) {
          for (const p of segment) points.push(p.x, y, p.y);
        }
      }
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.Float32BufferAttribute(points, 3));
      const mark = new THREE.LineSegments(g, new THREE.LineBasicMaterial({ color: 0x617489 }));
      meshes[hinge.right].add(mark);
      return mark;
    });
    const steel={color:0xb2bdc8,edges:true}, frame={color:0x687b8f,edges:true};
    const {toolLength, centers} = m;
    view.setPart('table',sim.table,toolLength,frame);
    view.setPart('die',sim.die.poly,toolLength,steel);
    view.setPart('adapter',sim.adapter,toolLength,frame);
    view.setPart('pad',sim.padSection,toolLength,frame);
    const moving=[];
    let segments=[], installed=null;
    function install(setup) {
      if (installed===setup) return;
      for(const part of segments) view.setPart(part.name,null,0);
      segments=[];
      setup.pieces.forEach(({length,center},i)=>{
        for(const [name,poly] of [['punch',sim.punchLocal],['tang',sim.tangLocal]]) {
          const id=name+i, group=view.setPart(id,poly,length,steel,[center]);
          segments.push({name:id,group});
        }
      });
      installed=setup;
    }
    sim.holderSection.slice(0,5).forEach((poly,i)=>moving.push(view.setPart('mount'+i,poly,i===3?toolLength:150,frame,i===3?[0]:centers)));
    const steps=m.plan.steps;
    const rail = view.setPart('gaugeRail', LG.G.rect(0,sim.dieTop-21,24,sim.dieTop),toolLength,
      {color:0xa1a7a8,metal:0});
    const fingerStyle = {color:0x434743,edges:true,edgeColor:0x30332f,metal:0};
    const parked = Math.max(...steps.map(step => step.gauge.rail + step.gauge.retreat));
    let gaugeStep;
    function drawGauge(step,u) {
      const g = step.gauge;
      if (step !== gaugeStep) {
        g.fingers.forEach((f,i) => {
          const poly = f.stop == null ? null : sim.gaugeFinger(f.stop-g.rail,0);
          view.setPart('gauge'+i,poly,f.depth,fingerStyle,[f.z]);
        });
        gaugeStep = step;
      }
      // Подвести к уложенному листу, отвести перед гибом и припарковать перед поворотом.
      let x = g.rail;
      if (u < .25) x += (parked-g.rail)*(1-ease((u-.18)/.07));
      else if (u < .82) x += g.retreat*ease((u-.35)/.05);
      else x += g.retreat+(parked-g.rail-g.retreat)*ease((u-.82)/.18);
      rail.position.x = x;
      g.fingers.forEach((_,i) => {view.parts['gauge'+i].position.x = x;});
    }
    const ease=t=>(1-Math.cos(Math.PI*Math.max(0,Math.min(1,t))))/2;
    function draw(time, spatial=true, picture=false){
      view.sectionView = !spatial;
      const k=Math.min(steps.length-1,Math.floor(time)),u=time-k,s=steps[k];
      const done=steps.slice(0,k).map(step=>step.bend);
      const f=ease((u-.4)/.42);
      const pose=m.transform(done,s.bend,f,s.mirror);
      const open=Math.max(pose.tip+16,Math.min(sim.tipOpen,sim.dieTop+m.span+25));
      const y=pose.tip+(open-pose.tip)*(1-ease((u-.25)/.15)+ease((u-.82)/.18));
      if(k && u<.25){
        const prev=steps[k-1],from=m.transform(done.slice(0,-1),prev.bend,1,prev.mirror);
        const t=u/.25;
        const pivot=rigidBetween(from.matrices[0],pose.matrices[0],ease((t-.25)/.5));
        const transfer=pivot.multiply(pose.matrices[0].clone().invert());
        transfer.elements[12]-=(m.span*.65+30)*Math.sin(Math.PI*t);
        transfer.elements[13]+=m.span*.4*Math.sin(Math.PI*t);
        pose.matrices.forEach(mat=>mat.premultiply(transfer));
      }
      install(s.setup);
      segments.forEach(part=>{part.group.position.y=y;});
      drawGauge(s,picture && f === 0 ? .35 : u);
      const hits = m.contacts(pose,y,s.bend,f,s.setup);
      meshes.forEach((mesh,i)=>{
        mesh.matrix.copy(pose.matrices[i]); mesh.matrixWorldNeedsUpdate=true;
        mesh.material.color.setHex(hits.length ? 0xff3b30 : 0x60809d);
      });
      moving.forEach(group=>{group.position.y=y;});
      marks.forEach((mark,i)=>mark.material.color.setHex(i===s.bend?0xffa500:0x617489));
      view.render();
      const phase=u<.25?(k?'Переустановка':'Укладка'):u<.4?'Подвод пуансона':u<.82?'Гибка':'Возврат';
      report('Шаг '+(k+1)+' из '+steps.length+' · Г'+(s.bend+1)+' · '+phase+
        ' · сторона '+s.face+' вверх'+(s.turn>.5?' · поворот '+Math.round(s.turn)+'°':'')+
        (s.flip?' · переворот':'')+
        (hits.length?' · Столкновение: '+hits.join(', '):''), hits.length > 0);
    }
    draw(0);view.target.set(0,sim.dieTop+m.span*.12,0);view.radius=Math.max(160,m.span*2.1);view.resize();
    return {
      draw,
      clear() {
        for(const part of segments) view.setPart(part.name,null,0);
        for (const object of [...marks, ...meshes]) {
          object.parent.remove(object);
          object.geometry.dispose();
          object.material.dispose();
        }
      }
    };
  };
})();
