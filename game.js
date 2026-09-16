"use strict";

(() => {
  const canvas = document.getElementById("universe");
  const ctx = canvas.getContext("2d", { alpha: false });
  const ui = Object.fromEntries(["stage", "stage-dot", "mass", "speed", "satellites", "next-stage", "progress-text", "progress", "notice", "end-screen", "end-description", "pause", "pause-screen"].map(id => [id, document.getElementById(id)]));
  const CONFIG = SolarConfig, CIV = SolarCivilization, GRAVITY = SolarGravity;
  const TYPES = CONFIG.types;
  const STEP = CONFIG.physicsStep, WORLD_RADIUS = 1800;
  const CAPTURE = CONFIG.capture;
  const POPULATION = CONFIG.population;
  let universeSeed = 0;
  let regions = SolarRegions.create(regionRandom), activeRegions = [], seededSystems = new Set();
  let width, height, dpr, stars, nebula;
  let bodies = [], player = null, particles = [];
  let ships = [], beams = [], nestRecords = new Map(), nextCivilization = 0, nextCombat = 0;
  let pointer = { x: 0, y: 0 }, activeSaveName = null;
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
  const startingMass = type => (type === 0 ? 8 : TYPES[type].min) * 1.3;
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
    const upper = body.type < 7 ? TYPES[body.type + 1].min : CONFIG.planetSizeSaturationMass;
    const upperRadius = body.type < 7 ? TYPES[body.type + 1].radius : CONFIG.maxBodyRadius;
    body.radius = base.radius + clamp((body.mass - base.min) / (upper - base.min), 0, 1) * (upperRadius - base.radius);
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
    const body = { id: nextId++, x, y, px: x, py: y, vx, vy, ax: 0, ay: 0, mass, healthyMass: mass, integrity: 1, natural: naturalType !== null, type: naturalType, civ: CIV.create(), artifacts: [], kills: { planet: 0, mothership: 0 }, nextAttack: 0, nextAbsorb: 0, recallUntil: 0, hazardReady: 0, alive: true, trail: [], trailAt: 0, host: null, orbitRadius: 0, orbitDirection: 1, captureAfter: 0, cooldown: 0, phase: random(0, Math.PI * 2) };
    updateSize(body);
    GRAVITY.limitVelocity(body);
    bodies.push(body);
    return body;
  }

  function createCivilianFleet() {
    return SolarFleet.create({
      bodies: () => bodies, enemies: () => ships, player: () => player,
      id: () => nextId++, resize: updateSize, destroy: destroyUnit, gain: gainMass,
      fire: (attacker, target, damage) => fireLaser(attacker, target, damage, "#91ddff"),
      harvest: harvestMass, threatRank: fleetThreatRank
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
    return regions.density(x, y, regions.locate(x, y));
  }

  function outsideView(x, y, radius = 0) {
    // 使用当前视角和缩放目标中更宽的视野，预留光晕与镜头移动余量。
    const zoom = Math.min(camera.zoom, camera.targetZoom), padding = radius + 160 / zoom;
    return Math.abs(x - camera.x) > width / (2 * zoom) + padding || Math.abs(y - camera.y) > height / (2 * zoom) + padding;
  }

  function manageRegions() {
    const reach = Math.max(WORLD_RADIUS, Math.hypot(width, height) / (2 * Math.min(camera.zoom, camera.targetZoom)) + 700);
    activeRegions = regions.around(player.x, player.y, reach);
    for (const region of activeRegions) {
      if (region.kind !== "system" || seededSystems.has(region.key) || !outsideView(region.x, region.y, 280) ||
          Math.hypot(region.x - player.x, region.y - player.y) > reach ||
          Math.hypot(region.x, region.y) < CONFIG.nests.safeRadius || bodies.length + 3 > POPULATION.target ||
          bodies.filter(b => b.alive && b.natural).length >= POPULATION.naturalLimit) continue;
      if (bodies.some(b => b.alive && Math.hypot(b.x - region.x, b.y - region.y) < 300)) continue;
      const star = createBody(region.x, region.y, TYPES[8].mass, initialVelocity(TYPES[8].mass), 8);
      for (let i = 0; i < 2; i++) {
        const radius = 130 + i * 70, angle = region.angle + i * Math.PI;
        const planet = createBody(star.x + Math.cos(angle) * radius, star.y + Math.sin(angle) * radius, 30 + i * 45);
        const gravity = GRAVITY.accelerationFrom(planet, star), speed = Math.sqrt(Math.hypot(gravity.x, gravity.y) * radius);
        planet.vx = star.vx - Math.sin(angle) * speed; planet.vy = star.vy + Math.cos(angle) * speed;
        GRAVITY.limitVelocity(planet);
      }
      seededSystems.add(region.key);
    }
  }

  function weightedIndex(weights) {
    let roll = Math.random() * weights.reduce((sum, n) => sum + n, 0);
    for (let i = 0; i < weights.length; i++) { roll -= weights[i]; if (roll <= 0) return i; }
    return weights.length - 1;
  }

  function spawnAmbient(initial = false) {
    const screenRadius = Math.hypot(width, height) / (2 * Math.min(camera.zoom, camera.targetZoom));
    const innerRadius = initial ? 260 : Math.max(900, screenRadius + 180);
    const outerRadius = initial ? WORLD_RADIUS : Math.max(WORLD_RADIUS, screenRadius + 650);
    let position = null;
    // 按面积采样，避免径向均匀采样将天体挤在玩家附近；空旷区允许不补充。
    for (let attempt = 0; attempt < 12; attempt++) {
      const angle = random(0, Math.PI * 2);
      const distance = Math.sqrt(random(innerRadius ** 2, outerRadius ** 2));
      const x = player.x + Math.cos(angle) * distance, y = player.y + Math.sin(angle) * distance;
      if (!initial && !outsideView(x, y, 90)) continue;
      if (Math.random() > ambientDensity(x, y)) continue;
      if (bodies.some(b => b.alive && (b.x - x) ** 2 + (b.y - y) ** 2 < 30 ** 2)) continue;
      position = { x, y }; break;
    }
    if (!position) return;
    const roll = Math.random();
    const region = regions.locate(position.x, position.y);
    let mass;
    if (roll < (region?.kind === "belt" ? .97 : POPULATION.asteroidChance)) mass = random(1, 11);
    else if (roll > 1 - POPULATION.naturalChance && bodies.filter(b => b.alive && b.natural).length < POPULATION.naturalLimit) {
      const type = weightedIndex([75, 20, 5]) + 8;
      createBody(position.x, position.y, TYPES[type].mass, initialVelocity(TYPES[type].mass), type);
      return;
    } else {
      let type = weightedIndex(POPULATION.planetWeights) + 2;
      if (type >= 5 && bodies.filter(b => b.alive && !b.natural && b.mass >= TYPES[5].min).length >= POPULATION.largePlanetLimit) type = 2 + weightedIndex([6, 3, 1]);
      mass = random(TYPES[type].min, type < 7 ? TYPES[type + 1].min - 1 : CONFIG.planetSizeSaturationMass);
    }
    const body = createBody(position.x, position.y, mass);
    if (CIV.eligible(body)) {
      if (Math.random() < .4) body.civ.incubation = random(0, CONFIG.civilization.incubationSeconds);
      else {
        let level = weightedIndex(POPULATION.technologyWeights);
        if (level >= 4 && bodies.filter(b => b !== body && b.alive && b.civ.tech >= 4).length >= POPULATION.advancedCivilizationLimit) level = weightedIndex([4, 3, 2, 1]);

        body.civ.tech = level;
        body.civ.population = Math.max(CONFIG.civilization.seedPopulation, body.mass * CONFIG.civilization.populationPerMass * random(.1, .5));
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

  function reset(startType, snapshot = null, saveName = null) {
    bodies = []; particles = []; nextId = 1;
    ships = []; beams = []; nestRecords = new Map(); nextCivilization = 0; nextCombat = 0;
    universeSeed = Math.floor(Math.random() * 4294967296);
    regions = SolarRegions.create(regionRandom); activeRegions = []; seededSystems = new Set();
    selectedSatelliteId = null; satelliteClickAt = -Infinity;
    const startMass = startingMass(startType);
    player = createBody(0, 0, startMass);
    player.isPlayer = true;
    fleets = createCivilianFleet();
    nextFleet = 0;
    camera.x = 0; camera.y = 0; camera.zoom = 1; camera.targetZoom = 1;
    clearMovement(); paused = false; ended = false; choosingStart = false; activeSaveName = saveName;
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
    manageRegions();
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
      if (host && b.type === 0 && occupied.get(host.id) < satelliteLimit(host.type) &&
          CIV.collisionRadius(host) + b.radius + 4 < orbitRadiusLimit(host) && bodyMass(host) > bodyMass(b) * CAPTURE.massRatio &&
          distance < GRAVITY.range(host) && speed < captureSpeedLimit(host, distance) * 2 && GRAVITY.tidalRatio(host, b, spatial) <= CAPTURE.maxTidalRatio) {
        b.orbitRadius = clamp(b.orbitRadius, Math.max(CAPTURE.minimumOrbitRadius, CIV.collisionRadius(host) + b.radius + 4), orbitRadiusLimit(host));
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
        if (distance >= GRAVITY.captureRange(host) || distance >= nearest || distance <= CIV.collisionRadius(host) + b.radius + 8 ||
            CIV.collisionRadius(host) + b.radius + 4 >= orbitRadiusLimit(host)) continue;
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
        b.orbitRadius = clamp(nearest, Math.max(CAPTURE.minimumOrbitRadius, CIV.collisionRadius(candidate) + b.radius + 4), orbitRadiusLimit(candidate));
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
    body.mass += amount;
    body.integrity = Math.min(1, (Math.max(0, bodyMass(body) - amount) * body.integrity + amount) / bodyMass(body));
    body.healthyMass = Math.max(body.healthyMass, bodyMass(body));
    updateSize(body);
    if (body === player) {
      peakMass = Math.max(peakMass, bodyMass(body));
      if (body.type !== oldType) announce(`${TYPES[body.type].name} · A new chapter for your world`);
    }
  }

  function destroyUnit(target, attacker, cause) {
    if (!target.alive || target.natural) return;
    const wasPlanet = !target.entity && isPlanet(target);
    target.alive = false;
    if (target.entity === "mothership") for (const child of target.fleet) child.alive = false;
    if (target.entity === "carrier") for (const child of target.owner.artifacts) {
      if (child.entity === "drone" && child.mother === target) { child.alive = false; child.cargo = 0; }
    }
    if (!target.entity) for (const unit of target.artifacts) { unit.alive = false; if (unit.entity === "drone") unit.cargo = 0; }
    burst(target.x, target.y, target.entity ? "#ff6f72" : TYPES[target.type].color, 24, 45);
    const credited = attacker?.owner || attacker;
    if (credited?.alive && !credited.entity && !credited.natural) {
      const category = target.entity === "mothership" ? "mothership" : wasPlanet ? "planet" : null;
      if (category) credited.kills[category]++;
      if (category === "mothership") {
        const reward = CONFIG.nests.grades[target.grade].massReward;
        // 击毁收益归属攻击者的主星，不占用飞船货舱。
        gainMass(credited, reward);
        CIV.research(credited, CONFIG.civilization.mothershipResearchReward);
        if (credited === player) announce(`The nest has fallen silent · +${reward} Mass`);
      }
    }
    if (target === player) die("Your world suffered critical damage.");
  }

  function damageUnit(target, amount, attacker, cause) {
    if (!target.alive || target.natural || amount <= 0) return;
    rememberAttack(target, attacker);
    if (target === player && cause === "laser" && time - target.civ.lastHit >= 5 && performance.now() - lastAttackNotice >= 12000) {
      lastAttackNotice = performance.now();
      announce("Hostile fire detected");
    }
    if (target.entity) {
      target.lastHit = time;
      const previousHit = target.impact;
      target.impact = { at: time, angle: attacker ? Math.atan2(attacker.y - target.y, attacker.x - target.x) : 0, shield: false };
      if ((!previousHit || time - previousHit.at > .12) && !outsideView(target.x, target.y)) burst(target.x, target.y, "#ffdba1", 4, 18);
      target.hp -= amount;
      if (target.hp <= 0) destroyUnit(target, attacker, cause);
      return;
    }
    const c = target.civ;
    c.lastHit = time;
    const shieldLoss = Math.min(c.shield, amount);
    c.shield -= shieldLoss;
    if (shieldLoss > 0) {
      target.impact = { at: time, angle: attacker ? Math.atan2(attacker.y - target.y, attacker.x - target.x) : 0,
        shield: true, broken: c.shield <= 0 };
      if (c.shield <= 0 && !outsideView(target.x, target.y)) burst(target.x, target.y, "#91dfff", 8, 24);
    }
    amount -= shieldLoss;
    if (amount <= 0) return;
    for (let i = 1; i >= 0 && amount > 0; i--) {
      const city = c.cities[i], loss = Math.min(city.hp, amount);
      city.hp -= loss; amount -= loss;
      if (loss > 0) city.lastHit = time;
      if (city.hp === 0) { city.built = false; c.projects["city" + i] = 0; }
      CIV.syncCities(target);
      if (loss > 0) CIV.suffer(target, loss / city.maxHp * .3);
    }
    if (amount <= 0) { updateSize(target); return; }
    const before = target.mass, loss = Math.min(before, amount);
    target.mass -= loss;
    c.coreHitUntil = time + CONFIG.civilization.coreBuildPause;
    target.integrity = Math.max(0, target.integrity - loss / Math.max(.1, before));
    CIV.suffer(target, loss / Math.max(.1, before));
    if (target.integrity < 1 - CONFIG.combat.breakLoss || target.mass < .6) destroyUnit(target, attacker, cause);
    else updateSize(target);
  }

  function rememberAttack(target, attacker) {
    if (!attacker?.alive) return;
    if (!target.threats) target.threats = new Map();
    target.threats.set(attacker.id, time);
    for (const [id, at] of target.threats) if (time - at > CONFIG.fleet.threatMemory) target.threats.delete(id);
    if (target.entity === "gun") {
      if (!target.owner.threats) target.owner.threats = new Map();
      target.owner.threats.set(attacker.id, time);
      for (const [id, at] of target.owner.threats) if (time - at > CONFIG.fleet.threatMemory) target.owner.threats.delete(id);
    }
  }

  function fleetThreatRank(ship, mother, owner, target, now) {
    const recent = unit => unit?.threats?.has(target.id) && now - unit.threats.get(target.id) <= CONFIG.fleet.threatMemory;
    if (recent(mother)) return 0;
    if (recent(owner)) return 1;
    if (recent(ship)) return 2;
    if (target.entity === "drone" || target.entity === "fighter") return 3;
    if (target.entity === "carrier" || target.entity === "mothership") return 4;
    if (target.entity === "gun") return 5;
    return 6;
  }

  function sameSystem(a, b) {
    return a.id === b.id || a.host === b.id || b.host === a.id || (a.host !== null && a.host === b.host);
  }

  function fireLaser(attacker, target, damage, color) {
    beams.push({ x: attacker.x, y: attacker.y, tx: target.x, ty: target.y, life: .18, duration: .18, color });
    damageUnit(target, damage, attacker, "laser");
  }

  function selectGunTarget(gun) {
    const owner = gun.owner, range = CIV.stats(owner).range;
    let target = null, priority = Infinity, nearest = Infinity;
    for (const candidate of fleets.nearby(gun, range)) {
      if (!candidate.alive || candidate.natural || candidate.mode === "dock" ||
          candidate.ownerId === owner.id || (!candidate.entity && sameSystem(owner, candidate))) continue;
      const distance = Math.hypot(candidate.x - gun.x, candidate.y - gun.y);
      if (distance > range) continue;
      const rank = candidate.entity === "drone" || candidate.entity === "fighter" ? 0 :
        candidate.entity === "carrier" || candidate.entity === "mothership" ? 1 : candidate.entity === "gun" ? 2 : 3;
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
        if (body.civ.tech > oldTech) announce(["", "Shield construction unlocked", "Orbital guns unlocked",
          "Orbital carriers unlocked", "Fleet expansion unlocked", "Space city construction unlocked",
          "Second city construction unlocked", "Stellar mining is now possible"][body.civ.tech]);
        if (!hadLife && body.civ.population > 0) announce("Life has emerged on your world");
        if (body.extinctionEvent) { announce("Your civilization has fallen silent"); body.extinctionEvent = false; }
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
    for (const gun of fleets.units) {
      if (!gun.alive || gun.entity !== "gun" || !gun.owner.alive || time < gun.nextAttack) continue;
      const target = selectGunTarget(gun);
      gun.nextAttack = time + .2;
      if (target) {
        const spec = CIV.stats(gun.owner); gun.nextAttack = time + spec.interval;
        gun.aim = Math.atan2(target.y - gun.y, target.x - gun.x);
        fireLaser(gun, target, spec.damage, TYPES[gun.owner.type].color);
      }
    }
    updateFleet(dt);
  }

  const nestSpecifications = CONFIG.nests.grades.map((grade, level) => {
    const cfg = CONFIG.nests;
    return { ...cfg, fighterHp: cfg.fighterHp * grade.multiplier, damage: cfg.damage * grade.multiplier,
      mothershipDamage: cfg.mothershipDamage * grade.multiplier,
      fighterSpeed: cfg.fighterSpeed * (1 + level * .08), activityRadius: cfg.activityRadius * (1 + level * .12),
      engagementRange: cfg.engagementRange * (1 + level * .12), range: cfg.range * (1 + level * .1),
      mothershipRange: cfg.mothershipRange * (1 + level * .1), launchSeconds: grade.launchSeconds,
      interval: cfg.interval / (1 + level * .1), resupplySeconds: cfg.resupplySeconds / (1 + level * .15) };
  });
  function nestStats(mother) { return nestSpecifications[mother.grade]; }

  function makeMothership(region, x, y, grade) {
    const hp = CONFIG.nests.mothershipHp * CONFIG.nests.grades[grade].multiplier;
    const ship = { id: nextId++, entity: "mothership", region, grade, anchorX: x, anchorY: y, phase: random(0, Math.PI * 2),
      x, y, vx: 0, vy: 0, radius: 12 + grade, hp, maxHp: hp, alive: true, nextAttack: 0, launchIn: 0, fleet: [] };
    nestRecords.set(region, ship);
    return ship;
  }

  function manageNests() {
    const candidates = [];
    const active = new Set(ships.map(s => s.entity === "mothership" ? s.region : s.mother));
    // 可见母舰及其攻击舰保留激活，离屏的新区域才允许生成或恢复舰队。
    const retained = [...active].filter(key => {
      const mother = nestRecords.get(key);
      return [mother, ...mother.fleet].some(s => s.alive && !outsideView(s.x, s.y, 80));
    });
    for (const region of activeRegions) {
      if (region.kind !== "nest") continue;
      const { key } = region, existing = nestRecords.get(key);
      if (existing && !existing.alive && !existing.fleet.some(f => f.alive)) continue;
      if (retained.includes(key)) continue;
      const px = existing ? existing.x : region.x, py = existing ? existing.y : region.y;
      if (Math.hypot(region.x, region.y) < CONFIG.nests.safeRadius ||
          Math.hypot(px - player.x, py - player.y) > Math.max(WORLD_RADIUS + 400, Math.hypot(width, height) / (2 * camera.zoom) + 500)) continue;
      if (!active.has(key) && (!outsideView(px, py, 80) || existing?.fleet.some(f => f.alive && !outsideView(f.x, f.y, 40)))) continue;
      if (!existing && bodies.some(b => b.alive && Math.hypot(px - b.x, py - b.y) < 70)) continue;
      candidates.push({ key, x: px, y: py, region, distance: Math.hypot(px - player.x, py - player.y) });
    }
    candidates.sort((a, b) => a.distance - b.distance);
    const selected = retained.map(key => nestRecords.get(key));
    for (const candidate of candidates.slice(0, Math.max(0, CONFIG.nests.activeLimit - selected.length))) {
      const roll = regionRandom(candidate.region.cx, candidate.region.cy, 74), grades = CONFIG.nests.grades;
      const grade = roll < grades[0].chance ? 0 : roll < grades[0].chance + grades[1].chance ? 1 : 2;
      selected.push(nestRecords.get(candidate.key) || makeMothership(candidate.key, candidate.x, candidate.y, grade));
    }
    ships = [];
    for (const mother of selected) {
      mother.fleet = mother.fleet.filter(f => f.alive);
      if (mother.alive) ships.push(mother);
      ships.push(...mother.fleet);
    }
  }

  function nearestFleetTarget(ship, range) {
    let result = null, nearest = range, bestRank = Infinity;
    for (const body of [...bodies, ...fleets.units]) {
      if (!body.alive || body.natural || body.mode === "dock" || !body.entity && body.type === 0) continue;
      if (ship.entity === "fighter") {
        const mother = nestRecords.get(ship.mother);
        if (Math.hypot(body.x - mother.x, body.y - mother.y) > CONFIG.nests.activityRadius * (1 + mother.grade * .12)) continue;
      }
      const distance = Math.hypot(body.x - ship.x, body.y - ship.y);
      if (distance > range) continue;
      const mother = ship.entity === "fighter" ? nestRecords.get(ship.mother) : ship;
      const rank = fleetThreatRank(ship, mother, null, body, time);
      if (rank < bestRank || rank === bestRank && distance < nearest) { result = body; nearest = distance; bestRank = rank; }
    }
    return result;
  }

  function updateFleet(dt) {
    for (const mother of ships.filter(s => s.alive && s.entity === "mothership")) {
      const cfg = nestStats(mother), grade = CONFIG.nests.grades[mother.grade];
      const angle = time * .022 + mother.phase;
      const destination = { x: mother.anchorX + Math.cos(angle) * 190, y: mother.anchorY + Math.sin(angle * .73) * 150,
        vx: -Math.sin(angle) * 190 * .022, vy: Math.cos(angle * .73) * 150 * .022 * .73 };
      SolarFleet.steer(mother, destination, grade.roamSpeed, 1.5, .35, 0, dt);
      mother.fleet = mother.fleet.filter(f => f.alive);
      mother.launchIn -= dt;
      if (mother.launchIn <= 0 && mother.fleet.length < cfg.fightersPerNest) {
        const a = random(0, Math.PI * 2);
        const fighter = { id: nextId++, entity: "fighter", mother: mother.region, grade: mother.grade, x: mother.x + Math.cos(a) * 26, y: mother.y + Math.sin(a) * 26, vx: mother.vx, vy: mother.vy, radius: 3, hp: cfg.fighterHp, maxHp: cfg.fighterHp, alive: true, shots: cfg.shots, mode: "attack", dockTime: 0, nextAttack: time + 1, phase: a };
        mother.fleet.push(fighter); ships.push(fighter); mother.launchIn = cfg.launchSeconds;
      }
      if (time >= mother.nextAttack) {
        const target = nearestFleetTarget(mother, cfg.mothershipRange);
        if (target) { fireLaser(mother, target, cfg.mothershipDamage, grade.color); mother.nextAttack = time + cfg.mothershipInterval; }
      }
    }
    for (const ship of ships) {
      if (!ship.alive || ship.entity !== "fighter") continue;
      const mother = nestRecords.get(ship.mother);
      if (!mother.alive) { ship.alive = false; continue; }
      const cfg = nestStats(mother);
      if (ship.mode === "dock") {
        ship.x = mother.x; ship.y = mother.y; ship.vx = mother.vx; ship.vy = mother.vy;
        if (!mother?.alive) { ship.mode = "spent"; continue; }
        ship.dockTime -= dt;
        if (ship.dockTime <= 0) { ship.shots = cfg.shots; ship.mode = "attack"; }
        continue;
      }
      if (ship.shots <= 0) ship.mode = mother?.alive ? "return" : "spent";
      if (ship.mode === "spent") { const drag = Math.exp(-dt * .3); ship.vx *= drag; ship.vy *= drag; continue; }
      let target = ship.mode === "return" ? mother : nearestFleetTarget(ship, cfg.engagementRange);
      if (Math.hypot(ship.x - mother.x, ship.y - mother.y) > cfg.activityRadius * .9) target = mother;
      if (!target && mother?.alive) {
        const angle = time * cfg.patrolOrbitSpeed + ship.phase;
        target = { x: mother.x + Math.cos(angle) * cfg.patrolRadius, y: mother.y + Math.sin(angle) * cfg.patrolRadius,
          vx: mother.vx - Math.sin(angle) * cfg.patrolRadius * cfg.patrolOrbitSpeed,
          vy: mother.vy + Math.cos(angle) * cfg.patrolRadius * cfg.patrolOrbitSpeed };
      }
      if (!target) { const drag = Math.exp(-dt * .3); ship.vx *= drag; ship.vy *= drag; continue; }
      const dx = target.x - ship.x, dy = target.y - ship.y, distance = Math.hypot(dx, dy);
      const stop = ship.mode === "return" || target === mother ? SolarSpacing.radius(mother) + ship.radius + 3 :
        target.civ || target.entity && target !== mother ? Math.max(SolarSpacing.radius(target) + ship.radius + 8, cfg.range * .65) : 0;
      SolarFleet.steer(ship, target, cfg.fighterSpeed, cfg.acceleration, cfg.steering, stop, dt);
      if (ship.mode === "return" && distance < SolarSpacing.radius(mother) + ship.radius + 5 && Math.hypot(ship.vx - mother.vx, ship.vy - mother.vy) < cfg.fighterSpeed * .35) { ship.mode = "dock"; ship.dockTime = cfg.resupplySeconds; ship.vx = mother.vx; ship.vy = mother.vy; }
      else if (ship.mode === "attack" && (target.civ || target.entity && target !== mother) && distance < cfg.range && time >= ship.nextAttack) {
        fireLaser(ship, target, cfg.damage, CONFIG.nests.grades[ship.grade].color); ship.shots--; ship.nextAttack = time + cfg.interval;
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
    // 主星与所属卫星、同一主星的卫星之间不发生碰撞伤害。
    if (a.host !== null && a.host === b.host || a.host === b.id || b.host === a.id) return;
    const sx = b.px - a.px, sy = b.py - a.py;
    const dx = (b.x - a.x) - sx, dy = (b.y - a.y) - sy;
    const t = clamp(-(sx * dx + sy * dy) / (dx * dx + dy * dy || 1), 0, 1);
    const radius = CIV.collisionRadius(a) + CIV.collisionRadius(b);
    if ((sx + dx * t) ** 2 + (sy + dy * t) ** 2 > radius * radius) return;
    if (a.natural || b.natural) {
      if (a.natural && b.natural) return;
      const source = a.natural ? a : b, target = a.natural ? b : a;
      if (TYPES[source.type].kind === "black-hole") {
        if (target.cooldown > time) return;
        damageUnit(target, Math.max(50, bodyMass(target) * .6), source, "hazard");
        target.cooldown = time + .5;
      }
      else {
        if (target.cooldown > time) return;
        damageUnit(target, Math.max(CONFIG.hazards.contactMinimum, bodyMass(target) * CONFIG.hazards.contactFraction), source, "hazard");
        const angle = Math.atan2(target.y - source.y, target.x - source.x);
        target.x = source.x + Math.cos(angle) * (radius + 2);
        target.y = source.y + Math.sin(angle) * (radius + 2);
        target.vx = source.vx + Math.cos(angle) * 35; target.vy = source.vy + Math.sin(angle) * 35;
        GRAVITY.limitVelocity(target);
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
    GRAVITY.limitVelocity(a); GRAVITY.limitVelocity(b);
    a.cooldown = b.cooldown = time + .3;
    const loss = clamp(speed / 600, CONFIG.combat.collisionMinLoss, CONFIG.combat.collisionMaxLoss);
    // 基础绝对伤害由约化质量与碰撞前相对速度决定，再按质量比平方根分配。
    const baseDamage = 2 * (massA / total) * massB * loss;
    const massFactor = Math.sqrt(massB / massA);
    damageUnit(a, baseDamage * massFactor, b, "collision");
    damageUnit(b, baseDamage / massFactor, a, "collision");
    burst(a.x, a.y, "#f7cc9c", Math.min(25, Math.ceil(total)), 50);
    if (a === player || b === player) {
      shake = 4;

    }
  }

  function collisions() {
    const grid = new Map(), cell = 48;
    for (const b of [...bodies]) {
      if (!b.alive) continue;
      const x0 = Math.floor((Math.min(b.px, b.x) - CIV.collisionRadius(b)) / cell), x1 = Math.floor((Math.max(b.px, b.x) + CIV.collisionRadius(b)) / cell);
      const y0 = Math.floor((Math.min(b.py, b.y) - CIV.collisionRadius(b)) / cell), y1 = Math.floor((Math.max(b.py, b.y) + CIV.collisionRadius(b)) / cell);
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
    }
    SolarSpacing.resolve([...bodies, ...ships, ...fleets.units]);
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
      manageRegions();
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
        target.natural && (owner.civ.tech < 7 || target.type === 10) || !target.natural && CIV.hasProducts(target)) return 0;
    const before = target.mass, taken = Math.min(before, amount);
    target.mass -= taken;
    if (!target.natural && taken > 0) {
      target.civ.coreHitUntil = now + CONFIG.civilization.coreBuildPause;
      rememberAttack(target, owner);
      CIV.suffer(target, taken / Math.max(.1, before) * CONFIG.civilization.harvestPopulationMultiplier);
    }
    if (target.mass < .6) {
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
      version: 4, savedAt: Date.now(), mass: player.mass, vx: player.vx, vy: player.vy,
      healthyMass: player.healthyMass, integrity: player.integrity, peakMass, absorbed, elapsed: time, distance: driftDistance,
      recallRemaining: Math.max(0, player.recallUntil - time),
      civ: { ...c, cities: c.cities.map(city => ({ ...city, lastHit: Math.min(10, time - city.lastHit) })), projects: { ...c.projects },
        lastHit: Math.min(10, time - c.lastHit), coreHitUntil: Math.max(0, c.coreHitUntil - time) },
      fleet: fleets.snapshot(player, time),
      kills: { planet: player.kills.planet, mothership: player.kills.mothership }
    };
  }

  function validSnapshot(s) {
    if (!s || s.version !== 4 || !s.civ || !s.kills || !s.fleet) return false;
    const c = s.civ, f = s.fleet;
    const positive = values => values.every(n => typeof n === "number" && Number.isFinite(n) && n >= 0);
    if (!positive([s.savedAt, s.mass, s.healthyMass, s.integrity, s.peakMass, s.absorbed, s.elapsed, s.distance,
      s.recallRemaining, c.population, c.tech, c.research, c.shield, c.lastHit, c.coreHitUntil,
      c.incubation, c.pressure, c.consumption, s.kills.planet, s.kills.mothership])) return false;
    if (![s.vx, s.vy].every(Number.isFinite) || s.mass < .6 ||
        s.integrity < 1 - CONFIG.combat.breakLoss || s.integrity > 1 || !Number.isInteger(c.tech) || c.tech > 7) return false;
    if (typeof c.extinct !== "boolean" || typeof c.city !== "boolean" || c.population > 0 && c.population < CONFIG.civilization.extinctionPopulation) return false;
    if (!Array.isArray(c.cities) || c.cities.length !== 2 || !c.projects) return false;
    if (!c.cities.every((city, i) => city && positive([city.hp, city.maxHp, city.lastHit]) &&
        city.maxHp === CONFIG.fleet.construction.cityHp[i] && city.hp <= city.maxHp &&
        typeof city.built === "boolean" && (!city.built || city.hp > 0))) return false;
    if (c.city !== c.cities.some(city => city.built && city.hp > 0)) return false;
    if (!["shield", "gun", "carrier", "city0", "city1"].every(key => positive([c.projects[key]]) && c.projects[key] <= 1)) return false;
    if (c.shield > CIV.stats({ civ: c }).shield || c.population === 0 && (c.tech > 0 || c.shield > 0 || c.cities.some(city => city.hp > 0))) return false;
    if (!Array.isArray(f.facilities) || !Array.isArray(f.planes) || f.facilities.length > 6 || f.planes.length > 12) return false;
    const slots = new Set();
    for (const u of f.facilities) {
      if (!u || !["carrier", "gun"].includes(u.entity) || !u.orbitMotion ||
          !positive([u.slot, u.hp, u.maxHp, u.hitAgo, u.buildProgress, u.launchRemaining, u.attackRemaining]) ||
          !Number.isInteger(u.slot) || u.slot > 2 || u.hp <= 0 || u.hp > u.maxHp || u.buildProgress > 1 ||
          ![u.orbitMotion.x, u.orbitMotion.y, u.orbitMotion.vx, u.orbitMotion.vy].every(Number.isFinite)) return false;
      if (c.tech < (u.entity === "gun" ? 2 : 3) || slots.has(u.entity + u.slot)) return false;
      slots.add(u.entity + u.slot);
    }
    const spec = CONFIG.fleet.grades[Math.min(3, Math.max(0, c.tech - 3))];
    for (const p of f.planes) {
      if (!p || !slots.has("carrier" + p.motherSlot) || ![p.x, p.y, p.vx, p.vy].every(Number.isFinite) ||
          !positive([p.hp, p.hitAgo, p.shots, p.cargo, p.readyRemaining, p.flightAge, p.enduranceRemaining, p.attackRemaining]) ||
          p.hp <= 0 || p.hp > spec.hp || p.cargo > spec.cargo || p.shots > spec.ammo || typeof p.docked !== "boolean") return false;
    }
    return s.healthyMass + .00001 >= s.mass && s.peakMass + .00001 >= s.mass;
  }

  const savePrefix = () => CONFIG.savePrefix + ":";
  function listSaves() {
    const saves = [];
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      if (!key || !key.startsWith(savePrefix())) continue;
      try {
        const snapshot = JSON.parse(localStorage.getItem(key));
        if (validSnapshot(snapshot)) saves.push({ key, name: key.slice(savePrefix().length), snapshot });
      } catch (error) { /* 跳过无法解析的存档 */ }
    }
    return saves.sort((a, b) => b.snapshot.savedAt - a.snapshot.savedAt);
  }

  function saveName() {
    if (!player?.alive) return CONFIG.savePrefix;
    const pad = n => String(n).padStart(2, "0"), now = new Date();
    const stamp = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())} ${pad(now.getHours())}-${pad(now.getMinutes())}-${pad(now.getSeconds())}`;
    const title = CONFIG.populationTitles.filter(t => player.civ.population >= t.population).at(-1);
    return `${TYPES[player.type].name} - ${title ? title.name : TYPES[0].name} - ${stamp}`;
  }

  function readSave() {
    const status = document.getElementById("save-summary"), list = document.getElementById("save-list");
    list.replaceChildren();
    let saves = [];
    try { saves = listSaves(); }
    catch (error) { SolarLanguage.text(status, "Unable to read save. Check browser storage permissions."); return; }
    if (saves.length === 0) { SolarLanguage.text(status, "No save for this civilization era yet."); return; }
    SolarLanguage.text(status, "");
    for (const save of saves) {
      const button = document.createElement("button");
      button.type = "button"; button.className = "save-option";
      const name = document.createElement("strong"); SolarLanguage.text(name, save.name);
      const detail = document.createElement("small");
      SolarLanguage.text(detail, `${TYPES[typeOf(save.snapshot.mass)].name} - Tech ${save.snapshot.civ.tech} - ${(save.snapshot.civ.population / 1e6).toFixed(1)} M - ${new Date(save.snapshot.savedAt).toLocaleString()}`);
      button.append(name, detail);
      button.addEventListener("click", () => {
        startScreen.close();
        reset(typeOf(save.snapshot.mass), save.snapshot, save.name);
        announce("Your journey continues beneath unfamiliar stars");
      });
      list.append(button);
    }
  }

  function savePlayer() {
    if (!player?.alive || ended || choosingStart) return;
    const name = saveName();
    try {
      // 从存档启动时覆盖原记录，否则新建一条存档。
      if (activeSaveName && activeSaveName !== name) localStorage.removeItem(savePrefix() + activeSaveName);
      activeSaveName = name;
      localStorage.setItem(savePrefix() + name, JSON.stringify(playerSnapshot()));
      announce("Journey recorded");
    } catch (error) {
      announce("Save failed. Check browser storage permissions and available space.");
    }
  }

  function restorePlayer(snapshot) {
    player.mass = snapshot.mass; player.healthyMass = snapshot.healthyMass; player.integrity = snapshot.integrity;
    time = snapshot.elapsed; peakMass = snapshot.peakMass; absorbed = snapshot.absorbed; driftDistance = snapshot.distance;
    player.civ = { ...snapshot.civ, cities: snapshot.civ.cities.map(city => ({ ...city, lastHit: time - city.lastHit })), projects: { ...snapshot.civ.projects },
      lastHit: time - snapshot.civ.lastHit, coreHitUntil: time + snapshot.civ.coreHitUntil };
    player.kills = { planet: snapshot.kills.planet, mothership: snapshot.kills.mothership };
    player.recallUntil = time + snapshot.recallRemaining; nextPopulation = time + 2;
    player.vx = snapshot.vx; player.vy = snapshot.vy;
    GRAVITY.limitVelocity(player); updateSize(player);
    fleets.restore(player, snapshot.fleet, time);
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
    const c = b.civ, ring = CIV.rings(b), shell = ring.shield * camera.zoom;
    const vitality = c.population >= CONFIG.civilization.extinctionPopulation ?
      Math.min(1, Math.log2(1 + c.population / 1e7) / 6) * Math.max(0, 1 - c.pressure / 2) : 0;
    const lights = Math.floor(12 * vitality);
    for (let i = 0; i < lights; i++) {
      const angle = b.phase + i * 2.4 + time * .04;
      circle(x + Math.cos(angle) * r * .65, y + Math.sin(angle) * r * .65, .55 * camera.zoom, "#fff4bb");
    }
    for (let layer = 0; layer < 2; layer++) {
      const city = c.cities[layer]; if (city.hp <= 0) continue;
      const outer = ring["city" + layer] * camera.zoom;
      const thickness = (city.built ? 2.6 + layer * .4 : .8) * camera.zoom;
      const radius = outer - thickness / 2;
      ctx.save(); ctx.globalAlpha = city.built ? .9 : .35;
      if (!city.built) ctx.setLineDash([2 * camera.zoom, 4 * camera.zoom]);
      ctx.beginPath(); ctx.arc(x, y, radius, 0, Math.PI * 2);
      ctx.strokeStyle = layer ? "#445b70" : "#514c67"; ctx.lineWidth = thickness; ctx.stroke();
      if (city.built) {
        ctx.setLineDash([]); ctx.lineWidth = .45 * camera.zoom;
        for (const edge of [outer - .2 * camera.zoom, outer - thickness + .2 * camera.zoom]) {
          ctx.beginPath(); ctx.arc(x, y, edge, 0, Math.PI * 2);
          ctx.strokeStyle = layer ? "#8faebc" : "#a49bb6"; ctx.stroke();
        }
      }
      const segments = layer ? 14 : 10;
      for (let i = 0; i < segments; i++) {
        const angle = b.phase + i * Math.PI * 2 / segments;
        ctx.save(); ctx.translate(x + Math.cos(angle) * radius, y + Math.sin(angle) * radius); ctx.rotate(angle);
        ctx.fillStyle = i % 3 === 0 ? "#a5a1ae" : "#292f40";
        ctx.fillRect(-thickness * .4, -.7 * camera.zoom, thickness * .8, 1.4 * camera.zoom);
        if (city.built && i < segments * vitality) {
          ctx.fillStyle = i % 3 ? "#b8e6e2" : "#f4d294";
          ctx.fillRect(-.35 * camera.zoom, .9 * camera.zoom, .7 * camera.zoom, 1.1 * camera.zoom);
        }
        ctx.restore();
      }
      ctx.restore();
      for (let i = 0; i < Math.floor(5 * vitality); i++) {
        const angle = time * (layer ? -.18 : .15) + i * 2.4 + b.phase;
        circle(x + Math.cos(angle) * radius, y + Math.sin(angle) * radius, .7 * camera.zoom, "#b5f0e7");
      }
    }
    if (c.shield > 0) {
      ctx.save(); ctx.globalAlpha = .15 + c.shield / CIV.stats(b).shield * .55;
      ctx.beginPath(); ctx.arc(x, y, shell, 0, Math.PI * 2);
      ctx.strokeStyle = "#7adcff"; ctx.lineWidth = .75 + c.tech * .1; ctx.stroke(); ctx.restore();
    }
    if (b.impact?.shield && time - b.impact.at < .45) {
      const progress = (time - b.impact.at) / .45, radius = shell + progress * (b.impact.broken ? 12 : 4) * camera.zoom;
      ctx.save(); ctx.globalAlpha = 1 - progress;
      ctx.beginPath(); ctx.arc(x, y, radius, b.impact.angle - .55 - progress, b.impact.angle + .55 + progress);
      ctx.strokeStyle = b.impact.broken ? "#fff0dd" : "#bdedff"; ctx.lineWidth = (2 - progress) * camera.zoom; ctx.stroke();
      if (b.impact.broken) {
        ctx.setLineDash([3 * camera.zoom, 5 * camera.zoom]);
        ctx.beginPath(); ctx.arc(x, y, radius, 0, Math.PI * 2); ctx.lineWidth = camera.zoom; ctx.stroke();
      }
      ctx.restore();
    }
    // 生态效果由时间与人口直接采样，不创建飞行实体或碰撞对象。
    if (vitality > .08 && c.tech > 0) {
      const launches = Math.min(3, Math.ceil(c.tech * vitality));
      for (let i = 0; i < launches; i++) {
        const phase = (time * .07 + b.phase + i * .37) % 1;
        if (phase > .45) continue;
        const angle = b.phase + i * 2.4 + Math.floor(time * .07 + b.phase + i * .37);
        const from = (c.city ? ring.outer : b.radius) * camera.zoom;
        const radius = from + phase * 36 * camera.zoom;
        ctx.save(); ctx.globalAlpha = vitality * (1 - phase / .45);
        ctx.beginPath(); ctx.moveTo(x + Math.cos(angle) * radius, y + Math.sin(angle) * radius);
        ctx.lineTo(x + Math.cos(angle) * (radius - 3 * camera.zoom), y + Math.sin(angle) * (radius - 3 * camera.zoom));
        ctx.strokeStyle = "#ffdfae"; ctx.lineWidth = .8; ctx.stroke(); ctx.restore();
      }
      if (c.tech >= 3) {
        ctx.save(); ctx.globalAlpha = vitality;
        const count = Math.min(4, 1 + Math.floor(vitality * 3));
        for (let i = 0; i < count; i++) {
          const seed = b.phase + i * 2.399;
          const angle = time * (.16 + i * .025) + seed;
          const radius = (ring.outer + 3 + Math.sin(seed + time * .1) * .5) * camera.zoom;
          const size = (.65 + (Math.sin(seed * 3) + 1) * .2) * camera.zoom;
          ctx.save(); ctx.translate(x + Math.cos(angle) * radius, y + Math.sin(angle) * radius); ctx.rotate(seed + time * .07);
          ctx.beginPath(); ctx.moveTo(-size, -size * .25); ctx.lineTo(size * .2, -size * .8);
          ctx.lineTo(size * .75, size * .15); ctx.lineTo(-size * .15, size * .65); ctx.closePath();
          ctx.fillStyle = i % 2 ? "#b1bcc7" : "#a6dbe7"; ctx.fill(); ctx.restore();
        }
        ctx.restore();
      }
    }
  }

  function drawMothership(ship, r) {
    const grade = CONFIG.nests.grades[ship.grade];
    if (ship.grade === 2) {
      glow(0, 0, r * 3, "#bb8dff50");
      ctx.shadowColor = grade.color; ctx.shadowBlur = 9 * camera.zoom;
    }
    const pulse = .75 + .25 * Math.sin(time * 2);
    for (const side of [-1, 1]) {
      glow(-r * .8, side * r * .35, r * .7, "#9d75ff44");
      ctx.beginPath(); ctx.moveTo(-r * .8, side * r * .35);
      ctx.lineTo(-r * (1 + pulse * .25), side * r * .35);
      ctx.strokeStyle = "#bda1ff"; ctx.lineWidth = r * .12; ctx.stroke();
    }
    const hull = ctx.createLinearGradient(0, -r, 0, r);
    hull.addColorStop(0, ship.grade === 2 ? "#211b32" : grade.color); hull.addColorStop(.45, grade.hull); hull.addColorStop(1, "#161421");
    ctx.beginPath();
    const outline = [[1, 0], [.4, .45], [.1, .7], [-.65, .7], [-1, .25], [-1, -.25], [-.65, -.7], [.1, -.7], [.4, -.45]];
    outline.forEach(([x, y], i) => i ? ctx.lineTo(x * r, y * r) : ctx.moveTo(x * r, y * r));
    ctx.closePath(); ctx.fillStyle = hull; ctx.fill();
    ctx.strokeStyle = grade.color; ctx.lineWidth = .8; ctx.stroke(); ctx.shadowBlur = 0;
    for (const side of [-1, 1]) {
      ctx.beginPath(); ctx.moveTo(r * .45, side * r * .2);
      ctx.lineTo(0, side * r * .58); ctx.lineTo(-r * .6, side * r * .58);
      ctx.lineTo(-r * .8, side * r * .25); ctx.lineTo(-r * .2, side * r * .3);
      ctx.closePath(); ctx.fillStyle = grade.hull; ctx.fill();
      ctx.strokeStyle = "#d1a0b177"; ctx.lineWidth = .5; ctx.stroke();
      ctx.fillStyle = "#100f20"; ctx.fillRect(-r * .45, side * r * .42 - r * .08, r * .35, r * .16);
      ctx.strokeStyle = ship.fleet.some(f => f.alive && f.mode === "dock") ? "#8fe9ef" : "#f0b874";
      ctx.beginPath(); ctx.moveTo(-r * .45, side * r * .42); ctx.lineTo(-r * .1, side * r * .42); ctx.stroke();
      circle(r * .15, side * r * .46, Math.max(.5, r * .045), grade.color);
    }
    ctx.beginPath(); ctx.moveTo(-r * .65, 0); ctx.lineTo(r * .75, 0);
    ctx.strokeStyle = "#d6b7ca"; ctx.lineWidth = r * .1; ctx.stroke();
    circle(r * .05, 0, r * .23, "#241c35");
    circle(r * .05, 0, r * .12, grade.color);
    glow(r * .05, 0, r * .6, `${grade.color}44`);
  }

  function drawShip(ship) {
    if (!ship.alive || ship.mode === "dock") return;
    const x = screenX(ship.x), y = screenY(ship.y), r = ship.radius * camera.zoom;
    if (x < -30 || x > width + 30 || y < -30 || y > height + 30) return;
    ctx.save(); ctx.translate(x, y);
    ctx.rotate(ship.entity === "mothership" ? time * .05 : ship.entity === "gun" ? ship.aim : Math.atan2(ship.vy, ship.vx));
    if (ship.entity === "mothership") drawMothership(ship, r);
    else if (ship.entity === "carrier") {
      ctx.fillStyle = "#344c60"; ctx.strokeStyle = "#90b7c3"; ctx.lineWidth = .6 * camera.zoom;
      ctx.beginPath(); ctx.moveTo(r, 0); ctx.lineTo(r * .45, r * .32); ctx.lineTo(-r * .85, r * .38);
      ctx.lineTo(-r, 0); ctx.lineTo(-r * .85, -r * .38); ctx.lineTo(r * .45, -r * .32);
      ctx.closePath(); ctx.fill(); ctx.stroke();
      for (const side of [-1, 1]) {
        ctx.fillStyle = "#62788a";
        ctx.fillRect(-r * .7, side * r * .55 - r * .12, r * 1.05, r * .24);
        ctx.fillStyle = "#142331";
        ctx.fillRect(-r * .45, side * r * .55 - r * .05, r * .55, r * .1);
        ctx.fillStyle = "#a7e4de";
        ctx.fillRect(r * .15, side * r * .55 - r * .04, r * .12, r * .08);
        glow(-r * .8, side * r * .5, r * .45, "#6bcbff40");
      }
      ctx.fillStyle = "#172b3e"; ctx.fillRect(-r * .45, -r * .13, r * .9, r * .26);
      ctx.fillStyle = "#9bddd9"; ctx.fillRect(r * .28, -r * .09, r * .25, r * .18);
      ctx.strokeStyle = "#d8c9a6"; ctx.lineWidth = .4 * camera.zoom;
      ctx.beginPath(); ctx.moveTo(-r * .65, 0); ctx.lineTo(r * .1, 0); ctx.stroke();
    }
    else if (ship.entity === "gun") {
      ctx.beginPath();
      for (let i = 0; i < 6; i++) {
        const angle = i * Math.PI / 3;
        if (i === 0) ctx.moveTo(Math.cos(angle) * r, Math.sin(angle) * r);
        else ctx.lineTo(Math.cos(angle) * r, Math.sin(angle) * r);
      }
      ctx.closePath(); ctx.fillStyle = "#354855"; ctx.fill();
      ctx.strokeStyle = "#a1b7bd"; ctx.lineWidth = .6 * camera.zoom; ctx.stroke();
      circle(0, 0, r * .53, "#172935");
      for (const side of [-1, 1]) {
        ctx.fillStyle = "#b6aa8f";
        ctx.fillRect(0, side * r * .22 - .3 * camera.zoom, r + 1.4 * camera.zoom, .6 * camera.zoom);
      }
      circle(-r * .45, 0, .55 * camera.zoom, "#8ed9cf");
    }
    else {
      ctx.beginPath(); ctx.moveTo(r, 0); ctx.lineTo(-r, r * .7); ctx.lineTo(-r * .4, 0); ctx.lineTo(-r, -r * .7);
      ctx.closePath(); ctx.fillStyle = ship.entity === "drone" ? ship.owner === player ? "#74c9d1" : "#bc8ade" : ship.mode === "spent" ? "#635d69" : CONFIG.nests.grades[ship.grade].hull; ctx.fill();
      ctx.strokeStyle = ship.entity === "drone" ? "#d0f6ff" : CONFIG.nests.grades[ship.grade].color; ctx.lineWidth = .7; ctx.stroke();
      if (ship.entity === "drone" && ship.cargo > 0) circle(-r, 0, camera.zoom, "#ffd27c");
    }
    ctx.restore();
    if (ship.impact && time - ship.impact.at < .24) {
      const fraction = 1 - (time - ship.impact.at) / .24;
      ctx.save(); ctx.globalAlpha = fraction;
      circle(x, y, r * .7, "#fff5dd");
      ctx.beginPath(); ctx.arc(x, y, r + (1 - fraction) * 5 * camera.zoom, ship.impact.angle - .8, ship.impact.angle + .8);
      ctx.strokeStyle = "#ffc789"; ctx.lineWidth = camera.zoom; ctx.stroke(); ctx.restore();
    }
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

  function drawRegions() {
    const colors = { belt: "#b2a18a", nest: "#bf697c", system: "#d6bb82" };
    const names = { belt: "Asteroid Belt", nest: "Nest Sector", system: "Stellar System" };
    ctx.save();
    for (const region of activeRegions) {
      if (region.kind === "void" || region.kind === "system" && !seededSystems.has(region.key)) continue;
      const x = screenX(region.x), y = screenY(region.y), radius = region.radius * camera.zoom;
      if (x + radius < 0 || x - radius > width || y + radius < 0 || y - radius > height) continue;
      for (const point of region.points) {
        const px = screenX(point.x), py = screenY(point.y);
        if (px < 0 || px > width || py < 0 || py > height) continue;
        ctx.globalAlpha = point.alpha;
        circle(px, py, Math.max(.45, camera.zoom * .8), colors[region.kind]);
      }
      ctx.globalAlpha = .24; ctx.fillStyle = colors[region.kind]; ctx.font = "10px sans-serif"; ctx.textAlign = "center";
      ctx.fillText(SolarLanguage.translate(names[region.kind]), x, y - radius * .65);
    }
    ctx.restore();
  }

  function drawFleetRanges() {
    const artifacts = player.artifacts.filter(unit => unit.alive);
    ctx.save(); ctx.lineWidth = .6;
    const ring = (unit, radius, color, dash) => {
      ctx.beginPath(); ctx.setLineDash(dash);
      ctx.arc(screenX(unit.x), screenY(unit.y), radius * camera.zoom, 0, Math.PI * 2);
      ctx.strokeStyle = color; ctx.stroke();
    };
    if (artifacts.some(unit => unit.entity === "carrier" || unit.entity === "drone")) {
      const grade = CONFIG.fleet.grades[Math.min(3, Math.max(0, player.civ.tech - 3))];
      ring(player, grade.range, "#82cfd32b", [5, 9]);
    }
    const attackRange = CIV.stats(player).range;
    for (const gun of artifacts) if (gun.entity === "gun") ring(gun, attackRange, "#e5b65f26", [2, 6]);
    ctx.restore();
  }

  function draw() {
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.fillStyle = "#050911"; ctx.fillRect(0, 0, width, height);
    ctx.drawImage(nebula, 0, 0, width, height);
    drawRegions();
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
      drawFleetRanges();
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
    // 激光改为沿路径飞行的短光线，伤害仍在开火瞬间结算。
    for (const beam of beams) {
      const progress = clamp(1 - beam.life / beam.duration, 0, 1);
      const sx = screenX(beam.x), sy = screenY(beam.y), ex = screenX(beam.tx), ey = screenY(beam.ty);
      const dx = ex - sx, dy = ey - sy, length = Math.hypot(dx, dy) || 1;
      const headX = sx + dx * progress, headY = sy + dy * progress, tail = Math.min(length, 12);
      ctx.globalAlpha = clamp(beam.life / (beam.duration * .3), 0, 1);
      ctx.beginPath(); ctx.moveTo(headX - dx / length * tail, headY - dy / length * tail); ctx.lineTo(headX, headY);
      ctx.strokeStyle = beam.color; ctx.lineWidth = 1.4; ctx.stroke();
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

  const populationTrends = new WeakMap();
  function refreshHud() {
    if (choosingStart) return;
    const type = TYPES[player.type], c = player.civ, growth = CIV.progress(player);
    const percent = growth.total > 0 ? clamp(growth.value / growth.total * 100, 0, 100) : 0;
    const title = CONFIG.populationTitles.filter(t => c.population >= t.population).at(-1);
    SolarLanguage.text(ui.stage, type.name + (title ? " - " + title.name : "")); ui["stage-dot"].style.background = type.color; ui["stage-dot"].style.color = type.color;
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
    SolarLanguage.text(document.getElementById("life-value"), `${(c.population / 1e6).toFixed(1)} M`);
    const previous = populationTrends.get(player);
    const trend = previous || { population: c.population, direction: 0, at: time };
    if (c.population !== trend.population) {
      trend.direction = Math.sign(c.population - trend.population); trend.at = time;
    } else if (time - trend.at > 1) trend.direction = 0;
    trend.population = c.population; populationTrends.set(player, trend);
    const arrow = document.getElementById("life-trend");
    SolarLanguage.text(arrow, trend.direction > 0 ? "↑" : trend.direction < 0 ? "↓" : "");
    arrow.className = trend.direction > 0 ? "rising" : trend.direction < 0 ? "falling" : "";
    document.getElementById("life-stat").classList.toggle("overcrowded", CIV.pressure(player) > 1);
    SolarLanguage.text(document.getElementById("tech-stat"), `${c.tech}`);
    SolarLanguage.text(document.getElementById("upkeep-stat"), `${c.consumption.toFixed(2)} mass/year`);
    const fleetStatus = fleets.summary(player, time);
    SolarLanguage.text(document.getElementById("fleet-stat"), `${fleetStatus.mothers} / ${fleetStatus.total}`);
    document.getElementById("fleet-actions").hidden = ended || paused || choosingStart || c.tech < 3;
    SolarLanguage.text(document.getElementById("shield-stat"), `${c.shield.toFixed(1)} / ${CIV.stats(player).shield}`);
    const cityHp = c.cities.reduce((sum, city) => sum + city.hp, 0);
    const cityMaxHp = c.cities.reduce((sum, city) => sum + (city.hp > 0 ? city.maxHp : 0), 0);
    SolarLanguage.text(document.getElementById("city-stat"), cityHp.toFixed(1) + " / " + cityMaxHp.toFixed(1));
    document.getElementById("city-row").hidden = cityHp <= 0 && !c.city;
    SolarLanguage.text(document.getElementById("planet-kills"), format(player.kills.planet));
    SolarLanguage.text(document.getElementById("nest-kills"), format(player.kills.mothership));
    const satellites = bodies.filter(b => b.alive && b.host === player.id);
    SolarLanguage.text(ui.satellites, `${satellites.length}/${satelliteLimit(player.type)}`);
    if (!satellites.some(b => b.id === selectedSatelliteId)) { selectedSatelliteId = null; satelliteClickAt = -Infinity; }
    SolarLanguage.attribute(ui.speed, "title", `Thrust cap ${GRAVITY.propulsionLimit(player)} · Speed cap ${GRAVITY.speedLimit(player)}`);
    SolarLanguage.text(ui["next-stage"], growth.label);
    SolarLanguage.text(ui["progress-text"], `${Math.floor(percent)}%`); ui.progress.style.width = `${percent}%`;
    ui.progress.style.background = type.color;
    SolarArtifacts.refresh(player, time);
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
  document.getElementById("artifacts-panel").addEventListener("toggle", () => SolarArtifacts.refresh(player, time));
  document.getElementById("artifacts-panel").addEventListener("keydown", event => {
    if (event.code === "Space" || event.code.startsWith("Arrow")) event.stopPropagation();
  });
  document.getElementById("touch-pause").addEventListener("click", togglePause);
  document.getElementById("recall-fleet").addEventListener("click", recallFleet);
  document.getElementById("touch-trail").addEventListener("click", toggleOrbits);
  ui["pause-screen"].addEventListener("cancel", event => { event.preventDefault(); if (paused) togglePause(); });
  const startScreen = document.getElementById("start-screen");
  const startForm = document.getElementById("start-form");
  const startTypes = document.getElementById("start-types");
  function updateStartSummary() {
    const index = Number(startForm.elements.namedItem("start-type").value);
    const type = TYPES[index];
    SolarLanguage.text(document.getElementById("start-summary"), `${type.name} · Mass ${startingMass(index).toFixed(1)} · Room for ${satelliteLimit(index)} moons`);
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
    if (event.code === "KeyP") { event.preventDefault(); savePlayer(); return; }
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
    const detail = document.createElement("small"); SolarLanguage.text(detail, `Mass ${startingMass(index).toFixed(1)}`);
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

  resize(); openStartSelection(); requestAnimationFrame(frame);
})();
