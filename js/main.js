import { startGame } from "./game.js";
import { APP_VERSION } from "./version.js";
import {
  adoptFieldRushIdentity,
  currentUser,
  leavePresence,
  playerName,
  refreshUser,
  requestLink,
  sendHeartbeat,
  signOut,
  startRun,
  submitHold,
  verifyLink,
  watchHoldScores,
  watchLiveCount,
  watchLivePlayers,
} from "./social.js";

const WAVE_CAP = 200;
let runId = null;
let lastResult = null;
let boardDifficulty = "easy";
let boardRange = "all";
let allRows = [];
let stopBoard = null;

function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, (char) => {
    if (char === "&") return "&amp;";
    if (char === "<") return "&lt;";
    if (char === ">") return "&gt;";
    return "&#39;";
  });
}

function formatWhen(ts) {
  return new Date(ts).toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
  });
}

function nameHue(name) {
  let n = 0;
  for (let i = 0; i < name.length; i += 1) n = (n * 33 + name.charCodeAt(i)) >>> 0;
  return n % 360;
}

function boardFace(row) {
  if (row.avatar) {
    return `<img class="board-face" src="https://field-rush.vercel.app/avatars/${encodeURIComponent(row.avatar)}.png" alt="" width="22" height="22" />`;
  }
  return `<span class="board-face board-dot" style="background:hsl(${nameHue(row.name)} 46% 42%)"></span>`;
}

function sinceForRange() {
  const now = Date.now();
  if (boardRange === "today") {
    const start = new Date();
    start.setHours(0, 0, 0, 0);
    return start.getTime();
  }
  if (boardRange === "week") return now - 7 * 24 * 60 * 60 * 1000;
  return 0;
}

function paintAccount() {
  const guest = document.getElementById("account-guest");
  const signed = document.getElementById("account-user");
  const nameEl = document.getElementById("account-name");
  const levelEl = document.getElementById("account-level");
  const user = currentUser();
  if (!user) {
    guest?.classList.remove("hidden");
    signed?.classList.add("hidden");
    return;
  }
  guest?.classList.add("hidden");
  signed?.classList.remove("hidden");
  if (nameEl) nameEl.textContent = user.name || user.email;
  if (levelEl) levelEl.textContent = user.level ? `Level ${user.level}` : user.email;
}

function paintOnline(rows) {
  const list = document.getElementById("online-list");
  const empty = document.getElementById("online-empty");
  if (!list) return;
  const you = playerName() || "You";
  const others = rows.filter((row) => !row.self);
  const mine = rows.find((row) => row.self);
  const shown = [{ name: you, self: true, version: mine?.version }, ...others];
  if (empty) empty.classList.add("hidden");
  list.innerHTML = shown.map((row) => `
    <li class="${row.self ? "online-you" : ""}">
      <span class="online-name">${escapeHtml(row.name)}</span>
    </li>
  `).join("");
}

function paintBoard() {
  const body = document.getElementById("scoreboard-body");
  const status = document.getElementById("scoreboard-status");
  if (!body) return;
  const since = sinceForRange();
  const rows = allRows.filter((row) => row.createdAt >= since);
  if (status) status.textContent = `Hex · ${boardDifficulty[0].toUpperCase()}${boardDifficulty.slice(1)}`;
  if (!rows.length) {
    body.innerHTML = `<tr><td colspan="7">No scores yet. Hold the Hex, then post.</td></tr>`;
    return;
  }
  body.innerHTML = rows.map((row, index) => `
    <tr>
      <td>${index + 1}</td>
      <td><span class="board-name">${boardFace(row)}${escapeHtml(row.name)}</span></td>
      <td class="board-mode">${escapeHtml(row.difficulty ?? "easy")}</td>
      <td class="board-score">${Number(row.score).toLocaleString()}</td>
      <td>${row.waves}${row.won ? " ✓" : ""}</td>
      <td class="board-ver">${row.version ? escapeHtml(row.version) : "—"}</td>
      <td>${formatWhen(row.createdAt)}</td>
    </tr>
  `).join("");
}

function formatDuration(ms) {
  if (!Number.isFinite(ms) || ms < 1) return "—";
  const total = Math.round(ms / 1000);
  const minutes = Math.floor(total / 60);
  const seconds = total % 60;
  return `${minutes}:${String(seconds).padStart(2, "0")}`;
}

