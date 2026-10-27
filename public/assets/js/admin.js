// Espace responsable : tout le contenu affiché vient de la base et est inséré avec textContent (jamais innerHTML).
const $ = (id) => document.getElementById(id);
const TZ = "Europe/Paris";
const STATUS = {
  nouvelle: "À traiter", devis_envoye: "Devis envoyé", accepte: "Accepté", en_cours: "En cours", rendu: "Rendu", refuse: "Refusé",
};
const TYPE = { retouche: "Retouches", style: "Conseil en style", autre: "Autre demande" };
const fmtDateTime = new Intl.DateTimeFormat("fr-FR", { timeZone: TZ, weekday: "short", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });
const fmtDate = new Intl.DateTimeFormat("fr-FR", { timeZone: TZ, day: "numeric", month: "short", year: "numeric" });
const euro = (n) => `${Number(n).toLocaleString("fr-FR", { maximumFractionDigits: 2 })} €`;

function el(tag, props = {}, ...children) {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(props)) {
    if (v === undefined || v === null || v === false) continue;
    if (k === "class") node.className = v;
    else if (k === "text") node.textContent = v;
    else if (k.startsWith("on")) node.addEventListener(k.slice(2), v);
    else node.setAttribute(k, v === true ? "" : v);
  }
  for (const c of children.flat()) if (c !== undefined && c !== null) node.append(c);
  return node;
}

