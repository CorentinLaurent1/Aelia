// Adresse qui reçoit les demandes de rendez-vous (à remplacer)
const CONTACT_EMAIL = "aelia.bylaesia@gmail.com";

// Route du serveur (server.js) qui envoie l'e-mail. Vide = repli sur la messagerie du visiteur.
// Une fois renseigné, la demande part directement, sans passer par la messagerie du visiteur,
// et un message de confirmation s'affiche.
const FORM_ENDPOINT = "/api/contact";

// Outil de réservation + paiement (Calendly, Stripe Payment Link, Planity…).
// Si renseigné, les boutons y mènent directement ; sinon le formulaire s'ouvre.
// BOOKING_URLS : lien par prestation (clé = texte du bouton), BOOKING_URL : lien par défaut.
const BOOKING_URL = "";
const BOOKING_URLS = {
  // "Analyse morphologique": "https://...",
  // "Pack Éclat": "https://...",
};

// Mettre à true quand la réservation en ligne est prête : le formulaire remplace alors la pop-up « bientôt ».
const BOOKING_OPEN = false;

// Menu mobile
const toggle = document.querySelector(".nav__toggle");
const links = document.querySelector(".nav__links");
toggle.addEventListener("click", () => {
  const open = links.classList.toggle("open");
  toggle.setAttribute("aria-expanded", open);
});
links.addEventListener("click", () => links.classList.remove("open"));

// Demande de rendez-vous
const soon = document.getElementById("soon");
soon.querySelector(".dialog__close").addEventListener("click", () => soon.close());
soon.querySelector(".soon__later").addEventListener("click", () => soon.close());
soon.addEventListener("click", (e) => { if (e.target === soon) soon.close(); });

const dialog = document.getElementById("booking");
const form = document.getElementById("booking-form");

document.querySelectorAll("[data-book]").forEach((el) =>
  el.addEventListener("click", (e) => {
    e.preventDefault();
    if (!BOOKING_OPEN) {
      soon.showModal();
      return;
    }
    const url = BOOKING_URLS[el.dataset.book] || BOOKING_URL;
    if (url) {
      window.open(url, "_blank", "noopener");
      return;
    }
    form.service.value = el.dataset.book || "";
    status.hidden = true;
    dialog.showModal();
  })
);
dialog.querySelector(".dialog__close").addEventListener("click", () => dialog.close());
dialog.addEventListener("click", (e) => { if (e.target === dialog) dialog.close(); });

const status = document.getElementById("booking-status");
const submitBtn = form.querySelector("button[type=submit]");

function showStatus(msg, ok) {
  status.textContent = msg;
  status.className = "form-status " + (ok ? "form-status--ok" : "form-status--error");
  status.hidden = false;
}

form.addEventListener("submit", async (e) => {
  e.preventDefault();
  const d = new FormData(form);
  status.hidden = true;

  // Sans service d'envoi configuré : repli sur le logiciel de messagerie
  if (!FORM_ENDPOINT) {
    const subject = encodeURIComponent(`Demande de rendez-vous : ${d.get("service")}`);
    const body = encodeURIComponent(`Nom : ${d.get("name")}
E-mail : ${d.get("email")}

${d.get("msg")}`);
    window.location.href = `mailto:${CONTACT_EMAIL}?subject=${subject}&body=${body}`;
    showStatus("Votre application de messagerie s'ouvre : cliquez sur « Envoyer » pour finaliser votre demande.", true);
    return;
  }

  submitBtn.disabled = true;
  submitBtn.textContent = "Envoi en cours…";
  try {
    const res = await fetch(FORM_ENDPOINT, {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify(Object.fromEntries(d)),
    });
    if (!res.ok) throw new Error(res.status);
    form.reset();
    showStatus("Merci ! Votre demande a bien été envoyée. Je vous réponds très vite.", true);
    submitBtn.textContent = "Demande envoyée ✓";
    setTimeout(() => { dialog.close(); submitBtn.disabled = false; submitBtn.textContent = "Envoyer ma demande"; status.hidden = true; }, 3500);
  } catch {
    showStatus(`L'envoi a échoué. Réessayez ou écrivez-moi directement à ${CONTACT_EMAIL}.`, false);
    submitBtn.disabled = false;
    submitBtn.textContent = "Envoyer ma demande";
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
onScroll();
window.addEventListener("scroll", onScroll, { passive: true });

// Apparition des éléments au défilement
const targets = document.querySelectorAll(
  ".section h2, .section .eyebrow, .group__head, .card, .pack, .about__photo, .about__text, .promise .grid > div, .cta > *"
);
targets.forEach((el) => {
  el.classList.add("reveal");
  const i = [...el.parentElement.children].indexOf(el);
  el.style.setProperty("--d", `${Math.min(i, 4) * 0.12}s`);
});
if ("IntersectionObserver" in window) {
  const io = new IntersectionObserver((entries) => {
    entries.forEach((en) => {
      if (en.isIntersecting) { en.target.classList.add("in"); io.unobserve(en.target); }
    });
  }, { threshold: 0.12 });
  targets.forEach((el) => io.observe(el));
} else {
  targets.forEach((el) => el.classList.add("in"));
}
