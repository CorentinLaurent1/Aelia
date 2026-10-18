const path = require("path");
const express = require("express");
const nodemailer = require("nodemailer");

const app = express();
const PORT = process.env.PORT || 3000;
const { SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASS, MAIL_TO, MAIL_FROM } = process.env;

const SERVICES = [
  "Analyse morphologique", "Analyse colorimétrique", "Étude de style personnalisée",
  "Tri de dressing", "Accompagnement shopping", "Pack Éclat", "Pack Signature", "Pack Renaissance",
];

app.disable("x-powered-by");
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

app.listen(PORT, () => console.log(`Aélia sur http://localhost:${PORT}`));