async function api(path, { method = "GET", body } = {}) {
  const res = await fetch(`/admin/api${path}`, {
    method,
    credentials: "same-origin",
    headers: { Accept: "application/json", "X-Requested-With": "aelia", ...(body ? { "Content-Type": "application/json" } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await res.json().catch(() => ({}));
  if (res.status === 401) { showLogin(); throw new Error("login"); }
  if (!res.ok) { const e = new Error(data.error || res.status); e.code = data.error; throw e; }
  return data;
}

// ---------- Connexion ----------
function showLogin(info = "") {
  $("app").hidden = true;
  $("login").hidden = false;
  $("login-info").textContent = info;
  $("password").focus();
}
$("login-form").addEventListener("submit", async (e) => {
  e.preventDefault();
  $("login-error").hidden = true;
  $("login-submit").disabled = true;
  try {
    const res = await fetch("/admin/login", {
      method: "POST", credentials: "same-origin",
      headers: { "Content-Type": "application/json", "X-Requested-With": "aelia" },
      body: JSON.stringify({ password: $("password").value }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error === "not_configured" ? "L'espace responsable n'est pas encore configuré (variable ADMIN_PASSWORD)." : data.error || "Connexion impossible.");
    $("password").value = "";
    await start();
  } catch (err) {
    $("login-error").textContent = err.message;
    $("login-error").hidden = false;
  } finally {
    $("login-submit").disabled = false;
  }
});
$("logout").addEventListener("click", async () => {
  await fetch("/admin/logout", { method: "POST", credentials: "same-origin", headers: { "X-Requested-With": "aelia" } });
  showLogin();
});

// ---------- Navigation ----------
let view = "dashboard";
let filter = "";
function go(next) {
  view = next;
  for (const v of ["dashboard", "quotes", "rdv"]) $(`view-${v}`).hidden = v !== next;
  document.querySelectorAll("#tabs button").forEach((b) => {
    if (b.dataset.view === next) b.setAttribute("aria-current", "page"); else b.removeAttribute("aria-current");
  });
  refresh();
}
$("tabs").addEventListener("click", (e) => { const b = e.target.closest("button[data-view]"); if (b) go(b.dataset.view); });

function notice(msg) { $("notice").textContent = msg || ""; $("notice").hidden = !msg; }

async function refresh() {
  notice("");
  try {
    if (view === "dashboard") await renderDashboard();
    else if (view === "quotes") await renderQuotes();
    else await renderRdv();
  } catch (e) {
    if (e.message === "login") return;
    if (e.code === "db_not_configured") notice("La base de données n'est pas encore connectée : ajoutez Neon (Postgres) dans Vercel > Storage, puis redéployez. Les nouvelles demandes continuent d'arriver par e-mail.");
    else notice(e.message || "Une erreur est survenue.");
  }
}

// ---------- Éléments communs ----------
const statusChip = (s) => el("span", { class: `adm-chip adm-chip--${s}`, text: STATUS[s] || s });
function dueBadge(q) {
  if (!q.due_at || q.status === "rendu") return null;
  const late = new Date(q.due_at) < new Date();
  return el("span", { class: `adm-due${late ? " adm-due--late" : ""}`, text: `${late ? "En retard : " : "À rendre avant le "}${fmtDate.format(new Date(q.due_at))}`.replace("En retard : ", "En retard · ") });
}

function quoteItem(q) {
  const title = el("button", { type: "button", class: "adm-item__title", onclick: () => openDetail(q.id) },
    el("span", { text: q.name }), el("span", { class: "adm-muted", text: ` · ${TYPE[q.type] || q.type}` }));
  return el("li", { class: "adm-item" },
    el("div", { class: "adm-item__main" }, title, el("p", { class: "adm-item__sub", text: q.excerpt || "" })),
    el("div", { class: "adm-item__side" },
      statusChip(q.status), dueBadge(q),
      el("span", { class: "adm-muted", text: `${fmtDate.format(new Date(q.created_at))}${Number(q.photos) ? ` · ${q.photos} photo${q.photos > 1 ? "s" : ""}` : ""}${q.amount !== null ? ` · ${euro(q.amount)}` : ""}` })));
}
const empty = (text) => el("li", { class: "adm-empty", text });

function apptItem(a, withCancel) {
  const body = el("div", { class: "adm-item__main" },
    el("p", { class: "adm-item__title adm-item__title--static", text: a.service || a.summary }),
    el("p", { class: "adm-item__sub", text: `${a.name}${a.email ? " · " + a.email : ""}${a.phone ? " · " + a.phone : ""}` }));
  const side = el("div", { class: "adm-item__side" },
    el("strong", { text: fmtDateTime.format(new Date(a.start)) }),
    a.price ? el("span", { class: "adm-muted", text: euro(a.price) }) : null,
    withCancel ? el("button", { type: "button", class: "adm-danger", onclick: () => cancelAppt(a), text: "Annuler" }) : null);
  return el("li", { class: "adm-item" }, body, side);
}

// ---------- Tableau de bord ----------
async function renderDashboard() {
  const d = await api("/summary");
  const s = d.stats;
  $("stats").replaceChildren(
    stat("À traiter", s.toProcess, "nouvelles demandes de devis", s.toProcess > 0),
    stat("En cours", s.inProgress, "devis envoyés ou acceptés"),
    stat("Rendez-vous", s.appointments30, "dans les 30 prochains jours"),
    stat("CA estimé du mois", euro(s.revenueMonth), `${s.monthAppointments} rendez-vous · ${euro(s.revenueDetail.quotesDelivered)} de retouches rendues`),
  );
  $("badge-quotes").hidden = !s.toProcess;
  $("badge-quotes").textContent = s.toProcess;
  $("list-new").replaceChildren(...(d.toProcess.length ? d.toProcess.map(quoteItem) : [empty("Aucune demande en attente.")]));
  $("list-return").replaceChildren(...(d.toReturn.length ? d.toReturn.map(quoteItem) : [empty("Aucune retouche en cours.")]));
  $("list-next").replaceChildren(...(d.appointments.length ? d.appointments.map((a) => apptItem(a, false)) : [empty(d.agendaError ? "Agenda momentanément indisponible." : "Aucun rendez-vous à venir.")]));
}
function stat(label, value, sub, alert) {
  return el("div", { class: `adm-stat${alert ? " adm-stat--alert" : ""}` }, el("p", { class: "adm-stat__label", text: label }), el("p", { class: "adm-stat__value", text: String(value) }), el("p", { class: "adm-muted", text: sub }));
}

// ---------- Devis ----------
async function renderQuotes() {
  const d = await api(`/quotes${filter ? `?status=${filter}` : ""}`);
  const total = Object.values(d.counts).reduce((a, b) => a + b, 0);
  const pill = (value, label, n) => el("button", { type: "button", class: "adm-pill", "aria-pressed": String(filter === value), onclick: () => { filter = value; renderQuotes(); } }, `${label} `, el("span", { class: "adm-pill__n", text: String(n) }));
  $("filters").replaceChildren(pill("", "Toutes", total), ...Object.keys(STATUS).map((k) => pill(k, STATUS[k], d.counts[k] || 0)));
  $("badge-quotes").hidden = !d.counts.nouvelle;
  $("badge-quotes").textContent = d.counts.nouvelle;
  $("quote-list").replaceChildren(...(d.items.length ? d.items.map(quoteItem) : [empty("Aucune demande dans cette catégorie.")]));
}

// ---------- Fiche d'une demande ----------
const dlg = $("detail");
let current = null;
$("d-status").replaceChildren(...Object.entries(STATUS).map(([v, t]) => el("option", { value: v, text: t })));
$("d-close").addEventListener("click", () => dlg.close());
dlg.addEventListener("click", (e) => { if (e.target === dlg) dlg.close(); });
dlg.addEventListener("close", () => refresh());

function fill(q) {
  current = q;
  $("d-ref").textContent = `${q.ref} · ${TYPE[q.type] || q.type}`;
  $("d-title").textContent = q.name;
  $("d-meta").replaceChildren(
    el("a", { href: `mailto:${q.email}`, text: q.email }),
    q.phone ? el("span", { text: ` · ${q.phone}` }) : "",
    el("span", { class: "adm-muted", text: ` · reçue le ${fmtDate.format(new Date(q.created_at))}` }));
  $("d-message").textContent = q.message;
  $("d-photos").replaceChildren(...q.photo_list.map((p, i) => el("li", {},
    el("a", { href: `/admin/api/photos/${p.id}`, target: "_blank", rel: "noopener" },
      el("img", { src: `/admin/api/photos/${p.id}`, alt: `Photo ${i + 1} jointe par la cliente`, loading: "lazy" }),
      el("span", { class: "sr-only", text: " (agrandir, nouvel onglet)" })))));
  $("d-status").value = q.status;
  $("d-amount").value = q.amount === null ? "" : String(q.amount);
  $("d-note").value = q.note || "";
  $("d-due").textContent = q.due_at && q.status !== "rendu" ? `À rendre avant le ${fmtDate.format(new Date(q.due_at))}` : q.delivered_at ? `Rendu le ${fmtDate.format(new Date(q.delivered_at))}` : q.type === "retouche" ? "L'échéance (7 jours) démarre quand la demande passe en « Accepté »." : "";
  const subject = encodeURIComponent(`Votre demande de devis ${q.ref}`);
  const body = encodeURIComponent(`Bonjour ${q.name},\n\nMerci pour votre demande.${q.amount !== null ? `\n\nMon devis : ${euro(q.amount)}.` : ""}\n\nLaësia · Aélia`);
  $("d-mail").href = `mailto:${q.email}?subject=${subject}&body=${body}`;
  $("d-status-msg").hidden = true;
}

async function openDetail(id) {
  try { fill(await api(`/quotes/${id}`)); dlg.showModal(); } catch (e) { if (e.message !== "login") notice(e.message); }
}

function say(msg, ok) {
  const m = $("d-status-msg");
  m.textContent = msg;
  m.className = `form-status ${ok ? "form-status--ok" : "form-status--error"}`;
  m.hidden = false;
}

async function save(extra = {}) {
  try {
    const q = await api(`/quotes/${current.id}`, { method: "PATCH", body: { status: $("d-status").value, amount: $("d-amount").value, note: $("d-note").value, ...extra } });
    fill(q);
    say("Enregistré.", true);
  } catch (e) { say(e.message === "login" ? "Session expirée." : e.message, false); }
}
$("d-form").addEventListener("submit", (e) => { e.preventDefault(); save(); });
$("d-done").addEventListener("click", () => { $("d-status").value = "rendu"; save({ status: "rendu" }); });
$("d-delete").addEventListener("click", async () => {
  if (!confirm(`Supprimer définitivement la demande ${current.ref} de ${current.name}, ses photos et ses notes ?`)) return;
  try { await api(`/quotes/${current.id}`, { method: "DELETE" }); dlg.close(); } catch (e) { say(e.message, false); }
});

// ---------- Rendez-vous ----------
async function renderRdv() {
  const d = await api("/appointments");
  $("rdv-list").replaceChildren(...(d.items.length ? d.items.map((a) => apptItem(a, true)) : [empty("Aucun rendez-vous à venir.")]));
}
async function cancelAppt(a) {
  if (!confirm(`Annuler le rendez-vous de ${a.name} (${a.service}) ? Un e-mail d'excuses lui sera envoyé.`)) return;
  try { await api("/appointments/cancel", { method: "POST", body: { uid: a.uid } }); refresh(); } catch (e) { if (e.message !== "login") notice(e.message); }
}

// ---------- Démarrage ----------
async function start() {
  const me = await fetch("/admin/api/me", { credentials: "same-origin", headers: { Accept: "application/json" } }).then((r) => r.json());
  if (!me.configured) {
    $("login-form").querySelector("label").hidden = true;
    $("login-submit").hidden = true;
    showLogin("L'espace responsable n'est pas encore configuré : ajoutez la variable ADMIN_PASSWORD dans Vercel, puis redéployez.");
    return;
  }
  if (!me.loggedIn) { $("login-form").querySelector("label").hidden = false; $("login-submit").hidden = false; showLogin(); return; }
  $("login").hidden = true;
  $("app").hidden = false;
  go(view);
}
start();
