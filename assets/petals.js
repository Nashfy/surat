/**
 * One canvas of petals, gold dust and stars: bursts for the opening and the finale, and something
 * gentle that keeps drifting while she reads. At most MAX particles are alive, and nothing runs
 * (no animation frames) while the canvas is empty.
 */
const PETALS = ['#F9E1DE', '#F1C6C4', '#FDF3F1', '#E6ADB0', '#F5D3CD'];
const GOLD = ['#F4E3B8', '#E6C989', '#C9A45C'];
const MAX = 90;
const TURN = Math.PI * 2;

const rand = (min, max) => min + Math.random() * (max - min);
const pick = (list) => list[Math.floor(Math.random() * list.length)];

export function createParticles(canvas) {
  const ctx = canvas.getContext('2d');
  let items = [];
  let frame = 0;
  let last = 0;
  let mode = 'none';
  let timer = 0;
  let width = 0;
  let height = 0;

  function resize() {
    const ratio = Math.min(window.devicePixelRatio || 1, 2);
    width = window.innerWidth;
    height = window.innerHeight;
    canvas.width = Math.round(width * ratio);
    canvas.height = Math.round(height * ratio);
    ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
  }

  function add(particle) {
    if (items.length >= MAX) return;
    items.push(particle);
    if (frame) return;
    canvas.hidden = false;
    resize();
    last = performance.now();
    frame = requestAnimationFrame(tick);
  }

  function tick(now) {
    const dt = Math.min(now - last, 50) / 1000;
    last = now;
    ctx.clearRect(0, 0, width, height);
    items = items.filter((particle) => {
      if (particle.wait > 0) {
        particle.wait -= dt;
        return true;
      }
      return STEP[particle.kind](particle, dt);
    });
    if (items.length) {
      frame = requestAnimationFrame(tick);
    } else {
      frame = 0;
      canvas.hidden = true;
    }
  }

  /** Each step moves one particle, draws it, and says whether it is still alive. */
  const STEP = {
    petal(p, dt) {
      p.y += p.fall * dt;
      p.sway += p.swaySpeed * dt;
      p.x += (p.drift + Math.cos(p.sway) * p.swing) * dt;
      p.spin += p.spinSpeed * dt;
      ctx.save();
      ctx.translate(p.x, p.y);
      ctx.rotate(p.spin);
      ctx.scale(1, 0.5 + 0.5 * Math.abs(Math.cos(p.sway)));
      ctx.globalAlpha = p.alpha;
      ctx.fillStyle = p.color;
      ctx.beginPath();
      ctx.moveTo(0, -p.size);
      ctx.bezierCurveTo(p.size * 0.9, -p.size * 0.55, p.size * 0.75, p.size * 0.7, 0, p.size);
      ctx.bezierCurveTo(-p.size * 0.75, p.size * 0.7, -p.size * 0.9, -p.size * 0.55, 0, -p.size);
      ctx.fill();
      ctx.restore();
      return p.y < height + 30;
    },
    gold(p, dt) {
      p.life += dt;
      const slow = Math.max(0, 1 - 1.7 * dt);
      p.vx *= slow;
      p.vy = p.vy * slow + 46 * dt;
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      const left = 1 - p.life / p.span;
      if (left <= 0) return false;
      ctx.fillStyle = p.color;
      ctx.globalAlpha = left * 0.28;
      ctx.beginPath();
      ctx.arc(p.x, p.y, p.size * 2.6, 0, TURN);
      ctx.fill();
      ctx.globalAlpha = Math.min(1, left * 1.4);
      ctx.beginPath();
      ctx.arc(p.x, p.y, p.size, 0, TURN);
      ctx.fill();
      ctx.globalAlpha = 1;
      return true;
    },
    star(p, dt) {
      p.life += dt;
      p.y += p.rise * dt;
      const part = p.life / p.span;
      if (part >= 1) return false;
      const s = p.size;
      ctx.globalAlpha = Math.sin(Math.PI * part) * (0.65 + 0.35 * Math.sin(p.phase + p.life * 7));
      ctx.fillStyle = p.color;
      ctx.beginPath();
      ctx.moveTo(p.x, p.y - s);
      ctx.quadraticCurveTo(p.x + s * 0.18, p.y - s * 0.18, p.x + s, p.y);
      ctx.quadraticCurveTo(p.x + s * 0.18, p.y + s * 0.18, p.x, p.y + s);
      ctx.quadraticCurveTo(p.x - s * 0.18, p.y + s * 0.18, p.x - s, p.y);
      ctx.quadraticCurveTo(p.x - s * 0.18, p.y - s * 0.18, p.x, p.y - s);
      ctx.fill();
      ctx.globalAlpha = 1;
      return true;
    },
  };

  const count = (kind) => items.filter((particle) => particle.kind === kind).length;

  /** A petal of a burst falls fast and bright; a calm one drifts slowly and stays faint. */
  const petal = (wait, calm) => ({
    kind: 'petal',
    wait,
    x: rand(-0.05, 1.05) * window.innerWidth,
    y: -24,
    size: calm ? rand(7, 13) : rand(8, 16),
    fall: calm ? rand(26, 46) : rand(80, 170),
    drift: rand(-16, 16),
    sway: rand(0, TURN),
    swaySpeed: rand(1.2, 2.4),
    swing: rand(12, 34),
    spin: rand(0, TURN),
    spinSpeed: rand(-2.2, 2.2),
    color: pick(PETALS),
    alpha: calm ? rand(0.5, 0.78) : rand(0.78, 0.96),
  });

  const star = (wait, x, y, size) => ({
    kind: 'star', wait, life: 0, span: rand(1.4, 2.8), x, y,
    rise: rand(-24, -6), size, phase: rand(0, TURN), color: pick(GOLD),
  });

  /**
   * 'petals': a thick fall from the top. 'gold': dust spreading from the origin (wide = a ring).
   * 'stars': sparkles twinkling around the origin.
   */
  function burst(kind, origin = { x: window.innerWidth / 2, y: window.innerHeight / 2 }, wide = false) {
    if (kind === 'petals') {
      for (let i = 0; i < 40; i += 1) add(petal(rand(0, 2.2), false));
    } else if (kind === 'gold') {
      for (let i = 0; i < (wide ? 44 : 20); i += 1) {
        const angle = rand(0, TURN);
        const speed = wide ? rand(230, 360) * (Math.random() < 0.25 ? 0.5 : 1) : rand(50, 190);
        add({
          kind: 'gold', wait: 0, life: 0, span: rand(0.9, 1.7),
          x: origin.x, y: origin.y,
          vx: Math.cos(angle) * speed, vy: Math.sin(angle) * speed - 26,
          size: rand(1.1, 3), color: pick(GOLD),
        });
      }
    } else if (kind === 'stars') {
      const spreadX = Math.min(window.innerWidth, 560);
      const spreadY = Math.min(window.innerHeight * 0.8, 520);
      for (let i = 0; i < 38; i += 1) {
        add(star(rand(0, 1.5), origin.x + rand(-0.5, 0.5) * spreadX, origin.y + rand(-0.5, 0.5) * spreadY, rand(3.5, 9)));
      }
    }
  }

  /**
   * What keeps going while nothing else happens: 'petals' (a few, slow and faint), 'stars'
   * (twinkles along the two edges of the screen, clear of the words) or 'none'.
   */
  function ambient(kind) {
    if (kind === mode) return;
    if (mode === 'petals') hurry(); // petals belong to the part she just left: they do not linger
    mode = kind;
    clearInterval(timer);
    timer = 0;
    if (kind === 'petals') {
      add(petal(0.4, true));
      timer = setInterval(() => {
        if (!document.hidden && count('petal') < 6) add(petal(0, true));
      }, 1500);
    } else if (kind === 'stars') {
      timer = setInterval(() => {
        if (document.hidden || count('star') >= 9) return;
        const side = Math.random() < 0.5 ? rand(0.01, 0.11) : rand(0.89, 0.99);
        add(star(0, side * window.innerWidth, rand(0.05, 0.95) * window.innerHeight, rand(3, 6.5)));
      }, 560);
    }
  }

  /** Petals that are still in the air drop away quickly. */
  function hurry() {
    for (const particle of items) if (particle.kind === 'petal') particle.fall = Math.max(particle.fall, 170);
  }

  /** Nothing new. What is already falling drops away, then the canvas goes quiet. */
  function stop() {
    ambient('none');
    hurry();
  }

  window.addEventListener('resize', () => { if (frame) resize(); });
  return { ambient, burst, stop };
}
