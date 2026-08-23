(function () {
  const noteInput = document.getElementById('neon-note-input');
  if (!noteInput) return;
  const saved = localStorage.getItem('neon_note_content');
  if (saved) noteInput.value = saved;
  noteInput.addEventListener('input', () => {
    localStorage.setItem('neon_note_content', noteInput.value);
  });
})();
