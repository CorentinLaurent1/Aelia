// Adresse affichée en cas de problème
const CONTACT_EMAIL = "aelia.bylaesia@gmail.com";
const TZ = "Europe/Paris";

// Menu mobile
const toggle = document.querySelector(".nav__toggle");
const links = document.querySelector(".nav__links");
toggle.addEventListener("click", () => {
  const open = links.classList.toggle("open");
  toggle.setAttribute("aria-expanded", open);
});
links.addEventListener("click", () => links.classList.remove("open"));
document.addEventListener("keydown", (e) => {
  if (e.key === "Escape" && links.classList.contains("open")) {
    links.classList.remove("open");
    toggle.setAttribute("aria-expanded", "false");
    toggle.focus();
  }
});

// ---------- Pop-up « bientôt » (affichée tant que l'agenda n'est pas relié) ----------
const soon = document.getElementById("soon");
soon.querySelector(".dialog__close").addEventListener("click", () => soon.close());
soon.querySelector(".soon__later").addEventListener("click", () => soon.close());
soon.addEventListener("click", (e) => { if (e.target === soon) soon.close(); });

// ---------- Réservation synchronisée avec l'agenda ----------
const dlg = document.getElementById("booking");
const $ = (id) => document.getElementById(id);
const el = {
  service: $("bk-service"), month: $("bk-month"), grid: $("bk-grid"), guideTitle: $("bk-guide-title"), guideText: $("bk-guide-text"), cal: $("bk-cal"), slots: $("bk-slots"),
  prev: $("bk-prev"), next: $("bk-next"), pick: $("bk-pick"), form: $("bk-form"), summary: $("bk-summary"),
  back: $("bk-back"), status: $("bk-status"), submit: $("bk-submit"), done: $("bk-done"), doneText: $("bk-done-text"),
  steps: $("bk-steps"), recap: $("bk-recap"), recapService: $("bk-recap-service"), recapMeta: $("bk-recap-meta"), recapWhen: $("bk-recap-when"),
  doneMail: $("bk-done-mail"), ics: $("bk-ics"), cancelLink: $("bk-cancel-link"),
};

const state = { services: null, serviceId: "", month: null, slots: {}, day: null, start: null, busy: false };

const cap = (s) => s.charAt(0).toUpperCase() + s.slice(1);
const pad = (n) => String(n).padStart(2, "0");
const keyOf = (y, m, d) => `${y}-${pad(m + 1)}-${pad(d)}`;
const timeFmt = new Intl.DateTimeFormat("fr-FR", { timeZone: TZ, hour: "2-digit", minute: "2-digit" });
const longFmt = new Intl.DateTimeFormat("fr-FR", { timeZone: TZ, weekday: "long", day: "numeric", month: "long", hour: "2-digit", minute: "2-digit" });
const monthFmt = new Intl.DateTimeFormat("fr-FR", { timeZone: "UTC", month: "long", year: "numeric" });
const dayFmt = new Intl.DateTimeFormat("fr-FR", { timeZone: "UTC", weekday: "long", day: "numeric", month: "long" });

let servicesData;
async function fetchServices() {
  if (servicesData) return servicesData;
  const res = await fetch("/api/services", { headers: { Accept: "application/json" } });
  if (!res.ok) throw new Error(res.status);
  servicesData = await res.json();
  return servicesData;
}

async function loadServices() {
  if (state.services) return state.services;
  const data = await fetchServices();
  if (!data.bookingEnabled) throw new Error("disabled");
  state.services = data.services.filter((s) => !s.quoteOnly);
  el.service.innerHTML = '<option value="">Choisir une prestation…</option>' +
    state.services.map((s) => `<option value="${s.id}">${s.name} · ${s.price}</option>`).join("");
  return state.services;
}

function serviceIdFor(label) {
  if (!label) return "";
  const hit = state.services.find((s) => s.name === label);
  if (hit) return hit.id;
  if (label === "Accompagnement shopping") return "shopping-1h";
  return "";
}

// Consigne affichée en haut de l'étape (que faire maintenant ?)
function setGuide(title, text, tone = "") {
  el.guideTitle.textContent = title;
  el.guideText.textContent = text;
  el.guideTitle.closest(".bk-guide").dataset.tone = tone;
}

