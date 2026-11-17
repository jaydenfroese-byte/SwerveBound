// Score bonuses are separate pickups from wallet coins and rocket flight.
// A new pickup is offered on about 22% of traffic waves; larger prizes are
// genuinely rarer instead of being tied to ad availability or the high score.
(() => {
  'use strict';

  const SPAWN_CHANCE = .22;
  const BONUS_TYPES = Object.freeze([
    Object.freeze({ points: 100, short: '+100', rarity: 'COMMON', weight: 70,
      fill: '#29b88d', rim: '#b4ffe4', glow: '#73ffe0' }),
    Object.freeze({ points: 1000, short: '+1K', rarity: 'RARE', weight: 23,
      fill: '#277ec7', rim: '#bce8ff', glow: '#70c8ff' }),
    Object.freeze({ points: 2000, short: '+2K', rarity: 'EPIC', weight: 6,
      fill: '#8c53d7', rim: '#e1bfff', glow: '#ce91ff' }),
    Object.freeze({ points: 5000, short: '+5K', rarity: 'LEGENDARY', weight: 1,
      fill: '#e49d29', rim: '#fff2a0', glow: '#ffd870' })
  ]);

  function pickBonus(random = Math.random) {
    const roll = Math.max(0, Math.min(.999999999, random())) * 100;
    let threshold = 0;
    for (const bonus of BONUS_TYPES) {
      threshold += bonus.weight;
      if (roll < threshold) return bonus;
    }
    return BONUS_TYPES[BONUS_TYPES.length - 1];
  }

  function shouldSpawn(random = Math.random) { return random() < SPAWN_CHANCE; }

  const api = { SPAWN_CHANCE, BONUS_TYPES, pickBonus, shouldSpawn };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (typeof window !== 'undefined') window.LaneRushScorePowerups = api;
})();
