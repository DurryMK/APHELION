"use strict";

globalThis.SolarGravity = (() => {
  const config = SolarConfig.gravity;
  const mass = body => body.mass;
  const participates = body => body.alive && !body.entity;
  const range = body => SolarConfig.types[body.type].gravityRange * (body.isPlayer ? config.playerRangeScale : 1);
  const captureRange = body => body.natural || body.type === 0 ? 0 : range(body) * SolarConfig.capture.rangeRatio;
  const propulsionLimit = body => 200 + Math.max(0, Math.min(5, SolarConfig.types[body.type].level)) * 50;
  const speedLimit = body => body.isPlayer ? propulsionLimit(body) * config.playerSpeedMultiplier : config.bodySpeedLimit;

  function kernel(a, b, distanceSquared) {
    const radius = Math.max(range(a), range(b));
    if (distanceSquared >= radius * radius) return 0;
    const distance = Math.sqrt(distanceSquared);
    const edge = Math.max(0, (distance / radius - config.fadeStart) / (1 - config.fadeStart));
    const fade = 1 - edge * edge * (3 - 2 * edge);
    const softening = Math.max(config.softening, (a.radius + b.radius) * .5);
    return config.constant * fade / (distanceSquared + softening * softening) ** 1.5;
  }

  function accelerationFrom(target, source) {
    if (!participates(target) || !participates(source) || source.id === target.id) return { x: 0, y: 0 };
    const dx = source.x - target.x, dy = source.y - target.y;
    const factor = mass(source) * kernel(target, source, dx * dx + dy * dy);
    return { x: dx * factor, y: dy * factor };
  }

  function spatialIndex(bodies) {
    const cellSize = config.cellSize, cells = new Map();
    let maxRange = 0;
    for (const body of bodies) {
      if (!participates(body)) continue;
      maxRange = Math.max(maxRange, range(body));
      const key = `${Math.floor(body.x / cellSize)},${Math.floor(body.y / cellSize)}`;
      if (!cells.has(key)) cells.set(key, []);
      cells.get(key).push(body);
    }
    function query(x, y, radius) {
      const result = [];
      const left = Math.floor((x - radius) / cellSize), right = Math.floor((x + radius) / cellSize);
      const top = Math.floor((y - radius) / cellSize), bottom = Math.floor((y + radius) / cellSize);
      for (let cx = left; cx <= right; cx++) for (let cy = top; cy <= bottom; cy++) {
        const bucket = cells.get(`${cx},${cy}`);
        if (bucket) result.push(...bucket);
      }
      return result;
    }
    return { query, maxRange };
  }

  function accumulate(bodies) {
    const active = bodies.filter(participates), index = spatialIndex(active);
    for (const body of active) { body.ax = 0; body.ay = 0; }
    for (const a of active) for (const b of index.query(a.x, a.y, index.maxRange)) {
      if (b.id <= a.id) continue;
      const dx = b.x - a.x, dy = b.y - a.y;
      // 同一对天体共用软化与截断系数，保持引力作用与反作用对称。
      const factor = kernel(a, b, dx * dx + dy * dy);
      a.ax += dx * factor * mass(b); a.ay += dy * factor * mass(b);
      b.ax -= dx * factor * mass(a); b.ay -= dy * factor * mass(a);
    }
    return index;
  }

  function tidalRatio(host, satellite, index) {
    let x = 0, y = 0;
    const sources = new Map();
    for (const body of [host, satellite]) for (const source of index.query(body.x, body.y, index.maxRange)) sources.set(source.id, source);
    for (const source of sources.values()) {
      if (!source.alive || source.id === host.id || source.id === satellite.id || source.host === host.id) continue;
      const atSatellite = accelerationFrom(satellite, source), atHost = accelerationFrom(host, source);
      x += atSatellite.x - atHost.x; y += atSatellite.y - atHost.y;
    }
    const binding = accelerationFrom(satellite, host), strength = Math.hypot(binding.x, binding.y);
    return strength > 0 ? Math.hypot(x, y) / strength : Infinity;
  }

  function limitVelocity(body) {
    const speed = Math.hypot(body.vx, body.vy), limit = speedLimit(body);
    if (speed > limit) { body.vx *= limit / speed; body.vy *= limit / speed; }
  }

  function kick(body, dt, drive) {
    body.vx += body.ax * dt; body.vy += body.ay * dt;
    if (body.isPlayer && drive.active) {
      const speed = Math.hypot(body.vx, body.vy), ceiling = Math.max(speed, propulsionLimit(body));
      const acceleration = 23 / (1 + Math.log2(Math.max(1, mass(body) / 8)) * .16);
      body.vx += drive.x * acceleration * dt; body.vy += drive.y * acceleration * dt;
      const drivenSpeed = Math.hypot(body.vx, body.vy);
      if (drivenSpeed > ceiling) { body.vx *= ceiling / drivenSpeed; body.vy *= ceiling / drivenSpeed; }
    }
    limitVelocity(body);
  }

  function substeps(bodies, dt) {
    let count = 1;
    for (const body of bodies) if (participates(body)) {
      const speed = Math.hypot(body.vx, body.vy), acceleration = Math.hypot(body.ax, body.ay);
      count = Math.max(count, Math.ceil((speed * dt + acceleration * dt * dt * .5) / config.travelPerStep), Math.ceil(acceleration * dt / config.velocityChangePerStep));
    }
    return Math.min(config.maxSubsteps, count);
  }

  function closestApproach(a, b) {
    const x = b.px - a.px, y = b.py - a.py;
    const dx = b.x - a.x - x, dy = b.y - a.y - y;
    const lengthSquared = dx * dx + dy * dy;
    const t = lengthSquared > 0 ? Math.max(0, Math.min(1, -(x * dx + y * dy) / lengthSquared)) : 0;
    return Math.hypot(x + dx * t, y + dy * t);
  }

  function predictClosest(bodies, playerId, targetIds, duration, drive) {
    const copies = bodies.filter(participates).map(b => ({ ...b }));
    const focus = copies.find(b => b.id === playerId), byId = new Map(copies.map(b => [b.id, b]));
    const distances = new Map(targetIds.map(id => [id, Math.hypot(byId.get(id).x - focus.x, byId.get(id).y - focus.y)]));
    let elapsed = 0;
    while (elapsed < duration) {
      const dt = Math.min(SolarConfig.warning.predictionStep, duration - elapsed);
      accumulate(copies);
      for (const body of copies) {
        body.px = body.x; body.py = body.y;
        kick(body, dt * .5, drive);
        body.x += body.vx * dt; body.y += body.vy * dt;
      }
      accumulate(copies);
      for (const body of copies) kick(body, dt * .5, drive);
      for (const id of targetIds) distances.set(id, Math.min(distances.get(id), closestApproach(focus, byId.get(id))));
      elapsed += dt;
    }
    return distances;
  }

  return { mass, participates, range, captureRange, propulsionLimit, speedLimit, accelerationFrom, spatialIndex, accumulate, tidalRatio, kick, limitVelocity, substeps, closestApproach, predictClosest };
})();
