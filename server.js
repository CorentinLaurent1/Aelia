const path = require("path");
const express = require("express");
const nodemailer = require("nodemailer");
const { DateTime } = require("luxon");
const calendar = require("./lib/calendar");
const { computeSlots } = require("./lib/slots");
const { createToken, readToken } = require("./lib/token");
const services = require("./config/services.json");
const cfg = require("./config/availability.json");

const app = express();
const PORT = process.env.PORT || 3000;
const { SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASS, MAIL_TO, MAIL_FROM } = process.env;

const SERVICES = [
  "Analyse morphologique", "Analyse colorimétrique", "Étude de style personnalisée",
  "Tri de dressing", "Accompagnement shopping", "Pack Éclat", "Pack Signature", "Pack Renaissance",
];

app.disable("x-powered-by");
app.set("trust proxy", 1); // Render est derrière un proxy : IP réelle et https corrects
app.use((_req, res, next) => {
  res.set({ "X-Content-Type-Options": "nosniff", "Referrer-Policy": "strict-origin-when-cross-origin", "X-Frame-Options": "SAMEORIGIN" });
  next();
});
app.use(express.json({ limit: "20kb" }));

// Seuls les dossiers publics sont servis (jamais server.js, package.json, .env…)
app.use("/assets", express.static(path.join(__dirname, "assets"), { maxAge: "7d" }));
app.use("/pages", express.static(path.join(__dirname, "pages")));
app.get("/", (_req, res) => res.sendFile(path.join(__dirname, "index.html")));

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

let transporter;
function getTransporter() {
  if (!transporter) {
    transporter = nodemailer.createTransport({
      host: SMTP_HOST,
      port: Number(SMTP_PORT) || 465,
      secure: (Number(SMTP_PORT) || 465) === 465,
      auth: { user: SMTP_USER, pass: SMTP_PASS },
    });
  }
  return transporter;
}

app.post("/api/contact", async (req, res) => {
  const { service, name, email, msg, website } = req.body || {};

  // Champ piège anti-robots : un humain ne le remplit jamais
  if (website) return res.json({ ok: true });

  if (tooMany(req.ip)) return res.status(429).json({ error: "Trop de demandes, réessayez plus tard." });

  const clean = (v, max) => String(v || "").trim().slice(0, max);
  const data = { service: clean(service, 80), name: clean(name, 100), email: clean(email, 150), msg: clean(msg, 2000) };

  if (!SERVICES.includes(data.service) || !data.name || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(data.email)) {
    return res.status(400).json({ error: "Formulaire incomplet ou invalide." });
  }
  if (!SMTP_HOST || !SMTP_USER || !SMTP_PASS || !MAIL_TO) {
    console.error("Variables SMTP manquantes");
    return res.status(500).json({ error: "Service d'envoi non configuré." });
  }

  const from = MAIL_FROM || SMTP_USER;
  try {
    const t = getTransporter();
    // 1. Notification pour vous (reply-to = la cliente)
    await t.sendMail({
      from, to: MAIL_TO, replyTo: `"${data.name.replace(/"/g, "")}" <${data.email}>`,
      subject: `Nouvelle demande : ${data.service}`,
      text: `Prestation : ${data.service}\nNom : ${data.name}\nE-mail : ${data.email}\n\nMessage :\n${data.msg || "(aucun)"}`,
      html: `<h2>Nouvelle demande de rendez-vous</h2><p><b>Prestation :</b> ${esc(data.service)}<br><b>Nom :</b> ${esc(data.name)}<br><b>E-mail :</b> ${esc(data.email)}</p><p><b>Message :</b><br>${esc(data.msg || "(aucun)").replace(/\n/g, "<br>")}</p>`,
    });
    // 2. Accusé de réception pour la cliente (son échec ne bloque pas la demande)
    t.sendMail({
      from, to: data.email, replyTo: MAIL_TO,
      subject: "Votre demande a bien été reçue · Aélia",
      text: `Bonjour ${data.name},\n\nJ'ai bien reçu votre demande pour : ${data.service}.\nJe reviens vers vous très vite pour convenir d'un créneau.\n\nÀ bientôt,\nLaësia · Aélia, conseil en style et image`,
      html: `<p>Bonjour ${esc(data.name)},</p><p>J'ai bien reçu votre demande pour : <b>${esc(data.service)}</b>.<br>Je reviens vers vous très vite pour convenir d'un créneau.</p><p>À bientôt,<br>Laësia · <i>Aélia, conseil en style et image</i></p>`,
    }).catch((e) => console.error("Accusé de réception non envoyé :", e.message));

    res.json({ ok: true });
  } catch (e) {
    console.error("Échec d'envoi :", e.message);
    res.status(502).json({ error: "L'envoi a échoué." });
  }
});