const STEP_NUM = { pick: 1, form: 2, done: 3 };
function showStep(step) {
  el.pick.hidden = step !== "pick";
  el.form.hidden = step !== "form";
  el.done.hidden = step !== "done";
  const n = STEP_NUM[step];
  el.steps.querySelectorAll("li").forEach((li) => {
    const i = Number(li.dataset.step);
    li.classList.toggle("on", i === n);
    li.classList.toggle("done", i < n || step === "done");
  });
  dlg.querySelector(".booking__body").scrollTop = 0;
}

const durationLabel = (m) => `${Math.floor(m / 60)}h${m % 60 ? String(m % 60).padStart(2, "0") : ""}`;

function updateRecap() {
  const s = state.serviceId && serviceById(state.serviceId);
  el.recap.hidden = !s;
  if (!s) return;
  el.recapService.textContent = s.name;
  el.recapMeta.textContent = `${durationLabel(s.minutes)} · ${s.price}`;
  el.recapWhen.textContent = state.start ? cap(longFmt.format(new Date(state.start))) : "Choisissez un créneau";
  el.recapWhen.classList.toggle("set", Boolean(state.start));
}

async function loadMonth() {
  const { y, m } = state.month;
  const last = new Date(Date.UTC(y, m + 1, 0)).getUTCDate();
  el.month.textContent = monthFmt.format(new Date(Date.UTC(y, m, 1)));
  state.slots = {};
  state.day = null;
  el.slots.innerHTML = "";
  if (!state.serviceId) {
    renderGrid();
    el.cal.classList.add("locked");
    setGuide("Choisissez votre prestation", "Sélectionnez-la dans la liste : le calendrier affichera aussitôt mes disponibilités.");
    return;
  }
  el.cal.classList.remove("locked");
  setGuide("Un instant…", "Je consulte mon agenda pour vous proposer les meilleurs créneaux.");
  el.grid.classList.add("loading");
  try {
    const q = new URLSearchParams({ service: state.serviceId, from: keyOf(y, m, 1), to: keyOf(y, m, last) });
    const res = await fetch(`/api/availability?${q}`);
    if (!res.ok) throw new Error(res.status);
    state.slots = (await res.json()).slots;
    const n = Object.keys(state.slots).length;
    if (n) setGuide("Choisissez un jour", "Les jours en rose sont disponibles. Les autres sont déjà pris ou fermés.");
    else setGuide("Aucune disponibilité ce mois-ci", "Essayez le mois suivant avec la flèche ›.", "warn");
  } catch {
    setGuide("Agenda momentanément indisponible", `Réessayez dans un instant ou écrivez-moi à ${CONTACT_EMAIL}.`, "warn");
  }
  el.grid.classList.remove("loading");
  renderGrid();
}

function renderGrid() {
  const { y, m } = state.month;
  const offset = (new Date(Date.UTC(y, m, 1)).getUTCDay() + 6) % 7; // lundi = 0
  const last = new Date(Date.UTC(y, m + 1, 0)).getUTCDate();
  let html = ["L", "M", "M", "J", "V", "S", "D"].map((d) => `<span class="cal-dow">${d}</span>`).join("");
  html += '<span></span>'.repeat(offset);
  for (let d = 1; d <= last; d++) {
    const key = keyOf(y, m, d);
    const ok = Boolean(state.slots[key]);
    const full = dayFmt.format(new Date(key + "T12:00:00Z"));
    html += `<button type="button" class="cal-day${ok ? " ok" : ""}${key === state.day ? " sel" : ""}" data-day="${key}" aria-label="${full}${ok ? "" : ", indisponible"}" aria-pressed="${key === state.day}" ${ok ? "" : "disabled"}>${d}</button>`;
  }
  el.grid.innerHTML = html;
  const now = new Date();
  el.prev.disabled = y === now.getFullYear() && m <= now.getMonth();
}

function renderSlots() {
  const list = state.slots[state.day] || [];
  const label = dayFmt.format(new Date(state.day + "T12:00:00Z"));
  const s = serviceById(state.serviceId);
  setGuide("Choisissez une heure", `Créneaux du ${label} · durée ${durationLabel(s.minutes)}. Un clic suffit pour sélectionner.`);
  el.slots.innerHTML = list.map((iso) => `<button type="button" class="slot" data-start="${iso}">${timeFmt.format(new Date(iso))}</button>`).join("");
}

function serviceById(id) { return state.services.find((s) => s.id === id); }

