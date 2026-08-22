window.SystemCapsuleWidget = (function() {
  return {
    init: function(el) {
      const cpuEl = el.querySelector('#sys-cpu-val');
      const ramEl = el.querySelector('#sys-ram-val');

      setInterval(() => {
        if (window.wallcraft?.getSystemStats) {
          window.wallcraft.getSystemStats().then(stats => {
            if (stats && cpuEl) cpuEl.textContent = `${Math.round(stats.cpuUsage || 18)}%`;
            if (stats && ramEl) ramEl.textContent = `${((stats.memoryUsedBytes || 4500000000) / 1073741824).toFixed(1)} GB`;
          }).catch(() => {});
        } else {
          const fakeCpu = Math.round(15 + Math.random() * 12);
          if (cpuEl) cpuEl.textContent = `${fakeCpu}%`;
        }
      }, 3000);
    }
  };
})();
