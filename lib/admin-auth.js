// Accès à l'espace responsable : mot de passe unique (ADMIN_PASSWORD) + cookie de session signé.
const crypto = require("crypto");

const COOKIE = "aelia_admin";
const DURATION = 12 * 3600e3;
const LONG = 30 * 24 * 3600e3; // « rester connectée sur cet appareil »

const configured = () => Boolean(process.env.ADMIN_PASSWORD);
const key = () => crypto.createHash("sha256").update("aelia-admin-session:" + process.env.ADMIN_PASSWORD).digest();
const sign = (payload) => crypto.createHmac("sha256", key()).update(payload).digest("base64url");

function sameSecret(a, b) {
  const ha = crypto.createHash("sha256").update(String(a)).digest();
  const hb = crypto.createHash("sha256").update(String(b)).digest();
  return crypto.timingSafeEqual(ha, hb);
}

const checkPassword = (pw) => configured() && sameSecret(pw, process.env.ADMIN_PASSWORD);

function sessionValue(ms) {
  const exp = String(Date.now() + ms);
  return `${exp}.${sign(exp)}`;
}

function parseCookies(header = "") {
  return Object.fromEntries(header.split(";").map((c) => c.trim().split(/=(.*)/s).slice(0, 2)).filter(([k]) => k));
}

function isLoggedIn(req) {
  if (!configured()) return false;
  const v = parseCookies(req.headers.cookie)[COOKIE];
  if (!v) return false;
  const [exp, sig] = v.split(".");
  if (!exp || !sig || Number(exp) < Date.now()) return false;
  const expected = sign(exp);
  const a = Buffer.from(sig), b = Buffer.from(expected);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

function setSession(req, res, remember = false) {
  const secure = req.secure ? "; Secure" : "";
  const ms = remember ? LONG : DURATION;
  res.setHeader("Set-Cookie", `${COOKIE}=${sessionValue(ms)}; Path=/admin; HttpOnly; SameSite=Strict; Max-Age=${ms / 1000}${secure}`);
}
function clearSession(req, res) {
  const secure = req.secure ? "; Secure" : "";
  res.setHeader("Set-Cookie", `${COOKIE}=; Path=/admin; HttpOnly; SameSite=Strict; Max-Age=0${secure}`);
}

// Limite les essais de mot de passe : 6 échecs par quart d'heure et par adresse IP
const fails = new Map();
function tooManyFails(ip) {
  const now = Date.now();
  const recent = (fails.get(ip) || []).filter((t) => now - t < 15 * 60e3);
  fails.set(ip, recent);
  return recent.length >= 6;
}
const recordFail = (ip) => fails.set(ip, [...(fails.get(ip) || []), Date.now()]);

module.exports = { configured, checkPassword, isLoggedIn, setSession, clearSession, tooManyFails, recordFail };