function showStartCard() {
  lastResult = null;
  const overlay = document.getElementById("overlay");
  const title = document.getElementById("overlay-title");
  const copy = document.getElementById("overlay-copy");
  const score = document.getElementById("overlay-score");
  const recap = document.getElementById("run-recap");
  const form = document.getElementById("score-form");
  const start = document.getElementById("btn-start");
  const status = document.getElementById("score-status");
  overlay?.classList.remove("hidden");
  if (title) title.textContent = "Hold the Hex";
  if (copy) {
    copy.textContent = "Defend your base from attackers. Place shapes in or around the hex. Violet dots come through the open wall. Red breakers chew the brass — slowly. Amber sparks blow a gun if they get close. Rush the countdown for leftover seconds × 6 × the next wave.";
    copy.classList.remove("hidden");
  }
  score?.classList.add("hidden");
  recap?.classList.add("hidden");
  form?.classList.add("hidden");
  if (status) status.textContent = "";
  if (start) {
    start.textContent = "Start game";
    start.classList.remove("hidden");
  }
}

function showEndCard(result) {
  lastResult = result;
  const overlay = document.getElementById("overlay");
  const title = document.getElementById("overlay-title");
  const copy = document.getElementById("overlay-copy");
  const score = document.getElementById("overlay-score");
  const recap = document.getElementById("run-recap");
  const form = document.getElementById("score-form");
  const start = document.getElementById("btn-start");
  const name = document.getElementById("player-name");
  const status = document.getElementById("score-status");
  overlay?.classList.remove("hidden");
  if (title) title.textContent = result.won ? "Hex held" : "Base fallen";
  if (copy) {
    const you = playerName();
    copy.textContent = result.won
      ? `Two hundred waves down. The base still stands${you ? ` — well held, ${you}` : ""}.`
      : `The attackers reached the core${you ? ` — better luck next time, ${you}` : ""}.`;
  }
  if (score) {
    score.textContent = result.score.toLocaleString();
    score.classList.remove("hidden");
  }
  if (recap) {
    recap.innerHTML = `
      <p>Wave ${result.wave} / ${WAVE_CAP}${result.won ? " — hex held" : ""}</p>
      <p>Score ${result.score.toLocaleString()} · ${Number(result.kills || 0).toLocaleString()} kills</p>
      <p>Run time ${formatDuration(result.durationMs)}</p>
    `;
    recap.classList.remove("hidden");
  }
  form?.classList.remove("hidden");
  start?.classList.add("hidden");
  if (status) status.textContent = "";
  if (name instanceof HTMLInputElement) {
    name.value = playerName();
    name.focus();
  }
}

function showPlayAgain() {
  document.getElementById("score-form")?.classList.add("hidden");
  const start = document.getElementById("btn-start");
  if (start) {
    start.textContent = "Play again";
    start.classList.remove("hidden");
  }
  document.getElementById("overlay")?.classList.remove("hidden");
}

async function refreshBoard() {
  stopBoard?.();
  stopBoard = await watchHoldScores((rows) => {
    allRows = Array.isArray(rows) ? rows : [];
    paintBoard();
  }, boardDifficulty);
}

async function consumeAuth() {
  const url = new URL(window.location.href);
  const token = url.searchParams.get("auth");
  const note = document.getElementById("signup-status");
  if (token) {
    url.searchParams.delete("auth");
    history.replaceState({}, "", `${url.pathname}${url.search}${url.hash}`);
    try {
      await verifyLink(token);
      if (note) note.textContent = "Signed in.";
    } catch (err) {
      if (note) note.textContent = err instanceof Error ? err.message : "That sign-in link did not work.";
    }
    paintAccount();
    return;
  }
  const shared = await adoptFieldRushIdentity();
  if (shared === undefined) return;
  if (!shared) await refreshUser();
  paintAccount();
}

document.getElementById("signup-form")?.addEventListener("submit", async (event) => {
  event.preventDefault();
  const input = document.getElementById("signup-email");
  const note = document.getElementById("signup-status");
  const button = document.getElementById("btn-signup");
  if (!(input instanceof HTMLInputElement) || !(button instanceof HTMLButtonElement)) return;
  button.disabled = true;
  if (note) note.textContent = "Sending link…";
  try {
    await requestLink(input.value.trim());
    if (note) note.textContent = "Check your email. Same Arcade Engage account as Field Rush.";
  } catch (err) {
    if (note) note.textContent = err instanceof Error ? err.message : "Could not send the link.";
  }
  button.disabled = false;
});

