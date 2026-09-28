/**
 * WallCraft — "Ses Seviyesi" (live sound level) community widget
 * -------------------------------------------------------------------------
 * PROBLEM SOLVED
 *   "How loud is it right now, and which app is making the noise?" — a real
 *   level meter on the desktop, in dBFS, with the loudest applications listed.
 *
 * WHY THIS IS NOT THE BUILT-IN volume-mixer
 *   The volume mixer shows volume *sliders* (an intention). This shows the
 *   actual output *level* (a measurement) and who is producing it.
 *
 * DATA (host: WASAPI audio mixer, delivered over the postMessage bridge)
 *   WallCraft.audio.onStateChange(cb) -> live state, ~10 Hz
 *   WallCraft.audio.getState()       -> first snapshot
 *   state.master  { volume, isMuted, peak 0..100, rawPeak 0..1 }
 *   state.sessions[] { name, pid, pids, volume, isMuted, peak 0..100, rawPeak 0..1 }
 *
 * Honesty notes
 *   - dBFS is derived from the host's LINEAR amplitude: 20*log10(rawPeak).
 *     That is a real, correct conversion; no SPL claim is made anywhere.
 *   - The bar and the number share one scale (floorDb..0 dBFS) so they can
 *     never disagree.
 *   - Ballistics (fast attack, slow release, decaying peak-hold) are a display
 *     convention only; the reported figure is always the measured value.
 */