// ---------- Réservation synchronisée avec l'agenda iCloud ----------
const serviceById = (id) => services.find((s) => s.id === id);
const fmtDay = (iso) => DateTime.fromISO(iso).setZone(cfg.timezone).setLocale("fr").toFormat("cccc d LLLL yyyy 'à' HH'h'mm");
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
  if (!svc || !startDt.isValid || !d.name || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(d.email)) {
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

  // E-mails de confirmation (leur échec ne remet pas en cause la réservation)
  const when = fmtDay(startUtc);
  const base = process.env.SITE_URL || `${req.protocol}://${req.get("host")}`;
  const token = createToken({ u: event.uid, s: startUtc, v: svc.id, n: d.name, e: d.email });
  const cancelUrl = `${base.replace(/\/$/, "")}/rendez-vous/annuler?t=${token}`;
  const attachments = [{ filename: "rendez-vous-aelia.ics", content: event.ics, contentType: "text/calendar; charset=utf-8; method=PUBLISH" }];
  if (SMTP_HOST && SMTP_USER && SMTP_PASS) {
    const from = MAIL_FROM || SMTP_USER;
    const t = getTransporter();
    if (MAIL_TO) t.sendMail({
      from, to: MAIL_TO, replyTo: `"${d.name.replace(/"/g, "")}" <${d.email}>`,
      subject: `Nouveau rendez-vous : ${svc.name} · ${when}`,
      text: `${svc.name} (${svc.price})\n${when}\n\n${d.name}\n${d.email}\n${d.phone || ""}\n\n${d.msg || ""}`,
      html: `<h2>Nouveau rendez-vous</h2><p><b>${esc(svc.name)}</b> (${esc(svc.price)})<br>${esc(when)}</p><p>${esc(d.name)}<br>${esc(d.email)}<br>${esc(d.phone || "")}</p><p>${esc(d.msg || "").replace(/\n/g, "<br>")}</p>`,
      attachments,
    }).catch((e) => console.error("Notification non envoyée :", e.message));
    t.sendMail({
      from, to: d.email, replyTo: MAIL_TO || from,
      subject: `Rendez-vous confirmé · ${when}`,
      text: `Bonjour ${d.name},\n\nVotre rendez-vous est confirmé :\n${svc.name}\n${when}\n\nJe vous précise très vite les modalités pratiques et de règlement. Pour annuler ou déplacer votre rendez-vous (jusqu'à ${cfg.cancelBeforeHours} h avant) : ${cancelUrl}\n\nÀ bientôt,\nLaësia · Aélia, conseil en style et image`,
      html: `<p>Bonjour ${esc(d.name)},</p><p>Votre rendez-vous est confirmé :<br><b>${esc(svc.name)}</b><br>${esc(when)}</p><p>Je vous précise très vite les modalités pratiques et de règlement. Pour annuler ou déplacer votre rendez-vous (jusqu'à ${cfg.cancelBeforeHours} h avant), <a href="${esc(cancelUrl)}">cliquez ici</a>.</p><p>À bientôt,<br>Laësia · <i>Aélia, conseil en style et image</i></p>`,
      attachments,
    }).catch((e) => console.error("Confirmation non envoyée :", e.message));
  }
  res.json({ ok: true, service: svc.name, when });
}

// ---------- Gestion d'un rendez-vous par la cliente (lien signé reçu par e-mail) ----------
app.get("/rendez-vous/annuler", (_req, res) => res.sendFile(path.join(__dirname, "pages", "annulation.html")));

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

app.get("/api/appointment", (req, res) => {
  let ap;
  try { ap = appointmentFromToken(req.query.t); } catch { ap = null; }
  if (!ap) return res.status(400).json({ error: "Lien invalide." });
  res.json({
    service: ap.service, when: ap.when, hours: cfg.cancelBeforeHours,
    past: ap.hoursLeft <= 0, canCancel: ap.hoursLeft >= cfg.cancelBeforeHours,
    state: cancelled.has(ap.a.u) ? "cancelled" : "active",
  });
});

const cancelled = new Set(); // évite les e-mails en double si le lien est cliqué plusieurs fois

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
  if (removed && !cancelled.has(ap.a.u) && SMTP_HOST && SMTP_USER && SMTP_PASS) {
    const from = MAIL_FROM || SMTP_USER;
    const t = getTransporter();
    const subject = `Rendez-vous annulé · ${ap.when}`;
    if (MAIL_TO) t.sendMail({
      from, to: MAIL_TO, subject,
      text: `${ap.a.n} (${ap.a.e}) a annulé : ${ap.service}, ${ap.when}.`,
      html: `<p><b>${esc(ap.a.n)}</b> (${esc(ap.a.e)}) a annulé son rendez-vous :<br>${esc(ap.service)}, ${esc(ap.when)}.</p><p>Le créneau a été libéré dans l'agenda.</p>`,
    }).catch((e) => console.error("Notification d'annulation non envoyée :", e.message));
    t.sendMail({
      from, to: ap.a.e, replyTo: MAIL_TO || from, subject,
      text: `Bonjour ${ap.a.n},\n\nVotre rendez-vous (${ap.service}, ${ap.when}) est bien annulé. Pensez à le supprimer de votre agenda.\n\nVous pouvez reprendre rendez-vous quand vous le souhaitez sur le site.\n\nÀ bientôt,\nLaësia · Aélia`,
      html: `<p>Bonjour ${esc(ap.a.n)},</p><p>Votre rendez-vous (<b>${esc(ap.service)}</b>, ${esc(ap.when)}) est bien annulé. Pensez à le supprimer de votre agenda.</p><p>Vous pouvez reprendre rendez-vous quand vous le souhaitez sur le site.</p><p>À bientôt,<br>Laësia · <i>Aélia</i></p>`,
    }).catch((e) => console.error("Confirmation d'annulation non envoyée :", e.message));
  }
  cancelled.add(ap.a.u);
  res.json({ ok: true });
}

// Page 404 aux couleurs du site
app.use((_req, res) => res.status(404).sendFile(path.join(__dirname, "pages", "404.html")));

app.listen(PORT, () => console.log(`Aélia sur http://localhost:${PORT}`));
