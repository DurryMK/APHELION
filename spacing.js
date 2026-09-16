"use strict";

globalThis.SolarSpacing = {
  radius(unit) {
    if (unit.entity === "mothership") return Math.max(unit.radius, 18);
    return unit.entity ? unit.radius : SolarCivilization.collisionRadius(unit);
  },
  // 接触伤害由天体碰撞处理；空间约束仅分离实体，不施加引力。
  resolve(all) {
    const units = all.filter(u => u.alive && u.mode !== "dock" && u.state !== "anchor");
    const shift = (unit, x, y) => {
      unit.x += x; unit.y += y;
      if (unit.entity === "carrier" || unit.entity === "gun") {
        unit.orbitMotion.x += x; unit.orbitMotion.y += y;
      }
    };
    for (let pass = 0; pass < 4; pass++) {
      const cells = new Map(), size = 96;
      for (const unit of units) {
        const cx = Math.floor(unit.x / size), cy = Math.floor(unit.y / size);
        for (let x = cx - 1; x <= cx + 1; x++) for (let y = cy - 1; y <= cy + 1; y++) {
          const bucket = cells.get(x + "," + y);
          if (!bucket) continue;
          for (const other of bucket) {
            const celestial = !unit.entity && !other.entity;
            const minimum = this.radius(unit) + this.radius(other) + (celestial ? 0 : 3);
            const dx = unit.x - other.x, dy = unit.y - other.y, distance = Math.hypot(dx, dy);
            if (distance >= minimum) continue;
            const angle = (unit.id + other.id) * 2.4;
            const nx = distance > 0 ? dx / distance : Math.cos(angle), ny = distance > 0 ? dy / distance : Math.sin(angle);
            const weightA = unit.entity ? 1 : unit.mass;
            const weightB = other.entity ? 1 : other.mass;
            const share = weightB / (weightA + weightB), overlap = minimum - distance;
            shift(unit, nx * overlap * share, ny * overlap * share);
            shift(other, -nx * overlap * (1 - share), -ny * overlap * (1 - share));
          }
        }
        const key = Math.floor(unit.x / size) + "," + Math.floor(unit.y / size);
        if (!cells.has(key)) cells.set(key, []);
        cells.get(key).push(unit);
      }
    }
  }
};
