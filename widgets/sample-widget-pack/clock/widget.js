(function () {
  function updateTime() {
    const now = new Date();
    const timeEl = document.getElementById('neon-clock-time');
    const dateEl = document.getElementById('neon-clock-date');
    if (timeEl) {
      const h = String(now.getHours()).padStart(2, '0');
      const m = String(now.getMinutes()).padStart(2, '0');
      timeEl.textContent = `${h}:${m}`;
    }
    if (dateEl) {
      dateEl.textContent = now.toLocaleDateString(undefined, { weekday: 'long', month: 'short', day: 'numeric' }).toUpperCase();
    }
  }
  updateTime();
  setInterval(updateTime, 1000);
})();