document.getElementById("btn-signout")?.addEventListener("click", async () => {
  await signOut();
  paintAccount();
});

document.getElementById("board-tabs")?.addEventListener("click", (event) => {
  const btn = event.target.closest(".board-tab");
  if (!btn) return;
  if (btn.dataset.board === "daily") {
    document.getElementById("scoreboard-status").textContent = "Daily is for later holds.";
    return;
  }
  boardDifficulty = btn.dataset.difficulty || "easy";
  for (const node of document.querySelectorAll("#board-tabs .board-tab")) {
    node.classList.toggle("selected", node === btn);
  }
  void refreshBoard();
});

document.getElementById("range-tabs")?.addEventListener("click", (event) => {
  const btn = event.target.closest(".board-tab");
  if (!btn) return;
  boardRange = btn.dataset.range || "all";
  for (const node of document.querySelectorAll("#range-tabs .board-tab")) {
    node.classList.toggle("selected", node === btn);
  }
  paintBoard();
});

document.getElementById("score-form")?.addEventListener("submit", async (event) => {
  event.preventDefault();
  if (!lastResult) return;
  const name = document.getElementById("player-name");
  const note = document.getElementById("score-status");
  if (!(name instanceof HTMLInputElement)) return;
  const posted = name.value.trim();
  if (posted.length < 2) {
    if (note) note.textContent = "Name must be 2 to 16 letters.";
    return;
  }
  localStorage.setItem("arcadeengage-name", posted);
  if (note) note.textContent = "Posting to Convex…";
  try {
    await submitHold({
      name: posted,
      score: lastResult.score,
      waves: lastResult.wave,
      won: lastResult.won,
      runId,
      durationMs: lastResult.durationMs,
      kills: lastResult.kills,
      email: currentUser()?.email,
    });
    if (note) note.textContent = "Posted to the live board.";
    lastResult = null;
    showPlayAgain();
    void refreshBoard();
  } catch (err) {
    if (note) note.textContent = err instanceof Error ? err.message : "Could not post.";
  }
});

paintAccount();
paintOnline([]);
paintBoard();

void consumeAuth().then(() => {
  paintAccount();
  void sendHeartbeat({ name: playerName() });
});

const onlineEl = document.getElementById("stat-online");
void watchLiveCount((count) => {
  if (onlineEl) onlineEl.textContent = String(Math.max(Number(count) || 0, 1));
});
void watchLivePlayers(paintOnline);
void refreshBoard();

const heartbeat = setInterval(() => {
  if (document.visibilityState === "visible") void sendHeartbeat({ name: playerName() });
}, 8000);
document.addEventListener("visibilitychange", () => {
  if (document.visibilityState === "visible") void sendHeartbeat({ name: playerName() });
});
window.addEventListener("pagehide", () => {
  clearInterval(heartbeat);
  void leavePresence();
});

const canvas = document.getElementById("game");
let hold = null;
if (canvas instanceof HTMLCanvasElement) {
  hold = startGame(canvas, {
    waveCap: WAVE_CAP,
    version: APP_VERSION,
    onHud: (hud) => {
      const lives = document.getElementById("stat-lives");
      const gold = document.getElementById("stat-gold");
      const score = document.getElementById("stat-score");
      const wave = document.getElementById("stat-wave");
      const next = document.getElementById("stat-next");
      if (lives) lives.textContent = String(hud.lives);
      if (gold) gold.textContent = String(hud.gold);
      if (score) score.textContent = hud.score.toLocaleString();
      if (wave) wave.textContent = `${hud.wave} / ${hud.waveCap}`;
      if (next) {
        next.textContent = hud.phase === "menu"
          ? "Ready"
          : hud.phase === "wave"
            ? "In wave"
            : `Next: ${Math.max(0, Math.ceil(hud.next))}`;
      }
    },
    onOver: (result) => {
      showEndCard(result);
    },
    onMenu: () => {
      showStartCard();
    },
    onReset: async () => {
      lastResult = null;
      runId = await startRun();
    },
  });
}

document.getElementById("btn-start")?.addEventListener("click", () => {
  const start = document.getElementById("btn-start");
  if (start?.textContent === "Play again") {
    hold?.menu();
    return;
  }
  document.getElementById("overlay")?.classList.add("hidden");
  lastResult = null;
  hold?.begin();
});

document.getElementById("btn-skip-score")?.addEventListener("click", () => {
  lastResult = null;
  showPlayAgain();
});
