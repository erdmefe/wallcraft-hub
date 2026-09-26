/**
 * WallCraft — "Team Hours" community widget
 * -------------------------------------------------------------------------
 * PROBLEM SOLVED
 *   "When is it a reasonable working hour for the people I work with?"
 *
 *   The widget shows the live local time of up to four cities next to your own
 *   clock and paints a 24-hour timeline of everybody's working hours, so the
 *   slot where all of them overlap is instantly visible.
 *
 * IMPLEMENTATION NOTES
 *   - Zero WallCraft permissions required: everything is derived from the
 *     browser's IANA timezone database (DST is handled by Intl itself).
 *   - Expensive Intl.DateTimeFormat objects are cached per zone.
 *   - A single 1s interval drives the clocks; the timeline is recomputed only
 *     when the configuration changes or every 30 seconds.
 *   - DOM writes are diff-guarded to avoid needless reflow.
 *   - Every timer / listener is released in pause() and destroy().
 */

(function () {
  'use strict';

  /* ------------------------------------------------------------------ i18n */

  var I18N = {
    en: {
      noCities: 'No city selected — pick cities in settings',
      nowOpen: 'Open now',
      nextWindow: 'Next window',
      noOverlap: 'No shared working window today',
      allDay: 'All day',
      you: 'You',
      diffH: 'h',
      durH: 'h',
      durM: 'm'
    },
    tr: {
      noCities: 'Şehir seçilmedi — ayarlardan şehir ekle',
      nowOpen: 'Şu an uygun',
      nextWindow: 'Sonraki pencere',
      noOverlap: 'Bugün için ortak mesai penceresi yok',
      allDay: 'Tüm gün',
      you: 'Sen',
      diffH: 'sa',
      durH: 's',
      durM: 'dk'
    }
  };

  /* ------------------------------------------------- display names per zone */

  var CITY_NAMES = {
    'Europe/Istanbul': 'Istanbul',
    'Europe/London': 'London',
    'Europe/Dublin': 'Dublin',
    'Europe/Lisbon': 'Lisbon',
    'Europe/Madrid': 'Madrid',
    'Europe/Paris': 'Paris',
    'Europe/Berlin': 'Berlin',
    'Europe/Amsterdam': 'Amsterdam',
    'Europe/Stockholm': 'Stockholm',
    'Europe/Oslo': 'Oslo',
    'Europe/Warsaw': 'Warsaw',
    'Europe/Prague': 'Prague',
    'Europe/Kyiv': 'Kyiv',
    'Europe/Moscow': 'Moscow',
    'Europe/Athens': 'Athens',
    'Africa/Cairo': 'Cairo',
    'Africa/Lagos': 'Lagos',
    'Africa/Nairobi': 'Nairobi',
    'Africa/Johannesburg': 'Johannesburg',
    'Asia/Jerusalem': 'Jerusalem',
    'Asia/Dubai': 'Dubai',
    'Asia/Karachi': 'Karachi',
    'Asia/Kolkata': 'Kolkata',
    'Asia/Dhaka': 'Dhaka',
    'Asia/Bangkok': 'Bangkok',
    'Asia/Jakarta': 'Jakarta',
    'Asia/Singapore': 'Singapore',
    'Asia/Hong_Kong': 'Hong Kong',
    'Asia/Shanghai': 'Shanghai',
    'Asia/Taipei': 'Taipei',
    'Asia/Seoul': 'Seoul',
    'Asia/Tokyo': 'Tokyo',
    'Australia/Perth': 'Perth',
    'Australia/Sydney': 'Sydney',
    'Pacific/Auckland': 'Auckland',
    'America/St_Johns': "St. John's",
    'America/Halifax': 'Halifax',
    'America/New_York': 'New York',
    'America/Toronto': 'Toronto',
    'America/Chicago': 'Chicago',
    'America/Mexico_City': 'Mexico City',
    'America/Bogota': 'Bogota',
    'America/Sao_Paulo': 'Sao Paulo',
    'America/Denver': 'Denver',
    'America/Phoenix': 'Phoenix',
    'America/Los_Angeles': 'Los Angeles',
    'America/Vancouver': 'Vancouver',
    'UTC': 'UTC'
  };

  var SLOT_MIN = 30;                 // timeline resolution
  var SLOTS = 1440 / SLOT_MIN;       // 48 half-hour slots
  var STRIP_REFRESH_TICKS = 30;      // recompute timeline every 30 seconds

  var DEFAULT_CONFIG = {
    cardTitle: 'TEAM HOURS',
    city1: 'Europe/London',
    city2: 'America/New_York',
    city3: 'Asia/Tokyo',
    city4: '',
    use24h: true,
    workStart: 9,
    workEnd: 18,
    includeSelf: true,
    showStrip: true
  };

  var SUN_SVG =
    '<svg class="tz-phase tz-phase-sun" viewBox="0 0 16 16" aria-hidden="true">' +
    '<circle cx="8" cy="8" r="3.8"/>' +
    '<g stroke="currentColor" stroke-width="1.15" stroke-linecap="round">' +
    '<line x1="8" y1="1.6" x2="8" y2="3.4"/><line x1="8" y1="14.4" x2="8" y2="12.6"/>' +
    '<line x1="1.6" y1="8" x2="3.4" y2="8"/><line x1="14.4" y1="8" x2="12.6" y2="8"/>' +
    '<line x1="3.5" y1="3.5" x2="4.8" y2="4.8"/><line x1="12.5" y1="3.5" x2="11.2" y2="4.8"/>' +
    '<line x1="12.5" y1="12.5" x2="11.2" y2="11.2"/><line x1="3.5" y1="12.5" x2="4.8" y2="11.2"/>' +
    '</g></svg>';

  var MOON_SVG =
    '<svg class="tz-phase tz-phase-moon" viewBox="0 0 16 16" aria-hidden="true">' +
    '<path d="M12.9 10.6A5.4 5.4 0 0 1 5.4 3.1 5.7 5.7 0 1 0 12.9 10.6Z"/></svg>';

  /* ------------------------------------------------------------------ state */

  var S = {
    container: null,
    root: null,
    el: {},
    timerId: null,
    ticks: 0,
    lang: 'en',
    locale: 'en-US',
    cfg: Object.assign({}, DEFAULT_CONFIG),
    rows: [],
    fmtCache: new Map(),
    langHandler: null,
    langUnsub: null,
    selfZone: 'UTC',
    running: false
  };

  /* ------------------------------------------------------------- utilities */

  function t(key) {
    var dict = I18N[S.lang] || I18N.en;
    return dict[key] != null ? dict[key] : (I18N.en[key] || key);
  }

  function ready(fn) {
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', fn, { once: true });
    } else {
      fn();
    }
  }

  /** Write text only when it actually changed (avoids needless reflow). */
  function setText(el, value) {
    if (el && el.__tzText !== value) {
      el.textContent = value;
      el.__tzText = value;
    }
  }

  function setAttr(el, name, value) {
    if (el && el.getAttribute(name) !== value) el.setAttribute(name, value);
  }

  function clampNum(value, min, max, fallback) {
    var n = typeof value === 'number' ? value : parseInt(value, 10);
    if (isNaN(n)) n = fallback;
    return Math.min(max, Math.max(min, n));
  }

  function normMin(min) {
    return ((min % 1440) + 1440) % 1440;
  }

  function pad2(n) {
    return (n < 10 ? '0' : '') + n;
  }

  function cityName(tz) {
    return CITY_NAMES[tz] || String(tz).split('/').pop().replace(/_/g, ' ');
  }

  function isValidZone(tz) {
    if (typeof tz !== 'string' || !tz) return false;
    try {
      new Intl.DateTimeFormat('en-US', { timeZone: tz });
      return true;
    } catch (err) {
      return false;
    }
  }

  /* ------------------------------------------- cached timezone formatters */

  function formatters(tz) {
    var key = tz + '|' + S.locale + '|' + (S.cfg.use24h ? 24 : 12);
    var hit = S.fmtCache.get(key);
    if (hit) return hit;

    var numeric = new Intl.DateTimeFormat('en-US', {
      timeZone: tz,
      hour12: false,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit'
    });
    var clock = new Intl.DateTimeFormat(S.locale, {
      timeZone: tz,
      hour: '2-digit',
      minute: '2-digit',
      hour12: !S.cfg.use24h
    });
    var clockSec = new Intl.DateTimeFormat(S.locale, {
      timeZone: tz,
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hour12: !S.cfg.use24h
    });
    var dateFmt = new Intl.DateTimeFormat(S.locale, { timeZone: tz, day: 'numeric', month: 'short' });
    var weekFmt = new Intl.DateTimeFormat(S.locale, { timeZone: tz, weekday: 'short' });

    hit = { numeric: numeric, clock: clock, clockSec: clockSec, date: dateFmt, week: weekFmt };
    S.fmtCache.set(key, hit);
    return hit;
  }

  /** Calendar parts of an instant in a given zone. */
  function partsAt(tz, date) {
    var out = {};
    var list = formatters(tz).numeric.formatToParts(date);
    for (var i = 0; i < list.length; i++) out[list[i].type] = list[i].value;
    var hour = parseInt(out.hour, 10);
    if (hour === 24) hour = 0; // some engines still emit 24 for midnight
    return {
      y: parseInt(out.year, 10),
      m: parseInt(out.month, 10),
      d: parseInt(out.day, 10),
      h: hour,
      mi: parseInt(out.minute, 10),
      s: parseInt(out.second, 10)
    };
  }

  function daySerial(p) {
    return Math.floor(Date.UTC(p.y, p.m - 1, p.d) / 86400000);
  }

  function selfParts(date) {
    var p = partsAt(S.selfZone, date);
    p.serial = daySerial(p);
    p.min = p.h * 60 + p.mi;
    return p;
  }

  /* --------------------------------------------------------------- mounting */

  /**
   * Resolve this instance's root element. The host gives us a container, so we
   * look inside it first; the document id lookup stays as a fallback.
   */
  function resolveRoot(container) {
    if (container && container.nodeType === 1) {
      if (container.id === 'tz-root') return container;
      if (typeof container.querySelector === 'function') {
        var found = container.querySelector('#tz-root');
        if (found) return found;
      }
    }
    return document.getElementById('tz-root');
  }

  function cacheEls(container) {
    var root = resolveRoot(container);
    if (!root) {
      S.root = null;
      S.el = {};
      return;
    }
    S.root = root;
    S.el = {
      root: root,
      title: root.querySelector('#tz-title'),
      selfZone: root.querySelector('#self-zone'),
      selfTime: root.querySelector('#self-time'),
      selfDate: root.querySelector('#self-date'),
      rows: root.querySelector('#tz-rows'),
      strip: root.querySelector('#tz-strip'),
      axis: root.querySelector('#tz-axis'),
      bars: root.querySelector('#tz-bars'),
      overlap: root.querySelector('#tz-overlap'),
      now: root.querySelector('#tz-now'),
      note: root.querySelector('#tz-note')
    };
  }

  function selectedZones() {
    var list = [];
    var keys = ['city1', 'city2', 'city3', 'city4'];
    for (var i = 0; i < keys.length; i++) {
      var tz = S.cfg[keys[i]];
      if (!isValidZone(tz)) continue;
      var dup = false;
      for (var j = 0; j < list.length; j++) {
        if (list[j].tz === tz) { dup = true; break; }
      }
      if (dup) continue;
      if (tz === S.selfZone) continue; // that is you, already in the header
      list.push({ tz: tz, name: cityName(tz) });
    }
    return list;
  }

  function workWindow() {
    var start = clampNum(S.cfg.workStart, 0, 23, 9);
    var end = clampNum(S.cfg.workEnd, 1, 24, 18);
    if (end <= start) end = Math.min(24, start + 1);
    return { start: start * 60, end: end * 60 };
  }

  function buildRows() {
    var host = S.el.rows;
    if (!host) return;

    host.textContent = '';
    S.rows = [];

    var zones = selectedZones();

    if (zones.length === 0) {
      var empty = document.createElement('div');
      empty.className = 'tz-rows-empty';
      setText(empty, t('noCities'));
      host.appendChild(empty);
      return;
    }

    for (var i = 0; i < zones.length; i++) {
      var row = document.createElement('div');
      row.className = 'tz-row';

      var nameBox = document.createElement('div');
      nameBox.className = 'tz-row-name';
      var city = document.createElement('span');
      city.className = 'tz-city';
      city.title = zones[i].name;
      setText(city, zones[i].name);
      var weekday = document.createElement('span');
      weekday.className = 'tz-weekday';
      nameBox.appendChild(city);
      nameBox.appendChild(weekday);

      var diff = document.createElement('span');
      diff.className = 'tz-diff';

      var time = document.createElement('span');
      time.className = 'tz-time';

      var phase = document.createElement('span');
      phase.className = 'tz-phase-wrap';
      phase.innerHTML = SUN_SVG;

      row.appendChild(nameBox);
      row.appendChild(diff);
      row.appendChild(time);
      row.appendChild(phase);
      host.appendChild(row);

      S.rows.push({
        tz: zones[i].tz,
        city: city,
        weekday: weekday,
        diff: diff,
        time: time,
        phase: phase,
        isDay: null
      });
    }
  }

  /* ----------------------------------------------------------------- render */

  function renderHeader(now) {
    var f = formatters(S.selfZone);
    var p = selfParts(now);
    setText(S.el.title, S.cfg.cardTitle || 'TEAM HOURS');
    setText(S.el.selfZone, S.selfZone + (S.lang === 'tr' ? ' · yerel saat' : ' · local'));
    setText(S.el.selfTime, f.clockSec.format(now));
    setText(S.el.selfDate, f.date.format(now));
    return p;
  }

  function diffText(minutes) {
    var sign = minutes < 0 ? '-' : '+';
    var abs = Math.abs(minutes);
    var h = Math.floor(abs / 60);
    var m = abs % 60;
    return sign + (m ? h + ':' + pad2(m) : String(h)) + t('diffH');
  }

  function renderRows(now, self) {
    for (var i = 0; i < S.rows.length; i++) {
      var row = S.rows[i];
      var f = formatters(row.tz);
      var p = partsAt(row.tz, now);
      var minutes = p.h * 60 + p.mi;

      setText(row.time, f.clock.format(now));

      var shift = daySerial(p) - self.serial;
      setText(row.weekday, f.week.format(now).slice(0, 3));
      setAttr(row.weekday, 'data-shift', shift === 0 ? '0' : (shift > 0 ? '1' : '-1'));

      var diff = minutes - self.min;
      if (diff > 720) diff -= 1440;
      if (diff < -720) diff += 1440;
      setText(row.diff, diffText(diff));
      setAttr(row.diff, 'title', diffText(diff));

      var isDay = p.h >= 6 && p.h < 20;
      if (row.isDay !== isDay) {
        row.isDay = isDay;
        row.phase.innerHTML = isDay ? SUN_SVG : MOON_SVG;
      }
    }
  }

  function participants(self) {
    var win = workWindow();
    var list = [];
    var seen = {};
    if (S.cfg.includeSelf) {
      list.push({ offset: 0, start: win.start, end: win.end });
      seen[S.selfZone] = true;
    }
    for (var i = 0; i < S.rows.length; i++) {
      var row = S.rows[i];
      if (seen[row.tz]) continue;
      seen[row.tz] = true;
      var p = partsAt(row.tz, new Date());
      var off = p.h * 60 + p.mi - self.min;
      if (off > 720) off -= 1440;
      if (off < -720) off += 1440;
      list.push({ offset: off, start: win.start, end: win.end });
    }
    return list;
  }

  /** Slots where every participant is inside their working hours. */
  function overlapRanges(list) {
    var ranges = [];
    if (!list.length) return ranges;
    var open = -1;
    for (var i = 0; i < SLOTS; i++) {
      var local = i * SLOT_MIN;
      var all = true;
      for (var j = 0; j < list.length; j++) {
        var cityMin = normMin(local + list[j].offset);
        if (cityMin < list[j].start || cityMin >= list[j].end) { all = false; break; }
      }
      if (all && open === -1) open = i;
      if (!all && open !== -1) {
        ranges.push({ start: open * SLOT_MIN, end: i * SLOT_MIN });
        open = -1;
      }
    }
    if (open !== -1) ranges.push({ start: open * SLOT_MIN, end: 1440 });
    return ranges;
  }

  function clockLabel(minutes) {
    var mm = normMin(minutes);
    var h = Math.floor(mm / 60);
    var m = mm % 60;
    if (S.cfg.use24h) return pad2(h) + ':' + pad2(m);
    var suffix = mm < 720 ? 'AM' : 'PM';
    var hh = h % 12;
    if (hh === 0) hh = 12;
    return String(hh) + ':' + pad2(m) + ' ' + suffix;
  }

  function durationText(minutes) {
    var h = Math.floor(minutes / 60);
    var m = minutes % 60;
    if (h && m) return h + t('durH') + ' ' + m + t('durM');
    if (h) return h + t('durH');
    return m + t('durM');
  }

  function rangeLabel(r) {
    if (r.start === 0 && r.end === 1440) return t('allDay');
    return clockLabel(r.start) + '–' + clockLabel(r.end);
  }

  /**
   * Status line. Kept independent from the track so it stays accurate even
   * when the timeline is switched off.
   */
  function renderNote(self) {
    var note = S.el.note;
    if (!note) return;

    var list = participants(self);
    var ranges = overlapRanges(list);

    var active = null;
    var upcoming = null;
    for (var g = 0; g < ranges.length; g++) {
      var rg = ranges[g];
      if (self.min >= rg.start && self.min < rg.end) { active = rg; break; }
      if (upcoming === null && rg.start > self.min) upcoming = rg;
    }

    var text;
    var live = false;
    if (!list.length) {
      text = t('noCities');
    } else if (active) {
      live = true;
      text = t('nowOpen') + ' · ' + rangeLabel(active);
    } else if (upcoming) {
      text = t('nextWindow') + ' ' + rangeLabel(upcoming) +
        ' (' + durationText(upcoming.start - self.min) + ')';
    } else {
      text = t('noOverlap');
    }

    setText(note, text);
    setAttr(note, 'title', text);
    if (note.classList) note.classList.toggle('is-live', live);
  }

  function renderStrip(now, self) {
    var strip = S.el.strip;
    if (!strip) return;

    if (!S.cfg.showStrip) {
      strip.style.display = 'none';
      return;
    }
    strip.style.display = '';

    var list = participants(self);

    // axis labels
    if (S.el.axis) {
      var labels = ['00:00', '06:00', '12:00', '18:00'];
      if (S.el.axis.children.length !== labels.length) {
        S.el.axis.textContent = '';
        for (var a = 0; a < labels.length; a++) {
          var span = document.createElement('span');
          S.el.axis.appendChild(span);
        }
      }
      for (var b = 0; b < labels.length; b++) {
        setText(S.el.axis.children[b], S.cfg.use24h ? labels[b] : clockLabel(b * 360));
      }
    }

    // per-city working bars (percent based, so they scale with the track)
    if (S.el.bars) {
      var frag = document.createDocumentFragment();
      var n = Math.max(list.length, 1);
      var step = 100 / n;
      var barHeight = Math.min(step * 0.55, 16);
      for (var i = 0; i < list.length; i++) {
        var startPct = normMin(list[i].start - list[i].offset) / 14.4;
        var widthPct = (list[i].end - list[i].start) / 14.4;
        var bar = document.createElement('div');
        bar.className = 'tz-bar';
        bar.style.left = startPct.toFixed(2) + '%';
        bar.style.width = widthPct.toFixed(2) + '%';
        bar.style.top = (i * step + (step - barHeight) / 2).toFixed(2) + '%';
        bar.style.height = barHeight.toFixed(2) + '%';
        frag.appendChild(bar);
      }
      S.el.bars.textContent = '';
      S.el.bars.appendChild(frag);
    }

    // shared window
    var ranges = overlapRanges(list);
    if (S.el.overlap) {
      var frag2 = document.createDocumentFragment();
      for (var r = 0; r < ranges.length; r++) {
        var seg = document.createElement('div');
        seg.className = 'tz-overlap-seg';
        seg.style.left = (ranges[r].start / 14.4).toFixed(2) + '%';
        seg.style.width = ((ranges[r].end - ranges[r].start) / 14.4).toFixed(2) + '%';
        frag2.appendChild(seg);
      }
      S.el.overlap.textContent = '';
      S.el.overlap.appendChild(frag2);
    }

    // "now" marker
    if (S.el.now) {
      S.el.now.style.left = (self.min / 14.4).toFixed(2) + '%';
    }
  }

  function tick() {
    if (!S.root || !S.el.rows || !S.el.now) return;
    var now = new Date();
    var self = renderHeader(now);
    renderRows(now, self);
    S.el.now.style.left = (self.min / 14.4).toFixed(2) + '%';

    S.ticks++;
    if (S.ticks % STRIP_REFRESH_TICKS === 1) {
      renderStrip(now, self);
      renderNote(self);
    }
  }

  /* ------------------------------------------------------------- lifecycle */

  function startTimer() {
    stopTimer();
    S.timerId = setInterval(tick, 1000);
    S.running = true;
  }

  function stopTimer() {
    if (S.timerId) {
      clearInterval(S.timerId);
      S.timerId = null;
    }
    S.running = false;
  }

  function applyConfig(config) {
    if (config && typeof config === 'object') {
      Object.assign(S.cfg, config);
    }
    S.ticks = 0;
    S.fmtCache.clear();
    buildRows();
    tick();
  }

  function mount(container, config) {
    if (container) S.container = container;
    cacheEls(container);

    if (!S.root) {
      console.error('[team-hours] #tz-root not found — widget.html was not loaded.');
      return;
    }

    var lang = (window.WallCraft && window.WallCraft.language) || 'en';
    setLanguage(lang);

    subscribeLanguage();
    applyConfig(config || S.cfg);
    startTimer();

    console.log('[team-hours] mounted, zone =', S.selfZone,
      'cities =', S.rows.length);
  }

  function setLanguage(lang) {
    S.lang = (lang === 'tr' || (lang || '').toString().indexOf('tr') === 0) ? 'tr' : 'en';
    S.locale = S.lang === 'tr' ? 'tr-TR' : 'en-US';
    S.fmtCache.clear();
  }

  function subscribeLanguage() {
    if (S.langUnsub) {
      try { S.langUnsub(); } catch (err) { /* noop */ }
      S.langUnsub = null;
    }
    if (S.langHandler) return;

    S.langHandler = function (lang) {
      setLanguage(lang);
      S.ticks = 0;
      buildRows();
      tick();
    };

    try {
      if (window.WallCraft && typeof window.WallCraft.onLanguageChange === 'function') {
        var unsub = window.WallCraft.onLanguageChange(S.langHandler);
        if (typeof unsub === 'function') S.langUnsub = unsub;
      }
    } catch (err) {
      console.warn('[team-hours] language subscription unavailable:', err && err.message);
    }
  }

  function detectSelfZone() {
    try {
      var zone = Intl.DateTimeFormat().resolvedOptions().timeZone;
      S.selfZone = isValidZone(zone) ? zone : 'UTC';
    } catch (err) {
      S.selfZone = 'UTC';
    }
  }

  window.WallCraftWidget = {
    container: null,

    init: function (container, config) {
      detectSelfZone();
      this.container = container;
      if (container) S.container = container;
      if (config && typeof config === 'object') Object.assign(S.cfg, config);
      cacheEls(container);
      if (S.root) {
        mount(container, config);
      } else {
        ready(function () {
          mount(container, config);
        });
      }
    },

    update: function (config) {
      if (config && typeof config === 'object') Object.assign(S.cfg, config);
      if (!S.root) {
        cacheEls(S.container);
      }
      if (S.root) {
        applyConfig(config);
      } else {
        ready(function () {
          applyConfig(config);
        });
      }
    },

    pause: function () {
      stopTimer();
    },

    resume: function () {
      if (!S.running) {
        tick();
        startTimer();
      }
    },

    destroy: function () {
      stopTimer();
      if (S.langUnsub) {
        try { S.langUnsub(); } catch (err) { /* noop */ }
        S.langUnsub = null;
      }
      S.langHandler = null;
      S.fmtCache.clear();
      S.rows = [];
      S.el = {};
      S.root = null;
      this.container = null;
      S.container = null;
      console.log('[team-hours] destroyed.');
    }
  };

  /**
   * Local browser preview: mount with defaults so widget.html can be opened
   * directly in Chrome for styling. Inside WallCraft the SDK is present, so
   * this stays completely inert and the host drives the lifecycle.
   */
  ready(function () {
    if (window.WallCraft) return;
    detectSelfZone();
    mount(null, DEFAULT_CONFIG);
  });
})();
