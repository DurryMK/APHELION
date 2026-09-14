"use strict";

globalThis.SolarCivilization = (() => {
  const config = SolarConfig.civilization;
  const stage = body => SolarConfig.types[body.type];
  const eligible = body => !body.natural && stage(body).level >= 1;
  function create() {
    return { population: 0, tech: 0, research: 0, shield: 0, lastHit: -Infinity, incubation: 0, extinct: false, city: false };
  }
  function capacity(body) {
    if (!eligible(body)) return 0;
    const c = body.civ;
    const base = stage(body).level >= 5 && !c.city ? SolarConfig.types[5].population : stage(body).population;
    return base * (c.city ? 1 + config.cityCapacityBonus : 1) + (c.city ? body.cityMass * config.cityPopulationPerMass : 0);
  }
  function stats(body) { return config.technology[body.civ.tech]; }
  const incubationDuration = body => body.civ.extinct ? config.rebirthSeconds : config.incubationSeconds;
  function technologyCap(body) {
    if (!eligible(body)) return 0;
    const cap = capacity(body);
    let level = 0;
    for (let i = 1; i <= stage(body).techCap; i++) {
      if (cap >= config.technology[i].population) level = i;
    }
    return level;
  }
  function extinguish(body) {
    Object.assign(body.civ, { population: 0, tech: 0, research: 0, shield: 0, city: false, extinct: true, incubation: 0 });
  }
  function seedLife(body) {
    const c = body.civ;
    if (!eligible(body) || c.population > 0 || c.incubation < incubationDuration(body)) return;
    c.population = Math.min(config.seedPopulation, capacity(body));
    c.extinct = false;
    c.incubation = config.incubationSeconds;
  }
  function sync(body) {
    if (body.natural) return;
    const c = body.civ;
    if (!eligible(body)) {
      if (c.population > 0) extinguish(body);
      if (stage(body).level < 0) c.incubation = 0;
      return;
    }
    seedLife(body);
    c.population = Math.min(c.population, capacity(body));
    c.shield = Math.min(c.shield, stats(body).shield);
  }
  function research(body, seconds) {
    const c = body.civ;
    let upgraded = false;
    // 剩余研究时间只用于当前已经满足人口与容量门槛的下一科技。
    while (seconds > 0 && c.population > 0 && c.tech < technologyCap(body)) {
      const next = config.technology[c.tech + 1];
      if (c.population < next.population) break;
      const spent = Math.min(seconds, Math.max(0, next.research - c.research));
      c.research += spent; seconds -= spent;
      if (c.research < next.research) break;
      const oldShield = stats(body).shield;
      c.tech++; c.research = 0; upgraded = true;
      c.city = c.tech >= 4;
      c.shield = Math.min(stats(body).shield, c.shield + stats(body).shield - oldShield);
    }
    return upgraded;
  }
  function tick(body, dt, now) {
    if (body.natural) return false;
    const c = body.civ;
    if (stage(body).level < 0) return false;
    if (c.population === 0) {
      const duration = incubationDuration(body);
      const spent = Math.min(dt, Math.max(0, duration - c.incubation));
      c.incubation = Math.min(duration, c.incubation + spent);
      dt -= spent;
      seedLife(body);
      if (c.population === 0 || dt <= 0) return false;
    }
    if (!eligible(body)) return false;
    const cap = capacity(body);
    c.population = Math.min(c.population, cap);
    const before = c.population, next = config.technology[c.tech + 1];
    // 封闭形式的逻辑增长避免更新间隔改变人口增长速度。
    if (c.population > 0 && cap > c.population) c.population = cap / (1 + (cap / c.population - 1) * Math.exp(-Math.LN2 * dt / config.growthDoublingSeconds));
    let researchTime = dt;
    // 人口在本次更新中跨过门槛时，仅门槛之后的时间计入研究。
    if (next && before < next.population) {
      researchTime = 0;
      if (cap > next.population && c.population >= next.population) {
        const crossingTime = Math.log((cap / before - 1) / (cap / next.population - 1)) * config.growthDoublingSeconds / Math.LN2;
        researchTime = Math.max(0, dt - crossingTime);
      }
    }
    const upgraded = research(body, researchTime);
    const regenTime = Math.max(0, Math.min(dt, now - c.lastHit - config.shieldDelay));
    c.shield = Math.min(stats(body).shield, c.shield + stats(body).shield * config.shieldRegenFraction * regenTime);
    return upgraded;
  }
  function suffer(body, fraction) {
    const c = body.civ;
    if (c.population <= 0) return;
    c.population *= 1 - fraction;
    c.research *= 1 - fraction;
    if (c.population < 1) extinguish(body);
  }
  function progress(body) {
    const c = body.civ, format = n => Math.floor(n).toLocaleString();
    if (stage(body).level < 0) {
      const threshold = SolarConfig.types.find(t => t.level === 0).min;
      return { label: "合并陨石 · 形成行星", value: body.mass, total: threshold, detail: `质量达到 ${threshold} 后开始孕育生命` };
    }
    if (c.population === 0) {
      const duration = incubationDuration(body), complete = c.incubation >= duration;
      const first = SolarConfig.types.find(t => t.level === 1);
      return {
        label: complete && !eligible(body) ? "孕育完成 · 等待 1 档" : c.extinct ? "生命重新孕育" : "生命孕育中",
        value: Math.min(c.incubation, duration), total: duration,
        detail: `孕育 ${Math.min(c.incubation, duration).toFixed(1)} / ${duration} 秒${!eligible(body) ? ` · 吸收陨石至质量 ${first.min}，进入 1 档后获得人口容量` : ` · 完成后产生 ${config.seedPopulation} 人口`}`
      };
    }
    const cap = capacity(body), ceiling = technologyCap(body), next = config.technology[c.tech + 1];
    const researchDetail = next ? `科技 ${c.tech + 1} 需人口 ${format(next.population)} · 研究 ${c.research.toFixed(1)} / ${next.research} 秒` : "5 级科技已全部掌握";
    if (!next || c.tech >= ceiling) return {
      label: next ? "人口增长 · 科技达当前上限" : "人口增长 · 科技完备", value: c.population, total: cap,
      detail: `人口 ${format(c.population)} / ${format(cap)} · 当前可研究上限 ${ceiling} 级 · ${researchDetail}`
    };
    if (c.population < next.population) return {
      label: `科技 ${c.tech + 1} · 等待人口`, value: c.population, total: next.population,
      detail: `${researchDetail} · 人口达标前保留已有研究进度`
    };
    return { label: `科技 ${c.tech + 1} · 研究中`, value: c.research, total: next.research, detail: researchDetail };
  }
  return { create, capacity, stats, sync, research, tick, suffer, eligible, technologyCap, progress };
})();
