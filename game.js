"use strict";

(() => {
  const canvas = document.getElementById("universe");
  const ctx = canvas.getContext("2d", { alpha: false });
  const ui = Object.fromEntries(["stage", "stage-dot", "mass", "speed", "satellites", "next-stage", "progress-text", "progress", "notice", "end-screen", "end-description", "pause", "pause-screen"].map(id => [id, document.getElementById(id)]));
  const CONFIG = SolarConfig, CIV = SolarCivilization, GRAVITY = SolarGravity;
  const TYPES = CONFIG.types;
  const STEP = CONFIG.physicsStep, WORLD_RADIUS = 1800;
  const playerSpeedLimit = type => 200 + Math.max(0, Math.min(5, TYPES[type].level)) * 50;
  const CAPTURE = CONFIG.capture;
  const POPULATION = CONFIG.population;
  let universeSeed = 0;
  let width, height, dpr, stars, nebula;
  let bodies = [], player = null, particles = [];
  let ships = [], beams = [], nestRecords = new Map(), nextCivilization = 0, nextCombat = 0;
  let pointer = { x: 0, y: 0 }, savedGame = null;
  let choosingStart = true;
  let selectedSatelliteId = null, satelliteClickAt = -Infinity;
  let fleets = createCivilianFleet(), nextFleet = 0;
  let nextId = 1, paused = false, ended = false, showTrails = true;
  let time = 0, lastFrame = 0, accumulator = 0, nextPopulation = 0, nextHud = 0;
  let peakMass = 8, absorbed = 0, shake = 0, driftDistance = 0;
  let warningCache = { at: -Infinity, records: [] };
  const discoveredHazards = new Set();
  let lastAttackNotice = -Infinity;
  const camera = { x: 0, y: 0, zoom: 1, targetZoom: 1 };
  const thrust = { x: 0, y: 0, active: false };
  const movementKeys = new Set();
  const touchPoints = new Map();
  let drivePointer = null, pinchDistance = 0;
  function updateTouchThrust() {
    if (drivePointer === null || !player || paused || ended || choosingStart) return;
    const point = touchPoints.get(drivePointer);
    const dx = point.x - screenX(player.x), dy = point.y - screenY(player.y);
    const length = Math.hypot(dx, dy);
    thrust.active = length > 8;
    thrust.x = thrust.active ? dx / length : 0;
    thrust.y = thrust.active ? dy / length : 0;
  }
  const movementCodes = new Set(["KeyW", "KeyA", "KeyS", "KeyD"]);
  function updateThrust() {
    const x = Number(movementKeys.has("KeyD")) - Number(movementKeys.has("KeyA"));
    const y = Number(movementKeys.has("KeyS")) - Number(movementKeys.has("KeyW"));
    const length = Math.hypot(x, y);
    thrust.active = length > 0;
    // 归一化方向，使斜向与单轴推进具有相同的加速度。
    thrust.x = length > 0 ? x / length : 0;
    thrust.y = length > 0 ? y / length : 0;
  }
  function clearMovement() {
    drivePointer = null; pinchDistance = 0; touchPoints.clear();
    movementKeys.clear(); updateThrust();
  }
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
    if (body.natural) { body.radius = TYPES[body.type].radius * (.7 + .3 * Math.min(1, body.mass / TYPES[body.type].mass)); return; }
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
    const body = { id: nextId++, x, y, px: x, py: y, vx, vy, ax: 0, ay: 0, mass, cityMass: 0, healthyMass: mass, integrity: 1, natural: naturalType !== null, type: naturalType, civ: CIV.create(), kills: { asteroid: 0, planet: 0, fighter: 0, mothership: 0 }, nextAttack: 0, nextAbsorb: 0, recallUntil: 0, hazardReady: 0, alive: true, trail: [], trailAt: 0, host: null, orbitRadius: 0, orbitDirection: 1, captureAfter: 0, cooldown: 0, phase: random(0, Math.PI * 2) };
    updateSize(body);
    bodies.push(body);
    return body;
  }

  function createCivilianFleet() {
    return SolarFleet.create({
      bodies: () => bodies, enemies: () => ships, player: () => player,
      id: () => nextId++, resize: updateSize, destroy: destroyUnit, gain: gainMass,
      fire: (attacker, target, damage) => fireLaser(attacker, target, damage, "#91ddff"),
      harvest: harvestMass
    });
  }

  function announce(message) {
    const entry = document.createElement("div");
    entry.className = "event-notice";
    SolarLanguage.text(entry, message);
    ui.notice.append(entry);
    setTimeout(() => { SolarLanguage.forget(entry); entry.remove(); }, 2000);
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

  function weightedIndex(weights) {
    let roll = Math.random() * weights.reduce((sum, n) => sum + n, 0);
    for (let i = 0; i < weights.length; i++) { roll -= weights[i]; if (roll <= 0) return i; }
    return weights.length - 1;
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
    let mass;
    if (roll < POPULATION.asteroidChance) mass = random(1, 11);
    else if (roll > 1 - POPULATION.naturalChance && bodies.filter(b => b.alive && b.natural).length < POPULATION.naturalLimit) {
      const type = weightedIndex([75, 20, 5]) + 8;
      createBody(position.x, position.y, TYPES[type].mass, initialVelocity(TYPES[type].mass), type);
      return;
    } else {
      let type = weightedIndex(POPULATION.planetWeights) + 2;
      if (type >= 5 && bodies.filter(b => b.alive && !b.natural && b.mass >= TYPES[5].min).length >= POPULATION.largePlanetLimit) type = 2 + weightedIndex([6, 3, 1]);
      mass = random(TYPES[type].min, type < 7 ? TYPES[type + 1].min - 1 : CONFIG.maxPlanetMass);
    }
    const body = createBody(position.x, position.y, mass);
    if (CIV.eligible(body)) {
      if (Math.random() < .4) body.civ.incubation = random(0, CONFIG.civilization.incubationSeconds);
      else {
        let level = weightedIndex(POPULATION.technologyWeights);
        if (level >= 4 && bodies.filter(b => b !== body && b.alive && b.civ.tech >= 4).length >= POPULATION.advancedCivilizationLimit) level = weightedIndex([4, 3, 2, 1]);
        while (level > 0 && CONFIG.civilization.technology[level].population > bodyMass(body) * CONFIG.civilization.populationPerMass * (level >= 6 ? 4 : level >= 5 ? 2 : 1)) level--;
        body.civ.tech = level; body.civ.knowledge = level; body.civ.city = level >= 5;
        body.civ.population = Math.max(CONFIG.civilization.seedPopulation, CONFIG.civilization.technology[level].population, CIV.capacity(body) * random(.1, .5));
        body.civ.incubation = CONFIG.civilization.incubationSeconds;
        body.civ.shield = CIV.stats(body).shield;
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
    ships = []; beams = []; nestRecords = new Map(); nextCivilization = 0; nextCombat = 0;
    universeSeed = Math.floor(Math.random() * 4294967296);
    selectedSatelliteId = null; satelliteClickAt = -Infinity;
    const startMass = startType === 0 ? 8 : TYPES[startType].min;
    player = createBody(0, 0, startMass);
    player.isPlayer = true;
    fleets = createCivilianFleet();
    nextFleet = 0;
    camera.x = 0; camera.y = 0; camera.zoom = 1; camera.targetZoom = 1;
    clearMovement(); paused = false; ended = false; choosingStart = false;
    time = 0; accumulator = 0; lastFrame = 0; nextPopulation = 2; nextHud = 0; peakMass = startMass; absorbed = 0; shake = 0;
    driftDistance = 0;
    warningCache = { at: -Infinity, records: [] };
    discoveredHazards.clear();
    lastAttackNotice = -Infinity;
    ui.notice.replaceChildren();
    if (snapshot) restorePlayer(snapshot);
    nextCivilization = time + CONFIG.civilization.tick; nextCombat = time + CONFIG.combat.tick;
    ui["end-screen"].hidden = true;
    ui["pause-screen"].close();
    // 出生点只保留两个疏松的小天体群，其他方向留出空白。
    const nearbyAngle = random(0, Math.PI * 2);
    for (let i = 0; i < POPULATION.nearby; i++) {
      const a = nearbyAngle + (i % 2) * 2.2 + random(-.3, .3), r = random(80, 300);
      createBody(Math.cos(a) * r, Math.sin(a) * r, random(1, 4));
    }
    for (let i = 0; i < POPULATION.initial; i++) spawnAmbient(true);
    manageNests();

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
        if (candidate === player) { burst(b.x, b.y, TYPES[player.type].color, 8, 12); }
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
    const oldType = body.type;
    const available = Math.max(0, CONFIG.maxPlanetMass - body.mass);
    body.mass += Math.min(available, amount);
    body.cityMass += Math.max(0, amount - available);
    body.integrity = Math.min(1, (Math.max(0, bodyMass(body) - amount) * body.integrity + amount) / bodyMass(body));
    body.healthyMass = Math.max(body.healthyMass, bodyMass(body));
    updateSize(body);
    if (body === player) {
      peakMass = Math.max(peakMass, bodyMass(body));
      if (body.type !== oldType) announce(`${TYPES[body.type].name} · A new chapter for your world`);
    }
  }

  function destroyUnit(target, attacker, cause) {
    if (!target.alive || target.natural || target.entity === "carrier") return;
    const wasPlanet = !target.entity && isPlanet(target);
    target.alive = false;
    burst(target.x, target.y, target.entity ? "#ff6f72" : TYPES[target.type].color, 24, 45);
    const credited = attacker?.entity === "drone" ? attacker.owner : attacker;
    if (credited?.alive && !credited.entity && !credited.natural) {
      const category = target.entity === "drone" ? "fighter" : target.entity || (wasPlanet ? "planet" : "asteroid");
      credited.kills[category]++;
      if (category === "mothership") CIV.research(credited, CONFIG.civilization.mothershipResearchReward);
      if (credited === player && category === "mothership") announce("The nest has fallen silent");
    }
    if (target === player) die("Your world suffered critical damage.");
  }

  function damageUnit(target, amount, attacker, cause) {
    if (!target.alive || target.natural || target.entity === "carrier" || amount <= 0) return;
    if (target === player && cause === "laser" && time - target.civ.lastHit >= 5 && performance.now() - lastAttackNotice >= 12000) {
      lastAttackNotice = performance.now();
      announce("Hostile fire detected");
    }
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
    target.integrity = Math.max(0, target.integrity - loss / total);
    CIV.suffer(target, loss / total);
    if (target.integrity < 1 - CONFIG.combat.breakLoss || target.mass < .6) destroyUnit(target, attacker, cause);
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
    for (const candidate of fleets.nearby(body, range)) {
      if (!candidate.alive || candidate.natural || candidate.entity === "carrier" ||
          candidate.mode === "dock" || candidate.ownerId === body.id || (!candidate.entity && sameSystem(body, candidate))) continue;
      const distance = Math.hypot(candidate.x - body.x, candidate.y - body.y);
      if (distance > range) continue;
      if (!candidate.entity && candidate.type === 0) {
        const dx = candidate.x - body.x, dy = candidate.y - body.y;
        const vx = candidate.vx - body.vx, vy = candidate.vy - body.vy, speed2 = vx * vx + vy * vy;
        const closest = speed2 > 0 ? -(dx * vx + dy * vy) / speed2 : Infinity;
        if (closest < 0 || closest > CONFIG.fleet.cannonThreatSeconds ||
            Math.hypot(dx + vx * closest, dy + vy * closest) > body.radius + candidate.radius + 5) continue;
      } else if (!candidate.entity && candidate.civ.population <= 0) continue;
      const rank = candidate.entity === "mothership" ? 0 : candidate.entity ? 1 : candidate.type === 0 ? 2 : 3;
      if (rank < priority || rank === priority && distance < nearest) { target = candidate; priority = rank; nearest = distance; }
    }
    return target;
  }

  function updateCivilizations(dt) {
    for (const body of bodies) {
      if (!body.alive || body.natural) continue;
      const hadLife = body.civ.population > 0, oldTech = body.civ.tech;
      CIV.tick(body, dt, time); updateSize(body);
      if (body === player) {
        if (body.civ.tech > oldTech) announce(["", "A shield now shelters your world", "Point defense is online",
          "Your first orbital carrier is ready", "The orbital fleet has expanded", "A city rises beyond the sky",
          "A second city surrounds your world", "Stellar mining is now possible"][body.civ.tech]);
        if (body.civ.tech < oldTech) announce("Civilization has lost an operating level");
        if (!hadLife && body.civ.population > 0) announce("Life has emerged on your world");
        if (hadLife && body.civ.population === 0) announce("Your civilization has fallen silent");
      }
      if (body !== player && isPlanet(body) && time >= body.nextAbsorb) {
        body.nextAbsorb = time + random(8, 15);
        const rock = bodies.find(b => b.alive && b.type === 0 && b.host === body.id);
        if (rock) absorb(body, rock);
      }
    }
    fleets.sync(time);
  }

  function updateCombat(dt) {
    for (const body of bodies) {
      if (!body.alive || body.natural || body.civ.tech < 2 || time < body.nextAttack) continue;
      body.nextAttack = time + .2;
      const target = selectCivilizationTarget(body);
      if (target) {
        body.nextAttack = time + CIV.stats(body).interval;
        fireLaser(body, target, CIV.stats(body).damage, TYPES[body.type].color);
        const beam = beams[beams.length - 1]; beam.cannon = true;
        if (body.civ.city) {
          const angle = Math.atan2(target.y - body.y, target.x - body.x), shell = body.radius + (body.civ.tech >= 6 ? 19 : 12);
          beam.x += Math.cos(angle) * shell; beam.y += Math.sin(angle) * shell;
        }
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
    for (const body of [...bodies, ...fleets.units]) {
      if (!body.alive || body.natural || body.entity === "carrier" || body.mode === "dock") continue;
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
      else if (ship.mode === "attack" && (target.civ || target.entity === "drone") && distance < cfg.range && time >= ship.nextAttack) {
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
        burst(a.x, a.y, TYPES[a.type].color, 60, 60);
      }
    }
    if (b === player) die("You were absorbed by a larger body.");
    return true;
  }

  function die(reason) {
    ended = true; clearMovement();
    SolarLanguage.text(ui["end-description"], `${reason} Peak mass ${peakMass.toFixed(1)}, absorbed ${absorbed} bodies, drifted for ${Math.floor(time).toLocaleString()} years, travelled ${Math.floor(driftDistance).toLocaleString()} km.`);
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
        // 累计天体的实际移动路程，镜头移动不计入漂流距离。
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
    if (time >= nextFleet) {
      nextFleet = time + CONFIG.fleet.decisionInterval;
      fleets.decisions(time);
    }
    fleets.move(dt, time);
    if (time >= nextCombat) {
      nextCombat = time + CONFIG.combat.tick;
      updateCombat(CONFIG.combat.tick);
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
      for (const unit of fleets.units) if (unit.alive && unit.entity === "drone" && unit.mode !== "dock") {
        retainedIds.add(unit.ownerId);
        if (unit.target && !unit.target.entity) retainedIds.add(unit.target.id);
      }
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

  function harvestMass(target, amount, owner, now) {
    if (!target.alive || amount <= 0 || target === owner || target.host === owner.id ||
        target.natural && (owner.civ.tech < 7 || target.type === 10) || !target.natural && target.civ.shield > 0) return 0;
    if (!target.natural && target.civ.population > 0) target.civ.lastHit = now;
    const before = bodyMass(target), taken = CIV.spend(target, amount, 0);
    if (!target.natural) CIV.suffer(target, before > 0 ? taken / before : 0);
    if (bodyMass(target) < .6) {
      if (target.natural) { target.alive = false; burst(target.x, target.y, "#ffdc94", 20, 20); }
      else destroyUnit(target, owner, "harvest");
    } else {
      if (target.natural && target.type === 9 && target.mass < 8000) target.type = 8;
      if (target.natural && target.type === 8 && target.mass < 1600) {
        target.natural = false; target.civ = CIV.create(); target.integrity = 1;
      }
      updateSize(target);
    }
    return taken;
  }

  function recallFleet() {
    if (paused || ended || choosingStart) return;
    fleets.recall(player, time);
    refreshHud();
  }

  function playerSnapshot() {
    const c = player.civ;
    return {
      version: 2, savedAt: Date.now(), mass: player.mass, cityMass: player.cityMass,
      healthyMass: player.healthyMass, integrity: player.integrity, peakMass, absorbed, elapsed: time, distance: driftDistance,
      recallRemaining: Math.max(0, player.recallUntil - time),
      civ: { population: c.population, tech: c.tech, knowledge: c.knowledge, research: c.research, shield: c.shield,
        shortage: c.shortage, pressure: c.pressure, consumption: c.consumption,
        incubation: c.incubation, extinct: c.extinct, city: c.city, hitAgo: Math.min(10, time - c.lastHit) },
      kills: { ...player.kills }
    };
  }

  function validSnapshot(s) {
    if (!s || s.version !== 2 || !s.civ || !s.kills) return false;
    const numeric = [s.savedAt, s.mass, s.cityMass, s.healthyMass, s.integrity, s.peakMass, s.absorbed, s.elapsed, s.distance, s.recallRemaining,
      s.civ.population, s.civ.tech, s.civ.knowledge, s.civ.research, s.civ.shield, s.civ.incubation, s.civ.hitAgo,
      s.civ.shortage, s.civ.pressure, s.civ.consumption, s.kills.asteroid, s.kills.planet, s.kills.fighter, s.kills.mothership];
    if (!numeric.every(n => typeof n === "number" && Number.isFinite(n) && n >= 0)) return false;
    if (s.mass < .6 || s.mass > CONFIG.maxPlanetMass || s.integrity < 1 - CONFIG.combat.breakLoss || s.integrity > 1) return false;
    if (![s.civ.tech, s.civ.knowledge].every(n => Number.isInteger(n) && n <= 7) || s.civ.tech > s.civ.knowledge) return false;
    if (typeof s.civ.extinct !== "boolean" || s.civ.city !== (s.civ.tech >= 5)) return false;
    if (s.civ.shield > CONFIG.civilization.technology[s.civ.tech].shield || s.civ.extinct && s.civ.population > 0) return false;
    return s.healthyMass >= s.mass + s.cityMass && s.peakMass >= s.mass + s.cityMass;
  }

  function readSave() {
    const status = document.getElementById("save-summary"), load = document.getElementById("load-save");
    savedGame = null; load.disabled = true;
    try {
      const raw = localStorage.getItem(CONFIG.saveKey);
      if (raw === null) { SolarLanguage.text(status, "No save for this civilization era yet."); return; }
      const snapshot = JSON.parse(raw);
      if (!validSnapshot(snapshot)) { SolarLanguage.text(status, "Invalid save data."); return; }
      savedGame = snapshot; load.disabled = false;
      SolarLanguage.text(status, `${TYPES[typeOf(snapshot.mass)].name} · Tech ${snapshot.civ.tech} · population ${(snapshot.civ.population / 1e6).toFixed(1)} M · ${new Date(snapshot.savedAt).toLocaleString()}`);
    } catch (error) {
      SolarLanguage.text(status, "Unable to read save. Check browser storage permissions.");
    }
  }

  function savePlayer() {
    if (!player?.alive || ended || choosingStart) return;
    try {
      localStorage.setItem(CONFIG.saveKey, JSON.stringify(playerSnapshot()));
    } catch (error) {
      console.error("Autosave failed", error);
    }
  }

  function restorePlayer(snapshot) {
    player.mass = snapshot.mass; player.cityMass = snapshot.cityMass; player.healthyMass = snapshot.healthyMass; player.integrity = snapshot.integrity;
    time = snapshot.elapsed; peakMass = snapshot.peakMass; absorbed = snapshot.absorbed;
    driftDistance = snapshot.distance;
    player.civ = { ...snapshot.civ, lastHit: time - snapshot.civ.hitAgo };
    delete player.civ.hitAgo;
    player.kills = { ...snapshot.kills };
    player.recallUntil = time + snapshot.recallRemaining;
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
    const c = b.civ, shell = (b.radius + (c.city ? 12 : 4)) * camera.zoom;
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
    if (c.tech >= 6) {
      ctx.beginPath(); ctx.arc(x, y, shell + 7 * camera.zoom, 0, Math.PI * 2);
      ctx.strokeStyle = "#bfe9ff99"; ctx.lineWidth = 1; ctx.stroke();
      for (let i = 0; i < 8; i++) {
        const angle = i * Math.PI / 4 - time * .025;
        circle(x + Math.cos(angle) * (shell + 7 * camera.zoom), y + Math.sin(angle) * (shell + 7 * camera.zoom), camera.zoom, "#cdefff");
      }
    }
    if (c.tech >= 2) {
      const orbit = c.city ? shell + (c.tech >= 6 ? 7 * camera.zoom : 0) : r + 2 * camera.zoom;
      for (let i = 0; i < 3; i++) {
        const angle = b.phase + i * Math.PI * 2 / 3;
        ctx.save(); ctx.translate(x + Math.cos(angle) * orbit, y + Math.sin(angle) * orbit); ctx.rotate(angle);
        ctx.fillStyle = "#ffd7a0"; ctx.fillRect(-camera.zoom, -camera.zoom, 4 * camera.zoom, 2 * camera.zoom); ctx.restore();
      }
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
    if (!ship.alive || ship.entity === "drone" && ship.mode === "dock") return;
    const x = screenX(ship.x), y = screenY(ship.y), r = ship.radius * camera.zoom;
    if (x < -30 || x > width + 30 || y < -30 || y > height + 30) return;
    ctx.save(); ctx.translate(x, y);
    ctx.rotate(ship.entity === "mothership" ? time * .05 : Math.atan2(ship.vy, ship.vx));
    if (ship.entity === "mothership") drawMothership(ship, r);
    else if (ship.entity === "carrier") {
      ctx.fillStyle = "#273c57"; ctx.strokeStyle = "#a9e8e4"; ctx.lineWidth = .8;
      ctx.beginPath(); ctx.moveTo(r, 0); ctx.lineTo(r * .3, r * .65); ctx.lineTo(-r, r * .65);
      ctx.lineTo(-r * .7, -r * .65); ctx.lineTo(r * .3, -r * .65); ctx.closePath(); ctx.fill(); ctx.stroke();
      ctx.fillStyle = "#91ebf0"; ctx.fillRect(-r * .5, -r * .12, r, r * .24);
      glow(-r, 0, r * .7, "#6bcbff55");
    }
    else {
      ctx.beginPath(); ctx.moveTo(r, 0); ctx.lineTo(-r, r * .7); ctx.lineTo(-r * .4, 0); ctx.lineTo(-r, -r * .7);
      ctx.closePath(); ctx.fillStyle = ship.entity === "drone" ? ship.owner === player ? "#74c9d1" : "#bc8ade" : ship.mode === "spent" ? "#635d69" : "#ac4e67"; ctx.fill();
      ctx.strokeStyle = ship.entity === "drone" ? "#d0f6ff" : "#ff92a0"; ctx.lineWidth = .7; ctx.stroke();
      if (ship.entity === "drone" && ship.cargo > 0) circle(-r, 0, camera.zoom, "#ffd27c");
    }
    ctx.restore();
    if (ship.entity === "drone" && ship.owner === player) {
      const endurance = clamp((ship.expires - time) / (ship.expires - ship.departed), 0, 1);
      ctx.fillStyle = endurance < .25 ? "#ff6575" : "#76b9c6";
      ctx.fillRect(x - r, y + r + 3, r * 2 * endurance, 1);
    }
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
    for (const ship of [...ships, ...fleets.units]) drawShip(ship);
    for (const beam of beams) {
      ctx.globalAlpha = clamp(beam.life / .18, 0, 1);
      ctx.beginPath(); ctx.moveTo(screenX(beam.x), screenY(beam.y)); ctx.lineTo(screenX(beam.tx), screenY(beam.ty));
      ctx.strokeStyle = beam.color; ctx.lineWidth = beam.cannon ? 2.3 : .9; ctx.stroke();
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
    ctx.restore();
  }

  function refreshHud() {
    if (choosingStart) return;
    const type = TYPES[player.type], c = player.civ, growth = CIV.progress(player);
    const percent = growth.total > 0 ? clamp(growth.value / growth.total * 100, 0, 100) : 0;
    SolarLanguage.text(ui.stage, type.name); ui["stage-dot"].style.background = type.color; ui["stage-dot"].style.color = type.color;
    SolarLanguage.text(ui.mass, player.mass.toFixed(1)); SolarLanguage.text(ui.speed, Math.hypot(player.vx, player.vy).toFixed(1));
    // 结构完整度只受战斗损伤和补充质量影响，供养不消耗完整度。
    const integrity = clamp(player.integrity * 100, 0, 100);
    const breakPoint = (1 - CONFIG.combat.breakLoss) * 100;
    const healthMeter = document.getElementById("mass-health-meter");
    healthMeter.setAttribute("aria-valuenow", integrity.toFixed(1));
    healthMeter.style.setProperty("--break-point", breakPoint + "%");
    const healthFill = document.getElementById("mass-health-fill");
    healthFill.style.width = integrity + "%";
    healthFill.style.background = integrity <= breakPoint + 10 ? "#ff6575" : integrity <= breakPoint + 25 ? "#e5b65f" : "#62dcc9";
    SolarLanguage.text(document.getElementById("mass-health-value"), integrity.toFixed(1) + "%");
    const format = n => Math.floor(n).toLocaleString();
    SolarLanguage.text(document.getElementById("drift-distance"), `${format(driftDistance)} km`);
    SolarLanguage.text(document.getElementById("drift-time"), `${format(time)} years`);
    const warnings = nearbyWarnings();
    if (!choosingStart && !ended) {
      for (const warning of warnings) {
        if (discoveredHazards.has(warning.body.id)) continue;
        discoveredHazards.add(warning.body.id);
        announce(`A powerful gravity well lies nearby · ${TYPES[warning.body.type].name}`);
      }
    }
    document.getElementById("hazard-warning-row").hidden = warnings.length === 0;
    SolarLanguage.text(document.getElementById("hazard-warning"), warnings.map(w => `${w.imminent ? "Danger" : "Nearby"} · ${TYPES[w.body.type].name} ${Math.floor(w.distance)} km`).join("; "));
    document.getElementById("hazard-warning").style.color = warnings.some(w => w.imminent) ? "#ff6575" : "#ffc375";
    SolarLanguage.text(document.getElementById("life-stat"), `${(c.population / 1e6).toFixed(1)} M`);
    const supportedPopulation = CIV.capacity(player);
    document.getElementById("life-stat").classList.toggle("overcrowded", c.population > supportedPopulation);
    SolarLanguage.text(document.getElementById("tech-stat"), `${c.tech}`);
    SolarLanguage.text(document.getElementById("upkeep-stat"), `${c.consumption.toFixed(2)} mass/year`);
    const fleetStatus = fleets.summary(player, time);
    SolarLanguage.text(document.getElementById("fleet-stat"), `${fleetStatus.mothers} / ${fleetStatus.total}`);
    document.getElementById("fleet-actions").hidden = ended || paused || choosingStart || c.tech < 3;
    SolarLanguage.text(document.getElementById("shield-stat"), `${c.shield.toFixed(1)} / ${CIV.stats(player).shield}`);
    SolarLanguage.text(document.getElementById("city-stat"), player.cityMass.toFixed(1));
    document.getElementById("city-row").hidden = player.cityMass <= 0 && !c.city;
    const totalKills = Object.values(player.kills).reduce((sum, n) => sum + n, 0);
    SolarLanguage.text(document.getElementById("kills-stat"), format(totalKills));
    const satellites = bodies.filter(b => b.alive && b.host === player.id);
    SolarLanguage.text(ui.satellites, `${satellites.length}/${satelliteLimit(player.type)}`);
    if (!satellites.some(b => b.id === selectedSatelliteId)) { selectedSatelliteId = null; satelliteClickAt = -Infinity; }
    SolarLanguage.attribute(ui.speed, "title", `Thrust cap ${playerSpeedLimit(player.type)} · Speed cap ${GRAVITY.speedLimit(player)}`);
    SolarLanguage.text(ui["next-stage"], growth.label);
    SolarLanguage.text(ui["progress-text"], `${Math.floor(percent)}%`); ui.progress.style.width = `${percent}%`;
    ui.progress.style.background = type.color;
  }

  function togglePause() {
    if (ended || choosingStart) return;
    paused = !paused; accumulator = 0; clearMovement();
    if (paused) ui["pause-screen"].showModal();
    else { ui["pause-screen"].close(); ui.pause.blur(); }
    refreshHud();
  }
  function toggleOrbits() { showTrails = !showTrails; }
  function cycleSatellite() {
    if (choosingStart || ended) return;
    const satellites = bodies.filter(b => b.alive && b.host === player.id).sort((a, b) => a.id - b.id);
    satelliteClickAt = -Infinity;
    if (satellites.length === 0) { selectedSatelliteId = null; refreshHud(); return; }
    const index = satellites.findIndex(b => b.id === selectedSatelliteId);
    selectedSatelliteId = satellites[(index + 1) % satellites.length].id;
    refreshHud();
  }
  function absorbSelectedSatellite() {
    if (choosingStart || ended || paused) return;
    const satellite = bodies.find(b => b.alive && b.host === player.id && b.id === selectedSatelliteId);
    if (!satellite || !absorb(player, satellite)) return;
    bodies = bodies.filter(b => b.alive);
    selectedSatelliteId = null; satelliteClickAt = -Infinity;

    refreshHud();
  }
  canvas.addEventListener("pointerdown", event => {
    pointer = { x: event.clientX, y: event.clientY };
    if (event.button === 2) return;
    if (event.button !== 0 || ended || paused || choosingStart) return;
    if (event.pointerType === "touch") {
      event.preventDefault();
      canvas.setPointerCapture(event.pointerId);
      touchPoints.set(event.pointerId, { ...pointer });
      if (touchPoints.size > 1) {
        drivePointer = null; updateThrust(); satelliteClickAt = -Infinity;
        const [a, b] = [...touchPoints.values()];
        pinchDistance = Math.hypot(a.x - b.x, a.y - b.y);
        return;
      }
    }
    let satellite = null, nearest = Infinity;
    for (const b of bodies) {
      if (!b.alive || b.host !== player.id) continue;
      const distance = Math.hypot(event.clientX - screenX(b.x), event.clientY - screenY(b.y));
      if (distance <= Math.max(event.pointerType === "touch" ? 24 : 12, b.radius * camera.zoom + 5) && distance < nearest) { satellite = b; nearest = distance; }
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
    if (event.pointerType === "touch") {
      drivePointer = event.pointerId;
      updateTouchThrust();
    }
  });
  canvas.addEventListener("pointermove", event => {
    pointer = { x: event.clientX, y: event.clientY };
    if (!touchPoints.has(event.pointerId)) return;
    touchPoints.set(event.pointerId, { ...pointer });
    if (touchPoints.size > 1) {
      const [a, b] = [...touchPoints.values()];
      const distance = Math.hypot(a.x - b.x, a.y - b.y);
      if (pinchDistance > 0) camera.targetZoom = clamp(camera.targetZoom * distance / pinchDistance, .5, 2.5);
      pinchDistance = distance;
    } else updateTouchThrust();
  });
  function releaseTouch(event) {
    touchPoints.delete(event.pointerId);
    if (drivePointer === event.pointerId) { drivePointer = null; updateThrust(); }
    if (touchPoints.size < 2) pinchDistance = 0;
  }
  canvas.addEventListener("pointerup", releaseTouch);
  canvas.addEventListener("pointercancel", releaseTouch);
  canvas.addEventListener("lostpointercapture", releaseTouch);
  canvas.addEventListener("contextmenu", event => { event.preventDefault(); });
  canvas.addEventListener("wheel", event => { event.preventDefault(); camera.targetZoom = clamp(camera.targetZoom * Math.exp(-event.deltaY * .001), .5, 2.5); }, { passive: false });
  ui.pause.addEventListener("click", togglePause);
  document.getElementById("touch-pause").addEventListener("click", togglePause);
  document.getElementById("recall-fleet").addEventListener("click", recallFleet);
  document.getElementById("touch-trail").addEventListener("click", toggleOrbits);
  document.getElementById("load-save").addEventListener("click", () => {
    readSave();
    if (!savedGame) return;
    startScreen.close(); reset(typeOf(savedGame.mass), savedGame);
    announce("Your journey continues beneath unfamiliar stars");
  });
  ui["pause-screen"].addEventListener("cancel", event => { event.preventDefault(); if (paused) togglePause(); });
  const startScreen = document.getElementById("start-screen");
  const startForm = document.getElementById("start-form");
  const startTypes = document.getElementById("start-types");
  function updateStartSummary() {
    const index = Number(startForm.elements.namedItem("start-type").value);
    const type = TYPES[index];
    SolarLanguage.text(document.getElementById("start-summary"), `${type.name} · Mass ${index === 0 ? 8 : type.min} · Room for ${satelliteLimit(index)} moons`);
  }
  function openStartSelection() {
    choosingStart = true; accumulator = 0; clearMovement();
    ui["end-screen"].hidden = true;
    selectedSatelliteId = null; satelliteClickAt = -Infinity;
    ui["pause-screen"].close();
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
    if (event.code === "KeyR") { event.preventDefault(); recallFleet(); return; }
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
  window.addEventListener("resize", () => { clearMovement(); resize(); });

  function frame(timestamp) {
    const dt = lastFrame ? Math.min((timestamp - lastFrame) / 1000, .06) : 0;
    lastFrame = timestamp;
    document.getElementById("touch-actions").hidden = choosingStart || ended || paused;
    document.getElementById("fleet-actions").hidden = choosingStart || ended || paused || !player || player.civ.tech < 3;
    document.getElementById("touch-trail").setAttribute("aria-pressed", String(showTrails));
    if (!choosingStart && !paused && !ended) {
      updateTouchThrust();
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
    SolarLanguage.text(entry, type.name);
    SolarLanguage.attribute(entry, "title", `${type.natural ? `Natural body · Mass ${type.mass} · ${type.kind === "black-hole" ? "Cannot be captured or mined" : "Cannot be captured; technology 7 can mine it"}` : `Mass ≥ ${type.min} · Satellite cap ${satelliteLimit(TYPES.indexOf(type))}`} · Gravity reach ${type.gravityRange} km`);
    legend.append(entry);
    if (type.natural) continue;
    const index = TYPES.indexOf(type);
    const label = document.createElement("label");
    label.className = "start-option"; label.style.setProperty("--color", type.color);
    const input = document.createElement("input");
    input.type = "radio"; input.name = "start-type"; input.value = String(index); input.checked = index === 0;
    const caption = document.createElement("span"); SolarLanguage.text(caption, type.name);
    const detail = document.createElement("small"); SolarLanguage.text(detail, `Mass ${index === 0 ? 8 : type.min}`);
    caption.append(detail); label.append(input, caption); startTypes.append(label);
  }
  const flavorLines = [
    "The asteroid you just swallowed was their shooting star last night.",
    "They called your last sharp turn the Great Migration.",
    "The first supply ship returned. Dinner was no longer a theory.",
    "The day the shield went up, the doomsayers started looking for other work.",
    "That moon kept them company for three centuries. You needed a little more mass.",
    "The expensive apartments face the star. The cheap ones will shortly.",
    "They discovered the universe has no center. You remain in the middle of the screen.",
    "You let go of the controls. They entered an age of peace.",
    "They spent centuries explaining your orbit. Let us hope they never discover WASD.",
    "Their oldest calendar is now a work of fiction.",
    "The new moon has a name already. Please try not to eat this one.",
    "Somewhere down there, someone is blaming the weather.",
    "The ocean moved first. The maps followed reluctantly.",
    "Their first message to the stars was a complaint about the rent.",
    "A child drew two moons today. By dinner, the drawing was out of date.",
    "The observatory has stopped printing next year's star charts.",
    "They built a monument to the moon. The monument lasted longer.",
    "Every crater has a story. Most begin with an apology.",
    "The first space tourist asked when the planet would stop moving.",
    "They named a constellation after you. You promptly left it behind.",
    "The shield warranty does not cover black holes.",
    "Someone just opened a seaside cafe. You have one job.",
    "Their telescope found another civilization. Their laser found it too.",
    "The city council approved another floor. Gravity approved all of them.",
    "A billion people live here. None of them agreed on a name.",
    "They finally reached the moon. You were browsing for another.",
    "The emergency siren is now the national anthem.",
    "Their philosophers call it fate. You call it a missed turn.",
    "The stars look peaceful from a sufficiently small window.",
    "They packed for the end of the world. It turned out to be a short trip.",
    "Keeping billions alive is easy. The hard part is not steering them into the sun.",
    "Start as a rock. Grow until the people on it complain about housing prices.",
    "You wander through space. They write history about every turn.",
    "Collect moons, nurture civilization, and occasionally inconvenience astronomers.",
    "Raise a rock into an entire world. Then figure out where to steer it.",
    "They search the stars for answers. You search for your next asteroid snack.",
    "A space-drifting game where the passengers multiply, but never buckle up.",
    "There are no predetermined orbits here—just textbooks trying to keep up."
  ];
  const flavorText = document.getElementById("flavor-text");
  let flavorIndex = Math.floor(Math.random() * flavorLines.length);
  SolarLanguage.text(flavorText, flavorLines[flavorIndex]);
  setInterval(() => {
    flavorText.classList.add("fading");
    setTimeout(() => {
      // 从其余文案中等概率选择，避免连续重复。
      flavorIndex = (flavorIndex + 1 + Math.floor(Math.random() * (flavorLines.length - 1))) % flavorLines.length;
      SolarLanguage.text(flavorText, flavorLines[flavorIndex]);
      flavorText.classList.remove("fading");
    }, 800);
  }, 20000);

  // 存档使用独立计时器，主动暂停期间仍保存当前状态。
  setInterval(savePlayer, 1000);
  resize(); openStartSelection(); requestAnimationFrame(frame);
})();