async function openBooking(label) {
  let services;
  try {
    services = await loadServices();
  } catch {
    soon.showModal(); // réservation pas encore active
    return;
  }
  state.serviceId = serviceIdFor(label);
  state.start = null;
  el.service.value = state.serviceId;
  updateRecap();
  const now = new Date();
  state.month = { y: now.getFullYear(), m: now.getMonth() };
  el.status.hidden = true;
  showStep("pick");
  dlg.showModal();
  loadMonth();
}

document.querySelectorAll("[data-book]").forEach((a) =>
  a.addEventListener("click", (e) => {
    e.preventDefault();
    openBooking(a.dataset.book);
  })
);
dlg.querySelector(".dialog__close").addEventListener("click", () => dlg.close());
dlg.addEventListener("click", (e) => { if (e.target === dlg) dlg.close(); });

el.service.addEventListener("change", () => { state.serviceId = el.service.value; state.start = null; updateRecap(); loadMonth(); });
el.prev.addEventListener("click", () => { state.month = shiftMonth(-1); loadMonth(); });
el.next.addEventListener("click", () => { state.month = shiftMonth(1); loadMonth(); });
function shiftMonth(delta) {
  const d = new Date(Date.UTC(state.month.y, state.month.m + delta, 1));
  return { y: d.getUTCFullYear(), m: d.getUTCMonth() };
}

el.grid.addEventListener("click", (e) => {
  const b = e.target.closest("[data-day]");
  if (!b || b.disabled) return;
  state.day = b.dataset.day;
  renderGrid();
  renderSlots();
  // le clavier arrive directement sur le premier créneau du jour choisi
  el.slots.querySelector(".slot")?.focus();
});

// Navigation au clavier dans le calendrier : flèches (jours disponibles uniquement)
el.grid.addEventListener("keydown", (e) => {
  const steps = { ArrowRight: 1, ArrowLeft: -1, ArrowDown: 7, ArrowUp: -7 };
  if (!(e.key in steps) || !e.target.matches("[data-day]")) return;
  const days = [...el.grid.querySelectorAll(".cal-day.ok")];
  const i = days.indexOf(e.target);
  const dir = Math.sign(steps[e.key]);
  const cur = new Date(e.target.dataset.day + "T12:00:00Z").getTime();
  const wanted = cur + steps[e.key] * 864e5;
  let target = days.find((d) => new Date(d.dataset.day + "T12:00:00Z").getTime() === wanted);
  if (!target) target = days[i + dir];
  if (target) { e.preventDefault(); target.focus(); }
});

el.slots.addEventListener("click", (e) => {
  const b = e.target.closest("[data-start]");
  if (!b) return;
  state.start = b.dataset.start;
  const s = serviceById(state.serviceId);
  const when = cap(longFmt.format(new Date(state.start)));
  el.summary.innerHTML = `<b>${s.name}</b> · ${durationLabel(s.minutes)} · ${s.price}<br>${when}`;
  updateRecap();
  el.status.hidden = true;
  showStep("form");
});

el.back.addEventListener("click", () => { state.start = null; updateRecap(); showStep("pick"); });

function showStatus(msg, ok) {
  el.status.textContent = msg;
  el.status.className = "form-status " + (ok ? "form-status--ok" : "form-status--error");
  el.status.hidden = false;
}

