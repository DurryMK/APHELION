"use strict";

globalThis.SolarRegions = {
  create(random) {
    const cfg = SolarConfig.regions, cache = new Map();
    function atCell(cx, cy) {
      const key = cx + "," + cy;
      if (cache.has(key)) return cache.get(key);
      const roll = random(cx, cy, 70);
      const kind = roll < cfg.beltChance ? "belt" : roll < cfg.beltChance + cfg.nestChance ? "nest" :
        roll < cfg.beltChance + cfg.nestChance + cfg.systemChance ? "system" : "void";
      const region = { key, cx, cy, kind, x: (cx + .25 + random(cx, cy, 71) * .5) * cfg.size,
        y: (cy + .25 + random(cx, cy, 72) * .5) * cfg.size, radius: cfg.radius, angle: random(cx, cy, 73) * Math.PI,
        points: [] };
      // 区域尘埃仅作装饰，固定在世界坐标，不加入物理模拟。
      for (let i = 0; i < cfg.decorationCount && kind !== "void"; i++) {
        const angle = random(cx, cy, 100 + i * 3) * Math.PI * 2;
        const radius = kind === "belt" ? .68 + random(cx, cy, 101 + i * 3) * .24 : Math.sqrt(random(cx, cy, 101 + i * 3));
        const x = Math.cos(angle) * radius * cfg.radius, y = Math.sin(angle) * radius * cfg.radius * (kind === "belt" ? .42 : 1);
        region.points.push({ x: region.x + x * Math.cos(region.angle) - y * Math.sin(region.angle),
          y: region.y + x * Math.sin(region.angle) + y * Math.cos(region.angle), alpha: .08 + random(cx, cy, 102 + i * 3) * .16 });
      }
      if (cache.size >= 128) cache.delete(cache.keys().next().value);
      cache.set(key, region); return region;
    }
    function around(x, y, radius) {
      const regions = [];
      for (let cx = Math.floor((x - radius) / cfg.size); cx <= Math.floor((x + radius) / cfg.size); cx++)
        for (let cy = Math.floor((y - radius) / cfg.size); cy <= Math.floor((y + radius) / cfg.size); cy++) regions.push(atCell(cx, cy));
      return regions;
    }
    function locate(x, y) {
      const cx = Math.floor(x / cfg.size), cy = Math.floor(y / cfg.size);
      let closest = null, best = Infinity;
      for (let a = cx - 1; a <= cx + 1; a++) for (let b = cy - 1; b <= cy + 1; b++) {
        const region = atCell(a, b), d = Math.hypot(x - region.x, y - region.y);
        if (region.kind !== "void" && d < region.radius && d < best) { closest = region; best = d; }
      }
      return closest;
    }
    function density(x, y, region) {
      if (!region) return .025;
      const dx = x - region.x, dy = y - region.y;
      if (region.kind === "belt") {
        const u = dx * Math.cos(region.angle) + dy * Math.sin(region.angle);
        const v = -dx * Math.sin(region.angle) + dy * Math.cos(region.angle);
        const radial = Math.hypot(u, v / .42) / region.radius;
        return .025 + .85 * Math.exp(-(((radial - .8) / .13) ** 2));
      }
      return region.kind === "nest" ? .10 : .16;
    }
    return { around, locate, density };
  }
};
