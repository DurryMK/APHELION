"use strict";

// 人造物面板只读取模拟状态，展开时复用行节点更新数据。
globalThis.SolarArtifacts = (() => {
  const panel = document.getElementById("artifacts-panel");
  const list = document.getElementById("artifacts-list");
  const empty = document.getElementById("artifacts-empty");
  const rows = new Map();
  const language = SolarLanguage;

  function row(key, name, status, value, maximum, building = false, extra = "") {
    let entry = rows.get(key);
    if (!entry) {
      const node = document.createElement("div");
      node.className = "artifact-row";
      node.setAttribute("role", "listitem");
      node.innerHTML = '<div class="artifact-heading"><strong class="artifact-name"></strong><span class="artifact-state"></span></div><div class="artifact-reading"><span></span><span></span></div><div class="artifact-track" aria-hidden="true"><i></i></div><div class="artifact-extra"></div>';
      const reading = node.querySelector(".artifact-reading");
      entry = { node, name: node.querySelector("strong"), status: node.querySelector(".artifact-state"),
        label: reading.firstElementChild, value: reading.lastElementChild,
        fill: node.querySelector("i"), extra: node.querySelector(".artifact-extra") };
      rows.set(key, entry);
    }
    entry.seen = true;
    language.text(entry.name, name);
    language.text(entry.status, status);
    language.text(entry.label, building ? "Build progress" : "Hull");
    language.text(entry.value, building ? `${Math.floor(value * 100)}%` : `${value.toFixed(1)} / ${maximum.toFixed(1)}`);
    const ratio = maximum > 0 ? Math.min(1, Math.max(0, value / maximum)) : 0;
    entry.fill.style.width = ratio * 100 + "%";
    entry.fill.style.background = building ? "#91a6ba" : ratio < .3 ? "#ff6575" : "#62dcc9";
    language.text(entry.extra, extra);
    entry.extra.hidden = !extra;
    return entry.node;
  }

  function refresh(body, now) {
    if (!panel.open || !body) return;
    const c = body.civ, cfg = SolarConfig.fleet;
    const artifacts = body.artifacts.filter(unit => unit.alive);
    const guns = artifacts.filter(unit => unit.entity === "gun").sort((a, b) => a.slot - b.slot);
    const mothers = artifacts.filter(unit => unit.entity === "carrier").sort((a, b) => a.slot - b.slot);
    const harbors = artifacts.filter(unit => unit.entity === "harbor").sort((a, b) => a.slot - b.slot);
    const spec = cfg.gradeFor(c.tech);
    const lowMass = body.mass <= SolarConfig.civilization.minimumMass;
    const ordered = [];
    for (const entry of rows.values()) entry.seen = false;
    const add = (...args) => ordered.push(row(...args));
    const buildState = (active, free = false) => now < c.coreHitUntil ? "Build paused" :
      !active ? "Queued" : lowMass && !free ? "Low resources" : "Building";
    const condition = (unit, lastHit = unit.lastHit) => {
      if (now - lastHit < cfg.repair.delay) return "Under fire";
      if (unit.hp < unit.maxHp) return lowMass ? "Low resources" : "Repairing";
      return "Operational";
    };
    let queued = false;
    if (c.tech >= 1) {
      const shieldMax = SolarCivilization.stats(body).shield;
      const shieldDelay = c.city ? SolarConfig.civilization.cityShieldDelay : SolarConfig.civilization.shieldDelay;
      if (c.shield > 0) add("shield", "Shield", now - c.lastHit < shieldDelay ? "Under fire" :
        c.shield < shieldMax ? "Recovering" : "Operational", c.shield, shieldMax);
      else {
        add("shield", "Shield", buildState(true, true), c.projects.shield, 1, true);
        queued = true;
      }
    }
    for (const [kind, units, limit, label] of [
      ["gun", guns, c.tech >= 2 ? cfg.gunLimit : 0, "Orbital gun"],
      ["carrier", mothers, c.tech >= 3 ? spec.mothers : 0, "Carrier"],
      ["harbor", harbors, c.tech >= cfg.harbor.tech ? cfg.harbor.limit : 0, "Devourer harbor"]
    ]) {
      let firstMissing = true;
      for (let slot = 0; slot < limit; slot++) {
        const unit = units.find(item => item.slot === slot);
        if (unit) add(kind + slot, `${label} ${slot + 1}`, condition(unit), unit.hp, unit.maxHp);
        else {
          add(kind + slot, `${label} ${slot + 1}`, buildState(!queued && firstMissing), firstMissing ? c.projects[kind] : 0, 1, true);
          firstMissing = false;
        }
      }
      if (units.length < limit) queued = true;
    }
    c.cities.forEach((city, index) => {
      if (c.tech < cfg.construction.cityTech[index]) return;
      if (city.built) add("city" + index, `Space city ${index + 1}`,
        condition(city, Math.max(c.lastHit, city.lastHit)), city.hp, city.maxHp);
      else {
        add("city" + index, `Space city ${index + 1}`, buildState(!queued), c.projects["city" + index], 1, true,
          `Hull ${city.hp.toFixed(1)} / ${city.maxHp.toFixed(1)}`);
        queued = true;
      }
    });
    for (const mother of mothers) {
      const planes = artifacts.filter(unit => unit.entity === "drone" && unit.mother === mother).sort((a, b) => a.id - b.id);
      planes.forEach((plane, index) => {
        let status = { dock: "Docked", patrol: "Patrolling", attack: "Attacking", return: "Returning" }[plane.mode];
        if (plane.mode === "dock") {
          if (plane.hp < plane.maxHp) status = now - plane.lastHit < cfg.repair.delay ? "Repair pending" : condition(plane);
          else if (now < plane.readyAt) status = "Resupplying";
        } else if (now - plane.lastHit < cfg.repair.delay) status = "Under fire · " + status;
        const details = `Ammo ${plane.shots} / ${spec.ammo}` +
          (plane.mode === "dock" ? "" : ` · Endurance ${Math.max(0, Math.ceil(plane.expires - now))} s`);
        add("ship" + plane.id, `Ship ${mother.slot + 1}.${index + 1}`, status, plane.hp, plane.maxHp, false, details);
      });
      if (planes.length < cfg.perMotherFor(c.tech)) add("production" + mother.id, `Carrier ${mother.slot + 1} · Ship`,
        buildState(true), mother.buildProgress, 1, true);
    }
    const devourers = artifacts.filter(unit => unit.entity === "devourer").sort((a, b) => a.id - b.id);
    devourers.forEach((unit, index) => {
      const status = { orbit: "Patrolling", travel: "Deploying", wrapping: "Enveloping", anchor: "Devouring", return: "Recovering" }[unit.state] || "Operational";
      add("devourer" + unit.id, `Devourer ship ${index + 1}`, status, unit.hp, unit.maxHp);
    });
    // 删除失效行时同时释放语言绑定，避免长期游戏积累节点。
    for (const [key, entry] of rows) if (!entry.seen) {
      for (const node of [entry.name, entry.status, entry.label, entry.value, entry.extra]) language.forget(node);
      entry.node.remove(); rows.delete(key);
    }
    ordered.forEach((node, index) => {
      if (list.children[index] !== node) list.insertBefore(node, list.children[index] || null);
    });
    empty.hidden = ordered.length > 0;
    list.hidden = ordered.length === 0;
  }
  return { refresh };
})();
