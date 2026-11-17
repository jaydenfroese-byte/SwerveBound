(() => {
  'use strict';

  const $ = (id) => document.getElementById(id);
  const SAVE_KEY = 'laneRushProfileV1';
  const PAINTS = [
    { id: 'white', name: 'Polar White', detail: 'Clean factory finish', color: '#f3f8fa', price: 0 },
    { id: 'coral', name: 'Hot Coral', detail: 'Street-racer red', color: '#ff6b72', price: 25 },
    { id: 'aqua', name: 'Aqua Rush', detail: 'Electric ocean blue', color: '#36d7e2', price: 60 },
    { id: 'violet', name: 'Night Violet', detail: 'Deep purple gloss', color: '#a687ff', price: 90 },
    { id: 'midnight', name: 'Midnight', detail: 'Blackout paint', color: '#273948', price: 120 },
    { id: 'gold', name: 'Golden Hour', detail: 'Gold metallic', color: '#f4c957', price: 180 }
  ];
  const GLOWS = [
    { id: 'none', name: 'Stock', detail: 'No underglow', color: null, price: 0 },
    { id: 'mint', name: 'Neon Mint', detail: 'Aqua road glow', color: '#39f7d5', price: 65 },
    { id: 'amber', name: 'Solar Flash', detail: 'Bright golden glow', color: '#ffce58', price: 85 },
    { id: 'magenta', name: 'After Dark', detail: 'Violet-pink glow', color: '#ed77ff', price: 110 }
  ];
  const DAILY_COINS = [30, 40, 55, 70, 90, 120, 200];
  const defaults = {
    balance: 0, totalCoins: 0,
    ownedPaints: ['white'], ownedGlows: ['none'],
    equippedPaint: 'white', equippedGlow: 'none',
    lastDaily: '', dailyStreak: 0
  };

  function readProfile() {
    let raw = {};
    try { raw = JSON.parse(localStorage.getItem(SAVE_KEY) || '{}') || {}; } catch (_) { /* Keep an in-memory profile. */ }
    const p = { ...defaults, ...raw };
    p.balance = Math.max(0, Math.min(1000000000, Math.floor(Number(p.balance) || 0)));
    p.totalCoins = Math.max(0, Math.floor(Number(p.totalCoins) || 0));
    p.ownedPaints = ['white', ...(Array.isArray(p.ownedPaints) ? p.ownedPaints.filter((id) => PAINTS.some((x) => x.id === id)) : [])];
    p.ownedGlows = ['none', ...(Array.isArray(p.ownedGlows) ? p.ownedGlows.filter((id) => GLOWS.some((x) => x.id === id)) : [])];
    p.equippedPaint = p.ownedPaints.includes(p.equippedPaint) ? p.equippedPaint : 'white';
    p.equippedGlow = p.ownedGlows.includes(p.equippedGlow) ? p.equippedGlow : 'none';
    p.lastDaily = typeof p.lastDaily === 'string' ? p.lastDaily : '';
    p.dailyStreak = Number.isInteger(p.dailyStreak) && p.dailyStreak >= 1 && p.dailyStreak <= 7 ? p.dailyStreak : 0;
    return p;
  }

  const profile = readProfile();
  const fmt = (n) => n.toLocaleString();
  const oneDayMs = 86400000;
  let toastHandle = null;

  function saveProfile() {
    try { localStorage.setItem(SAVE_KEY, JSON.stringify(profile)); } catch (_) { /* Private browsing still works until reload. */ }
  }

  function todayKey() {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  }

  function dayGap(older, newer) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(older)) return Infinity;
    const parse = (value) => {
      const [year, month, day] = value.split('-').map(Number);
      return Date.UTC(year, month - 1, day);
    };
    return Math.round((parse(newer) - parse(older)) / oneDayMs);
  }

  function dailyInfo() {
    const gap = dayGap(profile.lastDaily, todayKey());
    const claimedToday = gap === 0;
    const continuing = gap === 1 && profile.dailyStreak > 0;
    const nextDay = continuing || claimedToday ? profile.dailyStreak % 7 + 1 : 1;
    return { claimedToday, nextDay, continuing, streak: gap >= 0 && gap <= 1 ? profile.dailyStreak : 0 };
  }

  function toast(message) {
    const el = $('hub-toast');
    el.classList.remove('visible');
    void el.offsetWidth;
    el.textContent = message;
    el.classList.add('visible');
    clearTimeout(toastHandle);
    toastHandle = setTimeout(() => el.classList.remove('visible'), 2900);
  }

  function celebrateCoins(count = 14) {
    const container = $('hub-celebration');
    if (!container || window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    for (let index = 0; index < count; index++) {
      const piece = document.createElement('span');
      piece.className = 'hub-confetti';
      piece.textContent = index % 4 === 0 ? '★' : '✦';
      piece.style.left = `${42 + Math.random() * 16}%`;
      piece.style.top = `${43 + Math.random() * 12}%`;
      piece.style.setProperty('--dx', `${Math.round((Math.random() - .5) * 360)}px`);
      piece.style.setProperty('--dy', `${Math.round(-100 - Math.random() * 180)}px`);
      piece.style.setProperty('--delay', `${Math.round(Math.random() * 180)}ms`);
      container.appendChild(piece);
      setTimeout(() => piece.remove(), 1500);
    }
  }

  function flashGaragePreview() {
    const preview = document.querySelector('.garage-preview');
    if (!preview) return;
    preview.classList.remove('garage-flash');
    void preview.offsetWidth;
    preview.classList.add('garage-flash');
  }

  function getItems(type) { return type === 'paint' ? PAINTS : GLOWS; }
  function getOwned(type) { return type === 'paint' ? profile.ownedPaints : profile.ownedGlows; }
  function getEquipped(type) { return type === 'paint' ? profile.equippedPaint : profile.equippedGlow; }

  function renderBalances() {
    $('hub-balance').textContent = fmt(profile.balance);
    $('shop-balance').textContent = fmt(profile.balance);
    const best = Number($('best').textContent.replace(/,/g, '')) || 0;
    $('hub-best').textContent = fmt(best);
    const target = best < 2000 ? 2000 : Math.ceil(best * 1.1 / 100) * 100;
    $('challenge-target').textContent = fmt(target);
    $('challenge-nudge').textContent = best ? 'BEAT YOUR PERSONAL BEST!' : 'YOUR FIRST BIG MILESTONE';
  }

  function paintPreview() {
    const paint = PAINTS.find((item) => item.id === profile.equippedPaint) || PAINTS[0];
    const glow = GLOWS.find((item) => item.id === profile.equippedGlow) || GLOWS[0];
    $('garage-equipped-label').textContent = `${paint.name.toUpperCase()} / ${glow.name.toUpperCase()}`;
  }

  function paletteCard(item, type) {
    const owned = getOwned(type).includes(item.id);
    const equipped = getEquipped(type) === item.id;
    const status = equipped ? 'EQUIPPED' : owned ? 'EQUIP' : `${item.price} ★`;
    const swatch = item.color || '#223d4e';
    return `<button type="button" class="palette-card ${equipped ? 'selected' : ''} ${!owned ? 'locked' : ''}" data-choose-type="${type}" data-choose-id="${item.id}" aria-label="${item.name}, ${status}">
      <span class="palette-swatch" style="--swatch:${swatch}">${item.color ? '' : '<span>×</span>'}</span>
      <span class="palette-label"><strong>${item.name}</strong><small>${status}</small></span>
      ${equipped ? '<span class="palette-tick">✓</span>' : ''}
    </button>`;
  }

  function renderGarage() {
    $('garage-paints').innerHTML = PAINTS.map((item) => paletteCard(item, 'paint')).join('');
    $('garage-glows').innerHTML = GLOWS.map((item) => paletteCard(item, 'glow')).join('');
    paintPreview();
  }

  function shopCard(item, type) {
    const owned = getOwned(type).includes(item.id);
    const equipped = getEquipped(type) === item.id;
    const affordability = profile.balance >= item.price ? '' : 'low-funds';
    const action = equipped ? 'EQUIPPED' : owned ? 'EQUIP NOW' : `BUY · ${item.price} ★`;
    const kind = type === 'paint' ? 'PAINT' : 'NEON';
    return `<article class="shop-item" data-product="${item.id}">
      <div class="shop-sample" style="--sample:${item.color || '#223b4c'}"><span>${kind}</span><b>${item.color ? '◈' : '×'}</b></div>
      <div class="shop-item-info"><strong>${item.name}</strong><small>${item.detail}</small></div>
      <button type="button" data-buy-type="${type}" data-buy-id="${item.id}" class="shop-buy ${affordability}" ${equipped ? 'disabled' : ''}>${action}</button>
    </article>`;
  }

  function renderShop() {
    $('shop-paints').innerHTML = PAINTS.map((item) => shopCard(item, 'paint')).join('');
    $('shop-glows').innerHTML = GLOWS.map((item) => shopCard(item, 'glow')).join('');
  }

  function renderDaily() {
    const info = dailyInfo();
    const shownDay = info.claimedToday ? profile.dailyStreak : info.nextDay;
    const amount = DAILY_COINS[(info.claimedToday ? info.nextDay : shownDay) - 1];
    $('daily-next-amount').innerHTML = `+${amount} <small>COINS</small>`;
    $('daily-status').textContent = info.claimedToday ? 'NEXT REWARD AVAILABLE TOMORROW' : `DAY ${shownDay} READY TO CLAIM`;
    $('daily-streak-number').textContent = String(info.streak);
    const completed = info.claimedToday ? profile.dailyStreak : info.continuing && info.nextDay > 1 ? profile.dailyStreak : 0;
    $('daily-grid').innerHTML = DAILY_COINS.map((value, index) => {
      const day = index + 1;
      const isDone = day <= completed;
      const active = !info.claimedToday && day === shownDay;
      return `<div class="daily-day ${isDone ? 'done' : ''} ${active ? 'available' : ''}">
        <span>DAY ${String(day).padStart(2, '0')}</span><strong>★</strong><b>+${value}</b><small>${isDone ? 'CLAIMED ✓' : active ? 'READY NOW' : 'LOCKED'}</small>
      </div>`;
    }).join('');
    const btn = $('daily-claim-btn');
    btn.disabled = info.claimedToday;
    btn.innerHTML = info.claimedToday ? 'REWARD CLAIMED · COME BACK TOMORROW <span>✓</span>' : `CLAIM ${DAILY_COINS[shownDay - 1]} FREE COINS <span>→</span>`;
  }

  function renderAll() {
    renderBalances();
    renderGarage();
    renderShop();
    renderDaily();
  }

  function openTab(name) {
    if (!['home', 'garage', 'daily', 'shop'].includes(name)) name = 'home';
    $('home-menu').dataset.activeTab = name;
    document.querySelectorAll('[data-hub-screen]').forEach((screen) => {
      screen.hidden = screen.dataset.hubScreen !== name;
    });
    document.querySelectorAll('.hub-nav [data-hub-tab]').forEach((button) => {
      const isCurrent = button.dataset.hubTab === name;
      button.classList.toggle('active', isCurrent);
      button.setAttribute('aria-selected', String(isCurrent));
    });
    $('hub-content').scrollTop = 0;
    renderAll();
  }

  function equip(type, item) {
    if (type === 'paint') profile.equippedPaint = item.id;
    else profile.equippedGlow = item.id;
    saveProfile();
    renderAll();
    flashGaragePreview();
    toast(`${item.name.toUpperCase()} EQUIPPED`);
  }

  function attemptBuy(type, item) {
    const owned = getOwned(type);
    if (owned.includes(item.id)) { equip(type, item); return; }
    if (profile.balance < item.price) {
      toast(`NEED ${item.price - profile.balance} MORE COINS`);
      return;
    }
    profile.balance -= item.price;
    owned.push(item.id);
    equip(type, item);
    celebrateCoins(17);
    toast(`${item.name.toUpperCase()} UNLOCKED & EQUIPPED!`);
  }

  document.querySelectorAll('[data-hub-tab]').forEach((button) => {
    button.addEventListener('click', () => openTab(button.dataset.hubTab));
  });
  $('hub-start-btn').addEventListener('click', () => $('play-btn').click());

  document.querySelectorAll('#garage-paints, #garage-glows').forEach((list) => {
    list.addEventListener('click', (event) => {
      const button = event.target.closest('[data-choose-type]');
      if (!button) return;
      const type = button.dataset.chooseType;
      const item = getItems(type).find((entry) => entry.id === button.dataset.chooseId);
      if (!item) return;
      if (getOwned(type).includes(item.id)) equip(type, item);
      else { openTab('shop'); toast(`UNLOCK ${item.name.toUpperCase()} IN THE SHOP`); }
    });
  });

  document.querySelectorAll('#shop-paints, #shop-glows').forEach((list) => {
    list.addEventListener('click', (event) => {
      const button = event.target.closest('[data-buy-type]');
      if (!button) return;
      const type = button.dataset.buyType;
      const item = getItems(type).find((entry) => entry.id === button.dataset.buyId);
      if (item) attemptBuy(type, item);
    });
  });

  $('daily-claim-btn').addEventListener('click', () => {
    const info = dailyInfo();
    if (info.claimedToday) { toast('COME BACK TOMORROW FOR MORE'); return; }
    const amount = DAILY_COINS[info.nextDay - 1];
    profile.balance += amount;
    profile.dailyStreak = info.nextDay;
    profile.lastDaily = todayKey();
    saveProfile();
    renderAll();
    celebrateCoins(24);
    toast(`+${amount} COINS · DAY ${info.nextDay} COMPLETE!`);
  });

  document.addEventListener('visibilitychange', () => { if (!document.hidden) renderAll(); });

  window.LaneRushProfile = {
    paintColor: () => (PAINTS.find((item) => item.id === profile.equippedPaint) || PAINTS[0]).color,
    glowColor: () => (GLOWS.find((item) => item.id === profile.equippedGlow) || GLOWS[0]).color,
    addRunCoin() {
      profile.balance += 1;
      profile.totalCoins += 1;
      saveProfile();
      renderBalances();
    }
  };

  window.LaneRushMenu = {
    show(tab = 'home') {
      $('home-menu').hidden = false;
      $('modal').hidden = true;
      $('overlay').classList.add('menu-open');
      $('game-shell').style.touchAction = 'auto';
      openTab(tab);
    },
    hide() {
      $('home-menu').hidden = true;
      $('modal').hidden = false;
      $('overlay').classList.remove('menu-open');
      $('game-shell').style.touchAction = 'none';
    },
    refresh: renderAll
  };

  renderAll();
})();
