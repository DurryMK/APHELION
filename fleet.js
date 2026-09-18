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
    const grade = owner => cfg.gradeFor(owner.civ.tech);
    const devour = cfg.devour;
    const atTech = table => owner => table[Math.min(table.length - 1, Math.max(0, owner.civ.tech))];
    const devourLimit = atTech(devour.limit), devourHp = atTech(devour.hp);
    const devourRate = owner => (devour.rate + devour.ratePerTech * owner.civ.tech) * (owner.civ.tech >= 8 ? devour.rateFactor8 : 1);
    const harbor = cfg.harbor, harborHp = atTech(harbor.hp);
    // 炮与港口共轨（同角速度，港口错开 60°）；母舰用另一角速度。
    const orbitSpeed = entity => entity === "carrier" ? cfg.carrierOrbitSpeed : cfg.gunOrbitSpeed;
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
    // 无抵抗能力的天体：无护盾/城市/舰队的行星；7 级起可吞恒星，虚空永不可吞。
    function devourable(owner, target) {
      if (!target.alive || target.entity || own(owner, target) || target.devouredBy) return false;
      if (target.natural) return SolarConfig.types[target.type].kind === "black-hole" ? owner.civ.tech >= 10 : owner.civ.tech >= 7;
      return !CIV.hasProducts(target);
    }
    function enemy(owner, target) {
      // 陨石仅作为采集资源，飞船不对其开火。
      if (!target.entity && target.type === 0) return false;
      return target.alive && !own(owner, target) &&
        (target.entity ? target.mode !== "dock" : !target.natural && target.type > 0 && CIV.hasProducts(target));
    }
    // 范围内存在敌对单位时，吞星船不出动。
    function hostileNearby(owner, radius) {
      for (const target of nearby(owner, radius)) if (enemy(owner, target)) return true;
      return false;
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
      // 以主星实际速度与舰载机速度比较：达到舰速即无法伴随作战。
      const ratio = Math.hypot(owner.vx, owner.vy) / spec.speed;
      if (ratio <= .25) return 1;
      if (ratio >= 1) return 0;
      return Math.max(0, 1 - (ratio - .25) / .75);
    }
    function facilityAngle(owner, slot, now, entity) {
      const count = entity === "gun" ? cfg.gunLimit : entity === "harbor" ? harbor.limit : grade(owner).mothers;
      // 母舰位于相邻轨道炮之间；港口与炮共轨，错开半个炮间距避免重叠。
      const offset = entity === "carrier" || entity === "harbor" ? Math.PI / cfg.gunLimit : 0;
      return now * orbitSpeed(entity) + owner.phase + offset + slot * Math.PI * 2 / count;
    }
    function makeFacility(owner, slot, now, entity) {
      const orbit = CIV.rings(owner)[entity];
      const angle = facilityAngle(owner, slot, now, entity);
      const x = Math.cos(angle) * orbit, y = Math.sin(angle) * orbit;
      const hp = entity === "harbor" ? harborHp(owner) : (entity === "gun" ? cfg.gunHp : cfg.carrierHp) * (1 + owner.civ.tech * .15);
      const radius = entity === "harbor" ? harbor.radius : entity === "gun" ? 3.5 : 6;
      const unit = { id: context.id(), entity, ownerId: owner.id, owner, slot,
        x: owner.x + x, y: owner.y + y, vx: owner.vx, vy: owner.vy, radius, alive: true,
        hp, maxHp: hp, aim: angle, lastHit: -Infinity, buildProgress: 0, nextLaunch: now, nextAttack: now,
        orbitMotion: { x, y, vx: -y * orbitSpeed(entity), vy: x * orbitSpeed(entity) } };
      owner.artifacts.push(unit); return unit;
    }
    function makeDevourer(owner, now, slot) {
      const hp = devourHp(owner);
      const unit = { id: context.id(), entity: "devourer", ownerId: owner.id, owner, slot,
        x: owner.x, y: owner.y, vx: owner.vx, vy: owner.vy, radius: devour.radius, mode: null,
        hp, maxHp: hp, lastHit: -Infinity, alive: true,
        state: "return", target: null, towing: null, orbitAngle: owner.phase, towRadius: 0, towAngle: 0, nextSearch: now, bestDistance: Infinity, progressAt: now };
      owner.artifacts.push(unit); return unit;
    }
    function releaseDevourer(unit) {
      if (unit.target && unit.target.devourerClaim === unit.id) unit.target.devourerClaim = null;
      if (unit.towing && unit.towing.devouredBy === unit.ownerId) unit.towing.devouredBy = null;
      unit.towing = null;
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
        owner, mothers: [], guns: [], harbors: [], planes: [], devourers: [], enabled: true, stableSince: now,
        motionAt: now, lastVx: owner.vx, lastVy: owner.vy
      });
      for (const [id, group] of groups) {
        const owner = group.owner;
        if (!live.has(id) || owner.civ.tech < 1) {
          for (const unit of [...group.planes, ...group.mothers, ...group.guns, ...group.harbors, ...group.devourers]) {
            if (unit.entity === "devourer") releaseDevourer(unit);
            unit.alive = false;
          }
          groups.delete(id); continue;
        }
        group.enabled = active.has(id);
        const spec = grade(owner);
        group.mothers = group.mothers.filter(m => m.alive);
        group.guns = group.guns.filter(g => g.alive);
        group.harbors = group.harbors.filter(h => h.alive);
        // 港口被摧毁后，停泊其中的吞星船同步消亡。
        if (!group.harbors.some(h => h.alive)) for (const unit of group.devourers) { releaseDevourer(unit); unit.alive = false; }
        for (const unit of group.devourers) if (!unit.alive) releaseDevourer(unit);
        group.devourers = group.devourers.filter(u => u.alive);
        owner.artifacts = owner.artifacts.filter(u => u.alive);
        group.planes = group.planes.filter(p => p.alive);
        const hpH = harborHp(owner);
        for (const unit of group.harbors) {
          if (unit.maxHp !== hpH) { unit.hp = Math.min(hpH, unit.hp + Math.max(0, hpH - unit.maxHp)); unit.maxHp = hpH; }
        }
        for (const plane of group.planes) {
          plane.maxHp = spec.hp; plane.hp = Math.min(spec.hp, plane.hp);
          plane.radius = owner.civ.tech >= 6 ? 3 : 2.5;
          plane.shots = Math.min(plane.shots, spec.ammo);
          if (!plane.mother.alive) plane.alive = false;
          if (plane.mode !== "dock") plane.expires = Math.min(plane.expires, plane.departed + spec.endurance);
        }
        for (const mother of group.mothers) {
          const assigned = group.planes.filter(p => p.mother === mother);
          assigned.forEach((p, i) => { p.retiring = i >= cfg.perMotherFor(owner.civ.tech); if (p.retiring && p.mode !== "dock") p.mode = "return"; });
        }
        // 已靠港的远处舰队保留状态，停止生产、决策和移动。
        group.sleeping = !group.enabled && group.planes.every(p => p.mode === "dock") && group.devourers.every(u => u.state === "orbit");
      }
      units = [...groups.values()].filter(g => !g.sleeping).flatMap(g => [...g.mothers, ...g.guns, ...g.harbors, ...g.devourers, ...g.planes]).filter(u => u.alive);
    }
    function recall(owner, now) {
      owner.recallUntil = now + cfg.recallSeconds;
      const group = groups.get(owner.id);
      if (group) for (const plane of group.planes) if (plane.alive && plane.mode !== "dock") {
        plane.mode = "return"; plane.target = null;
      }
    }
    function safeMission(plane, target, spec) {
      if (distance(plane, target) <= spec.attackRange) return true;
      const outward = intercept(plane, target, spec.speed);
      if (!Number.isFinite(outward)) return false;
      const future = { x: target.x + target.vx * outward, y: target.y + target.vy * outward };
      const base = plane.mother;
      const home = { x: base.x + base.vx * outward, y: base.y + base.vy * outward, vx: base.vx, vy: base.vy };
      const returning = intercept(future, home, spec.speed);
      const working = Math.min(5, spec.ammo * spec.interval);
      return outward + returning + spec.speed / cfg.acceleration * 2 + working + Math.max(8, spec.endurance * .2) < spec.endurance;
    }
    // 飞船只作战：不再采集或运载。
    function chooseTarget(plane, group, now) {
      const owner = group.owner, spec = grade(owner);
      const reservations = new Map();
      for (const p of group.planes) if (p !== plane && p.alive && p.target) reservations.set(p.target.id, (reservations.get(p.target.id) || 0) + 1);
      let result = null, score = Infinity;
      for (const target of nearby(owner, spec.range)) {
        if (!target.alive || distance(target, owner) > spec.range || own(owner, target)) continue;
        if (!enemy(owner, target) || !safeMission(plane, target, spec)) continue;
        const rank = context.threatRank(plane, plane.mother, owner, target, now);
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
      else if (c.tech >= harbor.tech && group.harbors.filter(h => h.alive).length < harbor.limit) kind = "harbor";
      else if (c.tech >= cfg.construction.cityTech[0] && !c.cities[0].built) kind = "city0";
      else if (c.tech >= cfg.construction.cityTech[1] && !c.cities[1].built) kind = "city1";
      else if (c.tech >= cfg.construction.cityTech[2] && !c.cities[2].built) kind = "city2";
      if (!kind) return;
      if (kind.startsWith("city")) {
        const index = Number(kind[4]), city = c.cities[index], cost = cfg.construction.cost.city[index];
        const progress = CIV.fund(owner, Math.min(1 - project[kind], elapsed / cfg.construction.city), cost);
        city.hp = Math.min(city.maxHp, city.hp + progress * city.maxHp); project[kind] += progress;
        if (project[kind] >= 1 - 1e-9) { city.built = true; project[kind] = 0; }
        CIV.syncCities(owner); context.resize(owner); return;
      }
      const progress = Math.min(1 - project[kind], elapsed / cfg.construction[kind]);
      project[kind] += kind === "shield" ? progress : CIV.fund(owner, progress, cfg.construction.cost[kind]);
      if (project[kind] < 1 - 1e-9) return;
      project[kind] = 0;
      if (kind === "shield") { c.shield = CIV.stats(owner).shield; return; }
      const list = kind === "gun" ? group.guns : kind === "harbor" ? group.harbors : group.mothers;
      let slot = 0; while (list.some(u => u.alive && u.slot === slot)) slot++;
      const unit = makeFacility(owner, slot, now, kind); list.push(unit); units.push(unit);
    }
    function decisions(now) {
      rebuildIndex(now);
      for (const group of groups.values()) {
        if (group.sleeping) continue;
        if (!group.owner.alive || group.owner.civ.tech === 0) {
          for (const unit of [...group.mothers, ...group.guns, ...group.harbors, ...group.planes, ...group.devourers]) {
            if (unit.entity === "devourer") releaseDevourer(unit);
            unit.alive = false;
          }
          continue;
        }
        const owner = group.owner, spec = grade(owner), rate = launchRate(owner, spec);
        if (group.enabled) for (const facility of [...group.mothers, ...group.guns, ...group.harbors]) {
          if (facility.alive) CIV.repair(owner, facility, cfg.decisionInterval, now, cfg.construction.cost[facility.entity]);
        }
        buildStructures(group, now);
        const elapsed = now - group.motionAt;
        if (elapsed > 0 && Math.hypot(owner.vx - group.lastVx, owner.vy - group.lastVy) / elapsed > cfg.stableAcceleration) group.stableSince = now;
        group.motionAt = now; group.lastVx = owner.vx; group.lastVy = owner.vy;
        const stable = now - group.stableSince >= cfg.stableSeconds && Math.hypot(owner.vx, owner.vy) < spec.speed;
        const patrolLimit = stable && group.enabled && now >= owner.recallUntil ? Math.floor(group.planes.filter(p => p.alive).length * cfg.patrolRatio) : 0;
        const patrols = group.planes.filter(p => p.alive && p.patrol && p.mode !== "dock");
        for (const plane of patrols.slice(patrolLimit)) { plane.mode = "return"; plane.target = null; }
        let patrolCount = patrols.length;
        for (const mother of group.mothers) {
          if (!mother.alive || !group.enabled || now < owner.civ.coreHitUntil) continue;
          if (group.planes.filter(p => p.alive && p.mother === mother).length >= cfg.perMotherFor(owner.civ.tech)) continue;
          mother.buildProgress += CIV.fund(owner, Math.min(1 - mother.buildProgress,
            cfg.decisionInterval * CIV.buildSpeed(owner) / spec.production), spec.cost);
          if (mother.buildProgress < 1 - 1e-9) continue;

          const plane = { id: context.id(), entity: "drone", ownerId: owner.id, owner, mother,
            x: mother.x, y: mother.y, vx: 0, vy: 0, radius: owner.civ.tech >= 6 ? 3 : 2.5,
            hp: spec.hp, maxHp: spec.hp, lastHit: -Infinity, alive: true, mode: "dock", readyAt: now + spec.supply,
            shots: spec.ammo, departed: now, expires: now, nextAttack: now,
            nextSearch: now + (mother.slot * .13), target: null, retiring: false, patrol: false };
          group.planes.push(plane); units.push(plane); owner.artifacts.push(plane); mother.buildProgress = 0;
        }
        // 港口生产吞星船，机制同母舰生产舰载机；受科技上限与港口容量约束。
        for (const harborUnit of group.harbors) {
          if (!harborUnit.alive || !group.enabled || now < owner.civ.coreHitUntil) continue;
          if (group.devourers.filter(u => u.alive).length >= Math.min(devourLimit(owner), harbor.capacity)) continue;
          harborUnit.buildProgress += CIV.fund(owner, Math.min(1 - harborUnit.buildProgress,
            cfg.decisionInterval * CIV.buildSpeed(owner) / cfg.construction.devour), cfg.construction.cost.devour);
          if (harborUnit.buildProgress < 1 - 1e-9) continue;
          let slot = 0; while (group.devourers.some(u => u.alive && u.slot === slot)) slot++;
          const unit = makeDevourer(owner, now, slot);
          const dest = berthDesired(owner, harborUnit, unit);
          unit.x = dest.x; unit.y = dest.y; unit.vx = dest.vx; unit.vy = dest.vy;
          unit.state = "orbit"; unit.mode = "dock";
          group.devourers.push(unit); units.push(unit); harborUnit.buildProgress = 0;
        }
        for (const plane of group.planes) {
          if (!plane.alive) continue;
          if (!plane.mother.alive) { plane.alive = false; continue; }
          const mother = plane.mother;
          if (plane.mode === "dock") {
            if (plane.retiring) { plane.alive = false; continue; }
            if (group.enabled) CIV.repair(owner, plane, cfg.decisionInterval, now, spec.cost, true);
            if (now < plane.readyAt) continue;
            plane.shots = spec.ammo;
            if (plane.hp < spec.hp - .000001) continue;
            if (!group.enabled || now < owner.recallUntil || rate <= 0 || now < mother.nextLaunch || now < plane.nextSearch) continue;
            plane.patrol = patrolCount < patrolLimit;
            if (plane.patrol) {
              patrolCount++; plane.mode = "patrol"; plane.target = null;
            } else {
              chooseTarget(plane, group, now);
              if (!plane.target) continue;
              plane.mode = "attack";
            }
            plane.departed = now; plane.expires = now + spec.endurance;
            mother.nextLaunch = now + 1 / rate;
          } else {
            if (now >= plane.expires) { context.destroy(plane, null, "endurance"); continue; }
            const returnTime = intercept(plane, mother, spec.speed);
            if (!group.enabled || plane.retiring || now < owner.recallUntil || plane.shots <= 0 || plane.hp < spec.hp * .3 ||
              Math.hypot(owner.vx, owner.vy) >= spec.speed || plane.expires - now < returnTime + Math.max(8, spec.endurance * .2) ||
              distance(plane, owner) > spec.range) {
              plane.mode = "return"; plane.target = null;
            }
          }
          if (plane.mode === "return" || plane.mode === "dock") continue;
          if (!plane.target?.alive || distance(plane.target, owner) > spec.range) plane.target = null;
          if (plane.patrol && plane.target && !enemy(owner, plane.target)) plane.target = null;
          if (now >= plane.nextSearch) chooseTarget(plane, group, now);
          if (!plane.target) { plane.mode = plane.patrol ? "patrol" : "return"; continue; }
          const target = plane.target, d = distance(plane, target);
          if (!enemy(owner, target)) { plane.target = null; plane.mode = "return"; continue; }
          plane.mode = "attack";
          if (d <= spec.attackRange && now >= plane.nextAttack && plane.shots > 0) {
            context.fire(plane, target, spec.damage); plane.shots--;
            plane.nextAttack = Math.max(now - cfg.decisionInterval, plane.nextAttack) + spec.interval;
          }
        }
        // 吞星船：血量随科技提升；orbit 扫描、travel/anchor/return 状态切换。
        for (const unit of group.devourers) {
          if (!unit.alive) continue;
          const hp = devourHp(owner);
          if (unit.maxHp !== hp) { unit.hp = Math.min(hp, unit.hp + Math.max(0, hp - unit.maxHp)); unit.maxHp = hp; }
          // 仅在港口停泊时维修，机制同舰载机靠港维修。
          if (group.enabled && unit.mode === "dock") CIV.repair(owner, unit, cfg.decisionInterval, now, cfg.construction.cost.devour, true);
          if (!group.enabled) { if (unit.state !== "orbit") releaseDevourer(unit); unit.state = "orbit"; continue; }
          if (unit.state === "wrapping" || unit.state === "anchor") {
            if (!unit.target?.alive || own(owner, unit.target) || CIV.hasProducts(unit.target) || distance(unit, owner) > spec.range) { releaseDevourer(unit); unit.state = "return"; }
            continue;
          }
          if (unit.state === "travel") {
            // 目标脱离探测范围（或自身超出牵引范围）即放弃返航。
            if (!unit.target || !devourable(owner, unit.target) ||
                distance(owner, unit.target) > spec.range || distance(unit, owner) > spec.range) {
              releaseDevourer(unit); unit.target = null; unit.state = "return";
            }
            continue;
          }
          // 出航速度门槛与舰载机一致，按当前科技等级的舰队航速判断。
          if (unit.state === "return" || launchRate(owner, spec) <= 0 || now < unit.nextSearch) continue;
          unit.nextSearch = now + cfg.searchInterval;
          if (hostileNearby(owner, spec.range)) continue;
          let best = null, bestMass = -Infinity, bestDistance = Infinity;
          for (const candidate of nearby(owner, spec.range)) {
            if (!devourable(owner, candidate) || candidate.devourerClaim) continue;
            const d2 = distance(owner, candidate);
            if (d2 > spec.range) continue;
            // 优先大质量天体，质量相同时取更近的。
            if (candidate.mass > bestMass || candidate.mass === bestMass && d2 < bestDistance) {
              bestMass = candidate.mass; bestDistance = d2; best = candidate;
            }
          }
          if (best) { unit.target = best; best.devourerClaim = unit.id; unit.state = "travel"; unit.mode = null; unit.bestDistance = distance(unit, best); unit.progressAt = now; }
        }
      }
      for (const group of groups.values()) if (!group.sleeping && group.owner.alive) context.resize(group.owner);
      units = units.filter(u => u.alive);
    }
    function move(dt, now) {
      for (const group of groups.values()) {
        if (group.sleeping) continue;
        if (!group.owner.alive || group.owner.civ.tech === 0) {
          for (const unit of [...group.mothers, ...group.guns, ...group.harbors, ...group.planes, ...group.devourers]) {
            if (unit.entity === "devourer") releaseDevourer(unit);
            unit.alive = false;
          }
          continue;
        }
        const owner = group.owner, spec = grade(owner);
        for (const facility of [...group.mothers, ...group.guns, ...group.harbors]) {
          if (!facility.alive) continue;
          const orbit = CIV.rings(owner)[facility.entity];
          const angle = facilityAngle(owner, facility.slot, now, facility.entity);
          const speed = orbitSpeed(facility.entity);
          const target = { x: Math.cos(angle) * orbit, y: Math.sin(angle) * orbit,
            vx: -Math.sin(angle) * orbit * speed, vy: Math.cos(angle) * orbit * speed };
          SolarFleet.steer(facility.orbitMotion, target, spec.speed * .25, cfg.acceleration * .5, cfg.steering, 0, dt);
          facility.orbitMotion.x += facility.orbitMotion.vx * dt; facility.orbitMotion.y += facility.orbitMotion.vy * dt;
          facility.x = owner.x + facility.orbitMotion.x; facility.y = owner.y + facility.orbitMotion.y;
          facility.vx = owner.vx + facility.orbitMotion.vx; facility.vy = owner.vy + facility.orbitMotion.vy;
        }
        for (const plane of group.planes) {
          if (!plane.alive) continue;
          if (!plane.mother.alive) { plane.alive = false; continue; }
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
          const stop = plane.mode === "patrol" ? 0 : plane.mode === "return" ? target.radius + plane.radius + 3 :
            Math.max(SolarSpacing.radius(target) + plane.radius + 8, spec.attackRange * .65);
          SolarFleet.steer(plane, target, spec.speed, cfg.acceleration, cfg.steering, stop, dt);
          plane.x += plane.vx * dt; plane.y += plane.vy * dt;
          if (plane.mode === "return" && distance(plane, plane.mother) <= plane.mother.radius + plane.radius + 5 &&
              Math.hypot(plane.vx - plane.mother.vx, plane.vy - plane.mother.vy) < spec.speed * .35) {
            plane.mode = "dock"; plane.target = null; plane.patrol = false; plane.readyAt = now + spec.supply;
          }
        }
        moveDevourers(group, dt, now);
      }
    }
    // 港口泊位：两艘吞星船并排停在港口内（沿径向一内一外）。
    function berthDesired(owner, harborUnit, unit) {
      const dx = harborUnit.x - owner.x, dy = harborUnit.y - owner.y, len = Math.hypot(dx, dy) || 1;
      const side = (unit.slot % 2 === 0 ? -1 : 1) * harborUnit.radius * .5;
      return { x: harborUnit.x + dx / len * side, y: harborUnit.y + dy / len * side,
        vx: harborUnit.vx, vy: harborUnit.vy };
    }
    function moveDevourers(group, dt, now) {
      const owner = group.owner, spec = grade(owner);
      // 吞星船没有独立轨道，全部停泊/往返于港口；无港口时由 sync 同步消亡。
      const berth = group.harbors.find(h => h.alive) || null;
      if (!berth) return;
      for (const unit of group.devourers) {
        if (!unit.alive) continue;
        if (unit.state === "orbit") {
          const dest = berthDesired(owner, berth, unit);
          unit.x = dest.x; unit.y = dest.y; unit.vx = dest.vx; unit.vy = dest.vy;
          // 停泊在港口内时隐藏于港口保护之下（dock 状态不可被选中/碰撞）。
          unit.mode = "dock";
          continue;
        }
        if (unit.state === "return") {
          const dest = berthDesired(owner, berth, unit);
          SolarFleet.steer(unit, dest, spec.speed, cfg.acceleration, cfg.steering, 0, dt);
          unit.x += unit.vx * dt; unit.y += unit.vy * dt;
          if (Math.hypot(unit.x - dest.x, unit.y - dest.y) < 8) unit.state = "orbit";
          if (distance(unit, owner) > spec.range) context.damage(unit, devour.overrunDamage * dt, null, "overrun");
          continue;
        }
        // 出港执行任务，恢复可被攻击。
        unit.mode = null;
        if (unit.state === "wrapping" || unit.state === "anchor") {
          const t = unit.target;
          if (!t?.alive) { releaseDevourer(unit); unit.state = "return"; continue; }
          unit.orbitAngle += dt * .6;
          const rr = SolarSpacing.radius(t) + unit.radius + 4;
          unit.x = t.x + Math.cos(unit.orbitAngle) * rr;
          unit.y = t.y + Math.sin(unit.orbitAngle) * rr;
          unit.vx = t.vx; unit.vy = t.vy;
          // 包裹计时使用模拟时间，跨越结束时刻时只计算实际吞噬时长。
          const harvestDt = Math.min(dt, Math.max(0, now - unit.harvestAt));
          if (now >= unit.harvestAt) unit.state = "anchor";
          if (harvestDt > 0 && distance(unit, owner) <= spec.range) {
            const taken = context.harvest(t, devourRate(owner) * harvestDt, owner, now);
            if (taken > 0) context.gain(owner, taken);
          }
          towTarget(owner, unit, t, dt);
          if (distance(unit, owner) > spec.range) {
            context.damage(unit, devour.overrunDamage * dt, null, "overrun");
            releaseDevourer(unit); unit.state = "return";
          }
          continue;
        }
        const t = unit.target;
        if (!t?.alive) { releaseDevourer(unit); unit.target = null; unit.state = "return"; continue; }
        const stop = SolarSpacing.radius(t) + unit.radius + 3;
        // 追上目标过程中若长时间没有更接近（目标更快/绕圈），超时放弃并返航，避免永久卡在前往状态。
        const reach = distance(unit, t);
        if (reach < unit.bestDistance - .5) { unit.bestDistance = reach; unit.progressAt = now; }
        else if (now - unit.progressAt > 8) { releaseDevourer(unit); unit.target = null; unit.state = "return"; continue; }
        SolarFleet.steer(unit, t, spec.speed, cfg.acceleration, cfg.steering, stop, dt);
        unit.x += unit.vx * dt; unit.y += unit.vy * dt;
        if (distance(unit, t) <= stop + 3) {
          if (t.devourerClaim === unit.id) t.devourerClaim = null;
          const minGap = CIV.collisionRadius(owner) + SolarSpacing.radius(t) + devour.towGap;
          unit.state = "wrapping"; unit.harvestAt = now + devour.wrapDuration;
          unit.orbitAngle = owner.phase; unit.towing = t; t.devouredBy = owner.id;
          // 记住锚定瞬间的距离，之后只在该距离上绕主星公转，不再被拉近。
          unit.towRadius = Math.max(minGap, distance(owner, t));
          unit.towAngle = Math.atan2(t.y - owner.y, t.x - owner.x);
        }
      }
    }
    // 被裹挟的天体保持在原距离，绕主星缓慢公转；主星移动时随其一起被带走。
    function towTarget(owner, unit, t, dt) {
      unit.towAngle += dt * devour.towOrbit;
      const cos = Math.cos(unit.towAngle), sin = Math.sin(unit.towAngle), r = unit.towRadius;
      SolarFleet.steer(t, { x: owner.x + cos * r, y: owner.y + sin * r,
        vx: owner.vx - sin * r * devour.towOrbit, vy: owner.vy + cos * r * devour.towOrbit },
        devour.towSpeed, cfg.acceleration, cfg.steering, 0, dt);
    }
    function snapshot(owner, now) {
      const group = groups.get(owner.id);
      // 只记录"拥有什么"：设施类型/槽位与血量、舰载机总数、吞星船数；位置与状态在载入时重建。
      if (!group || owner.civ.population === 0) return { facilities: [], planes: 0, devourers: 0 };
      return {
        facilities: [...group.mothers, ...group.guns, ...group.harbors].filter(u => u.alive).map(u => ({ entity: u.entity, slot: u.slot, hp: u.hp })),
        planes: group.planes.filter(p => p.alive).length,
        devourers: group.devourers.filter(u => u.alive).length
      };
    }
    function restore(owner, saved, now) {
      sync(now);
      const group = groups.get(owner.id);
      if (!group) return;
      const spec = grade(owner);
      // 设施按当前科技/相位重新生成到各自轨道，仅沿用存档血量。
      for (const item of saved.facilities) {
        const unit = makeFacility(owner, item.slot, now, item.entity);
        if (Number.isFinite(item.hp)) unit.hp = Math.min(unit.maxHp, Math.max(.01, item.hp));
        (item.entity === "gun" ? group.guns : item.entity === "harbor" ? group.harbors : group.mothers).push(unit); units.push(unit);
      }
      // 舰载机全部重新靠港，按载机量分配到各母舰。
      const perMother = cfg.perMotherFor(owner.civ.tech);
      let remaining = Math.max(0, Math.min(saved.planes | 0, group.mothers.length * perMother));
      for (const mother of group.mothers) {
        const count = Math.min(perMother, remaining);
        for (let i = 0; i < count; i++) {
          const plane = { id: context.id(), entity: "drone", ownerId: owner.id, owner, mother,
            x: mother.x, y: mother.y, vx: mother.vx, vy: mother.vy, radius: owner.civ.tech >= 6 ? 3 : 2.5,
            hp: spec.hp, maxHp: spec.hp, lastHit: -Infinity, alive: true, mode: "dock", readyAt: now + spec.supply,
            shots: spec.ammo, departed: now, expires: now, nextAttack: now,
            nextSearch: now, target: null, retiring: false, patrol: false };
          group.planes.push(plane); owner.artifacts.push(plane); units.push(plane);
        }
        remaining -= count;
      }
      // 吞星船直接停入港口泊位（无港口时由 sync 同步消亡）。
      const harborUnit = group.harbors.find(h => h.alive) || null;
      const count = Math.min(saved.devourers | 0, devourLimit(owner));
      for (let i = 0; i < count; i++) {
        let slot = 0; while (group.devourers.some(u => u.alive && u.slot === slot)) slot++;
        const unit = makeDevourer(owner, now, slot);
        if (harborUnit) {
          const dest = berthDesired(owner, harborUnit, unit);
          unit.x = dest.x; unit.y = dest.y; unit.vx = dest.vx; unit.vy = dest.vy;
          unit.state = "orbit"; unit.mode = "dock";
        }
        group.devourers.push(unit); units.push(unit);
      }
    }
    function summary(owner, now) {
      const group = groups.get(owner.id);
      // 面板统计实际存活单位，飞船数量包含靠港、返航和执行任务的飞船。
      const mothers = group ? group.mothers.filter(m => m.alive) : [];
      const planes = group ? group.planes.filter(p => p.alive) : [];
      return { mothers: mothers.length, total: planes.length,
        away: planes.filter(p => p.mode !== "dock").length,
        recall: Math.max(0, Math.ceil(owner.recallUntil - now)) };
    }
    return { sync, decisions, move, recall, summary, nearby, snapshot, restore, get units() { return units; } };
  }
};
