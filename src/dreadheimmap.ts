// --- Dreadheim Forest Entrance Scene ---
const canvas = document.getElementById("map") as HTMLCanvasElement;
const ctx = canvas.getContext("2d")!;
canvas.width = window.innerWidth;
canvas.height = window.innerHeight;

// Load background
const bg = new Image();
bg.src = "/guildbook/maps/dreadheimforest.png"; // ensure this matches your image path

// Simple player sprite (can replace later)
const player = {
  x: canvas.width / 2 - 16,
  y: canvas.height - 120,
  speed: 3,
  sprite: new Image(),
};
player.sprite.src = "/guildbook/avatars/dreadheim-warrior.png"; // optional

// Draw everything
function draw() {
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  if (bg.complete) ctx.drawImage(bg, 0, 0, canvas.width, canvas.height);
  if (player.sprite.complete) ctx.drawImage(player.sprite, player.x, player.y, 64, 64);
  requestAnimationFrame(draw);
}
draw();

// Move player
window.addEventListener("keydown", (e) => {
  switch (e.key) {
    case "ArrowLeft": player.x -= player.speed; break;
    case "ArrowRight": player.x += player.speed; break;
    case "ArrowUp": player.y -= player.speed; break;
    case "ArrowDown": player.y += player.speed; break;
  }
});

