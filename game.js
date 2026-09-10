"use strict";

(() => {
  const canvas = document.getElementById("universe");
  const ctx = canvas.getContext("2d", { alpha: false });
  const ui = Object.fromEntries(["stage", "stage-dot", "stage-size", "mass", "speed", "satellites", "next-stage", "progress-text", "progress", "drive-status", "world-status", "scale", "notice", "end-screen", "end-description", "help-panel", "pause", "orbits", "help"].map(id => [id, document.getElementById(id)]));
  const TYPES = [
    { name: "小行星", min: 0, radius: 2, color: "#a8b5c9", kind: "asteroid" },
    { name: "岩质行星", min: 24, radius: 3, color: "#d58b70", kind: "rock" },
    { name: "冰质行星", min: 60, radius: 3.5, color: "#91e5f6", kind: "ice" },
    { name: "气态巨行星", min: 120, radius: 4, color: "#e5b65f", kind: "gas" },
    { name: "褐矮星", min: 220, radius: 4.5, color: "#a65b80", kind: "star" },
    { name: "红矮星", min: 380, radius: 5, color: "#ff727c", kind: "star" },
    { name: "黄矮星", min: 620, radius: 5.5, color: "#ffda78", kind: "star" },
    { name: "蓝巨星", min: 980, radius: 6, color: "#529dff", kind: "star" },
    { name: "红巨星", min: 1500, radius: 7, color: "#ff864b", kind: "giant" },
    { name: "白矮星", min: 2300, radius: 4, color: "#e6f4ff", kind: "white-dwarf" },
    { name: "中子星", min: 3400, radius: 3, color: "#a28aff", kind: "neutron" },
    { name: "黑洞", min: 5000, radius: 5, color: "#c49aff", kind: "black-hole" }
  ];
  const STEP = 1 / 120, G = 25, SOFTENING = 24, WORLD_RADIUS = 1800;
  let width, height, dpr, bodies, player, particles, stars, nebula;
  let nextId = 1, paused = false, ended = false, showTrails = true;
  let time = 0, lastFrame = 0, accumulator = 0, nextPopulation = 0, nextHud = 0;
  let peakMass = 8, absorbed = 0, shake = 0, noticeUntil = 9;
  const camera = { x: 0, y: 0, zoom: 1, targetZoom: 1 };
  const thrust = { x: 0, y: 0, active: false };
  const random = (a, b) => a + Math.random() * (b - a);
  const clamp = (n, a, b) => Math.max(a, Math.min(b, n));
  const typeOf = mass => {
    for (let i = TYPES.length - 1; i >= 1; i--) if (mass >= TYPES[i].min) return i;
    return 0;
  };

  function updateSize(body) {
    body.type = typeOf(body.mass);
    const base = TYPES[body.type];
    const upper = TYPES[body.type + 1]?.min ?? base.min * 2;
    body.radius = base.radius + clamp((body.mass - base.min) / (upper - base.min), 0, 1) * 0.3;
  }

  function createBody(x, y, mass, vx = 0, vy = 0) {
    const body = { id: nextId++, x, y, px: x, py: y, vx, vy, ax: 0, ay: 0, mass, alive: true, trail: [], trailAt: 0, host: null, cooldown: 0, phase: random(0, Math.PI * 2) };
    updateSize(body);
    bodies.push(body);
    return body;
  }

  function announce(message, duration = 4) {
    ui.notice.textContent = message;
    noticeUntil = time + duration;
    ui.notice.style.opacity = "1";
  }

  function burst(x, y, color, count, strength = 25) {
    for (let i = 0; i < count && particles.length < 650; i++) {
      const angle = random(0, Math.PI * 2), speed = random(3, strength);
      particles.push({ x, y, vx: Math.cos(angle) * speed, vy: Math.sin(angle) * speed, life: random(.3, 1.2), total: 1.2, color });
    }
  }

  function spawnAmbient(initial = false) {
    const angle = random(0, Math.PI * 2);
    const screenRadius = Math.hypot(width, height) / (2 * camera.zoom);
    const distance = initial ? random(180, WORLD_RADIUS) : random(Math.max(900, screenRadius + 180), Math.max(WORLD_RADIUS, screenRadius + 650));
    const roll = Math.random();
    // 保留低质量碎片，同时按玩家质量提供猎物、同级天体和少量高阶目标。
    let mass;
    if (roll < .65) mass = random(1, 12);
    else if (roll < .90) mass = random(Math.max(2, player.mass * .08), Math.max(6, player.mass * .45));
    else if (roll < .98) mass = random(Math.max(24, player.mass * .55), Math.max(60, player.mass * 1.15));
    else {
      const targetType = Math.min(TYPES.length - 1, player.type + 1 + Math.floor(random(0, 3)));
      mass = random(TYPES[targetType].min, TYPES[targetType + 1]?.min ?? Math.max(7500, player.mass * 1.5));
    }
    const body = createBody(player.x + Math.cos(angle) * distance, player.y + Math.sin(angle) * distance, mass, random(-12, 12), random(-12, 12));
    if (body.type >= 1 && initial) {
      for (let i = 0; i < 3; i++) {
        const orbit = random(35, 95), a = random(0, Math.PI * 2);
        const speed = Math.sqrt(G * body.mass * orbit * orbit / Math.pow(orbit * orbit + SOFTENING ** 2, 1.5));
        const satellite = createBody(body.x + Math.cos(a) * orbit, body.y + Math.sin(a) * orbit, random(1, 5), body.vx - Math.sin(a) * speed, body.vy + Math.cos(a) * speed);
        satellite.host = body.id;
      }
    }
  }

  function reset() {
    bodies = []; particles = []; nextId = 1;
    player = createBody(0, 0, 8);
    player.isPlayer = true;
    camera.x = 0; camera.y = 0; camera.zoom = 1; camera.targetZoom = 1;
    thrust.active = false; paused = false; ended = false;
    time = 0; accumulator = 0; nextPopulation = 2; nextHud = 0; peakMass = 8; absorbed = 0;
    ui["end-screen"].hidden = true;
    ui.pause.setAttribute("aria-pressed", "false");
    ui.pause.innerHTML = "暂停 <kbd>空格</kbd>";
    // 初始碎片分布在玩家附近，提供低速吸收的练习空间。
    for (let i = 0; i < 65; i++) {
      const a = random(0, Math.PI * 2), r = random(24, 360);
      createBody(Math.cos(a) * r, Math.sin(a) * r, random(1, 4), random(-2, 2), random(-2, 2));
    }
    for (let i = 0; i < 350; i++) spawnAmbient(true);
    announce("点击星空，开始你的旅程", 9);
    refreshHud();
  }

  function accelerations() {
    const attractors = bodies.filter(b => b.alive && (b.type >= 1 || b === player));
    for (const b of bodies) {
      if (!b.alive) continue;
      b.ax = 0; b.ay = 0;
      let host = null, closest = Infinity;
      for (const a of attractors) {
        if (a === b) continue;
        const dx = a.x - b.x, dy = a.y - b.y, r2 = dx * dx + dy * dy;
        if (r2 > 1100 ** 2) continue;
        const factor = G * a.mass / Math.pow(r2 + SOFTENING ** 2, 1.5);
        b.ax += dx * factor; b.ay += dy * factor;
        if (a.type >= 1 && a.mass > b.mass * 5 && r2 < 140 ** 2 && r2 < closest) {
          const rv2 = (b.vx - a.vx) ** 2 + (b.vy - a.vy) ** 2;
          if (rv2 < 2 * G * a.mass / Math.sqrt(r2 + SOFTENING ** 2)) { host = a; closest = r2; }
        }
      }
      b.host = host?.id ?? null;
      // 近场低速耗散支持捕获，保留大部分切向速度。
      if (host && b !== player) {
        const dx = b.x - host.x, dy = b.y - host.y, r = Math.sqrt(closest) || 1;
        const radial = ((b.vx - host.vx) * dx + (b.vy - host.vy) * dy) / r;
        b.ax -= .035 * radial * dx / r;
        b.ay -= .035 * radial * dy / r;
      }
      if (b === player && thrust.active) {
        const force = 23 / (1 + Math.log2(Math.max(1, b.mass / 8)) * .16);
        b.ax += thrust.x * force; b.ay += thrust.y * force;
      }
    }
  }

  function absorb(a, b) {
    const oldType = a.type, mass = a.mass + b.mass;
    a.vx = (a.vx * a.mass + b.vx * b.mass) / mass;
    a.vy = (a.vy * a.mass + b.vy * b.mass) / mass;
    a.mass = mass; b.alive = false; updateSize(a);
    burst(b.x, b.y, TYPES[b.type].color, a === player ? 13 : 4, 16);
    if (a === player) {
      absorbed++; peakMass = Math.max(peakMass, a.mass);
      if (a.type !== oldType) {
        announce(`晋升为${TYPES[a.type].name} · ${oldType === 0 ? "尝试低速伴飞，捕获卫星" : "引力正在增强"}`, 5);
        burst(a.x, a.y, TYPES[a.type].color, 60, 60);
      }
    }
    if (b === player) die("你被一颗更大的天体吸收了。");
  }

  function die(reason) {
    ended = true; thrust.active = false;
    ui["end-description"].textContent = `${reason} 最高质量 ${peakMass.toFixed(1)}，吸收了 ${absorbed} 颗天体，漂流 ${Math.floor(time)} 秒。`;
    ui["end-screen"].hidden = false;
  }

  function collide(a, b) {
    if (!a.alive || !b.alive || a.cooldown > time || b.cooldown > time) return;
    const sx = b.px - a.px, sy = b.py - a.py;
    const dx = (b.x - a.x) - sx, dy = (b.y - a.y) - sy;
    const t = clamp(-(sx * dx + sy * dy) / (dx * dx + dy * dy || 1), 0, 1);
    const radius = a.radius + b.radius;
    if ((sx + dx * t) ** 2 + (sy + dy * t) ** 2 > radius * radius) return;
    const speed = Math.hypot(b.vx - a.vx, b.vy - a.vy);
    let large = a.mass >= b.mass ? a : b, small = large === a ? b : a;
    if (TYPES[large.type].kind === "black-hole" || speed < 28 || (large.mass > small.mass * 5 && speed < 72)) { absorb(large, small); return; }
    const nx0 = sx + dx * t, ny0 = sy + dy * t;
    const length = Math.hypot(nx0, ny0);
    const nx = length > .0001 ? nx0 / length : 1, ny = length > .0001 ? ny0 / length : 0;
    const total = a.mass + b.mass;
    // 回到碰撞时刻并分离，避免高速穿透和重叠后的连续损伤。
    a.x = a.px + (a.x - a.px) * t; a.y = a.py + (a.y - a.py) * t;
    b.x = a.x + nx * (radius + .2); b.y = a.y + ny * (radius + .2);
    const relative = (b.vx - a.vx) * nx + (b.vy - a.vy) * ny;
    if (relative < 0) {
      const impulse = -(1 + .65) * relative / (1 / a.mass + 1 / b.mass);
      a.vx -= impulse * nx / a.mass; a.vy -= impulse * ny / a.mass;
      b.vx += impulse * nx / b.mass; b.vy += impulse * ny / b.mass;
    }
    a.cooldown = b.cooldown = time + .3;
    const loss = speed > 45 ? clamp(speed / 600, .07, .24) : 0;
    for (const body of [a, b]) {
      const debrisMass = body.mass * loss;
      body.mass -= debrisMass; updateSize(body);
      if (debrisMass > .15) {
        const angle = random(0, Math.PI * 2), v = random(10, 28);
        for (const sign of [-1, 1]) {
          const fragment = createBody(body.x + Math.cos(angle) * sign * (body.radius + 4), body.y + Math.sin(angle) * sign * (body.radius + 4), debrisMass / 2, body.vx + Math.cos(angle) * v * sign, body.vy + Math.sin(angle) * v * sign);
          fragment.cooldown = time + 1;
        }
      }
      if (body.mass < .6) { body.alive = false; if (body === player) die("高速撞击将你化为了碎片。"); }
    }
    burst(a.x, a.y, "#f7cc9c", Math.min(25, Math.ceil(total)), 50);
    if (a === player || b === player) { shake = 4; announce(loss ? "高速撞击 · 质量受损，反向推进可制动" : "碰撞弹开 · 降低相对速度可吸收"); }
  }

  function collisions() {
    const grid = new Map(), cell = 48;
    for (const b of [...bodies]) {
      if (!b.alive) continue;
      const x0 = Math.floor((Math.min(b.px, b.x) - b.radius) / cell), x1 = Math.floor((Math.max(b.px, b.x) + b.radius) / cell);
      const y0 = Math.floor((Math.min(b.py, b.y) - b.radius) / cell), y1 = Math.floor((Math.max(b.py, b.y) + b.radius) / cell);
      const checked = new Set();
      for (let x = x0; x <= x1; x++) for (let y = y0; y <= y1; y++) {
        const key = `${x},${y}`;
        let bucket = grid.get(key);
        if (!bucket) { bucket = []; grid.set(key, bucket); }
        for (const a of bucket) if (!checked.has(a.id)) { checked.add(a.id); collide(a, b); }
        bucket.push(b);
      }
    }
    bodies = bodies.filter(b => b.alive);
  }

  function step(dt) {
    time += dt;
    // Kick-drift-kick 积分以固定步长更新位置和速度。
    accelerations();
    for (const b of bodies) {
      b.px = b.x; b.py = b.y;
      b.vx += b.ax * dt * .5; b.vy += b.ay * dt * .5;
      b.x += b.vx * dt; b.y += b.vy * dt;
    }
    accelerations();
    for (const b of bodies) { b.vx += b.ax * dt * .5; b.vy += b.ay * dt * .5; }
    collisions();
    for (const b of bodies) if (time >= b.trailAt) {
      b.trailAt = time + .12;
      b.trail.push({ x: b.x, y: b.y });
      if (b.trail.length > (b === player ? 95 : 38)) b.trail.shift();
    }
    for (const p of particles) { p.x += p.vx * dt; p.y += p.vy * dt; p.life -= dt; }
    particles = particles.filter(p => p.life > 0);
    if (thrust.active && player.alive && Math.random() < dt * 35) {
      const distance = player.radius + 4;
      particles.push({ x: player.x - thrust.x * distance, y: player.y - thrust.y * distance, vx: player.vx - thrust.x * 30 + random(-5, 5), vy: player.vy - thrust.y * 30 + random(-5, 5), life: .55, total: .55, color: "#8edee9" });
    }
    if (time > nextPopulation) {
      nextPopulation = time + 2;
      const retention = Math.max(WORLD_RADIUS + 600, Math.hypot(width, height) / (2 * camera.zoom) + 900);
      const retainedIds = new Set([player.id]);
      for (const b of bodies) if (b.host === player.id) retainedIds.add(b.id);
      bodies = bodies.filter(b => retainedIds.has(b.id) || Math.hypot(b.x - player.x, b.y - player.y) < retention);
      // 仅替换视野外的低阶天体，晋升后逐步更新环境质量分布。
      let replacements = 0;
      bodies = bodies.filter(b => {
        const offscreen = Math.abs(screenX(b.x) - width / 2) > width / 2 + 180 || Math.abs(screenY(b.y) - height / 2) > height / 2 + 180;
        if (replacements < 8 && !retainedIds.has(b.id) && b.host === null && b.type < player.type - 2 && offscreen) { replacements++; return false; }
        return true;
      });
      for (let i = 0, count = Math.min(25, 470 - bodies.length); i < count; i++) spawnAmbient();
    }
  }

  function resize() {
    width = innerWidth; height = innerHeight; dpr = Math.min(devicePixelRatio || 1, 2);
    canvas.width = Math.round(width * dpr); canvas.height = Math.round(height * dpr);
    stars = Array.from({ length: Math.floor(width * height / 1350) }, () => ({ x: Math.random(), y: Math.random(), depth: random(.03, .2), size: random(.3, 1.2), alpha: random(.15, .65), phase: random(0, 7) }));
    nebula = document.createElement("canvas"); nebula.width = 512; nebula.height = 320;
    const n = nebula.getContext("2d");
    for (let i = 0; i < 35; i++) {
      const x = random(0, 512), y = 170 + Math.sin(x / 90) * 65 + random(-65, 65), r = random(35, 130);
      const g = n.createRadialGradient(x, y, 0, x, y, r);
      g.addColorStop(0, i % 3 ? "rgba(24,65,85,.045)" : "rgba(66,39,93,.055)"); g.addColorStop(1, "transparent");
      n.fillStyle = g; n.fillRect(x - r, y - r, r * 2, r * 2);
    }
  }

  const screenX = x => (x - camera.x) * camera.zoom + width / 2;
  const screenY = y => (y - camera.y) * camera.zoom + height / 2;
  function circle(x, y, radius, color) { ctx.beginPath(); ctx.arc(x, y, radius, 0, Math.PI * 2); ctx.fillStyle = color; ctx.fill(); }
  function glow(x, y, r, color) {
    const gradient = ctx.createRadialGradient(x, y, 0, x, y, r);
    gradient.addColorStop(0, color); gradient.addColorStop(1, "transparent");
    ctx.fillStyle = gradient; ctx.fillRect(x - r, y - r, r * 2, r * 2);
  }

  function drawBody(b) {
    const x = screenX(b.x), y = screenY(b.y), r = b.radius * camera.zoom, color = TYPES[b.type].color;
    const kind = TYPES[b.type].kind;
    const margin = Math.max(80, r * 12);
    if (x < -margin || x > width + margin || y < -margin || y > height + margin) return;
    if (showTrails && (b.type > 0 || b === player || b.host === player.id) && b.trail.length > 1) {
      ctx.beginPath();
      b.trail.forEach((p, i) => i ? ctx.lineTo(screenX(p.x), screenY(p.y)) : ctx.moveTo(screenX(p.x), screenY(p.y)));
      ctx.strokeStyle = b === player ? "#77b7c74d" : `${color}1b`; ctx.lineWidth = .7; ctx.stroke();
    }
    if (kind === "asteroid") {
      ctx.beginPath();
      for (let i = 0; i < 7; i++) {
        const a = i / 7 * Math.PI * 2 + b.phase + time * .08, rr = r * (i % 2 ? .83 : 1);
        if (i === 0) ctx.moveTo(x + Math.cos(a) * rr, y + Math.sin(a) * rr); else ctx.lineTo(x + Math.cos(a) * rr, y + Math.sin(a) * rr);
      }
      ctx.closePath(); ctx.fillStyle = color; ctx.fill();
    } else if (kind === "rock" || kind === "ice" || kind === "gas") {
      glow(x, y, r * (kind === "ice" ? 3.5 : 2.5), `${color}25`);
      circle(x, y, r, color);
      ctx.save(); ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2); ctx.clip();
      if (kind === "rock") {
        circle(x - r * .3, y + r * .3, r * .32, "#723c4488");
        circle(x + r * .35, y - r * .25, r * .27, "#6e404977");
      } else if (kind === "ice") {
        ctx.beginPath(); ctx.moveTo(x - r, y + r * .5); ctx.lineTo(x, y - r * .2); ctx.lineTo(x + r * .6, y - r);
        ctx.strokeStyle = "#efffffbb"; ctx.lineWidth = .6; ctx.stroke();
      } else {
        for (let i = -2; i <= 2; i++) {
          ctx.fillStyle = i % 2 ? "#965b4477" : "#fff1bf88";
          ctx.fillRect(x - r, y + i * r * .4, r * 2, r * .17);
        }
      }
      circle(x + r * .6, y + r * .25, r * .85, "#08192d55"); ctx.restore();
      if (kind === "gas") { ctx.beginPath(); ctx.ellipse(x, y, r * 1.9, r * .55, -.45, 0, Math.PI * 2); ctx.strokeStyle = `${color}88`; ctx.lineWidth = .7; ctx.stroke(); }
    } else if (kind === "star" || kind === "giant") {
      const pulse = Math.sin(time * (kind === "giant" ? 1 : 1.5) + b.phase);
      const extent = kind === "giant" ? 5.5 + pulse * .9 : 3.8 + pulse * .3;
      glow(x, y, r * extent, `${color}${b.type === 4 ? "18" : "35"}`);
      glow(x, y, r * 1.8, `${color}66`); circle(x, y, r, color);
      circle(x - r * .16, y - r * .14, r * .6, b.type === 4 ? "#c3829677" : "#fff7e7bb");
    } else if (kind === "white-dwarf") {
      glow(x, y, r * 3, `${color}55`); circle(x, y, r, "#f5fbff");
      ctx.beginPath(); ctx.arc(x, y, r * 1.55, 0, Math.PI * 2); ctx.strokeStyle = "#b9deff99"; ctx.lineWidth = .65; ctx.stroke();
    } else if (kind === "neutron") {
      ctx.save(); ctx.translate(x, y); ctx.rotate(time * 1.8 + b.phase);
      // 双束光柱仅参与绘制，碰撞范围由实体半径决定。
      for (const sign of [-1, 1]) {
        const beam = ctx.createLinearGradient(0, 0, sign * r * 11, 0);
        beam.addColorStop(0, "#cfbcffbb"); beam.addColorStop(1, "#a28aff00");
        ctx.beginPath(); ctx.moveTo(0, -r * .4); ctx.lineTo(sign * r * 11, -r * 1.1); ctx.lineTo(sign * r * 11, r * 1.1); ctx.lineTo(0, r * .4); ctx.closePath(); ctx.fillStyle = beam; ctx.fill();
      }
      ctx.restore(); glow(x, y, r * 4, `${color}55`); circle(x, y, r, color); circle(x, y, r * .5, "#f1edff");
    } else if (kind === "black-hole") {
      glow(x, y, r * 5, `${color}2c`);
      ctx.save(); ctx.translate(x, y); ctx.rotate(-.4);
      for (let i = 3; i >= 1; i--) { ctx.beginPath(); ctx.ellipse(0, 0, r * (1.65 + i * .22), r * (.45 + i * .12), 0, 0, Math.PI * 2); ctx.strokeStyle = i === 1 ? "#ffdb9a" : `${color}66`; ctx.lineWidth = i === 1 ? 1.5 : 2; ctx.stroke(); }
      circle(0, 0, r, "#020309"); ctx.beginPath(); ctx.arc(0, 0, r * 1.08, 0, Math.PI * 2); ctx.strokeStyle = "#c2a4f9aa"; ctx.lineWidth = 1; ctx.stroke(); ctx.restore();
    }
  }

  function draw() {
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.fillStyle = "#050911"; ctx.fillRect(0, 0, width, height);
    ctx.drawImage(nebula, 0, 0, width, height);
    for (const s of stars) {
      let x = ((s.x * width - camera.x * s.depth) % width + width) % width;
      let y = ((s.y * height - camera.y * s.depth) % height + height) % height;
      for (const b of bodies) if (TYPES[b.type].kind === "black-hole") {
        const dx = x - screenX(b.x), dy = y - screenY(b.y), r2 = dx * dx + dy * dy;
        if (r2 > 100 && r2 < 10000) { const shift = 110 * camera.zoom / r2; x += dx * shift; y += dy * shift; }
      }
      ctx.globalAlpha = s.alpha * (.85 + .15 * Math.sin(time * .5 + s.phase)); circle(x, y, s.size, "#b2c6e3");
    }
    ctx.globalAlpha = 1;
    ctx.save();
    if (shake > .1) ctx.translate(random(-shake, shake), random(-shake, shake));
    for (const b of bodies) drawBody(b);
    for (const p of particles) { ctx.globalAlpha = clamp(p.life / p.total, 0, 1); circle(screenX(p.x), screenY(p.y), Math.max(.55, camera.zoom), p.color); }
    ctx.globalAlpha = 1;
    if (player.alive) {
      const x = screenX(player.x), y = screenY(player.y), ring = Math.max(13, player.radius * camera.zoom + 8);
      ctx.beginPath(); ctx.arc(x, y, ring, 0, Math.PI * 2); ctx.strokeStyle = "#b6d9e266"; ctx.lineWidth = .7; ctx.stroke();
      ctx.fillStyle = "#8ba2b6"; ctx.font = "9px 'Segoe UI', sans-serif"; ctx.textAlign = "center"; ctx.fillText("YOU", x, y + ring + 16);
      const speed = Math.hypot(player.vx, player.vy);
      if (speed > 2) { const size = clamp(speed * .35, 18, 65); ctx.beginPath(); ctx.moveTo(x + player.vx / speed * (ring + 3), y + player.vy / speed * (ring + 3)); ctx.lineTo(x + player.vx / speed * (ring + size), y + player.vy / speed * (ring + size)); ctx.strokeStyle = "#95b9cd44"; ctx.stroke(); }
      if (thrust.active) {
        const tipX = x + thrust.x * (ring + 28), tipY = y + thrust.y * (ring + 28);
        ctx.beginPath(); ctx.moveTo(x + thrust.x * (ring + 7), y + thrust.y * (ring + 7)); ctx.lineTo(tipX, tipY); ctx.strokeStyle = "#88e5d9aa"; ctx.stroke();
        ctx.beginPath(); ctx.moveTo(tipX, tipY); ctx.lineTo(tipX - thrust.x * 5 - thrust.y * 3, tipY - thrust.y * 5 + thrust.x * 3); ctx.lineTo(tipX - thrust.x * 5 + thrust.y * 3, tipY - thrust.y * 5 - thrust.x * 3); ctx.closePath(); ctx.fillStyle = "#88e5d9"; ctx.fill();
      }
      const threats = bodies.filter(b => b.mass > player.mass * 3 && b.type >= 1).sort((a, b) => Math.hypot(a.x - player.x, a.y - player.y) - Math.hypot(b.x - player.x, b.y - player.y)).slice(0, 3);
      for (const b of threats) {
        const bx = screenX(b.x), by = screenY(b.y);
        if (bx > 16 && bx < width - 16 && by > 16 && by < height - 16) continue;
        const dx = bx - width / 2, dy = by - height / 2;
        const edge = Math.min((width / 2 - 20) / Math.max(Math.abs(dx), .001), (height / 2 - 45) / Math.max(Math.abs(dy), .001));
        const ex = width / 2 + dx * edge, ey = height / 2 + dy * edge;
        circle(ex, ey, 2, TYPES[b.type].color);
        ctx.font = "9px 'Segoe UI', sans-serif"; ctx.fillStyle = "#687d91"; ctx.textAlign = ex < 60 ? "left" : ex > width - 60 ? "right" : "center";
        ctx.fillText(`${TYPES[b.type].name} · ${Math.round(Math.hypot(b.x - player.x, b.y - player.y))}`, ex, ey + 14);
      }
    }
    ctx.restore();
  }

  function refreshHud() {
    const type = TYPES[player.type], next = TYPES[player.type + 1];
    const percent = next ? clamp((player.mass - type.min) / (next.min - type.min) * 100, 0, 100) : 100;
    ui.stage.textContent = type.name; ui["stage-dot"].style.background = type.color; ui["stage-dot"].style.color = type.color;
    ui["stage-size"].textContent = `${type.radius} PX`;
    ui.mass.textContent = player.mass.toFixed(1); ui.speed.textContent = Math.hypot(player.vx, player.vy).toFixed(1);
    ui.satellites.textContent = bodies.filter(b => b.host === player.id).length;
    ui["next-stage"].textContent = next ? `下一阶段 · ${next.name}` : "终极阶段 · 持续吸积";
    ui["progress-text"].textContent = next ? `${Math.floor(percent)}%` : "∞"; ui.progress.style.width = `${percent}%`;
    ui.progress.style.background = type.color;
    ui["drive-status"].textContent = ended ? "信号消逝" : paused ? "时间已暂停" : thrust.active ? "推进中 · 点击自身停止推进" : "惯性滑行";
    ui["world-status"].textContent = ended ? "旅程结束" : paused ? "引力场已暂停" : `引力场运行中 · ${bodies.length} 颗天体`;
    ui.scale.textContent = `${camera.zoom.toFixed(2)}×`;
    ui.notice.style.opacity = time < noticeUntil ? "1" : "0";
  }

  function togglePause() {
    if (ended) return;
    paused = !paused; accumulator = 0;
    ui.pause.setAttribute("aria-pressed", String(paused)); ui.pause.innerHTML = `${paused ? "继续" : "暂停"} <kbd>空格</kbd>`; refreshHud();
  }
  function toggleOrbits() { showTrails = !showTrails; ui.orbits.setAttribute("aria-pressed", String(showTrails)); }
  function toggleHelp() { ui["help-panel"].hidden = !ui["help-panel"].hidden; ui.help.setAttribute("aria-expanded", String(!ui["help-panel"].hidden)); }
  canvas.addEventListener("pointerdown", event => {
    if (event.button !== 0 || ended || paused) return;
    const dx = event.clientX - screenX(player.x), dy = event.clientY - screenY(player.y), distance = Math.hypot(dx, dy);
    if (distance < Math.max(16, player.radius * camera.zoom + 10)) { thrust.active = false; announce("推进已关闭 · 保持惯性滑行", 2); }
    else { thrust.x = dx / distance; thrust.y = dy / distance; thrust.active = true; noticeUntil = Math.min(noticeUntil, time + 1.5); }
  });
  canvas.addEventListener("wheel", event => { event.preventDefault(); camera.targetZoom = clamp(camera.targetZoom * Math.exp(-event.deltaY * .001), .5, 2.5); }, { passive: false });
  ui.pause.addEventListener("click", togglePause); ui.orbits.addEventListener("click", toggleOrbits); ui.help.addEventListener("click", toggleHelp);
  document.getElementById("restart").addEventListener("click", reset);
  window.addEventListener("keydown", event => {
    if (event.repeat || event.target instanceof HTMLButtonElement) return;
    if (event.code === "Space") { event.preventDefault(); togglePause(); }
    if (event.code === "KeyO") toggleOrbits();
    if (event.key === "?" || event.code === "KeyH") toggleHelp();
    if (event.code === "Escape" && !ui["help-panel"].hidden) toggleHelp();
  });
  document.addEventListener("visibilitychange", () => { if (document.hidden && !paused && !ended) togglePause(); lastFrame = 0; accumulator = 0; });
  window.addEventListener("resize", resize);

  function frame(timestamp) {
    const dt = lastFrame ? Math.min((timestamp - lastFrame) / 1000, .06) : 0;
    lastFrame = timestamp;
    if (!paused && !ended) {
      accumulator += dt;
      while (accumulator >= STEP && !ended) { step(STEP); accumulator -= STEP; }
      const follow = 1 - Math.exp(-dt * 3);
      camera.x += (player.x + player.vx * .45 - camera.x) * follow;
      camera.y += (player.y + player.vy * .45 - camera.y) * follow;
      shake *= Math.exp(-dt * 7);
    }
    camera.zoom += (camera.targetZoom - camera.zoom) * (1 - Math.exp(-dt * 6));
    draw();
    if (timestamp > nextHud) { nextHud = timestamp + 120; refreshHud(); }
    requestAnimationFrame(frame);
  }
  const legend = document.getElementById("type-legend");
  for (const type of TYPES) {
    const entry = document.createElement("span");
    entry.style.setProperty("--color", type.color);
    entry.textContent = `${type.name} ${type.radius}px`;
    entry.title = `质量 ≥ ${type.min}`;
    legend.append(entry);
  }
  resize(); reset(); requestAnimationFrame(frame);
})();
