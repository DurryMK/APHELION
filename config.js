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
    construction: { shield: 60, gun: 25, carrier: 40, city: 90, cityMass: [40, 80], maxSpeed: 4 },
    gunLimit: 3, gunHp: 100, carrierHp: 180, threatMemory: 5,
    decisionInterval: .2, searchInterval: .8, recallSeconds: 10, activeCivilizations: 5,
    activationRadius: 1100, searchCell: 180,
    steering: .9, acceleration: 24, carrierOrbitSpeed: .07,
    patrolRatio: 1 / 3, patrolRangeRatio: .35, patrolOrbitSpeed: .1, stableSeconds: 4, stableAcceleration: 4,
    grades: [
      { mothers: 1, perMother: 3, hp: 12, damage: 1, interval: .4, ammo: 20, range: 260, attackRange: 65, cargo: 4, mining: 1, speed: 65, supply: 3, production: 12, endurance: 45 },
      { mothers: 3, perMother: 4, hp: 16, damage: 1.2, interval: .4, ammo: 24, range: 360, attackRange: 75, cargo: 8, mining: 2, speed: 80, supply: 3, production: 11, endurance: 55 },
      { mothers: 3, perMother: 4, hp: 20, damage: 1.5, interval: .35, ammo: 30, range: 440, attackRange: 85, cargo: 12, mining: 3, speed: 95, supply: 2, production: 10, endurance: 65 },
      { mothers: 3, perMother: 4, hp: 36, damage: 2.5, interval: .3, ammo: 40, range: 600, attackRange: 95, cargo: 24, mining: 6, speed: 115, supply: 1.5, production: 9, endurance: 80 }
    ]
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
    patrolRadius: 110, patrolOrbitSpeed: .12, acceleration: 16, steering: .8,
    mothershipRange: 150, mothershipDamage: 4, mothershipInterval: 2
  },
  saveKey: "aphelion-civilization-save-v3"
};
