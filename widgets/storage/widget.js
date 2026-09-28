/**
 * WallCraft — "Depolama" (storage inventory) community widget
 * -------------------------------------------------------------------------
 * PROBLEM SOLVED
 *   "Which drive is filling up, and is that drive a slow HDD?" — answered on
 *   the desktop, per volume, with the physical disk behind it.
 *
 * WHY THIS IS NOT THE BUILT-IN system-monitor
 *   The system monitor renders disks as a percentage in a ring. This is an
 *   inventory: one row per volume with its label, capacity, free space, the
 *   physical model, and the bus type the host reports (NVMe SSD / SSD / HDD /
 *   Removable). The type is what tells you whether the slow disk is the one
 *   that is full.
 *
 * DATA
 *   WallCraft.getSystemStats() -> { disks: [{ id, name, model, letter, type,
 *                                            total, free, used, usage }], ... }
 *   The host samples disks with fs.statfsSync and caches them for 15 s, so a
 *   slow poll is not wasteful; default is every 2 minutes.
 *
 * Honesty notes
 *   - Sizes come from the OS in bytes. They are shown in decimal GB/TB, which
 *     is how drive capacity is marketed, not in GiB.
 *   - `type` and `model` are printed exactly as the host reports them. The
 *     widget never guesses a bus type the host did not provide.
 */

