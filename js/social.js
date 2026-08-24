import { ConvexClient } from "convex/browser";
import { api } from "./api.js";
import { APP_VERSION } from "./version.js";

const CLIENT_KEY = "arcadeengage-client";
const SESSION_KEY = "arcadeengage-session";
const FIELD_RUSH_ORIGIN = "https://field-rush.vercel.app";
const GAME = "form-hold";
const CONVEX_URL =
  import.meta.env.VITE_CONVEX_URL
  || "https://pastel-wildcat-835.eu-west-1.convex.cloud";

export function getClientKey() {
  let id = localStorage.getItem(CLIENT_KEY);
  if (!id) {
    id = crypto.randomUUID().replaceAll("-", "");
    localStorage.setItem(CLIENT_KEY, id);
  }
  return id;
}

let ready = null;
let user = null;

export async function getConvex() {
  if (ready !== null) return ready;
  try {
    ready = { client: new ConvexClient(CONVEX_URL), api };
    return ready;
  } catch {
    ready = null;
    return null;
  }
}

function readArcadeCookie() {
  const match = document.cookie.match(/(?:^|; )arcade_session=([^;]+)/);
  return match?.[1] ? decodeURIComponent(match[1]) : "";
}

function writeArcadeCookie(token) {
  if (!location.hostname.endsWith("arcadeengage.com")) return;
  document.cookie = `arcade_session=${encodeURIComponent(token)}; Domain=.arcadeengage.com; Path=/; Max-Age=${60 * 24 * 60 * 60}; SameSite=Lax; Secure`;
}

function clearArcadeCookie() {
  if (!location.hostname.endsWith("arcadeengage.com")) return;
  document.cookie = "arcade_session=; Domain=.arcadeengage.com; Path=/; Max-Age=0; SameSite=Lax; Secure";
}

export function getSession() {
  return localStorage.getItem(SESSION_KEY) || readArcadeCookie() || "";
}

export function currentUser() {
  return user;
}

export function playerName() {
  return currentUser()?.name
    || localStorage.getItem("arcadeengage-name")
    || localStorage.getItem("fieldrush-name")
    || "";
}

export async function refreshUser() {
  const session = getSession();
  if (!session) {
    user = null;
    return null;
  }
  const convex = await getConvex();
  if (!convex) return null;
  try {
    user = await convex.client.query(api.auth.me, { session, now: Date.now() });
    if (!user) {
      localStorage.removeItem(SESSION_KEY);
      clearArcadeCookie();
    }
    return user;
  } catch {
    return null;
  }
}

export async function requestLink(email) {
  const convex = await getConvex();
  if (!convex) throw new Error("Sign-in is offline.");
  return await convex.client.mutation(api.auth.requestLink, {
    email,
    origin: window.location.origin,
    clientKey: getClientKey(),
  });
}

export async function verifyLink(token) {
  const convex = await getConvex();
  if (!convex) throw new Error("Sign-in is offline.");
  const result = await convex.client.mutation(api.auth.verify, {
    token,
    clientKey: getClientKey(),
    name: playerName() || undefined,
  });
  localStorage.setItem(SESSION_KEY, result.session);
  writeArcadeCookie(result.session);
  if (result.user?.name) localStorage.setItem("arcadeengage-name", result.user.name);
  user = result.user;
  return result.user;
}

export async function acceptSharedSession(session, name) {
  if (typeof name === "string" && name.trim()) {
    localStorage.setItem("arcadeengage-name", name.trim());
  }
  if (typeof session === "string" && session.length >= 32) {
    localStorage.setItem(SESSION_KEY, session);
    writeArcadeCookie(session);
  }
  return await refreshUser();
}

export async function signOut() {
  const session = getSession();
  localStorage.removeItem(SESSION_KEY);
  clearArcadeCookie();
  user = null;
  const convex = await getConvex();
  if (!convex || !session) return;
  try {
    await convex.client.mutation(api.auth.logout, { session });
  } catch {
    // Already gone.
  }
}

export async function startRun() {
  const convex = await getConvex();
  if (!convex) return null;
  try {
    return await convex.client.mutation(api.scores.startRun, {
      clientKey: getClientKey(),
    });
  } catch (err) {
    console.error(err);
    return null;
  }
}

export async function submitHold(payload) {
  const convex = await getConvex();
  if (!convex) throw new Error("Scoreboard is offline.");
  const args = {
    clientKey: getClientKey(),
    name: payload.name,
    score: payload.score,
    waves: payload.waves,
    won: Boolean(payload.won),
    difficulty: "easy",
    game: GAME,
    version: APP_VERSION,
  };
  if (payload.runId) args.runId = payload.runId;
  if (Number.isInteger(payload.durationMs)) args.durationMs = payload.durationMs;
  if (Number.isInteger(payload.kills)) args.kills = payload.kills;
  if (typeof payload.email === "string" && payload.email.trim()) args.email = payload.email.trim();
  return await convex.client.mutation(api.scores.submit, args);
}

export async function watchHoldScores(onRows, difficulty = "easy") {
  const convex = await getConvex();
  if (!convex) return null;
  return convex.client.onUpdate(api.scores.listHold, { difficulty }, onRows);
}

export async function watchLiveCount(onCount) {
  const convex = await getConvex();
  if (!convex) return null;
  return convex.client.onUpdate(api.presence.countLive, { game: GAME }, onCount);
}

export async function watchLivePlayers(onRows) {
  const convex = await getConvex();
  if (!convex) return null;
  return convex.client.onUpdate(
    api.presence.listLive,
    { clientKey: getClientKey(), game: GAME },
    onRows,
  );
}

export async function sendHeartbeat(extra = {}) {
  const convex = await getConvex();
  if (!convex) return;
  try {
    const args = { clientKey: getClientKey(), game: GAME, version: APP_VERSION, difficulty: "easy" };
    if (typeof extra.name === "string" && extra.name.trim()) args.name = extra.name.trim();
    await convex.client.mutation(api.presence.heartbeat, args);
  } catch (err) {
    console.error(err);
  }
}

export async function leavePresence() {
  const convex = await getConvex();
  if (!convex) return;
  try {
    await convex.client.mutation(api.presence.leave, { clientKey: getClientKey() });
  } catch {
    // Fine if we were never marked live.
  }
}

function stripHash() {
  history.replaceState({}, "", `${location.pathname}${location.search}`);
}

function readHashPayload() {
  const hash = location.hash.startsWith("#") ? location.hash.slice(1) : location.hash;
  if (!hash) return null;
  const params = new URLSearchParams(hash);
  if (params.has("arcade-guest")) return { guest: true };
  const raw = params.get("arcade");
  if (!raw) return null;
  try {
    const data = JSON.parse(raw);
    if (data && typeof data === "object") return data;
  } catch {
    // Ignore a broken hash.
  }
  return null;
}

export async function adoptFieldRushIdentity() {
  const bounced = readHashPayload();
  if (bounced?.guest) {
    stripHash();
    return null;
  }
  if (bounced?.session) {
    stripHash();
    return await acceptSharedSession(bounced.session, bounced.name);
  }
  if (getSession()) return await refreshUser();
  if (location.hostname === "localhost" || location.hostname === "127.0.0.1") {
    return await refreshUser();
  }
  const next = `${location.origin}${location.pathname}${location.search}`;
  location.replace(`${FIELD_RUSH_ORIGIN}/handoff.html?next=${encodeURIComponent(next)}`);
  return undefined;
}
