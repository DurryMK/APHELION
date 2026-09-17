"use strict";

globalThis.SolarConfig = {
  types: [
    { name: "Dust", min: 0, radius: 2, color: "#a8b5c9", kind: "asteroid", level: -1, gravityRange: 40 },
    { name: "Core", min: 12, radius: 2.5, color: "#b29b89", kind: "rock", level: 0, gravityRange: 70 },
    { name: "Luna", min: 24, radius: 3, color: "#baaaa0", kind: "rock", level: 1, gravityRange: 90 },
    { name: "Mars", min: 60, radius: 4, color: "#d58b70", kind: "rock", level: 2, gravityRange: 110 },
    { name: "Terra", min: 150, radius: 5, color: "#62dcc9", kind: "ice", level: 3, gravityRange: 140 },
    { name: "Gaia", min: 350, radius: 6, color: "#8f9dff", kind: "rock", level: 4, gravityRange: 170 },
    { name: "Halo", min: 800, radius: 7, color: "#539dff", kind: "ice", level: 5, gravityRange: 210 },
    { name: "Titan", min: 1600, radius: 7.5, color: "#e5b65f", kind: "gas", level: 6, gravityRange: 210 },
    { name: "Sol", mass: 8000, radius: 13, color: "#ffda78", kind: "star", natural: true, gravityRange: 280, hazardRange: 64 },
    { name: "Pulsar", mass: 14000, radius: 9, color: "#a28aff", kind: "neutron", natural: true, gravityRange: 330, hazardRange: 32 },
    { name: "Void", mass: 24000, radius: 9, color: "#c49aff", kind: "black-hole", natural: true, gravityRange: 380, hazardRange: 40 }
  ],
  planetSizeSaturationMass: 3200,
  maxBodyRadius: 8,
  regions: { size: 1600, radius: 560, beltChance: .32, nestChance: .18, systemChance: .16, decorationCount: 64 },
  populationTitles: [
    { population: 1e7, name: "Dawn" }, { population: 2e7, name: "Hearth" },
    { population: 5e7, name: "Tribe" }, { population: 1e8, name: "Kinship" },
    { population: 2e8, name: "Citadel" }, { population: 5e8, name: "Concord" },
    { population: 1e9, name: "Dominion" }, { population: 2e9, name: "Radiance" },
    { population: 5e9, name: "Ascendant" }, { population: 1e10, name: "Celestial" },
    { population: 2e10, name: "Eternal" }, { population: 5e10, name: "Infinity" },
    { population: 1e11, name: "Empyrean" }, { population: 5e11, name: "Cosmos" },
    { population: 1e12, name: "Omniverse" }
  ],
  physicsStep: 1 / 120,
  gravity: {
    constant: 60, softening: 6, fadeStart: .8, cellSize: 200,
    playerRangeScale: .7, bodySpeedLimit: 240,
    maxSubsteps: 8, travelPerStep: 2, velocityChangePerStep: 12
  },
  capture: {
    minSpeedLimit: 60, maxSpeedLimit: 140, speedFactor: 1.2,
    massRatio: 5, assistLimit: 65, orbitAngularSpeed: .12,
    minimumOrbitRadius: 18, orbitRadiusRatio: .75, maxTidalRatio: .7
  },
  initialMotion: { speed: 32, referenceMass: 24, exponent: .35 },
  warning: { padding: 160, lookAheadSeconds: 3, massRatio: 3, limit: 3, refreshSeconds: .8, predictionStep: 1 / 30 },
  civilization: {
    tick: .5, seedPopulation: 10000000, incubationSeconds: 30, rebirthSeconds: 30,
    populationPerMass: 1000000, extinctionPopulation: 1000000, growthRate: .06, declineRate: .15,
    upkeepPerBillion: 1.5, minimumMass: 12, coreBuildPause: 5, harvestPopulationMultiplier: 5,
    technology: [
      { referencePopulation: 0, research: 0, shield: 0, damage: 0, range: 0, interval: Infinity },
      { referencePopulation: 1000000, research: 20, shield: 20, damage: 0, range: 0, interval: Infinity },
      { referencePopulation: 5000000, research: 35, shield: 40, damage: 2, range: 60, interval: .5 },
      { referencePopulation: 20000000, research: 50, shield: 70, damage: 2.5, range: 65, interval: .45 },
      { referencePopulation: 100000000, research: 70, shield: 110, damage: 3, range: 70, interval: .4 },
      { referencePopulation: 500000000, research: 100, shield: 160, damage: 3.5, range: 75, interval: .35 },
      { referencePopulation: 2000000000, research: 140, shield: 220, damage: 4, range: 80, interval: .3 },
      { referencePopulation: 8000000000, research: 180, shield: 260, damage: 4.5, range: 85, interval: .3 }
    ],
    shieldDelay: 5, shieldRegenFraction: .05, cityShieldDelay: 3, cityShieldRegenFraction: .08,
    mothershipResearchReward: 8
  },
  fleet: {
    construction: { shield: 60, gun: 25, carrier: 40, city: 90, devour: 70, maxSpeed: 4,
      cost: { gun: 8, carrier: 20, city: [40, 80], devour: 45 }, cityHp: [200, 350] },
    repair: { delay: 5, fraction: .03, dockedFraction: .15, fullCostRatio: .6 },
    gunLimit: 3, gunHp: 100, carrierHp: 180, threatMemory: 5,
    decisionInterval: .2, searchInterval: .8, recallSeconds: 10, activeCivilizations: 5,
    activationRadius: 1100, searchCell: 180,
    steering: 1.8, acceleration: 48, gunOrbitSpeed: .08, carrierOrbitSpeed: .055, devourOrbitSpeed: .11,
    patrolRatio: 1 / 3, patrolRangeRatio: .35, patrolOrbitSpeed: .1, stableSeconds: 4, stableAcceleration: 4,
    grades: [
      { mothers: 1, perMother: 3, hp: 12, damage: 1, interval: .4, ammo: 20, range: 260, attackRange: 65, speed: 65, supply: 3, production: 12, cost: 1, endurance: 45 },
      { mothers: 3, perMother: 4, hp: 16, damage: 1.2, interval: .4, ammo: 24, range: 360, attackRange: 75, speed: 80, supply: 3, production: 11, cost: 1.5, endurance: 55 },
      { mothers: 3, perMother: 4, hp: 20, damage: 1.5, interval: .35, ammo: 30, range: 440, attackRange: 85, speed: 95, supply: 2, production: 10, cost: 2, endurance: 65 },
      { mothers: 3, perMother: 4, hp: 36, damage: 2.5, interval: .3, ammo: 40, range: 600, attackRange: 95, speed: 115, supply: 1.5, production: 9, cost: 3, endurance: 80 },
      // 7 级精英舰：血量与攻击大幅提升，外观转为黑色光效。
      { mothers: 3, perMother: 4, hp: 90, damage: 5, interval: .28, ammo: 44, range: 640, attackRange: 105, speed: 120, supply: 1.4, production: 9, cost: 3.5, endurance: 90 }
    ],
    gradeFor(tech) { return this.grades[Math.min(this.grades.length - 1, Math.max(0, tech - 3))]; },
    // 吞星船：专职吞噬，无攻击；数量与血量随科技提升，2/5/7 级张开形态不同。
    devour: {
      tech: 2,
      limit: [0, 0, 1, 1, 1, 2, 2, 2],
      hp: [0, 0, 420, 560, 720, 900, 1100, 1350],
      radius: 2.5, speed: 80, towSpeed: 55, towGap: 14, towOrbit: .06, orbitOffset: 16,
      rate: 4, ratePerTech: 1.5, overrunDamage: 8, wrapDuration: 3
    }
  },
  population: {
    initial: 95, target: 130, nearby: 12, batch: 6,
    asteroidChance: .80, naturalChance: .004, naturalLimit: 3,
    largePlanetLimit: 4, advancedCivilizationLimit: 2,
    planetWeights: [45, 28, 16, 7, 3, 1],
    technologyWeights: [40, 30, 18, 8, 3, .8, .18, .02]
  },
  combat: { tick: .1, collisionMinLoss: .02, collisionMaxLoss: .24, breakLoss: .7 },
  hazards: { interval: .5, damageFraction: .025, minimumDamage: 2, contactFraction: .25, contactMinimum: 20 },
  nests: {
    grades: [
      { chance: .76, color: "#ff6575", hull: "#713548", multiplier: 1, roamSpeed: 5, launchSeconds: 4, massReward: 40 },
      { chance: .20, color: "#eef5ff", hull: "#9aabbd", multiplier: 1.65, roamSpeed: 6, launchSeconds: 3, massReward: 120 },
      { chance: .04, color: "#c7a6ff", hull: "#090711", multiplier: 2.6, roamSpeed: 7, launchSeconds: 2, massReward: 320 }
    ],
    activeLimit: 3, safeRadius: 800,
    fightersPerNest: 8, resupplySeconds: 3,
    mothershipHp: 100, fighterHp: 12, fighterSpeed: 42, activityRadius: 420,
    range: 90, damage: 3, interval: 1.4, shots: 10, engagementRange: 420,
    patrolRadius: 110, patrolOrbitSpeed: .12, acceleration: 32, steering: 1.6,
    mothershipRange: 150, mothershipDamage: 4, mothershipInterval: 2
  },
  savePrefix: "aphelion-civilization-save-v5"
};
