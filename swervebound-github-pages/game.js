(() => {
  'use strict';

  const canvas = document.getElementById('game');
  const ctx = canvas.getContext('2d', { alpha: false });
  const $ = (id) => document.getElementById(id);
  const ui = {
    overlay: $('overlay'), modal: $('modal'), title: $('modal-title'), subtitle: $('modal-subtitle'),
    play: $('play-btn'), results: $('results'), score: $('score'), coins: $('coins'),
    best: $('best'), finalScore: $('final-score'), finalBest: $('final-best'),
    speed: $('speed'), pause: $('pause-btn'), sound: $('sound-btn'),
    soundIcon: $('sound-icon'), toast: $('toast'), help: $('help-pill'),
    returnMenu: $('menu-return-btn'),
    reviveOption: $('revive-option'), reviveButton: $('revive-btn'), adScreen: $('rewarded-ad'),
    adCount: $('ad-count'), adMessage: $('ad-message'), adProgress: $('ad-progress-fill'),
    adCancel: $('ad-cancel'), flight: $('flight-indicator'), flightSeconds: $('flight-seconds')
  };

  const MAX_Z = 150;
  const SCENE_FAR_Z = 1800;
  const SCENE_NEAR_Z = -12;
  const PLAYER_Z = 5.5;
  const LANE_COUNT = 4;
  const TRAFFIC_GAP = 17;
  const FOLLOW_DISTANCE = 36;
  const ROAD_CYCLE = 2040;
  const DEMO_AD_SECONDS = 15;
  // World-space vehicle footprints, shared by drawing and collision checks.
  // Width includes the tires, so two cars can touch while changing lanes.
  const VEHICLE_SHAPES = {
    // Each model has its own 3D body and a matching collision footprint.
    car: { halfWidth: 1.10, halfLength: 2.13, tireOutset: .23,
      bodyTop: .77, roofTop: 1.58, roofW: .72, roofRear: -.43, roofFront: .88, windowRear: -1.10, windowFront: 1.48 },
    sport: { halfWidth: 1.13, halfLength: 2.23, tireOutset: .23,
      bodyTop: .62, roofTop: 1.17, roofW: .72, roofRear: -.42, roofFront: .70, windowRear: -1.17, windowFront: 1.50 },
    suv: { halfWidth: 1.16, halfLength: 2.35, tireOutset: .24,
      bodyTop: .98, roofTop: 1.95, roofW: .94, roofRear: -1.14, roofFront: 1.18, windowRear: -1.63, windowFront: 1.68 },
    van: { halfWidth: 1.17, halfLength: 2.67, tireOutset: .24,
      bodyTop: 1.08, roofTop: 2.25, roofW: 1.05, roofRear: -1.86, roofFront: 1.60, windowRear: -2.17, windowFront: 2.04 },
    pickup: { halfWidth: 1.14, halfLength: 2.54, tireOutset: .24,
      bodyTop: .88, roofTop: 1.70, roofW: .87, roofRear: .26, roofFront: 1.52, windowRear: -.22, windowFront: 2.00 },
    truck: { halfWidth: 1.23, halfLength: 3.35, tireOutset: .24,
      bodyTop: .90, roofTop: 2.78, roofW: 1.08, roofRear: -2.93, roofFront: .70, windowRear: -3.00, windowFront: 2.12 }
  };
  const TRAFFIC_MODELS = ['car', 'car', 'car', 'sport', 'suv', 'suv', 'van', 'pickup', 'truck'];
  const vehicleShape = (kind) => VEHICLE_SHAPES[kind] || VEHICLE_SHAPES.car;
  const director = window.LaneRushTrafficDirector;
  const scorePowerups = window.LaneRushScorePowerups;
  // Each paint color is a different real traffic speed, regardless of direction.
  const TRAFFIC = [
    { color: '#ff746c', speed: 23 }, // red: fastest
    { color: '#f08caf', speed: 20 },
    { color: '#ae85db', speed: 17 },
    { color: '#f3b652', speed: 14 },
    { color: '#55c9b5', speed: 11 },
    { color: '#6c8ef9', speed: 8 }  // blue: slowest
  ];
  const clamp = (x, a, b) => Math.max(a, Math.min(b, x));
  const lerp = (a, b, t) => a + (b - a) * t;
  const rand = (a, b) => a + Math.random() * (b - a);
  const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];

  let w = 0, h = 0, dpr = 1, horizon = 0, roadBottomHalf = 0;
  let state = 'ready';
  let targetLane = 2, displayLane = 2, meters = 0, speed = 32, score = 0, coins = 0;
  let objects = [], particles = [], spawnTimer = 1.1,
    clock = 0, runElapsed = 0, lastTime = 0;
  let waveIndex = 0;
  let bonusScore = 0, coinChain = 0, nearMissStreak = 0, lastNearMissAt = -100;
  let flightTime = 0, coinFlightLift = 0, nextFlightWave = 9, lastLandingWarning = -1;
  let revivesUsed = false, shieldTime = 0, adRemaining = DEMO_AD_SECONDS;
  let explosion = null;
  let lastCrashWasHeadOn = false;
  let crashShake = 0, steeringFlash = 0, toastTimer = 0, soundOn = true, audioContext = null;
  const steering = new window.LaneRushLaneControls.LaneSteering({
    laneCount: LANE_COUNT, seconds: director.CHANGE_SECONDS,
    onMove: () => { steeringFlash = .18; playSound('turn'); }
  });
  let engineOscillator = null, engineHarmonic = null, engineVolume = null, engineFilter = null;
  let highScore = 0;
  try { highScore = Number(localStorage.getItem('laneRushBest')) || 0; } catch (_) { /* Private browsing */ }
  // Keep the difficulty goalposts fixed during each run. New players use
  // 2,000 as the benchmark without pretending they earned that high score.
  let difficultyReference = Math.max(2000, highScore);
  // Smooth out bonus-point jumps; traffic pressure can take several seconds
  // to build, rather than instantly going from relaxed to maximum difficulty.
  let trafficRamp = 0;
  try { soundOn = localStorage.getItem('laneRushSound') !== 'off'; } catch (_) { /* Private browsing */ }
  ui.best.textContent = highScore.toLocaleString();

  // The skyline is a fixed, distant silhouette rather than randomized on each
  // visit. Its base shares the horizon with the hills and fields, so buildings
  // can't appear to float above the landscape on tall or wide displays.
  const sceneryNoise = (n) => {
    const value = Math.sin(n * 127.1 + 71.7) * 43758.5453;
    return value - Math.floor(value);
  };
  const skyline = Array.from({ length: 28 }, (_, i) => ({
    x: i / 28 - .018 + (sceneryNoise(i * 3 + 1) - .5) * .018,
    width: .024 + sceneryNoise(i * 3 + 2) * .021,
    height: .055 + sceneryNoise(i * 3 + 4) * .18,
    hue: ['#75bcb7', '#83c8bf', '#6db5b3', '#8ac9bb'][i % 4],
    windows: sceneryNoise(i * 3 + 6) > .27,
    roof: sceneryNoise(i * 3 + 7) > .72
  }));
  const clouds = [
    { x: .12, y: .15, s: .93 }, { x: .35, y: .11, s: .56 },
    { x: .62, y: .23, s: .69 }, { x: .87, y: .13, s: 1.05 }
  ];

  function resize() {
    const box = canvas.getBoundingClientRect();
    w = Math.max(1, box.width); h = Math.max(1, box.height);
    dpr = Math.min(window.devicePixelRatio || 1, 2);
    canvas.width = Math.round(w * dpr);
    canvas.height = Math.round(h * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    horizon = h * (w < 650 ? .285 : .31);
    roadBottomHalf = Math.min(w * (w < 650 ? .49 : .42), 550);
  }

  // The visible world continues below the camera. Negative depths let lamps,
  // trees, road markings and shoulders leave through the screen edge instead
  // of popping away while their tops are still visible.
  function project(z) {
    const perspective = 1 / (1 + Math.max(SCENE_NEAR_Z, z) / 21);
    return {
      y: horizon + (h - horizon) * perspective,
      half: 9 + roadBottomHalf * perspective,
      perspective
    };
  }
  // A repeatable route has genuinely straight stretches between long, shallow
  // bends. Fifth-order easing keeps the slope and curvature smooth at both
  // ends of every turn (the old sine-wave route never stopped bending).
  function smoothTurn(t) {
    return t * t * t * (t * (t * 6 - 15) + 10);
  }
  function smoothTurnSlope(t) {
    return 30 * t * t * (t - 1) * (t - 1);
  }
  function roadPhase(distance) {
    return ((distance % ROAD_CYCLE) + ROAD_CYCLE) % ROAD_CYCLE;
  }
  function pathX(distance) {
    const at = roadPhase(distance);
    if (at < 300) return 0;
    if (at < 700) return -34 * smoothTurn((at - 300) / 400);
    if (at < 950) return -34;
    if (at < 1370) return -34 + 70 * smoothTurn((at - 950) / 420);
    if (at < 1580) return 36;
    if (at < 1900) return 36 * (1 - smoothTurn((at - 1580) / 320));
    return 0;
  }
  function pathSlope(distance) {
    const at = roadPhase(distance);
    if (at >= 300 && at < 700) return -34 / 400 * smoothTurnSlope((at - 300) / 400);
    if (at >= 950 && at < 1370) return 70 / 420 * smoothTurnSlope((at - 950) / 420);
    if (at >= 1580 && at < 1900) return -36 / 320 * smoothTurnSlope((at - 1580) / 320);
    return 0;
  }
  // Curvature is a drawing effect only: gameplay stays on the same four lanes.
  function roadCenterX(z) {
    if (!Number.isFinite(z)) return w / 2;
    const p = project(z);
    const ahead = pathX(meters + z) - pathX(meters) - pathSlope(meters) * z;
    const distantFade = 1 / (1 + (Math.max(0, z) / 220) ** 2);
    const pixels = ahead * (roadBottomHalf + 9) / 6 * p.perspective * distantFade;
    const cap = roadBottomHalf * .42;
    return w / 2 + cap * Math.tanh(pixels / cap);
  }
  function laneX(lane, z) {
    const p = project(z);
    return roadCenterX(z) + ((lane + .5) * 2 / LANE_COUNT - 1) * p.half;
  }
  function laneWidth(z) { return project(z).half * 2 / LANE_COUNT; }

  function projectedCarBounds(lane, z, shape) {
    // Use the same lane and depth projection as drawCar(), including tire width.
    // The silhouette gets wider toward the camera, so a fixed lane fraction
    // alone cannot guarantee two cars look separated in the crash frame.
    const outerWidth = shape.halfWidth + shape.tireOutset;
    let left = Infinity, right = -Infinity;
    for (const localZ of [-shape.halfLength, shape.halfLength]) {
      const depth = Math.max(SCENE_NEAR_Z, z + localZ);
      const center = laneX(lane, depth);
      const halfWidth = outerWidth * laneWidth(depth) / 3;
      left = Math.min(left, center - halfWidth);
      right = Math.max(right, center + halfWidth);
    }
    return { left, right };
  }

  // Coins float above the asphalt and cars have tall cabins. Compare their
  // entire projected silhouettes, not just their center points or lane IDs.
  function coinScreenBounds(coin) {
    const p = project(coin.z);
    const radius = Math.max(1, laneWidth(coin.z) * (coin.powerUp === 'score' ? .23 : .18));
    const x = laneX(coin.lane, coin.z);
    return { left: x - radius * 1.3, right: x + radius * 1.3,
      top: p.y - radius * 3.2, bottom: p.y - radius * .65 };
  }
  function carScreenBounds(car) {
    const shape = vehicleShape(car.kind);
    const sides = projectedCarBounds(car.lane, car.z, shape);
    const nearZ = Math.max(SCENE_NEAR_Z, car.z - shape.halfLength);
    const farZ = Math.max(SCENE_NEAR_Z, car.z + shape.halfLength);
    const cabinHeight = (shape.roofTop + .32) * laneWidth(nearZ) / 3;
    return { ...sides, top: project(farZ).y - cabinHeight, bottom: project(nearZ).y + 3 };
  }
  function coinTouchesCar(coin, car, padding = 6) {
    const a = coinScreenBounds(coin), b = carScreenBounds(car);
    return a.left < b.right + padding && a.right > b.left - padding &&
      a.top < b.bottom + padding && a.bottom > b.top - padding;
  }
  function coinTouchesPlayer(coin) {
    return coinTouchesCar(coin, { lane: displayLane, z: PLAYER_Z, kind: 'car' }, 3);
  }
  function coinWillOverlapTraffic(coin, traffic) {
    // Check the approach, not just the instant a coin spawns. Cars and coins
    // travel toward the camera at different speeds, especially oncoming cars.
    const untilPlayer = Math.max(0, (coin.z - PLAYER_Z) / speed);
    for (let t = 0; t <= Math.min(3.8, untilPlayer); t += .15) {
      const ahead = { lane: coin.lane, z: coin.z - speed * t };
      for (const car of traffic) {
        // Forecast actual lane conflicts; momentary perspective occlusion by
        // another lane is handled by the per-frame visual safety check.
        if (car.lane !== coin.lane) continue;
        const closingSpeed = car.oncoming ? speed + car.currentSpeed : Math.max(8, speed - car.currentSpeed);
        const futureCar = { lane: car.lane, z: car.z - closingSpeed * t, kind: car.kind };
        if (coinTouchesCar(ahead, futureCar, 8)) return true;
      }
    }
    return false;
  }
  function removeCoveredCoins() {
    const traffic = objects.filter((o) => o.type === 'car');
    for (let i = objects.length - 1; i >= 0; i--) {
      const coin = objects[i];
      // Perspective can make coins in the NEXT lane overlap a car's screen
      // rectangle. Only real same-lane conflicts should destroy a trail.
      if (coin.type === 'coin' && traffic.some((car) => car.lane === coin.lane &&
        coinTouchesCar(coin, car, 5))) {
        objects.splice(i, 1);
      }
    }
  }

  function roundedRect(x, y, width, height, radius, fill) {
    if (width <= 0 || height <= 0) return;
    ctx.beginPath();
    ctx.roundRect(x, y, width, height, Math.min(radius, width / 2, height / 2));
    ctx.fillStyle = fill;
    ctx.fill();
  }
  function polygon(points, color) {
    ctx.beginPath(); ctx.moveTo(points[0][0], points[0][1]);
    for (let i = 1; i < points.length; i++) ctx.lineTo(points[i][0], points[i][1]);
    ctx.closePath(); ctx.fillStyle = color; ctx.fill();
  }
  function strokeLine(points, color, width) {
    ctx.beginPath(); ctx.moveTo(points[0][0], points[0][1]);
    for (let i = 1; i < points.length; i++) ctx.lineTo(points[i][0], points[i][1]);
    ctx.strokeStyle = color; ctx.lineWidth = width; ctx.stroke();
  }

  function drawCloud(x, y, scale) {
    ctx.fillStyle = '#fffced'; ctx.globalAlpha = .82;
    ctx.beginPath();
    ctx.ellipse(x, y + 8 * scale, 55 * scale, 16 * scale, 0, 0, Math.PI * 2);
    ctx.ellipse(x - 25 * scale, y, 22 * scale, 20 * scale, 0, 0, Math.PI * 2);
    ctx.ellipse(x + 5 * scale, y - 11 * scale, 33 * scale, 28 * scale, 0, 0, Math.PI * 2);
    ctx.ellipse(x + 35 * scale, y + 1 * scale, 23 * scale, 18 * scale, 0, 0, Math.PI * 2);
    ctx.fill(); ctx.globalAlpha = 1;
  }
  function drawHills() {
    const rise = Math.min(horizon * .27, w * .15);
    // Two continuous ridge lines sit BEHIND the distant city, with their
    // foreground disappearing beneath the grass at precisely the horizon.
    const far = ctx.createLinearGradient(0, horizon - rise, 0, horizon + 24);
    far.addColorStop(0, '#a7ddc3'); far.addColorStop(1, '#96d2ab');
    ctx.beginPath();
    ctx.moveTo(0, horizon + 25);
    ctx.lineTo(0, horizon - rise * .38);
    ctx.bezierCurveTo(w * .15, horizon - rise * 1.24,
      w * .23, horizon - rise * .95, w * .39, horizon - rise * .35);
    ctx.bezierCurveTo(w * .50, horizon - rise * .82,
      w * .59, horizon - rise * 1.18, w * .75, horizon - rise * .50);
    ctx.bezierCurveTo(w * .84, horizon - rise * .79,
      w * .92, horizon - rise * .65, w, horizon - rise * .31);
    ctx.lineTo(w, horizon + 25); ctx.closePath();
    ctx.fillStyle = far; ctx.fill();

    ctx.beginPath();
    ctx.moveTo(0, horizon + 25);
    ctx.lineTo(0, horizon - rise * .15);
    ctx.bezierCurveTo(w * .19, horizon - rise * .43,
      w * .30, horizon + rise * .04, w * .46, horizon - rise * .17);
    ctx.bezierCurveTo(w * .64, horizon - rise * .51,
      w * .78, horizon - rise * .23, w, horizon - rise * .05);
    ctx.lineTo(w, horizon + 25); ctx.closePath();
    ctx.fillStyle = '#8bcda7'; ctx.fill();
  }
  function drawNearRidge() {
    // The fields roll up in front of the city, naturally hiding the bottoms
    // of buildings instead of chopping every building at a flat grass line.
    ctx.beginPath();
    ctx.moveTo(0, horizon + 22);
    ctx.lineTo(0, horizon - 12);
    ctx.bezierCurveTo(w * .15, horizon - 28,
      w * .31, horizon + 10, w * .49, horizon + 9);
    ctx.bezierCurveTo(w * .66, horizon - 12,
      w * .80, horizon - 30, w, horizon - 8);
    ctx.lineTo(w, horizon + 22); ctx.closePath();
    ctx.fillStyle = '#91d4a0'; ctx.fill();
  }
  function drawBackground() {
    const sky = ctx.createLinearGradient(0, 0, 0, horizon + 50);
    sky.addColorStop(0, '#52bdd6'); sky.addColorStop(.74, '#a4e9df'); sky.addColorStop(1, '#dff9df');
    ctx.fillStyle = sky; ctx.fillRect(0, 0, w, h);

    const sunX = w * .77, sunY = horizon * .43, sunR = Math.max(40, Math.min(w, h) * .07);
    ctx.beginPath(); ctx.arc(sunX, sunY, sunR * 1.6, 0, Math.PI * 2); ctx.fillStyle = '#fff8c143'; ctx.fill();
    ctx.beginPath(); ctx.arc(sunX, sunY, sunR, 0, Math.PI * 2); ctx.fillStyle = '#fff4b6'; ctx.fill();
    clouds.forEach((cloud) => {
      const drift = Math.sin(clock * .1 + cloud.x * 11) * 8;
      drawCloud(w * cloud.x + drift, horizon * cloud.y / .31, cloud.s * (w < 650 ? .7 : 1));
    });

    drawHills();
    const buildingBase = horizon + 18;
    skyline.forEach((b) => {
      const x = b.x * w, bw = b.width * w;
      // Distant buildings are lower around the road's vanishing point.
      const centerFade = .68 + .32 * Math.min(1, Math.abs(b.x - .5) * 3);
      const bh = Math.min(horizon * .37, horizon * b.height * centerFade);
      const top = buildingBase - bh;
      ctx.fillStyle = b.hue; ctx.fillRect(x, top, bw + 2, bh);
      if (b.roof) {
        ctx.fillStyle = '#a5d7c7';
        ctx.fillRect(x + bw * .28, top - 5, bw * .43, 5);
      }
      if (b.windows && bw > 16) {
        ctx.fillStyle = '#e8f7daa8';
        for (let wx = x + 6; wx < x + bw - 5; wx += 11) {
          for (let wy = top + 11; wy < horizon + 7; wy += 13) ctx.fillRect(wx, wy, 3, 5);
        }
      }
    });
    drawNearRidge();
    const grass = ctx.createLinearGradient(0, horizon, 0, h);
    grass.addColorStop(0, '#99d991'); grass.addColorStop(.55, '#84d29a');
    grass.addColorStop(1, '#54b98c');
    ctx.fillStyle = grass; ctx.fillRect(0, horizon + 15, w, h - horizon);

    // All turf stripes are sampled from the ROAD'S projected centerline.
    // They taper to the same vanishing point and bend with the highway.
    for (const side of [-1, 1]) {
      roadRibbon(ROAD_DEPTHS, side, side, '#a6dea254',
        side * 160, side * 19);
      roadRibbon(ROAD_DEPTHS, side, side, '#59aa7a40',
        side * 295, side * 185);
      roadRibbon(ROAD_DEPTHS, side, side, '#c1e4ab8c',
        side * 23, side * 12);
    }
  }

  // Each ribbon is sampled along the same curving route. The far end tapers to
  // a single point at the horizon, and the near end extends *past* the screen.
  const ROAD_DEPTHS = [Infinity, 1800, 1200, 850, 600, 440, 330, 270, 225,
    190, 165, 145, 125, 108, 94, 80, 68, 58, 49, 41, 34, 28, 23, 18,
    14, 10, 7, 4, 2, 0, -2, -4, -6, -8, -10, SCENE_NEAR_Z];
  function roadPoint(z, portion = 0, inset = 0) {
    if (!Number.isFinite(z)) return [w / 2, horizon];
    const p = project(z);
    return [roadCenterX(z) + portion * p.half + inset * p.perspective, p.y];
  }
  function roadRibbon(depths, leftPortion, rightPortion, fill, leftInset = 0, rightInset = 0) {
    if (depths.length < 2) return;
    const left = depths.map((z) => roadPoint(z, leftPortion, leftInset));
    const right = depths.map((z) => roadPoint(z, rightPortion, rightInset)).reverse();
    polygon([...left, ...right], fill);
  }
  function drawRoad() {
    roadRibbon(ROAD_DEPTHS, -1, 1, '#d7d7be', -13, 13);
    roadRibbon(ROAD_DEPTHS, -1, 1, '#3d5864');
    // The left half carries opposite-direction traffic; the right half is ours.
    roadRibbon(ROAD_DEPTHS, -1, 0, '#1a35432d');
    // Muted road center, lighter toward the horizon.
    const roadGlow = ctx.createLinearGradient(0, horizon, 0, h);
    roadGlow.addColorStop(0, '#73858a6b'); roadGlow.addColorStop(1, '#253c4800');
    roadRibbon(ROAD_DEPTHS, -1, 1, roadGlow);
    // Shoulder paint.
    for (const side of [-1, 1]) {
      roadRibbon(ROAD_DEPTHS, side, side, '#ffeaba', -side * 7, 0);
      strokeLine(ROAD_DEPTHS.map((z) => roadPoint(z, side)), '#c3bda5', 2);
    }
    const cycle = 22, dash = 10;
    for (let z = cycle - (meters % cycle) - 2 * cycle; z < MAX_Z + cycle; z += cycle) {
      const close = Math.max(SCENE_NEAR_Z, z - dash), far = Math.min(SCENE_FAR_Z, z);
      if (close >= far) continue;
      const depths = [far, (far + close) / 2, close];
      for (const laneLine of [-.5, .5]) {
        roadRibbon(depths, laneLine, laneLine, '#e8f5ecdc', -6, 6);
      }
    }
    // Double center line separates the two travel directions.
    for (const side of [-1, 1]) {
      const left = ROAD_DEPTHS.map((z) => roadPoint(z, 0, side * 7 - 2));
      const right = ROAD_DEPTHS.map((z) => roadPoint(z, 0, side * 7 + 2)).reverse();
      polygon([...left, ...right], '#f2c956');
    }
  }

  function drawTree(side, z, variant = 0) {
    const p = project(z);
    const size = p.perspective * (variant === 0 ? 116 : 88);
    if (size < 3) return;
    const x = roadCenterX(z) + side * (p.half + 42 * p.perspective + size * .22);
    const palette = variant === 0
      ? { light: '#9ceac2', mid: '#39ae8c', dark: '#146b67', deep: '#175e59' }
      : { light: '#b9eaa0', mid: '#65c38c', dark: '#2c8265', deep: '#28634b' };
    ctx.save();
    ctx.translate(x, p.y);
    ctx.scale(size, size);

    // Ground shadow and the two shaded sides of a tapered, cylindrical trunk.
    ctx.fillStyle = '#214f3c36';
    ctx.beginPath(); ctx.ellipse(.20, .006, .46, .105, 0, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = '#614b3a';
    polygon([[-.082, 0], [.082, 0], [.060, -.66], [-.052, -.66]], '#694f3b');
    polygon([[-.082, 0], [-.014, -.015], [-.012, -.67], [-.052, -.66]], '#c99a64');
    polygon([[.016, 0], [.082, 0], [.060, -.66], [.012, -.66]], '#453e37');
    ctx.strokeStyle = '#e5ae735e'; ctx.lineWidth = .014;
    ctx.beginPath(); ctx.moveTo(-.045, -.12); ctx.lineTo(-.026, -.47); ctx.stroke();
    // Branches have thickness and remain attached to the trunk behind the crown.
    ctx.strokeStyle = '#76553b'; ctx.lineWidth = .046; ctx.lineCap = 'round';
    ctx.beginPath(); ctx.moveTo(0, -.55); ctx.lineTo(-.24, -.83);
    ctx.moveTo(.005, -.51); ctx.lineTo(.23, -.77); ctx.stroke();

    // Overlapping lit/shaded ellipsoids give the foliage a rounded 3D volume.
    const foliage = (cx, cy, rx, ry, highlight = false) => {
      ctx.save(); ctx.translate(cx, cy); ctx.scale(rx, ry);
      const shadow = ctx.createRadialGradient(-.32, -.42, .035, .13, .14, 1.20);
      shadow.addColorStop(0, highlight ? '#d8f6c1' : palette.light);
      shadow.addColorStop(.46, highlight ? palette.light : palette.mid);
      shadow.addColorStop(.85, palette.dark);
      shadow.addColorStop(1, palette.deep);
      ctx.fillStyle = shadow;
      ctx.beginPath(); ctx.ellipse(0, 0, 1, 1, 0, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = '#ffffff1b';
      ctx.beginPath(); ctx.ellipse(-.35, -.46, .33, .20, -.42, 0, Math.PI * 2); ctx.fill();
      ctx.restore();
    };
    foliage(.19, -.81, .34, .30);
    foliage(-.20, -.82, .35, .30);
    foliage(0, -1.03, .35, .33, true);
    foliage(.06, -.74, .33, .27);
    ctx.restore();
  }
  function drawBush(side, z, variant = 0) {
    const p = project(z);
    const size = p.perspective * (variant ? 48 : 63);
    if (size < 2.5) return;
    // A single world depth controls both the root and its scale. These bushes
    // remain planted on the field as the road bends and the camera advances.
    const x = roadCenterX(z) + side * (p.half + 158 * p.perspective);
    ctx.save(); ctx.translate(x, p.y); ctx.scale(size, size);
    ctx.fillStyle = '#286d4d30';
    ctx.beginPath(); ctx.ellipse(.05, .008, .7, .14, 0, 0, Math.PI * 2); ctx.fill();
    const leaf = ctx.createRadialGradient(-.24, -.55, .035, .06, -.29, .82);
    leaf.addColorStop(0, variant ? '#c4efa4' : '#abebbc');
    leaf.addColorStop(.6, variant ? '#6fc18a' : '#4ebc94');
    leaf.addColorStop(1, '#287968');
    ctx.fillStyle = leaf;
    for (const [bx, by, rx, ry] of [[-.36, -.32, .35, .33], [.31, -.32, .39, .34], [0, -.45, .43, .42]]) {
      ctx.beginPath(); ctx.ellipse(bx, by, rx, ry, 0, 0, Math.PI * 2); ctx.fill();
    }
    ctx.fillStyle = '#e9f6be';
    ctx.beginPath(); ctx.arc(-.17, -.68, .055, 0, Math.PI * 2);
    ctx.arc(.26, -.36, .045, 0, Math.PI * 2); ctx.fill();
    ctx.restore();
  }
  function drawLamp(side, z) {
    const p = project(z), size = p.perspective * 158;
    if (size < 2) return;
    const x = roadCenterX(z) + side * (p.half + 40 * p.perspective);
    const arm = -side * .21;
    ctx.save();
    ctx.translate(x, p.y); ctx.scale(size, size);
    // The post has a front highlight, a darker right face, and a base plate.
    ctx.fillStyle = '#17475648'; ctx.beginPath(); ctx.ellipse(.14, .004, .24, .055, 0, 0, Math.PI * 2); ctx.fill();
    polygon([[-.060, 0], [.061, 0], [.050, -.047], [-.051, -.047]], '#284b5b');
    polygon([[-.028, -.025], [.028, -.025], [.024, -.97], [-.023, -.97]], '#24495c');
    polygon([[-.028, -.025], [-.006, -.025], [-.007, -.97], [-.023, -.97]], '#8bc6ca');
    polygon([[.012, -.025], [.028, -.025], [.024, -.97], [.010, -.97]], '#163d50');
    // A raised arm and a boxed lamp head point toward (not into) the road.
    ctx.lineCap = 'round'; ctx.lineJoin = 'round';
    ctx.strokeStyle = '#183d50'; ctx.lineWidth = .057;
    ctx.beginPath(); ctx.moveTo(0, -.96); ctx.lineTo(arm, -.975); ctx.stroke();
    ctx.strokeStyle = '#88bfc4'; ctx.lineWidth = .021;
    ctx.beginPath(); ctx.moveTo(-side * .007, -.983); ctx.lineTo(arm, -.995); ctx.stroke();
    const head = arm - side * .018;
    polygon([[head - .13, -1.012], [head + .12, -1.012],
      [head + .10, -.945], [head - .11, -.945]], '#284958');
    polygon([[head - .13, -1.012], [head + .12, -1.012],
      [head + .082, -1.046], [head - .10, -1.046]], '#9cc9c6');
    polygon([[head - .11, -.945], [head + .10, -.945],
      [head + .071, -.925], [head - .08, -.925]], '#ffefad');
    const halo = ctx.createRadialGradient(head, -.925, .015, head, -.925, .24);
    halo.addColorStop(0, '#fff6be68');
    halo.addColorStop(1, '#fff6be00');
    ctx.fillStyle = halo;
    ctx.beginPath(); ctx.ellipse(head, -.86, .24, .17, 0, 0, Math.PI * 2); ctx.fill();
    ctx.restore();
  }
  function drawRoadside() {
    const step = 46;
    const segment = Math.floor(meters / step);
    const offset = meters - segment * step;
    const items = [];
    // Space trees and lights apart in world distance, then paint BACK to
    // FRONT; a distant lamp must never be drawn on top of a nearer tree.
    // Every decoration belongs to a permanent ROAD segment. Using the loop
    // index for variations made trees change color/shape and lamps swap sides
    // when the scrolling offset wrapped around at each 46-meter boundary.
    for (let i = -2; i <= 8; i++) {
      const worldIndex = segment + i;
      const z = i * step + step - offset;
      items.push({ type: 'tree', side: -1, z, variant: Math.abs(worldIndex) % 2 });
      items.push({ type: 'tree', side: 1, z: z + 6, variant: Math.abs(worldIndex + 1) % 2 });
      items.push({ type: 'lamp', side: worldIndex % 2 === 0 ? -1 : 1, z: z + 25 });
      items.push({ type: 'bush', side: -1, z: z + 17, variant: Math.abs(worldIndex) % 2 });
      items.push({ type: 'bush', side: 1, z: z + 34, variant: Math.abs(worldIndex + 1) % 2 });
    }
    items.sort((a, b) => b.z - a.z);
    for (const item of items) {
      if (item.z < SCENE_NEAR_Z - 13 || item.z > MAX_Z + 85) continue;
      if (item.type === 'tree') drawTree(item.side, item.z, item.variant);
      else if (item.type === 'bush') drawBush(item.side, item.z, item.variant);
      else drawLamp(item.side, item.z);
    }
  }

  function drawDistanceHaze() {
    // Blend the vanishing point into the landscape so the road never has a
    // visible cap or artificial end on the skyline.
    const fade = clamp(h * .155, 105, 155);
    const haze = ctx.createLinearGradient(0, horizon - 2, 0, horizon + fade);
    haze.addColorStop(0, 'rgba(158,219,145,1)');
    haze.addColorStop(.32, 'rgba(158,219,145,1)');
    haze.addColorStop(.72, 'rgba(155,216,145,.42)');
    haze.addColorStop(1, 'rgba(155,216,145,0)');
    ctx.fillStyle = haze;
    ctx.fillRect(0, horizon - 2, w, fade + 2);
  }

  function shadeColor(hex, strength) {
    const raw = hex.replace('#', '');
    const values = [0, 2, 4].map((i) => parseInt(raw.substring(i, i + 2), 16));
    return `rgb(${values.map((v) => clamp(Math.round(v * strength), 0, 255)).join(',')})`;
  }

  // These cars are built as actual 3D geometry (body, roof, windows, tires),
  // then projected through the same camera as the road. No downloaded models.
  function drawCar(lane, z, color, isPlayer = false, kind = 'car', oncoming = false) {
    if (laneWidth(Math.max(z, 0)) < 2) return;
    const truck = !isPlayer && kind === 'truck';
    const shape = vehicleShape(isPlayer ? 'car' : kind);
    const halfW = shape.halfWidth;
    const halfL = shape.halfLength;
    const { bodyTop, roofTop, roofW } = shape;
    // The cab and hood of an approaching car must face the camera. Mirroring
    // the longitudinal cabin coordinates keeps its windshield toward us and
    // its trunk/bed behind it (the box truck has separate oncoming geometry).
    const roofRear = oncoming && !truck ? -shape.roofFront : shape.roofRear;
    const roofFront = oncoming && !truck ? -shape.roofRear : shape.roofFront;
    const windowRear = oncoming && !truck ? -shape.windowFront : shape.windowRear;
    const windowFront = oncoming && !truck ? -shape.windowRear : shape.windowFront;
    const bank = isPlayer && state === 'playing' ? clamp(targetLane - displayLane, -1, 1) * .13 : 0;
    const bob = isPlayer && state === 'playing' ? Math.sin(clock * 27) * .6 : 0;
    const point = (x, y, localZ) => {
      // Let each body panel travel below the bottom edge naturally. Clamping
      // at z=.1 held the bumper in place while the roof kept moving, which
      // made exiting cars appear to disintegrate into separate polygons.
      const depth = Math.max(SCENE_NEAR_Z, z + localZ);
      const perspective = project(depth);
      const unit = laneWidth(depth) / 3;
      return [laneX(lane, depth) + (x + bank * localZ) * unit,
        perspective.y - y * unit * 1.16 + bob];
    };
    const face = (vertices, fill) => polygon(vertices.map((v) => point(...v)), fill);
    const line = (vertices, stroke, width = 1.5) => strokeLine(vertices.map((v) => point(...v)), stroke, width * project(z).perspective);

    ctx.save();
    const foot = point(0, 0, 0);
    const shadowW = laneWidth(z) * .55;
    ctx.fillStyle = '#16313e4c'; ctx.beginPath();
    ctx.ellipse(foot[0], foot[1] - 1, shadowW, shadowW * .27, 0, 0, Math.PI * 2); ctx.fill();

    // Chunky 3D wheel volumes, with twin rear axles on delivery trucks.
    const wheelPositions = truck
      ? (oncoming
        ? [-halfL + .92, halfL - 1.38, halfL - .59]
        : [-halfL + .59, -halfL + 1.38, halfL - .92])
      : [-halfL + .68, halfL - .95];
    const wheelTop = truck ? .91 : .76;
    for (const side of [-1, 1]) {
      for (const wheelZ of wheelPositions) {
        const outer = side * (halfW + shape.tireOutset), inner = side * (halfW - .12);
        face([[inner, .12, wheelZ - .38], [outer, .12, wheelZ - .38],
          [outer, wheelTop, wheelZ - .38], [inner, wheelTop, wheelZ - .38]], '#132b36');
        face([[outer, .12, wheelZ - .38], [outer, .12, wheelZ + .38],
          [outer, wheelTop, wheelZ + .38], [outer, wheelTop, wheelZ - .38]], '#182d36');
        face([[outer, wheelTop, wheelZ - .38], [outer, wheelTop, wheelZ + .38],
          [inner, wheelTop, wheelZ + .38], [inner, wheelTop, wheelZ - .38]], '#30424a');
      }
    }

    const rear = -halfL, front = halfL;
    // Extruded body panels: near face, far face, two sides and the hood.
    face([[-halfW, .15, front], [halfW, .15, front], [halfW, bodyTop, front], [-halfW, bodyTop, front]], shadeColor(color, .72));
    face([[-halfW, .15, rear], [-halfW, .15, front], [-halfW, bodyTop, front], [-halfW, bodyTop, rear]], shadeColor(color, .73));
    face([[halfW, .15, front], [halfW, .15, rear], [halfW, bodyTop, rear], [halfW, bodyTop, front]], shadeColor(color, .86));
    face([[-halfW, bodyTop, rear], [-halfW, bodyTop, front], [halfW, bodyTop, front], [halfW, bodyTop, rear]], shadeColor(color, 1.12));

    if (truck && oncoming) {
      // The cab is the NEAR end when the truck approaches the player.
      // Paint the distant cargo box first, then paint the front-facing cab
      // over it. The reverse view must never show a rear cargo shutter
      // floating through its windshield or grille.
      const boxNear = rear + 1.75, boxFar = front - .13;
      const boxW = halfW * .96, boxFloor = bodyTop + .12;
      face([[-boxW, boxFloor, boxFar], [boxW, boxFloor, boxFar],
        [boxW, roofTop, boxFar], [-boxW, roofTop, boxFar]], shadeColor(color, .71));
      face([[-boxW, boxFloor, boxNear], [-boxW, boxFloor, boxFar],
        [-boxW, roofTop, boxFar], [-boxW, roofTop, boxNear]], shadeColor(color, .73));
      face([[boxW, boxFloor, boxFar], [boxW, boxFloor, boxNear],
        [boxW, roofTop, boxNear], [boxW, roofTop, boxFar]], shadeColor(color, .88));
      face([[-boxW, roofTop, boxNear], [-boxW, roofTop, boxFar],
        [boxW, roofTop, boxFar], [boxW, roofTop, boxNear]], shadeColor(color, 1.13));
      face([[-boxW, boxFloor, boxNear], [boxW, boxFloor, boxNear],
        [boxW, roofTop, boxNear], [-boxW, roofTop, boxNear]], shadeColor(color, .80));
      // A broad horizontal edge makes the cargo box sit BEHIND the cab.
      line([[-boxW * .92, roofTop - .14, boxNear - .02],
        [boxW * .92, roofTop - .14, boxNear - .02]], '#d6eff4a8', 2);

      // Shorter, lower cab: raised roof, side windows and a sloping FRONT
      // windshield. Its surfaces cover the lower part of the box behind it.
      const cabW = halfW * .90, cabRoof = 1.91;
      const cabRoofW = cabW * .87;
      const cabNose = rear + .13, cabRoofNear = rear + .82;
      const cabRoofFar = boxNear - .11;
      face([[-cabW, bodyTop, cabNose], [-cabW, bodyTop, boxNear + .04],
        [-cabRoofW, cabRoof, cabRoofFar], [-cabRoofW, cabRoof, cabRoofNear]], shadeColor(color, .73));
      face([[cabW, bodyTop, boxNear + .04], [cabW, bodyTop, cabNose],
        [cabRoofW, cabRoof, cabRoofNear], [cabRoofW, cabRoof, cabRoofFar]], shadeColor(color, .86));
      face([[-cabRoofW, cabRoof, cabRoofNear], [-cabRoofW, cabRoof, cabRoofFar],
        [cabRoofW, cabRoof, cabRoofFar], [cabRoofW, cabRoof, cabRoofNear]], shadeColor(color, 1.21));
      for (const side of [-1, 1]) {
        face([[side * cabW * .97, bodyTop + .13, rear + .83],
          [side * cabW * .97, bodyTop + .13, boxNear - .16],
          [side * cabRoofW * .96, cabRoof - .10, cabRoofFar - .09],
          [side * cabRoofW * .96, cabRoof - .10, cabRoofNear + .09]],
        side < 0 ? '#285d73' : '#4d97a8');
      }
      face([[-cabW * .94, bodyTop + .08, cabNose + .01],
        [cabW * .94, bodyTop + .08, cabNose + .01],
        [cabRoofW * .95, cabRoof - .11, cabRoofNear],
        [-cabRoofW * .95, cabRoof - .11, cabRoofNear]], '#204e67');
      line([[-cabW * .89, bodyTop + .16, cabNose],
        [-cabRoofW * .88, cabRoof - .11, cabRoofNear]], '#b4e0df', 2);
      line([[cabW * .89, bodyTop + .16, cabNose],
        [cabRoofW * .88, cabRoof - .11, cabRoofNear]], '#b4e0df', 2);
      face([[-halfW * .93, bodyTop + .01, rear + .01],
        [halfW * .93, bodyTop + .01, rear + .01],
        [halfW * .92, bodyTop + .05, rear + .34],
        [-halfW * .92, bodyTop + .05, rear + .34]], shadeColor(color, 1.16));
    } else if (truck) {
      // A short, lower driving cab extends in front of a separate tall,
      // perfectly squared cargo box. This is a delivery truck, not a tall van.
      const boxRear = rear + .15, boxFront = front - 1.62;
      const boxW = halfW * .96, boxFloor = bodyTop + .12;
      const cabRear = boxFront + .10, cabFront = front - .19;
      const cabW = halfW * .85, cabRoof = 1.88;
      face([[-cabW, bodyTop, cabFront], [cabW, bodyTop, cabFront],
        [cabW * .86, cabRoof, cabFront - .66], [-cabW * .86, cabRoof, cabFront - .66]], '#285f77');
      face([[-cabW, bodyTop, cabRear], [-cabW, bodyTop, cabFront],
        [-cabW * .86, cabRoof, cabFront - .66], [-cabW * .86, cabRoof, cabRear + .18]], shadeColor(color, .73));
      face([[cabW, bodyTop, cabFront], [cabW, bodyTop, cabRear],
        [cabW * .86, cabRoof, cabRear + .18], [cabW * .86, cabRoof, cabFront - .66]], shadeColor(color, .86));
      face([[-cabW * .86, cabRoof, cabRear + .18], [-cabW * .86, cabRoof, cabFront - .66],
        [cabW * .86, cabRoof, cabFront - .66], [cabW * .86, cabRoof, cabRear + .18]], shadeColor(color, 1.20));
      for (const side of [-1, 1]) {
        face([[side * cabW, bodyTop + .18, cabRear + .18], [side * cabW, bodyTop + .18, cabFront - .53],
          [side * cabW * .85, cabRoof - .12, cabFront - .72], [side * cabW * .85, cabRoof - .12, cabRear + .27]],
        side < 0 ? '#275669' : '#438ca1');
      }

      // High cargo walls with a flat roof and a full-size roll-up rear door.
      face([[-boxW, boxFloor, boxRear], [-boxW, boxFloor, boxFront],
        [-boxW, roofTop, boxFront], [-boxW, roofTop, boxRear]], shadeColor(color, .70));
      face([[boxW, boxFloor, boxFront], [boxW, boxFloor, boxRear],
        [boxW, roofTop, boxRear], [boxW, roofTop, boxFront]], shadeColor(color, .86));
      face([[-boxW, roofTop, boxRear], [-boxW, roofTop, boxFront],
        [boxW, roofTop, boxFront], [boxW, roofTop, boxRear]], shadeColor(color, 1.16));
      face([[-boxW, boxFloor, boxRear], [boxW, boxFloor, boxRear],
        [boxW, roofTop, boxRear], [-boxW, roofTop, boxRear]], shadeColor(color, .88));
      const doorZ = boxRear - .045;
      const doorW = boxW * .84;
      face([[-doorW, boxFloor + .15, doorZ], [doorW, boxFloor + .15, doorZ],
        [doorW, roofTop - .19, doorZ], [-doorW, roofTop - .19, doorZ]], shadeColor(color, 1.02));
      for (let y = boxFloor + .38; y < roofTop - .22; y += .24) {
        line([[-doorW, y, doorZ - .01], [doorW, y, doorZ - .01]], '#e3f2ef8c', 1.8);
      }
      for (const side of [-1, 1]) {
        const frameX = side * doorW;
        line([[frameX, boxFloor + .15, doorZ - .02], [frameX, roofTop - .19, doorZ - .02]], '#234655', 3.2);
        face([[side * boxW * .74, roofTop - .11, doorZ - .035], [side * boxW * .93, roofTop - .11, doorZ - .035],
          [side * boxW * .93, roofTop - .01, doorZ - .035], [side * boxW * .74, roofTop - .01, doorZ - .035]], '#ffe7a0');
      }
    } else {
      // Distinct cabin heights and silhouettes make sports cars, SUVs,
      // vans, pickups and sedans recognizable even from a distance.
      const drawPickupBed = () => {
        // The pickup bed belongs to the BACK of the truck. Draw it behind
        // the cab when approaching, but in front of the cab when receding.
        // The old bright outline was painted last in both directions and
        // appeared to cut straight through the oncoming windshield.
        const near = oncoming ? roofFront + .16 : rear + .18;
        const far = oncoming ? front - .18 : roofRear - .62;
        const wall = halfW * .90;
        face([[-wall, bodyTop + .035, near], [-wall, bodyTop + .035, far],
          [wall, bodyTop + .035, far], [wall, bodyTop + .035, near]], '#213640');
        for (const side of [-1, 1]) {
          face([[side * wall, bodyTop + .035, near], [side * wall, bodyTop + .035, far],
            [side * wall, bodyTop + .22, far], [side * wall, bodyTop + .22, near]],
          shadeColor(color, side < 0 ? .75 : .9));
          line([[side * wall, bodyTop + .22, near],
            [side * wall, bodyTop + .22, far]], shadeColor(color, 1.12), 1.6);
        }
      };
      if (kind === 'pickup' && oncoming) drawPickupBed();
      face([[-halfW * .91, bodyTop, windowFront], [halfW * .91, bodyTop, windowFront],
        [roofW, roofTop, roofFront], [-roofW, roofTop, roofFront]], '#285f77');
      face([[-halfW * .93, bodyTop, windowRear], [-roofW, roofTop, roofRear],
        [-roofW, roofTop, roofFront], [-halfW * .93, bodyTop, windowFront]], shadeColor(color, .70));
      face([[halfW * .93, bodyTop, windowFront], [roofW, roofTop, roofFront],
        [roofW, roofTop, roofRear], [halfW * .93, bodyTop, windowRear]], shadeColor(color, .85));

      // Side windows and pillars keep the cabins looking like solid 3D forms.
      for (const side of [-1, 1]) {
        const x1 = side * (halfW * .93), x2 = side * roofW;
        face([[x1, bodyTop + .12, windowRear + .25], [x2, roofTop - .12, roofRear + .12],
          [x2, roofTop - .12, roofFront - .09], [x1, bodyTop + .12, windowFront - .26]],
          side < 0 ? '#245a71' : '#4d94a6');
        line([[x1, bodyTop + .12, (windowRear + windowFront) / 2],
          [x2, roofTop - .1, (roofRear + roofFront) / 2]], '#174d65', 3);
      }

      face([[-halfW * .93, bodyTop, windowRear], [halfW * .93, bodyTop, windowRear],
        [roofW, roofTop, roofRear], [-roofW, roofTop, roofRear]], '#143e55');
      face([[-halfW * .65, bodyTop + .09, windowRear + .05], [-halfW * .34, bodyTop + .09, windowRear + .05],
        [roofW * .30, roofTop - .12, roofRear - .015], [-roofW * .75, roofTop - .12, roofRear - .015]], '#76c8d380');
      face([[-roofW, roofTop, roofRear], [roofW, roofTop, roofRear],
        [roofW, roofTop, roofFront], [-roofW, roofTop, roofFront]], shadeColor(color, 1.24));

      if (kind === 'pickup' && !oncoming) {
        drawPickupBed();
      } else if (kind === 'van' && !oncoming) {
        // Rear cargo doors only belong on the REAR of a van; drawing the
        // center split on the approaching windshield made it look backwards.
        line([[0, bodyTop + .05, windowRear - .06], [0, roofTop - .14, roofRear - .045]], '#c2d8dd', 2);
        for (const side of [-1, 1]) {
          line([[side * roofW * .89, bodyTop + .14, windowRear - .04],
            [side * roofW * .90, roofTop - .12, roofRear - .045]], '#204654', 2);
        }
      } else if (kind === 'suv') {
        // Raised roof rails distinguish the large SUV from the sedan.
        for (const side of [-1, 1]) {
          line([[side * roofW * .86, roofTop + .10, roofRear],
            [side * roofW * .86, roofTop + .10, roofFront]], '#244655', 3);
        }
      }
    }

    // The side facing the player is either a red-lit rear or an oncoming front.
    face([[-halfW, .16, rear], [halfW, .16, rear], [halfW, bodyTop, rear], [-halfW, bodyTop, rear]], shadeColor(color, .65));
    face([[-halfW * 1.04, .15, rear - .045], [halfW * 1.04, .15, rear - .045],
      [halfW * 1.04, .34, rear - .045], [-halfW * 1.04, .34, rear - .045]], '#253f4d');
    for (const side of [-1, 1]) {
      const xl = side < 0 ? -halfW * .87 : halfW * .45;
      face([[xl, .40, rear - .052], [xl + halfW * .4, .40, rear - .052],
        [xl + halfW * .4, .61, rear - .052], [xl, .61, rear - .052]], oncoming ? '#fff4ce' : '#f65d63');
      line([[xl + .025, .59, rear - .055], [xl + halfW * .36, .59, rear - .055]],
        oncoming ? '#ffffff' : '#ffac9a', 2);
    }
    if (oncoming) {
      // Oncoming cars show their grille and bright headlights, not red tail lights.
      face([[-.47, .31, rear - .063], [.47, .31, rear - .063],
        [.47, .50, rear - .063], [-.47, .50, rear - .063]], '#1b3441');
      for (const y of [.36, .43]) line([[-.38, y, rear - .067], [.38, y, rear - .067]], '#527078', 1.5);
    } else {
      face([[-.27, .22, rear - .06], [.27, .22, rear - .06],
        [.27, .30, rear - .06], [-.27, .30, rear - .06]], '#b3e1db');
    }
    if (!isPlayer && kind === 'sport') {
      // The spoiler stays on the far/rear end of an approaching sports car.
      const wingZ = oncoming ? front + .06 : rear - .08;
      for (const side of [-1, 1]) {
        line([[side * halfW * .72, bodyTop - .03, wingZ],
          [side * halfW * .72, bodyTop + .20, wingZ]], '#1c3544', 4);
      }
      face([[-halfW * .96, bodyTop + .18, wingZ], [halfW * .96, bodyTop + .18, wingZ],
        [halfW * .96, bodyTop + .29, wingZ], [-halfW * .96, bodyTop + .29, wingZ]],
      shadeColor(color, .62));
    }
    if (isPlayer) {
      // Clean white bodywork: no racing stripe on the roof or hood.
      line([[-halfW * .52, .68, rear - .06], [halfW * .52, .68, rear - .06]], '#e9ffff', 2);
    } else if (truck && !oncoming) {
      line([[-.72, .83, rear - .055], [.72, .83, rear - .055]], '#ffffff88', 3);
    }
    ctx.restore();
  }

  function drawCoin(o) {
    // Depth sorting handles temporary visual occlusion from neighboring lanes.
    // Never hide an entire coin trail because a distant adjacent car's
    // projected rectangle happens to cross its screen position.
    if (coinFlightLift < .25 && objects.some((car) => car.type === 'car' && car.lane === o.lane &&
      coinTouchesCar(o, car, 5))) return;
    const p = project(o.z), x = laneX(o.lane, o.z);
    const radius = Math.max(1, laneWidth(o.z) * .18);
    // Rocket flight lifts collectibles to the SAME world height as the car.
    // Scaling with depth keeps distant coins close to the horizon instead of
    // making them jump a fixed number of screen pixels.
    const airLift = coinFlightLift * laneWidth(o.z) * .95;
    if (o.powerUp === 'score') {
      const bonus = scorePowerups.BONUS_TYPES.find((item) => item.points === o.scoreBonus);
      if (!bonus) return;
      const size = Math.max(2, radius * 1.26);
      const y = p.y - size * 1.85 - airLift - Math.sin(clock * 3.6 + o.phase) * size * .15;
      ctx.save(); ctx.translate(x, y);
      const halo = ctx.createRadialGradient(0, 0, size * .3, 0, 0, size * 2);
      halo.addColorStop(0, `${bonus.glow}a4`);
      halo.addColorStop(1, `${bonus.glow}00`);
      ctx.fillStyle = halo; ctx.beginPath(); ctx.arc(0, 0, size * 2, 0, Math.PI * 2); ctx.fill();
      ctx.rotate(Math.sin(clock * 3 + o.phase) * .08);
      ctx.fillStyle = bonus.fill;
      ctx.strokeStyle = bonus.rim;
      ctx.lineWidth = Math.max(1, size * .14);
      ctx.beginPath();
      for (let i = 0; i < 8; i++) {
        const angle = Math.PI * (i / 4 - .5);
        const r = i % 2 ? size * .95 : size * 1.1;
        const px = Math.cos(angle) * r, py = Math.sin(angle) * r;
        if (i === 0) ctx.moveTo(px, py); else ctx.lineTo(px, py);
      }
      ctx.closePath(); ctx.fill(); ctx.stroke();
      ctx.fillStyle = '#ffffff'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.font = `900 ${Math.max(2, size * (bonus.points === 100 ? .65 : .72))}px system-ui`;
      ctx.fillText(bonus.short, 0, size * .03);
      if (size > 9) {
        ctx.font = `800 ${size * .40}px system-ui`;
        ctx.fillStyle = bonus.rim;
        ctx.fillText(bonus.rarity, 0, -size * 1.38);
      }
      ctx.restore();
      return;
    }
    if (o.powerUp === 'flight') {
      const y = p.y - radius * 2 - airLift;
      ctx.save(); ctx.translate(x, y);
      const halo = ctx.createRadialGradient(0, 0, radius * .15, 0, 0, radius * 2.5);
      halo.addColorStop(0, '#f7ffffdc'); halo.addColorStop(.42, '#5cddff9a'); halo.addColorStop(1, '#52d9ff00');
      ctx.fillStyle = halo; ctx.beginPath(); ctx.arc(0, 0, radius * 2.5, 0, Math.PI * 2); ctx.fill();
      ctx.save(); ctx.scale(Math.max(.20, Math.abs(Math.cos(clock * 3.1 + o.phase))), 1);
      ctx.fillStyle = '#176fb0'; ctx.strokeStyle = '#c4ffff'; ctx.lineWidth = Math.max(1, radius * .16);
      ctx.beginPath(); ctx.arc(0, 0, radius * .9, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
      ctx.fillStyle = '#91faff'; ctx.beginPath(); ctx.arc(0, 0, radius * .69, 0, Math.PI * 2); ctx.fill();
      // The flight pickup now has a tiny rocket instead of wings.
      polygon([[0, -radius * .64], [radius * .33, -radius * .18],
        [radius * .27, radius * .43], [-radius * .27, radius * .43],
        [-radius * .33, -radius * .18]], '#075681');
      polygon([[-radius * .2, radius * .4], [0, radius * .77],
        [radius * .2, radius * .4]], '#ffad46');
      ctx.fillStyle = '#bdfaff'; ctx.beginPath(); ctx.arc(0, -radius * .13, radius * .16, 0, Math.PI * 2); ctx.fill();
      ctx.restore(); ctx.restore();
      return;
    }
    // Enough sidewall to read in profile without the chunky curved-cylinder look.
    // A touch more sidewall than the previous coin, without returning to
    // the bulky curved cylinder that was hard to read when rotating.
    const thickness = radius * .31;
    const spin = clock * 3.6 + o.phase;
    const cosine = Math.cos(spin), sine = Math.sin(spin);
    const faceWidth = Math.max(.045, Math.abs(cosine));
    const near = cosine >= 0 ? 1 : -1;
    const y = p.y - radius * 1.9 - airLift - Math.sin(clock * 4 + o.phase) * radius * .21;

    // The shadow sits on the road while the coin floats and spins above it.
    ctx.fillStyle = '#3c67543a';
    ctx.beginPath(); ctx.ellipse(x, p.y - 1, radius * .77, radius * .13, 0, 0, Math.PI * 2); ctx.fill();
    ctx.save(); ctx.translate(x, y);

    // A thin, flat coin with a clean straight edge; its narrow sidewall
    // avoids the bulky curved-cylinder look during the spin.
    const rimPoint = (angle, side) => [
      Math.cos(angle) * radius * cosine + side * thickness * .5 * sine,
      Math.sin(angle) * radius + side * thickness * .085
    ];
    const drawFace = (side, isNear) => {
      ctx.save();
      ctx.translate(side * thickness * .5 * sine, side * thickness * .085);
      ctx.scale(faceWidth, 1);
      const face = ctx.createRadialGradient(-radius * .37, -radius * .42, radius * .06, 0, 0, radius * 1.1);
      face.addColorStop(0, isNear ? '#fff9c9' : '#edb34d');
      face.addColorStop(.50, isNear ? '#ffdb63' : '#d99836');
      face.addColorStop(1, isNear ? '#c77721' : '#9c5b25');
      ctx.fillStyle = face;
      ctx.beginPath(); ctx.arc(0, 0, radius * .94, 0, Math.PI * 2); ctx.fill();
      if (isNear) {
        ctx.strokeStyle = '#fff0a2'; ctx.lineWidth = Math.max(.6, radius * .12);
        ctx.beginPath(); ctx.arc(0, 0, radius * .79, 0, Math.PI * 2); ctx.stroke();
        const inset = ctx.createLinearGradient(-radius, -radius, radius, radius);
        inset.addColorStop(0, '#ffe98b'); inset.addColorStop(.5, '#f2b43b'); inset.addColorStop(1, '#d38b29');
        ctx.fillStyle = inset;
        ctx.beginPath(); ctx.arc(0, 0, radius * .68, 0, Math.PI * 2); ctx.fill();
        ctx.font = `900 ${radius * 1.02}px system-ui`;
        ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
        ctx.fillStyle = '#c47d26'; ctx.fillText('★', radius * .035, radius * .08);
        ctx.fillStyle = '#fff7c1'; ctx.fillText('★', -radius * .045, -radius * .025);
        ctx.strokeStyle = '#fff8d1aa'; ctx.lineWidth = Math.max(.6, radius * .055);
        ctx.beginPath(); ctx.arc(0, 0, radius * .88, 3.45, 5.45); ctx.stroke();
      }
      ctx.restore();
    };

    drawFace(-near, false);
    const SEGMENTS = 28;
    for (let i = 0; i < SEGMENTS; i++) {
      const a = 2 * Math.PI * i / SEGMENTS;
      const b = 2 * Math.PI * (i + 1) / SEGMENTS;
      const light = Math.round(36 + 20 * (1 + Math.cos(a - .75)) / 2);
      const stripe = i % 3 === 0 ? 4 : 0;
      polygon([rimPoint(a, -near), rimPoint(b, -near), rimPoint(b, near), rimPoint(a, near)],
        `hsl(38 92% ${light + stripe}%)`);
    }
    drawFace(near, true);

    // An occasional sharp glint makes the polished metal catch the sun.
    const glint = Math.pow(Math.max(0, Math.sin(spin * 1.7)), 8);
    if (glint > .09) {
      ctx.globalAlpha = glint;
      const sx = radius * .7, sy = -radius * .7;
      ctx.strokeStyle = '#fff9dd'; ctx.lineWidth = Math.max(1, radius * .08);
      strokeLine([[sx - radius * .27, sy], [sx + radius * .27, sy]], '#fff9dd', ctx.lineWidth);
      strokeLine([[sx, sy - radius * .27], [sx, sy + radius * .27]], '#fff9dd', ctx.lineWidth);
    }
    ctx.restore();
  }

  function drawParticles(dt) {
    for (let i = particles.length - 1; i >= 0; i--) {
      const p = particles[i]; p.life -= dt; p.x += p.vx * dt; p.y += p.vy * dt;
      p.vy += (p.type === 'smoke' ? -18 : p.type === 'fire' ? 40 : 130) * dt;
      if (p.type === 'smoke') p.vx *= Math.max(0, 1 - dt * .65);
      if (p.life <= 0) { particles.splice(i, 1); continue; }
      ctx.globalAlpha = clamp(p.life / p.maxLife, 0, 1);
      ctx.fillStyle = p.color;
      ctx.save(); ctx.translate(p.x, p.y); ctx.rotate(p.angle + p.life * 4);
      if (p.type === 'fire' || p.type === 'smoke') {
        const expansion = p.type === 'smoke' ? 1.6 - p.life / p.maxLife : 1;
        ctx.beginPath(); ctx.arc(0, 0, p.size * expansion, 0, Math.PI * 2); ctx.fill();
      } else {
        ctx.fillRect(-p.size / 2, -p.size / 2, p.size, p.size);
      }
      ctx.restore();
    }
    ctx.globalAlpha = 1;
  }
  function burst(x, y, color, count = 14) {
    for (let i = 0; i < count; i++) {
      const angle = rand(0, Math.PI * 2), v = rand(45, 170);
      particles.push({ x, y, vx: Math.cos(angle) * v, vy: Math.sin(angle) * v - 60,
        size: rand(3, 9), angle: rand(0, 6), life: rand(.38, .8), maxLife: .8, color });
    }
  }

  function engineExplosion(headOn, hit) {
    let x = laneX(displayLane, PLAYER_Z);
    if (!headOn && hit && Math.abs(displayLane - hit.lane) > .05) {
      // A sideswipe sparks at the touching outer edges, rather than in the
      // middle of either car or off to the side after steering finishes.
      const trafficShape = vehicleShape(hit.kind);
      const playerEdges = projectedCarBounds(displayLane, PLAYER_Z, VEHICLE_SHAPES.car);
      const trafficEdges = projectedCarBounds(hit.lane, hit.z, trafficShape);
      x = hit.lane > displayLane
        ? (playerEdges.right + trafficEdges.left) / 2
        : (playerEdges.left + trafficEdges.right) / 2;
    }
    const y = project(PLAYER_Z).y - laneWidth(PLAYER_Z) * .40;
    const power = headOn ? 1 : .55;
    explosion = { x, y, age: 0, power };
    const fireCount = headOn ? 65 : 23;
    for (let i = 0; i < fireCount; i++) {
      const direction = rand(0, Math.PI * 2), velocity = rand(45, 280) * power;
      const life = rand(.32, .8);
      particles.push({ type: 'fire', x, y, vx: Math.cos(direction) * velocity,
        vy: Math.sin(direction) * velocity - 75, size: rand(5, 21) * power,
        color: pick(['#ffe86c', '#ffbe3d', '#ff7a2f', '#fb4935']), angle: rand(0, 6), life, maxLife: life });
    }
    for (let i = 0; i < (headOn ? 27 : 12); i++) {
      const direction = rand(0, Math.PI * 2), velocity = rand(25, 140) * power;
      const life = rand(.65, 1.4);
      particles.push({ type: 'smoke', x: x + rand(-20, 20), y: y + rand(-15, 15),
        vx: Math.cos(direction) * velocity * .55, vy: Math.sin(direction) * velocity - 70,
        size: rand(11, 28) * power, color: pick(['#3c4a50', '#617078', '#8d9090']),
        angle: rand(0, 6), life, maxLife: life });
    }
    for (let i = 0; i < (headOn ? 46 : 18); i++) {
      const direction = rand(0, Math.PI * 2), velocity = rand(100, 350) * power;
      const life = rand(.32, .9);
      particles.push({ type: 'debris', x, y, vx: Math.cos(direction) * velocity,
        vy: Math.sin(direction) * velocity - 75, size: rand(3, 11) * power,
        color: pick(['#fff7b0', '#ffc257', '#f75e3e', '#36434b']),
        angle: rand(0, 6), life, maxLife: life });
    }
  }

  function drawExplosion() {
    if (!explosion || explosion.age > 1.3) return;
    const { x, y, age, power } = explosion;
    const ringRadius = (18 + age * 240) * power;
    const opacity = Math.max(0, 1 - age / .73);
    if (opacity > 0) {
      const flameRadius = (30 + age * 185) * power;
      const glow = ctx.createRadialGradient(x, y, 2, x, y, flameRadius);
      glow.addColorStop(0, `rgba(255,255,195,${opacity * .98})`);
      glow.addColorStop(.25, `rgba(255,214,73,${opacity * .82})`);
      glow.addColorStop(.66, `rgba(255,102,28,${opacity * .50})`);
      glow.addColorStop(1, 'rgba(255,69,25,0)');
      ctx.fillStyle = glow; ctx.beginPath(); ctx.arc(x, y, flameRadius, 0, Math.PI * 2); ctx.fill();
      ctx.strokeStyle = `rgba(255,235,155,${opacity * .9})`;
      ctx.lineWidth = Math.max(1, 8 * (1 - age / .73) * power);
      ctx.beginPath(); ctx.arc(x, y, ringRadius, 0, Math.PI * 2); ctx.stroke();
    }
  }

  function drawTrafficObject(o) {
    if (o.z < SCENE_NEAR_Z - 6 || o.z > MAX_Z + 75) return;
    if (o.type === 'coin') { drawCoin(o); return; }
    // Cars emerge through the same distant road haze as trees and lamps.
    // A spawn far beyond the old draw cutoff must NOT become fully opaque
    // the instant it enters the visible road. Both the horizon distance and
    // how far the vehicle has driven since spawning limit its opacity.
    const horizonFade = smoothTurn(clamp((MAX_Z + 75 - o.z) / 95, 0, 1));
    const spawnFade = smoothTurn(clamp((o.spawnZ - o.z) /
      (o.oncoming ? 38 : 28), 0, 1));
    const travelFade = Math.min(horizonFade, spawnFade);
    if (travelFade <= 0) return;
    ctx.save();
    ctx.globalAlpha = travelFade;
    drawCar(o.lane, o.z, o.color, false, o.kind, o.oncoming);
    ctx.restore();
  }

  function render(dt) {
    ctx.save();
    if (crashShake > 0) ctx.translate(rand(-1, 1) * crashShake, rand(-1, 1) * crashShake);
    drawBackground(); drawRoad(); drawRoadside();
    // Cosmetic underglow is part of the road surface, not a foreground effect.
    // Paint it before traffic so passing vehicles properly cover the light.
    drawPlayerGlow();
    const sorted = [...objects].sort((a, b) => b.z - a.z);
    for (const o of sorted) {
      // During rocket flight, floating pickups are drawn above road traffic
      // instead of disappearing beneath vehicles on the asphalt.
      if (coinFlightLift > .12 && o.type === 'coin') continue;
      // Far traffic belongs behind our car. A long truck's front body edge
      // determines whether it is actually nearer than the player.
      if (flightTime > 0 || !director.drawsOverPlayer(o, PLAYER_Z)) drawTrafficObject(o);
    }
    // Haze covers only distant scenery and vehicles. Nearby cars will paint
    // after the player so their grilles, roofs and trailers obscure it.
    drawDistanceHaze();
    if (coinFlightLift > .12) {
      for (const o of sorted) if (o.type === 'coin') drawTrafficObject(o);
    }
    if (flightTime > 0) {
      const foot = project(PLAYER_Z);
      const x = laneX(displayLane, PLAYER_Z);
      const radius = laneWidth(PLAYER_Z);
      const liftFactor = Math.min(1, (5 - flightTime) / .42, flightTime / .38);
      const lift = radius * .95 * clamp(liftFactor, 0, 1);
      // Ground shadow remains below the hovering car; the whole 3D model
      // rises as one object, with no collision against traffic below.
      ctx.save(); ctx.fillStyle = '#093c5b55'; ctx.beginPath();
      ctx.ellipse(x, foot.y, radius * .63, radius * .20, 0, 0, Math.PI * 2); ctx.fill();
      ctx.translate(0, -lift);
      // Two rear-mounted rockets propel the whole car. Exhaust draws behind
      // the car, so the boosters never cover the roof or the road obstacles.
      const rearZ = PLAYER_Z - VEHICLE_SHAPES.car.halfLength;
      const rearX = laneX(displayLane, rearZ);
      const rearY = project(rearZ).y;
      const rearWidth = laneWidth(rearZ);
      for (const side of [-1, 1]) {
        const jetX = rearX + side * rearWidth * .27;
        const jetY = rearY - rearWidth * .11;
        const flicker = 1 + .12 * Math.sin(clock * 39 + side * 3);
        const flameLength = rearWidth * (.48 + .18 * clamp(liftFactor, 0, 1)) * flicker;
        const glow = ctx.createRadialGradient(jetX, jetY + flameLength * .2, 1,
          jetX, jetY + flameLength * .2, flameLength * .83);
        glow.addColorStop(0, '#fff2a2c0'); glow.addColorStop(.38, '#ff9a3c8a'); glow.addColorStop(1, '#ff631000');
        ctx.fillStyle = glow;
        ctx.beginPath(); ctx.ellipse(jetX, jetY + flameLength * .23,
          rearWidth * .24, flameLength * .75, 0, 0, Math.PI * 2); ctx.fill();
        polygon([[jetX - rearWidth * .125, jetY], [jetX + rearWidth * .125, jetY],
          [jetX + rearWidth * .08, jetY + flameLength * .4],
          [jetX, jetY + flameLength], [jetX - rearWidth * .08, jetY + flameLength * .4]], '#ff702d');
        polygon([[jetX - rearWidth * .066, jetY], [jetX + rearWidth * .066, jetY],
          [jetX + rearWidth * .035, jetY + flameLength * .42],
          [jetX, jetY + flameLength * .77], [jetX - rearWidth * .035, jetY + flameLength * .42]], '#fff3a6');
        for (let spark = 0; spark < 3; spark++) {
          const travel = (clock * (2.5 + spark * .4) + spark * .31 + (side + 1) * .13) % 1;
          ctx.globalAlpha = (1 - travel) * .85;
          ctx.fillStyle = spark % 2 ? '#ffe28b' : '#ff9445';
          ctx.beginPath(); ctx.arc(jetX + Math.sin(clock * 14 + spark * 4) * rearWidth * .17,
            jetY + flameLength * (.33 + travel), Math.max(1, rearWidth * .017), 0, Math.PI * 2); ctx.fill();
        }
        for (let puff = 0; puff < 3; puff++) {
          const travel = (clock * 1.6 + puff / 3 + (side + 1) * .12) % 1;
          ctx.globalAlpha = (1 - travel) * .23;
          ctx.fillStyle = '#b1c2ca';
          ctx.beginPath(); ctx.arc(jetX + Math.sin(clock * 3 + puff * 5) * rearWidth * .17,
            jetY + flameLength * (.7 + travel * .6), rearWidth * (.05 + travel * .09), 0, Math.PI * 2); ctx.fill();
        }
        ctx.globalAlpha = 1;
      }
      drawCar(displayLane, PLAYER_Z, window.LaneRushProfile?.paintColor() || '#f3f8fa', true);
      for (const side of [-1, 1]) {
        const jetX = rearX + side * rearWidth * .27;
        const jetY = rearY - rearWidth * .11;
        ctx.fillStyle = '#263b4a';
        ctx.fillRect(jetX - rearWidth * .15, jetY - rearWidth * .15,
          rearWidth * .30, rearWidth * .21);
        ctx.fillStyle = '#e5edf1';
        ctx.fillRect(jetX - rearWidth * .11, jetY - rearWidth * .085,
          rearWidth * .22, rearWidth * .07);
      }
      ctx.restore();
    } else {
      drawCar(displayLane, PLAYER_Z, window.LaneRushProfile?.paintColor() || '#f3f8fa', true);
    }
    if (shieldTime > 0 && state === 'playing') {
      const p = project(PLAYER_Z), x = laneX(displayLane, PLAYER_Z);
      const radius = laneWidth(PLAYER_Z) * .76;
      ctx.strokeStyle = `rgba(94,250,227,${.35 + Math.sin(clock * 9) * .17})`;
      ctx.lineWidth = Math.max(2, radius * .038);
      ctx.beginPath(); ctx.ellipse(x, p.y - radius * .6, radius, radius * 1.15, 0, 0, Math.PI * 2); ctx.stroke();
    }
    if (flightTime <= 0) {
      for (const o of sorted) {
        if (director.drawsOverPlayer(o, PLAYER_Z)) drawTrafficObject(o);
      }
    }
    drawExplosion();
    drawParticles(dt);
    if (steeringFlash > 0) {
      ctx.fillStyle = `rgba(253,250,209,${steeringFlash * .065})`; ctx.fillRect(0, 0, w, h);
    }
    ctx.restore();
  }

  // The garage and home screen show real frames from this game's renderer.
  // These are crops of the actual road and the actual player car—not separate
  // cartoon illustrations that could disagree with the equipped body paint.
  let menuCaptureTick = 0;
  function captureMenuGameImages() {
    if (!ui.overlay.classList.contains('menu-open')) return;
    const carX = laneX(displayLane, PLAYER_Z);
    const carY = project(PLAYER_Z).y - laneWidth(PLAYER_Z) * .25;
    for (const [id, closeup] of [['hero-game-shot', false], ['garage-game-shot', true]]) {
      const destination = $(id);
      if (!destination) continue;
      const bounds = destination.getBoundingClientRect();
      if (bounds.width < 10 || bounds.height < 10) continue;
      const scale = Math.min(window.devicePixelRatio || 1, 1.5);
      const pixelW = Math.round(bounds.width * scale);
      const pixelH = Math.round(bounds.height * scale);
      if (destination.width !== pixelW || destination.height !== pixelH) {
        destination.width = pixelW;
        destination.height = pixelH;
      }
      const dest = destination.getContext('2d');
      const aspect = pixelW / pixelH;
      let cropH = Math.min(h, Math.max(laneWidth(PLAYER_Z) * (closeup ? 2.15 : 2.6), h * (closeup ? .26 : .57)));
      let cropW = cropH * aspect;
      if (cropW > w) { cropW = w; cropH = cropW / aspect; }
      const cropX = clamp(carX - cropW * (closeup ? .5 : .55), 0, w - cropW);
      const cropY = clamp(carY - cropH * (closeup ? .60 : .70), 0, h - cropH);
      dest.imageSmoothingEnabled = true;
      dest.imageSmoothingQuality = 'high';
      dest.clearRect(0, 0, pixelW, pixelH);
      dest.drawImage(canvas, cropX * dpr, cropY * dpr, cropW * dpr, cropH * dpr,
        0, 0, pixelW, pixelH);
    }
  }

  function drawPlayerGlow() {
    const glow = window.LaneRushProfile?.glowColor();
    if (!glow) return;
    const center = laneX(displayLane, PLAYER_Z);
    const p = project(PLAYER_Z);
    const radius = laneWidth(PLAYER_Z) * .88;
    ctx.save();
    const gradient = ctx.createRadialGradient(center, p.y - radius * .12, radius * .1,
      center, p.y - radius * .12, radius * 1.27);
    gradient.addColorStop(0, `${glow}bf`);
    gradient.addColorStop(.5, `${glow}83`);
    gradient.addColorStop(1, `${glow}00`);
    ctx.fillStyle = gradient;
    ctx.beginPath();
    ctx.ellipse(center, p.y - radius * .10, radius * 1.27, radius * .58, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }

  function trafficCandidate(lane, desiredZ, existingTraffic) {
    // Compute candidates without changing the world. A rejected unsafe wave
    // must never move an already-visible car or delete existing coins.
    let z = desiredZ;
    const existing = existingTraffic.filter((o) => o.lane === lane)
      .map((o) => o.z).sort((a, b) => a - b);
    for (const otherZ of existing) {
      if (Math.abs(z - otherZ) < TRAFFIC_GAP + 7) z = otherZ + TRAFFIC_GAP + 7;
    }
    const traffic = pick(TRAFFIC);
    const kind = pick(TRAFFIC_MODELS);
    const shape = vehicleShape(kind);
    const candidate = { type: 'car', lane, z, spawnZ: z, color: traffic.color,
      trafficSpeed: traffic.speed, currentSpeed: traffic.speed, oncoming: lane < 2,
      kind, halfWidth: shape.halfWidth + shape.tireOutset, halfLength: shape.halfLength };
    // Keep newly spawned cars from plowing through an existing coin trail.
    if (objects.some((coin) => coin.type === 'coin' && coin.lane === lane &&
      coinWillOverlapTraffic(coin, [candidate]))) return null;
    return candidate;
  }

  function playerPlan() {
    return steering.plan();
  }

  function rewardedAdReady() {
    // The current revive screen contains a demo ad. When a real ad provider
    // is connected, use its readiness flag instead of guessing ad value.
    const readiness = window.LaneRushAds?.isRewardedReady;
    if (typeof readiness === 'function') {
      try { return Boolean(readiness()); } catch (_) { return false; }
    }
    return !revivesUsed; // Demo rewarded slot is ready once per run.
  }

  function offerCoinTrail(traffic, risk) {
    const laneOrder = [0, 1, 2, 3].map((lane) => ({ lane, order: Math.random() }))
      .sort((a, b) => Math.abs(a.lane - targetLane) - Math.abs(b.lane - targetLane) || a.order - b.order)
      .map((item) => item.lane);
    // An ad-ready risk trail stops shortly before a real car arrives in that
    // lane. The player may abandon it and take the verified escape route.
    // Coins never sit inside car silhouettes or get awarded on collision.
    if (risk) {
      for (const car of traffic.sort((a, b) => a.z - b.z)) {
        const closing = car.oncoming ? speed + car.currentSpeed : Math.max(8, speed - car.currentSpeed);
        const dangerTime = (car.z - PLAYER_Z) / closing;
        if (dangerTime < 1.6 || dangerTime > 3.7) continue;
        const trail = [.97, .65, .34].map((lead) => ({
          lane: car.lane, z: PLAYER_Z + speed * (dangerTime - lead)
        }));
        if (trail.some((coin) => coin.z < 32 || coinWillOverlapTraffic(coin, traffic))) continue;
        const nearby = objects.some((coin) => coin.type === 'coin' && coin.lane === car.lane &&
          trail.some((item) => Math.abs(coin.z - item.z) < 9));
        if (nearby) continue;
        for (const coin of trail) objects.push({ type: 'coin', ...coin, phase: rand(0, 7) });
        return;
      }
    }

    // Normal play places easy-to-collect trails, favoring lanes near the player.
    // Try multiple locations before giving up so trails do not vanish.
    const preferred = waveIndex % 2 === 0 ? [2, 3] : [0, 1];
    const lanes = risk ? [...preferred, ...laneOrder] : [...laneOrder, ...preferred];
    let spawned = false;
    for (const length of [4, 3, 2]) {
      if (spawned) break;
      for (const baseZ of [61, 81, 104, 45, 122]) {
        if (spawned) break;
        for (const lane of lanes) {
          const trail = Array.from({ length }, (_, i) => ({ lane, z: baseZ + i * 11 }));
          const nearCoin = objects.some((o) => o.type === 'coin' && o.lane === lane &&
            trail.some((coin) => Math.abs(o.z - coin.z) < 10));
          if (nearCoin || trail.some((coin) => coinWillOverlapTraffic(coin, traffic))) continue;
          for (const coin of trail) objects.push({ type: 'coin', ...coin, phase: rand(0, 7) });
          spawned = true;
          break;
        }
      }
    }
  }

  function offerFlightCoin(traffic) {
    if (waveIndex < nextFlightWave || flightTime > 0 ||
      objects.some((coin) => coin.type === 'coin' && coin.powerUp === 'flight')) return;
    const lanes = [targetLane, ...[0, 1, 2, 3].filter((lane) => lane !== targetLane)];
    for (const lane of lanes) {
      const candidate = { type: 'coin', powerUp: 'flight', lane, z: rand(92, 119), phase: rand(0, 7) };
      if (coinWillOverlapTraffic(candidate, traffic)) continue;
      if (objects.some((coin) => coin.type === 'coin' && coin.lane === lane &&
        Math.abs(coin.z - candidate.z) < 13)) continue;
      objects.push(candidate);
      nextFlightWave = waveIndex + Math.round(rand(14, 23));
      return;
    }
  }

  function offerScoreBonus(traffic) {
    if (!scorePowerups.shouldSpawn() ||
      objects.some((coin) => coin.type === 'coin' && coin.powerUp === 'score')) return;
    const lanes = [targetLane, ...[0, 1, 2, 3].filter((lane) => lane !== targetLane)
      .sort(() => Math.random() - .5)];
    for (const z of [rand(91, 111), rand(114, 134), rand(75, 89)]) {
      for (const lane of lanes) {
        const candidate = { type: 'coin', powerUp: 'score', lane, z,
          phase: rand(0, 7) };
        if (coinWillOverlapTraffic(candidate, traffic)) continue;
        if (objects.some((coin) => coin.type === 'coin' && coin.lane === lane &&
          Math.abs(coin.z - z) < 17)) continue;
        const bonus = scorePowerups.pickBonus();
        objects.push({ ...candidate, scoreBonus: bonus.points, rarity: bonus.rarity });
        return;
      }
    }
  }

  function spawnWave(level) {
    const existing = objects.filter((o) => o.type === 'car');
    // The director samples several genuinely different formations, then
    // randomly chooses a reachable one within the record-based difficulty.
    // A difficult pattern can never override the player's available escape.
    const wave = director.chooseWave(existing, speed, playerPlan(), level,
      (lane, z, proposed) => trafficCandidate(lane, z, proposed));
    objects.push(...wave);
    waveIndex++;
    // A demo or real rewarded ad can enable tempting high-risk trails, but
    // obstacle planning is independent of ads and always keeps an escape.
    offerCoinTrail([...existing, ...wave], rewardedAdReady() && Math.random() < .37 && score > 700);
    offerFlightCoin([...existing, ...wave]);
    offerScoreBonus([...existing, ...wave]);
  }

  function organizeTraffic() {
    const lanes = Array.from({ length: LANE_COUNT }, () => []);
    for (const o of objects) if (o.type === 'car') lanes[o.lane].push(o);
    for (let lane = 0; lane < LANE_COUNT; lane++) {
      // Opposite-direction traffic leads at smaller z; forward traffic leads at larger z.
      lanes[lane].sort(lane < 2 ? (a, b) => a.z - b.z : (a, b) => b.z - a.z);
    }
    return lanes;
  }

  function updateFollowingSpeeds(lanes, dt) {
    for (const lane of lanes) {
      for (let i = 0; i < lane.length; i++) {
        const car = lane[i], leader = lane[i - 1];
        const gap = leader ? Math.abs(leader.z - car.z) : Infinity;
        const desired = leader && gap < FOLLOW_DISTANCE
          ? Math.min(car.trafficSpeed, leader.currentSpeed) : car.trafficSpeed;
        car.currentSpeed = lerp(car.currentSpeed, desired, clamp(dt * (gap < TRAFFIC_GAP + 5 ? 20 : 5), 0, 1));
        if (leader && gap < TRAFFIC_GAP + 5) {
          car.currentSpeed = Math.min(car.currentSpeed, leader.currentSpeed);
        }
      }
    }
  }

  function keepTrafficSeparated(lanes) {
    for (let laneIndex = 0; laneIndex < lanes.length; laneIndex++) {
      const cars = lanes[laneIndex];
      for (let i = 1; i < cars.length; i++) {
        const leader = cars[i - 1], follower = cars[i];
        if (laneIndex < 2) {
          follower.z = Math.max(follower.z, leader.z + TRAFFIC_GAP);
        } else {
          follower.z = Math.min(follower.z, leader.z - TRAFFIC_GAP);
        }
      }
    }
  }

  function overlapTimeWindow(start, end, halfSize) {
    const distance = end - start;
    if (Math.abs(distance) < 1e-7) return Math.abs(start) <= halfSize ? [0, 1] : null;
    const enters = (-halfSize - start) / distance;
    const exits = (halfSize - start) / distance;
    return [Math.min(enters, exits), Math.max(enters, exits)];
  }

  function carContactTime(car, previousPlayerLane, nextPlayerLane) {
    const playerShape = VEHICLE_SHAPES.car;
    const trafficShape = vehicleShape(car.kind);
    // Swept rectangle intersection: find the *first* moment the car bodies
    // meet, rather than detecting their overlap after both have moved.
    const totalHalfLength = playerShape.halfLength + trafficShape.halfLength + .10;
    const totalHalfWidth = (playerShape.halfWidth + playerShape.tireOutset +
      trafficShape.halfWidth + trafficShape.tireOutset) / 3 + .012;
    const longitudinal = overlapTimeWindow(car.previousZ - PLAYER_Z, car.z - PLAYER_Z, totalHalfLength);
    const lateral = overlapTimeWindow(previousPlayerLane - car.lane, nextPlayerLane - car.lane, totalHalfWidth);
    if (!longitudinal || !lateral) return null;
    const entry = Math.max(0, longitudinal[0], lateral[0]);
    const exit = Math.min(1, longitudinal[1], lateral[1]);
    if (entry > exit) return null;
    // Even a front-corner hit needs side clearance if the player is steering
    // into this car from a neighboring lane during the contact frame.
    const enteringFromSide = Math.abs(previousPlayerLane - car.lane) > totalHalfWidth &&
      Math.abs(nextPlayerLane - car.lane) < Math.abs(previousPlayerLane - car.lane);
    return { time: entry, enteringFromSide, sideEdge: totalHalfWidth + .045 };
  }

  function laneOutsideCarSide(car, approachSide, minimumDistance) {
    const trafficShape = vehicleShape(car.kind);
    const traffic = projectedCarBounds(car.lane, car.z, trafficShape);
    const clearance = Math.max(3, Math.min(6, laneWidth(PLAYER_Z) * .025));
    const visiblyClear = (distance) => {
      const player = projectedCarBounds(car.lane + approachSide * distance, PLAYER_Z, VEHICLE_SHAPES.car);
      return approachSide > 0 ? player.left >= traffic.right + clearance
        : player.right <= traffic.left - clearance;
    };
    if (visiblyClear(minimumDistance)) return car.lane + approachSide * minimumDistance;
    let low = minimumDistance, high = Math.max(1.2, low + .25);
    while (!visiblyClear(high) && high < 4) high += .4;
    // Find the nearest lane position where the *rendered* outlines do not cross.
    for (let i = 0; i < 24; i++) {
      const middle = (low + high) / 2;
      if (visiblyClear(middle)) high = middle;
      else low = middle;
    }
    return car.lane + approachSide * high;
  }

  function update(dt, visibleElapsed) {
    clock += dt;
    if (explosion) explosion.age += dt;
    if (toastTimer > 0) { toastTimer -= dt; if (toastTimer <= 0) ui.toast.classList.remove('show'); }
    crashShake = Math.max(0, crashShake - dt * 22);
    steeringFlash = Math.max(0, steeringFlash - dt * 4);
    if (state === 'ad') {
      if (!document.hidden) adRemaining = Math.max(0, adRemaining - visibleElapsed);
      ui.adCount.textContent = `${Math.ceil(adRemaining)}s`;
      const secondsLeft = Math.ceil(adRemaining);
      ui.adMessage.textContent = adRemaining > 0 ? `${secondsLeft} ${secondsLeft === 1 ? 'second' : 'seconds'} remaining` : 'Ad completed!';
      ui.adProgress.style.width = `${100 * (1 - adRemaining / DEMO_AD_SECONDS)}%`;
      if (adRemaining <= 0) finishReviveAd();
      return;
    }
    if (state !== 'playing') {
      if (state === 'ready') {
        meters += dt * 1.5; // slow scenery on the title screen
      }
      // During a crash or pause, leave the white car at its exact contact
      // position. Finishing the lane change here made it slide into/through
      // other cars while the explosion stayed at the original impact point.
      return;
    }
    shieldTime = Math.max(0, shieldTime - dt);
    const wasFlying = flightTime > 0;
    flightTime = Math.max(0, flightTime - dt);
    coinFlightLift = lerp(coinFlightLift, flightTime > 0 ? 1 : 0, clamp(dt * 6, 0, 1));
    // Increase road speed steadily with active playing time. High score
    // changes traffic placement/density only, not this acceleration rate.
    runElapsed += dt;
    speed = director.speedForTime(runElapsed);
    const advance = speed * dt;
    meters += advance;
    score = Math.floor(meters * .8) + coins * 25 + bonusScore;
    const targetPressure = director.difficulty(score, difficultyReference).progress;
    trafficRamp = Math.min(targetPressure, trafficRamp + dt * .075);
    const trafficLevel = director.difficulty(score, difficultyReference, trafficRamp);
    const previousPlayerLane = displayLane;
    ({ display: displayLane, target: targetLane } = steering.advance(dt));
    spawnTimer -= dt;
    if (spawnTimer <= 0) {
      spawnWave(trafficLevel);
      spawnTimer = trafficLevel.waveInterval * rand(.86, 1.13);
    }
    const trafficLanes = organizeTraffic();
    updateFollowingSpeeds(trafficLanes, dt);
    for (const o of objects) {
      o.previousZ = o.z;
      const closingSpeed = o.type === 'coin' ? speed
        : o.oncoming ? speed + o.currentSpeed : Math.max(8, speed - o.currentSpeed);
      o.z -= closingSpeed * dt;
    }
    keepTrafficSeparated(trafficLanes);
    // Spawning a safe wave is not enough: following traffic can later slow
    // down, and the player's real steering position keeps changing. Audit the
    // moving world several times a second. Retire only cars that turn the
    // remaining road into an impossible puzzle; normal dodgeable traffic stays.
    // Run after EVERY world step so no newly updated traffic arrangement can
    // survive even one game frame without a reachable way through.
    if (flightTime <= 0 && shieldTime <= 0) {
      const cars = objects.filter((item) => item.type === 'car');
      const deadEndCars = director.repairRoute(cars, speed, playerPlan(), trafficLevel.minOpen);
      if (deadEndCars.length) {
        const yielding = new Set(deadEndCars);
        objects = objects.filter((item) => !yielding.has(item));
      }
    }
    removeCoveredCoins();
    if (wasFlying && flightTime <= 0 && !director.clearAt(displayLane, 0,
      objects.filter((o) => o.type === 'car'), speed)) {
      // Only delay touchdown while the landing space is occupied. No surprise
      // collision with a car hiding directly beneath the airborne player.
      flightTime = .12;
    }
    ui.flight.hidden = flightTime <= 0;
    ui.flight.classList.toggle('landing', flightTime > 0 && flightTime <= 2);
    ui.flightSeconds.textContent = `${flightTime.toFixed(1)}s`;
    if (flightTime > 0 && flightTime <= 2) {
      const warningSecond = Math.ceil(flightTime);
      if (warningSecond !== lastLandingWarning) {
        lastLandingWarning = warningSecond;
        showToast(`LANDING IN ${warningSecond}`);
        playSound('warning');
      }
    }
    let firstCrash = null;
    let firstCrashTime = Infinity;
    let firstCrashContact = null;
    for (let i = objects.length - 1; i >= 0; i--) {
      const o = objects[i];
      const playerTouch = o.type === 'coin' && coinTouchesPlayer(o);
      if (o.type === 'coin' && Math.abs(displayLane - o.lane) < .32 &&
        ((o.previousZ >= PLAYER_Z && o.z <= PLAYER_Z + 2.2) || (o.z >= PLAYER_Z && playerTouch))) {
        if (o.powerUp === 'score') {
          bonusScore += o.scoreBonus;
          const bonus = scorePowerups.BONUS_TYPES.find((item) => item.points === o.scoreBonus);
          const p = project(PLAYER_Z);
          burst(laneX(displayLane, PLAYER_Z), p.y - laneWidth(PLAYER_Z) * 1.05,
            bonus?.glow || '#f8ec85', o.scoreBonus === 5000 ? 28 : 17);
          showToast(`${o.rarity} +${o.scoreBonus.toLocaleString()} SCORE!`);
          playSound('coin');
          objects.splice(i, 1);
          continue;
        }
        coins++;
        coinChain++;
        window.LaneRushProfile?.addRunCoin();
        const p = project(PLAYER_Z);
        burst(laneX(displayLane, PLAYER_Z), p.y - laneWidth(PLAYER_Z) * .35,
          o.powerUp === 'flight' ? '#6cf3ff' : '#ffd54a', 12);
        playSound('coin');
        if (o.powerUp === 'flight') {
          flightTime = 5;
          lastLandingWarning = -1;
          showToast('FLIGHT! 5 SECONDS');
        } else if (coinChain % 5 === 0) {
          coins += 2;
          window.LaneRushProfile?.addRunCoin();
          window.LaneRushProfile?.addRunCoin();
          showToast('+2 COIN COMBO!');
        } else showToast('+25 ✦');
        objects.splice(i, 1);
        continue;
      }
      // A coin in another lane that visibly passes behind the white car
      // should leave the scene instead of being drawn inside its body.
      if (o.type === 'coin' && Math.abs(displayLane - o.lane) < .32 && playerTouch) {
        objects.splice(i, 1); continue;
      }
      if (o.type === 'car') {
        const contact = carContactTime(o, previousPlayerLane, displayLane);
        if (contact !== null && flightTime <= 0) {
          if (shieldTime > 0) {
            objects.splice(i, 1);
            continue;
          }
          if (contact.time < firstCrashTime) {
            firstCrash = o;
            firstCrashTime = contact.time;
            firstCrashContact = contact;
          }
        } else if (o.previousZ >= PLAYER_Z && o.z < PLAYER_Z &&
          Math.abs(displayLane - o.lane) > .87 && Math.abs(displayLane - o.lane) < 1.26 &&
          flightTime <= 0 && shieldTime <= 0) {
          nearMissStreak = clock - lastNearMissAt <= 8 ? Math.min(3, nearMissStreak + 1) : 1;
          lastNearMissAt = clock;
          const reward = 50 * nearMissStreak;
          bonusScore += reward;
          showToast(`NEAR MISS +${reward} · ${nearMissStreak}×`);
        }
      }
      if (o.type === 'coin' && !o.powerUp && o.previousZ >= PLAYER_Z - 4 && o.z < PLAYER_Z - 4) {
        // Missing a coin breaks the collector chain; collecting five in a row
        // awards two actual wallet coins, not merely visual score.
        coinChain = 0;
      }
      // Visible cars have real front/rear depth; keep them until every panel
      // passes below the screen rather than removing their roofs mid-exit.
      if (o.z < (o.type === 'car' ? SCENE_NEAR_Z - 6 : -9)) objects.splice(i, 1);
    }
    score = Math.floor(meters * .8) + coins * 25 + bonusScore;
    if (firstCrash) {
      // Freeze both cars exactly where their bumpers/sides first touch.
      // Otherwise the crash frame can show one car embedded in the other.
      firstCrash.z = lerp(firstCrash.previousZ, firstCrash.z, firstCrashTime);
      displayLane = lerp(previousPlayerLane, displayLane, firstCrashTime);
      if (firstCrashContact.enteringFromSide) {
        // The world hitbox is not enough in perspective: visibly separate the
        // two projected car silhouettes, touching at the side edge, not inside.
        const approachSide = Math.sign(previousPlayerLane - firstCrash.lane);
        displayLane = laneOutsideCarSide(firstCrash, approachSide, firstCrashContact.sideEdge);
      }
      endGame(firstCrash);
    }
    ui.score.textContent = score.toLocaleString();
    ui.coins.textContent = coins;
    ui.speed.textContent = Math.round(speed * 2.25);
  }

  function frame(now) {
    const elapsed = (now - (lastTime || now)) / 1000;
    const dt = Math.min(.034, elapsed);
    lastTime = now;
    update(dt, Math.min(1, elapsed));
    updateEngineAudio();
    render(dt);
    if (state === 'ready' && ++menuCaptureTick % 5 === 0) captureMenuGameImages();
    requestAnimationFrame(frame);
  }

  function showToast(message) {
    ui.toast.textContent = message; ui.toast.classList.add('show'); toastTimer = .65;
  }
  function ensureAudio() {
    if (!soundOn) return false;
    try {
      if (!audioContext) {
        const Context = window.AudioContext || window.webkitAudioContext;
        if (!Context) return false;
        audioContext = new Context();
        engineVolume = audioContext.createGain();
        engineVolume.gain.value = 0;
        engineFilter = audioContext.createBiquadFilter();
        engineFilter.type = 'lowpass'; engineFilter.frequency.value = 240;
        engineFilter.connect(engineVolume);
        engineVolume.connect(audioContext.destination);
        engineOscillator = audioContext.createOscillator();
        engineOscillator.type = 'sawtooth'; engineOscillator.frequency.value = 64;
        engineHarmonic = audioContext.createOscillator();
        engineHarmonic.type = 'triangle'; engineHarmonic.frequency.value = 102;
        const sub = audioContext.createGain(); sub.gain.value = .4;
        engineOscillator.connect(engineFilter);
        engineHarmonic.connect(sub); sub.connect(engineFilter);
        engineOscillator.start(); engineHarmonic.start();
      }
      if (audioContext.state === 'suspended') audioContext.resume().catch(() => {});
      return true;
    } catch (_) { return false; }
  }

  function updateEngineAudio() {
    if (!audioContext || !engineVolume) return;
    const t = audioContext.currentTime;
    const active = soundOn && state === 'playing';
    const pitch = 56 + speed * 1.25;
    engineOscillator.frequency.setTargetAtTime(pitch, t, .12);
    engineHarmonic.frequency.setTargetAtTime(pitch * 1.55, t, .12);
    engineFilter.frequency.setTargetAtTime(175 + speed * 3.5, t, .12);
    engineVolume.gain.setTargetAtTime(active ? .018 : 0, t, .13);
  }

  function playSound(kind) {
    if (!ensureAudio()) return;
    const t = audioContext.currentTime;
    const settings = {
      start: [[280, 430, .12, 0], [430, 620, .16, .10]],
      coin: [[710, 930, .11, 0], [980, 1350, .16, .07]],
      warning: [[880, 680, .11, 0], [760, 590, .12, .15]],
      turn: [[500, 290, .13, 0]],
      crash: [[210, 65, .38, 0], [105, 45, .43, .04]],
      explosion: [[190, 38, .74, 0], [92, 27, .86, .065], [310, 60, .32, .05]]
    }[kind] || [];
    for (const [first, last, duration, delay] of settings) {
      const osc = audioContext.createOscillator();
      const gain = audioContext.createGain();
      const start = t + delay;
      osc.type = kind === 'crash' || kind === 'explosion' ? 'sawtooth' : kind === 'turn' ? 'triangle' : 'sine';
      osc.frequency.setValueAtTime(first, start);
      osc.frequency.exponentialRampToValueAtTime(last, start + duration);
      gain.gain.setValueAtTime(.0001, start);
      gain.gain.exponentialRampToValueAtTime(kind === 'explosion' ? .16 : kind === 'crash' ? .11 : kind === 'coin' ? .065 : .038, start + .018);
      gain.gain.exponentialRampToValueAtTime(.0001, start + duration);
      osc.connect(gain); gain.connect(audioContext.destination);
      osc.start(start); osc.stop(start + duration + .015);
    }
    if (kind === 'crash' || kind === 'explosion') {
      // A short burst of filtered noise adds impact to the low collision thud.
      const noiseDuration = kind === 'explosion' ? .65 : .25;
      const length = Math.floor(audioContext.sampleRate * noiseDuration);
      const buffer = audioContext.createBuffer(1, length, audioContext.sampleRate);
      const samples = buffer.getChannelData(0);
      for (let i = 0; i < length; i++) samples[i] = (Math.random() * 2 - 1) * (1 - i / length);
      const noise = audioContext.createBufferSource(); noise.buffer = buffer;
      const filter = audioContext.createBiquadFilter(); filter.type = 'lowpass'; filter.frequency.value = kind === 'explosion' ? 780 : 440;
      const volume = audioContext.createGain(); volume.gain.value = kind === 'explosion' ? .16 : .11;
      noise.connect(filter); filter.connect(volume); volume.connect(audioContext.destination);
      noise.start(t); noise.stop(t + noiseDuration);
    }
  }

  function updateSoundButton() {
    ui.sound.setAttribute('aria-label', soundOn ? 'Turn sound off' : 'Turn sound on');
    ui.sound.setAttribute('aria-pressed', String(soundOn));
    ui.soundIcon.innerHTML = soundOn
      ? '<path d="M11 5 6 9H3v6h3l5 4V5Z"/><path d="M15.5 8.5a5 5 0 0 1 0 7"/><path d="M18.5 5.5a9 9 0 0 1 0 13"/>'
      : '<path d="M11 5 6 9H3v6h3l5 4V5Z"/><path d="m16 9 5 6m0-6-5 6"/>';
  }

  function setOverlay(mode) {
    if (mode === 'ready') window.LaneRushMenu?.show('home');
    else window.LaneRushMenu?.hide();
    ui.returnMenu.hidden = mode === 'ready';
    ui.results.hidden = mode !== 'over';
    ui.reviveOption.hidden = mode !== 'over' || revivesUsed;
    ui.modal.classList.toggle('after-run', mode === 'over');
    if (mode === 'ready') {
      ui.title.innerHTML = 'SWERVE<br><span>BOUND!</span>';
      ui.subtitle.innerHTML = 'Two-way traffic. Different speeds.<br>Dodge cars, grab coins, and keep driving!';
      ui.play.innerHTML = 'START DRIVING <span>➜</span>';
    } else if (mode === 'paused') {
      ui.title.innerHTML = 'TAKE A <span>BREAK!</span>';
      ui.subtitle.innerHTML = 'Catch your breath. The highway can wait.';
      ui.play.innerHTML = 'KEEP DRIVING <span>➜</span>';
    } else if (mode === 'over') {
      ui.title.innerHTML = 'NICE <span>RUN!</span>';
      ui.subtitle.innerHTML = lastCrashWasHeadOn
        ? 'Head-on crash! The engine exploded.<br>Ready for another drive?'
        : 'Traffic got you this time. Ready for another shot?';
      ui.finalScore.textContent = score.toLocaleString();
      ui.finalBest.textContent = highScore.toLocaleString();
      ui.play.innerHTML = 'TRY AGAIN <span>➜</span>';
    }
    ui.overlay.classList.remove('hidden');
  }

  function startGame() {
    if (state === 'ad') return;
    if (state === 'paused') {
      state = 'playing'; window.LaneRushMenu?.hide(); ui.overlay.classList.add('hidden'); ensureAudio(); playSound('start'); return;
    }
    objects = []; particles = []; explosion = null; lastCrashWasHeadOn = false;
    revivesUsed = false; shieldTime = 0;
    waveIndex = 0;
    difficultyReference = Math.max(2000, highScore);
    trafficRamp = 0;
    bonusScore = 0; coinChain = 0; nearMissStreak = 0; lastNearMissAt = -100;
    flightTime = 0; coinFlightLift = 0; nextFlightWave = 9;
    lastLandingWarning = -1; ui.flight.hidden = true;
    targetLane = 2; displayLane = 2;
    steering.reset(2);
    meters = 0; speed = 32; score = 0; coins = 0; clock = 0; runElapsed = 0;
    spawnTimer = .6; crashShake = 0;
    ui.score.textContent = '0'; ui.coins.textContent = '0'; ui.speed.textContent = '72';
    window.LaneRushMenu?.hide(); ui.overlay.classList.add('hidden'); state = 'playing';
    ui.help.style.opacity = '1';
    window.setTimeout(() => { ui.help.style.opacity = '.45'; }, 5000);
    playSound('start');
  }
  function endGame(hit) {
    const headOn = Boolean(hit?.oncoming);
    lastCrashWasHeadOn = headOn;
    nearMissStreak = 0; coinChain = 0;
    state = 'crashing'; crashShake = headOn ? 24 : 11; steeringFlash = headOn ? 1.8 : .8;
    engineExplosion(headOn, hit);
    playSound(headOn ? 'explosion' : 'crash');
    if (headOn && navigator.vibrate) navigator.vibrate([90, 45, 120]);
    if (score > highScore) {
      highScore = score;
      try { localStorage.setItem('laneRushBest', String(highScore)); } catch (_) { /* Private browsing */ }
      ui.best.textContent = highScore.toLocaleString();
    }
    window.setTimeout(() => {
      if (state !== 'crashing') return;
      state = 'over';
      setOverlay('over');
    }, headOn ? 1100 : 750);
  }

  function startReviveAd() {
    if (state !== 'over' || revivesUsed) return;
    // This is a clearly labeled demo slot until a real rewarded-ad provider is configured.
    adRemaining = DEMO_AD_SECONDS;
    ui.adCount.textContent = `${DEMO_AD_SECONDS}s`;
    ui.adMessage.textContent = `${DEMO_AD_SECONDS} seconds remaining`;
    ui.adProgress.style.width = '0%';
    state = 'ad';
    ui.adScreen.hidden = false;
  }

  function cancelReviveAd() {
    if (state !== 'ad') return;
    state = 'over';
    ui.adScreen.hidden = true;
    setOverlay('over');
  }

  function finishReviveAd() {
    if (state !== 'ad' || adRemaining > 0 || revivesUsed) return;
    revivesUsed = true;
    ui.adScreen.hidden = true;
    ui.overlay.classList.add('hidden');
    // Rejoin the run at the previous score with room to react to fresh traffic.
    objects = objects.filter((o) => o.z > PLAYER_Z + 55);
    particles = []; explosion = null; crashShake = 0; steeringFlash = 0;
    spawnTimer = 1.0;
    shieldTime = 2.8;
    state = 'playing';
    showToast('REVIVED!');
    playSound('start');
  }
  function shiftLane(direction) {
    if (state !== 'playing') return;
    if (steering.request(direction)) targetLane = steering.target;
  }
  function pauseGame() {
    if (state === 'playing') { state = 'paused'; setOverlay('paused'); }
    else if (state === 'paused') startGame();
  }

  function goHome() {
    if (state === 'ad') return;
    if (score > highScore) {
      highScore = score;
      try { localStorage.setItem('laneRushBest', String(highScore)); } catch (_) { /* Private browsing */ }
      ui.best.textContent = highScore.toLocaleString();
    }
    objects = []; particles = []; explosion = null;
    targetLane = 2; displayLane = 2; shieldTime = 0; crashShake = 0;
    steering.reset(2);
    flightTime = 0; coinFlightLift = 0; ui.flight.hidden = true;
    state = 'ready';
    setOverlay('ready');
  }

  ui.play.addEventListener('click', startGame);
  ui.returnMenu.addEventListener('click', goHome);
  ui.reviveButton.addEventListener('click', startReviveAd);
  ui.adCancel.addEventListener('click', cancelReviveAd);
  ui.pause.addEventListener('click', pauseGame);
  $('left-btn').addEventListener('click', () => shiftLane(-1));
  $('right-btn').addEventListener('click', () => shiftLane(1));
  ui.sound.addEventListener('click', () => {
    soundOn = !soundOn;
    try { localStorage.setItem('laneRushSound', soundOn ? 'on' : 'off'); } catch (_) { /* Private browsing */ }
    updateSoundButton();
    if (soundOn) { ensureAudio(); playSound('start'); }
  });
  document.addEventListener('keydown', (event) => {
    if (state === 'ad') return;
    if (['ArrowLeft', 'ArrowRight', ' ', 'ArrowUp', 'KeyA', 'KeyD'].includes(event.code)) event.preventDefault();
    if (event.repeat) return;
    if (event.code === 'ArrowLeft' || event.code === 'KeyA') shiftLane(-1);
    if (event.code === 'ArrowRight' || event.code === 'KeyD') shiftLane(1);
    if (event.code === 'Escape' || event.code === 'KeyP') pauseGame();
    if (event.code === 'Space' && state !== 'playing' && state !== 'ready') startGame();
  });
  let startPointer = null;
  canvas.addEventListener('pointerdown', (event) => {
    if (!event.isPrimary || startPointer || state !== 'playing') return;
    startPointer = { x: event.clientX, y: event.clientY, id: event.pointerId };
    if (canvas.setPointerCapture) canvas.setPointerCapture(event.pointerId);
  });
  canvas.addEventListener('pointerup', (event) => {
    if (!startPointer || startPointer.id !== event.pointerId) return;
    event.preventDefault(); // Prevent synthetic touch-to-click duplicates.
    const diff = event.clientX - startPointer.x;
    const vertical = event.clientY - startPointer.y;
    if (Math.abs(diff) > 28 && Math.abs(diff) > Math.abs(vertical) * .8) shiftLane(diff < 0 ? -1 : 1);
    else if (Math.abs(diff) < 22 && Math.abs(vertical) < 30) shiftLane(event.clientX < canvas.getBoundingClientRect().left + w / 2 ? -1 : 1);
    startPointer = null;
  });
  canvas.addEventListener('pointercancel', () => { startPointer = null; });
  document.addEventListener('visibilitychange', () => {
    if (document.hidden && state === 'playing') pauseGame();
  });
  window.addEventListener('resize', resize);
  resize(); updateSoundButton(); setOverlay('ready'); requestAnimationFrame(frame);
})();
