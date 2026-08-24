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

const WAVE_CAP = 20;
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
    body.innerHTML = `<tr><td colspan="7">No scores yet. Hold the hex, then post.</td></tr>`;
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

function showPost(result) {
  lastResult = result;
  const form = document.getElementById("score-form");
  const name = document.getElementById("player-name");
  form?.classList.remove("hidden");
  if (name instanceof HTMLInputElement) name.value = playerName();
  form?.scrollIntoView({ behavior: "smooth", block: "nearest" });
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
    document.getElementById("score-form")?.classList.add("hidden");
    lastResult = null;
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
if (canvas instanceof HTMLCanvasElement) {
  startGame(canvas, {
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
        next.textContent = hud.phase === "wave"
          ? "In wave"
          : `Next: ${Math.max(0, Math.ceil(hud.next))}`;
      }
    },
    onOver: (result) => {
      showPost(result);
    },
    onReset: async () => {
      lastResult = null;
      document.getElementById("score-form")?.classList.add("hidden");
      runId = await startRun();
    },
  });
  void startRun().then((id) => {
    runId = id;
  });
}
