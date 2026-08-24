import { hexPoints, hexSides, nearestEdge, distToSegment, pointInHex } from "./hex.js";

const CELL = 38;
const OPEN_EDGE = 3;
const WALL = 18;
const ENEMY_R = 7;
const WALL_HP = 380;
const CHEW = 7.4;
const TYPES = {
  circle: {
    name: "Circle",
    cost: 25,
    range: 118,
    rate: 6.2,
    damage: 3.2,
    blurb: "Fast pulses",
  },
  square: {
    name: "Square",
    cost: 40,
    range: 156,
    rate: 1.35,
    damage: 16,
    blurb: "Heavy shot",
  },
  triangle: {
    name: "Triangle",
    cost: 55,
    range: 138,
    rate: 2.1,
    damage: 7,
    pierce: 3,
    blurb: "Pierces a line",
  },
};
const SHAPE_STROKE = "#f3efe6";
const SHOT_STROKE = "#f3efe6";

const $ = (id) => document.getElementById(id);

function threatOf(wave) {
  if (wave <= 20) return wave;
  return 20 + (wave - 20) * 0.28;
}

function makeWalls() {
  return Array.from({ length: 6 }, (_, i) => ({
    hp: i === OPEN_EDGE ? 0 : WALL_HP,
    max: WALL_HP,
    flash: 0,
  }));
}

function roundedPoly(ctx, points, radius) {
  const n = points.length;
  for (let i = 0; i < n; i += 1) {
    const prev = points[(i + n - 1) % n];
    const curr = points[i];
    const next = points[(i + 1) % n];
    const inX = curr.x - prev.x;
    const inY = curr.y - prev.y;
    const outX = next.x - curr.x;
    const outY = next.y - curr.y;
    const inLen = Math.hypot(inX, inY) || 1;
    const outLen = Math.hypot(outX, outY) || 1;
    const r = Math.min(radius, inLen / 2, outLen / 2);
    const startX = curr.x - (inX / inLen) * r;
    const startY = curr.y - (inY / inLen) * r;
    const endX = curr.x + (outX / outLen) * r;
    const endY = curr.y + (outY / outLen) * r;
    if (i === 0) ctx.moveTo(startX, startY);
    else ctx.lineTo(startX, startY);
    ctx.quadraticCurveTo(curr.x, curr.y, endX, endY);
  }
  ctx.closePath();
}

function shapeStrokeWidth(ctx) {
  const canvas = ctx.canvas;
  const cssW = canvas.clientWidth || canvas.width;
  return 3 * (cssW ? canvas.width / cssW : 1);
}

function drawShape(ctx, kind, x, y, size) {
  ctx.save();
  ctx.strokeStyle = SHAPE_STROKE;
  ctx.lineWidth = shapeStrokeWidth(ctx);
  ctx.lineJoin = "round";
  ctx.lineCap = "round";
  ctx.beginPath();
  if (kind === "circle") {
    ctx.arc(x, y, size * 0.42, 0, Math.PI * 2);
  } else if (kind === "square") {
    const s = size * 0.36;
    const radius = Math.max(2.4, size * 0.09);
    if (typeof ctx.roundRect === "function") {
      ctx.roundRect(x - s, y - s, s * 2, s * 2, radius);
    } else {
      roundedPoly(ctx, [
        { x: x - s, y: y - s },
        { x: x + s, y: y - s },
        { x: x + s, y: y + s },
        { x: x - s, y: y + s },
      ], radius);
    }
  } else {
    const h = size * 0.44;
    roundedPoly(ctx, [
      { x, y: y - h },
      { x: x + h * 0.95, y: y + h * 0.72 },
      { x: x - h * 0.95, y: y + h * 0.72 },
    ], Math.max(2.4, size * 0.1));
  }
  ctx.stroke();
  ctx.restore();
}

