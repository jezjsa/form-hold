import { hexPoints, hexEdges, pointInHex, nearestEdge } from "./hex.js";

const CELL = 38;
const OPEN_EDGE = 3;
const WALL = 18;
const ENEMY_R = 7;
const TYPES = {
  circle: {
    name: "Circle",
    cost: 25,
    range: 118,
    rate: 6.2,
    damage: 3.2,
    color: "#5ee0c8",
    blurb: "Fast pulses",
  },
  square: {
    name: "Square",
    cost: 40,
    range: 156,
    rate: 1.35,
    damage: 16,
    color: "#8ec5ff",
    blurb: "Heavy shot",
  },
  triangle: {
    name: "Triangle",
    cost: 55,
    range: 138,
    rate: 2.1,
    damage: 7,
    pierce: 3,
    color: "#f0c36a",
    blurb: "Pierces a line",
  },
};

const $ = (id) => document.getElementById(id);

function drawShape(ctx, kind, x, y, size, color) {
  ctx.fillStyle = color;
  ctx.strokeStyle = "rgba(255,255,255,0.22)";
  ctx.lineWidth = 1.2;
  ctx.beginPath();
  if (kind === "circle") {
    ctx.arc(x, y, size * 0.46, 0, Math.PI * 2);
  } else if (kind === "square") {
    const s = size * 0.38;
    ctx.rect(x - s, y - s, s * 2, s * 2);
  } else {
    const r = size * 0.48;
    ctx.moveTo(x, y - r);
    ctx.lineTo(x + r * 0.9, y + r * 0.72);
    ctx.lineTo(x - r * 0.9, y + r * 0.72);
    ctx.closePath();
  }
  ctx.fill();
  ctx.stroke();
}

