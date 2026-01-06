// interactivestories.js
// Start screen logic for Interactive Game (with Resume)

document.addEventListener('DOMContentLoaded', () => {
  const startBtn = document.getElementById('startGameBtn');

  if (!startBtn) {
    console.warn('Start Game button not found');
    return;
  }

  // If player already has progress, show Resume
  const hasSave =
    localStorage.getItem('va_save_active') === '1' ||
    !!localStorage.getItem('va_episode') ||
    !!localStorage.getItem('va_screen');

  if (hasSave) {
    startBtn.textContent = 'RESUME QUEST';
  }

  startBtn.addEventListener('click', () => {
    console.log('Start/Resume clicked');

    startBtn.disabled = true;
    startBtn.textContent = 'LOADING...';

    // If no save, start fresh at Episode 1
    if (!hasSave) {
      localStorage.setItem('va_episode', 'volume1_ep1');
      localStorage.setItem('va_screen', 'oath_trial');
      localStorage.setItem('va_save_active', '1');

      // reset only the Episode 1 trial state
      localStorage.removeItem('va_player_name');
      localStorage.removeItem('va_alignment');
      localStorage.removeItem('va_oath_idx');
      localStorage.removeItem('va_oath_good');
      localStorage.removeItem('va_oath_evil');
      localStorage.removeItem('va_oath_done');
    }

    setTimeout(() => {
      window.location.href = '/episode1.html';
    }, 600);
  });
});