export function startGame(canvas, hooks = {}) {
  const ctx = canvas.getContext("2d");
  const waveCap = Number.isInteger(hooks.waveCap) ? hooks.waveCap : 200;
  const ui = {
    hint: $("hint"),
    shapes: $("shapes"),
    pause: $("btn-pause"),
    restart: $("btn-reset"),
    speed: $("btn-speed"),
    mute: $("btn-mute"),
    rush: $("btn-rush"),
  };

  const state = {
    selected: "circle",
    gold: 80,
    energy: 100,
    score: 0,
    kills: 0,
    wave: 1,
    waveCap,
    phase: "menu",
    paused: false,
    muted: false,
    speed: 1,
    startedAt: performance.now(),
    posted: false,
    buildLeft: 12,
    spawnLeft: 0,
    toSpawn: 0,
    hover: null,
    turrets: [],
    enemies: [],
    shots: [],
    pops: [],
    ticks: [],
    walls: makeWalls(),
    spawned: 0,
    hurt: 0,
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
    drawShape(icon, id, 11, 11, 20);
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
    const arena = Math.min(w, h) * 0.36;
    const outer = hexPoints(cx, cy, arena);
    const inner = hexPoints(cx, cy, arena - WALL * 0.85);
    const sides = hexSides(outer, cx, cy);
    const fieldR = Math.min(w, h) * 0.48 - 16;
    const baseR = arena * 0.13;
    return { w, h, cx, cy, arena, outer, inner, sides, fieldR, baseR };
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

  const intactEdges = () => view.sides
    .filter((side) => state.walls[side.i].hp > 0)
    .map((side) => ({ a: side.a, b: side.b, i: side.i }));

  const openSides = () => view.sides.filter((side) => state.walls[side.i].hp <= 0);

  const canPlace = (x, y) => {
    if (x < 36 || y < 36 || x > view.w - 36 || y > view.h - 36) return false;
    if (Math.hypot(x - view.cx, y - view.cy) > view.fieldR) return false;
    if (Math.hypot(x - view.cx, y - view.cy) < view.baseR + 22) return false;
    const wall = nearestEdge(x, y, intactEdges());
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
    if (state.phase === "menu" || state.phase === "lost" || state.phase === "won") {
      state.hover = null;
      return;
    }
    const p = canvasPos(event);
    const s = snap(p.x, p.y);
    state.hover = { ...s, ok: canPlace(s.x, s.y) };
  });
  canvas.addEventListener("pointerleave", () => {
    state.hover = null;
  });
  canvas.addEventListener("pointerdown", (event) => {
    if (state.phase === "menu" || state.phase === "lost" || state.phase === "won") return;
    const p = canvasPos(event);
    const s = snap(p.x, p.y);
    const spec = TYPES[state.selected];
    if (!canPlace(s.x, s.y)) return;
    if (state.gold < spec.cost) {
      if (ui.hint) ui.hint.textContent = `Need ${spec.cost} gold for a ${spec.name}.`;
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

  const togglePause = () => {
    if (state.phase === "menu" || state.phase === "lost" || state.phase === "won") return;
    state.paused = !state.paused;
    if (ui.pause) ui.pause.textContent = state.paused ? "Resume" : "Pause";
  };

  ui.pause?.addEventListener("click", () => {
    togglePause();
  });
  window.addEventListener("keydown", (event) => {
    if (event.repeat || event.metaKey || event.ctrlKey || event.altKey) return;
    if (event.code !== "Space" && event.key !== " ") return;
    const target = event.target;
    if (
      target instanceof HTMLInputElement
      || target instanceof HTMLTextAreaElement
      || target instanceof HTMLSelectElement
      || (target instanceof HTMLElement && target.isContentEditable)
    ) {
      return;
    }
    event.preventDefault();
    togglePause();
  });
  ui.restart?.addEventListener("click", () => {
    reset({ play: false });
    hooks.onMenu?.();
  });
  ui.speed?.addEventListener("click", () => {
    state.speed = state.speed === 1 ? 2 : state.speed === 2 ? 3 : 1;
    ui.speed.textContent = `Speed x${state.speed}`;
  });
  ui.mute?.addEventListener("click", () => {
    state.muted = !state.muted;
    ui.mute.textContent = state.muted ? "Unmute" : "Mute";
    ui.mute.setAttribute("aria-pressed", state.muted ? "true" : "false");
  });
  ui.rush?.addEventListener("click", () => {
    rushWave();
  });

  const finish = (won) => {
    if (state.posted) return;
    state.posted = true;
    state.phase = won ? "won" : "lost";
    if (won) state.score += Math.floor(state.energy) * 2 + Math.floor(state.gold / 4);
    hooks.onOver?.({
      score: state.score,
      wave: state.wave,
      won,
      kills: state.kills,
      durationMs: Math.max(1, Math.round(performance.now() - state.startedAt)),
    });
    if (ui.hint) {
      ui.hint.textContent = won
        ? "Hex held."
        : "The base ran out of energy.";
    }
    syncHud();
  };

  const reset = ({ play = false } = {}) => {
    state.gold = 80;
    state.energy = 100;
    state.score = 0;
    state.kills = 0;
    state.wave = 1;
    state.phase = play ? "build" : "menu";
    state.paused = false;
    state.posted = false;
    state.startedAt = play ? performance.now() : 0;
    state.buildLeft = 12;
    state.spawnLeft = 0;
    state.toSpawn = 0;
    state.turrets = [];
    state.enemies = [];
    state.shots = [];
    state.pops = [];
    state.ticks = [];
    state.walls = makeWalls();
    state.spawned = 0;
    state.hurt = 0;
    state.hover = null;
    if (ui.pause) ui.pause.textContent = "Pause";
    if (ui.hint) {
      ui.hint.textContent = play
        ? "Place shapes in or around the hex. Breakers chew the brass — slowly."
        : "Defend your base from attackers.";
    }
    if (play) hooks.onReset?.();
    syncHud();
  };

  const startWave = () => {
    state.phase = "wave";
    state.toSpawn = Math.min(100, Math.round(8 + threatOf(state.wave) * 4));
    state.spawnLeft = 0.15;
    if (ui.hint) ui.hint.textContent = `Wave ${state.wave} — hold the hex. Watch the walls.`;
  };

  const waitingForWave = () => state.phase === "build" || state.phase === "between";

  const rushBonusFor = (remaining) => {
    if (typeof remaining !== "number" || remaining < 0.15) return 0;
    return Math.max(0, Math.round(remaining * 6 * Math.max(1, state.wave)));
  };

  const rushWave = () => {
    if (!waitingForWave()) return;
    const bonus = rushBonusFor(state.buildLeft);
    if (bonus) {
      state.score += bonus;
      state.ticks.push({
        x: view.cx - 22,
        y: view.cy - view.arena - 6,
        text: `Rush +${bonus}`,
        life: 1.15,
      });
    }
    startWave();
    syncHud();
  };

  const spawnAtSide = (side, along) => {
    const tx = side.b.x - side.a.x;
    const ty = side.b.y - side.a.y;
    const len = Math.hypot(tx, ty) || 1;
    return {
      x: side.mx + side.nx * (view.arena * 0.42) + (tx / len) * along,
      y: side.my + side.ny * (view.arena * 0.42) + (ty / len) * along,
    };
  };

  const spawnEnemy = () => {
    const intact = view.sides.filter((side) => state.walls[side.i].hp > 0);
    const open = openSides();
    const gate = open[Math.floor(Math.random() * open.length)] ?? view.sides[OPEN_EDGE];
    const wantBreaker = intact.length > 0 && (state.spawned % 5 === 3 || (state.wave >= 3 && Math.random() < 0.16));
    const along = (Math.random() - 0.5) * 52;
    if (wantBreaker) {
      const wall = intact[Math.floor(Math.random() * intact.length)];
      const at = spawnAtSide(wall, along);
      state.enemies.push({
        role: "breaker",
        wall: wall.i,
        x: at.x,
        y: at.y,
        hp: 16 + threatOf(state.wave) * 4.2,
        max: 16 + threatOf(state.wave) * 4.2,
        speed: 30 + threatOf(state.wave) * 1.8,
        chew: CHEW + threatOf(state.wave) * 0.28,
        atBase: false,
        chewing: false,
        orbit: Math.random() < 0.5 ? 1 : -1,
        lane: (Math.random() - 0.45) * 56,
      });
    } else {
      const at = spawnAtSide(gate, along * 1.35);
      state.enemies.push({
        role: "runner",
        wall: gate.i,
        x: at.x,
        y: at.y,
        hp: 8 + threatOf(state.wave) * 3.2,
        max: 8 + threatOf(state.wave) * 3.2,
        speed: 46 + threatOf(state.wave) * 3.4 + (Math.random() - 0.5) * 8,
        atBase: false,
        chewing: false,
        orbit: Math.random() < 0.5 ? 1 : -1,
        lane: (Math.random() - 0.45) * 56,
      });
    }
    state.spawned += 1;
  };

  const syncHud = () => {
    if (ui.rush) {
      const wait = waitingForWave();
      ui.rush.classList.toggle("hidden", !wait);
      if (wait) {
        const secs = Math.ceil(Math.max(0, state.buildLeft));
        const bonus = rushBonusFor(state.buildLeft);
        ui.rush.textContent = bonus
          ? `Wave ${state.wave} in ${secs}  +${bonus}`
          : `Wave ${state.wave} in ${secs}`;
      }
    }
    hooks.onHud?.({
      lives: Math.max(0, Math.ceil(state.energy / 5)),
      gold: Math.floor(state.gold),
      score: state.score,
      wave: state.wave,
      waveCap: state.waveCap,
      next: state.buildLeft,
      phase: state.phase,
    });
  };

  const wrapAngle = (a) => {
    let x = a;
    while (x > Math.PI) x -= Math.PI * 2;
    while (x < -Math.PI) x += Math.PI * 2;
    return x;
  };

  const gunCentroid = () => {
    if (!state.turrets.length) return null;
    let x = 0;
    let y = 0;
    for (const turret of state.turrets) {
      x += turret.x;
      y += turret.y;
    }
    return { x: x / state.turrets.length, y: y / state.turrets.length };
  };

  const shyOfGuns = (x, y, orbit) => {
    let ox = 0;
    let oy = 0;
    for (const turret of state.turrets) {
      const spec = TYPES[turret.type];
      const dx = x - turret.x;
      const dy = y - turret.y;
      const d = Math.hypot(dx, dy) || 1;
      const danger = spec.range * 0.48;
      if (d >= danger) continue;
      const w = 1 - d / danger;
      const tx = -dy / d;
      const ty = dx / d;
      ox += (dx / d) * w * 1.8 + tx * orbit * w * 0.85;
      oy += (dy / d) * w * 1.8 + ty * orbit * w * 0.85;
    }
    const guns = gunCentroid();
    if (guns) {
      const dx = x - guns.x;
      const dy = y - guns.y;
      const d = Math.hypot(dx, dy) || 1;
      const blob = 78;
      if (d < blob) {
        const w = 1 - d / blob;
        const tx = -dy / d;
        const ty = dx / d;
        ox += (dx / d) * w * 2.2 + tx * orbit * w * 1.15;
        oy += (dy / d) * w * 2.2 + ty * orbit * w * 1.15;
      }
    }
    return { x: ox, y: oy };
  };

  const flankAroundGuns = (enemy) => {
    const guns = gunCentroid();
    if (!guns) return null;
    const eAng = Math.atan2(enemy.y - view.cy, enemy.x - view.cx);
    const gAng = Math.atan2(guns.y - view.cy, guns.x - view.cx);
    const dist = Math.hypot(enemy.x - view.cx, enemy.y - view.cy) || 1;
    const hot = Math.cos(eAng - gAng);
    if (hot < -0.18 && dist < view.baseR + 70) {
      return { x: (view.cx - enemy.x) / dist, y: (view.cy - enemy.y) / dist, dive: true };
    }
    const fromGuns = wrapAngle(eAng - gAng);
    const geo = fromGuns >= 0 ? 1 : -1;
    const personal = enemy.orbit || 1;
    const turn = Math.abs(fromGuns) > 1.1 ? geo : personal;
    const holdR = view.baseR + 34 + Math.max(0, hot) * view.arena * 0.46 + (enemy.lane || 0);
    const tx = -Math.sin(eAng) * turn;
    const ty = Math.cos(eAng) * turn;
    const radial = Math.max(-0.4, Math.min(0.7, (holdR - dist) / (view.arena * 0.22)));
    return {
      x: tx + Math.cos(eAng) * radial,
      y: ty + Math.sin(eAng) * radial,
      dive: false,
    };
  };

  const separateRunners = (enemy) => {
    let ox = 0;
    let oy = 0;
    for (const other of state.enemies) {
      if (other === enemy || other.role === "breaker" || other.dead) continue;
      const dx = enemy.x - other.x;
      const dy = enemy.y - other.y;
      const d = Math.hypot(dx, dy);
      if (d <= 0 || d > 42) continue;
      const w = 1 - d / 42;
      const tight = d < 16 ? 2.1 : 1;
      ox += (dx / d) * w * tight;
      oy += (dy / d) * w * tight;
      if (d < 18) {
        const side = enemy.orbit || 1;
        ox += (-dy / d) * side * 1.4;
        oy += (dx / d) * side * 1.4;
      }
    }
    return { x: ox, y: oy };
  };

  const nearestPressed = (enemy) => {
    let best = null;
    let bestD = 180;
    for (const other of state.enemies) {
      if (other === enemy || other.dead || (other.underFire || 0) <= 0) continue;
      const d = Math.hypot(other.x - enemy.x, other.y - enemy.y);
      if (d < bestD) {
        bestD = d;
        best = other;
      }
    }
    return best;
  };

  const peelTowardCore = (enemy, pressed) => {
    const toCoreX = view.cx - enemy.x;
    const toCoreY = view.cy - enemy.y;
    const dist = Math.hypot(toCoreX, toCoreY) || 1;
    let vx = (toCoreX / dist) * 0.75;
    let vy = (toCoreY / dist) * 0.75;
    const shot = pressed.shotFrom;
    const orbit = enemy.orbit || 1;
    if (shot) {
      const sx = enemy.x - shot.x;
      const sy = enemy.y - shot.y;
      const sd = Math.hypot(sx, sy) || 1;
      const danger = 170;
      if (sd < danger) {
        const w = 1 - sd / danger;
        vx += (sx / sd) * w * 0.4;
        vy += (sy / sd) * w * 0.4;
        vx += (-sy / sd) * orbit * (2.1 + Math.abs(enemy.lane || 0) * 0.02);
        vy += (sx / sd) * orbit * (2.1 + Math.abs(enemy.lane || 0) * 0.02);
      }
    }
    const dx = enemy.x - pressed.x;
    const dy = enemy.y - pressed.y;
    const pd = Math.hypot(dx, dy) || 1;
    vx += (dx / pd) * 1.9;
    vy += (dy / pd) * 1.9;
    if (pd < 22) {
      vx += (-dy / pd) * orbit * 2.4;
      vy += (dx / pd) * orbit * 2.4;
    }
    return { x: vx, y: vy };
  };

  const pickSafeWall = (enemy, shot) => {
    const intact = view.sides.filter((side) => state.walls[side.i].hp > 0);
    if (!intact.length) return null;
    let best = null;
    let bestScore = -Infinity;
    for (const side of intact) {
      const fromGun = shot
        ? Math.hypot(side.mx - shot.x, side.my - shot.y)
        : 80;
      const travel = Math.hypot(side.mx - enemy.x, side.my - enemy.y);
      const already = state.enemies.filter((other) => other.role === "breaker" && other.wall === side.i).length;
      const score = fromGun - travel * 0.22 - already * 40;
      if (score > bestScore) {
        bestScore = score;
        best = side;
      }
    }
    return best;
  };

  const becomeBreaker = (enemy, shot) => {
    if (enemy.role === "breaker") return true;
    const side = pickSafeWall(enemy, shot);
    if (!side) return false;
    enemy.role = "breaker";
    enemy.wall = side.i;
    enemy.egress = pointInHex(enemy.x, enemy.y, view.cx, view.cy, view.arena - 2)
      || Math.hypot(enemy.x - view.cx, enemy.y - view.cy) < view.arena * 0.94;
    enemy.chew = CHEW + threatOf(state.wave) * 0.28;
    enemy.chewing = false;
    enemy.peeling = false;
    enemy.atBase = false;
    return true;
  };

  const leaveHex = (enemy) => {
    const open = openSides();
    if (open.length) {
      let gate = open[0];
      let best = Infinity;
      for (const side of open) {
        const midX = (side.mx + enemy.x) * 0.5;
        const midY = (side.my + enemy.y) * 0.5;
        const travel = Math.hypot(side.mx - enemy.x, side.my - enemy.y);
        const gunPen = enemy.shotFrom
          ? Math.hypot(midX - enemy.shotFrom.x, midY - enemy.shotFrom.y)
          : 90;
        const score = travel - gunPen * 0.45;
        if (score < best) {
          best = score;
          gate = side;
        }
      }
      return {
        x: gate.mx + gate.nx * (view.arena * 0.24) - enemy.x,
        y: gate.my + gate.ny * (view.arena * 0.24) - enemy.y,
      };
    }
    const dist = Math.hypot(enemy.x - view.cx, enemy.y - view.cy) || 1;
    return { x: enemy.x - view.cx, y: enemy.y - view.cy };
  };

  const commitPeel = (enemy, pressed) => {
    if (enemy.peeling || enemy.role === "breaker") return;
    const shot = pressed.shotFrom;
    if (Math.random() < 0.52 && becomeBreaker(enemy, shot)) return;
    enemy.peeling = true;
    const side = (enemy.x - pressed.x) * (pressed.shotFrom?.y - pressed.y || 0)
      - (enemy.y - pressed.y) * (pressed.shotFrom?.x - pressed.x || 0);
    if (Math.abs(side) > 4) {
      enemy.orbit = side >= 0 ? 1 : -1;
    }
    const sign = enemy.orbit || 1;
    enemy.lane = sign * (Math.abs(enemy.lane || 16) + 26 + Math.random() * 18);
  };

  const breachWall = (index) => {
    const wall = state.walls[index];
    if (!wall || wall.hp > 0) return;
    const side = view.sides[index];
    state.pops.push({ x: side.mx, y: side.my, life: 0.7, r: 22 });
    if (ui.hint) ui.hint.textContent = "A wall gave way. They can come through that side now.";
  };

  const chewWall = (enemy, dt) => {
    const wall = state.walls[enemy.wall];
    if (!wall || wall.hp <= 0) {
      enemy.role = "runner";
      enemy.chewing = false;
      return;
    }
    wall.hp = Math.max(0, wall.hp - enemy.chew * dt);
    wall.flash = 0.16;
    enemy.chewing = true;
    if (wall.hp <= 0) breachWall(enemy.wall);
  };

  const steer = (enemy, dt) => {
    const edges = intactEdges();
    enemy.chewing = false;

    if (enemy.role === "breaker") {
      if (enemy.egress) {
        const dist = Math.hypot(enemy.x - view.cx, enemy.y - view.cy);
        const outside = dist > view.arena + 8
          && !pointInHex(enemy.x, enemy.y, view.cx, view.cy, view.arena + 2);
        if (outside) {
          enemy.egress = false;
        } else {
          const leave = leaveHex(enemy);
          let vx = leave.x;
          let vy = leave.y;
          if (enemy.shotFrom) {
            const sx = enemy.x - enemy.shotFrom.x;
            const sy = enemy.y - enemy.shotFrom.y;
            const sd = Math.hypot(sx, sy) || 1;
            vx += (sx / sd) * 0.8;
            vy += (sy / sd) * 0.8;
          }
          const n = Math.hypot(vx, vy) || 1;
          enemy.x += (vx / n) * enemy.speed * dt;
          enemy.y += (vy / n) * enemy.speed * dt;
          enemy.atBase = false;
          return;
        }
      }
      const wall = state.walls[enemy.wall];
      const side = view.sides[enemy.wall];
      if (!wall || wall.hp <= 0 || !side) {
        enemy.role = "runner";
      } else {
        const hit = distToSegment(enemy.x, enemy.y, side.a.x, side.a.y, side.b.x, side.b.y);
        if (hit.dist < WALL * 0.5 + ENEMY_R + 12) {
          chewWall(enemy, dt);
          const alongX = side.b.x - side.a.x;
          const alongY = side.b.y - side.a.y;
          const alen = Math.hypot(alongX, alongY) || 1;
          enemy.x += (alongX / alen) * Math.sin(performance.now() / 180 + enemy.wall) * 8 * dt;
          enemy.y += (alongY / alen) * Math.sin(performance.now() / 180 + enemy.wall) * 8 * dt;
          enemy.atBase = false;
          return;
        }
        const dx = hit.x - enemy.x;
        const dy = hit.y - enemy.y;
        const dist = Math.hypot(dx, dy) || 1;
        enemy.x += (dx / dist) * enemy.speed * dt;
        enemy.y += (dy / dist) * enemy.speed * dt;
        enemy.atBase = false;
        return;
      }
    }

    enemy.underFire = Math.max(0, (enemy.underFire || 0) - dt);

    const toBaseX = view.cx - enemy.x;
    const toBaseY = view.cy - enemy.y;
    const dist = Math.hypot(toBaseX, toBaseY) || 1;
    let vx = toBaseX / dist;
    let vy = toBaseY / dist;

    const inYard = dist < view.arena - WALL * 0.1
      || pointInHex(enemy.x, enemy.y, view.cx, view.cy, view.arena - WALL * 0.2);
    const onCore = dist < view.baseR + 16;
    const pressed = !onCore ? nearestPressed(enemy) : null;
    if (pressed && enemy !== pressed) {
      commitPeel(enemy, pressed);
      const peel = peelTowardCore(enemy, pressed);
      vx = peel.x;
      vy = peel.y;
    } else if (inYard && !onCore && state.turrets.length) {
      const flank = flankAroundGuns(enemy);
      if (flank) {
        vx = flank.x;
        vy = flank.y;
        if (!flank.dive) {
          const shy = shyOfGuns(enemy.x, enemy.y, enemy.orbit || 1);
          vx += shy.x;
          vy += shy.y;
        }
      }
    }
    const spread = separateRunners(enemy);
    vx += spread.x * 1.8;
    vy += spread.y * 1.8;
    const n = Math.hypot(vx, vy) || 1;
    vx /= n;
    vy /= n;

    const wall = nearestEdge(enemy.x, enemy.y, edges);
    if (wall && wall.dist < WALL * 0.5 + ENEMY_R + 6) {
      const nlen = Math.hypot(wall.nx, wall.ny) || 1;
      const nx = wall.nx / nlen;
      const ny = wall.ny / nlen;
      const push = WALL * 0.5 + ENEMY_R + 6 - wall.dist;
      enemy.x += nx * push;
      enemy.y += ny * push;
      const slide = vx * -ny + vy * nx;
      const alongX = -ny * Math.sign(slide || enemy.orbit || 1);
      const alongY = nx * Math.sign(slide || enemy.orbit || 1);
      const leave = enemy.peeling ? 0.62 : 0.28;
      vx = alongX * (1 - leave) + vx * leave;
      vy = alongY * (1 - leave) + vy * leave;
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
        color: SHOT_STROKE,
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
      color: SHOT_STROKE,
      life: turret.type === "square" ? 0.16 : 0.08,
      wide: turret.type === "square" ? 3.2 : 1.6,
    });
  };

  const hurt = (enemy, amount, ox, oy) => {
    enemy.hp -= amount;
    enemy.underFire = 0.9;
    enemy.shotFrom = { x: ox, y: oy };
    enemy.hits = (enemy.hits || 0) + 1;
    state.ticks.push({
      x: enemy.x,
      y: enemy.y - 10,
      text: String(Math.round(amount)),
      life: 0.45,
    });
    if (enemy.hp <= 0) {
      enemy.dead = true;
      state.kills += 1;
      state.score += 12;
      state.gold += enemy.role === "breaker" ? 2 : 1;
      state.pops.push({ x: enemy.x, y: enemy.y, life: 0.35, r: 10 });
      return;
    }
    if (enemy.role === "runner" && enemy.hits >= 2) {
      becomeBreaker(enemy, { x: ox, y: oy });
    }
  };

  const wallTone = (frac, hit) => {
    const brass = [215, 176, 122];
    const gold = [240, 196, 120];
    const rose = [255, 108, 96];
    const hot = [255, 214, 150];
    let col = frac > 0.5
      ? mixRgb(gold, brass, (frac - 0.5) / 0.5)
      : mixRgb(rose, gold, frac / 0.5);
    if (hit) col = mixRgb(col, hot, 0.72);
    return col;
  };

  const drawWalls = () => {
    ctx.save();
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    for (const side of view.sides) {
      const wall = state.walls[side.i];
      if (wall.hp <= 0) continue;
      const t = wall.hp / wall.max;
      const flash = wall.flash > 0;
      const tone = wallTone(t, flash);
      ctx.shadowColor = flash ? rgb(tone, 0.55) : "rgba(215, 176, 122, 0.28)";
      ctx.shadowBlur = flash ? 22 : 18;
      ctx.strokeStyle = "rgba(90, 70, 46, 0.88)";
      ctx.lineWidth = WALL + 8;
      ctx.beginPath();
      ctx.moveTo(side.a.x, side.a.y);
      ctx.lineTo(side.b.x, side.b.y);
      ctx.stroke();
      ctx.shadowBlur = 0;
      const dxw = side.b.x - side.a.x;
      const dyw = side.b.y - side.a.y;
      const eat = (1 - t) * 0.5;
      ctx.beginPath();
      ctx.strokeStyle = rgb(tone);
      ctx.lineWidth = WALL * (0.78 + 0.22 * t);
      ctx.moveTo(side.a.x + dxw * eat, side.a.y + dyw * eat);
      ctx.lineTo(side.b.x - dxw * eat, side.b.y - dyw * eat);
      ctx.stroke();

      const inset = WALL * 1.72;
      const ax = side.a.x - side.nx * inset;
      const ay = side.a.y - side.ny * inset;
      const bx = side.b.x - side.nx * inset;
      const by = side.b.y - side.ny * inset;
      const dx = bx - ax;
      const dy = by - ay;
      const len = Math.hypot(dx, dy) || 1;
      const pad = Math.min(18, len * 0.12) / len;
      const sx = ax + dx * pad;
      const sy = ay + dy * pad;
      const ex = bx - dx * pad;
      const ey = by - dy * pad;
      ctx.beginPath();
      ctx.strokeStyle = "rgba(8,11,15,0.72)";
      ctx.lineWidth = 5.4;
      ctx.moveTo(sx, sy);
      ctx.lineTo(ex, ey);
      ctx.stroke();
      ctx.beginPath();
      ctx.strokeStyle = "rgba(243,239,230,0.32)";
      ctx.lineWidth = 4;
      ctx.moveTo(sx, sy);
      ctx.lineTo(ex, ey);
      ctx.stroke();
      if (t > 0.02) {
        ctx.beginPath();
        ctx.strokeStyle = rgb(tone);
        ctx.lineWidth = flash ? 4.2 : 3.4;
        ctx.shadowColor = rgb(tone, 0.45);
        ctx.shadowBlur = flash ? 10 : 4;
        ctx.moveTo(sx, sy);
        ctx.lineTo(sx + (ex - sx) * t, sy + (ey - sy) * t);
        ctx.stroke();
        ctx.shadowBlur = 0;
      }
    }
    ctx.restore();
  };

  const drawApproaches = () => {
    for (const side of openSides()) {
      const outX = side.mx + side.nx * (view.arena * 0.42);
      const outY = side.my + side.ny * (view.arena * 0.42);
      ctx.fillStyle = "rgba(196, 92, 255, 0.08)";
      ctx.beginPath();
      ctx.moveTo(side.a.x, side.a.y);
      ctx.lineTo(outX + (side.a.x - side.mx) * 0.2, outY + (side.a.y - side.my) * 0.2);
      ctx.lineTo(outX + (side.b.x - side.mx) * 0.2, outY + (side.b.y - side.my) * 0.2);
      ctx.lineTo(side.b.x, side.b.y);
      ctx.closePath();
      ctx.fill();
    }
  };

  const mixRgb = (a, b, t) => {
    const p = Math.max(0, Math.min(1, t));
    return [
      a[0] + (b[0] - a[0]) * p,
      a[1] + (b[1] - a[1]) * p,
      a[2] + (b[2] - a[2]) * p,
    ];
  };

  const rgb = (c, a) => (
    a == null
      ? `rgb(${c[0] | 0},${c[1] | 0},${c[2] | 0})`
      : `rgba(${c[0] | 0},${c[1] | 0},${c[2] | 0},${a})`
  );

  const baseTone = (frac, hit) => {
    const ice = [122, 212, 255];
    const gold = [232, 184, 96];
    const rose = [255, 92, 118];
    const mag = [255, 118, 208];
    let col = frac > 0.5
      ? mixRgb(gold, ice, (frac - 0.5) / 0.5)
      : mixRgb(rose, gold, frac / 0.5);
    if (hit) col = mixRgb(col, mag, 0.62);
    return col;
  };

  const drawBase = (t) => {
    const frac = Math.max(0, Math.min(1, state.energy / 100));
    const hit = state.hurt > 0;
    const tone = baseTone(frac, hit);
    const pulse = 1 + Math.sin(t * (hit ? 10 : 3.2)) * (hit ? 0.075 : 0.04);
    const pts = hexPoints(view.cx, view.cy, view.baseR * pulse);
    ctx.save();
    if (hit) {
      ctx.beginPath();
      ctx.fillStyle = rgb(tone, 0.16 + Math.sin(t * 14) * 0.05);
      const bloom = hexPoints(view.cx, view.cy, view.baseR * 1.55);
      ctx.moveTo(bloom[0].x, bloom[0].y);
      for (const p of bloom.slice(1)) ctx.lineTo(p.x, p.y);
      ctx.closePath();
      ctx.fill();
    }
    ctx.shadowColor = rgb(tone, hit ? 0.72 : 0.4);
    ctx.shadowBlur = hit ? 28 : 18;
    ctx.fillStyle = hit ? "#2a1520" : "#152028";
    ctx.strokeStyle = rgb(tone);
    ctx.lineWidth = 4;
    ctx.beginPath();
    ctx.moveTo(pts[0].x, pts[0].y);
    for (const p of pts.slice(1)) ctx.lineTo(p.x, p.y);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
    ctx.shadowBlur = 0;
    const gem = hexPoints(view.cx, view.cy, view.baseR * 0.52);
    ctx.fillStyle = rgb(tone, 0.2 + frac * 0.5);
    ctx.beginPath();
    ctx.moveTo(gem[0].x, gem[0].y);
    for (const p of gem.slice(1)) ctx.lineTo(p.x, p.y);
    ctx.closePath();
    ctx.fill();
    const barR = view.baseR * 1.46;
    ctx.beginPath();
    ctx.strokeStyle = "rgba(8,11,15,0.7)";
    ctx.lineWidth = 7;
    ctx.arc(view.cx, view.cy, barR, 0, Math.PI * 2);
    ctx.stroke();
    ctx.beginPath();
    ctx.strokeStyle = "rgba(243,239,230,0.28)";
    ctx.lineWidth = 5.4;
    ctx.arc(view.cx, view.cy, barR, 0, Math.PI * 2);
    ctx.stroke();
    if (frac > 0.01) {
      ctx.beginPath();
      ctx.strokeStyle = rgb(tone);
      ctx.lineWidth = hit ? 5.6 : 4.6;
      ctx.lineCap = "round";
      ctx.shadowColor = rgb(tone, 0.55);
      ctx.shadowBlur = hit ? 12 : 6;
      ctx.arc(view.cx, view.cy, barR, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * frac);
      ctx.stroke();
      ctx.shadowBlur = 0;
    }
    ctx.restore();
  };

  const draw = (now) => {
    const t = now / 1000;
    ctx.clearRect(0, 0, view.w, view.h);
    const g = ctx.createRadialGradient(view.cx, view.cy, 40, view.cx, view.cy, view.arena * 1.6);
    g.addColorStop(0, "#151b22");
    g.addColorStop(1, "#080b0f");
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, view.w, view.h);

    ctx.beginPath();
    ctx.strokeStyle = "rgba(215, 176, 122, 0.12)";
    ctx.setLineDash([5, 9]);
    ctx.arc(view.cx, view.cy, view.fieldR, 0, Math.PI * 2);
    ctx.stroke();
    ctx.setLineDash([]);

    drawApproaches();
    drawWalls();
    drawBase(t);

    if (state.hover) {
      ctx.globalAlpha = state.hover.ok ? 0.55 : 0.22;
      drawShape(ctx, state.selected, state.hover.x, state.hover.y, 28);
      ctx.globalAlpha = 1;
      if (state.hover.ok) {
        ctx.beginPath();
        ctx.strokeStyle = "rgba(215,176,122,0.22)";
        ctx.arc(state.hover.x, state.hover.y, TYPES[state.selected].range, 0, Math.PI * 2);
        ctx.stroke();
      }
    }

    for (const turret of state.turrets) {
      ctx.beginPath();
      ctx.fillStyle = "rgba(0,0,0,0.28)";
      ctx.ellipse(turret.x + 4, turret.y + 8, 12, 5, 0, 0, Math.PI * 2);
      ctx.fill();
      drawShape(ctx, turret.type, turret.x, turret.y, 30);
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
      const breaker = enemy.role === "breaker";
      const r = breaker ? ENEMY_R + 2.2 : ENEMY_R;
      ctx.beginPath();
      ctx.fillStyle = breaker
        ? (enemy.chewing ? "#ff6b5a" : "#e24b4b")
        : (enemy.atBase ? "#e8a0ff" : "#c45cff");
      ctx.shadowColor = breaker ? "rgba(226, 75, 75, 0.55)" : "rgba(196, 92, 255, 0.5)";
      ctx.shadowBlur = 10;
      if (breaker) {
        ctx.moveTo(enemy.x, enemy.y - r);
        ctx.lineTo(enemy.x + r * 0.92, enemy.y + r * 0.7);
        ctx.lineTo(enemy.x - r * 0.92, enemy.y + r * 0.7);
        ctx.closePath();
      } else {
        ctx.arc(enemy.x, enemy.y, r, 0, Math.PI * 2);
      }
      ctx.fill();
      ctx.shadowBlur = 0;
      ctx.fillStyle = "rgba(0,0,0,0.35)";
      ctx.fillRect(enemy.x - 8, enemy.y - 14, 16, 2);
      ctx.fillStyle = breaker ? "#ff6b5a" : "#e8a0ff";
      ctx.fillRect(enemy.x - 8, enemy.y - 14, 16 * Math.max(0, enemy.hp / enemy.max), 2);
    }

    for (const pop of state.pops) {
      ctx.beginPath();
      ctx.strokeStyle = `rgba(232, 210, 255,${pop.life * 2})`;
      ctx.arc(pop.x, pop.y, (1 - pop.life) * 18, 0, Math.PI * 2);
      ctx.stroke();
    }
    for (const tick of state.ticks) {
      ctx.fillStyle = `rgba(243,239,230,${tick.life * 2})`;
      ctx.font = "11px Helvetica Neue, sans-serif";
      ctx.fillText(tick.text, tick.x - 6, tick.y);
    }

    if (state.phase === "build" || state.phase === "between") {
      ctx.fillStyle = "rgba(243,239,230,0.72)";
      ctx.font = "600 18px Helvetica Neue, sans-serif";
      ctx.textAlign = "center";
      const left = Math.ceil(state.buildLeft);
      const bonus = rushBonusFor(state.buildLeft);
      const extra = bonus ? `  +${bonus}` : "";
      ctx.fillText(
        state.phase === "build" ? `First wave in ${left}s${extra}` : `Next wave in ${left}s${extra}`,
        view.cx,
        view.cy - view.arena - 18,
      );
      ctx.textAlign = "start";
    }

    if (state.phase === "lost" || state.phase === "won") {
      ctx.fillStyle = "rgba(8,11,15,0.55)";
      ctx.fillRect(0, 0, view.w, view.h);
      ctx.fillStyle = "#f3efe6";
      ctx.textAlign = "center";
      ctx.font = "800 42px Helvetica Neue, sans-serif";
      ctx.fillText(state.phase === "won" ? "Hex held" : "Base fallen", view.cx, view.cy - 10);
      ctx.font = "16px Helvetica Neue, sans-serif";
      ctx.fillStyle = "#8b93a0";
      ctx.fillText(`${state.score.toLocaleString()} · wave ${state.wave}`, view.cx, view.cy + 22);
      ctx.textAlign = "start";
    }
  };

  let last = performance.now();
  const tick = (now) => {
    const dt = Math.min(0.05, (now - last) / 1000) * state.speed;
    last = now;
    view = view.w !== canvas.width ? layout() : view;

    if (!state.paused && state.phase !== "menu" && state.phase !== "lost" && state.phase !== "won") {
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
      }

      if (state.phase === "wave" || state.phase === "between") {
        for (const enemy of state.enemies) steer(enemy, dt);
        for (const turret of state.turrets) fire(turret, dt);
        const onBase = state.enemies.filter((e) => e.atBase).length;
        if (onBase) {
          state.hurt = 0.55;
          state.energy -= onBase * 3.4 * dt;
          if (state.energy <= 0) {
            state.energy = 0;
            finish(false);
          }
        }
        state.enemies = state.enemies.filter((e) => !e.dead);
      }

      if (
        state.phase === "wave"
        && state.toSpawn <= 0
        && state.enemies.every((enemy) => enemy.role === "breaker")
      ) {
        state.gold += 8 + Math.floor(threatOf(state.wave) * 0.5);
        state.score += 40 + state.wave * 8;
        if (state.wave >= state.waveCap) {
          finish(true);
        } else {
          state.wave += 1;
          state.phase = "between";
          state.buildLeft = 6;
          if (ui.hint) {
            ui.hint.textContent = "Wave clear. Spend the gold before they come again.";
          }
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
      for (const wall of state.walls) wall.flash = Math.max(0, wall.flash - dt);
      state.hurt = Math.max(0, state.hurt - dt);
      syncHud();
    }

    draw(now);
    requestAnimationFrame(tick);
  };

  syncHud();
  requestAnimationFrame(tick);

  return {
    begin: () => reset({ play: true }),
    menu: () => {
      reset({ play: false });
      hooks.onMenu?.();
    },
  };
}
