// Espace responsable : tout le contenu affiché vient de la base et est inséré avec textContent (jamais innerHTML).
const $ = (id) => document.getElementById(id);
const TZ = "Europe/Paris";
const STATUS = { nouvelle: "À traiter", devis_envoye: "Devis envoyé", accepte: "Accepté", en_cours: "En cours", rendu: "Rendu", refuse: "Refusé" };
const TYPE = { retouche: "Retouches", style: "Conseil en style", autre: "Autre demande" };
const fmtDateTime = new Intl.DateTimeFormat("fr-FR", { timeZone: TZ, weekday: "long", day: "numeric", month: "long", hour: "2-digit", minute: "2-digit" });
const fmtDate = new Intl.DateTimeFormat("fr-FR", { timeZone: TZ, day: "numeric", month: "short", year: "numeric" });
const fmtLong = new Intl.DateTimeFormat("fr-FR", { timeZone: TZ, weekday: "long", day: "numeric", month: "long", year: "numeric" });
const fmtDay = new Intl.DateTimeFormat("fr-FR", { timeZone: TZ, day: "numeric" });
const fmtMon = new Intl.DateTimeFormat("fr-FR", { timeZone: TZ, month: "short" });
const fmtHour = new Intl.DateTimeFormat("fr-FR", { timeZone: TZ, weekday: "short", hour: "2-digit", minute: "2-digit" });
const euro = (n) => `${Number(n).toLocaleString("fr-FR", { maximumFractionDigits: 2 })} €`;
const ICON = {
  inbox: "M3 13l3-8h12l3 8v6H3zM3 13h5l1 3h6l1-3h5",
  clock: "M12 21a9 9 0 100-18 9 9 0 000 18zM12 7v5l3 2",
  cal: "M5 5h14v15H5zM5 10h14M9 3v4M15 3v4",
  euro: "M17 6a6 6 0 100 12M5 10h9M5 14h9",
};

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
function icon(name) {
  const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  svg.setAttribute("viewBox", "0 0 24 24");
  svg.setAttribute("aria-hidden", "true");
  const p = document.createElementNS("http://www.w3.org/2000/svg", "path");
  p.setAttribute("d", ICON[name]);
  svg.append(p);
  return svg;
}

