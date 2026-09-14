"use strict";

(() => {
  const canvas = document.getElementById("universe");
  const ctx = canvas.getContext("2d", { alpha: false });
  const ui = Object.fromEntries(["stage", "stage-dot", "mass", "speed", "satellites", "next-stage", "progress-text", "progress", "drive-status", "world-status", "scale", "notice", "end-screen", "end-description", "help-panel", "pause", "orbits", "pause-screen"].map(id => [id, document.getElementById(id)]));
  const CONFIG = SolarConfig, CIV = SolarCivilization, GRAVITY = SolarGravity;
  const TYPES = CONFIG.types;
  const STEP = CONFIG.physicsStep, WORLD_RADIUS = 1800;
  const playerSpeedLimit = type => 200 + Math.max(0, Math.min(5, TYPES[type].level)) * 50;
  const CAPTURE = CONFIG.capture;
  const POPULATION = { initial: 110, target: 150, nearby: 12, batch: 8, regionSize: 1000 };
  let universeSeed = 0;
  let width, height, dpr, stars, nebula;
  let bodies = [], player = null, particles = [];
  let ships = [], beams = [], nestRecords = new Map(), nextCivilization = 0, nextCombat = 0;
  let jumping = false, pointer = { x: 0, y: 0 }, savedGame = null;
  let choosingStart = true;
  let selectedSatelliteId = null, satelliteClickAt = -Infinity;
  let nextId = 1, paused = false, ended = false, showTrails = true;
  let time = 0, lastFrame = 0, accumulator = 0, nextPopulation = 0, nextHud = 0;
  let peakMass = 8, absorbed = 0, shake = 0, driftDistance = 0;
  let warningCache = { at: -Infinity, records: [] };
  const camera = { x: 0, y: 0, zoom: 1, targetZoom: 1 };
  const thrust = { x: 0, y: 0, active: false };
  const movementKeys = new Set();
  const movementCodes = new Set(["KeyW", "KeyA", "KeyS", "KeyD"]);
  function updateThrust() {
    warningCache.at = -Infinity;
    const x = Number(movementKeys.has("KeyD")) - Number(movementKeys.has("KeyA"));
    const y = Number(movementKeys.has("KeyS")) - Number(movementKeys.has("KeyW"));
    const length = Math.hypot(x, y);
    thrust.active = length > 0;
    // 归一化方向，使斜向与单轴推进具有相同的加速度。
    thrust.x = length > 0 ? x / length : 0;
    thrust.y = length > 0 ? y / length : 0;
  }
  function clearMovement() { movementKeys.clear(); updateThrust(); }
  const random = (a, b) => a + Math.random() * (b - a);
  const clamp = (n, a, b) => Math.max(a, Math.min(b, n));
  const satelliteLimit = type => TYPES[type].natural || type === 0 ? 0 : Math.min(6, Math.max(2, TYPES[type].level + 1));
  const bodyMass = GRAVITY.mass;
  const isPlanet = body => !body.natural && body.type > 0;
  function limitPlayerSpeed() {
    GRAVITY.limitVelocity(player);
  }
  function orbitRadiusLimit(host) { return GRAVITY.captureRange(host) * CAPTURE.orbitRadiusRatio; }
  const typeOf = mass => {
    for (let i = 7; i >= 1; i--) if (mass >= TYPES[i].min) return i;
    return 0;
  };

  function updateSize(body) {
    if (body.natural) { body.radius = TYPES[body.type].radius; return; }
    body.type = typeOf(body.mass);
    const base = TYPES[body.type];
    const upper = body.type < 7 ? TYPES[body.type + 1].min : CONFIG.maxPlanetMass;
    body.radius = base.radius + clamp((body.mass - base.min) / (upper - base.min), 0, 1) * 0.3;
    CIV.sync(body);
  }

  function initialVelocity(mass) {
    const motion = CONFIG.initialMotion;
    const speed = motion.speed / (1 + mass / motion.referenceMass) ** motion.exponent;
    const angle = random(0, Math.PI * 2);
    return { vx: Math.cos(angle) * speed, vy: Math.sin(angle) * speed };
  }

  function createBody(x, y, mass, velocity = initialVelocity(mass), naturalType = null) {
    const { vx, vy } = velocity;
    const body = { id: nextId++, x, y, px: x, py: y, vx, vy, ax: 0, ay: 0, mass, cityMass: 0, healthyMass: mass, natural: naturalType !== null, type: naturalType, civ: CIV.create(), kills: { asteroid: 0, planet: 0, fighter: 0, mothership: 0 }, nextAttack: 0, nextAbsorb: 0, jumpReady: 0, hazardReady: 0, alive: true, trail: [], trailAt: 0, host: null, orbitRadius: 0, orbitDirection: 1, captureAfter: 0, cooldown: 0, phase: random(0, Math.PI * 2) };
    updateSize(body);
    bodies.push(body);
    return body;
  }

  function announce(message) {
    ui.notice.textContent = message;
  }

  function burst(x, y, color, count, strength = 25) {
    for (let i = 0; i < count && particles.length < 650; i++) {
      const angle = random(0, Math.PI * 2), speed = random(3, strength);
      particles.push({ x, y, vx: Math.cos(angle) * speed, vy: Math.sin(angle) * speed, life: random(.3, 1.2), total: 1.2, color });
    }
  }

  function regionRandom(x, y, salt) {
    let hash = Math.imul(x, 374761393) ^ Math.imul(y, 668265263) ^ Math.imul(salt, 1274126177) ^ universeSeed;
    hash = Math.imul(hash ^ (hash >>> 13), 1274126177);
    return ((hash ^ (hash >>> 16)) >>> 0) / 4294967296;
  }

  function ambientDensity(x, y) {
    const size = POPULATION.regionSize;
    const cellX = Math.floor(x / size), cellY = Math.floor(y / size);
    let density = .025;
    // 星群固定于世界坐标，邻区叠加使星群边缘平滑过渡到空旷区。
    for (let cx = cellX - 1; cx <= cellX + 1; cx++) for (let cy = cellY - 1; cy <= cellY + 1; cy++) {
      if (regionRandom(cx, cy, 1) > .55) continue;
      const centerX = (cx + .15 + regionRandom(cx, cy, 2) * .7) * size;
      const centerY = (cy + .15 + regionRandom(cx, cy, 3) * .7) * size;
      const spreadX = 130 + regionRandom(cx, cy, 4) * 150;
      const spreadY = 110 + regionRandom(cx, cy, 5) * 120;
      const distance = ((x - centerX) / spreadX) ** 2 + ((y - centerY) / spreadY) ** 2;
      density += (.45 + regionRandom(cx, cy, 6) * .4) * Math.exp(-distance * .5);
    }
    return Math.min(.9, density);
  }

  function spawnAmbient(initial = false) {
    const screenRadius = Math.hypot(width, height) / (2 * camera.zoom);
    const innerRadius = initial ? 260 : Math.max(900, screenRadius + 180);
    const outerRadius = initial ? WORLD_RADIUS : Math.max(WORLD_RADIUS, screenRadius + 650);
    let position = null;
    // 按面积采样，避免径向均匀采样将天体挤在玩家附近；空旷区允许不补充。
    for (let attempt = 0; attempt < 12; attempt++) {
      const angle = random(0, Math.PI * 2);
      const distance = Math.sqrt(random(innerRadius ** 2, outerRadius ** 2));
      const x = player.x + Math.cos(angle) * distance, y = player.y + Math.sin(angle) * distance;
      if (Math.random() > ambientDensity(x, y)) continue;
      if (bodies.some(b => b.alive && (b.x - x) ** 2 + (b.y - y) ** 2 < 30 ** 2)) continue;
      position = { x, y }; break;
    }
    if (!position) return;
    const roll = Math.random();
    // 陨石与行星参与成长，天然致密天体仅作为环境危险源。
    let mass;
    if (roll < .76) mass = random(1, 11);
    else if (roll < .98) mass = random(24, Math.min(CONFIG.maxPlanetMass, Math.max(80, player.mass * 2)));
    else { const type = Math.floor(random(8, 11)); createBody(position.x, position.y, TYPES[type].mass, initialVelocity(TYPES[type].mass), type); return; }
    const body = createBody(position.x, position.y, mass);
    if (CIV.eligible(body)) {
      if (Math.random() < .3) { body.civ.incubation = random(0, CONFIG.civilization.incubationSeconds); }
      else {
        body.civ.tech = Math.floor(random(0, TYPES[body.type].techCap + 1));
        body.civ.city = body.civ.tech >= 4;
        body.civ.population = Math.max(CONFIG.civilization.technology[body.civ.tech].population, CIV.capacity(body) * random(.1, .75));
        body.civ.incubation = CONFIG.civilization.incubationSeconds;
        body.civ.shield = CIV.stats(body).shield;
        body.civ.research = 0;
      }
    }
    if (isPlanet(body) && initial) {
      for (let i = 0; i < Math.min(3, satelliteLimit(body.type)); i++) {
        const orbit = random(CAPTURE.minimumOrbitRadius, orbitRadiusLimit(body)), a = random(0, Math.PI * 2);
        const speed = CAPTURE.orbitAngularSpeed * orbit;
        const satellite = createBody(body.x + Math.cos(a) * orbit, body.y + Math.sin(a) * orbit, random(1, 5), { vx: body.vx - Math.sin(a) * speed, vy: body.vy + Math.cos(a) * speed });
        satellite.host = body.id;
        satellite.orbitRadius = orbit;
      }
    }
  }

  function reset(startType, snapshot = null) {
    bodies = []; particles = []; nextId = 1;
    ships = []; beams = []; nestRecords = new Map(); nextCivilization = 0; nextCombat = 0; jumping = false;
    universeSeed = Math.floor(Math.random() * 4294967296);
    selectedSatelliteId = null; satelliteClickAt = -Infinity;
    const startMass = startType === 0 ? 8 : TYPES[startType].min;
    player = createBody(0, 0, startMass);
    player.isPlayer = true;
    camera.x = 0; camera.y = 0; camera.zoom = 1; camera.targetZoom = 1;
    clearMovement(); paused = false; ended = false; choosingStart = false;
    time = 0; accumulator = 0; lastFrame = 0; nextPopulation = 2; nextHud = 0; peakMass = startMass; absorbed = 0; shake = 0;
    driftDistance = 0;
    warningCache = { at: -Infinity, records: [] };
    if (snapshot) restorePlayer(snapshot);
    nextCivilization = time + CONFIG.civilization.tick; nextCombat = time + CONFIG.combat.tick;
    ui["end-screen"].hidden = true;
    ui["pause-screen"].close();
    document.getElementById("save-status").textContent = "每秒自动保存 · 读档进入新沙盒。";
    // 出生点只保留两个疏松的小天体群，其他方向留出空白。
    const nearbyAngle = random(0, Math.PI * 2);
    for (let i = 0; i < POPULATION.nearby; i++) {
      const a = nearbyAngle + (i % 2) * 2.2 + random(-.3, .3), r = random(80, 300);
      createBody(Math.cos(a) * r, Math.sin(a) * r, random(1, 4));
    }
    for (let i = 0; i < POPULATION.initial; i++) spawnAmbient(true);
    manageNests();
    announce("按住 WASD 推进，松开后惯性滑行", 9);
    refreshHud();
  }

  function captureSpeedLimit(host, distance) {
    const escapeSpeed = Math.sqrt(2 * CONFIG.gravity.constant * bodyMass(host) / Math.sqrt(distance * distance + CONFIG.gravity.softening ** 2));
    return clamp(escapeSpeed * CAPTURE.speedFactor, CAPTURE.minSpeedLimit, CAPTURE.maxSpeedLimit);
  }

  function updateCaptures(spatial) {
    const hosts = bodies.filter(b => b.alive && isPlanet(b));
    const byId = new Map(hosts.map(b => [b.id, b]));
    const occupied = new Map(hosts.map(b => [b.id, 0]));
    // 先为已有卫星保留名额，再处理新的捕获。
    for (const b of bodies) {
      if (!b.alive || b === player || b.host === null) continue;
      const host = byId.get(b.host);
      const distance = host ? Math.hypot(b.x - host.x, b.y - host.y) : Infinity;
      const speed = host ? Math.hypot(b.vx - host.vx, b.vy - host.vy) : Infinity;
      if (host && b.type === 0 && occupied.get(host.id) < satelliteLimit(host.type) && bodyMass(host) > bodyMass(b) * CAPTURE.massRatio && distance < GRAVITY.range(host) && speed < captureSpeedLimit(host, distance) * 2 && GRAVITY.tidalRatio(host, b, spatial) <= CAPTURE.maxTidalRatio) {
        b.orbitRadius = Math.min(b.orbitRadius, orbitRadiusLimit(host));
        occupied.set(host.id, occupied.get(host.id) + 1);
        continue;
      }
      if (b.host === player.id) announce("卫星脱离 · 外部潮汐过强或超出维持条件", 2);
      b.host = null; b.orbitRadius = 0; b.captureAfter = time + 2;
    }
    for (const b of bodies) {
      if (!b.alive || b === player || b.type !== 0 || b.host !== null || time < b.captureAfter || time < b.cooldown) continue;
      let candidate = null, nearest = Infinity;
      for (const host of hosts) {
        if (host === b || bodyMass(host) <= bodyMass(b) * CAPTURE.massRatio || occupied.get(host.id) >= satelliteLimit(host.type)) continue;
        const dx = b.x - host.x, dy = b.y - host.y, distance = Math.hypot(dx, dy);
        if (distance >= GRAVITY.captureRange(host) || distance >= nearest || distance <= host.radius + b.radius + 8) continue;
        const vx = b.vx - host.vx, vy = b.vy - host.vy, speed = Math.hypot(vx, vy);
        const angularMomentum = dx * vy - dy * vx;
        // 侧向掠过触发捕获，正面接近进入碰撞处理。
        if (speed < .5 || speed > captureSpeedLimit(host, distance) || Math.abs(angularMomentum) / speed <= host.radius + b.radius + 8) continue;
        if (GRAVITY.tidalRatio(host, b, spatial) > CAPTURE.maxTidalRatio) continue;
        candidate = host; nearest = distance;
      }
      if (candidate) {
        const dx = b.x - candidate.x, dy = b.y - candidate.y;
        b.host = candidate.id;
        occupied.set(candidate.id, occupied.get(candidate.id) + 1);
        b.orbitRadius = clamp(nearest, CAPTURE.minimumOrbitRadius, orbitRadiusLimit(candidate));
        b.orbitDirection = dx * (b.vy - candidate.vy) - dy * (b.vx - candidate.vx) < 0 ? -1 : 1;
        if (candidate === player) { announce("捕获卫星 · 正在进入绕行轨道", 3); burst(b.x, b.y, TYPES[player.type].color, 8, 12); }
      }
    }
  }

  function applyOrbitAssists() {
    const byId = new Map(bodies.filter(b => b.alive).map(b => [b.id, b]));
    for (const b of bodies) {
      if (!b.alive || b === player || b.host === null) continue;
      const host = byId.get(b.host);
      if (!host || !isPlanet(host) || b.type !== 0 || bodyMass(host) <= bodyMass(b) * CAPTURE.massRatio) continue;
      const dx = b.x - host.x, dy = b.y - host.y, r = Math.hypot(dx, dy);
      if (r <= host.radius + b.radius || r >= GRAVITY.range(host)) continue;
      const nx = dx / r, ny = dy / r;
      const vx = b.vx - host.vx, vy = b.vy - host.vy;
      const radial = vx * nx + vy * ny, tangent = -vx * ny + vy * nx;
      const orbitSpeed = CAPTURE.orbitAngularSpeed * r;
      const radialAssist = -(tangent * tangent) / r - .7 * (r - b.orbitRadius) - 1.6 * radial;
      const tangentAssist = .9 * (b.orbitDirection * orbitSpeed - tangent);
      const desiredX = radialAssist * nx - tangentAssist * ny;
      const desiredY = radialAssist * ny + tangentAssist * nx;
      const scale = Math.min(1, CAPTURE.assistLimit / (Math.hypot(desiredX, desiredY) || 1));
      const ownGravity = GRAVITY.accelerationFrom(b, host);
      // 仅替换宿主与卫星之间的相互作用，保留所有外部引力及潮汐。
      const ax = desiredX * scale - ownGravity.x, ay = desiredY * scale - ownGravity.y;
      b.ax += ax; b.ay += ay;
      const reaction = bodyMass(b) / bodyMass(host);
      host.ax -= ax * reaction; host.ay -= ay * reaction;
    }
  }

  function gainMass(body, amount) {
    const available = Math.max(0, CONFIG.maxPlanetMass - body.mass);
    body.mass += Math.min(available, amount);
    body.cityMass += Math.max(0, amount - available);
    body.healthyMass = Math.max(body.healthyMass, bodyMass(body));
    updateSize(body);
    if (body === player) peakMass = Math.max(peakMass, bodyMass(body));
  }

  function destroyUnit(target, attacker, cause) {
    if (!target.alive || target.natural) return;
    const remainingMass = target.entity ? 0 : bodyMass(target);
    const wasPlanet = !target.entity && isPlanet(target);
    target.alive = false;
    burst(target.x, target.y, target.entity ? "#ff6f72" : TYPES[target.type].color, 24, 45);
    if (attacker?.alive && !attacker.entity && !attacker.natural) {
      const category = target.entity || (wasPlanet ? "planet" : "asteroid");
      attacker.kills[category]++;
      if (category === "mothership") CIV.research(attacker, CONFIG.civilization.mothershipResearchReward);
      if (cause === "laser" && wasPlanet && attacker.civ.tech === 5) gainMass(attacker, remainingMass * CONFIG.combat.devourFraction);
      if (attacker === player) announce(`击毁${category === "mothership" ? "母舰" : category === "fighter" ? "攻击舰" : wasPlanet ? "行星" : "陨石"}${cause === "laser" && wasPlanet && attacker.civ.tech === 5 ? " · 吸收剩余质量的 50%" : ""}`);
    }
    if (target === player) die("天体损伤超过承受极限。");
  }

  function damageUnit(target, amount, attacker, cause) {
    if (!target.alive || target.natural || amount <= 0) return;
    if (target.entity) {
      target.hp -= amount;
      if (target.hp <= 0) destroyUnit(target, attacker, cause);
      return;
    }
    const c = target.civ;
    c.lastHit = time;
    const shieldLoss = Math.min(c.shield, amount);
    c.shield -= shieldLoss;
    amount -= shieldLoss;
    if (amount <= 0) return;
    const total = bodyMass(target), loss = Math.min(total, amount);
    const cityLoss = Math.min(target.cityMass, loss);
    target.cityMass -= cityLoss;
    target.mass = Math.max(0, target.mass - (loss - cityLoss));
    CIV.suffer(target, loss / total);
    if (bodyMass(target) < target.healthyMass * (1 - CONFIG.combat.breakLoss) || target.mass < .6) destroyUnit(target, attacker, cause);
    else updateSize(target);
  }

  function sameSystem(a, b) {
    return a.id === b.id || a.host === b.id || b.host === a.id || (a.host !== null && a.host === b.host);
  }

  function fireLaser(attacker, target, damage, color) {
    beams.push({ x: attacker.x, y: attacker.y, tx: target.x, ty: target.y, life: .18, color });
    damageUnit(target, damage, attacker, "laser");
  }

  function selectCivilizationTarget(body) {
    const range = CIV.stats(body).range;
    let target = null, priority = Infinity, nearest = Infinity;
    for (const candidate of [...ships, ...bodies]) {
      if (!candidate.alive || candidate.natural || (!candidate.entity && sameSystem(body, candidate))) continue;
      const distance = Math.hypot(candidate.x - body.x, candidate.y - body.y);
      if (distance > range) continue;
      const rank = candidate.entity === "mothership" ? 0 : candidate.entity === "fighter" ? 1 : candidate.type === 0 ? 2 : 3;
      if (rank < priority || (rank === priority && distance < nearest)) { target = candidate; priority = rank; nearest = distance; }
    }
    return target;
  }

  function updateCivilizations(dt) {
    for (const body of bodies) {
      if (!body.alive || body.natural) continue;
      if (CIV.tick(body, dt, time) && body === player) announce(`文明科技达到 ${body.civ.tech} 级`);
      // 环境行星自主吸收已经捕获的陨石，玩家通过 K/L 决定吸收时机。
      if (body !== player && isPlanet(body) && time >= body.nextAbsorb) {
        body.nextAbsorb = time + random(8, 15);
        const rock = bodies.find(b => b.alive && b.type === 0 && b.host === body.id);
        if (rock) absorb(body, rock);
      }
    }
  }

  function updateCombat(dt) {
    for (const body of bodies) {
      if (!body.alive || body.natural || body.civ.tech < 2 || time < body.nextAttack) continue;
      const target = selectCivilizationTarget(body);
      if (target) { body.nextAttack = time + CIV.stats(body).interval; fireLaser(body, target, CIV.stats(body).damage, TYPES[body.type].color); }
      if (body !== player && body.civ.city && body.jumpReady <= time && body.civ.shield < CIV.stats(body).shield * .2 && time - body.civ.lastHit < 2) {
        const a = random(0, Math.PI * 2), r = random(180, 380);
        const x = body.x + Math.cos(a) * r, y = body.y + Math.sin(a) * r;
        if (jumpClear(body, x, y)) performJump(body, x, y);
      }
    }
    updateFleet(dt);
  }

  function makeMothership(region, x, y) {
    const ship = { id: nextId++, entity: "mothership", region, x, y, vx: 0, vy: 0, radius: 12, hp: CONFIG.nests.mothershipHp, maxHp: CONFIG.nests.mothershipHp, alive: true, nextAttack: 0, launchIn: 0, fleet: [] };
    nestRecords.set(region, ship);
    return ship;
  }

  function manageNests() {
    const size = CONFIG.nests.regionSize, cx = Math.floor(player.x / size), cy = Math.floor(player.y / size);
    const candidates = [];
    for (let x = cx - 2; x <= cx + 2; x++) for (let y = cy - 2; y <= cy + 2; y++) {
      if (regionRandom(x, y, 20) > CONFIG.nests.chance) continue;
      const px = (x + .2 + .6 * regionRandom(x, y, 21)) * size;
      const py = (y + .2 + .6 * regionRandom(x, y, 22)) * size;
      if (Math.hypot(px, py) < CONFIG.nests.safeRadius || Math.hypot(px - player.x, py - player.y) > WORLD_RADIUS + 400) continue;
      const key = `${x},${y}`, existing = nestRecords.get(key);
      if (existing && !existing.alive && !existing.fleet.some(f => f.alive)) continue;
      candidates.push({ key, x: px, y: py, distance: Math.hypot(px - player.x, py - player.y) });
    }
    candidates.sort((a, b) => a.distance - b.distance);
    ships = [];
    for (const candidate of candidates.slice(0, CONFIG.nests.activeLimit)) {
      const mother = nestRecords.get(candidate.key) || makeMothership(candidate.key, candidate.x, candidate.y);
      mother.fleet = mother.fleet.filter(f => f.alive);
      if (mother.alive) ships.push(mother);
      ships.push(...mother.fleet);
    }
  }

  function nearestFleetTarget(ship, range) {
    let result = null, nearest = range;
    for (const body of bodies) {
      if (!body.alive || body.natural) continue;
      if (ship.entity === "fighter") {
        const mother = nestRecords.get(ship.mother);
        if (Math.hypot(body.x - mother.x, body.y - mother.y) > CONFIG.nests.activityRadius) continue;
      }
      const distance = Math.hypot(body.x - ship.x, body.y - ship.y);
      if (distance < nearest) { result = body; nearest = distance; }
    }
    return result;
  }

  function updateFleet(dt) {
    const cfg = CONFIG.nests;
    for (const mother of ships.filter(s => s.alive && s.entity === "mothership")) {
      mother.fleet = mother.fleet.filter(f => f.alive);
      mother.launchIn -= dt;
      if (mother.launchIn <= 0 && mother.fleet.length < cfg.fightersPerNest) {
        const a = random(0, Math.PI * 2);
        const fighter = { id: nextId++, entity: "fighter", mother: mother.region, x: mother.x + Math.cos(a) * 20, y: mother.y + Math.sin(a) * 20, vx: 0, vy: 0, radius: 3, hp: cfg.fighterHp, maxHp: cfg.fighterHp, alive: true, shots: cfg.shots, mode: "attack", dockTime: 0, nextAttack: time + 1, phase: a };
        mother.fleet.push(fighter); ships.push(fighter); mother.launchIn = cfg.launchSeconds;
      }
      if (time >= mother.nextAttack) {
        const target = nearestFleetTarget(mother, cfg.mothershipRange);
        if (target) { fireLaser(mother, target, cfg.mothershipDamage, "#ff667c"); mother.nextAttack = time + cfg.mothershipInterval; }
      }
    }
    for (const ship of ships) {
      if (!ship.alive || ship.entity !== "fighter") continue;
      const mother = nestRecords.get(ship.mother);
      if (ship.mode === "dock") {
        ship.vx = 0; ship.vy = 0;
        if (!mother?.alive) { ship.mode = "spent"; continue; }
        ship.dockTime -= dt;
        if (ship.dockTime <= 0) { ship.shots = cfg.shots; ship.mode = "attack"; }
        continue;
      }
      if (ship.shots <= 0) ship.mode = mother?.alive ? "return" : "spent";
      if (ship.mode === "spent") { ship.vx *= .9; ship.vy *= .9; continue; }
      let target = ship.mode === "return" ? mother : nearestFleetTarget(ship, cfg.engagementRange);
      if (!target && mother?.alive) target = { x: mother.x + Math.cos(time * .25 + ship.phase) * 65, y: mother.y + Math.sin(time * .25 + ship.phase) * 65 };
      if (!target) { ship.vx *= .9; ship.vy *= .9; continue; }
      const dx = target.x - ship.x, dy = target.y - ship.y, distance = Math.hypot(dx, dy);
      const desired = ship.mode === "return" ? cfg.fighterSpeed : distance < cfg.range * .7 ? 0 : cfg.fighterSpeed;
      const blend = 1 - Math.exp(-dt * 4);
      ship.vx += ((distance ? dx / distance * desired : 0) - ship.vx) * blend;
      ship.vy += ((distance ? dy / distance * desired : 0) - ship.vy) * blend;
      if (ship.mode === "return" && distance < 20) { ship.mode = "dock"; ship.dockTime = cfg.resupplySeconds; ship.vx = 0; ship.vy = 0; }
      else if (ship.mode === "attack" && target.civ && distance < cfg.range && time >= ship.nextAttack) {
        fireLaser(ship, target, cfg.damage, "#ff526e"); ship.shots--; ship.nextAttack = time + cfg.interval;
        if (ship.shots === 0) ship.mode = mother?.alive ? "return" : "spent";
      }
    }
  }

  function absorb(a, b) {
    if (!a.alive || !b.alive) return false;
    if (a.natural || b.natural || b.type !== 0) return false;
    if (isPlanet(a) && (b.host !== a.id || bodyMass(a) <= bodyMass(b) * CAPTURE.massRatio || Math.hypot(b.x - a.x, b.y - a.y) >= GRAVITY.captureRange(a))) return false;
    const oldType = a.type, mass = bodyMass(a) + bodyMass(b);
    a.vx = (a.vx * bodyMass(a) + b.vx * bodyMass(b)) / mass;
    a.vy = (a.vy * bodyMass(a) + b.vy * bodyMass(b)) / mass;
    gainMass(a, bodyMass(b)); b.alive = false;
    burst(b.x, b.y, TYPES[b.type].color, a === player ? 13 : 4, 16);
    if (a === player) {
      limitPlayerSpeed();
      absorbed++; peakMass = Math.max(peakMass, a.mass);
      if (a.type !== oldType) {
        announce(`晋升为${TYPES[a.type].name} · ${oldType === 0 ? "从小天体侧面掠过，捕获卫星" : "引力正在增强"}`, 5);
        burst(a.x, a.y, TYPES[a.type].color, 60, 60);
      }
    }
    if (b === player) die("你被一颗更大的天体吸收了。");
    return true;
  }

  function die(reason) {
    ended = true; jumping = false; clearMovement();
    ui["end-description"].textContent = `${reason} 最高质量 ${peakMass.toFixed(1)}，吸收了 ${absorbed} 颗天体，漂流 ${Math.floor(time).toLocaleString()} 年，累计路程 ${Math.floor(driftDistance).toLocaleString()} km。`;
    ui["end-screen"].hidden = false;
  }

  function collide(a, b) {
    if (!a.alive || !b.alive) return;
    // 同一主星的卫星之间不发生碰撞、融合或碰撞伤害。
    if (a.host !== null && a.host === b.host) return;
    const sx = b.px - a.px, sy = b.py - a.py;
    const dx = (b.x - a.x) - sx, dy = (b.y - a.y) - sy;
    const t = clamp(-(sx * dx + sy * dy) / (dx * dx + dy * dy || 1), 0, 1);
    const radius = a.radius + b.radius;
    if ((sx + dx * t) ** 2 + (sy + dy * t) ** 2 > radius * radius) return;
    if (a.natural || b.natural) {
      if (a.natural && b.natural) return;
      const source = a.natural ? a : b, target = a.natural ? b : a;
      if (TYPES[source.type].kind === "black-hole") destroyUnit(target, source, "hazard");
      else {
        if (target.cooldown > time) return;
        damageUnit(target, Math.max(CONFIG.hazards.contactMinimum, bodyMass(target) * CONFIG.hazards.contactFraction), source, "hazard");
        const angle = Math.atan2(target.y - source.y, target.x - source.x);
        target.x = source.x + Math.cos(angle) * (radius + 2);
        target.y = source.y + Math.sin(angle) * (radius + 2);
        target.vx = source.vx + Math.cos(angle) * 35; target.vy = source.vy + Math.sin(angle) * 35;
        target.cooldown = time + .5;
      }
      return;
    }
    if (a.cooldown > time || b.cooldown > time) return;
    const speed = Math.hypot(b.vx - a.vx, b.vy - a.vy);
    let large = a.mass >= b.mass ? a : b, small = large === a ? b : a;
    if (a.type === 0 && b.type === 0 && (speed < 28 || (large.mass > small.mass * 5 && speed < 72))) { absorb(large, small); return; }
    const nx0 = sx + dx * t, ny0 = sy + dy * t;
    const length = Math.hypot(nx0, ny0);
    const nx = length > .0001 ? nx0 / length : 1, ny = length > .0001 ? ny0 / length : 0;
    const massA = bodyMass(a), massB = bodyMass(b), total = massA + massB;
    // 回到碰撞时刻并分离，避免高速穿透和重叠后的连续损伤。
    a.x = a.px + (a.x - a.px) * t; a.y = a.py + (a.y - a.py) * t;
    b.x = a.x + nx * (radius + .2); b.y = a.y + ny * (radius + .2);
    const relative = (b.vx - a.vx) * nx + (b.vy - a.vy) * ny;
    if (relative < 0) {
      const impulse = -(1 + .65) * relative / (1 / massA + 1 / massB);
      a.vx -= impulse * nx / massA; a.vy -= impulse * ny / massA;
      b.vx += impulse * nx / massB; b.vy += impulse * ny / massB;
    }
    a.cooldown = b.cooldown = time + .3;
    const loss = clamp(speed / 600, CONFIG.combat.collisionMinLoss, CONFIG.combat.collisionMaxLoss);
    // 撞击损失的质量直接耗散，不生成实体天体。
    damageUnit(a, massA * loss, b, "collision");
    damageUnit(b, massB * loss, a, "collision");
    burst(a.x, a.y, "#f7cc9c", Math.min(25, Math.ceil(total)), 50);
    if (a === player || b === player) {
      shake = 4;
      if (!ended) announce("发生碰撞 · 护盾优先承伤，无盾时损失质量与人口");
    }
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
    let spatial = GRAVITY.accumulate(bodies);
    updateCaptures(spatial); applyOrbitAssists();
    const count = GRAVITY.substeps(bodies, dt), h = dt / count;
    // 固定主步长内细分高速和强引力运动，每个子步完整执行积分与扫掠检测。
    for (let i = 0; i < count; i++) {
      time += h;
      if (i > 0) { spatial = GRAVITY.accumulate(bodies); updateCaptures(spatial); applyOrbitAssists(); }
      for (const b of bodies) {
        b.px = b.x; b.py = b.y;
        GRAVITY.kick(b, h * .5, thrust);
        b.x += b.vx * h; b.y += b.vy * h;
        // 累计物理移动路程，跃迁与镜头移动不计入漂流距离。
        if (b === player) driftDistance += Math.hypot(b.x - b.px, b.y - b.py);
      }
      spatial = GRAVITY.accumulate(bodies);
      updateCaptures(spatial); applyOrbitAssists();
      for (const b of bodies) GRAVITY.kick(b, h * .5, thrust);
      updateHazards();
      collisions();
      if (ended) return;
    }
    if (time >= nextCivilization) {
      nextCivilization += CONFIG.civilization.tick;
      updateCivilizations(CONFIG.civilization.tick);
    }
    if (time >= nextCombat) {
      nextCombat = time + CONFIG.combat.tick;
      updateCombat(CONFIG.combat.tick);
      if (player.civ.tech < 4 || !player.civ.city) jumping = false;
    }
    if (ended) return;
    for (const ship of ships) if (ship.alive) {
      ship.x += ship.vx * dt; ship.y += ship.vy * dt;
      if (ship.entity === "fighter") {
        const mother = nestRecords.get(ship.mother);
        const dx = ship.x - mother.x, dy = ship.y - mother.y, distance = Math.hypot(dx, dy);
        if (distance > CONFIG.nests.activityRadius) {
          const nx = dx / distance, ny = dy / distance;
          ship.x = mother.x + nx * CONFIG.nests.activityRadius;
          ship.y = mother.y + ny * CONFIG.nests.activityRadius;
          // 活动边界移除向外速度，保留沿边界及返回母舰的运动。
          const outward = Math.max(0, ship.vx * nx + ship.vy * ny);
          ship.vx -= nx * outward; ship.vy -= ny * outward;
        }
      }
    }
    bodies = bodies.filter(b => b.alive);
    ships = ships.filter(s => s.alive);
    for (const beam of beams) beam.life -= dt;
    beams = beams.filter(beam => beam.life > 0);
    limitPlayerSpeed();
    if (player.alive && time >= player.trailAt) {
      player.trailAt = time + .12;
      player.trail.push({ x: player.x, y: player.y });
      if (player.trail.length > 95) player.trail.shift();
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
      const fieldIndex = GRAVITY.spatialIndex(bodies), protectedIds = new Set(retainedIds);
      const visible = bodies.filter(b => retainedIds.has(b.id) || (Math.abs(screenX(b.x) - width / 2) <= width / 2 + 180 && Math.abs(screenY(b.y) - height / 2) <= height / 2 + 180));
      for (const b of visible) {
        protectedIds.add(b.id);
        for (const other of fieldIndex.query(b.x, b.y, fieldIndex.maxRange)) {
          if (Math.hypot(other.x - b.x, other.y - b.y) <= Math.max(GRAVITY.range(b), GRAVITY.range(other))) protectedIds.add(other.id);
        }
      }
      bodies = bodies.filter(b => protectedIds.has(b.id) || Math.hypot(b.x - player.x, b.y - player.y) < retention + GRAVITY.range(b));
      // 仅替换视野外的低阶天体，晋升后逐步更新环境质量分布。
      let replacements = 0;
      bodies = bodies.filter(b => {
        const offscreen = Math.abs(screenX(b.x) - width / 2) > width / 2 + 180 || Math.abs(screenY(b.y) - height / 2) > height / 2 + 180;
        if (replacements < 8 && !protectedIds.has(b.id) && b.host === null && b.type < player.type - 2 && offscreen) { replacements++; return false; }
        return true;
      });
      for (let i = 0, count = Math.min(POPULATION.batch, POPULATION.target - bodies.length); i < count; i++) spawnAmbient();
      manageNests();
    }
  }

  function updateHazards() {
    const sources = bodies.filter(b => b.alive && b.natural);
    for (const body of bodies) {
      if (!body.alive || body.natural) continue;
      const blackHole = sources.find(s => TYPES[s.type].kind === "black-hole" && GRAVITY.closestApproach(body, s) <= s.radius + body.radius);
      if (blackHole) { destroyUnit(body, blackHole, "hazard"); continue; }
      if (time < body.hazardReady) continue;
      const source = sources.find(s => GRAVITY.closestApproach(body, s) < TYPES[s.type].hazardRange + body.radius);
      if (!source) continue;
      body.hazardReady = time + CONFIG.hazards.interval;
      damageUnit(body, Math.max(CONFIG.hazards.minimumDamage, bodyMass(body) * CONFIG.hazards.damageFraction), source, "hazard");
    }
  }

  function jumpClear(body, x, y) {
    const members = bodies.filter(b => b.alive && (b === body || b.host === body.id));
    const memberIds = new Set(members.map(b => b.id));
    for (const member of members) {
      const tx = x + member.x - body.x, ty = y + member.y - body.y;
      for (const other of [...bodies, ...ships]) {
        if (!other.alive || memberIds.has(other.id)) continue;
        const clearance = other.natural ? TYPES[other.type].hazardRange : other.radius;
        if (Math.hypot(tx - other.x, ty - other.y) <= member.radius + clearance + CONFIG.jump.clearance) return false;
      }
    }
    return true;
  }

  function performJump(body, x, y) {
    if (body === player && (screenX(x) < 0 || screenX(x) > width || screenY(y) < 0 || screenY(y) > height)) return false;
    if (!body.alive || !body.civ.city || body.civ.tech < 4 || time < body.jumpReady || !jumpClear(body, x, y)) return false;
    const dx = x - body.x, dy = y - body.y;
    const members = bodies.filter(b => b.alive && (b === body || b.host === body.id));
    for (const member of members) {
      burst(member.x, member.y, "#b9aaff", 12, 22);
      member.x += dx; member.y += dy; member.px = member.x; member.py = member.y;
      member.trail = [];
      burst(member.x, member.y, "#94e8ff", 18, 28);
    }
    body.jumpReady = time + CONFIG.jump.cooldown;
    warningCache.at = -Infinity;
    if (body === player) { jumping = false; announce("空间跃迁完成 · 卫星随行，保留惯性"); }
    return true;
  }

  function jumpTarget() {
    return { x: camera.x + (pointer.x - width / 2) / camera.zoom, y: camera.y + (pointer.y - height / 2) / camera.zoom };
  }

  function toggleJump() {
    if (paused || ended || choosingStart) return;
    if (jumping) { jumping = false; return; }
    if (!player.civ.city || player.civ.tech < 4) { announce("4 级文明建成太空城后解锁跃迁"); return; }
    if (time < player.jumpReady) { announce(`跃迁冷却 ${Math.ceil(player.jumpReady - time)} 秒`); return; }
    jumping = true;
    announce("选择可见空旷地带 · 左键跃迁 · 右键 / Esc 取消 · 时间继续流逝");
  }

  function playerSnapshot() {
    const c = player.civ;
    return {
      version: 1, savedAt: Date.now(), mass: player.mass, cityMass: player.cityMass,
      healthyMass: player.healthyMass, peakMass, absorbed, elapsed: time, distance: driftDistance,
      jumpRemaining: Math.max(0, player.jumpReady - time),
      civ: { population: c.population, tech: c.tech, research: c.research, shield: c.shield,
        incubation: c.incubation, extinct: c.extinct, city: c.city, hitAgo: Math.min(CONFIG.civilization.shieldDelay, time - c.lastHit) },
      kills: { ...player.kills }
    };
  }

  function validSnapshot(s) {
    if (!s || s.version !== 1 || !s.civ || !s.kills) return false;
    const numeric = [s.savedAt, s.mass, s.cityMass, s.healthyMass, s.peakMass, s.absorbed, s.elapsed, s.distance === undefined ? 0 : s.distance, s.jumpRemaining,
      s.civ.population, s.civ.tech, s.civ.research, s.civ.shield, s.civ.incubation, s.civ.hitAgo,
      s.kills.asteroid, s.kills.planet, s.kills.fighter, s.kills.mothership];
    if (!numeric.every(n => typeof n === "number" && Number.isFinite(n) && n >= 0)) return false;
    if (s.mass < .6 || s.mass > CONFIG.maxPlanetMass || !Number.isInteger(s.civ.tech) || s.civ.tech > 5) return false;
    if (typeof s.civ.extinct !== "boolean" || typeof s.civ.city !== "boolean") return false;
    if (s.civ.city !== (s.civ.tech >= 4) || s.civ.shield > CONFIG.civilization.technology[s.civ.tech].shield) return false;
    const savedBody = { type: typeOf(s.mass), natural: false, cityMass: s.cityMass, civ: s.civ };
    if (s.civ.population > CIV.capacity(savedBody) || (s.civ.population > 0 && s.civ.population < 1)) return false;
    if (s.civ.extinct && s.civ.population > 0) return false;
    if (s.civ.population === 0 && (s.civ.tech > 0 || s.civ.research > 0 || s.civ.shield > 0)) return false;
    const total = s.mass + s.cityMass;
    return Number.isFinite(total) && s.healthyMass >= total && total >= s.healthyMass * .5 && s.peakMass >= total;
  }

  function readSave() {
    const status = document.getElementById("save-summary"), load = document.getElementById("load-save");
    savedGame = null; load.disabled = true;
    try {
      const raw = localStorage.getItem(CONFIG.saveKey);
      if (raw === null) { status.textContent = "暂无存档 · 开始后每秒自动保存。"; return; }
      const snapshot = JSON.parse(raw);
      if (!validSnapshot(snapshot)) { status.textContent = "存档内容无效，无法读取。"; return; }
      savedGame = snapshot; load.disabled = false;
      status.textContent = `${TYPES[typeOf(snapshot.mass)].name} · 科技 ${snapshot.civ.tech} · 人口 ${Math.floor(snapshot.civ.population).toLocaleString()} · ${new Date(snapshot.savedAt).toLocaleString()}`;
    } catch (error) {
      status.textContent = `无法读取本地存档：${error.message}`;
    }
  }

  function savePlayer() {
    if (!player?.alive || ended || choosingStart) return;
    try {
      localStorage.setItem(CONFIG.saveKey, JSON.stringify(playerSnapshot()));
      document.getElementById("save-status").textContent = "已自动保存 · 每秒更新。";
    } catch (error) {
      document.getElementById("save-status").textContent = `保存失败：${error.message}`;
    }
  }

  function restorePlayer(snapshot) {
    player.mass = snapshot.mass; player.cityMass = snapshot.cityMass; player.healthyMass = snapshot.healthyMass;
    time = snapshot.elapsed; peakMass = snapshot.peakMass; absorbed = snapshot.absorbed;
    // 未记录历史距离的存档从零开始累计，原有时间保持不变。
    driftDistance = snapshot.distance ?? 0;
    player.civ = { ...snapshot.civ, lastHit: time - snapshot.civ.hitAgo };
    delete player.civ.hitAgo;
    player.kills = { ...snapshot.kills };
    player.jumpReady = time + snapshot.jumpRemaining;
    nextPopulation = time + 2;
    updateSize(player);
    Object.assign(player, initialVelocity(bodyMass(player)));
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
  function nearbyWarnings() {
    if (!player?.alive) return [];
    if (time - warningCache.at < CONFIG.warning.refreshSeconds) return warningCache.records.filter(w => w.body.alive);
    const settings = CONFIG.warning, warnings = [];
    const candidates = bodies.filter(body => body.alive && body !== player && (body.natural || (isPlanet(body) && bodyMass(body) > bodyMass(player) * settings.massRatio)));
    const predicted = candidates.length ? GRAVITY.predictClosest(bodies, player.id, candidates.map(b => b.id), settings.lookAheadSeconds, thrust) : new Map();
    for (const body of candidates) {
      const distance = Math.hypot(body.x - player.x, body.y - player.y);
      const field = TYPES[body.type];
      const danger = body.natural ? field.hazardRange + player.radius : Math.max(body.radius + player.radius, CIV.stats(body).range);
      const imminent = predicted.get(body.id) <= danger;
      if (distance > Math.max(GRAVITY.range(body), GRAVITY.range(player), danger) + settings.padding && !imminent) continue;
      warnings.push({ body, distance, imminent });
    }
    warningCache = { at: time, records: warnings.sort((a, b) => Number(b.imminent) - Number(a.imminent) || a.distance - b.distance).slice(0, settings.limit) };
    return warningCache.records;
  }

  function drawWarnings() {
    for (const warning of nearbyWarnings()) {
      const body = warning.body, x = screenX(body.x), y = screenY(body.y);
      const color = warning.imminent ? "#ff6575" : "#ffc375";
      ctx.save(); ctx.strokeStyle = color; ctx.fillStyle = color; ctx.lineWidth = 1;
      ctx.globalAlpha = .65 + .35 * Math.sin(time * (warning.imminent ? 7 : 3)) ** 2;
      if (x >= 20 && x <= width - 20 && y >= 20 && y <= height - 20) {
        ctx.beginPath(); ctx.arc(x, y, body.radius * camera.zoom + 10, 0, Math.PI * 2); ctx.stroke();
        ctx.translate(x, y - body.radius * camera.zoom - 20);
        ctx.beginPath(); ctx.moveTo(0, -5); ctx.lineTo(5, 4); ctx.lineTo(-5, 4); ctx.closePath(); ctx.stroke();
      } else {
        const dx = x - width / 2, dy = y - height / 2;
        const edge = Math.min(Math.max(0, width / 2 - 20) / Math.max(Math.abs(dx), .001), Math.max(0, height / 2 - 20) / Math.max(Math.abs(dy), .001));
        ctx.translate(width / 2 + dx * edge, height / 2 + dy * edge); ctx.rotate(Math.atan2(dy, dx));
        ctx.beginPath(); ctx.moveTo(6, 0); ctx.lineTo(-5, -4); ctx.lineTo(-5, 4); ctx.closePath(); ctx.fill();
      }
      ctx.restore();
    }
  }

  function circle(x, y, radius, color) { ctx.beginPath(); ctx.arc(x, y, radius, 0, Math.PI * 2); ctx.fillStyle = color; ctx.fill(); }
  function glow(x, y, r, color) {
    const gradient = ctx.createRadialGradient(x, y, 0, x, y, r);
    gradient.addColorStop(0, color); gradient.addColorStop(1, "transparent");
    ctx.fillStyle = gradient; ctx.fillRect(x - r, y - r, r * 2, r * 2);
  }

  function drawBody(b) {
    if (!b.alive) return;
    const x = screenX(b.x), y = screenY(b.y), r = b.radius * camera.zoom, color = TYPES[b.type].color;
    const kind = TYPES[b.type].kind;
    const margin = Math.max(80, r * 12);
    if (x < -margin || x > width + margin || y < -margin || y > height + margin) return;
    if (showTrails && b === player && b.trail.length > 1) {
      ctx.beginPath();
      b.trail.forEach((p, i) => i ? ctx.lineTo(screenX(p.x), screenY(p.y)) : ctx.moveTo(screenX(p.x), screenY(p.y)));
      ctx.strokeStyle = "#77b7c74d"; ctx.lineWidth = .7; ctx.stroke();
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
    } else if (kind === "star") {
      const pulse = Math.sin(time * 1.5 + b.phase);
      ctx.save(); ctx.globalCompositeOperation = "lighter";
      glow(x, y, r * (10 + pulse * .5), `${color}20`);
      glow(x, y, r * (5 + pulse * .3), `${color}45`);
      for (let i = 0; i < 10; i++) {
        const angle = b.phase + i * Math.PI / 5 + time * .025;
        const length = r * (2.8 + .6 * Math.sin(time * .7 + i));
        const corona = ctx.createLinearGradient(x, y, x + Math.cos(angle) * length, y + Math.sin(angle) * length);
        corona.addColorStop(0, `${color}88`); corona.addColorStop(1, `${color}00`);
        ctx.beginPath(); ctx.moveTo(x + Math.cos(angle) * r, y + Math.sin(angle) * r);
        ctx.lineTo(x + Math.cos(angle) * length, y + Math.sin(angle) * length);
        ctx.strokeStyle = corona; ctx.lineWidth = Math.max(1, r * .35); ctx.stroke();
      }
      ctx.restore();
      glow(x, y, r * 1.8, `${color}66`); circle(x, y, r, color);
      circle(x - r * .16, y - r * .14, r * .6, "#fff7e7bb");
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
    if (b.natural) {
      ctx.beginPath(); ctx.arc(x, y, TYPES[b.type].hazardRange * camera.zoom, 0, Math.PI * 2);
      ctx.strokeStyle = `${color}28`; ctx.lineWidth = .6; ctx.stroke();
      return;
    }
    const c = b.civ, shell = (b.radius + 4) * camera.zoom;
    if (c.population > 0) {
      const lights = Math.min(6, 1 + Math.floor(Math.log10(c.population)));
      for (let i = 0; i < lights; i++) {
        const angle = b.phase + i * 2.4 + time * .04;
        circle(x + Math.cos(angle) * r * .65, y + Math.sin(angle) * r * .65, .55 * camera.zoom, "#fff4bb");
      }
    }
    if (c.shield > 0) {
      const fraction = c.shield / CIV.stats(b).shield;
      ctx.save(); ctx.globalAlpha = .15 + fraction * .55;
      ctx.beginPath(); ctx.arc(x, y, shell, 0, Math.PI * 2);
      ctx.strokeStyle = c.city ? "#cebdff" : "#7adcff"; ctx.lineWidth = .75 + c.tech * .1; ctx.stroke();
      if (time - c.lastHit < .3) glow(x, y, shell * 1.8, "#b6ebff55");
      ctx.restore();
    }
    if (c.city) {
      ctx.beginPath();
      for (let i = 0; i <= 12; i++) {
        const angle = i * Math.PI / 6 + b.phase + time * .035;
        const cx = x + Math.cos(angle) * shell, cy = y + Math.sin(angle) * shell;
        if (i === 0) ctx.moveTo(cx, cy); else ctx.lineTo(cx, cy);
      }
      ctx.strokeStyle = "#d0c4ee99"; ctx.lineWidth = .7; ctx.stroke();
      for (let i = 0; i < 6; i++) {
        const angle = i * Math.PI / 3 + b.phase + time * .035;
        ctx.fillStyle = "#decaff";
        ctx.fillRect(x + Math.cos(angle) * shell - 1, y + Math.sin(angle) * shell - 1, 2, 2);
      }
    }
    // 人造卫星是文明设施的绘制标记，不创建可攻击实体。
    if (c.tech >= 3) for (let i = 0; i < 3; i++) {
      const angle = time * .25 + b.phase + i * Math.PI * 2 / 3, orbit = shell + 5 * camera.zoom;
      const sx = x + Math.cos(angle) * orbit, sy = y + Math.sin(angle) * orbit;
      ctx.fillStyle = "#91cce3"; ctx.fillRect(sx - 2 * camera.zoom, sy - .5, 4 * camera.zoom, 1);
      circle(sx, sy, Math.max(.6, camera.zoom), "#edf9ff");
    }
  }

  function drawMothership(ship, r) {
    const pulse = .75 + .25 * Math.sin(time * 2);
    for (const side of [-1, 1]) {
      glow(-r * .8, side * r * .35, r * .7, "#9d75ff44");
      ctx.beginPath(); ctx.moveTo(-r * .8, side * r * .35);
      ctx.lineTo(-r * (1 + pulse * .25), side * r * .35);
      ctx.strokeStyle = "#bda1ff"; ctx.lineWidth = r * .12; ctx.stroke();
    }
    const hull = ctx.createLinearGradient(0, -r, 0, r);
    hull.addColorStop(0, "#c28899"); hull.addColorStop(.45, "#643c56"); hull.addColorStop(1, "#281f37");
    ctx.beginPath();
    const outline = [[1, 0], [.4, .45], [.1, .7], [-.65, .7], [-1, .25], [-1, -.25], [-.65, -.7], [.1, -.7], [.4, -.45]];
    outline.forEach(([x, y], i) => i ? ctx.lineTo(x * r, y * r) : ctx.moveTo(x * r, y * r));
    ctx.closePath(); ctx.fillStyle = hull; ctx.fill();
    ctx.strokeStyle = "#e9a6b8"; ctx.lineWidth = .8; ctx.stroke();
    for (const side of [-1, 1]) {
      ctx.beginPath(); ctx.moveTo(r * .45, side * r * .2);
      ctx.lineTo(0, side * r * .58); ctx.lineTo(-r * .6, side * r * .58);
      ctx.lineTo(-r * .8, side * r * .25); ctx.lineTo(-r * .2, side * r * .3);
      ctx.closePath(); ctx.fillStyle = "#916778"; ctx.fill();
      ctx.strokeStyle = "#d1a0b177"; ctx.lineWidth = .5; ctx.stroke();
      ctx.fillStyle = "#100f20"; ctx.fillRect(-r * .45, side * r * .42 - r * .08, r * .35, r * .16);
      ctx.strokeStyle = ship.fleet.some(f => f.alive && f.mode === "dock") ? "#8fe9ef" : "#f0b874";
      ctx.beginPath(); ctx.moveTo(-r * .45, side * r * .42); ctx.lineTo(-r * .1, side * r * .42); ctx.stroke();
      circle(r * .15, side * r * .46, Math.max(.5, r * .045), "#ffced8");
    }
    ctx.beginPath(); ctx.moveTo(-r * .65, 0); ctx.lineTo(r * .75, 0);
    ctx.strokeStyle = "#d6b7ca"; ctx.lineWidth = r * .1; ctx.stroke();
    circle(r * .05, 0, r * .23, "#241c35");
    circle(r * .05, 0, r * .12, "#ffdae9");
    glow(r * .05, 0, r * .6, "#fa89bf44");
  }

  function drawShip(ship) {
    if (!ship.alive) return;
    const x = screenX(ship.x), y = screenY(ship.y), r = ship.radius * camera.zoom;
    if (x < -30 || x > width + 30 || y < -30 || y > height + 30) return;
    ctx.save(); ctx.translate(x, y);
    ctx.rotate(ship.entity === "mothership" ? time * .05 : Math.atan2(ship.vy, ship.vx));
    if (ship.entity === "mothership") drawMothership(ship, r);
    else {
      ctx.beginPath(); ctx.moveTo(r, 0); ctx.lineTo(-r, r * .7); ctx.lineTo(-r * .4, 0); ctx.lineTo(-r, -r * .7);
      ctx.closePath(); ctx.fillStyle = ship.mode === "spent" ? "#635d69" : "#ac4e67"; ctx.fill();
      ctx.strokeStyle = "#ff92a0"; ctx.lineWidth = .7; ctx.stroke();
    }
    ctx.restore();
    if (ship.hp < ship.maxHp) {
      ctx.fillStyle = "#6c3b47"; ctx.fillRect(x - r, y - r - 4, r * 2, 1);
      ctx.fillStyle = "#ff9bad"; ctx.fillRect(x - r, y - r - 4, r * 2 * Math.max(0, ship.hp / ship.maxHp), 1);
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
    if (player?.alive) {
      ctx.save(); ctx.beginPath();
      ctx.arc(screenX(player.x), screenY(player.y), GRAVITY.range(player) * camera.zoom, 0, Math.PI * 2);
      ctx.setLineDash([3, 7]); ctx.strokeStyle = `${TYPES[player.type].color}30`; ctx.lineWidth = .6; ctx.stroke(); ctx.restore();
      if (isPlanet(player)) {
        ctx.save(); ctx.beginPath();
        ctx.arc(screenX(player.x), screenY(player.y), GRAVITY.captureRange(player) * camera.zoom, 0, Math.PI * 2);
        ctx.setLineDash([1, 4]); ctx.strokeStyle = `${TYPES[player.type].color}55`; ctx.lineWidth = .6; ctx.stroke(); ctx.restore();
      }
      ctx.beginPath();
      for (const b of bodies) {
        if (!b.alive || b.host !== player.id) continue;
        ctx.moveTo(screenX(player.x), screenY(player.y));
        ctx.lineTo(screenX(b.x), screenY(b.y));
      }
      ctx.strokeStyle = "#a9d9e066"; ctx.lineWidth = .6; ctx.stroke();
      const selected = bodies.find(b => b.alive && b.host === player.id && b.id === selectedSatelliteId);
      if (selected) {
        ctx.beginPath(); ctx.arc(screenX(selected.x), screenY(selected.y), selected.radius * camera.zoom + 6, 0, Math.PI * 2);
        ctx.strokeStyle = "#b6f0da"; ctx.lineWidth = 1; ctx.stroke();
      }
    }
    for (const b of bodies) drawBody(b);
    for (const ship of ships) drawShip(ship);
    for (const beam of beams) {
      ctx.globalAlpha = clamp(beam.life / .18, 0, 1);
      ctx.beginPath(); ctx.moveTo(screenX(beam.x), screenY(beam.y)); ctx.lineTo(screenX(beam.tx), screenY(beam.ty));
      ctx.strokeStyle = beam.color; ctx.lineWidth = .9; ctx.stroke();
    }
    ctx.globalAlpha = 1;
    for (const p of particles) { ctx.globalAlpha = clamp(p.life / p.total, 0, 1); circle(screenX(p.x), screenY(p.y), Math.max(.55, camera.zoom), p.color); }
    ctx.globalAlpha = 1;
    if (player?.alive) {
      const x = screenX(player.x), y = screenY(player.y), ring = Math.max(13, player.radius * camera.zoom + 8);
      ctx.beginPath(); ctx.arc(x, y, ring, 0, Math.PI * 2); ctx.strokeStyle = "#b6d9e266"; ctx.lineWidth = .7; ctx.stroke();
      const speed = Math.hypot(player.vx, player.vy);
      if (speed > 2) { const size = clamp(speed * .35, 18, 65); ctx.beginPath(); ctx.moveTo(x + player.vx / speed * (ring + 3), y + player.vy / speed * (ring + 3)); ctx.lineTo(x + player.vx / speed * (ring + size), y + player.vy / speed * (ring + size)); ctx.strokeStyle = "#95b9cd44"; ctx.stroke(); }
      if (thrust.active) {
        const tipX = x + thrust.x * (ring + 28), tipY = y + thrust.y * (ring + 28);
        ctx.beginPath(); ctx.moveTo(x + thrust.x * (ring + 7), y + thrust.y * (ring + 7)); ctx.lineTo(tipX, tipY); ctx.strokeStyle = "#88e5d9aa"; ctx.stroke();
        ctx.beginPath(); ctx.moveTo(tipX, tipY); ctx.lineTo(tipX - thrust.x * 5 - thrust.y * 3, tipY - thrust.y * 5 + thrust.x * 3); ctx.lineTo(tipX - thrust.x * 5 + thrust.y * 3, tipY - thrust.y * 5 - thrust.x * 3); ctx.closePath(); ctx.fillStyle = "#88e5d9"; ctx.fill();
      }
      drawWarnings();
    }
    if (jumping && player?.alive) {
      const target = jumpTarget(), clear = jumpClear(player, target.x, target.y);
      ctx.save(); ctx.setLineDash([3, 4]);
      ctx.beginPath(); ctx.arc(pointer.x, pointer.y, (player.radius + CONFIG.jump.clearance) * camera.zoom, 0, Math.PI * 2);
      ctx.moveTo(screenX(player.x), screenY(player.y)); ctx.lineTo(pointer.x, pointer.y);
      ctx.strokeStyle = clear ? "#91f3ce" : "#ff8b94"; ctx.lineWidth = 1; ctx.stroke();
      ctx.restore();
    }
    ctx.restore();
  }

  function refreshHud() {
    if (choosingStart) return;
    const type = TYPES[player.type], c = player.civ, growth = CIV.progress(player);
    const percent = growth.total > 0 ? clamp(growth.value / growth.total * 100, 0, 100) : 0;
    ui.stage.textContent = type.name; ui["stage-dot"].style.background = type.color; ui["stage-dot"].style.color = type.color;
    ui.mass.textContent = player.mass.toFixed(1); ui.speed.textContent = Math.hypot(player.vx, player.vy).toFixed(1);
    const format = n => Math.floor(n).toLocaleString();
    document.getElementById("drift-distance").textContent = `${format(driftDistance)} km`;
    document.getElementById("drift-time").textContent = `${format(time)} 年`;
    const warnings = nearbyWarnings();
    document.getElementById("hazard-warning-row").hidden = warnings.length === 0;
    document.getElementById("hazard-warning").textContent = warnings.map(w => `${w.imminent ? "危险" : "接近"} · ${TYPES[w.body.type].name} ${Math.floor(w.distance)}px`).join("；");
    document.getElementById("hazard-warning").style.color = warnings.some(w => w.imminent) ? "#ff6575" : "#ffc375";
    document.getElementById("life-stat").textContent = `${format(c.population)} / ${format(CIV.capacity(player))}`;
    document.getElementById("tech-stat").textContent = `${c.tech} 级`;
    document.getElementById("shield-stat").textContent = `${c.shield.toFixed(1)} / ${CIV.stats(player).shield}`;
    document.getElementById("city-stat").textContent = player.cityMass.toFixed(1);
    document.getElementById("city-row").hidden = player.cityMass <= 0 && !c.city;
    const totalKills = Object.values(player.kills).reduce((sum, n) => sum + n, 0);
    document.getElementById("kills-stat").textContent = format(totalKills);
    const satellites = bodies.filter(b => b.alive && b.host === player.id);
    ui.satellites.textContent = `${satellites.length}/${satelliteLimit(player.type)}`;
    if (!satellites.some(b => b.id === selectedSatelliteId)) { selectedSatelliteId = null; satelliteClickAt = -Infinity; }
    ui.speed.title = `推进上限 ${playerSpeedLimit(player.type)} · 总速度上限 ${GRAVITY.speedLimit(player)}`;
    document.getElementById("gravity-status").textContent = `引力半径 ${GRAVITY.range(player).toFixed(1)}px · 捕获半径 ${GRAVITY.captureRange(player).toFixed(1)}px · 引力质量 ${bodyMass(player).toFixed(1)}`;
    const selected = satellites.find(b => b.id === selectedSatelliteId);
    document.getElementById("satellite-selection").textContent = selected
      ? `选中 ${TYPES[selected.type].name} #${selected.id} · 质量 ${selected.mass.toFixed(1)} · L 吸收`
      : "K 循环选择卫星 · L 吸收";
    ui["next-stage"].textContent = growth.label;
    ui["progress-text"].textContent = `${Math.floor(percent)}%`; ui.progress.style.width = `${percent}%`;
    ui.progress.style.background = type.color;
    ui["drive-status"].textContent = ended ? "信号消逝" : paused ? "时间已暂停" : thrust.active ? "推进中 · 松开 WASD 停止推进" : "惯性滑行 · WASD 推进";
    ui["world-status"].textContent = ended ? "旅程结束" : paused ? "引力场已暂停" : `引力场运行中 · ${bodies.length} 颗天体`;
    ui.scale.textContent = `${camera.zoom.toFixed(2)}×`;
    const nextType = player.type < 7 ? TYPES[player.type + 1] : null;
    document.getElementById("mass-status").textContent = nextType ? `下一质量档：${nextType.name} · ${nextType.min}` : `本体上限 ${CONFIG.maxPlanetMass} · 超额质量进入太空城`;
    document.getElementById("civilization-status").textContent = growth.detail;
    document.getElementById("jump-status").textContent = c.tech < 4 ? "跃迁尚未解锁 · 需要 4 级文明太空城" : time < player.jumpReady ? `跃迁冷却 ${Math.ceil(player.jumpReady - time)} 秒` : "跃迁就绪 · T 选点，左键确认，右键 / Esc 取消";
    document.getElementById("damage-status").textContent = `结构质量 ${bodyMass(player).toFixed(1)} / 健康峰值 ${player.healthyMass.toFixed(1)} · 损失超过 50% 破碎`;
    document.getElementById("kills-status").textContent = `击毁：母舰 ${player.kills.mothership} · 攻击舰 ${player.kills.fighter} · 陨石 ${player.kills.asteroid} · 行星 ${player.kills.planet}`;
  }

  function togglePause() {
    if (ended || choosingStart) return;
    paused = !paused; accumulator = 0; jumping = false; clearMovement();
    if (paused) ui["pause-screen"].showModal();
    else { ui["pause-screen"].close(); ui.pause.blur(); }
    refreshHud();
  }
  function toggleOrbits() { showTrails = !showTrails; ui.orbits.setAttribute("aria-pressed", String(showTrails)); }
  function cycleSatellite() {
    if (choosingStart || ended) return;
    const satellites = bodies.filter(b => b.alive && b.host === player.id).sort((a, b) => a.id - b.id);
    satelliteClickAt = -Infinity;
    if (satellites.length === 0) { selectedSatelliteId = null; announce("当前没有可选择的卫星", 2); refreshHud(); return; }
    const index = satellites.findIndex(b => b.id === selectedSatelliteId);
    selectedSatelliteId = satellites[(index + 1) % satellites.length].id;
    refreshHud();
  }
  function absorbSelectedSatellite() {
    if (choosingStart || ended || paused) return;
    const satellite = bodies.find(b => b.alive && b.host === player.id && b.id === selectedSatelliteId);
    if (!satellite) { announce("先按 K 选择自己的卫星", 2); return; }
    const gain = satellite.mass, oldType = player.type;
    if (!absorb(player, satellite)) { announce("目标已不满足场内吸收条件", 2); return; }
    bodies = bodies.filter(b => b.alive);
    selectedSatelliteId = null; satelliteClickAt = -Infinity;
    announce(`吸收卫星 · 质量 +${gain.toFixed(1)}${player.type !== oldType ? ` · 晋升为${TYPES[player.type].name}` : ""}`, 3);
    refreshHud();
  }
  canvas.addEventListener("pointerdown", event => {
    pointer = { x: event.clientX, y: event.clientY };
    if (event.button === 2) { jumping = false; return; }
    if (event.button !== 0 || ended || paused || choosingStart) return;
    if (jumping) {
      const target = jumpTarget();
      if (!performJump(player, target.x, target.y)) announce("此处无法跃迁，请选择空旷位置并确认太空城仍在运行");
      refreshHud(); return;
    }
    let satellite = null, nearest = Infinity;
    for (const b of bodies) {
      if (!b.alive || b.host !== player.id) continue;
      const distance = Math.hypot(event.clientX - screenX(b.x), event.clientY - screenY(b.y));
      if (distance <= Math.max(12, b.radius * camera.zoom + 5) && distance < nearest) { satellite = b; nearest = distance; }
    }
    // 两次点击须命中同一颗卫星，卫星点击不改变推进方向。
    if (satellite) {
      const isDoubleClick = selectedSatelliteId === satellite.id && event.timeStamp - satelliteClickAt <= 350;
      selectedSatelliteId = satellite.id; satelliteClickAt = event.timeStamp;
      if (isDoubleClick) absorbSelectedSatellite();
      else refreshHud();
      return;
    }
    satelliteClickAt = -Infinity;
  });
  canvas.addEventListener("pointermove", event => { pointer = { x: event.clientX, y: event.clientY }; });
  canvas.addEventListener("contextmenu", event => { event.preventDefault(); jumping = false; });
  canvas.addEventListener("wheel", event => { event.preventDefault(); camera.targetZoom = clamp(camera.targetZoom * Math.exp(-event.deltaY * .001), .5, 2.5); }, { passive: false });
  ui.pause.addEventListener("click", togglePause); ui.orbits.addEventListener("click", toggleOrbits);
  document.getElementById("load-save").addEventListener("click", () => {
    readSave();
    if (!savedGame) return;
    startScreen.close(); reset(typeOf(savedGame.mass), savedGame);
    announce("存档已载入 · 新的宇宙，保留质量、文明、受损程度与击毁计数");
  });
  ui["pause-screen"].addEventListener("cancel", event => { event.preventDefault(); if (paused) togglePause(); });
  const startScreen = document.getElementById("start-screen");
  const startForm = document.getElementById("start-form");
  const startTypes = document.getElementById("start-types");
  function updateStartSummary() {
    const index = Number(startForm.elements.namedItem("start-type").value);
    const type = TYPES[index];
    document.getElementById("start-summary").textContent = `${type.name} · 初始质量 ${index === 0 ? 8 : type.min} · 基础半径 ${type.radius}px · 卫星上限 ${satelliteLimit(index)} · 推进上限 ${playerSpeedLimit(index)} · 总限 ${playerSpeedLimit(index) * CONFIG.gravity.playerSpeedMultiplier} · 引力半径 ${(type.gravityRange * CONFIG.gravity.playerRangeScale).toFixed(1)}px。`;
  }
  function openStartSelection() {
    choosingStart = true; accumulator = 0; jumping = false; clearMovement();
    ui["end-screen"].hidden = true;
    selectedSatelliteId = null; satelliteClickAt = -Infinity;
    ui["pause-screen"].close(); ui["help-panel"].open = false;
    readSave(); updateStartSummary(); startScreen.showModal();
  }
  document.getElementById("restart").addEventListener("click", openStartSelection);
  document.getElementById("new-game").addEventListener("click", openStartSelection);
  startScreen.addEventListener("cancel", event => event.preventDefault());
  startForm.addEventListener("change", updateStartSummary);
  startForm.addEventListener("submit", event => {
    event.preventDefault();
    const index = Number(startForm.elements.namedItem("start-type").value);
    startScreen.close(); reset(index);
  });
  window.addEventListener("keydown", event => {
    if (choosingStart || event.ctrlKey || event.altKey || event.metaKey) return;
    if (movementCodes.has(event.code)) {
      event.preventDefault();
      if (paused || ended || event.repeat) return;
      movementKeys.add(event.code); updateThrust();
      refreshHud();
      return;
    }
    if (event.repeat) return;
    if (event.code === "KeyT") { event.preventDefault(); toggleJump(); return; }
    if (event.code === "Escape" && jumping) { event.preventDefault(); jumping = false; return; }
    if (event.code === "KeyK") { event.preventDefault(); cycleSatellite(); return; }
    if (event.code === "KeyL") { event.preventDefault(); absorbSelectedSatellite(); return; }
    if (event.code === "Space") { event.preventDefault(); togglePause(); return; }
    if (event.code === "KeyO") toggleOrbits();
  });
  window.addEventListener("keyup", event => {
    if (!movementCodes.has(event.code)) return;
    movementKeys.delete(event.code); updateThrust();
    refreshHud();
  });
  window.addEventListener("blur", clearMovement);
  document.addEventListener("visibilitychange", () => { lastFrame = 0; accumulator = 0; });
  window.addEventListener("resize", resize);

  function frame(timestamp) {
    const dt = lastFrame ? Math.min((timestamp - lastFrame) / 1000, .06) : 0;
    lastFrame = timestamp;
    if (!choosingStart && !paused && !ended) {
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
    entry.title = `${type.natural ? `天然天体 · 质量 ${type.mass} · 无法捕获或击毁` : `质量 ≥ ${type.min} · 科技上限 ${type.techCap} · 卫星上限 ${satelliteLimit(TYPES.indexOf(type))}`} · 基础引力半径 ${type.gravityRange}px · 吸力由实际质量决定`;
    legend.append(entry);
    if (type.natural) continue;
    const index = TYPES.indexOf(type);
    const label = document.createElement("label");
    label.className = "start-option"; label.style.setProperty("--color", type.color);
    const input = document.createElement("input");
    input.type = "radio"; input.name = "start-type"; input.value = String(index); input.checked = index === 0;
    const caption = document.createElement("span"); caption.textContent = type.name;
    const detail = document.createElement("small"); detail.textContent = `质量 ${index === 0 ? 8 : type.min} · ${type.radius}px`;
    caption.append(detail); label.append(input, caption); startTypes.append(label);
  }
  // 存档使用独立计时器，主动暂停期间仍保存当前状态。
  setInterval(savePlayer, 1000);
  resize(); openStartSelection(); requestAnimationFrame(frame);
})();
