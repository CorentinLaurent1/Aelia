// Espace responsable : /admin (page) et /admin/api/* (données), protégés par mot de passe.
const path = require("path");
const express = require("express");
const { DateTime } = require("luxon");
const auth = require("./admin-auth");
const db = require("./db");

module.exports = function mountAdmin(app, deps) {
  const { calendar, cfg, pageHtml, layout, esc, getTransporter, flushMail, mailConfigured, MAIL_FROM, SMTP_USER, MAIL_TO, siteUrl, fmtDay } = deps;
  const router = express.Router();

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
    auth.setSession(req, res);
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
        subject: `Votre rendez-vous Aélia est annulé · ${when}`,
        text: `Bonjour ${appt.name},\n\nJe suis désolée : je dois annuler notre rendez-vous (${appt.service}, ${when}). Je vous contacte très vite pour en convenir d'un autre.\n\nLaësia · Aélia`,
        html: layout({
          base, preheader: "Votre rendez-vous est annulé", title: "Rendez-vous annulé",
          intro: `<p style="margin:0">Bonjour ${esc(appt.name)},<br>je suis désolée : je dois annuler notre rendez-vous. Je vous contacte très vite pour en convenir d'un autre.</p>`,
          rows: [["Prestation", esc(appt.service)], ["Date", esc(when)]],
          button: { url: base + "/", label: "Choisir un autre créneau" },
        }),
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
    res.json({ ...q, ref: db.refOf(q.id) });
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

  router.use("/api", api);
  app.use("/admin", router);
};
