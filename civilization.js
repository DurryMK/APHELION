"use strict";

globalThis.SolarCivilization = (() => {
  const config = SolarConfig.civilization;
  const totalMass = body => body.mass + body.cityMass;
  const eligible = body => !body.natural && body.mass >= 24;
  function create() {
    return { population: 0, tech: 0, knowledge: 0, research: 0, shield: 0,
      lastHit: -Infinity, incubation: 0, extinct: false, city: false, shortage: 0,
      pressure: 0, consumption: 0 };
  }
  // 适宜人口是供养平衡点，不是截断人口的硬上限。
  function capacity(body) {
    if (body.natural || body.mass <= config.minimumMass) return 0;
    return totalMass(body) * config.populationPerMass * (body.civ.tech >= 6 ? 4 : body.civ.tech >= 5 ? 2 : 1);
  }
  const stats = body => config.technology[body.civ.tech];
  const incubationDuration = body => body.civ.extinct ? config.rebirthSeconds : config.incubationSeconds;
  function extinguish(body) {
    Object.assign(body.civ, create(), { extinct: true });
  }
  function spend(body, amount, floor = config.minimumMass) {
    const taken = Math.min(Math.max(0, totalMass(body) - floor), Math.max(0, amount));
    const city = Math.min(body.cityMass, taken);
    body.cityMass -= city;
    body.mass -= taken - city;
    return taken;
  }
  function seedLife(body) {
    if (!eligible(body) || body.civ.population > 0 || body.civ.incubation < incubationDuration(body)) return;
    body.civ.population = config.seedPopulation;
    body.civ.extinct = false;
  }
  function sync(body) {
    if (body.natural) return;
    if (body.mass < config.minimumMass) {
      if (body.civ.population > 0) extinguish(body);
      body.civ.incubation = 0;
      return;
    }
    seedLife(body);
    body.civ.city = body.civ.tech >= 5;
    body.civ.shield = Math.min(body.civ.shield, stats(body).shield);
  }
  function setLevel(body, level) {
    const oldShield = stats(body).shield;
    body.civ.tech = level;
    body.civ.city = level >= 5;
    body.civ.shield = Math.max(0, Math.min(stats(body).shield, body.civ.shield + stats(body).shield - oldShield));
  }
  function research(body, seconds) {
    const c = body.civ, next = config.technology[c.knowledge + 1];
    if (!next || c.population < next.population || c.tech < c.knowledge) return false;
    const populationRate = Math.min(2, Math.sqrt(c.population / next.population));
    const pressureRate = c.pressure > 1 ? 1 / (c.pressure * c.pressure) : 1;
    c.research += seconds * populationRate * pressureRate;
    if (c.research < next.research) return false;
    c.research = 0; c.knowledge++;
    setLevel(body, c.knowledge);
    return true;
  }
  function tick(body, dt, now) {
    if (body.natural || body.mass < config.minimumMass) return false;
    const c = body.civ, oldTech = c.tech;
    if (c.population === 0) {
      const spent = Math.min(dt, Math.max(0, incubationDuration(body) - c.incubation));
      c.incubation += spent; dt -= spent; seedLife(body);
      if (c.population === 0 || dt <= 0) return false;
    }
    const supported = capacity(body);
    if (supported > 0) {
      const rate = c.population > supported ? config.declineRate : config.growthRate;
      // 逻辑增长的解析解保证低帧率时仍平滑趋近供养平衡。
      c.population = supported / (1 + (supported / c.population - 1) * Math.exp(-rate * dt));
      c.pressure = c.population / supported;
    } else {
      c.population *= Math.exp(-.5 * dt);
      c.pressure = 4;
    }
    const demand = c.population / 1e9 * config.upkeepPerBillion * Math.min(3, (1 + c.pressure) / 2);
    c.consumption = spend(body, demand * dt) / dt;
    if (c.population < 1) { extinguish(body); return oldTech !== 0; }
    let operating = c.knowledge;
    while (operating > 0 && c.population < config.technology[operating].population * config.retentionRatio) operating--;
    if (operating < c.tech) {
      c.shortage += dt;
      if (c.shortage >= config.downgradeDelay) { setLevel(body, operating); c.shortage = 0; }
    } else {
      c.shortage = 0;
      let recovered = c.tech;
      while (recovered < c.knowledge && c.population >= config.technology[recovered + 1].population) recovered++;
      if (recovered > c.tech) setLevel(body, recovered);
    }
    research(body, dt);
    const delay = c.city ? config.cityShieldDelay : config.shieldDelay;
    const regen = c.city ? config.cityShieldRegenFraction : config.shieldRegenFraction;
    const regenTime = Math.max(0, Math.min(dt, now - c.lastHit - delay));
    c.shield = Math.min(stats(body).shield, c.shield + stats(body).shield * regen * regenTime);
    return c.tech !== oldTech;
  }
  function suffer(body, fraction) {
    const c = body.civ;
    const hadLife = c.population > 0;
    c.population *= Math.max(0, 1 - fraction);
    c.research *= Math.max(0, 1 - fraction);
    if (hadLife && c.population < 1) extinguish(body);
  }
  function progress(body) {
    const c = body.civ;
    if (body.mass < config.minimumMass) return { label: "Merge asteroids", value: body.mass, total: config.minimumMass };
    if (!c.population) return { label: c.incubation >= incubationDuration(body) ? "Life ready · Reach Luna" : "Incubating life", value: c.incubation, total: incubationDuration(body) };
    if (c.shortage > 0) return { label: "Civilization under strain", value: c.shortage, total: config.downgradeDelay };
    if (c.tech < c.knowledge) return { label: "Rebuilding civilization", value: c.population, total: config.technology[c.tech + 1].population };
    const next = config.technology[c.knowledge + 1];
    if (!next) return { label: "Population balance", value: c.population, total: capacity(body) };
    if (c.population < next.population) return { label: "Awaiting population", value: c.population, total: next.population };
    return { label: "Researching", value: c.research, total: next.research };
  }
  return { create, capacity, stats, sync, research, tick, suffer, eligible, spend, progress };
})();