el.form.addEventListener("submit", async (e) => {
  e.preventDefault();
  if (state.busy) return;
  state.busy = true;
  el.status.hidden = true;
  el.submit.disabled = true;
  el.submit.textContent = "Réservation en cours…";
  const d = Object.fromEntries(new FormData(el.form));
  try {
    const res = await fetch("/api/book", {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify({ ...d, service: state.serviceId, start: state.start }),
    });
    const data = await res.json().catch(() => ({}));
    if (res.status === 409) {
      // créneau pris entre-temps : retour au calendrier mis à jour
      showStep("pick");
      await loadMonth();
      setGuide("Ce créneau vient d'être pris", data.error || "Choisissez-en un autre dans le calendrier.", "warn");
      return;
    }
    if (!res.ok) throw new Error(data.error || res.status);
    el.form.reset();
    el.doneText.innerHTML = `<b>${data.service}</b><br>${cap(data.when)} · ${data.duration}`;
    el.doneMail.textContent = data.emailSent
      ? "Un e-mail de confirmation vient de vous être envoyé, avec l'invitation pour votre agenda."
      : "Votre rendez-vous est bien enregistré. L'e-mail de confirmation n'a pas pu être envoyé : notez les informations ci-dessus ou ajoutez le rendez-vous à votre agenda.";
    el.doneMail.classList.toggle("warn", !data.emailSent);
    el.doneMail.hidden = data.emailSent;
    $("bk-next-mail").hidden = !data.emailSent;
    el.cancelLink.href = data.cancelUrl;
    state.ics = data.ics;
    showStep("done");
  } catch (err) {
    showStatus(`La réservation a échoué. Réessayez ou écrivez-moi à ${CONTACT_EMAIL}.`, false);
  } finally {
    state.busy = false;
    el.submit.disabled = false;
    el.submit.textContent = "Confirmer le rendez-vous";
  }
});
$("bk-close-done").addEventListener("click", () => dlg.close());
el.ics.addEventListener("click", () => {
  if (!state.ics) return;
  const url = URL.createObjectURL(new Blob([state.ics], { type: "text/calendar;charset=utf-8" }));
  const a = Object.assign(document.createElement("a"), { href: url, download: "rendez-vous-aelia.ics" });
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
});

// ---------- Demande de devis : description + photos ----------
const qd = $("quote");
const qt = { form: $("qt-form"), type: $("qt-type"), file: $("qt-file"), thumbs: $("qt-thumbs"), count: $("qt-count"), photoErr: $("qt-photos-error"), status: $("qt-status"), submit: $("qt-submit"), done: $("qt-done"), photos: [] };
const MAX_PHOTOS = 5;
const MAX_TOTAL = 3.8 * 1024 * 1024; // la requête reste sous la limite de 4,5 Mo de l'hébergeur

qd.querySelector(".dialog__close").addEventListener("click", () => qd.close());
$("qt-close").addEventListener("click", () => qd.close());
qd.addEventListener("click", (e) => { if (e.target === qd) qd.close(); });

function openQuote(type) {
  qt.form.reset();
  qt.photos = [];
  renderPhotos();
  if (type && [...qt.type.options].some((o) => o.value === type)) qt.type.value = type;
  qt.form.hidden = false;
  qt.done.hidden = true;
  qt.status.hidden = true;
  qt.photoErr.hidden = true;
  qd.showModal();
}
document.querySelectorAll("[data-quote]").forEach((a) =>
  a.addEventListener("click", (e) => { e.preventDefault(); openQuote(a.dataset.quote); })
);

function photoError(msg) { qt.photoErr.textContent = msg; qt.photoErr.hidden = !msg; }

// Réduit la photo (1600 px max, JPEG) pour un envoi rapide et léger
async function shrink(file) {
  const bmp = await createImageBitmap(file);
  const scale = Math.min(1, 1600 / Math.max(bmp.width, bmp.height));
  const c = document.createElement("canvas");
  c.width = Math.round(bmp.width * scale);
  c.height = Math.round(bmp.height * scale);
  c.getContext("2d").drawImage(bmp, 0, 0, c.width, c.height);
  bmp.close?.();
  let blob = await new Promise((r) => c.toBlob(r, "image/jpeg", 0.82));
  if (blob && blob.size > 900 * 1024) blob = await new Promise((r) => c.toBlob(r, "image/jpeg", 0.65));
  return blob;
}

function renderPhotos() {
  qt.count.textContent = `${qt.photos.length} / ${MAX_PHOTOS}`;
  qt.thumbs.innerHTML = "";
  qt.photos.forEach((p, i) => {
    const li = document.createElement("li");
    const img = Object.assign(document.createElement("img"), { src: p.url, alt: `Photo ${i + 1} : ${p.name}` });
    const btn = Object.assign(document.createElement("button"), { type: "button", className: "qt-thumb__rm" });
    btn.innerHTML = `<span aria-hidden="true">×</span><span class="sr-only">Retirer la photo ${i + 1}</span>`;
    btn.addEventListener("click", () => {
      URL.revokeObjectURL(p.url);
      qt.photos.splice(i, 1);
      renderPhotos();
      qt.file.focus();
    });
    li.append(img, btn);
    qt.thumbs.append(li);
  });
}