(function () {
  'use strict';

  var I18N = {
    en: {
      label: 'SOUND LEVEL', silent: 'silent', low: 'low', loud: 'loud', veryLoud: 'very loud',
      noApps: 'no audio sessions', volume: 'vol', muted: 'muted', unavailable: 'audio unavailable',
      needPermission: 'needs "audio" permission'
    },
    tr: {
      label: 'SES SEVİYESİ', silent: 'sessiz', low: 'düşük', loud: 'yüksek', veryLoud: 'çok yüksek',
      noApps: 'ses oturumu yok', volume: 'ses', muted: 'sessiz', unavailable: 'ses erişilemiyor',
      needPermission: '"audio" izni gerekli'
    }
  };

  var DEFAULT_CONFIG = {
    appCount: 3, floorDb: -60, warnPct: 75, showScale: true, sortByLevel: true
  };

  var FLOOR = -140;          // absolute minimum for the linear->dB conversion
  var ATTACK = 0.45;          // meter ballistics: how fast the bar follows a rise
  var RELEASE = 0.10;         // ...and how slowly it falls back
  var HOLD_DECAY = 0.55;      // dB per frame the peak-hold marker gives back
  var ROW_MIN_INTERVAL = 140; // ms between app-row DOM updates (state is 10 Hz)

  var S = {
    container: null, root: null, el: {}, appRows: [],
    lang: 'en', cfg: Object.assign({}, DEFAULT_CONFIG),
    unsub: null, langUnsub: null, langHandler: null, rafId: null, running: false,
    targetDb: FLOOR, shownDb: FLOOR, holdDb: FLOOR,
    master: { volume: 0, isMuted: false, db: FLOOR, pct: 0 },
    sessions: [], lastRowAt: 0, lastStateAt: 0, gotState: false
  };

  /* ------------------------------------------------------------- utilities */

  function t(key) {
    var d = I18N[S.lang] || I18N.en;
    return d[key] != null ? d[key] : (I18N.en[key] || key);
  }

  function ready(fn) {
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', fn, { once: true });
    } else {
      fn();
    }
  }

  function setText(el, v) {
    if (el && el.__t !== v) { el.textContent = v; el.__t = v; }
  }

  function setStyle(el, prop, v) {
    if (!el) return;
    var cur = el.style[prop];
    if (cur !== v) el.style[prop] = v;
  }

  function cls(el, name, on) {
    if (el && el.classList) el.classList.toggle(name, !!on);
  }

  function clamp(v, lo, hi) { return v < lo ? lo : v > hi ? hi : v; }

  function clampNum(v, min, max, fb) {
    var n = typeof v === 'number' ? v : parseInt(v, 10);
    if (isNaN(n)) n = fb;
    return clamp(n, min, max);
  }

  /**
   * Linear amplitude -> dBFS.
   * The host normally sends rawPeak in 0..1, but formatAudioStateForSandbox
   * also tolerates an already-perceptual 0..100 value, so both are handled.
   */
  function toDbFS(rawPeak) {
    if (typeof rawPeak !== 'number' || !isFinite(rawPeak) || rawPeak <= 0) return FLOOR;
    var linear = rawPeak > 1 ? rawPeak / 100 : rawPeak;
    if (linear <= 0) return FLOOR;
    var db = 20 * Math.log10(linear);
    return db < FLOOR ? FLOOR : db;
  }

  function clampNumDb() { return clampNum(S.cfg.floorDb, -80, -20, -60); }

  function dbToPct(db) {
    var floor = clampNumDb();
    return clamp(((db - floor) / (0 - floor)) * 100, 0, 100);
  }

  function warnPct() { return clampNum(S.cfg.warnPct, 50, 95, 75); }

  function levelClass(pct) {
    if (pct >= 92) return 'is-high';
    if (pct >= warnPct()) return 'is-mid';
    return 'is-low';
  }

  function stateWord(pct) {
    if (pct < 2) return t('silent');
    if (pct >= 92) return t('veryLoud');
    if (pct >= warnPct()) return t('loud');
    return t('low');
  }

  function fmtDb(db) {
    if (db <= FLOOR) return '-∞';
    return (db > 0 ? '+' : '') + db.toFixed(1);
  }

  function cleanName(n) {
    if (!n) return '?';
    return String(n).replace(/\.exe$/i, '');
  }

  /* ------------------------------------------------------------------ data */

  function ingest(state) {
    if (!state || !state.master) return;
    S.lastStateAt = Date.now();

    var m = state.master;
    S.master.volume = typeof m.volume === 'number' ? m.volume : 0;
    S.master.isMuted = !!(m.isMuted || m.mute);
    S.master.db = toDbFS(typeof m.rawPeak === 'number' ? m.rawPeak : m.peak);

    var list = Array.isArray(state.sessions) ? state.sessions : [];
    S.sessions = list.map(function (s) {
      return {
        name: cleanName(s.name),
        peak: clampNum(s.peak, 0, 100, 0),
        isMuted: !!(s.isMuted || s.mute)
      };
    });
    S.gotState = true;

    S.targetDb = S.master.db;
  }

  /* ---------------------------------------------------------------- render */

  function buildTicks() {
    var box = S.el.ticks;
    if (!box) return;
    var show = S.cfg.showScale !== false;
    cls(S.el.meter, 'sl-no-scale', !show);
    if (!show) { box.innerHTML = ''; box.__sig = ''; return; }

    var floor = clampNumDb();
    var steps = [0, -20, -40, -60, -80].filter(function (d) { return d >= floor && d < 0; });
    var sig = floor + '|' + steps.join(',');
    if (box.__sig === sig) return;
    box.__sig = sig;

    var html = '';
    steps.forEach(function (d) {
      var left = ((d - floor) / (0 - floor)) * 100;
      html += '<div class="sl-tick" style="left:' + left.toFixed(2) + '%"></div>';
      if (d !== 0) {
        html += '<div class="sl-tick-label" style="left:' + left.toFixed(2) + '%">' + d + '</div>';
      }
    });
    box.innerHTML = html;
  }

  function ensureAppRows(n) {
    var box = S.el.apps;
    if (!box) return;
    S.appRows = [];
    box.innerHTML = '';

    if (n <= 0) {
      var em = document.createElement('div');
      em.className = 'sl-empty';
      em.id = 'sl-empty';
      box.appendChild(em);
      setText(em, t('noApps'));
      return;
    }

    for (var i = 0; i < n; i++) {
      var row = document.createElement('div');
      row.className = 'sl-app';
      row.innerHTML =
        '<span class="sl-app-name" data-n></span>' +
        '<span class="sl-app-bar"><span class="sl-app-fill" data-b></span></span>' +
        '<span class="sl-app-num" data-v></span>';
      box.appendChild(row);
      S.appRows.push({
        row: row,
        name: row.querySelector('[data-n]'),
        bar: row.querySelector('[data-b]'),
        val: row.querySelector('[data-v]')
      });
    }
  }

  function renderRows(force) {
    if (!S.el.apps) return;
    var now = Date.now();
    if (!force && now - S.lastRowAt < ROW_MIN_INTERVAL) return;
    S.lastRowAt = now;

    if (!S.appRows.length) {                       // zero rows configured
      var em = S.el.apps.querySelector('#sl-empty');
      if (em) setText(em, S.sessions.length ? '' : t('noApps'));
      return;
    }

    var list = S.sessions.slice();
    if (S.cfg.sortByLevel !== false) {
      list.sort(function (a, b) { return b.peak - a.peak; });
    }

    for (var i = 0; i < S.appRows.length; i++) {
      var r = S.appRows[i];
      var s = list[i];
      if (!s) {
        setText(r.name, '—');
        setText(r.val, '');
        setStyle(r.bar, 'width', '0%');
        continue;
      }
      setText(r.name, s.name);
      setText(r.val, s.isMuted ? '·' : String(s.peak));
      setStyle(r.bar, 'width', clamp(s.peak, 0, 100).toFixed(1) + '%');
      // same thresholds as the main meter, so the two can never disagree
      var ac = levelClass(s.peak);
      cls(r.bar, 'is-mid', ac === 'is-mid');
      cls(r.bar, 'is-high', ac === 'is-high');
      cls(r.row, 'is-muted', !!s.isMuted);
    }
  }

  function renderReadout() {
    var pct = dbToPct(S.shownDb);
    var lc = levelClass(pct);

    setStyle(S.el.fill, 'width', pct.toFixed(2) + '%');
    cls(S.el.fill, 'is-mid', lc === 'is-mid');
    cls(S.el.fill, 'is-high', lc === 'is-high');

    setText(S.el.db, fmtDb(S.shownDb) + ' dBFS');
    cls(S.el.db, 'is-low', lc === 'is-low');
    cls(S.el.db, 'is-mid', lc === 'is-mid');
    cls(S.el.db, 'is-high', lc === 'is-high');

    if (S.master.isMuted) setText(S.el.vol, t('muted'));
    else setText(S.el.vol, t('volume') + ' ' + Math.round(S.master.volume) + '%');
    cls(S.el.vol, 'is-muted', !!S.master.isMuted);

    setText(S.el.stateText, stateWord(pct));
    // "live" means audio is actually arriving, not merely that we are mounted
    var age = S.lastStateAt ? (Date.now() - S.lastStateAt) : Infinity;
    cls(S.el.dot, 'is-live', age < 2000 && pct > 1);
  }

  /** one animation step: meter ballistics + peak-hold decay */
  function step() {
    // attack quickly toward new peaks, release slowly
    var k = S.targetDb > S.shownDb ? ATTACK : RELEASE;
    S.shownDb += (S.targetDb - S.shownDb) * k;
    if (Math.abs(S.targetDb - S.shownDb) < 0.05) S.shownDb = S.targetDb;
    // true silence: the release is asymptotic, so snap the tail to the floor
    // instead of settling on a number like "-139.7 dBFS"
    if (S.targetDb <= FLOOR && S.shownDb < FLOOR + 0.6) S.shownDb = FLOOR;

    if (S.shownDb >= S.holdDb) S.holdDb = S.shownDb;
    else S.holdDb = Math.max(S.shownDb, S.holdDb - HOLD_DECAY);

    var holdPct = dbToPct(S.holdDb);
    setStyle(S.el.hold, 'left', holdPct.toFixed(2) + '%');
    cls(S.el.hold, 'is-on', S.gotState && S.holdDb > S.shownDb + 0.4);

    renderReadout();
    // internally throttled to ROW_MIN_INTERVAL, so this is cheap at 60 fps
    renderRows(false);
  }

  function tick() {
    step();
    S.rafId = requestAnimationFrame(tick);
  }

  function startLoop() {
    if (S.rafId != null || S.running) return;
    S.running = true;
    S.rafId = requestAnimationFrame(tick);
  }

  function stopLoop() {
    if (S.rafId != null) { cancelAnimationFrame(S.rafId); S.rafId = null; }
    S.running = false;
  }

  /* ------------------------------------------------------------------ host */

  function audioApi() {
    var sdk = window.WallCraft;
    return sdk && sdk.audio && typeof sdk.audio.onStateChange === 'function' ? sdk.audio : null;
  }

  function showUnavailable(reasonKey) {
    S.el.label && (S.el.label.style.opacity = '0.45');
    setText(S.el.stateText, t(reasonKey));
    setText(S.el.db, '—');
    setStyle(S.el.fill, 'width', '0%');
    if (!S.appRows.length) {
      var em = S.el.apps && S.el.apps.querySelector('#sl-empty');
      if (em) setText(em, t(reasonKey));
    }
  }

  function subscribe() {
    var api = audioApi();
    if (!api) { showUnavailable('needPermission'); return false; }

    if (S.unsub) { try { S.unsub(); } catch (e) { /* noop */ } S.unsub = null; }

    try {
      S.unsub = api.onStateChange(function (state) { ingest(state); });
    } catch (e) {
      console.warn('[ses-seviyesi] onStateChange failed:', e && e.message);
      showUnavailable('unavailable');
      return false;
    }

    // first snapshot, in case no update arrives immediately
    if (typeof api.getState === 'function') {
      try {
        var p = api.getState();
        if (p && typeof p.then === 'function') {
          p.then(ingest, function (e) { console.warn('[ses-seviyesi] getState failed:', e && e.message); });
        }
      } catch (e) { /* noop */ }
    }
    return true;
  }

  /* ------------------------------------------------------------- lifecycle */

  function cacheEls(container) {
    var root = null;
    if (container && container.nodeType === 1) {
      if (container.id === 'sl-root') root = container;
      else if (typeof container.querySelector === 'function') root = container.querySelector('#sl-root');
    }
    if (!root) root = document.getElementById('sl-root');
    S.root = root;
    if (!root) { S.el = {}; return; }

    S.el = {
      root: root,
      label: root.querySelector('#sl-label'),
      dot: root.querySelector('#sl-dot'),
      stateText: root.querySelector('#sl-state-text'),
      meter: root.querySelector('#sl-meter'),
      fill: root.querySelector('#sl-fill'),
      hold: root.querySelector('#sl-hold'),
      ticks: root.querySelector('#sl-ticks'),
      db: root.querySelector('#sl-db'),
      vol: root.querySelector('#sl-vol'),
      apps: root.querySelector('#sl-apps')
    };
  }

  function setLanguage(lang) {
    S.lang = (lang === 'tr' || String(lang || '').indexOf('tr') === 0) ? 'tr' : 'en';
  }

  function applyLabels() {
    if (!S.el.label) return;
    setText(S.el.label, t('label'));
    buildTicks();
    ensureAppRows(clampNum(S.cfg.appCount, 1, 5, 3));
    renderRows(true);
    renderReadout();
  }

  /** The app can switch language at runtime; follow it or the labels freeze. */
  function subscribeLanguage() {
    if (S.langUnsub) {
      try { S.langUnsub(); } catch (e) { /* noop */ }
      S.langUnsub = null;
    }
    if (S.langHandler) return;
    S.langHandler = function (lang) {
      setLanguage(lang);
      applyLabels();
    };
    try {
      var sdk = window.WallCraft;
      if (sdk && typeof sdk.onLanguageChange === 'function') {
        var u = sdk.onLanguageChange(S.langHandler);
        if (typeof u === 'function') S.langUnsub = u;
      }
    } catch (e) {
      console.warn('[ses-seviyesi] language subscription unavailable:', e && e.message);
    }
  }

  function applyConfig(config) {
    if (config && typeof config === 'object') Object.assign(S.cfg, config);
  }

  function mount(container, config) {
    if (container) S.container = container;
    cacheEls(container);
    if (!S.root) {
      console.error('[ses-seviyesi] #sl-root not found - widget.html was not loaded.');
      return;
    }
    applyConfig(config);
    setLanguage((window.WallCraft && window.WallCraft.language) || 'en');
    subscribeLanguage();
    applyLabels();
    var ok = subscribe();
    if (ok) startLoop(); else step();
    console.log('[ses-seviyesi] mounted. audio api:', ok ? 'granted' : 'unavailable');
  }

  window.WallCraftWidget = {
    container: null,

    init: function (container, config) {
      this.container = container;
      applyConfig(config);
      cacheEls(container);
      if (S.root) mount(container, config);
      else ready(function () { mount(container, config); });
    },

    update: function (config) {
      applyConfig(config);
      if (!S.root) cacheEls(S.container);
      if (!S.root) return;
      applyLabels();
    },

    pause: function () {
      stopLoop();
    },

    resume: function () {
      if (!S.running) {
        // the host stopped our rAF while paused, so re-subscribe to be safe
        if (audioApi()) subscribe();
        startLoop();
        step();
      }
    },

    destroy: function () {
      stopLoop();
      if (S.unsub) {
        try { S.unsub(); } catch (e) { /* noop */ }
        S.unsub = null;
      }
      if (S.langUnsub) {
        try { S.langUnsub(); } catch (e) { /* noop */ }
        S.langUnsub = null;
      }
      S.langHandler = null;
      S.el = {};
      S.appRows = [];
      S.root = null;
      S.sessions = [];
      S.gotState = false;
      this.container = null;
      S.container = null;
      console.log('[ses-seviyesi] destroyed.');
    }
  };

  /* Local browser preview: fake the host so the meter can be seen without the app. */
  ready(function () {
    if (window.WallCraft) return;

    // Install the synthetic host BEFORE mounting: otherwise mount() finds no
    // audio API, reports "needs permission" and dims the label for good.
    var handlers = [];
    var fake = {
      state: null,
      onStateChange: function (cb) {
        handlers.push(cb);
        return function () { handlers = handlers.filter(function (h) { return h !== cb; }); };
      },
      getState: function () { return Promise.resolve(fake.state); }
    };
    window.WallCraft = { language: 'tr', config: {}, audio: fake };

    setLanguage('tr');
    mount(null, DEFAULT_CONFIG);

    // synthetic 10 Hz signal so the meter animates in a plain browser
    var t0 = Date.now();
    setInterval(function () {
      var secs = (Date.now() - t0) / 1000;
      var lv = 0.52 + 0.15 * Math.sin(secs * 1.7) + 0.08 * Math.sin(secs * 4.3);
      var peak = clamp(lv, 0.20, 0.92);
      var raw = peak * peak;
      fake.state = {
        master: { volume: 62, isMuted: false, peak: Math.round(Math.sqrt(raw) * 100), rawPeak: raw },
        sessions: [
          { name: 'Spotify.exe', volume: 70, isMuted: false, peak: Math.round(100 * clamp(raw * 1.1, 0, 1)), rawPeak: raw * 1.1 },
          { name: 'chrome.exe', volume: 40, isMuted: false, peak: Math.round(100 * clamp(raw * 0.55, 0, 1)), rawPeak: raw * 0.55 },
          { name: 'Discord.exe', volume: 55, isMuted: false, peak: Math.round(100 * clamp(raw * 0.30, 0, 1)), rawPeak: raw * 0.30 },
          { name: 'System Sounds', volume: 100, isMuted: false, peak: 4, rawPeak: 0.0016 }
        ]
      };
      handlers.slice().forEach(function (h) { h(fake.state); });
    }, 100);
  });
})();
