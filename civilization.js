"use strict";

globalThis.SolarCivilization = (() => {
  const config = SolarConfig.civilization;
  const totalMass = body => body.mass;
  const eligible = body => !body.natural && body.mass >= 24;
  function create() {
    return { population: 0, tech: 0, research: 0, shield: 0, lastHit: -Infinity, coreHitUntil: 0,
      incubation: 0, extinct: false, city: false, pressure: 0, consumption: 0,
      cities: SolarConfig.fleet.construction.cityHp.map(maxHp => ({ hp: 0, maxHp, built: false, lastHit: -Infinity })),
      projects: { shield: 0, gun: 0, carrier: 0, city0: 0, city1: 0 } };
  }
  function syncCities(body) {
    body.civ.city = body.civ.cities.some(city => city.built && city.hp > 0);
  }
  function stats(body) {
    const base = config.technology[body.civ.tech];
    const cities = body.civ.cities.filter(city => city.built && city.hp > 0).length;
    return { ...base, shield: base.shield * (1 + cities * .4) };
  }
  function pressure(body) {
    return body.civ.population / (Math.max(.1, totalMass(body) - config.minimumMass) * config.populationPerMass);
  }
  function buildSpeed(body) {
    if (body.civ.population < config.extinctionPopulation) return 0;
    return Math.min(SolarConfig.fleet.construction.maxSpeed, 1 + Math.log2(Math.max(1, body.civ.population / config.seedPopulation)) * .25);
  }
  function rings(body) {
    const first = body.civ.cities[0].hp > 0, second = body.civ.cities[1].hp > 0;
    const city0 = body.radius + 8, city1 = body.radius + 16;
    const outer = second ? city1 : first ? city0 : body.radius;
    return { city0, city1, shield: outer + 6, gun: outer + 18, carrier: outer + 34, outer };
  }
  function collisionRadius(body) {
    if (body.natural) return body.radius;
    const c = body.civ, cityRadius = c.cities[1].hp > 0 ? 16 : c.cities[0].hp > 0 ? 8 : 0;
    return body.radius + cityRadius + (c.shield > 0 ? 6 : 0);
  }
  function hasProducts(body) {
    return body.civ.shield > 0 || body.civ.cities.some(city => city.hp > 0) || body.artifacts.some(unit => unit.alive);
  }
  function extinguish(body) {
    for (const unit of body.artifacts) { unit.alive = false; if (unit.entity === "drone") unit.cargo = 0; }
    body.artifacts = [];
    const blockedUntil = body.civ.coreHitUntil;
    Object.assign(body.civ, create(), { extinct: true, coreHitUntil: blockedUntil });
    body.extinctionEvent = true;
  }
  function spend(body, amount, floor = config.minimumMass) {
    const taken = Math.min(Math.max(0, body.mass - floor), Math.max(0, amount));
    body.mass -= taken; return taken;
  }
  // 工程进度与实际支付的质量同步，资源不足时保留已完成进度。
  function fund(body, progress, cost) {
    return spend(body, Math.max(0, progress) * cost) / cost;
  }
  function repair(body, unit, dt, now, buildCost, docked = false) {
    if (body.civ.population < config.extinctionPopulation || unit.hp <= 0 || unit.hp >= unit.maxHp) return;
    const cfg = SolarConfig.fleet.repair;
    const elapsed = Math.max(0, Math.min(dt, now - unit.lastHit - cfg.delay));
    const healing = Math.min(unit.maxHp - unit.hp, unit.maxHp * (docked ? cfg.dockedFraction : cfg.fraction) * elapsed);
    const massPerHp = buildCost * cfg.fullCostRatio / unit.maxHp;
    unit.hp = Math.min(unit.maxHp, unit.hp + spend(body, healing * massPerHp) / massPerHp);
  }
  function seedLife(body) {
    if (!eligible(body) || body.civ.population > 0 || body.civ.incubation < config.incubationSeconds) return;
    body.civ.population = config.seedPopulation; body.civ.extinct = false;
  }
  function sync(body) {
    if (body.natural) return;
    if (body.civ.population > 0 && body.civ.population < config.extinctionPopulation) extinguish(body);
    syncCities(body);
    body.civ.shield = Math.min(body.civ.shield, stats(body).shield);
    body.civ.pressure = pressure(body);
  }
  function research(body, seconds) {
    const c = body.civ, next = config.technology[c.tech + 1];
    if (!next || c.population < config.extinctionPopulation) return false;
    const populationRate = Math.min(2, Math.sqrt(c.population / next.referencePopulation));
    const pressureRate = Math.max(0, Math.min(1, (3 - pressure(body)) / 2));
    c.research += seconds * populationRate * pressureRate;
    if (c.research < next.research) return false;
    c.research -= next.research; c.tech++; return true;
  }
  function tick(body, dt, now) {
    if (body.natural) return false;
    const c = body.civ, oldTech = c.tech;
    if (c.population === 0) {
      if (body.mass < config.minimumMass) return false;
      const spent = Math.min(dt, Math.max(0, config.incubationSeconds - c.incubation));
      c.incubation += spent; dt -= spent; seedLife(body);
      if (c.population === 0 || dt <= 0) return false;
    }
    c.pressure = pressure(body);
    const rate = c.pressure <= 1 ? config.growthRate * (1 - c.pressure) : -config.declineRate * Math.min(5, c.pressure - 1);
    c.population *= Math.exp(rate * dt);
    const demand = c.population / 1e9 * config.upkeepPerBillion * Math.min(3, (1 + pressure(body)) / 2);
    c.consumption = spend(body, demand * dt) / dt;
    if (c.population < config.extinctionPopulation) { extinguish(body); return oldTech !== 0; }
    for (let i = 0; i < c.cities.length; i++) {
      const city = c.cities[i];
      if (city.built && now - c.lastHit >= SolarConfig.fleet.repair.delay)
        repair(body, city, dt, now, SolarConfig.fleet.construction.cost.city[i]);
    }
    c.pressure = pressure(body); research(body, dt);
    // 完全破碎的护盾由建造队列重建，残存护盾才进行恢复。
    if (c.shield > 0) {
      const delay = c.city ? config.cityShieldDelay : config.shieldDelay;
      const regen = c.city ? config.cityShieldRegenFraction : config.shieldRegenFraction;
      const elapsed = Math.max(0, Math.min(dt, now - c.lastHit - delay));
      c.shield = Math.min(stats(body).shield, c.shield + stats(body).shield * regen * elapsed);
    }
    return c.tech !== oldTech;
  }
  function suffer(body, fraction) {
    const c = body.civ;
    if (c.population === 0) return;
    c.population *= Math.max(0, 1 - fraction);
    if (c.population < config.extinctionPopulation) extinguish(body);
    else c.pressure = pressure(body);
  }
  function progress(body) {
    const c = body.civ;
    if (body.mass < config.minimumMass && !c.population) return { label: "Merge asteroids", value: body.mass, total: config.minimumMass };
    if (!c.population) return { label: c.incubation >= config.incubationSeconds ? "Life ready · Reach Luna" : "Incubating life", value: c.incubation, total: config.incubationSeconds };
    const next = config.technology[c.tech + 1];
    if (!next) return { label: "Technology complete", value: 1, total: 1 };
    return { label: pressure(body) >= 3 ? "Research paused" : "Researching", value: c.research, total: next.research };
  }
  return { create, stats, sync, syncCities, pressure, buildSpeed, rings, collisionRadius, hasProducts,
    extinguish, research, tick, suffer, eligible, spend, fund, repair, progress };
})();
