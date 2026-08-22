window.QuoteZenWidget = (function() {
  const quotes = [
    { text: 'Simplicity is the ultimate sophistication.', author: 'Leonardo da Vinci' },
    { text: 'Focus on being productive instead of busy.', author: 'Tim Ferriss' },
    { text: 'The journey of a thousand miles begins with one step.', author: 'Lao Tzu' },
    { text: 'Make each day your masterpiece.', author: 'John Wooden' }
  ];

  return {
    init: function(el) {
      const textEl = el.querySelector('#zen-quote-text');
      const authEl = el.querySelector('#zen-quote-author');
      let idx = 0;

      el.addEventListener('click', () => {
        idx = (idx + 1) % quotes.length;
        if (textEl) textEl.textContent = quotes[idx].text;
        if (authEl) authEl.textContent = `— ${quotes[idx].author}`;
      });
    }
  };
})();
