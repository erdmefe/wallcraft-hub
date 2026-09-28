/**
 * WallCraft — "Piyasa" community widget
 * -------------------------------------------------------------------------
 * PROBLEM SOLVED
 *   "Dolar / euro ne kadar, TL ne yapti, kripto dustu mu?" — answered live on
 *   the desktop, with a real price history instead of a bare number.
 *
 * DATA (no API key, permissive CORS — both verified reachable from the sandbox)
 *   FX      https://api.frankfurter.dev  (ECB daily reference rates + series)
 *   fallback https://open.er-api.com    (used if frankfurter is unreachable)
 *   crypto  https://api.coingecko.com   (live price + 24h change)
 *
 * Sandbox notes
 *   - The runtime injects a CSP whose connect-src is 'self' https: data: blob:,
 *     so https fetches are allowed; the APIs above send Access-Control-Allow-Origin.
 *   - Every fetch is abortable, time-boxed and failure-tolerant: a dead source
 *     degrades to "—" and a stale badge, never to a broken widget.
 *   - One interval only; released in pause() and destroy().
 */

(function () {
  'use strict';

  var FX_PRIMARY = 'https://api.frankfurter.dev/v1/';
  var FX_FALLBACK = 'https://open.er-api.com/v6/latest/';
  var CRYPTO = 'https://api.coingecko.com/api/v3/';
  var TIMEOUT = 9000;

  var I18N = {
    en: {
      markets: 'MARKETS', refresh: 'Refresh', updated: 'updated', stale: 'stale',
      change: 'period change', none: 'None', source: 'Data: European Central Bank',
      sourceCrypto: ' + CoinGecko', loading: 'Loading…', unavailable: 'no data',
      day: 'd', min: 'm', hour: 'h', h24: '24h'
    },
    tr: {
      markets: 'PİYASA', refresh: 'Yenile', updated: 'güncellendi', stale: 'bayat',
      change: 'dönem değişimi', none: 'Yok', source: 'Veri: Avrupa Merkez Bankası',
      sourceCrypto: ' + CoinGecko', loading: 'Yükleniyor…', unavailable: 'veri yok',
      day: 'g', min: 'dk', hour: 's', h24: '24s'
    }
  };

  var DEFAULT_CONFIG = {
    base: 'USD', quote1: 'TRY', quote2: 'EUR', coin: 'bitcoin',
    sparkDays: 30, refreshMinutes: 5
  };

  var COIN_SYMBOL = {
    bitcoin: 'BTC', ethereum: 'ETH', solana: 'SOL', ripple: 'XRP',
    cardano: 'ADA', dogecoin: 'DOGE'
  };

  var S = {
    container: null, root: null, el: {}, rows: {},
    timerId: null, running: false, ticks: 0,
    lang: 'en', locale: 'en-US',
    cfg: Object.assign({}, DEFAULT_CONFIG),
    lastOkAt: 0, lastTryAt: 0, loading: false, ready: false, gen: 0,
    langHandler: null, langUnsub: null
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

  function setAttr(el, name, v) {
    if (el && el.getAttribute(name) !== v) el.setAttribute(name, v);
  }

  function cls(el, name, on) {
    if (el && el.classList) el.classList.toggle(name, !!on);
  }

  function pad2(n) { return (n < 10 ? '0' : '') + n; }

  function num(v, digits) {
    if (typeof v !== 'number' || !isFinite(v)) return '--';
    return v.toLocaleString(S.locale, {
      minimumFractionDigits: digits, maximumFractionDigits: digits
    });
  }

  function signed(v, digits) {
    if (typeof v !== 'number' || !isFinite(v)) return '--';
    return (v > 0 ? '+' : v < 0 ? '' : '') + num(v, digits) + '%';
  }

  function agoLabel(ms) {
    var s = Math.max(0, Math.round((Date.now() - ms) / 1000));
    if (s < 60) return s + 's';
    var m = Math.round(s / 60);
    if (m < 60) return m + t('min');
    return Math.floor(m / 60) + t('hour') + ' ' + (m % 60) + t('min');
  }

  function clampNum(v, min, max, fb) {
    var n = typeof v === 'number' ? v : parseInt(v, 10);
    if (isNaN(n)) n = fb;
    return Math.min(max, Math.max(min, n));
  }

  function isoDaysAgo(n) {
    var d = new Date(Date.now() - n * 86400000);
    return d.getFullYear() + '-' + pad2(d.getMonth() + 1) + '-' + pad2(d.getDate());
  }

  /** fetch + JSON + hard timeout; never throws. */
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

  function pickRate(src, code) {
    if (!src) return null;
    if (src[code] != null) return src[code];
    var up = code.toUpperCase();
    return src[up] != null ? src[up] : null;
  }

  function fetchSeries(days, base, quote) {
    var start = isoDaysAgo(days);
    var end = isoDaysAgo(0);
    return getJSON(FX_PRIMARY + start + '..' + end + '?base=' + base + '&symbols=' + quote)
      .then(function (j) {
        var rates = j && j.rates;
        if (!rates) throw new Error('no series');
        var pts = Object.keys(rates)
          .sort()
          .map(function (d) { return { d: d, v: pickRate(rates[d], quote) }; })
          .filter(function (p) { return typeof p.v === 'number'; });
        if (pts.length < 2) throw new Error('series too short');
        return pts;
      });
  }

  function fetchSpot(base, quote) {
    return getJSON(FX_PRIMARY + 'latest?base=' + base + '&symbols=' + quote)
      .then(function (j) {
        var v = j && j.rates && pickRate(j.rates, quote);
        if (typeof v !== 'number') throw new Error('no spot');
        return { rate: v, date: j.date || '' };
      })
      .catch(function () {
        return getJSON(FX_FALLBACK + base).then(function (j) {
          var v = j && j.rates && pickRate(j.rates, quote);
          if (typeof v !== 'number') throw new Error('no fallback spot');
          return { rate: v, date: '' };
        });
      });
  }

  function fetchCoin(id) {
    return getJSON(CRYPTO + 'coins/markets?vs_currency=usd&ids=' + id + '&price_change_percentage=24h')
      .then(function (j) {
        var row = Array.isArray(j) && j[0];
        if (!row) throw new Error('no coin');
        return {
          symbol: (row.symbol || '').toUpperCase() || (COIN_SYMBOL[id] || id).toUpperCase(),
          price: row.current_price,
          change: row.price_change_percentage_24h
        };
      });
  }

  /* ---------------------------------------------------------------- render */

  function drawSpark(points) {
    var line = S.el.sparkLine;
    var area = S.el.sparkArea;
    if (!line) return;
    if (!points || points.length < 2) {
      line.setAttribute('points', '');
      if (area) area.setAttribute('points', '');
      return;
    }

    var vals = points.map(function (p) { return p.v; });
    var min = Math.min.apply(null, vals);
    var max = Math.max.apply(null, vals);
    var span = (max - min) || Math.abs(max) || 1;
    var W = 300, H = 44, pad = 2.5;
    var n = vals.length;
    var out = [];
    for (var i = 0; i < n; i++) {
      var x = (i / (n - 1)) * W;
      var y = H - pad - ((vals[i] - min) / span) * (H - pad * 2);
      out.push(x.toFixed(1) + ',' + y.toFixed(1));
    }
    line.setAttribute('points', out.join(' '));
    if (area) area.setAttribute('points', '0,' + H + ' ' + out.join(' ') + ' ' + W + ',' + H);

    // colour the trend: rising = up, falling = down
    var rising = vals[n - 1] >= vals[0];
    S.el.spark.style.color = rising ? 'var(--px-up)' : 'var(--px-down)';
  }

  function renderState(data) {
    var e = S.el;
    var base = S.cfg.base, q1 = S.cfg.quote1;

    setText(e.heroPair, base + ' / ' + q1);
    // base quoted against itself -> no meaningful rate, show a dash not a fake 1
    if (q1 === base) setText(e.heroNum, '—');
    else setText(e.heroNum, data.spot ? num(data.spot.rate, 4) : t('unavailable'));

    if (data.spot) {
      setText(e.src, t('source') + (data.coin ? t('sourceCrypto') : ''));
    }

    // period change from the real series
    if (q1 !== base && data.points && data.points.length >= 2) {
      var a = data.points[0].v, b = data.points[data.points.length - 1].v;
      var chg = a ? ((b - a) / a) * 100 : null;
      setText(e.changeChip, chg === null ? '--' : signed(chg, 2));
      cls(e.changeChip, 'is-up', chg !== null && chg > 0.005);
      cls(e.changeChip, 'is-down', chg !== null && chg < -0.005);
      setText(e.changeCap, t('change') + ' · ' + data.points.length + t('day'));
    } else {
      setText(e.changeChip, '--');
      cls(e.changeChip, 'is-up', false);
      cls(e.changeChip, 'is-down', false);
      setText(e.changeCap, t('change'));
    }

    drawSpark(q1 === base ? null : data.points);

    // secondary FX
    var q2 = S.cfg.quote2;
    if (!q2) {
      setText(e.cap2, t('none'));
      setText(e.num2, '-');
    } else {
      setText(e.cap2, base + ' / ' + q2);
      if (q2 === base) setText(e.num2, '—');
      else {
        var r2 = data.secondary ? data.secondary.rate : null;
        setText(e.num2, r2 === null ? t('unavailable') : num(r2, 4));
      }
    }

    // crypto
    if (data.coin) {
      setText(e.capCoin, data.coin.symbol + ' / USD');
      setText(e.numCoin, data.coin.price === null || data.coin.price === undefined
        ? t('unavailable') : '$' + num(data.coin.price, data.coin.price < 100 ? 2 : 0));
      var cc = typeof data.coin.change === 'number' ? data.coin.change : null;
      setText(e.subCoin, cc === null ? '' : signed(cc, 2) + '  ' + t('h24'));
      cls(e.subCoin, 'is-up', cc !== null && cc > 0.005);
      cls(e.subCoin, 'is-down', cc !== null && cc < -0.005);
    } else {
      setText(e.capCoin, t('none'));
      setText(e.numCoin, '-');
      setText(e.subCoin, '');
      cls(e.subCoin, 'is-up', false);
      cls(e.subCoin, 'is-down', false);
    }
  }

  function renderAge() {
    var e = S.el;
    if (!e.age) return;
    if (S.loading) { setText(e.age, t('loading')); return; }
    if (!S.lastOkAt) {
      // never succeeded: either still the very first tick, or every source is down
      setText(e.age, S.lastTryAt ? t('unavailable') : '-');
      cls(e.age, 'is-stale', !!S.lastTryAt);
      return;
    }
    var mins = Math.floor((Date.now() - S.lastOkAt) / 60000);
    var due = clampNum(S.cfg.refreshMinutes, 1, 120, 5);
    setText(e.age, t('updated') + ' ' + agoLabel(S.lastOkAt));
    cls(e.age, 'is-stale', mins > due * 2);
  }

  /* ------------------------------------------------------------------ load */

  function load() {
    if (S.loading) return Promise.resolve();
    S.loading = true;
    setAttr(S.el.refresh, 'disabled', 'true');
    renderAge();

    // Generation token: a config change (or teardown) while a request is still
    // in flight must NOT let the stale response render under the new labels.
    S.gen++;
    var gen = S.gen;

    var base = S.cfg.base, q1 = S.cfg.quote1, q2 = S.cfg.quote2, coin = S.cfg.coin;
    var days = clampNum(S.cfg.sparkDays, 7, 180, 30);

    // A currency quoted against itself is meaningless (always exactly 1), and
    // asking the API for it would waste a request and render a fake number.
    var e1 = (q1 && q1 !== base) ? q1 : null;
    var e2 = (q2 && q2 !== base) ? q2 : null;

    // Every branch is caught individually: one dead source must degrade its own
    // card only, and must still let the rest of the widget render.
    var spotP = e1 ? fetchSpot(base, e1).catch(function () { return null; }) : Promise.resolve(null);
    var seriesP = e1 ? fetchSeries(days, base, e1).catch(function () { return null; }) : Promise.resolve(null);
    var secondP = e2 ? fetchSpot(base, e2).catch(function () { return null; }) : Promise.resolve(null);
    var coinP = coin ? fetchCoin(coin).catch(function () { return null; }) : Promise.resolve(null);

    return Promise.all([spotP, seriesP, secondP, coinP])
      .then(function (res) {
        if (gen !== S.gen || !S.root) return;      // superseded — drop it
        var data = {
          spot: res[0] || null,
          points: res[1] || null,
          secondary: res[2] || null,
          coin: res[3] || null
        };
        if (data.spot || data.secondary || data.coin) S.lastOkAt = Date.now();
        S.ready = true;
        renderState(data);
      })
      .catch(function (err) {
        if (gen !== S.gen) return;
        console.warn('[piyasa] load failed:', err && err.message);
      })
      .finally(function () {
        if (gen !== S.gen) return;                // a newer load owns the state now
        S.loading = false;
        // Always record the attempt, even a failed one, so a dead data source
        // cannot turn the scheduler into a once-per-second request loop.
        S.lastTryAt = Date.now();
        setAttr(S.el.refresh, 'disabled', null);
        renderAge();
      });
  }

  /* ------------------------------------------------------------- lifecycle */

  function cacheEls(container) {
    var root = null;
    if (container && container.nodeType === 1) {
      if (container.id === 'px-root') root = container;
      else if (typeof container.querySelector === 'function') root = container.querySelector('#px-root');
    }
    if (!root) root = document.getElementById('px-root');
    S.root = root;
    if (!root) { S.el = {}; return; }

    S.el = {
      root: root,
      label: root.querySelector('#px-label'),
      age: root.querySelector('#px-age'),
      heroNum: root.querySelector('#px-hero-num'),
      heroPair: root.querySelector('#px-hero-pair'),
      changeChip: root.querySelector('#px-change-chip'),
      changeCap: root.querySelector('#px-change-cap'),
      spark: root.querySelector('#px-spark'),
      sparkLine: root.querySelector('#px-spark-line'),
      sparkArea: root.querySelector('#px-spark-area'),
      cap2: root.querySelector('#px-cap-2'),
      num2: root.querySelector('#px-num-2'),
      capCoin: root.querySelector('#px-cap-coin'),
      numCoin: root.querySelector('#px-num-coin'),
      subCoin: root.querySelector('#px-sub-coin'),
      src: root.querySelector('#px-src'),
      refresh: root.querySelector('#px-refresh')
    };
    S.rows = {};
  }

  function setLanguage(lang) {
    S.lang = (lang === 'tr' || String(lang || '').indexOf('tr') === 0) ? 'tr' : 'en';
    S.locale = S.lang === 'tr' ? 'tr-TR' : 'en-US';
  }

  function applyLabels() {
    if (!S.el.label) return;
    setText(S.el.label, t('markets'));
    setText(S.el.refresh, t('refresh'));
  }

  function subscribeLanguage() {
    if (S.langUnsub) {
      try { S.langUnsub(); } catch (err) { /* noop */ }
      S.langUnsub = null;
    }
    if (S.langHandler) return;
    S.langHandler = function (lang) {
      setLanguage(lang);
      applyLabels();
      renderAge();
      load();                     // re-format the numbers in the new locale
    };
    try {
      if (window.WallCraft && typeof window.WallCraft.onLanguageChange === 'function') {
        var u = window.WallCraft.onLanguageChange(S.langHandler);
        if (typeof u === 'function') S.langUnsub = u;
      }
    } catch (err) {
      console.warn('[piyasa] language subscription unavailable:', err && err.message);
    }
  }

  function stopTimer() {
    if (S.timerId) { clearInterval(S.timerId); S.timerId = null; }
    S.running = false;
  }

  function startTimer() {
    stopTimer();
    S.timerId = setInterval(function () {
      S.ticks++;
      renderAge();
      var due = clampNum(S.cfg.refreshMinutes, 1, 120, 5) * 60000;
      if (S.lastTryAt === 0 || Date.now() - S.lastTryAt >= due) load();
    }, 1000);
    S.running = true;
  }

  function mount(container, config) {
    if (container) S.container = container;
    cacheEls(container);
    if (!S.root) {
      console.error('[piyasa] #px-root not found - widget.html was not loaded.');
      return;
    }
    if (config && typeof config === 'object') Object.assign(S.cfg, config);

    setLanguage((window.WallCraft && window.WallCraft.language) || 'en');
    applyLabels();
    subscribeLanguage();

    if (S.el.refresh && !S.el.refresh.__bound) {
      S.el.refresh.__bound = true;
      S.el.refresh.addEventListener('click', function () { load(); });
    }

    renderAge();
    load();
    startTimer();
    console.log('[piyasa] mounted:', S.cfg.base + '/' + S.cfg.quote1, 'coin:', S.cfg.coin || '-');
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
      S.lastOkAt = 0;              // force a refresh with the new config
      load();
    },

    pause: function () {
      stopTimer();
    },

    resume: function () {
      if (!S.running) { renderAge(); load(); startTimer(); }
    },

    destroy: function () {
      S.gen++;                            // orphan any in-flight request
      S.loading = false;
      stopTimer();
      if (S.langUnsub) {
        try { S.langUnsub(); } catch (err) { /* noop */ }
        S.langUnsub = null;
      }
      S.langHandler = null;
      S.el = {};
      S.rows = {};
      S.root = null;
      this.container = null;
      S.container = null;
      console.log('[piyasa] destroyed.');
    }
  };

  /* Local browser preview when there is no WallCraft host. */
  ready(function () {
    if (window.WallCraft) return;
    setLanguage('tr');
    mount(null, DEFAULT_CONFIG);
  });
})();