export function startGame(canvas) {
  const ctx = canvas.getContext("2d");
  const ui = {
    wave: $("wave"),
    gold: $("gold"),
    energyFill: $("energy-fill"),
    energyLabel: $("energy-label"),
    hint: $("hint"),
    shapes: $("shapes"),
    pause: $("btn-pause"),
    restart: $("btn-restart"),
  };

  const state = {
    selected: "circle",
    gold: 80,
    energy: 100,
    wave: 1,
    phase: "build",
    paused: false,
    buildLeft: 12,
    spawnLeft: 0,
    toSpawn: 0,
    hover: null,
    turrets: [],
    enemies: [],
    shots: [],
    pops: [],
    ticks: [],
  };

  for (const [id, spec] of Object.entries(TYPES)) {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = `shape${id === state.selected ? " on" : ""}`;
    btn.dataset.type = id;
    btn.innerHTML = `
      <canvas class="icon" width="22" height="22"></canvas>
      <span><b>${spec.name}</b><small>${spec.cost} · ${spec.blurb}</small></span>
    `;
    const icon = btn.querySelector("canvas").getContext("2d");
    drawShape(icon, id, 11, 11, 20, spec.color);
    btn.addEventListener("click", () => {
      state.selected = id;
      for (const node of ui.shapes.children) node.classList.toggle("on", node.dataset.type === id);
    });
    ui.shapes.appendChild(btn);
  }

  const layout = () => {
    const rect = canvas.getBoundingClientRect();
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    canvas.width = Math.max(640, Math.floor(rect.width * dpr));
    canvas.height = Math.max(420, Math.floor(rect.height * dpr));
    const w = canvas.width;
    const h = canvas.height;
    const cx = w * 0.5;
    const cy = h * 0.5 + 8;
    const arena = Math.min(w, h) * 0.42;
    const outer = hexPoints(cx, cy, arena);
    const inner = hexPoints(cx, cy, arena - WALL * 0.85);
    const walls = hexEdges(outer, OPEN_EDGE);
    const gapA = outer[OPEN_EDGE];
    const gapB = outer[(OPEN_EDGE + 1) % 6];
    const gapMid = { x: (gapA.x + gapB.x) / 2, y: (gapA.y + gapB.y) / 2 };
    const spawn = {
      x: cx + (gapMid.x - cx) * 1.38,
      y: cy + (gapMid.y - cy) * 1.38,
    };
    const baseR = arena * 0.13;
    return { w, h, cx, cy, arena, outer, inner, walls, gapA, gapB, gapMid, spawn, baseR };
  };

  let view = layout();
  window.addEventListener("resize", () => {
    view = layout();
  });

  const snap = (x, y) => {
    const gx = Math.round((x - view.cx) / CELL) * CELL + view.cx;
    const gy = Math.round((y - view.cy) / CELL) * CELL + view.cy;
    return { x: gx, y: gy };
  };

  const canPlace = (x, y) => {
    if (!pointInHex(x, y, view.cx, view.cy, view.arena - WALL * 1.15)) return false;
    if (Math.hypot(x - view.cx, y - view.cy) < view.baseR + 22) return false;
    const wall = nearestEdge(x, y, view.walls);
    if (wall && wall.dist < WALL * 0.85) return false;
    return !state.turrets.some((t) => Math.hypot(t.x - x, t.y - y) < CELL * 0.72);
  };

  const canvasPos = (event) => {
    const rect = canvas.getBoundingClientRect();
    return {
      x: ((event.clientX - rect.left) / rect.width) * canvas.width,
      y: ((event.clientY - rect.top) / rect.height) * canvas.height,
    };
  };

  canvas.addEventListener("pointermove", (event) => {
    const p = canvasPos(event);
    const s = snap(p.x, p.y);
    state.hover = { ...s, ok: canPlace(s.x, s.y) };
  });
  canvas.addEventListener("pointerleave", () => {
    state.hover = null;
  });
  canvas.addEventListener("pointerdown", (event) => {
    if (state.phase === "lost") return;
    const p = canvasPos(event);
    const s = snap(p.x, p.y);
    const spec = TYPES[state.selected];
    if (!canPlace(s.x, s.y)) return;
    if (state.gold < spec.cost) {
      ui.hint.textContent = `Need ${spec.cost} gold for a ${spec.name}.`;
      return;
    }
    state.gold -= spec.cost;
    state.turrets.push({
      type: state.selected,
      x: s.x,
      y: s.y,
      cool: 0,
    });
    syncHud();
  });

  ui.pause.addEventListener("click", () => {
    if (state.phase === "lost") return;
    state.paused = !state.paused;
    ui.pause.textContent = state.paused ? "Resume" : "Pause";
  });
  ui.restart.addEventListener("click", () => reset());

  const reset = () => {
    state.gold = 80;
    state.energy = 100;
    state.wave = 1;
    state.phase = "build";
    state.paused = false;
    state.buildLeft = 12;
    state.spawnLeft = 0;
    state.toSpawn = 0;
    state.turrets = [];
    state.enemies = [];
    state.shots = [];
    state.pops = [];
    state.ticks = [];
    ui.pause.textContent = "Pause";
    ui.hint.textContent = "Pick a shape, then click inside the hex to place it.";
    syncHud();
  };

  const startWave = () => {
    state.phase = "wave";
    state.toSpawn = 8 + state.wave * 4;
    state.spawnLeft = 0.15;
    ui.hint.textContent = `Wave ${state.wave} — hold the inner hex.`;
  };

  const spawnEnemy = () => {
    const jitter = (Math.random() - 0.5) * 46;
    const tx = view.gapB.x - view.gapA.x;
    const ty = view.gapB.y - view.gapA.y;
    const len = Math.hypot(tx, ty) || 1;
    state.enemies.push({
      x: view.spawn.x + (tx / len) * jitter,
      y: view.spawn.y + (ty / len) * jitter,
      hp: 8 + state.wave * 3.2,
      max: 8 + state.wave * 3.2,
      speed: 46 + state.wave * 3.4,
      atBase: false,
    });
  };

  const syncHud = () => {
    ui.wave.textContent = String(state.wave);
    ui.gold.textContent = String(Math.floor(state.gold));
    const e = Math.max(0, state.energy);
    ui.energyLabel.textContent = String(Math.ceil(e));
    ui.energyFill.style.transform = `scaleX(${e / 100})`;
  };

  const steer = (enemy, dt) => {
    const toBaseX = view.cx - enemy.x;
    const toBaseY = view.cy - enemy.y;
    const dist = Math.hypot(toBaseX, toBaseY) || 1;
    let vx = toBaseX / dist;
    let vy = toBaseY / dist;

    const wall = nearestEdge(enemy.x, enemy.y, view.walls);
    if (wall && wall.dist < WALL * 0.5 + ENEMY_R + 6) {
      const nlen = Math.hypot(wall.nx, wall.ny) || 1;
      const nx = wall.nx / nlen;
      const ny = wall.ny / nlen;
      const push = WALL * 0.5 + ENEMY_R + 6 - wall.dist;
      enemy.x += nx * push;
      enemy.y += ny * push;
      const slide = vx * -ny + vy * nx;
      vx = -ny * Math.sign(slide || 1);
      vy = nx * Math.sign(slide || 1);
    }

    enemy.x += vx * enemy.speed * dt;
    enemy.y += vy * enemy.speed * dt;
    enemy.atBase = Math.hypot(enemy.x - view.cx, enemy.y - view.cy) < view.baseR + ENEMY_R;
  };

  const fire = (turret, dt) => {
    const spec = TYPES[turret.type];
    turret.cool -= dt;
    if (turret.cool > 0) return;
    const marks = state.enemies
      .map((enemy) => ({ enemy, d: Math.hypot(enemy.x - turret.x, enemy.y - turret.y) }))
      .filter((row) => row.d <= spec.range)
      .sort((a, b) => a.d - b.d);
    if (!marks.length) return;
    turret.cool = 1 / spec.rate;

    if (turret.type === "triangle") {
      const aim = marks[0].enemy;
      const dx = aim.x - turret.x;
      const dy = aim.y - turret.y;
      const len = Math.hypot(dx, dy) || 1;
      const ux = dx / len;
      const uy = dy / len;
      let hits = 0;
      for (const row of marks) {
        const px = row.enemy.x - turret.x;
        const py = row.enemy.y - turret.y;
        const along = px * ux + py * uy;
        const side = Math.abs(px * uy - py * ux);
        if (along > 0 && along < spec.range && side < 14) {
          hurt(row.enemy, spec.damage, turret.x, turret.y);
          hits += 1;
          if (hits >= spec.pierce) break;
        }
      }
      state.shots.push({
        x1: turret.x,
        y1: turret.y,
        x2: turret.x + ux * spec.range,
        y2: turret.y + uy * spec.range,
        color: spec.color,
        life: 0.12,
        wide: 2.4,
      });
      return;
    }

    const target = marks[0].enemy;
    hurt(target, spec.damage, turret.x, turret.y);
    state.shots.push({
      x1: turret.x,
      y1: turret.y,
      x2: target.x,
      y2: target.y,
      color: spec.color,
      life: turret.type === "square" ? 0.16 : 0.08,
      wide: turret.type === "square" ? 3.2 : 1.6,
    });
  };

  const hurt = (enemy, amount, ox, oy) => {
    enemy.hp -= amount;
    state.ticks.push({
      x: enemy.x,
      y: enemy.y - 10,
      text: String(Math.round(amount)),
      life: 0.45,
    });
    if (enemy.hp <= 0) {
      enemy.dead = true;
      state.gold += 4 + Math.floor(state.wave * 0.6);
      state.pops.push({ x: enemy.x, y: enemy.y, life: 0.35, r: 10 });
    }
  };

  const drawWalls = () => {
    ctx.save();
    ctx.shadowColor = "rgba(94, 224, 200, 0.35)";
    ctx.shadowBlur = 22;
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    ctx.strokeStyle = "#1c3f3c";
    ctx.lineWidth = WALL + 10;
    ctx.beginPath();
    for (const { a, b } of view.walls) {
      ctx.moveTo(a.x, a.y);
      ctx.lineTo(b.x, b.y);
    }
    ctx.stroke();
    ctx.shadowBlur = 0;
    ctx.strokeStyle = "#5ee0c8";
    ctx.lineWidth = WALL;
    ctx.stroke();
    ctx.strokeStyle = "rgba(210, 255, 245, 0.35)";
    ctx.lineWidth = 3;
    ctx.stroke();
    ctx.restore();
  };

  const drawBase = (t) => {
    const pulse = 1 + Math.sin(t * 3.2) * 0.04;
    const pts = hexPoints(view.cx, view.cy, view.baseR * pulse);
    ctx.save();
    ctx.shadowColor = "rgba(255, 140, 80, 0.45)";
    ctx.shadowBlur = 18;
    ctx.fillStyle = "#2a1820";
    ctx.strokeStyle = "#ff9a62";
    ctx.lineWidth = 4;
    ctx.beginPath();
    ctx.moveTo(pts[0].x, pts[0].y);
    for (const p of pts.slice(1)) ctx.lineTo(p.x, p.y);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
    ctx.shadowBlur = 0;
    const ring = hexPoints(view.cx, view.cy, view.baseR * 0.62);
    ctx.fillStyle = `rgba(255, 176, 92, ${0.28 + (state.energy / 100) * 0.45})`;
    ctx.beginPath();
    ctx.moveTo(ring[0].x, ring[0].y);
    for (const p of ring.slice(1)) ctx.lineTo(p.x, p.y);
    ctx.closePath();
    ctx.fill();
    ctx.restore();
  };

  const draw = (now) => {
    const t = now / 1000;
    ctx.clearRect(0, 0, view.w, view.h);
    const g = ctx.createRadialGradient(view.cx, view.cy, 40, view.cx, view.cy, view.arena * 1.6);
    g.addColorStop(0, "#1a1028");
    g.addColorStop(1, "#0b0612");
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, view.w, view.h);

    ctx.fillStyle = "rgba(255, 93, 108, 0.08)";
    ctx.beginPath();
    ctx.moveTo(view.gapA.x, view.gapA.y);
    ctx.lineTo(view.spawn.x + (view.gapA.x - view.gapMid.x) * 0.2, view.spawn.y + (view.gapA.y - view.gapMid.y) * 0.2);
    ctx.lineTo(view.spawn.x + (view.gapB.x - view.gapMid.x) * 0.2, view.spawn.y + (view.gapB.y - view.gapMid.y) * 0.2);
    ctx.lineTo(view.gapB.x, view.gapB.y);
    ctx.closePath();
    ctx.fill();

    drawWalls();
    drawBase(t);

    if (state.hover) {
      ctx.globalAlpha = state.hover.ok ? 0.55 : 0.22;
      drawShape(ctx, state.selected, state.hover.x, state.hover.y, 28, TYPES[state.selected].color);
      ctx.globalAlpha = 1;
      if (state.hover.ok) {
        ctx.beginPath();
        ctx.strokeStyle = "rgba(94,224,200,0.18)";
        ctx.arc(state.hover.x, state.hover.y, TYPES[state.selected].range, 0, Math.PI * 2);
        ctx.stroke();
      }
    }

    for (const turret of state.turrets) {
      ctx.beginPath();
      ctx.fillStyle = "rgba(0,0,0,0.28)";
      ctx.ellipse(turret.x + 4, turret.y + 8, 12, 5, 0, 0, Math.PI * 2);
      ctx.fill();
      drawShape(ctx, turret.type, turret.x, turret.y, 30, TYPES[turret.type].color);
    }

    for (const shot of state.shots) {
      ctx.strokeStyle = shot.color;
      ctx.globalAlpha = Math.max(0, shot.life * 6);
      ctx.lineWidth = shot.wide;
      ctx.beginPath();
      ctx.moveTo(shot.x1, shot.y1);
      ctx.lineTo(shot.x2, shot.y2);
      ctx.stroke();
      ctx.globalAlpha = 1;
    }

    for (const enemy of state.enemies) {
      ctx.beginPath();
      ctx.fillStyle = enemy.atBase ? "#ff8a6a" : "#ff5d6c";
      ctx.shadowColor = "rgba(255, 80, 90, 0.55)";
      ctx.shadowBlur = 10;
      ctx.arc(enemy.x, enemy.y, ENEMY_R, 0, Math.PI * 2);
      ctx.fill();
      ctx.shadowBlur = 0;
      ctx.fillStyle = "rgba(0,0,0,0.35)";
      ctx.fillRect(enemy.x - 8, enemy.y - 14, 16, 2);
      ctx.fillStyle = "#f0c36a";
      ctx.fillRect(enemy.x - 8, enemy.y - 14, 16 * Math.max(0, enemy.hp / enemy.max), 2);
    }

    for (const pop of state.pops) {
      ctx.beginPath();
      ctx.strokeStyle = `rgba(255,220,140,${pop.life * 2})`;
      ctx.arc(pop.x, pop.y, (1 - pop.life) * 18, 0, Math.PI * 2);
      ctx.stroke();
    }
    for (const tick of state.ticks) {
      ctx.fillStyle = `rgba(244,236,255,${tick.life * 2})`;
      ctx.font = "11px Helvetica Neue, sans-serif";
      ctx.fillText(tick.text, tick.x - 6, tick.y);
    }

    if (state.phase === "build" || state.phase === "between") {
      ctx.fillStyle = "rgba(244,236,255,0.72)";
      ctx.font = "600 18px Helvetica Neue, sans-serif";
      ctx.textAlign = "center";
      const left = Math.ceil(state.buildLeft);
      ctx.fillText(state.phase === "build" ? `First wave in ${left}s` : `Next wave in ${left}s`, view.cx, view.cy - view.arena - 18);
      ctx.textAlign = "start";
    }

    if (state.phase === "lost") {
      ctx.fillStyle = "rgba(10,6,16,0.55)";
      ctx.fillRect(0, 0, view.w, view.h);
      ctx.fillStyle = "#f4ecff";
      ctx.textAlign = "center";
      ctx.font = "800 42px Helvetica Neue, sans-serif";
      ctx.fillText("Base fallen", view.cx, view.cy - 10);
      ctx.font = "16px Helvetica Neue, sans-serif";
      ctx.fillStyle = "#9a86b8";
      ctx.fillText(`Held ${state.wave} wave${state.wave === 1 ? "" : "s"}`, view.cx, view.cy + 22);
      ctx.textAlign = "start";
    }
  };

  let last = performance.now();
  const tick = (now) => {
    const dt = Math.min(0.05, (now - last) / 1000);
    last = now;
    view = view.w !== canvas.width ? layout() : view;

    if (!state.paused && state.phase !== "lost") {
      if (state.phase === "build" || state.phase === "between") {
        state.buildLeft -= dt;
        if (state.buildLeft <= 0) startWave();
      }

      if (state.phase === "wave") {
        state.spawnLeft -= dt;
        if (state.toSpawn > 0 && state.spawnLeft <= 0) {
          spawnEnemy();
          state.toSpawn -= 1;
          state.spawnLeft = Math.max(0.22, 0.55 - state.wave * 0.03);
        }
        for (const enemy of state.enemies) steer(enemy, dt);
        for (const turret of state.turrets) fire(turret, dt);
        const onBase = state.enemies.filter((e) => e.atBase).length;
        if (onBase) {
          state.energy -= onBase * 3.4 * dt;
          if (state.energy <= 0) {
            state.energy = 0;
            state.phase = "lost";
            ui.hint.textContent = "The base ran out of energy. Restart to try the hex again.";
          }
        }
        state.enemies = state.enemies.filter((e) => !e.dead);
        if (state.toSpawn <= 0 && state.enemies.length === 0 && state.phase === "wave") {
          state.gold += 12 + state.wave * 2;
          state.wave += 1;
          state.phase = "between";
          state.buildLeft = 6;
          ui.hint.textContent = "Wave clear. Spend the gold before they come again.";
        }
      }

      for (const shot of state.shots) shot.life -= dt;
      state.shots = state.shots.filter((s) => s.life > 0);
      for (const pop of state.pops) pop.life -= dt;
      state.pops = state.pops.filter((p) => p.life > 0);
      for (const n of state.ticks) {
        n.life -= dt;
        n.y -= 18 * dt;
      }
      state.ticks = state.ticks.filter((n) => n.life > 0);
      syncHud();
    }

    draw(now);
    requestAnimationFrame(tick);
  };

  syncHud();
  requestAnimationFrame(tick);
}