qt.file.addEventListener("change", async () => {
  photoError("");
  const files = [...qt.file.files];
  qt.file.value = "";
  for (const f of files) {
    if (qt.photos.length >= MAX_PHOTOS) { photoError(`Vous pouvez ajouter ${MAX_PHOTOS} photos au maximum.`); break; }
    try {
      const blob = await shrink(f);
      if (!blob) throw new Error("vide");
      const total = qt.photos.reduce((s, p) => s + p.blob.size, 0) + blob.size;
      if (total > MAX_TOTAL) { photoError("Les photos sont trop lourdes au total : retirez-en une ou choisissez-en de plus petites."); break; }
      qt.photos.push({ blob, name: f.name.replace(/\.[^.]+$/, "") + ".jpg", url: URL.createObjectURL(blob) });
    } catch {
      photoError(`« ${f.name} » n'a pas pu être lue : utilisez une photo JPEG, PNG ou WebP.`);
    }
  }
  renderPhotos();
});

qt.form.addEventListener("submit", async (e) => {
  e.preventDefault();
  qt.status.hidden = true;
  qt.submit.disabled = true;
  qt.submit.textContent = "Envoi en cours…";
  const fd = new FormData(qt.form);
  qt.photos.forEach((p) => fd.append("photos", p.blob, p.name));
  try {
    const res = await fetch("/api/quote", { method: "POST", headers: { Accept: "application/json" }, body: fd });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || res.status);
    const retouche = qt.type.value === "retouche";
    $("qt-done-text").textContent = "Merci ! J'étudie votre demande et je reviens vers vous très vite avec un devis.";
    const mail = $("qt-done-mail");
    mail.hidden = !retouche && data.ackSent;
    mail.classList.remove("warn");
    mail.textContent = retouche
      ? "Pour les retouches, comptez environ une semaine de réalisation après validation du devis." + (data.ackSent ? " Un accusé de réception vient de vous être envoyé." : "")
      : "";
    qt.photos.forEach((p) => URL.revokeObjectURL(p.url));
    qt.photos = [];
    qt.form.hidden = true;
    qt.done.hidden = false;
    $("qt-done-title").focus();
  } catch (err) {
    qt.status.textContent = `L'envoi a échoué. Réessayez ou écrivez-moi à ${CONTACT_EMAIL}.`;
    qt.status.className = "form-status form-status--error";
    qt.status.hidden = false;
  } finally {
    qt.submit.disabled = false;
    qt.submit.textContent = "Envoyer ma demande";
  }
});

// Bandeau cookies
const banner = document.getElementById("cookies");
const KEY = "aelia-cookies";
// Services tiers (statistiques, etc.) : à n'ajouter que dans cette fonction,
// elle ne s'exécute qu'après "Tout accepter".
function loadOptionalScripts() {
  // ex. : const s = document.createElement("script"); s.src = "..."; document.head.append(s);
}
const stored = () => { try { return localStorage.getItem(KEY); } catch { return null; } };
if (!stored()) banner.hidden = false;
else if (stored() === "yes") loadOptionalScripts();

banner.addEventListener("click", (e) => {
  const choice = e.target.dataset.cookie;
  if (!choice) return;
  try { localStorage.setItem(KEY, choice); } catch {}
  banner.hidden = true;
  if (choice === "yes") loadOptionalScripts();
});
document.getElementById("manage-cookies").addEventListener("click", (e) => {
  e.preventDefault();
  banner.hidden = false;
});

// Ombre de la barre de navigation au défilement
const nav = document.querySelector(".nav");
const onScroll = () => nav.classList.toggle("scrolled", window.scrollY > 10);
requestAnimationFrame(onScroll);
window.addEventListener("scroll", onScroll, { passive: true });

// Apparition des éléments au défilement
const targets = document.querySelectorAll(
  ".section h2, .section .eyebrow, .group__head, .card, .pack, .about__photo, .about__text, .promise .grid > div, .cta > *"
);
targets.forEach((t) => {
  t.classList.add("reveal");
  const i = [...t.parentElement.children].indexOf(t);
  t.style.setProperty("--d", `${Math.min(i, 4) * 0.12}s`);
});
if ("IntersectionObserver" in window) {
  const io = new IntersectionObserver((entries) => {
    entries.forEach((en) => {
      if (en.isIntersecting) { en.target.classList.add("in"); io.unobserve(en.target); }
    });
  }, { threshold: 0.12 });
  targets.forEach((t) => io.observe(t));
} else {
  targets.forEach((t) => t.classList.add("in"));
}
