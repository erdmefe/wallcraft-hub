(function () {
  'use strict';

  window.SimpleClockWidget = {
    timer: null,
    showSeconds: true,
    use24Hour: true,

    init: function (container, config) {
      this.container = container;
      this.timeEl = container.querySelector('#clock-time');
      this.dateEl = container.querySelector('#clock-date');

      this.updateConfig(config || {});
      this.render();
      this.timer = setInterval(() => this.render(), 1000);
    },

    updateConfig: function (config) {
      if (!config) return;

      if (config.showSeconds !== undefined) {
        this.showSeconds = Boolean(config.showSeconds);
      }

      if (config.use24Hour !== undefined) {
        this.use24Hour = Boolean(config.use24Hour);
      }

      this.render();
    },

    render: function () {
      if (!this.timeEl || !this.dateEl) return;

      const now = new Date();

      const time = now.toLocaleTimeString('tr-TR', {
        hour: '2-digit',
        minute: '2-digit',
        second: this.showSeconds ? '2-digit' : undefined,
        hour12: !this.use24Hour
      });

      const date = now.toLocaleDateString('tr-TR', {
        weekday: 'long',
        day: 'numeric',
        month: 'long'
      });

      this.timeEl.textContent = time;
      this.dateEl.textContent = date;
    },

    destroy: function () {
      if (this.timer) {
        clearInterval(this.timer);
        this.timer = null;
      }
    }
  };
})();
