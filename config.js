"use strict";

globalThis.SolarConfig = {
  types: [
    { name: "Dust", min: 0, radius: 2, color: "#a8b5c9", kind: "asteroid", level: -1, gravityRange: 40 },
    { name: "Core", min: 12, radius: 2.5, color: "#b29b89", kind: "rock", level: 0, gravityRange: 70 },
    { name: "Luna", min: 24, radius: 3, color: "#baaaa0", kind: "rock", level: 1, gravityRange: 90 },
    { name: "Mars", min: 60, radius: 3.5, color: "#d58b70", kind: "rock", level: 2, gravityRange: 110 },
    { name: "Terra", min: 150, radius: 4, color: "#62dcc9", kind: "ice", level: 3, gravityRange: 140 },
    { name: "Gaia", min: 350, radius: 4.5, color: "#8f9dff", kind: "rock", level: 4, gravityRange: 170 },
    { name: "Halo", min: 800, radius: 5, color: "#539dff", kind: "ice", level: 5, gravityRange: 210 },
    { name: "Titan", min: 1600, radius: 6, color: "#e5b65f", kind: "gas", level: 6, gravityRange: 210 },
    { name: "Sol", mass: 8000, radius: 6, color: "#ffda78", kind: "star", natural: true, gravityRange: 280, hazardRange: 24 },
    { name: "Pulsar", mass: 14000, radius: 3, color: "#a28aff", kind: "neutron", natural: true, gravityRange: 330, hazardRange: 32 },
    { name: "Void", mass: 24000, radius: 5, color: "#c49aff", kind: "black-hole", natural: true, gravityRange: 380, hazardRange: 40 }
  ],
  maxPlanetMass: 3200,
  physicsStep: 1 / 120,
  gravity: {
    constant: 60, softening: 6, fadeStart: .8, cellSize: 200,
    playerRangeScale: .7, playerSpeedMultiplier: 3, bodySpeedLimit: 2400,
    maxSubsteps: 8, travelPerStep: 2, velocityChangePerStep: 12
  },
  capture: {
    rangeRatio: .7, minSpeedLimit: 60, maxSpeedLimit: 140, speedFactor: 1.2,
    massRatio: 5, assistLimit: 65, orbitAngularSpeed: .12,
    minimumOrbitRadius: 18, orbitRadiusRatio: .75, maxTidalRatio: .7
  },
  initialMotion: { speed: 32, referenceMass: 24, exponent: .35 },
  warning: { padding: 160, lookAheadSeconds: 3, massRatio: 3, limit: 3, refreshSeconds: .8, predictionStep: 1 / 30 },
  civilization: {
    tick: .5, seedPopulation: 10000000, incubationSeconds: 30, rebirthSeconds: 30,
    populationPerMass: 1000000, growthRate: .06, declineRate: .15,
    upkeepPerBillion: 1.5, minimumMass: 12, downgradeDelay: 15, retentionRatio: .6,
    technology: [
      { population: 0, research: 0, shield: 0, damage: 0, range: 0, interval: Infinity },
      { population: 1000000, research: 20, shield: 20, damage: 0, range: 0, interval: Infinity },
      { population: 5000000, research: 35, shield: 40, damage: 10, range: 65, interval: 3 },
      { population: 20000000, research: 50, shield: 70, damage: 14, range: 75, interval: 3 },
      { population: 100000000, research: 70, shield: 110, damage: 18, range: 85, interval: 2.8 },
      { population: 500000000, research: 100, shield: 200, damage: 25, range: 100, interval: 2.5 },
      { population: 2000000000, research: 140, shield: 350, damage: 35, range: 120, interval: 2.2 },
      { population: 8000000000, research: 180, shield: 350, damage: 35, range: 120, interval: 2.2 }
    ],
    shieldDelay: 5, shieldRegenFraction: .05, cityShieldDelay: 3, cityShieldRegenFraction: .08,
    mothershipResearchReward: 8
  },
  fleet: {
    decisionInterval: .2, searchInterval: .8, recallSeconds: 10, activeCivilizations: 5,
    activationRadius: 1100, searchCell: 180, cannonThreatSeconds: 4,
    steering: .9, acceleration: 24, carrierOrbitSpeed: .07,
    patrolRatio: 1 / 3, patrolRangeRatio: .35, patrolOrbitSpeed: .1, stableSeconds: 4, stableAcceleration: 4,
    grades: [
      { mothers: 1, perMother: 3, hp: 12, damage: 1, interval: .4, ammo: 20, range: 260, attackRange: 65, cargo: 4, mining: 1, speed: 65, supply: 3, production: 20, cost: 1, endurance: 45 },
      { mothers: 3, perMother: 4, hp: 16, damage: 1.2, interval: .4, ammo: 24, range: 360, attackRange: 75, cargo: 8, mining: 2, speed: 80, supply: 3, production: 18, cost: 2, endurance: 55 },
      { mothers: 3, perMother: 4, hp: 20, damage: 1.5, interval: .35, ammo: 30, range: 440, attackRange: 85, cargo: 12, mining: 3, speed: 95, supply: 2, production: 12, cost: 3, endurance: 65 },
      { mothers: 3, perMother: 4, hp: 36, damage: 2.5, interval: .3, ammo: 40, range: 600, attackRange: 95, cargo: 24, mining: 6, speed: 115, supply: 1.5, production: 10, cost: 5, endurance: 80 }
    ]
  },
  population: {
    initial: 95, target: 130, nearby: 12, batch: 6, regionSize: 1000,
    asteroidChance: .80, naturalChance: .004, naturalLimit: 3,
    largePlanetLimit: 4, advancedCivilizationLimit: 2,
    planetWeights: [45, 28, 16, 7, 3, 1],
    technologyWeights: [40, 30, 18, 8, 3, .8, .18, .02]
  },
  combat: { tick: .1, collisionMinLoss: .02, collisionMaxLoss: .24, breakLoss: .7 },
  hazards: { interval: .5, damageFraction: .025, minimumDamage: 2, contactFraction: .25, contactMinimum: 20 },
  nests: {
    regionSize: 1400, chance: .28, activeLimit: 3, safeRadius: 800,
    fightersPerNest: 8, launchSeconds: 8, resupplySeconds: 3,
    mothershipHp: 100, fighterHp: 12, fighterSpeed: 42, activityRadius: 420,
    range: 90, damage: 3, interval: 1.4, shots: 10, engagementRange: 420,
    patrolRadius: 110, patrolOrbitSpeed: .12, acceleration: 16, steering: .8,
    mothershipRange: 150, mothershipDamage: 4, mothershipInterval: 2
  },
  saveKey: "aphelion-civilization-save-v2"
};
