window.RetroClockWidget = (function() {
  return {
    init: function(el) {
      const timeEl = el.querySelector('#retro-time-display');
      const dateEl = el.querySelector('#retro-date-display');

      function update() {
        const d = new Date();
        if (timeEl) timeEl.textContent = d.toTimeString().split(' ')[0];
        if (dateEl) dateEl.textContent = d.toLocaleDateString(undefined, { weekday: 'long', month: 'short', day: 'numeric' }).toUpperCase();
      }

      update();
      setInterval(update, 1000);
    }
  };
})();
