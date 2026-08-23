(function () {
  const cpuEl = document.getElementById('neon-cpu-val');
  const ramEl = document.getElementById('neon-ram-val');
  if (window.wallcraft?.systemMonitor?.onStatsUpdate) {
    window.wallcraft.systemMonitor.onStatsUpdate((stats) => {
      if (cpuEl && stats.cpu !== undefined) cpuEl.textContent = `${Math.round(stats.cpu)}%`;
      if (ramEl && stats.memory?.usagePercent !== undefined) ramEl.textContent = `${Math.round(stats.memory.usagePercent)}%`;
    });
  }
})();
