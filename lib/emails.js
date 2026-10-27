// Textes de tous les e-mails envoyés par le site (clientes et responsable).
// Chaque fonction renvoie { subject, text, html } prêt à être envoyé.
const { compose } = require("./email-template");

const first = (name) => String(name || "").trim().split(/\s+/)[0] || "";
const cap = (s) => s.charAt(0).toUpperCase() + s.slice(1);
const out = (subject, c) => ({ subject, ...c });

// ----- Réservation -----
function bookingClient({ base, name, service, when, duration, price, cancelUrl, cancelHours }) {
  const w = cap(when);
  return out(`Rendez-vous confirmé · ${service} · ${w}`, compose({
    base, eyebrow: "Confirmation de rendez-vous", title: "Votre rendez-vous est confirmé",
    preheader: `${service}, ${w}. Récapitulatif et invitation pour votre agenda.`,
    paras: [`Bonjour ${first(name)},`, "Je vous remercie pour votre confiance et me réjouis de vous accueillir très prochainement. Voici le récapitulatif de votre rendez-vous."],
    rows: [["Prestation", service], ["Date et heure", w], ["Durée", duration], ["Tarif", price]],
    after: ["L'invitation jointe à cet e-mail vous permet d'ajouter le rendez-vous à votre agenda. Les modalités pratiques et de règlement vous seront précisées avant notre rencontre ; n'hésitez pas à me poser toute question en répondant à ce message."],
    button: { url: cancelUrl, label: "Annuler ou déplacer mon rendez-vous" },
    note: `Annulation ou report possible en ligne jusqu'à ${cancelHours} h avant le rendez-vous. Au-delà, merci de me contacter directement.`,
    reason: "Vous recevez cet e-mail suite à votre réservation sur le site d'Aélia.",
  }));
}

function bookingOwner({ base, name, email, phone, msg, service, when, duration, price }) {
  const w = cap(when);
  return out(`Nouvelle réservation · ${service} · ${w} · ${name}`, compose({
    base, eyebrow: "Nouvelle réservation", title: `${name} a réservé`,
    preheader: `${service}, ${w}`, signoff: false,
    paras: ["Une réservation vient d'être enregistrée depuis le site. Elle figure déjà dans votre agenda iCloud, et la cliente a reçu sa confirmation avec l'invitation."],
    rows: [["Prestation", `${service} · ${duration} · ${price}`], ["Date et heure", w], ["Cliente", name], ["E-mail", email], ["Téléphone", phone || "non renseigné"], ["Message de la cliente", msg || "aucun"]],
    after: ["Vous pouvez lui écrire en répondant simplement à cet e-mail."],
    button: { url: `${base}/admin`, label: "Ouvrir mon espace responsable" },
    reason: "Notification interne du site d'Aélia.",
  }));
}

// ----- Annulation par la cliente -----
function cancelClient({ base, name, service, when }) {
  const w = cap(when);
  return out(`Annulation de votre rendez-vous · ${w}`, compose({
    base, eyebrow: "Annulation", title: "Votre rendez-vous est annulé",
    preheader: `Annulation prise en compte : ${service}, ${w}`,
    paras: [`Bonjour ${first(name)},`, "J'ai bien pris en compte l'annulation de votre rendez-vous. Pensez à supprimer l'événement de votre agenda."],
    rows: [["Prestation", service], ["Date et heure", w]],
    after: ["Si vous le souhaitez, vous pouvez reprendre rendez-vous à tout moment, en choisissant le créneau qui vous convient."],
    button: { url: `${base}/`, label: "Choisir un nouveau créneau" },
    reason: "Vous recevez cet e-mail suite à l'annulation de votre rendez-vous sur le site d'Aélia.",
  }));
}

function cancelOwner({ base, name, email, service, when }) {
  const w = cap(when);
  return out(`Annulation · ${service} · ${w} · ${name}`, compose({
    base, eyebrow: "Annulation", title: `${name} a annulé`, preheader: `${service}, ${w}`, signoff: false,
    paras: ["Une cliente a annulé son rendez-vous depuis le lien de son e-mail. Le créneau est de nouveau disponible dans votre agenda."],
    rows: [["Prestation", service], ["Date et heure", w], ["Cliente", name], ["E-mail", email]],
    reason: "Notification interne du site d'Aélia.",
  }));
}

