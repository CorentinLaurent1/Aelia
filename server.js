const path = require("path");
const express = require("express");
const nodemailer = require("nodemailer");
const { DateTime } = require("luxon");
const calendar = require("./lib/calendar");
const { computeSlots } = require("./lib/slots");
const { createToken, readToken } = require("./lib/token");
const emails = require("./lib/emails");
const { esc: escMail } = require("./lib/email-template");
const multer = require("multer");
const db = require("./lib/db");
const services = require("./config/services.json");
const cfg = require("./config/availability.json");

const app = express();
const PORT = process.env.PORT || 3000;
const { SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASS, MAIL_TO, MAIL_FROM } = process.env;


app.disable("x-powered-by");
app.set("trust proxy", 1); // Vercel est derrière un proxy : IP réelle et https corrects
app.use((_req, res, next) => {
  res.set({ "X-Content-Type-Options": "nosniff", "Referrer-Policy": "strict-origin-when-cross-origin", "X-Frame-Options": "SAMEORIGIN" });
  next();
});
app.use(express.json({ limit: "20kb" }));

// Seuls les dossiers publics sont servis (jamais server.js, package.json, .env…)
// CSS et JS : toujours revalidés (un navigateur ne garde jamais une ancienne version avec une nouvelle page) ;
// images : cache d'une semaine.
app.use("/assets", express.static(path.join(__dirname, "public", "assets"), {
  setHeaders: (res, file) => {
    res.setHeader("Cache-Control", /\.(css|js)$/.test(file) ? "no-cache" : "public, max-age=604800");
  },
}));
const fs = require("fs");
const crypto = require("crypto");

