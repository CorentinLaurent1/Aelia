// Lien d'annulation : jeton signé (HMAC), sans stockage côté serveur.
// Secret : CANCEL_SECRET, ou à défaut dérivé du mot de passe d'application iCloud.
const crypto = require("crypto");

function secret() {
  const s = process.env.CANCEL_SECRET || process.env.ICLOUD_APP_PASSWORD;
  if (!s) throw new Error("CANCEL_SECRET manquant");
  return crypto.createHash("sha256").update("aelia-cancel:" + s).digest();
}

const sign = (payload) => crypto.createHmac("sha256", secret()).update(payload).digest("base64url");

// data : { u: uid de l'événement, s: début ISO UTC, v: id prestation, n: nom, e: e-mail }
function createToken(data) {
  const payload = Buffer.from(JSON.stringify(data)).toString("base64url");
  return `${payload}.${sign(payload)}`;
}

function readToken(token) {
  const [payload, sig] = String(token || "").split(".");
  if (!payload || !sig) return null;
  const expected = sign(payload);
  const a = Buffer.from(sig), b = Buffer.from(expected);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;
  try { return JSON.parse(Buffer.from(payload, "base64url").toString("utf8")); } catch { return null; }
}

module.exports = { createToken, readToken };
