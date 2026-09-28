/**
 * WallCraft — "Hava Kalitesi" (air quality) community widget
 * -------------------------------------------------------------------------
 * PROBLEM SOLVED
 *   "Can I open the window?" — the live outdoor air index for a city, what it
 *   actually means, and which pollutant is responsible, plus UV and pollen.
 *
 * DATA (no API key, CORS verified reachable from the sandbox)
 *   https://air-quality-api.open-meteo.com/v1/air-quality
 *     current = european_aqi, us_aqi, pm2_5, pm10, ozone, nitrogen_dioxide,
 *               sulphur_dioxide, carbon_monoxide, ammonia, dust,
 *               uv_index, alder/birch/mugwort/olive/ragweed_pollen
 *   https://geocoding-api.open-meteo.com/v1/search   (city name -> lat/lon,
 *     returns localised names, so the city can be typed in the user's language)
 *
 * Honesty notes
 *   - The headline number is the **US AQI** and the verdict uses the official
 *     US EPA AQI breakpoints (0-50 / 51-100 / 101-150 / 151-200 / 201-300 /
 *     301+). Those bands are published, so the word next to the number is
 *     reproducible rather than invented.
 *   - The European AQI is shown as a secondary number only, without a verdict,
 *     because its banding is not applied here.
 *   - Pollutant values are printed in the unit the API returns (µg/m³ for
 *     particulate matter, µg/m³ for gases, and UV is unitless). No conversion
 *     is applied.
 */

