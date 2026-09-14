"use strict";

globalThis.SolarConfig = {
  types: [
    { name: "Dust", min: 0, radius: 2, color: "#a8b5c9", kind: "asteroid", level: -1, population: 0, techCap: 0, gravityRange: 40 },
    { name: "Core", min: 12, radius: 2.5, color: "#b29b89", kind: "rock", level: 0, population: 0, techCap: 0, gravityRange: 70 },
    { name: "Luna", min: 24, radius: 3, color: "#baaaa0", kind: "rock", level: 1, population: 500, techCap: 1, gravityRange: 90 },
    { name: "Mars", min: 60, radius: 3.5, color: "#d58b70", kind: "rock", level: 2, population: 5000, techCap: 2, gravityRange: 110 },
    { name: "Terra", min: 150, radius: 4, color: "#62dcc9", kind: "ice", level: 3, population: 50000, techCap: 3, gravityRange: 140 },
    { name: "Gaia", min: 350, radius: 4.5, color: "#8f9dff", kind: "rock", level: 4, population: 500000, techCap: 4, gravityRange: 170 },
    { name: "Halo", min: 800, radius: 5, color: "#539dff", kind: "ice", level: 5, population: 5000000, techCap: 5, gravityRange: 210 },
    { name: "Titan", min: 1600, radius: 6, color: "#e5b65f", kind: "gas", level: 6, population: 15000000, techCap: 5, gravityRange: 210 },
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
  warning: { padding: 160, lookAheadSeconds: 3, massRatio: 3, limit: 3, refreshSeconds: .3, predictionStep: 1 / 60 },
  civilization: {
    tick: .5,
    seedPopulation: 20,
    incubationSeconds: 30,
    growthDoublingSeconds: 30,
    rebirthSeconds: 30,
    cityPopulationPerMass: 5000,
    cityCapacityBonus: .5,
    technology: [
      { population: 0, research: 0, shield: 0, damage: 0, range: 0, interval: Infinity },
      { population: 100, research: 20, shield: 20, damage: 0, range: 0, interval: Infinity },
      { population: 1000, research: 35, shield: 40, damage: 3, range: 100, interval: 2 },
      { population: 10000, research: 50, shield: 70, damage: 5, range: 145, interval: 1.3 },
      { population: 100000, research: 70, shield: 110, damage: 8, range: 180, interval: 1 },
      { population: 1000000, research: 90, shield: 160, damage: 12, range: 220, interval: .75 }
    ],
    shieldDelay: 5,
    shieldRegenFraction: .05,
    mothershipResearchReward: 8
  },
  combat: { tick: .1, collisionMinLoss: .02, collisionMaxLoss: .24, breakLoss: .5, devourFraction: .5 },
  hazards: { interval: .5, damageFraction: .025, minimumDamage: 2, contactFraction: .25, contactMinimum: 20 },
  jump: { cooldown: 60, clearance: 22 },
  nests: {
    regionSize: 1400, chance: .28, activeLimit: 3, safeRadius: 800,
    fightersPerNest: 8, launchSeconds: 8, resupplySeconds: 3,
    mothershipHp: 100, fighterHp: 12, fighterSpeed: 60, activityRadius: 300,
    range: 90, damage: 3, interval: 1.4, shots: 10, engagementRange: 300,
    mothershipRange: 150, mothershipDamage: 4, mothershipInterval: 2
  },
  saveKey: "aphelion-civilization-save-v1"
};
