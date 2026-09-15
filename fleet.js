"use strict";

// 轨道设施和飞船不进入天体引力与碰撞列表。
globalThis.SolarFleet = {
  steer(ship, target, speed, acceleration, response, stop, dt) {
    const dx = target.x - ship.x, dy = target.y - ship.y, length = Math.hypot(dx, dy);
    const closing = Math.max(-speed, Math.min(speed, (length - stop) * response));
    let vx = target.vx + (length > 0 ? dx / length * closing : 0);
    let vy = target.vy + (length > 0 ? dy / length * closing : 0);
    const desiredSpeed = Math.hypot(vx, vy);
    if (desiredSpeed > speed) { vx *= speed / desiredSpeed; vy *= speed / desiredSpeed; }
    const changeX = vx - ship.vx, changeY = vy - ship.vy, change = Math.hypot(changeX, changeY);
    const fraction = change > 0 ? Math.min(1, acceleration * dt / change) : 0;
    ship.vx += changeX * fraction; ship.vy += changeY * fraction;
  },
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
        if (!target.alive || target.mode === "dock") continue;
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
      return !CIV.hasProducts(target);
    }
    function enemy(owner, target) {
      return target.alive && !own(owner, target) &&
        (target.entity ? target.mode !== "dock" : !target.natural && target.type > 0 && CIV.hasProducts(target));
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
    function facilityAngle(owner, slot, now, entity) {
      const count = entity === "gun" ? cfg.gunLimit : grade(owner).mothers;
      // 母舰位于相邻轨道炮之间，两组设施保持相同角速度。
      const offset = entity === "carrier" ? Math.PI / cfg.gunLimit : 0;
      return now * cfg.carrierOrbitSpeed + owner.phase + offset + slot * Math.PI * 2 / count;
    }
    function makeFacility(owner, slot, now, entity) {
      const orbit = CIV.rings(owner)[entity];
      const angle = facilityAngle(owner, slot, now, entity);
      const x = Math.cos(angle) * orbit, y = Math.sin(angle) * orbit;
      const hp = (entity === "gun" ? cfg.gunHp : cfg.carrierHp) * (1 + owner.civ.tech * .15);
      const unit = { id: context.id(), entity, ownerId: owner.id, owner, slot,
        x: owner.x + x, y: owner.y + y, vx: owner.vx, vy: owner.vy, radius: entity === "gun" ? 3.5 : 6, alive: true,
        hp, maxHp: hp, aim: angle, buildProgress: 0, nextLaunch: now, nextAttack: now,
        orbitMotion: { x, y, vx: -y * cfg.carrierOrbitSpeed, vy: x * cfg.carrierOrbitSpeed } };
      owner.artifacts.push(unit); return unit;
    }
    function sync(now) {
      const bodies = context.bodies();
      const candidates = bodies.filter(b => b.alive && !b.natural && b.civ.tech >= 1);
      const player = context.player();
      const chosen = candidates.filter(b => b !== player && distance(b, player) < cfg.activationRadius)
        .sort((a, b) => distance(a, player) - distance(b, player)).slice(0, cfg.activeCivilizations);
      if (player.alive && player.civ.tech >= 1) chosen.push(player);
      const active = new Set(chosen.map(b => b.id));
      const live = new Set(bodies.filter(b => b.alive).map(b => b.id));
      for (const owner of chosen) if (!groups.has(owner.id)) groups.set(owner.id, {
        owner, mothers: [], guns: [], planes: [], enabled: true, stableSince: now,
        motionAt: now, lastVx: owner.vx, lastVy: owner.vy
      });
      for (const [id, group] of groups) {
        const owner = group.owner;
        if (!live.has(id) || owner.civ.tech < 1) {
          for (const unit of [...group.planes, ...group.mothers, ...group.guns]) unit.alive = false;
          groups.delete(id); continue;
        }
        group.enabled = active.has(id);
        const spec = grade(owner);
        group.mothers = group.mothers.filter(m => m.alive);
        group.guns = group.guns.filter(g => g.alive);
        owner.artifacts = owner.artifacts.filter(u => u.alive);
        group.planes = group.planes.filter(p => p.alive);
        for (const plane of group.planes) {
          const ratio = plane.hp / plane.maxHp;
          plane.maxHp = spec.hp; plane.hp = Math.min(spec.hp, ratio * spec.hp);
          plane.radius = owner.civ.tech >= 6 ? 3 : 2.5;
          plane.shots = Math.min(plane.shots, spec.ammo);
          if (!plane.mother.alive) { plane.alive = false; plane.cargo = 0; }
          if (plane.mode !== "dock") plane.expires = Math.min(plane.expires, plane.departed + spec.endurance);
        }
        for (const mother of group.mothers) {
          const assigned = group.planes.filter(p => p.mother === mother);
          assigned.forEach((p, i) => { p.retiring = i >= spec.perMother; if (p.retiring && p.mode !== "dock") p.mode = "return"; });
        }
        // 已靠港的远处舰队保留状态，停止生产、决策和移动。
        group.sleeping = !group.enabled && group.planes.every(p => p.mode === "dock");
      }
      units = [...groups.values()].filter(g => !g.sleeping).flatMap(g => [...g.mothers, ...g.guns, ...g.planes]).filter(u => u.alive);
    }
    function recall(owner, now) {
      owner.recallUntil = now + cfg.recallSeconds;
      const group = groups.get(owner.id);
      if (group) for (const plane of group.planes) if (plane.alive && plane.mode !== "dock") {
        plane.mode = "return"; plane.target = null;
      }
    }
    function safeMission(plane, target, spec) {
      const hostile = enemy(plane.owner, target);
      if (hostile && distance(plane, target) <= spec.attackRange) return true;
      const outward = intercept(plane, target, spec.speed);
      if (!Number.isFinite(outward)) return false;
      const future = { x: target.x + target.vx * outward, y: target.y + target.vy * outward };
      const base = plane.mother;
      const home = { x: base.x + base.vx * outward, y: base.y + base.vy * outward, vx: base.vx, vy: base.vy };
      const returning = intercept(future, home, spec.speed);
      const working = hostile ? Math.min(5, spec.ammo * spec.interval) : spec.cargo / spec.mining;
      return outward + returning + spec.speed / cfg.acceleration * 2 + working + Math.max(8, spec.endurance * .2) < spec.endurance;
    }
    function chooseTarget(plane, group, now, combatOnly = false) {
      const owner = group.owner, spec = grade(owner);
      const reservations = new Map();
      for (const p of group.planes) if (p !== plane && p.alive && p.target) reservations.set(p.target.id, (reservations.get(p.target.id) || 0) + 1);
      let result = null, score = Infinity;
      for (const target of nearby(owner, spec.range)) {
        if (!target.alive || distance(target, owner) > spec.range || own(owner, target)) continue;
        const hostile = enemy(owner, target), resource = mineable(owner, target);
        if (combatOnly && !hostile || !hostile && !resource || !safeMission(plane, target, spec)) continue;
        const rank = hostile ? context.threatRank(plane, plane.mother, owner, target, now) : 10;
        const value = rank * 100000 + (reservations.get(target.id) || 0) * 500 + distance(plane, target) - (plane.target === target ? 250 : 0);
        if (value < score) { score = value; result = target; }
      }
      plane.nextSearch = now + cfg.searchInterval + (plane.id % 5) * .03;
      plane.target = result;
    }
    function buildStructures(group, now) {
      const owner = group.owner, c = owner.civ;
      if (!group.enabled || now < c.coreHitUntil || c.population < SolarConfig.civilization.extinctionPopulation) return;
      const elapsed = cfg.decisionInterval * CIV.buildSpeed(owner), project = c.projects;
      let kind = null;
      if (c.tech >= 1 && c.shield <= 0) kind = "shield";
      else if (c.tech >= 2 && group.guns.filter(g => g.alive).length < cfg.gunLimit) kind = "gun";
      else if (c.tech >= 3 && group.mothers.filter(m => m.alive).length < grade(owner).mothers) kind = "carrier";
      else if (c.tech >= 5 && !c.cities[0].built) kind = "city0";
      else if (c.tech >= 6 && !c.cities[1].built) kind = "city1";
      if (!kind) return;
      if (kind.startsWith("city")) {
        const index = Number(kind[4]), city = c.cities[index], cost = cfg.construction.cityMass[index];
        const progress = Math.min(1 - project[kind], elapsed / cfg.construction.city,
          Math.max(0, owner.mass - SolarConfig.civilization.minimumMass) / cost);
        owner.mass -= progress * cost; city.mass += progress * cost; project[kind] += progress;
        if (project[kind] >= 1 - 1e-9) { city.built = true; project[kind] = 0; }
        CIV.syncCities(owner); context.resize(owner); return;
      }
      project[kind] += elapsed / cfg.construction[kind];
      if (project[kind] < 1) return;
      project[kind] = 0;
      if (kind === "shield") { c.shield = CIV.stats(owner).shield; return; }
      const list = kind === "gun" ? group.guns : group.mothers;
      let slot = 0; while (list.some(u => u.alive && u.slot === slot)) slot++;
      const unit = makeFacility(owner, slot, now, kind); list.push(unit); units.push(unit);
    }
    function decisions(now) {
      rebuildIndex(now);
      for (const group of groups.values()) {
        if (group.sleeping) continue;
        if (!group.owner.alive || group.owner.civ.tech === 0) {
          for (const unit of [...group.mothers, ...group.guns, ...group.planes]) unit.alive = false;
          continue;
        }
        const owner = group.owner, spec = grade(owner), rate = launchRate(owner, spec);
        buildStructures(group, now);
        const elapsed = now - group.motionAt;
        if (elapsed > 0 && Math.hypot(owner.vx - group.lastVx, owner.vy - group.lastVy) / elapsed > cfg.stableAcceleration) group.stableSince = now;
        group.motionAt = now; group.lastVx = owner.vx; group.lastVy = owner.vy;
        const stable = now - group.stableSince >= cfg.stableSeconds && Math.hypot(owner.vx, owner.vy) < spec.speed * .7;
        const patrolLimit = stable && group.enabled && now >= owner.recallUntil ? Math.floor(group.planes.filter(p => p.alive).length * cfg.patrolRatio) : 0;
        const patrols = group.planes.filter(p => p.alive && p.patrol && p.mode !== "dock");
        for (const plane of patrols.slice(patrolLimit)) { plane.mode = "return"; plane.target = null; }
        let patrolCount = patrols.length;
        for (const mother of group.mothers) {
          if (!mother.alive || !group.enabled || now < owner.civ.coreHitUntil) continue;
          if (group.planes.filter(p => p.alive && p.mother === mother).length >= spec.perMother) continue;
          mother.buildProgress += cfg.decisionInterval * CIV.buildSpeed(owner) / spec.production;
          if (mother.buildProgress < 1) continue;

          const plane = { id: context.id(), entity: "drone", ownerId: owner.id, owner, mother,
            x: mother.x, y: mother.y, vx: 0, vy: 0, radius: owner.civ.tech >= 6 ? 3 : 2.5,
            hp: spec.hp, maxHp: spec.hp, alive: true, mode: "dock", readyAt: now + spec.supply,
            shots: spec.ammo, cargo: 0, departed: now, expires: now, nextAttack: now,
            nextSearch: now + (mother.slot * .13), target: null, retiring: false, patrol: false };
          group.planes.push(plane); units.push(plane); owner.artifacts.push(plane); mother.buildProgress = 0;
        }
        for (const plane of group.planes) {
          if (!plane.alive) continue;
          if (!plane.mother.alive) { plane.alive = false; plane.cargo = 0; continue; }
          const mother = plane.mother;
          if (plane.mode === "dock") {
            if (plane.retiring) { plane.alive = false; continue; }
            if (now < plane.readyAt) continue;
            plane.hp = spec.hp; plane.shots = spec.ammo;
            if (!group.enabled || now < owner.recallUntil || rate <= 0 || now < mother.nextLaunch || now < plane.nextSearch) continue;
            plane.patrol = patrolCount < patrolLimit;
            if (plane.patrol) {
              patrolCount++; plane.mode = "patrol"; plane.target = null;
            } else {
              chooseTarget(plane, group, now);
              if (!plane.target) continue;
              plane.mode = enemy(owner, plane.target) ? "attack" : "mine";
            }
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
          if (plane.patrol && plane.target && !enemy(owner, plane.target)) plane.target = null;
          if (now >= plane.nextSearch) chooseTarget(plane, group, now, plane.patrol);
          if (!plane.target) { plane.mode = plane.patrol ? "patrol" : "return"; continue; }
          const target = plane.target, d = distance(plane, target);
          if (enemy(owner, target)) {
            plane.mode = "attack";
            if (d <= spec.attackRange && now >= plane.nextAttack && plane.shots > 0) {
              context.fire(plane, target, spec.damage); plane.shots--;
              plane.nextAttack = Math.max(now - cfg.decisionInterval, plane.nextAttack) + spec.interval;
            }
          } else if (mineable(owner, target)) {
            plane.mode = "mine";
            const standOff = target.natural ? SolarConfig.types[target.type].hazardRange + 8 : SolarSpacing.radius(target) + plane.radius + 5;
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
        if (!group.owner.alive || group.owner.civ.tech === 0) {
          for (const unit of [...group.mothers, ...group.guns, ...group.planes]) unit.alive = false;
          continue;
        }
        const owner = group.owner, spec = grade(owner);
        for (const facility of [...group.mothers, ...group.guns]) {
          if (!facility.alive) continue;
          const orbit = CIV.rings(owner)[facility.entity];
          const angle = facilityAngle(owner, facility.slot, now, facility.entity);
          const target = { x: Math.cos(angle) * orbit, y: Math.sin(angle) * orbit,
            vx: -Math.sin(angle) * orbit * cfg.carrierOrbitSpeed, vy: Math.cos(angle) * orbit * cfg.carrierOrbitSpeed };
          SolarFleet.steer(facility.orbitMotion, target, spec.speed * .25, cfg.acceleration * .5, cfg.steering, 0, dt);
          facility.orbitMotion.x += facility.orbitMotion.vx * dt; facility.orbitMotion.y += facility.orbitMotion.vy * dt;
          facility.x = owner.x + facility.orbitMotion.x; facility.y = owner.y + facility.orbitMotion.y;
          facility.vx = owner.vx + facility.orbitMotion.vx; facility.vy = owner.vy + facility.orbitMotion.vy;
        }
        for (const plane of group.planes) {
          if (!plane.alive) continue;
          if (!plane.mother.alive) { plane.alive = false; plane.cargo = 0; continue; }
          if (plane.mode === "dock") {
            plane.x = plane.mother.x; plane.y = plane.mother.y; plane.vx = plane.mother.vx; plane.vy = plane.mother.vy; continue;
          }
          if (now >= plane.expires) { context.destroy(plane, null, "endurance"); continue; }
          let target = plane.mode === "return" ? plane.mother : plane.target;
          if (plane.mode === "patrol") {
            const angle = now * cfg.patrolOrbitSpeed + plane.id * 2.4, orbit = spec.range * cfg.patrolRangeRatio;
            target = { alive: true, x: owner.x + Math.cos(angle) * orbit, y: owner.y + Math.sin(angle) * orbit,
              vx: owner.vx - Math.sin(angle) * orbit * cfg.patrolOrbitSpeed,
              vy: owner.vy + Math.cos(angle) * orbit * cfg.patrolOrbitSpeed };
          }
          if (!target?.alive) { plane.mode = "return"; plane.target = null; continue; }
          const stop = plane.mode === "patrol" ? 0 : plane.mode === "return" ? target.radius + plane.radius + 3 : plane.mode === "mine" ?
            target.natural ? SolarConfig.types[target.type].hazardRange + 8 : SolarSpacing.radius(target) + plane.radius + 5 :
            Math.max(SolarSpacing.radius(target) + plane.radius + 8, spec.attackRange * .65);
          SolarFleet.steer(plane, target, spec.speed, cfg.acceleration, cfg.steering, stop, dt);
          plane.x += plane.vx * dt; plane.y += plane.vy * dt;
          if (plane.mode === "return" && distance(plane, plane.mother) <= plane.mother.radius + plane.radius + 5 &&
              Math.hypot(plane.vx - plane.mother.vx, plane.vy - plane.mother.vy) < spec.speed * .35) {
            if (plane.cargo > 0) context.gain(owner, plane.cargo);
            plane.cargo = 0; plane.mode = "dock"; plane.target = null; plane.patrol = false; plane.readyAt = now + spec.supply;
          }
        }
      }
    }
    function snapshot(owner, now) {
      const group = groups.get(owner.id);
      if (!group || owner.civ.population === 0) return { facilities: [], planes: [] };
      return {
        facilities: [...group.mothers, ...group.guns].filter(u => u.alive).map(u => ({ entity: u.entity, slot: u.slot,
          hp: u.hp, maxHp: u.maxHp, buildProgress: u.buildProgress, orbitMotion: { ...u.orbitMotion },
          launchRemaining: Math.max(0, u.nextLaunch - now), attackRemaining: Math.max(0, u.nextAttack - now) })),
        planes: group.planes.filter(p => p.alive && p.mother.alive).map(p => ({ motherSlot: p.mother.slot,
          x: p.x - owner.x, y: p.y - owner.y, vx: p.vx, vy: p.vy, hp: p.hp, shots: p.shots, cargo: p.cargo,
          docked: p.mode === "dock", readyRemaining: Math.max(0, p.readyAt - now),
          flightAge: Math.max(0, now - p.departed), enduranceRemaining: Math.max(0, p.expires - now),
          attackRemaining: Math.max(0, p.nextAttack - now) }))
      };
    }
    function restore(owner, saved, now) {
      sync(now);
      const group = groups.get(owner.id);
      if (!group) return;
      const spec = grade(owner);
      for (const item of saved.facilities) {
        const unit = makeFacility(owner, item.slot, now, item.entity);
        unit.hp = item.hp; unit.maxHp = item.maxHp; unit.buildProgress = item.buildProgress;
        unit.orbitMotion = { ...item.orbitMotion }; unit.x = owner.x + item.orbitMotion.x; unit.y = owner.y + item.orbitMotion.y;
        unit.nextLaunch = now + item.launchRemaining; unit.nextAttack = now + item.attackRemaining;
        (item.entity === "gun" ? group.guns : group.mothers).push(unit); units.push(unit);
      }
      for (const item of saved.planes) {
        const mother = group.mothers.find(m => m.slot === item.motherSlot);
        const plane = { id: context.id(), entity: "drone", ownerId: owner.id, owner, mother,
          x: owner.x + item.x, y: owner.y + item.y, vx: item.vx, vy: item.vy, radius: owner.civ.tech >= 6 ? 3 : 2.5,
          hp: item.hp, maxHp: spec.hp, alive: true, mode: item.docked ? "dock" : "return",
          readyAt: now + item.readyRemaining, shots: item.shots, cargo: item.cargo,
          departed: now - item.flightAge, expires: now + item.enduranceRemaining, nextAttack: now + item.attackRemaining,
          nextSearch: now, target: null, retiring: false, patrol: false };
        group.planes.push(plane); owner.artifacts.push(plane); units.push(plane);
      }
    }
    function summary(owner, now) {
      const group = groups.get(owner.id);
      // 面板统计实际存活单位，飞船数量包含靠港、返航和执行任务的飞船。
      const mothers = group ? group.mothers.filter(m => m.alive) : [];
      const planes = group ? group.planes.filter(p => p.alive) : [];
      return { mothers: mothers.length, total: planes.length,
        away: planes.filter(p => p.mode !== "dock").length, cargo: planes.reduce((s, p) => s + p.cargo, 0),
        recall: Math.max(0, Math.ceil(owner.recallUntil - now)) };
    }
    return { sync, decisions, move, recall, summary, nearby, snapshot, restore, get units() { return units; } };
  }
};