(function () {
  'use strict';

  var I18N = {
    en: {
      label: 'AIR QUALITY', unit: 'µg/m³', updated: 'updated', uv: 'UV', pollen: 'Pollen',
      pollenNone: 'no pollen', window: 'Open the window', avoid: 'Keep it closed',
      loading: 'Loading…', unavailable: 'no data', city: 'city not found',
      needPermission: 'needs "network" permission',
      good: 'Good', moderate: 'Moderate', sensitive: 'Sensitive groups',
      unhealthy: 'Unhealthy', severe: 'Very unhealthy', hazard: 'Hazardous',
      usAqi: 'US AQI', min: 'min', hour: 'h'
    },
    tr: {
      label: 'HAVA KALİTESİ', unit: 'µg/m³', updated: 'güncellendi', uv: 'UV', pollen: 'Polen',
      pollenNone: 'polen yok', window: 'Pencereyi aç', avoid: 'Pencereyi açma',
      loading: 'Yükleniyor…', unavailable: 'veri yok', city: 'şehir bulunamadı',
      needPermission: '"network" izni gerekli',
      good: 'İyi', moderate: 'Orta', sensitive: 'Hassas gruplar',
      unhealthy: 'Sağlıksız', severe: 'Çok sağlıksız', hazard: 'Tehlikeli',
      usAqi: 'US AQI', min: 'dk', hour: 's'
    }
  };

  var DEFAULT_CONFIG = { city: 'Istanbul', lat: '', lon: '', refreshMinutes: 15 };

  var AIR = 'https://air-quality-api.open-meteo.com/v1/air-quality';
  var GEO = 'https://geocoding-api.open-meteo.com/v1/search';
  var TIMEOUT = 10000;

  var POLLUTANTS = [
    { key: 'pm2_5', cap: 'PM2.5' },
    { key: 'pm10', cap: 'PM10' },
    { key: 'ozone', cap: 'O₃' },
    { key: 'nitrogen_dioxide', cap: 'NO₂' }
  ];
  var POLLENS = [
    { key: 'alder_pollen', tr: 'kızılağaç', en: 'alder' },
    { key: 'birch_pollen', tr: 'huş', en: 'birch' },
    { key: 'mugwort_pollen', tr: 'pelin', en: 'mugwort' },
    { key: 'olive_pollen', tr: 'zeytin', en: 'olive' },
    { key: 'ragweed_pollen', tr: 'ambrosia', en: 'ragweed' }
  ];

  /* Official US EPA AQI breakpoints. Published, not invented. */
  var BANDS = [
    { max: 50,   cls: 'is-good',     key: 'good' },
    { max: 100,  cls: 'is-moderate', key: 'moderate' },
    { max: 150,  cls: 'is-sensitive',key: 'sensitive' },
    { max: 200,  cls: 'is-unhealthy',key: 'unhealthy' },
    { max: 300,  cls: 'is-severe',   key: 'severe' },
    { max: Infinity, cls: 'is-severe', key: 'hazard' }
  ];
  var AQI_CEIL = 300;   // the scale bar runs 0..300

  var S = {
    container: null, root: null, el: {}, pollItems: [],
    lang: 'en', cfg: Object.assign({}, DEFAULT_CONFIG),
    timerId: null, running: false, loading: false,
    lastOkAt: 0, lastTryAt: 0, gen: 0, gotState: false,
    resolvedCity: null, coords: null,
    langUnsub: null, langHandler: null
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
    if (el && el.style[prop] !== v) el.style[prop] = v;
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

  function escapeHtml(s) {
    return String(s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }

  function fmtAgo(ms) {
    var s = Math.max(0, Math.round((Date.now() - ms) / 1000));
    if (s < 60) return s + 's';
    var m = Math.round(s / 60);
    if (m < 60) return m + t('min');
    return Math.floor(m / 60) + t('hour') + ' ' + (m % 60) + t('min');
  }

  function bandFor(aqi) {
    for (var i = 0; i < BANDS.length; i++) if (aqi <= BANDS[i].max) return BANDS[i];
    return BANDS[BANDS.length - 1];
  }

  function getJSON(url) {
    var ctrl = typeof AbortController !== 'undefined' ? new AbortController() : null;
    var timer = setTimeout(function () { if (ctrl) ctrl.abort(); }, TIMEOUT);
    return fetch(url, ctrl ? { signal: ctrl.signal } : undefined)
      .then(function (res) {
        if (!res.ok) throw new Error('HTTP ' + res.status);
        return res.json();
      })
      .finally(function () { clearTimeout(timer); });
  }

  /* ------------------------------------------------------------------ data */

  function resolveCoords() {
    // explicit coordinates win, so a user outside the geocoder's coverage can
    // still point at their exact spot
    var lat = parseFloat(String(S.cfg.lat == null ? '' : S.cfg.lat).replace(',', '.'));
    var lon = parseFloat(String(S.cfg.lon == null ? '' : S.cfg.lon).replace(',', '.'));
    if (isFinite(lat) && isFinite(lon) && lat >= -90 && lat <= 90 && lon >= -180 && lon <= 180) {
      return Promise.resolve({ lat: lat, lon: lon, name: S.cfg.city || '' });
    }
    var name = String(S.cfg.city || '').trim();
    if (!name) return Promise.reject(new Error('no city'));
    return getJSON(GEO + '?name=' + encodeURIComponent(name) + '&count=1&language=' +
      (S.lang === 'tr' ? 'tr' : 'en') + '&format=json')
      .then(function (j) {
        var r = j && j.results && j.results[0];
        if (!r) throw new Error('city not found');
        return { lat: r.latitude, lon: r.longitude, name: r.name || name };
      });
  }

  function load() {
    if (S.loading) return Promise.resolve();
    S.loading = true;
    S.gen++;
    var gen = S.gen;
    setText(S.el.age, t('loading'));

    return resolveCoords().then(function (c) {
      if (gen !== S.gen) return null;
      S.coords = c;
      S.resolvedCity = c.name;
      var vars = ['european_aqi', 'us_aqi', 'uv_index']
        .concat(POLLUTANTS.map(function (p) { return p.key; }))
        .concat(POLLENS.map(function (p) { return p.key; }))
        .join(',');
      return getJSON(AIR + '?latitude=' + c.lat + '&longitude=' + c.lon +
        '&current=' + vars + '&timezone=auto');
    })
      .then(function (j) {
        if (gen !== S.gen || !S.root) return;          // superseded
        if (!j || !j.current) throw new Error('no current');
        S.lastOkAt = Date.now();
        S.gotState = true;
        render(j.current);
      })
      .catch(function (err) {
        if (gen !== S.gen) return;
        console.warn('[hava-kalitesi] load failed:', err && err.message);
        if (/city not found/.test(err && err.message || '')) {
          setText(S.el.city, t('city'));
        }
        renderUnavailable();
      })
      .finally(function () {
        if (gen !== S.gen) return;
        S.loading = false;
        S.lastTryAt = Date.now();
        renderAge();
      });
  }

  /* ---------------------------------------------------------------- render */

  function ensurePollItems() {
    var box = S.el.poll;
    if (!box) return;
    S.pollItems = [];
    box.innerHTML = '';
    POLLUTANTS.forEach(function (p) {
      var item = document.createElement('div');
      item.className = 'aq-item';
      item.innerHTML = '<span class="aq-item-cap" data-c></span>' +
        '<span class="aq-item-val" data-v></span>';
      box.appendChild(item);
      S.pollItems.push({
        cap: item.querySelector('[data-c]'),
        val: item.querySelector('[data-v]')
      });
      S.pollItems[S.pollItems.length - 1].meta = p;
    });
  }

  function render(cur) {
    var aqi = typeof cur.us_aqi === 'number' ? cur.us_aqi : null;
    var band = aqi === null ? null : bandFor(aqi);
    var bc = band ? band.cls : '';

    setText(S.el.index, aqi === null ? t('unavailable') : String(Math.round(aqi)));
    ['is-good', 'is-moderate', 'is-sensitive', 'is-unhealthy', 'is-severe'].forEach(function (c) {
      cls(S.el.index, c, c === bc);
    });
    setText(S.el.word, band ? t(band.key) : '-');
    ['is-good', 'is-moderate', 'is-sensitive', 'is-unhealthy', 'is-severe'].forEach(function (c) {
      cls(S.el.word, c, c === bc);
    });
    setText(S.el.scaleCap, t('usAqi'));

    var eu = typeof cur.european_aqi === 'number' ? Math.round(cur.european_aqi) : null;
    setText(S.el.sub, eu === null ? t('unavailable') : 'EU ' + eu);

    var pct = aqi === null ? 0 : clamp((aqi / AQI_CEIL) * 100, 0, 100);
    setStyle(S.el.fill, 'width', pct.toFixed(2) + '%');
    ['is-moderate', 'is-sensitive', 'is-unhealthy', 'is-severe'].forEach(function (c) {
      cls(S.el.fill, c, c === bc);
    });
    setStyle(S.el.marker, 'left', pct.toFixed(2) + '%');

    setText(S.el.city, S.resolvedCity || S.cfg.city || '-');

    for (var i = 0; i < S.pollItems.length; i++) {
      var it = S.pollItems[i];
      setText(it.cap, it.meta.cap);
      var v = cur[it.meta.key];
      setText(it.val, typeof v === 'number' ? (Math.round(v * 10) / 10) : '-');
    }

    // UV + the dominant pollen type, only when the host actually reports one
    var bits = [];
    if (typeof cur.uv_index === 'number') bits.push(t('uv') + ' ' + (Math.round(cur.uv_index * 10) / 10));
    var top = null;
    POLLENS.forEach(function (p) {
      var v = cur[p.key];
      if (typeof v === 'number' && v > 0 && (!top || v > top.v)) top = { p: p, v: v };
    });
    if (top) bits.push(t('pollen') + ' <span class="aq-hot">' + escapeHtml(t('pollen') ? (S.lang === 'tr' ? top.p.tr : top.p.en) : '') + '</span>');
    else bits.push(t('pollenNone'));
    S.el.extra.innerHTML = bits.join('  ·  ');

    renderAge();
  }

  function renderUnavailable() {
    setText(S.el.index, t('unavailable'));
    setText(S.el.word, '-');
    setText(S.el.sub, '-');
    setStyle(S.el.fill, 'width', '0%');
    setStyle(S.el.marker, 'left', '0%');
    S.pollItems.forEach(function (it) { setText(it.val, '-'); });
    if (!S.pollItems.length) {
      var em = S.el.poll && S.el.poll.querySelector('.aq-empty');
      if (em) setText(em, t('unavailable'));
    }
    renderAge();
  }

  function renderAge() {
    if (!S.el.age) return;
    if (S.loading) { setText(S.el.age, t('loading')); return; }
    if (!S.lastOkAt) {
      setText(S.el.age, S.lastTryAt ? t('unavailable') : '-');
      return;
    }
    setText(S.el.age, t('updated') + ' ' + fmtAgo(S.lastOkAt));
  }

  /* ------------------------------------------------------------- lifecycle */

  function cacheEls(container) {
    var root = null;
    if (container && container.nodeType === 1) {
      if (container.id === 'aq-root') root = container;
      else if (typeof container.querySelector === 'function') root = container.querySelector('#aq-root');
    }
    if (!root) root = document.getElementById('aq-root');
    S.root = root;
    if (!root) { S.el = {}; return; }

    var scale = root.querySelector('#aq-scale');
    if (scale && !scale.querySelector('.aq-fill')) {
      var f = document.createElement('div');
      f.className = 'aq-fill';
      scale.insertBefore(f, scale.firstChild);
    }

    S.el = {
      root: root,
      label: root.querySelector('#aq-label'),
      city: root.querySelector('#aq-city'),
      index: root.querySelector('#aq-index'),
      scaleCap: root.querySelector('#aq-scale-cap'),
      word: root.querySelector('#aq-word'),
      sub: root.querySelector('#aq-sub'),
      scale: scale,
      fill: scale && scale.querySelector('.aq-fill'),
      marker: root.querySelector('#aq-marker'),
      poll: root.querySelector('#aq-poll'),
      extra: root.querySelector('#aq-extra'),
      age: root.querySelector('#aq-age')
    };
  }

  function setLanguage(lang) {
    S.lang = (lang === 'tr' || String(lang || '').indexOf('tr') === 0) ? 'tr' : 'en';
  }

  function applyLabels() {
    if (!S.el.label) return;
    setText(S.el.label, t('label'));
    ensurePollItems();
    renderAge();
  }

  function subscribeLanguage() {
    if (S.langUnsub) {
      try { S.langUnsub(); } catch (e) { /* noop */ }
      S.langUnsub = null;
    }
    if (S.langHandler) return;
    S.langHandler = function (lang) {
      setLanguage(lang);
      applyLabels();
      load();                    // the geocoder is language-aware, so refetch
    };
    try {
      var sdk = window.WallCraft;
      if (sdk && typeof sdk.onLanguageChange === 'function') {
        var u = sdk.onLanguageChange(S.langHandler);
        if (typeof u === 'function') S.langUnsub = u;
      }
    } catch (e) {
      console.warn('[hava-kalitesi] language subscription unavailable:', e && e.message);
    }
  }

  function stopTimer() {
    if (S.timerId) { clearInterval(S.timerId); S.timerId = null; }
    S.running = false;
  }

  function startTimer() {
    stopTimer();
    S.timerId = setInterval(function () {
      renderAge();
      var due = clampNum(S.cfg.refreshMinutes, 5, 180, 15) * 60000;
      if (S.lastTryAt === 0 || Date.now() - S.lastTryAt >= due) load();
    }, 1000);
    S.running = true;
  }

  function mount(container, config) {
    if (container) S.container = container;
    cacheEls(container);
    if (!S.root) {
      console.error('[hava-kalitesi] #aq-root not found - widget.html was not loaded.');
      return;
    }
    if (config && typeof config === 'object') Object.assign(S.cfg, config);
    setLanguage((window.WallCraft && window.WallCraft.language) || 'en');
    subscribeLanguage();
    applyLabels();
    load();
    startTimer();
    console.log('[hava-kalitesi] mounted:', S.cfg.city);
  }

  window.WallCraftWidget = {
    container: null,

    init: function (container, config) {
      this.container = container;
      if (config && typeof config === 'object') Object.assign(S.cfg, config);
      cacheEls(container);
      if (S.root) mount(container, config);
      else ready(function () { mount(container, config); });
    },

    update: function (config) {
      if (config && typeof config === 'object') Object.assign(S.cfg, config);
      if (!S.root) cacheEls(S.container);
      if (!S.root) return;
      applyLabels();
      load();                    // a new city or coordinate must refetch
    },

    pause: function () { stopTimer(); },

    resume: function () {
      if (!S.running) { renderAge(); load(); startTimer(); }
    },

    destroy: function () {
      S.gen++;
      S.loading = false;
      stopTimer();
      if (S.langUnsub) {
        try { S.langUnsub(); } catch (e) { /* noop */ }
        S.langUnsub = null;
      }
      S.langHandler = null;
      S.el = {};
      S.pollItems = [];
      S.root = null;
      S.gotState = false;
      S.coords = null;
      this.container = null;
      S.container = null;
      console.log('[hava-kalitesi] destroyed.');
    }
  };

  /* Local browser preview: real API, real data, no host needed. */
  ready(function () {
    if (window.WallCraft) return;
    // Define the language BEFORE mount(): mount() reads
    // (window.WallCraft && window.WallCraft.language) || 'en', so without this
    // the 'tr' set here would immediately be overwritten with 'en'.
    window.WallCraft = { language: 'tr' };
    mount(null, DEFAULT_CONFIG);
  });
})();