// ----- Annulation par la responsable -----
function apptCancelledByOwner({ base, name, service, when }) {
  const w = cap(when);
  return out(`Annulation de votre rendez-vous Aélia · ${w}`, compose({
    base, eyebrow: "Annulation", title: "Votre rendez-vous est annulé",
    preheader: `Je dois annuler notre rendez-vous du ${w}`,
    paras: [`Bonjour ${first(name)},`, "Je suis sincèrement désolée : je dois annuler notre rendez-vous. Je vous prie de bien vouloir m'excuser pour ce désagrément et vous contacterai très vite pour en convenir d'un autre."],
    rows: [["Prestation", service], ["Date prévue", w]],
    after: ["Si vous préférez, vous pouvez dès maintenant choisir un nouveau créneau en ligne."],
    button: { url: `${base}/`, label: "Choisir un autre créneau" },
    reason: "Vous recevez cet e-mail suite à votre réservation sur le site d'Aélia.",
  }));
}

// ----- Demande de devis -----
function quoteOwner({ base, ref, typeLabel, name, email, phone, msg, photos }) {
  return out(`Demande de devis${ref ? " " + ref : ""} · ${typeLabel} · ${name}`, compose({
    base, eyebrow: "Demande de devis", title: `Nouvelle demande de ${name}`, preheader: `${typeLabel} · ${photos} photo${photos > 1 ? "s" : ""}`, signoff: false,
    paras: ["Une demande de devis vient d'arriver depuis le site." + (ref ? " Elle est enregistrée dans votre espace responsable, où vous pouvez y répondre par un devis PDF." : "")],
    rows: [...(ref ? [["Référence", ref]] : []), ["Type de demande", typeLabel], ["Cliente", name], ["E-mail", email], ["Téléphone", phone || "non renseigné"], ["Photos jointes", String(photos)], ["Demande", msg]],
    after: ["Vous pouvez aussi lui répondre directement en répondant à cet e-mail."],
    button: ref ? { url: `${base}/admin`, label: "Répondre depuis mon espace" } : undefined,
    reason: "Notification interne du site d'Aélia.",
  }));
}

function quoteAck({ base, ref, typeLabel, name, msg, photos, retouche }) {
  return out("Votre demande de devis est bien reçue · Aélia", compose({
    base, eyebrow: "Demande de devis", title: "Votre demande est bien reçue",
    preheader: "Je l'étudie avec attention et reviens vers vous avec un devis.",
    paras: [`Bonjour ${first(name)},`, "Je vous remercie de l'intérêt que vous portez à Aélia. J'étudie votre demande avec attention et reviens vers vous dans les meilleurs délais avec un devis personnalisé."],
    rows: [...(ref ? [["Référence", ref]] : []), ["Votre demande", typeLabel], ["Photos transmises", String(photos)], ...(retouche ? [["Délai de réalisation", "environ 1 semaine après validation du devis"]] : []), ["Votre message", msg]],
    after: ["Si vous souhaitez ajouter une précision ou une photo, il vous suffit de répondre à cet e-mail."],
    reason: "Vous recevez cet e-mail suite à votre demande de devis sur le site d'Aélia.",
  }));
}

// ----- Devis envoyé depuis l'espace responsable -----
function quoteSent({ base, name, number, lines, total, validUntil, intro, hasSeance, hasRetouche, eur }) {
  const body = (intro || "").trim() ? intro.trim().split(/\n{2,}/) : [`Bonjour ${first(name)},`, "Vous trouverez ci-joint mon devis, établi d'après votre demande."];
  return out(`Votre devis Aélia n° ${number} · ${eur(total)}`, compose({
    base, eyebrow: `Devis n° ${number}`, title: "Votre devis est prêt",
    preheader: `Devis ${number} : ${eur(total)}, valable jusqu'au ${validUntil}.`,
    paras: body,
    rows: [...lines.map((l) => [l.label + (l.qty !== 1 ? ` × ${l.qty}` : ""), eur(l.qty * l.unit)]), ["Total (TVA non applicable)", eur(total)], ["Valable jusqu'au", validUntil], ...(hasRetouche ? [["Délai de réalisation des retouches", "environ 1 semaine"]] : [])],
    after: [hasSeance ? "Le devis détaillé est joint à cet e-mail au format PDF. Pour le valider, vous pouvez réserver votre créneau en ligne ou répondre à ce message." : "Le devis détaillé est joint à cet e-mail au format PDF. Pour le valider, il vous suffit de répondre à ce message ; je vous indiquerai alors comment me remettre vos vêtements."],
    button: hasSeance ? { url: `${base}/#prestations`, label: "Réserver mon rendez-vous" } : undefined,
    reason: "Vous recevez cet e-mail suite à votre demande de devis sur le site d'Aélia.",
  }));
}

module.exports = { bookingClient, bookingOwner, cancelClient, cancelOwner, apptCancelledByOwner, quoteOwner, quoteAck, quoteSent };