(function () {
  'use strict';

  var I18N = {
    en: {
      label: 'STORAGE', free: 'free', noDisks: 'no volumes reported',
      of: 'of', updated: 'updated', unavailable: 'storage unavailable',
      needPermission: 'needs "system-stats" permission', unknown: 'Unknown volume'
    },
    tr: {
      label: 'DEPOLAMA', free: 'boş', noDisks: 'disk bildirilmedi',
      of: '/', updated: 'güncellendi', unavailable: 'depolama erişilemiyor',
      needPermission: '"system-stats" izni gerekli', unknown: 'Adsız disk'
    }
  };

  var DEFAULT_CONFIG = {
    maxVolumes: 4, warnUsage: 80, showModel: true, sortByFree: false, refreshMinutes: 2
  };

  var S = {
    container: null, root: null, el: {}, rows: [],
    lang: 'en', cfg: Object.assign({}, DEFAULT_CONFIG),
    timerId: null, running: false, loading: false, gotState: false,
    lastOkAt: 0, lastTryAt: 0, gen: 0,
    disks: [], langUnsub: null, langHandler: null
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

  /** bytes -> decimal GB/TB (how drive capacity is marketed) */
  function fmtBytes(b) {
    if (typeof b !== 'number' || !isFinite(b) || b < 0) return '--';
    var tb = b / 1e12;
    if (tb >= 1) return (tb >= 100 ? tb.toFixed(0) : tb.toFixed(1)) + ' TB';
    return (b / 1e9).toFixed(b / 1e9 >= 100 ? 0 : 1) + ' GB';
  }

  function fmtAgo(ms) {
    var s = Math.max(0, Math.round((Date.now() - ms) / 1000));
    if (s < 60) return s + 's';
    var m = Math.round(s / 60);
    if (m < 60) return m + (S.lang === 'tr' ? 'dk' : 'm');
    return Math.floor(m / 60) + (S.lang === 'tr' ? 's' : 'h') + ' ' + (m % 60) + (S.lang === 'tr' ? 'dk' : 'm');
  }

  function warnUsage() { return clampNum(S.cfg.warnUsage, 60, 98, 80); }

  function usageClass(usage) {
    if (usage >= 90) return 'is-high';
    if (usage >= warnUsage()) return 'is-mid';
    return '';
  }

  /* ---------------------------------------------------------------- render */

  function normalise(stats) {
    var list = stats && Array.isArray(stats.disks) ? stats.disks : [];
    return list.filter(function (d) { return d && typeof d.total === 'number' && d.total > 0; })
      .map(function (d) {
        var total = d.total;
        var free = typeof d.free === 'number' ? d.free : (total - (d.used || 0));
        // trust the host's percentage when present, else derive it
        var usage = typeof d.usage === 'number' ? d.usage
          : (total > 0 ? Math.round(((total - free) / total) * 1000) / 10 : 0);
        return {
          letter: d.letter || d.id || '?',
          name: d.name || '',
          model: d.model || '',
          type: d.type || '',
          total: total,
          free: Math.max(0, free),
          usage: clamp(usage, 0, 100)
        };
      });
  }

  function ensureRows(n) {
    var box = S.el.list;
    if (!box) return;
    S.rows = [];
    box.innerHTML = '';
    for (var i = 0; i < n; i++) {
      var row = document.createElement('div');
      row.className = 'dp-row';
      row.innerHTML =
        '<span class="dp-letter" data-l></span>' +
        '<span class="dp-mid"><span class="dp-name"><span data-n></span>' +
        '<i class="dp-chip" data-t></i></span>' +
        '<span class="dp-bar"><span class="dp-fill" data-f></span></span></span>' +
        '<span class="dp-val"><span class="dp-free-val" data-v></span>' +
        '<span class="dp-pct" data-p></span></span>';
      box.appendChild(row);
      S.rows.push({
        row: row,
        letter: row.querySelector('[data-l]'),
        name: row.querySelector('[data-n]'),
        chip: row.querySelector('[data-t]'),
        fill: row.querySelector('[data-f]'),
        val: row.querySelector('[data-v]'),
        pct: row.querySelector('[data-p]')
      });
    }
  }

  function render() {
    if (!S.el.list) return;

    if (!S.disks.length) {
      if (!S.rows.length) {
        var em = document.createElement('div');
        em.className = 'dp-empty';
        em.id = 'dp-empty';
        S.el.list.appendChild(em);
        S.rows = [];
      }
      setText(S.el.free, '-');
      setText(S.el.model, S.gotState ? t('noDisks') : '-');
      var e2 = S.el.list.querySelector('#dp-empty');
      if (e2) setText(e2, S.gotState ? t('noDisks') : '-');
      setText(S.el.age, S.lastOkAt ? t('updated') + ' ' + fmtAgo(S.lastOkAt) : '-');
      return;
    }

    var list = S.disks.slice();
    if (S.cfg.sortByFree) list.sort(function (a, b) { return a.free - b.free; });
    else list.sort(function (a, b) { return b.usage - a.usage; });

    var maxN = clampNum(S.cfg.maxVolumes, 1, 6, 4);
    var rows = S.rows;
    if (rows.length !== Math.min(maxN, list.length)) ensureRows(Math.min(maxN, list.length));

    var totalFree = 0;
    list.forEach(function (d) { totalFree += d.free; });

    for (var i = 0; i < rows.length; i++) {
      var r = rows[i];
      var d = list[i];
      if (!d) continue;
      var uc = usageClass(d.usage);

      setText(r.letter, d.letter);
      setText(r.name, d.name || t('unknown'));
      // the bus type is the actual answer to "is the full disk the slow one",
      // so it belongs on the row, not buried in the footer
      setText(r.chip, d.type || '');
      cls(r.chip, 'is-empty', !d.type);
      setStyle(r.fill, 'width', d.usage.toFixed(1) + '%');
      cls(r.fill, 'is-mid', uc === 'is-mid');
      cls(r.fill, 'is-high', uc === 'is-high');
      setText(r.val, fmtBytes(d.free));
      setText(r.pct, d.usage.toFixed(0) + '%');
      cls(r.pct, 'is-mid', uc === 'is-mid');
      cls(r.pct, 'is-high', uc === 'is-high');
    }

    setText(S.el.free, fmtBytes(totalFree) + ' ' + t('free'));

    // Footer names the fullest listed volume. Often the host's volume `name`
    // already IS the disk model (e.g. "TOSHIBA DT01ACA100 (D:)"), so only
    // repeat the model when it actually adds something.
    var worst = list[0];
    if (worst && S.cfg.showModel !== false) {
      var bits = [];
      if (worst.type) bits.push('<span class="dp-type">' + escapeHtml(worst.type) + '</span>');
      var label = (worst.name || '').toLowerCase();
      var model = (worst.model || '').toLowerCase();
      if (worst.model && model && label.indexOf(model) === -1) {
        bits.push(escapeHtml(worst.model));
      }
      S.el.model.innerHTML = bits.length ? (worst.letter + ' · ' + bits.join(' · ')) : '';
    } else {
      setText(S.el.model, '');
    }

    setText(S.el.age, S.lastOkAt ? t('updated') + ' ' + fmtAgo(S.lastOkAt) : '-');
  }

  function escapeHtml(s) {
    return String(s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }

  /* ------------------------------------------------------------------ load */

  function load() {
    if (S.loading) return Promise.resolve();
    S.loading = true;
    S.gen++;
    var gen = S.gen;

    var sdk = window.WallCraft;
    if (!sdk || typeof sdk.getSystemStats !== 'function') {
      S.loading = false;
      S.lastTryAt = Date.now();
      showUnavailable('needPermission');
      return Promise.resolve();
    }

    return Promise.resolve()
      .then(function () { return sdk.getSystemStats(); })
      .then(function (stats) {
        if (gen !== S.gen || !S.root) return;   // superseded by a newer request
        S.disks = normalise(stats);
        S.gotState = true;
        S.lastOkAt = Date.now();
        render();
      })
      .catch(function (err) {
        if (gen !== S.gen) return;
        console.warn('[depolama] getSystemStats failed:', err && err.message);
      })
      .finally(function () {
        if (gen !== S.gen) return;
        S.loading = false;
        // record the attempt even on failure, so an unreachable host cannot
        // turn the scheduler into a once-per-second request loop
        S.lastTryAt = Date.now();
        render();
      });
  }

  function showUnavailable(key) {
    setText(S.el.free, '-');
    setText(S.el.model, t(key));
    setText(S.el.age, '-');
    var e = S.el.list && S.el.list.querySelector('#dp-empty');
    if (e) setText(e, t(key));
  }

  /* ------------------------------------------------------------- lifecycle */

  function cacheEls(container) {
    var root = null;
    if (container && container.nodeType === 1) {
      if (container.id === 'dp-root') root = container;
      else if (typeof container.querySelector === 'function') root = container.querySelector('#dp-root');
    }
    if (!root) root = document.getElementById('dp-root');
    S.root = root;
    if (!root) { S.el = {}; return; }

    S.el = {
      root: root,
      label: root.querySelector('#dp-label'),
      free: root.querySelector('#dp-free'),
      list: root.querySelector('#dp-list'),
      model: root.querySelector('#dp-model'),
      age: root.querySelector('#dp-age')
    };
  }

  function setLanguage(lang) {
    S.lang = (lang === 'tr' || String(lang || '').indexOf('tr') === 0) ? 'tr' : 'en';
  }

  function applyLabels() {
    if (!S.el.label) return;
    setText(S.el.label, t('label'));
    render();
  }

  function subscribeLanguage() {
    if (S.langUnsub) {
      try { S.langUnsub(); } catch (e) { /* noop */ }
      S.langUnsub = null;
    }
    if (S.langHandler) return;
    S.langHandler = function (lang) { setLanguage(lang); applyLabels(); };
    try {
      var sdk = window.WallCraft;
      if (sdk && typeof sdk.onLanguageChange === 'function') {
        var u = sdk.onLanguageChange(S.langHandler);
        if (typeof u === 'function') S.langUnsub = u;
      }
    } catch (e) {
      console.warn('[depolama] language subscription unavailable:', e && e.message);
    }
  }

  function stopTimer() {
    if (S.timerId) { clearInterval(S.timerId); S.timerId = null; }
    S.running = false;
  }

  function startTimer() {
    stopTimer();
    S.timerId = setInterval(function () {
      var due = clampNum(S.cfg.refreshMinutes, 1, 30, 2) * 60000;
      // tick the "updated Xs" label between polls too
      if (S.lastOkAt) setText(S.el.age, t('updated') + ' ' + fmtAgo(S.lastOkAt));
      if (S.lastTryAt === 0 || Date.now() - S.lastTryAt >= due) load();
    }, 1000);
    S.running = true;
  }

  function mount(container, config) {
    if (container) S.container = container;
    cacheEls(container);
    if (!S.root) {
      console.error('[depolama] #dp-root not found - widget.html was not loaded.');
      return;
    }
    if (config && typeof config === 'object') Object.assign(S.cfg, config);
    setLanguage((window.WallCraft && window.WallCraft.language) || 'en');
    subscribeLanguage();
    ensureRows(Math.min(clampNum(S.cfg.maxVolumes, 1, 6, 4), 4));
    applyLabels();
    load();
    startTimer();
    console.log('[depolama] mounted. stats api:', typeof (window.WallCraft || {}).getSystemStats);
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
      ensureRows(Math.min(clampNum(S.cfg.maxVolumes, 1, 6, 4), 4));
      applyLabels();
      load();
    },

    pause: function () { stopTimer(); },

    resume: function () {
      if (!S.running) { render(); load(); startTimer(); }
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
      S.rows = [];
      S.root = null;
      S.disks = [];
      S.gotState = false;
      this.container = null;
      S.container = null;
      console.log('[depolama] destroyed.');
    }
  };

  /* Local browser preview: a small mock so the layout can be seen in a browser. */
  ready(function () {
    if (window.WallCraft) return;
    setLanguage('tr');
    var mock = { disks: [
      { letter: 'C:', name: 'Windows', model: 'Samsung SSD 990 PRO 2TB', type: 'NVMe SSD', total: 1951e9, free: 604e9, used: 1347e9, usage: 69 },
      { letter: 'D:', name: 'Medya',   model: 'ST8000DM004 Media Archive', type: 'HDD', total: 8001e9, free: 2410e9, used: 5591e9, usage: 69.9 },
      { letter: 'E:', name: 'Yedek',   model: 'Samsung SSD 990 PRO 2TB', type: 'NVMe SSD', total: 1951e9, free: 122e9, used: 1829e9, usage: 93.7 }
    ]};
    window.WallCraft = { language: 'tr', getSystemStats: function () { return Promise.resolve(mock); } };
    mount(null, DEFAULT_CONFIG);
  });
})();
