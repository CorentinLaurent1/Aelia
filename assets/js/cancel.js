const token = new URLSearchParams(location.search).get("t") || "";
const $ = (id) => document.getElementById(id);
const CONTACT_EMAIL = "aelia.bylaesia@gmail.com";

function status(msg, ok) {
  const s = $("m-status");
  s.textContent = msg;
  s.className = "form-status " + (ok ? "form-status--ok" : "form-status--error");
  s.hidden = false;
}

async function load() {
  try {
    const res = await fetch(`/api/appointment?t=${encodeURIComponent(token)}`);
    const data = await res.json();
    $("m-loading").hidden = true;
    if (!res.ok) throw new Error(data.error);
    $("m-details").hidden = false;
    $("m-when").innerHTML = `<b>${data.service}</b><br>${data.when}`;
    if (data.state === "cancelled") {
      $("m-info").textContent = "Ce rendez-vous est déjà annulé.";
      $("m-cancel").hidden = true;
      $("m-again").hidden = false;
    } else if (!data.canCancel) {
      $("m-info").textContent = data.past
        ? "Ce rendez-vous est passé."
        : `L'annulation en ligne n'est plus possible à moins de ${data.hours} h du rendez-vous. Écrivez-moi à ${CONTACT_EMAIL}.`;
      $("m-cancel").hidden = true;
    }
  } catch {
    $("m-loading").hidden = true;
    status(`Ce lien n'est pas valide. Écrivez-moi à ${CONTACT_EMAIL}.`, false);
  }
}

$("m-cancel").addEventListener("click", async () => {
  if (!confirm("Confirmer l'annulation de ce rendez-vous ?")) return;
  const btn = $("m-cancel");
  btn.disabled = true;
  try {
    const res = await fetch("/api/cancel", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ t: token }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || res.status);
    $("m-details").hidden = true;
    status("Votre rendez-vous est annulé. Un e-mail de confirmation vous a été envoyé. Pensez à le supprimer de votre agenda.", true);
    $("m-again").hidden = false;
  } catch (e) {
    btn.disabled = false;
    status(`L'annulation a échoué. Écrivez-moi à ${CONTACT_EMAIL}.`, false);
  }
});

load();
