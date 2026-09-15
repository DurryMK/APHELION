"use strict";

// 轨道设施和飞船不进入天体引力与碰撞列表。
globalThis.SolarFleet = {
  create(context) {
    const cfg = SolarConfig.fleet, CIV = SolarCivilization;
    const groups = new Map();
    let units = [], cells = new Map(), nextIndex = 0;
    const distance = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);
    const grade = owner => cfg.grades[Math.min(3, Math.max(0, owner.civ.tech - 3))];
    function nearby(owner, radius) {
      const result = [];
      for (let x = Math.floor((owner.x - radius) / cfg.searchCell); x <= Math.floor((owner.x + radius) / cfg.searchCell); x++) {
        for (let y = Math.floor((owner.y - radius) / cfg.searchCell); y <= Math.floor((owner.y + radius) / cfg.searchCell); y++) {
          const bucket = cells.get(x + "," + y);
          if (bucket) result.push(...bucket);
        }
      }
      return result;
    }
    function rebuildIndex(now) {
      if (now < nextIndex) return;
      nextIndex = now + cfg.searchInterval; cells = new Map();
      for (const target of [...context.bodies(), ...context.enemies(), ...units]) {
        if (!target.alive || target.entity === "carrier" || target.mode === "dock") continue;
        const key = Math.floor(target.x / cfg.searchCell) + "," + Math.floor(target.y / cfg.searchCell);
        if (!cells.has(key)) cells.set(key, []);
        cells.get(key).push(target);
      }
    }
    function own(owner, target) {
      return target === owner || target.ownerId === owner.id || target.host === owner.id;
    }
    function mineable(owner, target) {
      if (target.entity || own(owner, target) || !target.alive) return false;
      if (target.natural) return owner.civ.tech >= 7 && target.type !== 10;
      return target.civ.shield <= 0;
    }
    function enemy(owner, target) {
      return target.alive && !own(owner, target) && target.entity !== "carrier" &&
        (target.entity ? target.mode !== "dock" : !target.natural && target.type > 0 && target.civ.shield > 0);
    }
    // 求飞船追上匀速移动目标所需的时间，用于出航预算与提前返航。
    function intercept(from, target, speed) {
      const dx = target.x - from.x, dy = target.y - from.y;
      const a = target.vx * target.vx + target.vy * target.vy - speed * speed;
      const b = 2 * (dx * target.vx + dy * target.vy), c = dx * dx + dy * dy;
      if (c < 1) return 0;
      if (Math.abs(a) < .00001) return b < 0 ? -c / b : Infinity;
      const discriminant = b * b - 4 * a * c;
      if (discriminant < 0) return Infinity;
      const roots = [(-b - Math.sqrt(discriminant)) / (2 * a), (-b + Math.sqrt(discriminant)) / (2 * a)].filter(t => t >= 0);
      return roots.length ? Math.min(...roots) : Infinity;
    }
    function launchRate(owner, spec) {
      const ratio = Math.hypot(owner.vx, owner.vy) / spec.speed;
      if (ratio <= .25) return 1;
      if (ratio < .6) return 1 - (ratio - .25) / .35 * .6;
      return Math.max(0, (.85 - ratio) / .25 * .4);
    }
    function makeCarrier(owner, slot, now) {
      return { id: context.id(), entity: "carrier", ownerId: owner.id, owner, slot,
        x: owner.x, y: owner.y, vx: owner.vx, vy: owner.vy, radius: 6, alive: true,
        nextBuild: now + grade(owner).production, nextLaunch: now };
    }
    function sync(now) {
      const bodies = context.bodies();
      const candidates = bodies.filter(b => b.alive && !b.natural && b.civ.tech >= 3);
      const player = context.player();
      const chosen = candidates.filter(b => b !== player && distance(b, player) < cfg.activationRadius)
        .sort((a, b) => distance(a, player) - distance(b, player)).slice(0, cfg.activeCivilizations);
      if (player.alive && player.civ.tech >= 3) chosen.push(player);
      const active = new Set(chosen.map(b => b.id));
      const live = new Set(bodies.filter(b => b.alive).map(b => b.id));
      for (const owner of chosen) if (!groups.has(owner.id)) groups.set(owner.id, { owner, mothers: [], planes: [], enabled: true });
      for (const [id, group] of groups) {
        const owner = group.owner;
        if (!live.has(id) || owner.civ.tech < 3) {
          for (const unit of [...group.planes, ...group.mothers]) unit.alive = false;
          groups.delete(id); continue;
        }
        group.enabled = active.has(id);
        const spec = grade(owner);
        group.mothers = group.mothers.filter(m => {
          if (m.slot < spec.mothers) return true;
          m.alive = false; return false;
        });
        if (group.enabled) while (group.mothers.length < spec.mothers) group.mothers.push(makeCarrier(owner, group.mothers.length, now));
        group.planes = group.planes.filter(p => p.alive);
        for (const plane of group.planes) {
          const ratio = plane.hp / plane.maxHp;
          plane.maxHp = spec.hp; plane.hp = Math.min(spec.hp, ratio * spec.hp);
          plane.radius = owner.civ.tech >= 6 ? 3 : 2.5;
          plane.shots = Math.min(plane.shots, spec.ammo);
          if (!plane.mother.alive && group.mothers.length) {
            plane.mother = group.mothers[0]; plane.mode = "return"; plane.target = null;
          }
          if (plane.mode !== "dock") plane.expires = Math.min(plane.expires, plane.departed + spec.endurance);
        }
        for (const mother of group.mothers) {
          const assigned = group.planes.filter(p => p.mother === mother);
          assigned.forEach((p, i) => { p.retiring = i >= spec.perMother; if (p.retiring && p.mode !== "dock") p.mode = "return"; });
          mother.nextBuild = Math.min(mother.nextBuild, now + spec.production);
        }
        // 已靠港的远处舰队保留状态，停止生产、决策和移动。
        group.sleeping = !group.enabled && group.planes.every(p => p.mode === "dock");
      }
      units = [...groups.values()].filter(g => !g.sleeping).flatMap(g => [...g.mothers, ...g.planes]).filter(u => u.alive);
    }
    function recall(owner, now) {
      owner.recallUntil = now + cfg.recallSeconds;
      const group = groups.get(owner.id);
      if (group) for (const plane of group.planes) if (plane.alive && plane.mode !== "dock") {
        plane.mode = "return"; plane.target = null;
      }
    }
    function safeMission(plane, target, spec) {
      const outward = intercept(plane, target, spec.speed);
      if (!Number.isFinite(outward)) return false;
      const future = { x: target.x + target.vx * outward, y: target.y + target.vy * outward };
      const base = plane.mother;
      const home = { x: base.x + base.vx * outward, y: base.y + base.vy * outward, vx: base.vx, vy: base.vy };
      const returning = intercept(future, home, spec.speed);
      return outward + returning + spec.cargo / spec.mining + Math.max(8, spec.endurance * .2) < spec.endurance;
    }
    function chooseTarget(plane, group, now) {
      const owner = group.owner, spec = grade(owner);
      const reservations = new Map();
      for (const p of group.planes) if (p !== plane && p.alive && p.target) reservations.set(p.target.id, (reservations.get(p.target.id) || 0) + 1);
      let result = null, score = Infinity;
      for (const target of nearby(owner, spec.range)) {
        if (!target.alive || distance(target, owner) > spec.range || own(owner, target)) continue;
        const hostile = enemy(owner, target), resource = mineable(owner, target);
        if (!hostile && !resource || !safeMission(plane, target, spec)) continue;
        const rank = hostile ? target.entity === "mothership" ? 0 : target.entity ? 1 : 2 : 3;
        const value = rank * 100000 + (reservations.get(target.id) || 0) * 500 + distance(plane, target) - (plane.target === target ? 250 : 0);
        if (value < score) { score = value; result = target; }
      }
      plane.nextSearch = now + cfg.searchInterval + (plane.id % 5) * .03;
      plane.target = result;
    }
    function decisions(now) {
      rebuildIndex(now);
      for (const group of groups.values()) {
        if (group.sleeping) continue;
        if (!group.owner.alive) {
          for (const unit of [...group.mothers, ...group.planes]) unit.alive = false;
          continue;
        }
        const owner = group.owner, spec = grade(owner), rate = launchRate(owner, spec);
        for (const mother of group.mothers) {
          if (!group.enabled || now < mother.nextBuild) continue;
          if (group.planes.filter(p => p.alive && p.mother === mother).length >= spec.perMother) continue;
          if (owner.mass + owner.cityMass - SolarConfig.civilization.minimumMass < spec.cost) continue;
          CIV.spend(owner, spec.cost); context.resize(owner);
          const plane = { id: context.id(), entity: "drone", ownerId: owner.id, owner, mother,
            x: mother.x, y: mother.y, vx: 0, vy: 0, radius: owner.civ.tech >= 6 ? 3 : 2.5,
            hp: spec.hp, maxHp: spec.hp, alive: true, mode: "dock", readyAt: now + spec.supply,
            shots: spec.ammo, cargo: 0, departed: now, expires: now, nextAttack: now,
            nextSearch: now + (mother.slot * .13), target: null, retiring: false };
          group.planes.push(plane); units.push(plane); mother.nextBuild = now + spec.production;
        }
        for (const plane of group.planes) {
          if (!plane.alive) continue;
          const mother = plane.mother;
          if (!mother.alive) { plane.alive = false; continue; }
          if (plane.mode === "dock") {
            if (plane.retiring) { plane.alive = false; continue; }
            if (now < plane.readyAt) continue;
            plane.hp = spec.hp; plane.shots = spec.ammo;
            if (!group.enabled || now < owner.recallUntil || rate <= 0 || now < mother.nextLaunch || now < plane.nextSearch) continue;
            chooseTarget(plane, group, now);
            if (!plane.target) continue;
            plane.mode = enemy(owner, plane.target) ? "attack" : "mine";
            plane.departed = now; plane.expires = now + spec.endurance;
            mother.nextLaunch = now + 1 / rate;
          } else {
            if (now >= plane.expires) { context.destroy(plane, null, "endurance"); continue; }
            const returnTime = intercept(plane, mother, spec.speed);
            if (!group.enabled || plane.retiring || now < owner.recallUntil || plane.shots <= 0 || plane.hp < spec.hp * .3 ||
              Math.hypot(owner.vx, owner.vy) >= spec.speed * .9 || plane.expires - now < returnTime + Math.max(8, spec.endurance * .2) ||
              plane.cargo >= spec.cargo || distance(plane, owner) > spec.range) {
              plane.mode = "return"; plane.target = null;
            }
          }
          if (plane.mode === "return" || plane.mode === "dock") continue;
          if (!plane.target?.alive || distance(plane.target, owner) > spec.range) plane.target = null;
          if (now >= plane.nextSearch) chooseTarget(plane, group, now);
          if (!plane.target) { plane.mode = "return"; continue; }
          const target = plane.target, d = distance(plane, target);
          if (enemy(owner, target)) {
            plane.mode = "attack";
            if (d <= spec.attackRange && now >= plane.nextAttack && plane.shots > 0) {
              context.fire(plane, target, spec.damage); plane.shots--;
              plane.nextAttack = Math.max(now - cfg.decisionInterval, plane.nextAttack) + spec.interval;
            }
          } else if (mineable(owner, target)) {
            plane.mode = "mine";
            const standOff = target.natural ? SolarConfig.types[target.type].hazardRange + 8 : target.radius + 5;
            if (d <= standOff + 3) {
              const fraction = target.natural ? target.type === 9 ? .25 : .5 : 1;
              plane.cargo += context.harvest(target, Math.min(Math.max(0, spec.cargo - plane.cargo), spec.mining * fraction * cfg.decisionInterval), owner, now);
            }
          } else { plane.target = null; plane.mode = "return"; }
        }
      }
      units = units.filter(u => u.alive);
    }
    function move(dt, now) {
      for (const group of groups.values()) {
        if (group.sleeping) continue;
        if (!group.owner.alive) {
          for (const unit of [...group.mothers, ...group.planes]) unit.alive = false;
          continue;
        }
        const owner = group.owner, spec = grade(owner);
        for (const mother of group.mothers) {
          const orbit = owner.radius + (owner.civ.tech >= 6 ? 36 : owner.civ.city ? 25 : 20);
          const angle = now * .12 + owner.phase + mother.slot * Math.PI * 2 / group.mothers.length;
          mother.x = owner.x + Math.cos(angle) * orbit; mother.y = owner.y + Math.sin(angle) * orbit;
          mother.vx = owner.vx - Math.sin(angle) * orbit * .12;
          mother.vy = owner.vy + Math.cos(angle) * orbit * .12;
        }
        for (const plane of group.planes) {
          if (!plane.alive) continue;
          if (plane.mode === "dock") {
            plane.x = plane.mother.x; plane.y = plane.mother.y; plane.vx = plane.mother.vx; plane.vy = plane.mother.vy; continue;
          }
          if (now >= plane.expires) { context.destroy(plane, null, "endurance"); continue; }
          const target = plane.mode === "return" ? plane.mother : plane.target;
          if (!target?.alive) { plane.mode = "return"; plane.target = null; continue; }
          const d = distance(plane, target);
          const stop = plane.mode === "return" ? 2 : plane.mode === "mine" ?
            target.natural ? SolarConfig.types[target.type].hazardRange + 8 : target.radius + 5 : spec.attackRange * .65;
          const travel = Math.min(spec.speed * dt, Math.max(0, d - stop));
          const dx = target.x - plane.x, dy = target.y - plane.y;
          plane.vx = d > 0 ? dx / d * travel / dt : 0;
          plane.vy = d > 0 ? dy / d * travel / dt : 0;
          plane.x += plane.vx * dt; plane.y += plane.vy * dt;
          if (plane.mode === "return" && distance(plane, plane.mother) <= plane.mother.radius + 2) {
            if (plane.cargo > 0) context.gain(owner, plane.cargo);
            plane.cargo = 0; plane.mode = "dock"; plane.target = null; plane.readyAt = now + spec.supply;
          }
        }
      }
    }
    function summary(owner, now) {
      const group = groups.get(owner.id);
      const planes = group ? group.planes.filter(p => p.alive) : [];
      return { mothers: group ? group.mothers.length : 0, total: planes.length,
        away: planes.filter(p => p.mode !== "dock").length, cargo: planes.reduce((s, p) => s + p.cargo, 0),
        recall: Math.max(0, Math.ceil(owner.recallUntil - now)) };
    }
    return { sync, decisions, move, recall, summary, nearby, get units() { return units; } };
  }
};
