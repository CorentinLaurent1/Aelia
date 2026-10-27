// Espace responsable : /admin (page) et /admin/api/* (données), protégés par mot de passe.
const path = require("path");
const express = require("express");
const { DateTime } = require("luxon");
const auth = require("./admin-auth");
const db = require("./db");
const services = require("../config/services.json");
const { buildQuotePdf, eur, dateFr, totalOf } = require("./quote");

module.exports = function mountAdmin(app, deps) {
  const { calendar, cfg, pageHtml, emails, getTransporter, flushMail, mailConfigured, MAIL_FROM, SMTP_USER, MAIL_TO, siteUrl, fmtDay } = deps;
  const router = express.Router();
  const durationLabel = (m) => `${Math.floor(m / 60)}h${m % 60 ? String(m % 60).padStart(2, "0") : ""}`;
  const catalogue = services.map((s) => ({
    id: s.id, label: s.name, unit: s.amount, kind: s.category === "retouche" ? "retouche" : "seance",
    note: s.minutes ? durationLabel(s.minutes) : s.delay || "",
  }));

  router.use((req, res, next) => {
    res.set({ "Cache-Control": "no-store", "X-Robots-Tag": "noindex, nofollow" });
    next();
  });

  // Page (identique connecté ou non : c'est l'API qui contrôle l'accès)
  router.get("/", (_req, res) => res.type("html").send(pageHtml("admin.html")));

  // Les requêtes qui modifient quelque chose doivent porter un en-tête propre à l'application
  // (un autre site ne peut pas l'ajouter : protection contre les requêtes frauduleuses).
  const needsHeader = (req, res, next) => {
    if (req.method !== "GET" && req.get("X-Requested-With") !== "aelia") return res.status(400).json({ error: "Requête refusée." });
    next();
  };
  router.use("/api", needsHeader);
  router.post("/login", needsHeader);

  router.post("/login", express.json({ limit: "2kb" }), async (req, res) => {
    if (!auth.configured()) return res.status(503).json({ error: "not_configured" });
    if (auth.tooManyFails(req.ip)) return res.status(429).json({ error: "Trop d'essais. Réessayez dans quelques minutes." });
    if (!auth.checkPassword(req.body && req.body.password)) {
      auth.recordFail(req.ip);
      await new Promise((r) => setTimeout(r, 800));
      return res.status(401).json({ error: "Mot de passe incorrect." });
    }
    auth.setSession(req, res, Boolean(req.body && req.body.remember));
    res.json({ ok: true });
  });
  router.post("/logout", (req, res) => { auth.clearSession(req, res); res.json({ ok: true }); });

  const guard = (req, res, next) => {
    if (!auth.configured()) return res.status(503).json({ error: "not_configured" });
    if (!auth.isLoggedIn(req)) return res.status(401).json({ error: "Connexion requise." });
    next();
  };
  const dbGuard = (_req, res, next) => (db.enabled() ? next() : res.status(503).json({ error: "db_not_configured" }));
  const wrap = (fn) => (req, res) => Promise.resolve(fn(req, res)).catch((e) => {
    console.error("Admin :", e.message);
    res.status(500).json({ error: "Une erreur est survenue." });
  });

  router.get("/api/me", (req, res) => {
    res.json({ configured: auth.configured(), loggedIn: auth.isLoggedIn(req), db: db.enabled(), agenda: calendar.configured() });
  });

  const api = express.Router();
  api.use(guard);
  api.use(express.json({ limit: "20kb" }));

  // ----- Rendez-vous (agenda iCloud) -----
  async function upcoming(days) {
    if (!calendar.configured()) return [];
    const from = new Date(Date.now() - 3 * 3600e3);
    return calendar.listAppointments(from, new Date(Date.now() + days * 864e5));
  }
  const monthRange = () => {
    const start = DateTime.now().setZone(cfg.timezone).startOf("month");
    return [start.toJSDate(), start.plus({ months: 1 }).toJSDate()];
  };

  api.get("/appointments", wrap(async (_req, res) => {
    try { res.json({ items: await upcoming(90) }); } catch (e) { console.error("Admin agenda :", e.message); res.status(502).json({ error: "Agenda momentanément indisponible." }); }
  }));

  api.post("/appointments/cancel", wrap(async (req, res) => {
    const uid = String((req.body && req.body.uid) || "");
    if (!uid.endsWith("@aelia")) return res.status(400).json({ error: "Rendez-vous invalide." });
    const [from, to] = [new Date(Date.now() - 864e5), new Date(Date.now() + 400 * 864e5)];
    const appt = (await calendar.listAppointments(from, to)).find((a) => a.uid === uid);
    const removed = await calendar.deleteEvent(uid);
    if (removed && appt && appt.email && mailConfigured()) {
      const base = siteUrl(req);
      const when = fmtDay(appt.start.toISOString());
      getTransporter().sendMail({
        from: MAIL_FROM || SMTP_USER, to: appt.email, replyTo: MAIL_TO || SMTP_USER,
        ...emails.apptCancelledByOwner({ base, name: appt.name, service: appt.service, when }),
      }).catch((e) => console.error("E-mail d'annulation non envoyé :", e.message));
      await flushMail();
    }
    res.json({ ok: true, removed });
  }));

  // ----- Devis -----
  api.get("/summary", dbGuard, wrap(async (_req, res) => {
    const counts = await db.counts();
    const [mFrom, mTo] = monthRange();
    let appointments = [], agendaError = false;
    try { appointments = await upcoming(60); } catch { agendaError = true; }
    const [from, to] = [mFrom, mTo];
    let month = [];
    try { month = calendar.configured() ? await calendar.listAppointments(from, to) : []; } catch { agendaError = true; }
    const delivered = await db.deliveredAmount(mFrom, mTo);
    const rdvAmount = month.reduce((s, a) => s + (a.price || 0), 0);
    const toProcess = (await db.listQuotes("nouvelle")).slice(0, 6);
    const toReturn = (await db.listQuotes()).filter((q) => q.type === "retouche" && ["accepte", "en_cours"].includes(q.status))
      .sort((a, b) => new Date(a.due_at || 0) - new Date(b.due_at || 0)).slice(0, 8);
    res.json({
      counts, toProcess, toReturn, appointments: appointments.slice(0, 6), agendaError,
      stats: {
        toProcess: counts.nouvelle,
        inProgress: counts.devis_envoye + counts.accepte + counts.en_cours,
        appointments30: appointments.filter((a) => a.start < new Date(Date.now() + 30 * 864e5)).length,
        monthAppointments: month.length,
        revenueMonth: Math.round(delivered + rdvAmount),
        revenueDetail: { quotesDelivered: delivered, appointments: rdvAmount },
      },
    });
  }));

  api.get("/quotes", dbGuard, wrap(async (req, res) => res.json({ items: await db.listQuotes(req.query.status), counts: await db.counts() })));

  api.get("/quotes/:id(\\d+)", dbGuard, wrap(async (req, res) => {
    const q = await db.getQuote(Number(req.params.id));
    if (!q) return res.status(404).json({ error: "Demande introuvable." });
    res.json({ ...q, ref: db.refOf(q.id), documents: await db.listDocuments(q.id) });
  }));

  api.patch("/quotes/:id(\\d+)", dbGuard, wrap(async (req, res) => {
    try {
      const q = await db.updateQuote(Number(req.params.id), req.body || {});
      if (!q) return res.status(404).json({ error: "Demande introuvable." });
      res.json({ ...q, ref: db.refOf(q.id) });
    } catch (e) {
      res.status(400).json({ error: e.message });
    }
  }));

  api.delete("/quotes/:id(\\d+)", dbGuard, wrap(async (req, res) => {
    res.json({ ok: await db.deleteQuote(Number(req.params.id)) });
  }));

  api.get("/photos/:id(\\d+)", dbGuard, wrap(async (req, res) => {
    const p = await db.getPhoto(Number(req.params.id));
    if (!p) return res.status(404).end();
    res.set({ "Content-Type": p.content_type, "Cache-Control": "private, max-age=3600", "Content-Disposition": `inline; filename="${p.filename}"`, "X-Content-Type-Options": "nosniff" });
    res.send(p.data);
  }));

  // ----- Devis : catalogue, aperçu, création et envoi -----
  api.get("/catalogue", (_req, res) => res.json({ items: catalogue }));

  // Contrôle des lignes saisies par la responsable
  function cleanLines(input) {
    const arr = Array.isArray(input) ? input.slice(0, 30) : [];
    const lines = arr.map((l) => ({
      label: String((l && l.label) || "").trim().slice(0, 200),
      note: String((l && l.note) || "").trim().slice(0, 60),
      qty: Math.round(Number(l && l.qty) * 100) / 100,
      unit: Math.round(Number(l && l.unit) * 100) / 100,
      kind: ["seance", "retouche", "autre"].includes(l && l.kind) ? l.kind : "autre",
    }));
    if (!lines.length || lines.some((l) => !l.label || !(l.qty > 0 && l.qty <= 999) || !(l.unit >= 0 && l.unit <= 100000))) return null;
    return lines;
  }
  const validity = (v) => Math.min(120, Math.max(1, parseInt(v, 10) || 30));

  const clientOf = (q) => ({ name: q.name, email: q.email, phone: q.phone });

  api.post("/quotes/:id(\\d+)/preview", dbGuard, wrap(async (req, res) => {
    const q = await db.getQuote(Number(req.params.id));
    const lines = cleanLines(req.body && req.body.lines);
    if (!q || !lines) return res.status(400).json({ error: "Complétez les lignes du devis (libellé, quantité, prix)." });
    const days = validity(req.body.validityDays);
    const pdf = await buildQuotePdf({ number: "APERÇU", date: new Date(), validUntil: new Date(Date.now() + days * 864e5), validityDays: days, preview: true, siteUrl: siteUrl(req).replace(/^https?:\/\//, ""), client: clientOf(q), lines });
    res.set({ "Content-Type": "application/pdf", "Content-Disposition": 'inline; filename="apercu-devis.pdf"' }).send(pdf);
  }));

  async function pdfOf(doc, q, req) {
    return buildQuotePdf({ number: doc.number, date: doc.created_at, validUntil: doc.valid_until, validityDays: doc.validity_days, siteUrl: siteUrl(req).replace(/^https?:\/\//, ""), client: clientOf(q), lines: doc.lines });
  }

  api.post("/quotes/:id(\\d+)/document", dbGuard, wrap(async (req, res) => {
    const q = await db.getQuote(Number(req.params.id));
    const lines = cleanLines(req.body && req.body.lines);
    if (!q || !lines) return res.status(400).json({ error: "Complétez les lignes du devis (libellé, quantité, prix)." });
    const send = Boolean(req.body.send);
    if (send && !mailConfigured()) return res.status(503).json({ error: "L'envoi d'e-mails n'est pas configuré (SMTP)." });
    const intro = String(req.body.intro || "").trim().slice(0, 3000);
    const doc = await db.createDocument(q.id, { lines, intro, validityDays: validity(req.body.validityDays) });
    let sent = false;
    if (send) {
      const pdf = await pdfOf(doc, q, req);
      const base = siteUrl(req);
      const hasSeance = lines.some((l) => l.kind === "seance");
      const hasRetouche = lines.some((l) => l.kind === "retouche");
      try {
        await getTransporter().sendMail({
          from: MAIL_FROM || SMTP_USER, to: q.email, replyTo: MAIL_TO || SMTP_USER, bcc: MAIL_TO || undefined,
          ...emails.quoteSent({ base, name: q.name, number: doc.number, lines, total: doc.total, validUntil: dateFr(doc.valid_until), intro, hasSeance, hasRetouche, eur }),
          attachments: [{ filename: `${doc.number}.pdf`, content: pdf, contentType: "application/pdf" }],
        });
        await db.markDocumentSent(doc.id);
        await db.updateQuote(q.id, { status: ["accepte", "en_cours", "rendu"].includes(q.status) ? q.status : "devis_envoye", amount: doc.total, note: q.note });
        sent = true;
      } catch (e) {
        console.error("Devis non envoyé :", e.message);
        return res.status(502).json({ error: "Le devis est enregistré mais l'e-mail n'a pas pu partir. Réessayez ou téléchargez le PDF.", document: doc });
      }
    } else {
      await db.updateQuote(q.id, { status: q.status, amount: doc.total, note: q.note });
    }
    res.json({ ok: true, sent, document: await db.getDocument(doc.id) });
  }));

  api.get("/documents/:id(\\d+)/pdf", dbGuard, wrap(async (req, res) => {
    const doc = await db.getDocument(Number(req.params.id));
    if (!doc) return res.status(404).end();
    const q = await db.getQuote(doc.quote_id);
    res.set({ "Content-Type": "application/pdf", "Content-Disposition": `inline; filename="${doc.number}.pdf"` }).send(await pdfOf(doc, q, req));
  }));

  router.use("/api", api);
  app.use("/admin", router);
};
