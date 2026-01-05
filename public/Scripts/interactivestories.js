// interactivestories.js
// Start screen logic for Interactive Game

document.addEventListener('DOMContentLoaded', () => {
  const startBtn = document.getElementById('startGameBtn');

  if (!startBtn) {
    console.warn('Start Game button not found');
    return;
  }

  startBtn.addEventListener('click', () => {
    console.log('Start Game clicked');

    // TEMP: proof it works
    // Later you can change this to:
    // window.location.href = '/game.html';

    startBtn.disabled = true;
    startBtn.textContent = 'LOADING...';

    // small cinematic delay
    setTimeout(() => {
      alert('Game start hook works 👍');
    }, 600);
  });
});
