// A small, deterministic traffic planner shared by the game and its tests.
// All positions are road-relative: cosmetic bends never affect collision lanes.
(() => {
  'use strict';

  const LANE_COUNT = 4;
  // One lane now takes 85 ms instead of 120 ms. The same time governs the
  // player's animation and the traffic planner's reachable escape routes.
  const CHANGE_SECONDS = .085;
  // Sample at least once per full 85 ms lane transition, including its
  // midpoint, so the planner cannot jump over a moving collision window.
  const STEP_SECONDS = .085;
  const LOOKAHEAD_SECONDS = 5.5;
  const PLAYER_Z = 5.5;
  const PLAYER_HALF_LENGTH = 2.13;
  const PLAYER_HALF_WIDTH = 1.33;
  const START_SPEED = 32;
  const MAX_SPEED = 68;
  const SPEED_GAIN_PER_SECOND = .32;
  // Route repairs are only allowed well ahead of the driver. Cars inside
  // this commitment zone are real obstacles: driving into one must crash,
  // rather than making it pop out of existence at the last second.
  const REPAIR_MIN_WORLD_GAP = 75;
  const REPAIR_MIN_LEAD_SECONDS = 1.8;
  const clamp = (number, low, high) => Math.max(low, Math.min(high, number));

  function speedForTime(seconds) {
    // Speed is a steady, time-based acceleration. Personal bests only affect
    // the traffic puzzle, never how fast the road moves during a run.
    return clamp(START_SPEED + Math.max(0, seconds) * SPEED_GAIN_PER_SECOND,
      START_SPEED, MAX_SPEED);
  }

  const shapeFor = (car) => ({
    halfWidth: car.halfWidth ?? 1.2,
    halfLength: car.halfLength ?? 2.4
  });

  function drawsOverPlayer(object, playerZ = PLAYER_Z) {
    // Canvas renders complete 3D objects from back to front. For tall/long
    // vehicles, compare their nearest actual body edge with the player's
    // depth, not just the truck's center. This prevents nearby box trucks
    // from being painted underneath the player while passing the camera.
    return object.z - (object.type === 'car' ? shapeFor(object).halfLength : 0) < playerZ;
  }

  function predictZ(car, seconds, speed) {
    const carSpeed = car.currentSpeed ?? car.trafficSpeed ?? 15;
    const closing = car.oncoming ? speed + carSpeed : Math.max(8, speed - carSpeed);
    return car.z - closing * seconds;
  }

  function clearAt(lane, seconds, cars, speed) {
    return cars.every((car) => {
      const shape = shapeFor(car);
      const halfWidthLanes = (PLAYER_HALF_WIDTH + shape.halfWidth) / 3 + .035;
      if (Math.abs(lane - car.lane) >= halfWidthLanes) return true;
      // Small spatial margin accounts for motion between simulation frames.
      const halfLength = PLAYER_HALF_LENGTH + shape.halfLength + 1.7;
      return Math.abs(predictZ(car, seconds, speed) - PLAYER_Z) > halfLength;
    });
  }

  function position(state) {
    if (state.from === state.to) return state.to;
    return state.from + (state.to - state.from) * clamp(state.elapsed / (state.duration || CHANGE_SECONDS), 0, 1);
  }

  function advance(state, action, elapsed) {
    const currentPosition = position(state);
    if (state.from !== state.to) {
      const duration = state.duration || CHANGE_SECONDS;
      const nextElapsed = Math.min(duration, state.elapsed + elapsed);
      if (nextElapsed >= duration - 1e-8) {
        return { from: state.to, to: state.to, elapsed: CHANGE_SECONDS,
          duration: CHANGE_SECONDS, queue: state.queue || [] };
      }
      return { ...state, elapsed: nextElapsed };
    }
    const nextLane = clamp(state.to + action, 0, LANE_COUNT - 1);
    if (nextLane === state.to) return state;
    return { from: currentPosition, to: nextLane, elapsed,
      duration: CHANGE_SECONDS, queue: state.queue || [] };
  }

  function routeExists(cars, speed, initial, horizon = LOOKAHEAD_SECONDS) {
    if (!clearAt(position(initial), 0, cars, speed)) return false;
    let states = [initial];
    const steps = Math.ceil(horizon / STEP_SECONDS);
    for (let index = 1; index <= steps; index++) {
      const time = index * STEP_SECONDS;
      const nextStates = new Map();
      for (const state of states) {
        const actions = state.from !== state.to ? [0]
          : state.queue?.length ? [state.queue[0]] : [-1, 0, 1];
        for (const action of actions) {
          let next = advance(state, action, STEP_SECONDS);
          if (state.from === state.to && state.queue?.length) {
            next = { ...next, queue: state.queue.slice(1) };
          }
          const previousPosition = position(state);
          const newPosition = position(next);
          if (!clearAt((previousPosition + newPosition) / 2, time - STEP_SECONDS / 2, cars, speed)) continue;
          if (!clearAt(newPosition, time, cars, speed)) continue;
          const key = `${next.from.toFixed(2)}:${next.to}:${next.elapsed.toFixed(2)}:${(next.queue || []).join(',')}`;
          nextStates.set(key, next);
        }
      }
      if (nextStates.size === 0) return false;
      states = [...nextStates.values()];
    }
    return true;
  }

  function minimumOpenLanes(cars, speed, horizon = LOOKAHEAD_SECONDS) {
    let minimum = LANE_COUNT;
    for (let t = 0; t <= horizon; t += STEP_SECONDS) {
      let available = 0;
      for (let lane = 0; lane < LANE_COUNT; lane++) {
        if (clearAt(lane, t, cars, speed)) available++;
      }
      minimum = Math.min(minimum, available);
    }
    return minimum;
  }

  function repairRoute(cars, speed, initial, minOpen = 1, horizon = LOOKAHEAD_SECONDS) {
    // Traffic can slow down behind trucks after its spawn-time validation.
    // Recheck that moving snapshot against the player's ACTUAL steering state;
    // if it creates a dead end, retire the smallest possible number of cars.
    // A collision already in progress is still a collision, not an escape.
    const healthy = (remaining) => routeExists(remaining, speed, initial, horizon) &&
      minimumOpenLanes(remaining, speed, horizon) >= minOpen;
    if (healthy(cars) || !clearAt(position(initial), 0, cars, speed)) return [];
    const active = [...cars];
    const retired = [];
    while (active.length && !healthy(active)) {
      // Re-plan distant traffic only. Once the bumper is close enough to
      // demand a real dodge, NEVER delete the car, even if the player stays
      // in its lane and the planner no longer finds a reachable escape.
      const eligible = active.filter((car) => {
        const bumperGap = car.z - shapeFor(car).halfLength - PLAYER_Z - PLAYER_HALF_LENGTH;
        const closing = car.oncoming
          ? speed + (car.currentSpeed ?? 15)
          : Math.max(8, speed - (car.currentSpeed ?? 15));
        return bumperGap >= REPAIR_MIN_WORLD_GAP &&
          bumperGap / closing >= REPAIR_MIN_LEAD_SECONDS;
      });
      if (!eligible.length) break;
      eligible.sort((a, b) => b.z - a.z);
      let candidate = eligible.find((car) => healthy(active.filter((other) => other !== car)));
      if (!candidate) {
        // If several distant obstacles form the wall, adjust the soonest
        // approaching one, but never a car in the player's commitment zone.
        candidate = [...eligible].sort((a, b) => {
          const arrival = (car) => Math.max(0, (car.z - PLAYER_Z) /
            (car.oncoming ? speed + (car.currentSpeed ?? 15)
              : Math.max(8, speed - (car.currentSpeed ?? 15))));
          return arrival(a) - arrival(b);
        })[0];
      }
      retired.push(candidate);
      active.splice(active.indexOf(candidate), 1);
    }
    return healthy(active) ? retired : [];
  }

  function difficulty(score, highScore = 2000, progressLimit = 1) {
    // Anchor the entire run to the record at its start, with a 2,000-point
    // benchmark for new players. Medium remains 90% of the benchmark and
    // maximum 110%; the game may gently ramp to catch up after big bonuses.
    const benchmark = Math.max(2000, Number(highScore) || 0);
    const points = Math.max(0, Number(score) || 0);
    const medium = benchmark * .9;
    const maximum = benchmark * 1.1;
    const targetProgress = points <= medium
      ? .5 * clamp(points / medium, 0, 1)
      : .5 + .5 * clamp((points - medium) / (maximum - medium), 0, 1);
    const progress = Math.min(targetProgress, clamp(progressLimit, 0, 1));
    // Lift the early and middle sections of the curve a little. Traffic now
    // tightens continuously instead of suddenly jumping from one-car waves
    // to two and then three at hard thresholds.
    const density = Math.pow(progress, .72);
    return {
      progress, density,
      minOpen: 1,
      maxWaveCars: 3,
      waveInterval: 1.55 - .48 * density
    };
  }

  function shuffledLanes(random) {
    const lanes = [0, 1, 2, 3];
    for (let index = lanes.length - 1; index > 0; index--) {
      const other = Math.floor(random() * (index + 1));
      [lanes[index], lanes[other]] = [lanes[other], lanes[index]];
    }
    return lanes;
  }

  function waveSize(level, random) {
    // All three wave sizes remain possible across the run. Their weighted
    // chances change smoothly every point, preserving unpredictable breathers
    // even on maximum difficulty.
    const density = level.density ?? Math.pow(level.progress, .72);
    const roll = random();
    if (roll < .35 * density * density) return 3;
    if (roll < .10 + .58 * density) return 2;
    return 1;
  }

  function chooseWave(existing, speed, initial, level, makeCar, random = Math.random) {
    const valid = [];
    const futureSpeed = Math.min(MAX_SPEED, speed + SPEED_GAIN_PER_SECOND * LOOKAHEAD_SECONDS);
    for (let attempt = 0; attempt < 16; attempt++) {
      const lanes = shuffledLanes(random).slice(0, waveSize(level, random));
      const style = Math.floor(random() * 4);
      const base = 153 + random() * 31;
      const candidates = [];
      for (let index = 0; index < lanes.length; index++) {
        // Aligned groups, staggered rows, diagonal formations and scattered
        // traffic all have different silhouettes and escape decisions.
        const noise = (random() - .5) * (style === 0 ? 14 : 22);
        const offset = style === 1 ? (index % 2 ? 20 : -14)
          : style === 2 ? (index - (lanes.length - 1) / 2) * 20
            : style === 3 ? (random() - .5) * 58 : 0;
        const z = clamp(base + offset + noise, 145, 215);
        const car = makeCar(lanes[index], z, [...existing, ...candidates]);
        if (car) candidates.push(car);
      }
      if (!candidates.length) continue;
      const proposed = [...existing, ...candidates];
      const openLanes = minimumOpenLanes(proposed, speed);
      if (openLanes < level.minOpen) continue;
      // One-open-lane moments are rare at first, then steadily become more
      // likely. There is always at least one physically reachable route.
      const density = level.density ?? Math.pow(level.progress, .72);
      if (openLanes === 1 && random() > .72 * density ** 1.5) continue;
      if (!routeExists(proposed, speed, initial)) continue;
      // Revalidate at the slightly higher speed reached during this window.
      if (!routeExists(proposed, futureSpeed, initial)) continue;
      valid.push(candidates);
    }
    // Randomly choose *among* safe layouts; choosing the most obstructive
    // layout every wave made traffic repetitive and much harder than intended.
    return valid.length ? valid[Math.floor(random() * valid.length)] : [];
  }

  const api = { CHANGE_SECONDS, STEP_SECONDS, LOOKAHEAD_SECONDS, routeExists,
    minimumOpenLanes, repairRoute, difficulty, speedForTime, chooseWave, position, advance,
    clearAt, predictZ, drawsOverPlayer };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (typeof window !== 'undefined') window.LaneRushTrafficDirector = api;
})();