async function api(path, { method = "GET", body, raw } = {}) {
  const res = await fetch(`/admin/api${path}`, {
    method, credentials: "same-origin",
    headers: { Accept: "application/json", "X-Requested-With": "aelia", ...(body ? { "Content-Type": "application/json" } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  if (res.status === 401) { showLogin(); throw new Error("login"); }
  if (raw && res.ok) return res;
  const data = await res.json().catch(() => ({}));
  if (!res.ok) { const e = new Error(data.error || res.status); e.code = data.error; e.data = data; throw e; }
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
function go(next) {
  view = next;
  for (const v of ["dashboard", "quotes", "rdv"]) $(`view-${v}`).hidden = v !== next;
  document.querySelectorAll("#tabs button").forEach((b) => {
    if (b.dataset.view === next) b.setAttribute("aria-current", "page"); else b.removeAttribute("aria-current");
  });
  refresh();
}
$("tabs").addEventListener("click", (e) => { const b = e.target.closest("button[data-view]"); if (b) go(b.dataset.view); });
$("refresh").addEventListener("click", () => refresh());
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
const typeTag = (t) => el("span", { class: "adm-type", text: TYPE[t] || t });
function dueBadge(q) {
  if (!q.due_at || q.status === "rendu") return null;
  const late = new Date(q.due_at) < new Date();
  return el("span", { class: `adm-due${late ? " adm-due--late" : ""}`, text: `${late ? "En retard · " : "À rendre avant le "}${fmtDate.format(new Date(q.due_at))}` });
}
const empty = (text) => el("li", { class: "adm-empty", text });
const initials = (name) => name.split(/\s+/).map((p) => p[0]).filter(Boolean).slice(0, 2).join("").toUpperCase();

function quoteRow(q) {
  return el("li", {},
    el("button", { type: "button", class: "adm-row", onclick: () => openDetail(q.id) },
      el("span", { class: "adm-avatar", "aria-hidden": "true", text: initials(q.name) }),
      el("span", { class: "adm-row__main" },
        el("span", { class: "adm-row__title" }, el("span", { text: q.name }), typeTag(q.type)),
        el("span", { class: "adm-row__sub", text: q.excerpt || "" })),
      el("span", { class: "adm-row__side" }, statusChip(q.status), dueBadge(q),
        el("span", { class: "adm-muted", text: `${fmtDate.format(new Date(q.created_at))}${Number(q.photos) ? ` · ${q.photos} photo${q.photos > 1 ? "s" : ""}` : ""}${q.amount !== null ? ` · ${euro(q.amount)}` : ""}` }))));
}

// ---------- Tableau de bord ----------
async function renderDashboard() {
  $("today").textContent = fmtLong.format(new Date());
  const d = await api("/summary");
  const s = d.stats;
  $("stats").replaceChildren(
    stat("inbox", "À traiter", s.toProcess, "nouvelles demandes de devis", s.toProcess > 0),
    stat("clock", "En cours", s.inProgress, "devis envoyés, acceptés ou en cours"),
    stat("cal", "Rendez-vous", s.appointments30, "dans les 30 prochains jours"),
    stat("euro", "CA estimé du mois", euro(s.revenueMonth), `${s.monthAppointments} rendez-vous · ${euro(s.revenueDetail.quotesDelivered)} de retouches rendues`),
  );
  $("badge-quotes").hidden = !s.toProcess;
  $("badge-quotes").textContent = s.toProcess;

  const c = d.counts;
  const total = Object.values(c).reduce((a, b) => a + b, 0);
  $("pipe-bar").replaceChildren(...(total ? Object.keys(STATUS).filter((k) => c[k]).map((k) => el("span", { class: `adm-bar__seg adm-bar__seg--${k}`, style: `flex:${c[k]}`, title: `${STATUS[k]} : ${c[k]}` })) : [el("span", { class: "adm-bar__seg adm-bar__seg--empty", style: "flex:1" })]));
  $("pipe-legend").replaceChildren(...Object.keys(STATUS).map((k) => el("li", {}, el("span", { class: `adm-dot adm-dot--${k}`, "aria-hidden": "true" }), `${STATUS[k]} `, el("strong", { text: String(c[k] || 0) }))));
  const answered = c.devis_envoye + c.accepte + c.en_cours + c.rendu + c.refuse;
  const won = c.accepte + c.en_cours + c.rendu;
  $("pipe-foot").textContent = answered ? `Taux d'acceptation : ${Math.round((won / answered) * 100)} % (${won} devis acceptés sur ${answered} envoyés).` : "Les statistiques apparaîtront dès le premier devis envoyé.";

  $("list-new").replaceChildren(...(d.toProcess.length ? d.toProcess.map(quoteRow) : [empty("Tout est à jour : aucune demande en attente. 🎉".replace(" 🎉", ""))]));
  $("list-return").replaceChildren(...(d.toReturn.length ? d.toReturn.map(quoteRow) : [empty("Aucune retouche en cours.")]));
  $("list-next").replaceChildren(...(d.appointments.length ? d.appointments.map(timelineItem) : [empty(d.agendaError ? "Agenda momentanément indisponible." : "Aucun rendez-vous à venir.")]));
}
function stat(ic, label, value, sub, alert) {
  return el("div", { class: `adm-stat${alert ? " adm-stat--alert" : ""}` },
    el("span", { class: "adm-stat__icon" }, icon(ic)),
    el("div", {}, el("p", { class: "adm-stat__label", text: label }), el("p", { class: "adm-stat__value", text: String(value) }), el("p", { class: "adm-stat__sub", text: sub })));
}
function timelineItem(a) {
  const d = new Date(a.start);
  return el("li", { class: "adm-tl" },
    el("span", { class: "adm-tl__date", "aria-hidden": "true" }, el("strong", { text: fmtDay.format(d) }), el("small", { text: fmtMon.format(d) })),
    el("div", {}, el("p", { class: "adm-tl__title", text: a.service || a.summary }),
      el("p", { class: "adm-muted", text: `${fmtHour.format(d)} · ${a.name}${a.price ? " · " + euro(a.price) : ""}` })));
}

// ---------- Devis : tableau par colonnes ----------
const COLUMNS = [
  { id: "nouvelle", title: "À traiter", statuses: ["nouvelle"] },
  { id: "devis_envoye", title: "Devis envoyé", statuses: ["devis_envoye"] },
  { id: "en_cours", title: "Accepté · en cours", statuses: ["accepte", "en_cours"] },
  { id: "rendu", title: "Rendu", statuses: ["rendu"] },
  { id: "refuse", title: "Refusé", statuses: ["refuse"], optional: true },
];
let allQuotes = [];
async function renderQuotes() {
  const d = await api("/quotes");
  allQuotes = d.items;
  $("badge-quotes").hidden = !d.counts.nouvelle;
  $("badge-quotes").textContent = d.counts.nouvelle;
  drawBoard();
}
function drawBoard() {
  const text = $("q-search").value.trim().toLowerCase();
  const type = $("q-type").value;
  const items = allQuotes.filter((q) => (!type || q.type === type) && (!text || `${q.name} ${q.email} ${q.excerpt}`.toLowerCase().includes(text)));
  const cols = COLUMNS.filter((c) => !c.optional || $("q-refused").checked);
  $("board").style.setProperty("--cols", cols.length);
  $("board").replaceChildren(...cols.map((c) => {
    const list = items.filter((q) => c.statuses.includes(q.status));
    return el("section", { class: `adm-col adm-col--${c.id}`, "aria-label": `${c.title} (${list.length})` },
      el("h2", {}, c.title, el("span", { class: "adm-col__n", text: String(list.length) })),
      el("ul", { class: "adm-list" }, ...(list.length ? list.map(boardCard) : [empty("Aucune demande")])));
  }));
}
function boardCard(q) {
  return el("li", {}, el("button", { type: "button", class: "adm-tile", onclick: () => openDetail(q.id) },
    el("span", { class: "adm-tile__top" }, el("span", { class: "adm-avatar", "aria-hidden": "true", text: initials(q.name) }), el("span", { class: "adm-tile__name", text: q.name }), typeTag(q.type)),
    el("span", { class: "adm-tile__msg", text: q.excerpt || "" }),
    el("span", { class: "adm-tile__foot" },
      el("span", { class: "adm-muted", text: `${fmtDate.format(new Date(q.created_at))}${Number(q.photos) ? ` · ${q.photos} photo${q.photos > 1 ? "s" : ""}` : ""}` }),
      q.amount !== null ? el("strong", { text: euro(q.amount) }) : null),
    dueBadge(q)));
}
["input", "change"].forEach((ev) => { $("q-search").addEventListener(ev, drawBoard); $("q-type").addEventListener(ev, drawBoard); $("q-refused").addEventListener(ev, drawBoard); });

// ---------- Fiche d'une demande ----------
const dlg = $("detail");
let current = null;
let lines = [];
let catalogue = [];
$("d-status").replaceChildren(...Object.entries(STATUS).map(([v, t]) => el("option", { value: v, text: t })));
$("d-close").addEventListener("click", () => dlg.close());
dlg.addEventListener("click", (e) => { if (e.target === dlg) dlg.close(); });
dlg.addEventListener("close", () => refresh());

// onglets (flèches gauche/droite)
const TABS = ["request", "reply", "follow"];
function selectTab(name) {
  TABS.forEach((t) => {
    const on = t === name;
    $(`tab-${t}`).setAttribute("aria-selected", String(on));
    $(`tab-${t}`).tabIndex = on ? 0 : -1;
    $(`panel-${t}`).hidden = !on;
  });
}
$("d-tabs").addEventListener("click", (e) => { const b = e.target.closest("[role=tab]"); if (b) selectTab(b.id.replace("tab-", "")); });
$("d-tabs").addEventListener("keydown", (e) => {
  const i = TABS.findIndex((t) => $(`tab-${t}`).getAttribute("aria-selected") === "true");
  const next = e.key === "ArrowRight" ? (i + 1) % 3 : e.key === "ArrowLeft" ? (i + 2) % 3 : -1;
  if (next < 0) return;
  e.preventDefault();
  selectTab(TABS[next]);
  $(`tab-${TABS[next]}`).focus();
});

function fill(q) {
  current = q;
  $("d-ref").textContent = `${q.ref} · ${TYPE[q.type] || q.type}`;
  $("d-title").textContent = q.name;
  $("d-meta").replaceChildren(statusChip(q.status), " ",
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
  $("d-mail").href = `mailto:${q.email}?subject=${encodeURIComponent(`Votre demande de devis ${q.ref}`)}`;
  $("d-status-msg").hidden = true;
  drawDocs(q.documents || []);
}

async function openDetail(id, tab = "request") {
  try {
    if (!catalogue.length) catalogue = (await api("/catalogue")).items;
    const q = await api(`/quotes/${id}`);
    fill(q);
    prepareReply(q);
    selectTab(tab);
    if (!dlg.open) dlg.showModal();
  } catch (e) { if (e.message !== "login") notice(e.message); }
}

function say(id, msg, ok) {
  const m = $(id);
  m.textContent = msg;
  m.className = `form-status ${ok ? "form-status--ok" : "form-status--error"}`;
  m.hidden = false;
}

async function save(extra = {}) {
  try {
    const q = await api(`/quotes/${current.id}`, { method: "PATCH", body: { status: $("d-status").value, amount: $("d-amount").value, note: $("d-note").value, ...extra } });
    fill({ ...q, documents: current.documents });
    say("d-status-msg", "Enregistré.", true);
  } catch (e) { say("d-status-msg", e.message === "login" ? "Session expirée." : e.message, false); }
}
$("d-form").addEventListener("submit", (e) => { e.preventDefault(); save(); });
$("d-done").addEventListener("click", () => { $("d-status").value = "rendu"; save({ status: "rendu" }); });
$("d-delete").addEventListener("click", async () => {
  if (!confirm(`Supprimer définitivement la demande ${current.ref} de ${current.name}, ses photos, ses devis et ses notes ?`)) return;
  try { await api(`/quotes/${current.id}`, { method: "DELETE" }); dlg.close(); } catch (e) { say("d-status-msg", e.message, false); }
});

// ---------- Répondre : création du devis ----------
const RETOUCHE = "retouche-ourlet";
$("r-catalogue").replaceChildren(
  el("option", { value: "", text: "Choisir une prestation…" }),
);
function fillCatalogue() {
  const groups = [["Séances et accompagnements", "seance"], ["Retouches", "retouche"]];
  $("r-catalogue").replaceChildren(el("option", { value: "", text: "Choisir une prestation…" }),
    ...groups.map(([label, kind]) => el("optgroup", { label }, ...catalogue.filter((c) => c.kind === kind).map((c) => el("option", { value: c.id, text: `${c.label} · ${euro(c.unit)}` })))));
}

function prepareReply(q) {
  fillCatalogue();
  const last = (q.documents || [])[0];
  if (last) {
    lines = last.lines.map((l) => ({ ...l }));
    $("r-days").value = last.validity_days;
    $("r-intro").value = last.intro || "";
    $("r-hint").textContent = `Dernier devis (${last.number}) repris : modifiez-le puis renvoyez-le si besoin.`;
  } else {
    const item = q.type === "retouche" ? catalogue.find((c) => c.id === RETOUCHE) : null;
    lines = item ? [{ label: item.label, note: item.note, qty: 1, unit: item.unit, kind: item.kind }] : [];
    $("r-days").value = 30;
    const first = q.name.split(/\s+/)[0];
    $("r-intro").value = `Bonjour ${first},\n\nMerci pour votre demande. Vous trouverez ci-joint mon devis${q.type === "retouche" ? " pour vos retouches (délai de réalisation d'environ une semaine après validation)" : ""}.\n\nN'hésitez pas à me poser la moindre question.\n\nÀ bientôt,\nLaësia`;
    $("r-hint").textContent = q.type === "retouche"
      ? "Demande de retouches : l'ourlet simple est déjà ajouté. Indiquez la quantité d'après le message et les photos."
      : q.type === "style" ? "Demande de conseil en style : choisissez dans le catalogue la ou les prestations qui conviennent." : "Autre demande : ajoutez des lignes du catalogue ou des lignes libres.";
  }
  $("r-msg").hidden = true;
  drawLines();
}

function lineTotal() { return lines.reduce((s, l) => s + (Number(l.qty) || 0) * (Number(l.unit) || 0), 0); }
function drawTotal() { $("r-total").textContent = euro(lineTotal()); }

function drawLines() {
  const head = el("div", { class: "adm-line adm-line--head", "aria-hidden": "true" }, el("span", { text: "Prestation" }), el("span", { text: "Durée / délai" }), el("span", { text: "Qté" }), el("span", { text: "Prix unit. (€)" }), el("span", { text: "Total" }), el("span"));
  const rows = lines.map((l, i) => {
    const total = el("output", { class: "adm-line__total", text: euro((Number(l.qty) || 0) * (Number(l.unit) || 0)) });
    const bind = (field, input) => input.addEventListener("input", () => { l[field] = field === "label" || field === "note" ? input.value : input.value === "" ? "" : Number(input.value); total.textContent = euro((Number(l.qty) || 0) * (Number(l.unit) || 0)); drawTotal(); });
    const label = el("input", { type: "text", value: l.label, maxlength: "200", "aria-label": `Prestation, ligne ${i + 1}`, placeholder: "Description" });
    const note = el("input", { type: "text", value: l.note || "", maxlength: "60", "aria-label": `Durée ou délai, ligne ${i + 1}`, placeholder: "ex. 1h30" });
    const qty = el("input", { type: "number", value: l.qty, min: "0.01", max: "999", step: "any", inputmode: "decimal", "aria-label": `Quantité, ligne ${i + 1}` });
    const unit = el("input", { type: "number", value: l.unit, min: "0", max: "100000", step: "0.01", inputmode: "decimal", "aria-label": `Prix unitaire en euros, ligne ${i + 1}` });
    bind("label", label); bind("note", note); bind("qty", qty); bind("unit", unit);
    return el("div", { class: "adm-line" }, label, note, qty, unit, total,
      el("button", { type: "button", class: "adm-line__rm", onclick: () => { lines.splice(i, 1); drawLines(); } }, el("span", { "aria-hidden": "true", text: "×" }), el("span", { class: "sr-only", text: `Retirer la ligne ${i + 1}` })));
  });
  $("r-lines").replaceChildren(...(rows.length ? [head, ...rows] : [el("p", { class: "adm-empty", text: "Aucune ligne : ajoutez une prestation du catalogue ou une ligne libre." })]));
  drawTotal();
}
$("r-add").addEventListener("click", () => {
  const c = catalogue.find((x) => x.id === $("r-catalogue").value);
  if (!c) { say("r-msg", "Choisissez d'abord une prestation dans la liste.", false); return; }
  $("r-msg").hidden = true;
  const existing = lines.find((l) => l.label === c.label && l.unit === c.unit);
  if (existing) existing.qty = Number(existing.qty) + 1; else lines.push({ label: c.label, note: c.note, qty: 1, unit: c.unit, kind: c.kind });
  drawLines();
});
$("r-add-free").addEventListener("click", () => { lines.push({ label: "", note: "", qty: 1, unit: 0, kind: "autre" }); drawLines(); $("r-lines").querySelector(".adm-line:last-child input")?.focus(); });

function payload(send) {
  return { lines, intro: $("r-intro").value, validityDays: Number($("r-days").value) || 30, send };
}
async function busy(btn, label, fn) {
  const old = btn.textContent;
  btn.disabled = true; btn.textContent = label;
  try { await fn(); } finally { btn.disabled = false; btn.textContent = old; }
}
$("r-preview").addEventListener("click", () => busy($("r-preview"), "Création…", async () => {
  const w = window.open("", "_blank");
  try {
    const res = await api(`/quotes/${current.id}/preview`, { method: "POST", body: payload(false), raw: true });
    const url = URL.createObjectURL(await res.blob());
    if (w) w.location = url; else window.open(url, "_blank");
  } catch (e) { w?.close(); say("r-msg", e.message === "login" ? "Session expirée." : e.message, false); }
}));

async function submitDoc(send) {
  const res = await api(`/quotes/${current.id}/document`, { method: "POST", body: payload(send) });
  const q = await api(`/quotes/${current.id}`);
  fill(q);
  say("r-msg", send ? `Devis ${res.document.number} envoyé à ${current.email}.` : `Devis ${res.document.number} enregistré (non envoyé).`, true);
}
$("r-save").addEventListener("click", () => busy($("r-save"), "Enregistrement…", async () => {
  try { await submitDoc(false); } catch (e) { say("r-msg", e.message === "login" ? "Session expirée." : e.message, false); }
}));
$("r-send").addEventListener("click", () => {
  if (!confirm(`Envoyer ce devis de ${euro(lineTotal())} à ${current.name} (${current.email}) ?`)) return;
  busy($("r-send"), "Envoi en cours…", async () => {
    try { await submitDoc(true); } catch (e) {
      say("r-msg", e.message === "login" ? "Session expirée." : e.message, false);
      if (e.data && e.data.document) fill({ ...(await api(`/quotes/${current.id}`)) });
    }
  });
});

function drawDocs(docs) {
  $("r-docs").replaceChildren(...(docs.length ? docs.map((d) => el("li", { class: "adm-doc" },
    el("div", {}, el("strong", { text: d.number }), el("p", { class: "adm-muted", text: `${euro(d.total)} · ${d.sent_at ? "envoyé le " + fmtDate.format(new Date(d.sent_at)) : "non envoyé"}` })),
    el("a", { class: "adm-link", href: `/admin/api/documents/${d.id}/pdf`, target: "_blank", rel: "noopener" }, "PDF", el("span", { class: "sr-only", text: ` du devis ${d.number} (nouvel onglet)` })))) : [el("li", { class: "adm-empty", text: "Aucun devis émis pour l'instant." })]));
}

// ---------- Rendez-vous ----------
async function renderRdv() {
  const d = await api("/appointments");
  $("rdv-list").replaceChildren(...(d.items.length ? d.items.map(apptCard) : [empty("Aucun rendez-vous à venir.")]));
}
function apptCard(a) {
  const d = new Date(a.start);
  return el("li", { class: "adm-appt" },
    el("span", { class: "adm-tl__date", "aria-hidden": "true" }, el("strong", { text: fmtDay.format(d) }), el("small", { text: fmtMon.format(d) })),
    el("div", { class: "adm-appt__main" },
      el("p", { class: "adm-tl__title", text: a.service || a.summary }),
      el("p", { class: "adm-muted", text: fmtDateTime.format(d) }),
      el("p", { class: "adm-appt__who", text: `${a.name}${a.email ? " · " + a.email : ""}${a.phone ? " · " + a.phone : ""}` })),
    el("div", { class: "adm-appt__side" }, a.price ? el("strong", { text: euro(a.price) }) : null,
      el("button", { type: "button", class: "adm-danger", onclick: () => cancelAppt(a) }, "Annuler", el("span", { class: "sr-only", text: ` le rendez-vous de ${a.name}` }))));
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
