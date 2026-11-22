/**
 * Three columns of code-drawn card backs.
 * Left and right drift up. The middle drifts down.
 * A card picks a new back when it wraps. No network. No words on the cards.
 */
(function () {
  const BACKS = 36;
  const SPRITE_W = 180;
  const SPRITE_H = 262;
  let cardW = 120;
  let cardH = 175;
  let pitch = 182;
  const reduce = window.matchMedia('(prefers-reduced-motion: reduce)');

  function rounded(ctx, w, h, r) {
    ctx.beginPath();
    ctx.roundRect(1, 1, w - 2, h - 2, r);
  }

  function frame(ctx, w, h, outer, inner) {
    rounded(ctx, w, h, 8);
    ctx.fillStyle = outer;
    ctx.fill();
    ctx.save();
    ctx.beginPath();
    ctx.roundRect(7, 7, w - 14, h - 14, 6);
    ctx.clip();
    ctx.fillStyle = inner;
    ctx.fillRect(0, 0, w, h);
    ctx.restore();
  }

  function oval(ctx, cx, cy, rx, ry, color) {
    ctx.beginPath();
    ctx.ellipse(cx, cy, rx, ry, 0, 0, Math.PI * 2);
    ctx.fillStyle = color;
    ctx.fill();
  }

  const painters = [
    function swirl(ctx, w, h, a) {
      frame(ctx, w, h, a[0], a[1]);
      oval(ctx, w / 2, h / 2, 22, 34, a[2]);
      ctx.strokeStyle = a[3];
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.ellipse(w / 2, h / 2, 14, 24, 0.4, 0, Math.PI * 1.6);
      ctx.stroke();
      ctx.beginPath();
      ctx.ellipse(w / 2, h / 2, 8, 14, -0.6, 0, Math.PI * 1.4);
      ctx.stroke();
    },
    function orbs(ctx, w, h, a) {
      frame(ctx, w, h, a[0], a[1]);
      const colors = ['#d5dde6', '#2d6cb5', '#1c1c1c', '#a33b48', '#2f6a49'];
      for (let i = 0; i < 5; i += 1) {
        const ang = -Math.PI / 2 + (i / 5) * Math.PI * 2;
        oval(ctx, w / 2 + Math.cos(ang) * 14, h / 2 + Math.sin(ang) * 18, 6, 6, colors[i]);
      }
      oval(ctx, w / 2, h / 2, 5, 5, a[2]);
    },
    function split(ctx, w, h, a) {
      frame(ctx, w, h, a[0], a[1]);
      ctx.save();
      ctx.beginPath();
      ctx.arc(w / 2, h / 2, 18, Math.PI, 0);
      ctx.fillStyle = a[2];
      ctx.fill();
      ctx.beginPath();
      ctx.arc(w / 2, h / 2, 18, 0, Math.PI);
      ctx.fillStyle = a[3];
      ctx.fill();
      ctx.restore();
    },
    function waves(ctx, w, h, a) {
      frame(ctx, w, h, a[0], a[1]);
      ctx.strokeStyle = a[2];
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.arc(w / 2, h / 2, 20, 0, Math.PI * 2);
      ctx.stroke();
      ctx.lineWidth = 2;
      for (let i = 0; i < 3; i += 1) {
        ctx.beginPath();
        ctx.moveTo(16, 36 + i * 14);
        ctx.quadraticCurveTo(w / 2, 28 + i * 14, w - 16, 40 + i * 14);
        ctx.stroke();
      }
    },
    function ink(ctx, w, h, a) {
      frame(ctx, w, h, a[0], a[1]);
      ctx.strokeStyle = a[2];
      ctx.lineWidth = 3;
      ctx.strokeRect(16, 22, w - 32, h - 44);
      oval(ctx, w / 2, h / 2, 10, 14, a[2]);
    },
    function circuit(ctx, w, h, a) {
      frame(ctx, w, h, a[0], a[1]);
      ctx.strokeStyle = a[2];
      ctx.lineWidth = 1.5;
      for (let y = 24; y < h - 16; y += 12) {
        ctx.beginPath();
        ctx.moveTo(14, y);
        ctx.lineTo(w - 14, y);
        ctx.stroke();
        oval(ctx, 22 + ((y / 12) % 3) * 14, y, 2.5, 2.5, a[2]);
      }
    },
    function angle(ctx, w, h, a) {
      frame(ctx, w, h, a[0], a[1]);
      ctx.fillStyle = a[2];
      ctx.beginPath();
      ctx.moveTo(w / 2, 28);
      ctx.lineTo(w - 18, h / 2);
      ctx.lineTo(w / 2, h - 28);
      ctx.lineTo(18, h / 2);
      ctx.fill();
    },
    function ring(ctx, w, h, a) {
      frame(ctx, w, h, a[0], a[1]);
      ctx.lineWidth = 6;
      ctx.strokeStyle = a[2];
      ctx.beginPath();
      ctx.arc(w / 2, h / 2, 16, 0, Math.PI * 2);
      ctx.stroke();
      oval(ctx, w / 2, h / 2, 6, 6, a[3]);
    },
    function hex(ctx, w, h, a) {
      frame(ctx, w, h, a[0], a[1]);
      ctx.beginPath();
      for (let i = 0; i < 6; i += 1) {
        const ang = -Math.PI / 2 + (i / 6) * Math.PI * 2;
        const x = w / 2 + Math.cos(ang) * 16;
        const y = h / 2 + Math.sin(ang) * 16;
        if (i === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      }
      ctx.closePath();
      ctx.fillStyle = a[2];
      ctx.fill();
    },
    function panels(ctx, w, h, a) {
      frame(ctx, w, h, a[0], a[1]);
      ctx.fillStyle = a[2];
      ctx.fillRect(16, 24, 16, 28);
      ctx.fillStyle = a[3];
      ctx.fillRect(36, 24, 20, 18);
      ctx.fillStyle = a[2];
      ctx.fillRect(16, 58, 40, 12);
    },
    function rune(ctx, w, h, a) {
      frame(ctx, w, h, a[0], a[1]);
      ctx.strokeStyle = a[2];
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(w / 2, h / 2, 18, 0, Math.PI * 2);
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(w / 2, h / 2 - 12);
      ctx.lineTo(w / 2 + 8, h / 2 + 8);
      ctx.lineTo(w / 2 - 8, h / 2 + 8);
      ctx.closePath();
      ctx.stroke();
    },
    function corner(ctx, w, h, a) {
      frame(ctx, w, h, a[0], a[1]);
      ctx.fillStyle = a[2];
      ctx.fillRect(12, 12, 16, 16);
      ctx.strokeStyle = a[2];
      ctx.lineWidth = 2;
      ctx.strokeRect(14, 34, w - 28, h - 50);
    },
    function stats(ctx, w, h, a) {
      frame(ctx, w, h, a[0], a[1]);
      ctx.strokeStyle = a[2];
      ctx.lineWidth = 1.5;
      for (let i = 0; i < 4; i += 1) {
        ctx.strokeRect(14, 22 + i * 18, w - 28, 12);
      }
    },
    function vintage(ctx, w, h, a) {
      frame(ctx, w, h, a[0], a[1]);
      ctx.strokeStyle = a[2];
      ctx.lineWidth = 2;
      ctx.strokeRect(12, 12, w - 24, h - 24);
      ctx.strokeRect(18, 18, w - 36, h - 36);
      oval(ctx, w / 2, h / 2, 8, 12, a[2]);
    },
    function lattice(ctx, w, h, a) {
      frame(ctx, w, h, a[0], a[1]);
      ctx.strokeStyle = a[2];
      ctx.lineWidth = 1;
      for (let i = -h; i < w + h; i += 10) {
        ctx.beginPath();
        ctx.moveTo(i, 16);
        ctx.lineTo(i + h, h - 16);
        ctx.stroke();
      }
    },
    function diamonds(ctx, w, h, a) {
      frame(ctx, w, h, a[0], a[1]);
      ctx.fillStyle = a[2];
      for (let y = 28; y < h - 16; y += 18) {
        for (let x = 20; x < w - 10; x += 18) {
          ctx.beginPath();
          ctx.moveTo(x, y - 6);
          ctx.lineTo(x + 6, y);
          ctx.lineTo(x, y + 6);
          ctx.lineTo(x - 6, y);
          ctx.fill();
        }
      }
    },
  ];

  const palettes = [
    ['#1c3148', '#6d8eae', '#2a4a66', '#8aa4bc'],
    ['#243448', '#7f97ad', '#31485e', '#9aafc2'],
    ['#1a3044', '#5e849c', '#243e52', '#7d9aaf'],
    ['#16303f', '#6888a4', '#214056', '#8da6ba'],
    ['#16343a', '#5f8f96', '#1e4a52', '#8eb4b6'],
    ['#1a3c40', '#6a9ea3', '#24565c', '#93b8b6'],
    ['#14383c', '#4f8a90', '#1c4c52', '#7aabae'],
    ['#1c3a3e', '#6e9a98', '#274e50', '#96b8b4'],
    ['#3a2430', '#8d5a68', '#4a303c', '#a87886'],
    ['#40242c', '#965868', '#522e38', '#b0808c'],
    ['#351e28', '#7e4a58', '#452832', '#9a6a76'],
    ['#3e2832', '#8a6270', '#4c3440', '#a88894'],
    ['#1c3428', '#5d8a70', '#274838', '#86a894'],
    ['#24382e', '#6b9480', '#2e4c3e', '#90ae9c'],
    ['#1a3026', '#4f7a66', '#234436', '#7a9e8c'],
    ['#20362c', '#628872', '#2a4638', '#8eaa98'],
    ['#2c3238', '#8a929a', '#3a424a', '#a8b0b6'],
    ['#343a40', '#9aa2aa', '#454c54', '#b4bcc2'],
    ['#262c32', '#7c868e', '#343c44', '#98a2aa'],
    ['#30363c', '#9098a0', '#40484e', '#b0b6bc'],
    ['#2a2640', '#7a72a0', '#383258', '#9a94b8'],
    ['#322848', '#8478aa', '#403460', '#a8a0c4'],
    ['#241e38', '#6e6894', '#322848', '#9088b0'],
    ['#2e2844', '#7c74a4', '#3c3458', '#a49cb8'],
    ['#1a1e24', '#5c646e', '#242a32', '#8a929a'],
    ['#161a20', '#4e565e', '#222830', '#7a828a'],
    ['#20242a', '#6a727a', '#2c3238', '#949ca4'],
    ['#1e242c', '#66707a', '#2a323c', '#8e98a2'],
    ['#243044', '#6a7e98', '#31445c', '#8c9eb4'],
    ['#1e3836', '#5c8884', '#284e4a', '#84aaa4'],
    ['#3a2830', '#886070', '#4a3440', '#a48490'],
    ['#243428', '#68886e', '#304838', '#90a894'],
    ['#2a3036', '#7e8890', '#384048', '#a2aab0'],
    ['#2c2840', '#746c98', '#3a3454', '#9890b0'],
    ['#1c2834', '#62788c', '#283848', '#8498aa'],
    ['#22262c', '#727a82', '#30363c', '#969ea4'],
  ];

  function paintBack(kind, palette) {
    const canvas = document.createElement('canvas');
    canvas.width = SPRITE_W;
    canvas.height = SPRITE_H;
    const ctx = canvas.getContext('2d');
    painters[kind](ctx, SPRITE_W, SPRITE_H, palette);
    return canvas;
  }

  const sprites = palettes.map((palette, index) => paintBack(index % painters.length, palette));

  function liveCamera() {
    const scan = document.getElementById('v-scan');
    return document.documentElement.classList.contains('scan-cam')
      && !(scan && scan.classList.contains('scan-review'));
  }

  function pick(exclude) {
    let id = Math.floor(Math.random() * sprites.length);
    for (let n = 0; n < sprites.length; n += 1) {
      if (!exclude.has(id)) return id;
      id = (id + 1) % sprites.length;
    }
    return id;
  }

  function blocked(columns, col, index, y) {
    const skip = new Set();
    const mine = columns[col].cards;
    for (let i = 0; i < mine.length; i += 1) {
      if (i !== index) skip.add(mine[i].back);
    }
    for (const side of [col - 1, col + 1]) {
      if (side < 0 || side > 2) continue;
      for (const other of columns[side].cards) {
        if (Math.abs(other.y - y) < pitch * 0.85) skip.add(other.back);
      }
    }
    return skip;
  }

  function layout(viewW, viewH) {
    const gutter = 4;
    cardW = (viewW - gutter * 4) / 3;
    cardH = cardW * (86 / 59);
    pitch = cardH + gutter;
    const count = Math.ceil(viewH / pitch) + 2;
    const span = count * pitch;
    const columns = [0, 1, 2].map((col) => ({
      x: gutter + col * (cardW + gutter),
      speed: [-22, 36, -16][col],
      cards: Array.from({ length: count }, (_, i) => ({ y: i * pitch - pitch, back: 0 })),
      span,
    }));
    for (let col = 0; col < 3; col += 1) {
      for (let i = 0; i < columns[col].cards.length; i += 1) {
        const card = columns[col].cards[i];
        const skip = blocked(columns, col, i, card.y);
        skip.add(card.back);
        card.back = pick(skip);
      }
    }
    return columns;
  }

  const canvas = document.createElement('canvas');
  canvas.id = 'card-rain';
  canvas.setAttribute('aria-hidden', 'true');
  const scrim = document.createElement('div');
  scrim.id = 'card-rain-scrim';
  scrim.setAttribute('aria-hidden', 'true');
  document.body.prepend(scrim);
  document.body.prepend(canvas);
  const ctx = canvas.getContext('2d');
  let columns = [];
  let viewW = 0;
  let viewH = 0;
  let frames = 0;
  let running = false;
  let timer = 0;

  function resize() {
    viewW = window.innerWidth;
    viewH = window.innerHeight;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    canvas.width = Math.round(viewW * dpr);
    canvas.height = Math.round(viewH * dpr);
    canvas.style.width = viewW + 'px';
    canvas.style.height = viewH + 'px';
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    columns = layout(viewW, viewH);
  }

  function tick(dt) {
    const ms = Number.isFinite(dt) ? dt : 16;
    for (let col = 0; col < columns.length; col += 1) {
      const column = columns[col];
      for (let i = 0; i < column.cards.length; i += 1) {
        const card = column.cards[i];
        const before = card.back;
        card.y += column.speed * (ms / 1000) * pace();
        let wrapped = false;
        if (card.y < -cardH) {
          card.y += column.span;
          wrapped = true;
        } else if (card.y > viewH) {
          card.y -= column.span;
          wrapped = true;
        }
        if (wrapped) {
          const skip = blocked(columns, col, i, card.y);
          skip.add(before);
          card.back = pick(skip);
        }
      }
    }
  }

  function draw() {
    ctx.clearRect(0, 0, viewW, viewH);
    for (const column of columns) {
      for (const card of column.cards) {
        const sprite = sprites[card.back];
        if (sprite) ctx.drawImage(sprite, column.x, card.y, cardW, cardH);
      }
    }
  }

  function pace() {
    const scan = document.getElementById('v-scan');
    if (scan && scan.classList.contains('on')) return 0.25;
    return 1;
  }

  let onScreen = true;

  function loop(now) {
    if (!running) return;
    const dt = loop.last ? now - loop.last : 16;
    loop.last = now;
    if (document.hidden || !onScreen) {
      running = false;
      canvas.dataset.state = 'off';
      return;
    }
    canvas.dataset.state = 'run';
    canvas.dataset.pace = String(pace());
    tick(dt);
    draw();
    frames += 1;
    canvas.dataset.frames = String(frames);
    timer = requestAnimationFrame(loop);
  }

  function resume() {
    if (reduce.matches || document.hidden || !onScreen || running) return;
    running = true;
    loop.last = 0;
    timer = requestAnimationFrame(loop);
  }

  function start() {
    resize();
    draw();
    frames = 1;
    canvas.dataset.frames = '1';
    canvas.rain = {
      get columns() { return columns; },
      backs: sprites.length,
      tick,
      draw,
      pace,
    };
    if (reduce.matches) {
      canvas.dataset.state = 'static';
      return;
    }
    running = true;
    canvas.dataset.state = 'run';
    timer = requestAnimationFrame(loop);
  }

  document.addEventListener('visibilitychange', () => {
    if (document.hidden) {
      running = false;
      cancelAnimationFrame(timer);
      canvas.dataset.state = 'off';
      return;
    }
    resume();
  });
  if (typeof IntersectionObserver === 'function') {
    const watch = new IntersectionObserver((entries) => {
      onScreen = entries.some((entry) => entry.isIntersecting);
      if (!onScreen) {
        running = false;
        cancelAnimationFrame(timer);
        canvas.dataset.state = 'off';
        return;
      }
      resume();
    });
    watch.observe(canvas);
  }
  window.addEventListener('resize', () => {
    resize();
    draw();
  });
  start();
}());