// Chaque fichier CSS/JS est appelé avec une empreinte de son contenu (style.css?v=ab12cd34) :
// dès qu'il change, le navigateur le recharge, même s'il en gardait une ancienne copie.
const stamps = new Map();
function stampOf(rel) {
  if (!stamps.has(rel)) {
    try { stamps.set(rel, crypto.createHash("md5").update(fs.readFileSync(path.join(__dirname, "public", rel))).digest("hex").slice(0, 8)); }
    catch { stamps.set(rel, "0"); }
  }
  return stamps.get(rel);
}
const versioned = (html) => html.replace(/(?:\.\.\/|\/)?(assets\/(?:css|js)\/[\w.-]+\.(?:css|js))(?=")/g, (m, rel) => `${m}?v=${stampOf(rel)}`);

// Pages HTML (légales, annulation, 404) : mêmes empreintes
const pageHtml = (name) => versioned(fs.readFileSync(path.join(__dirname, "pages", name), "utf8"));
app.get("/pages/:name", (req, res, next) => {
  const name = path.basename(req.params.name);
  if (name === "admin.html" || !/^[\w-]+\.html$/.test(name) || !fs.existsSync(path.join(__dirname, "pages", name))) return next();
  res.type("html").send(pageHtml(name));
});
const siteUrl = (req) => (process.env.SITE_URL || `${req.protocol}://${req.get("host")}`).replace(/\/$/, "");
// La feuille de style de la page d'accueil est intégrée au HTML : le navigateur peut afficher la page sans attendre un second téléchargement.
let cssText;
function inlineCss(html) {
  cssText = cssText || fs.readFileSync(path.join(__dirname, "public", "assets", "css", "style.css"), "utf8");
  return html.replace(/<link rel="stylesheet" href="assets\/css\/style\.css[^"]*">/, () => `<style>${cssText}</style>`);
}
let indexHtml;
app.get("/", (req, res) => {
  indexHtml = indexHtml || fs.readFileSync(path.join(__dirname, "index.html"), "utf8");
  res.set("Cache-Control", "public, s-maxage=300, stale-while-revalidate=86400");
  res.type("html").send(inlineCss(versioned(indexHtml.replace(/__SITE_URL__/g, siteUrl(req)))));
});
// Anciens liens vers index.html : retour à l'accueil
app.get(["/index.html", "/pages/index.html"], (_req, res) => res.redirect(301, "/"));
// Validation de la propriété du site dans Google Search Console (à conserver)
app.get("/googlebeec1be7b3d4485b.html", (_req, res) => res.type("html").send("google-site-verification: googlebeec1be7b3d4485b.html"));
app.get("/robots.txt", (req, res) => {
  res.type("text/plain").send(`User-agent: *\nAllow: /\nDisallow: /api/\nDisallow: /admin\nDisallow: /rendez-vous/\n\nSitemap: ${siteUrl(req)}/sitemap.xml\n`);
});
app.get("/sitemap.xml", (req, res) => {
  const u = siteUrl(req);
  const urls = ["/", "/pages/mentions-legales.html", "/pages/confidentialite.html", "/pages/cgv.html", "/pages/accessibilite.html"];
  res.type("application/xml").send(`<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls.map((p) => `  <url><loc>${u}${p}</loc></url>`).join("\n")}\n</urlset>\n`);
});

const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

// Limite simple : 5 demandes par heure et par adresse IP
const hits = new Map();
function tooMany(ip) {
  const now = Date.now();
  const recent = (hits.get(ip) || []).filter((t) => now - t < 3600e3);
  recent.push(now);
  hits.set(ip, recent);
  return recent.length > 5;
}

// Sur un hébergement « serverless », la fonction est gelée dès la réponse envoyée :
// on attend donc la fin des envois d'e-mails avant de répondre.
const pendingMail = [];
const flushMail = () => Promise.allSettled(pendingMail.splice(0));

let transporter;
function getTransporter() {
  if (!transporter) {
    transporter = nodemailer.createTransport({
      host: SMTP_HOST,
      port: Number(SMTP_PORT) || 465,
      secure: (Number(SMTP_PORT) || 465) === 465,
      auth: { user: SMTP_USER, pass: SMTP_PASS },
    });
    const send = transporter.sendMail.bind(transporter);
    transporter.sendMail = (opts) => {
      const p = send(opts);
      pendingMail.push(p.catch(() => {}));
      return p;
    };
  }
  return transporter;
}

// ---------- Réservation synchronisée avec l'agenda iCloud ----------
const serviceById = (id) => services.find((s) => s.id === id);
const fmtDay = (iso) => DateTime.fromISO(iso).setZone(cfg.timezone).setLocale("fr").toFormat("cccc d LLLL yyyy 'à' HH'h'mm");
const fmtDuration = (m) => `${Math.floor(m / 60)}h${m % 60 ? String(m % 60).padStart(2, "0") : ""}`;
const DAY_RE = /^\d{4}-\d{2}-\d{2}$/;

let busyCache = { at: 0, busy: [] };
async function busyFromAgenda({ fresh = false } = {}) {
  if (!fresh && Date.now() - busyCache.at < 60e3) return busyCache.busy;
  const from = new Date(Date.now() - 24 * 3600e3);
  const to = new Date(Date.now() + (cfg.horizonDays + 2) * 24 * 3600e3);
  const busy = await calendar.getBusy(from, to, { ignoreAllDay: cfg.ignoreAllDayEvents });
  busyCache = { at: Date.now(), busy };
  return busy;
}

app.get("/api/services", (_req, res) => res.json({ services, bookingEnabled: calendar.configured() }));

app.get("/api/availability", async (req, res) => {
  if (!calendar.configured()) return res.status(503).json({ error: "not_configured" });
  const svc = serviceById(req.query.service);
  const { from, to } = req.query;
  if (svc && svc.quoteOnly) return res.status(400).json({ error: "Prestation sur devis uniquement." });
  if (!svc || !DAY_RE.test(from || "") || !DAY_RE.test(to || "")) return res.status(400).json({ error: "Paramètres invalides." });
  if (DateTime.fromISO(to).diff(DateTime.fromISO(from), "days").days > 62) return res.status(400).json({ error: "Période trop longue." });
  try {
    const busy = await busyFromAgenda();
    res.json({ slots: computeSlots({ minutes: svc.minutes, from, to, busy, cfg }) });
  } catch (e) {
    console.error("Lecture de l'agenda :", e.message);
    res.status(502).json({ error: "Agenda momentanément indisponible." });
  }
});

// Une seule réservation à la fois pour éviter les doubles réservations
let bookingLock = Promise.resolve();

app.post("/api/book", (req, res) => {
  const run = bookingLock.then(() => handleBooking(req, res)).catch((e) => {
    console.error("Réservation :", e);
    if (!res.headersSent) res.status(500).json({ error: "Une erreur est survenue." });
  });
  bookingLock = run.then(() => {}, () => {});
});

async function handleBooking(req, res) {
  const { service, start, name, email, phone, msg, website } = req.body || {};
  if (website) return res.json({ ok: true });
  if (tooMany(req.ip)) return res.status(429).json({ error: "Trop de demandes, réessayez plus tard." });
  if (!calendar.configured()) return res.status(503).json({ error: "not_configured" });

  const clean = (v, max) => String(v || "").trim().slice(0, max);
  const d = { name: clean(name, 100), email: clean(email, 150), phone: clean(phone, 30), msg: clean(msg, 2000) };
  const svc = serviceById(service);
  const startDt = DateTime.fromISO(String(start || ""), { setZone: true });
  if (!svc || svc.quoteOnly || !startDt.isValid || !d.name || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(d.email)) {
    return res.status(400).json({ error: "Formulaire incomplet ou invalide." });
  }

  // Revérification du créneau avec un agenda à jour
  const day = startDt.setZone(cfg.timezone).toISODate();
  let free;
  try {
    free = computeSlots({ minutes: svc.minutes, from: day, to: day, busy: await busyFromAgenda({ fresh: true }), cfg })[day] || [];
  } catch (e) {
    console.error("Lecture de l'agenda :", e.message);
    return res.status(502).json({ error: "Agenda momentanément indisponible." });
  }
  const startUtc = startDt.toUTC().toISO();
  if (!free.includes(startUtc)) return res.status(409).json({ error: "Ce créneau vient d'être pris. Choisissez-en un autre." });

  const startJs = startDt.toJSDate();
  const endJs = startDt.plus({ minutes: svc.minutes }).toJSDate();
  let event;
  try {
    event = await calendar.createEvent({
      start: startJs, end: endJs,
      summary: `${svc.name} · ${d.name}`,
      description: `Prestation : ${svc.name} (${svc.price})\nClient : ${d.name}\nE-mail : ${d.email}\nTéléphone : ${d.phone || "-"}\n\n${d.msg || ""}`,
    });
    busyCache.at = 0;
  } catch (e) {
    console.error("Création de l'événement :", e.message);
    return res.status(502).json({ error: "La réservation n'a pas pu être enregistrée." });
  }

  // Contrôle après écriture : sur un hébergement sans mémoire partagée, deux réservations simultanées
  // peuvent se croiser. En cas de chevauchement, la plus petite référence est conservée, l'autre se retire.
  try {
    const after = await busyFromAgenda({ fresh: true });
    const a = startJs.getTime(), b = endJs.getTime();
    const clash = after.some((o) => o.uid !== event.uid && o.start.getTime() < b && o.end.getTime() > a
      && !(String(o.uid || "").endsWith("@aelia") && o.uid > event.uid));
    if (clash) {
      await calendar.deleteEvent(event.uid);
      busyCache.at = 0;
      return res.status(409).json({ error: "Ce créneau vient d'être pris. Choisissez-en un autre." });
    }
  } catch (e) {
    console.error("Contrôle après écriture :", e.message);
  }

  // E-mails de confirmation (leur échec ne remet pas en cause la réservation)
  const when = fmtDay(startUtc);
  const base = (process.env.SITE_URL || `${req.protocol}://${req.get("host")}`).replace(/\/$/, "");
  const token = createToken({ u: event.uid, s: startUtc, v: svc.id, n: d.name, e: d.email });
  const cancelUrl = `${base}/rendez-vous/annuler?t=${token}`;
  const attachments = [{ filename: "rendez-vous-aelia.ics", content: event.ics, contentType: "text/calendar; charset=utf-8; method=PUBLISH" }];
  const duration = fmtDuration(svc.minutes);
  let emailSent = false;
  if (SMTP_HOST && SMTP_USER && SMTP_PASS) {
    const from = MAIL_FROM || SMTP_USER;
    const t = getTransporter();
    const data = { base, name: d.name, service: svc.name, when, duration, price: svc.price, cancelUrl, cancelHours: cfg.cancelBeforeHours };
    if (MAIL_TO) {
      t.sendMail({ from, to: MAIL_TO, replyTo: `"${d.name.replace(/"/g, "")}" <${d.email}>`, ...emails.bookingOwner({ ...data, email: d.email, phone: d.phone, msg: d.msg }), attachments })
        .catch((e) => console.error("Notification non envoyée :", e.message));
    }
    await t.sendMail({ from, to: d.email, replyTo: MAIL_TO || from, ...emails.bookingClient(data), attachments })
      .then(() => { emailSent = true; }).catch((e) => console.error("Confirmation non envoyée :", e.message));
  }
  await flushMail();
  res.json({ ok: true, service: svc.name, when, duration, emailSent, cancelUrl, ics: event.ics });
}

// ---------- Demande de devis : description + photos, envoyées par e-mail ----------
const upload = multer({ storage: multer.memoryStorage(), limits: { files: 5, fileSize: 2.5 * 1024 * 1024, fields: 12, fieldSize: 6000 } });
const QUOTE_TYPES = { retouche: "Retouches de vêtements (ourlet simple)", style: "Prestation de conseil en style et en image", autre: "Autre demande" };

// Type réel du fichier d'après ses premiers octets (on ne se fie pas à l'extension)
function imageKind(buf) {
  if (buf.length > 12 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return { ext: "jpg", type: "image/jpeg" };
  if (buf.length > 8 && buf.slice(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return { ext: "png", type: "image/png" };
  if (buf.length > 12 && buf.slice(0, 4).toString() === "RIFF" && buf.slice(8, 12).toString() === "WEBP") return { ext: "webp", type: "image/webp" };
  return null;
}

app.post("/api/quote", (req, res, next) => {
  upload.array("photos", 5)(req, res, (err) => {
    if (err) return res.status(400).json({ error: "Photos refusées : 5 maximum, 2,5 Mo chacune." });
    next();
  });
}, async (req, res) => {
  const { type, name, email, phone, msg, website } = req.body || {};
  if (website) return res.json({ ok: true });
  if (tooMany(req.ip)) return res.status(429).json({ error: "Trop de demandes, réessayez plus tard." });
  const clean = (v, max) => String(v || "").trim().slice(0, max);
  const c = { name: clean(name, 100), email: clean(email, 150), phone: clean(phone, 30), msg: clean(msg, 3000), type: QUOTE_TYPES[type] ? type : "" };
  if (!c.type || !c.msg || !c.name || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(c.email)) {
    return res.status(400).json({ error: "Formulaire incomplet ou invalide." });
  }
  const photos = [];
  for (const [i, f] of (req.files || []).entries()) {
    const kind = imageKind(f.buffer);
    if (!kind) return res.status(400).json({ error: "Seules les photos JPEG, PNG ou WebP sont acceptées." });
    photos.push({ filename: `photo-${i + 1}.${kind.ext}`, content: f.buffer, contentType: kind.type });
  }
  if (!(SMTP_HOST && SMTP_USER && SMTP_PASS && MAIL_TO)) {
    console.error("Variables SMTP manquantes");
    return res.status(500).json({ error: "Service d'envoi non configuré." });
  }

  const base = (process.env.SITE_URL || `${req.protocol}://${req.get("host")}`).replace(/\/$/, "");
  const from = MAIL_FROM || SMTP_USER;
  const t = getTransporter();
  const typeLabel = QUOTE_TYPES[c.type];

  // 1. Enregistrement dans le tableau de bord (la demande n'est jamais perdue)
  let ref = "";
  if (db.enabled()) {
    try { ref = db.refOf(await db.insertQuote(c, photos)); } catch (e) { console.error("Enregistrement du devis :", e.message); }
  }
  // 2. E-mail pour vous, avec les photos
  try {
    await t.sendMail({
      from, to: MAIL_TO, replyTo: `"${c.name.replace(/"/g, "")}" <${c.email}>`,
      ...emails.quoteOwner({ base, ref, typeLabel, name: c.name, email: c.email, phone: c.phone, msg: c.msg, photos: photos.length }),
      attachments: photos,
    });
  } catch (e) {
    console.error("Demande de devis non envoyée :", e.message);
    // si elle est enregistrée, la demande n'est pas perdue : on la signale comme reçue
    if (!ref) return res.status(502).json({ error: "L'envoi a échoué." });
  }
  // Accusé de réception pour la cliente (son échec ne remet pas en cause la demande)
  let ackSent = false;
  await t.sendMail({ from, to: c.email, replyTo: MAIL_TO, ...emails.quoteAck({ base, ref, typeLabel, name: c.name, msg: c.msg, photos: photos.length, retouche: c.type === "retouche" }) })
    .then(() => { ackSent = true; }).catch((e) => console.error("Accusé de réception du devis non envoyé :", e.message));
  await flushMail();
  res.json({ ok: true, ackSent, ref });
});

// ---------- Gestion d'un rendez-vous par la cliente (lien signé reçu par e-mail) ----------
app.get("/rendez-vous/annuler", (_req, res) => res.type("html").send(pageHtml("annulation.html")));

function appointmentFromToken(t) {
  const a = readToken(t);
  if (!a || !a.u || !a.s) return null;
  const start = DateTime.fromISO(a.s);
  const hoursLeft = start.diffNow("hours").hours;
  return {
    a, start, hoursLeft,
    service: (serviceById(a.v) || {}).name || "Rendez-vous Aélia",
    when: fmtDay(a.s),
  };
}

app.get("/api/appointment", async (req, res) => {
  let ap;
  try { ap = appointmentFromToken(req.query.t); } catch { ap = null; }
  if (!ap) return res.status(400).json({ error: "Lien invalide." });
  let state = "active";
  if (calendar.configured() && ap.hoursLeft > 0) {
    try { if (!(await calendar.eventExists(ap.a.u))) state = "cancelled"; } catch { /* on laisse "active" */ }
  }
  res.json({
    service: ap.service, when: ap.when, hours: cfg.cancelBeforeHours,
    past: ap.hoursLeft <= 0, canCancel: ap.hoursLeft >= cfg.cancelBeforeHours,
    state,
  });
});

app.post("/api/cancel", (req, res) => {
  const run = bookingLock.then(() => handleCancel(req, res)).catch((e) => {
    console.error("Annulation :", e);
    if (!res.headersSent) res.status(500).json({ error: "Une erreur est survenue." });
  });
  bookingLock = run.then(() => {}, () => {});
});

async function handleCancel(req, res) {
  if (tooMany(req.ip)) return res.status(429).json({ error: "Trop de demandes, réessayez plus tard." });
  if (!calendar.configured()) return res.status(503).json({ error: "not_configured" });
  let ap;
  try { ap = appointmentFromToken(req.body && req.body.t); } catch { ap = null; }
  if (!ap) return res.status(400).json({ error: "Lien invalide." });
  if (ap.hoursLeft < cfg.cancelBeforeHours) {
    return res.status(403).json({ error: `Annulation en ligne impossible à moins de ${cfg.cancelBeforeHours} h du rendez-vous.` });
  }
  let removed;
  try {
    removed = await calendar.deleteEvent(ap.a.u);
    busyCache.at = 0;
  } catch (e) {
    console.error("Suppression de l'événement :", e.message);
    return res.status(502).json({ error: "L'annulation n'a pas pu être enregistrée." });
  }
  // e-mails seulement si l'événement existait encore (évite les doublons si le lien est recliqué)
  if (removed && SMTP_HOST && SMTP_USER && SMTP_PASS) {
    const from = MAIL_FROM || SMTP_USER;
    const t = getTransporter();
    const base = (process.env.SITE_URL || `${req.protocol}://${req.get("host")}`).replace(/\/$/, "");
    const data = { base, name: ap.a.n, email: ap.a.e, service: ap.service, when: ap.when };
    if (MAIL_TO) t.sendMail({ from, to: MAIL_TO, ...emails.cancelOwner(data) }).catch((e) => console.error("Notification d'annulation non envoyée :", e.message));
    t.sendMail({ from, to: ap.a.e, replyTo: MAIL_TO || from, ...emails.cancelClient(data) }).catch((e) => console.error("Confirmation d'annulation non envoyée :", e.message));
  }
  await flushMail();
  res.json({ ok: true });
}

// ---------- Espace responsable (tableau de bord) ----------
require("./lib/admin-routes")(app, {
  calendar, cfg, pageHtml, emails, getTransporter, flushMail, MAIL_FROM, SMTP_USER, MAIL_TO, siteUrl, fmtDay,
  mailConfigured: () => Boolean(SMTP_HOST && SMTP_USER && SMTP_PASS),
});

// Page 404 aux couleurs du site
app.use((_req, res) => res.status(404).type("html").send(pageHtml("404.html")));

// Vercel importe l'application ; un hébergeur classique (ou `npm start`) lance le serveur.
if (require.main === module) app.listen(PORT, () => console.log(`Aélia sur http://localhost:${PORT}`));

module.exports = app;
