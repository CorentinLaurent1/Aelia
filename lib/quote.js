// Génération du devis PDF (PDFKit, polices standard : aucun fichier de police à embarquer).
const path = require("path");
const PDFDocument = require("pdfkit");

const ACCENT = "#c4694a";
const MUTED = "#7a6a63";
const TEXT = "#2b2523";
const CREAM = "#f8eee8";

const eur = (n) => `${n.toLocaleString("fr-FR", { minimumFractionDigits: 0, maximumFractionDigits: 2 }).replace(/ | /g, " ")} €`;
const duration = (m) => `${Math.floor(m / 60)}h${m % 60 ? String(m % 60).padStart(2, "0") : ""}`;
const dateFr = (d) => d.toLocaleDateString("fr-FR", { day: "numeric", month: "long", year: "numeric", timeZone: "Europe/Paris" });

// quote : { ref, date, validUntil, client: { name, email, phone }, items: [{ name, minutes, amount }], siteUrl }
function buildQuotePdf(quote) {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: "A4", margin: 50, info: { Title: `Devis ${quote.ref} · Aélia`, Author: "Aélia" } });
    const chunks = [];
    doc.on("data", (c) => chunks.push(c));
    doc.on("end", () => resolve(Buffer.concat(chunks)));
    doc.on("error", reject);

    const W = doc.page.width - 100; // largeur utile
    const L = 50;

    // En-tête
    try { doc.image(path.join(__dirname, "..", "public", "assets", "images", "logo-aelia.png"), L, 42, { width: 110 }); } catch { /* logo facultatif */ }
    doc.font("Helvetica-Bold").fontSize(26).fillColor(ACCENT).text("DEVIS", L, 48, { width: W, align: "right" });
    doc.font("Helvetica").fontSize(10).fillColor(MUTED)
      .text(`N° ${quote.ref}`, L, 80, { width: W, align: "right" })
      .text(`Émis le ${dateFr(quote.date)}`, { width: W, align: "right" })
      .text(`Valable jusqu'au ${dateFr(quote.validUntil)}`, { width: W, align: "right" });

    // Émetteur / client
    const top = 175;
    doc.font("Helvetica-Bold").fontSize(8).fillColor(ACCENT).text("ÉMETTEUR", L, top).text("DESTINATAIRE", L + W / 2 + 10, top);
    doc.font("Helvetica-Bold").fontSize(11).fillColor(TEXT).text("Aélia · Conseil en style et image", L, top + 16, { width: W / 2 - 10 });
    doc.font("Helvetica").fontSize(10).fillColor(MUTED)
      .text("Laësia Laurent, entrepreneure individuelle", L, doc.y + 2, { width: W / 2 - 10 })
      .text("57 rue Saint Nicolas, 45550 Saint-Denis-de-l'Hôtel", { width: W / 2 - 10 })
      .text("SIRET : 106 249 105 00011", { width: W / 2 - 10 })
      .text("aelia.bylaesia@gmail.com · 07 69 02 87 87", { width: W / 2 - 10 });
    doc.font("Helvetica-Bold").fontSize(11).fillColor(TEXT).text(quote.client.name, L + W / 2 + 10, top + 16, { width: W / 2 - 10 });
    doc.font("Helvetica").fontSize(10).fillColor(MUTED).text(quote.client.email, L + W / 2 + 10, doc.y + 2, { width: W / 2 - 10 });
    if (quote.client.phone) doc.text(quote.client.phone, L + W / 2 + 10, doc.y, { width: W / 2 - 10 });

    // Tableau
    let y = 300;
    doc.roundedRect(L, y, W, 26, 6).fill(ACCENT);
    doc.font("Helvetica-Bold").fontSize(9).fillColor("#ffffff")
      .text("PRESTATION", L + 14, y + 9)
      .text("DURÉE / DÉLAI", L + W - 210, y + 9, { width: 90, align: "right" })
      .text("PRIX", L + W - 100, y + 9, { width: 86, align: "right" });
    y += 26;
    quote.items.forEach((it, i) => {
      if (i % 2 === 0) doc.rect(L, y, W, 30).fill(CREAM);
      doc.font("Helvetica").fontSize(11).fillColor(TEXT).text(it.qty > 1 ? `${it.name}  ×${it.qty}  (${eur(it.unit)} l'unité)` : it.name, L + 14, y + 9, { width: W - 220 });
      doc.fillColor(MUTED).text(it.minutes ? duration(it.minutes) : (it.delay || "-"), L + W - 210, y + 9, { width: 90, align: "right" });
      doc.fillColor(TEXT).text(eur(it.amount), L + W - 100, y + 9, { width: 86, align: "right" });
      y += 30;
    });

    // Total
    const total = quote.items.reduce((s, it) => s + it.amount, 0);
    const minutes = quote.items.reduce((s, it) => s + it.minutes, 0);
    y += 14;
    doc.moveTo(L + W - 250, y).lineTo(L + W, y).strokeColor(ACCENT).lineWidth(1).stroke();
    if (minutes) doc.font("Helvetica").fontSize(10).fillColor(MUTED).text(`Durée totale : ${duration(minutes)}`, L + W - 250, y + 10, { width: 250, align: "right" });
    doc.font("Helvetica-Bold").fontSize(16).fillColor(ACCENT).text(`Total : ${eur(total)}`, L + W - 250, y + 28, { width: 250, align: "right" });
    doc.font("Helvetica").fontSize(8.5).fillColor(MUTED).text("TVA non applicable, article 293 B du CGI", L + W - 250, y + 52, { width: 250, align: "right" });

    // Conditions
    y += 90;
    doc.font("Helvetica-Bold").fontSize(8).fillColor(ACCENT).text("CONDITIONS", L, y);
    const hasService = quote.items.some((it) => it.minutes > 0);
    const hasRetouche = quote.items.some((it) => !it.minutes);
    doc.font("Helvetica").fontSize(9.5).fillColor(MUTED).text(
      [
        `• Devis gratuit, valable ${quote.validityDays} jours à compter de sa date d'émission.`,
        ...(hasRetouche ? ["• Retouches : délai de réalisation d'environ une semaine à compter de la remise des vêtements, sans rendez-vous. Les modalités de dépôt sont indiquées par e-mail."] : []),
        ...(hasService ? ["• Les modalités pratiques et de règlement sont précisées lors de la confirmation du rendez-vous.", "• Rendez-vous réservable en ligne, avec annulation ou report possible via le lien reçu par e-mail."] : ["• Les modalités de règlement sont précisées lors de la remise des vêtements."]),
        "• Conditions générales de vente consultables sur le site.",
      ].join("\n"),
      L, y + 14, { width: W, lineGap: 3 },
    );

    // Bon pour accord
    const by = Math.max(doc.y + 24, 640);
    doc.roundedRect(L, by, W, 90, 10).lineWidth(1).strokeColor(ACCENT).stroke();
    doc.font("Helvetica-Bold").fontSize(9).fillColor(ACCENT).text("BON POUR ACCORD", L + 16, by + 14);
    doc.font("Helvetica").fontSize(9).fillColor(MUTED).text("Date, mention « Bon pour accord » et signature :", L + 16, by + 30);
    doc.font("Helvetica").fontSize(9).fillColor(MUTED).text(hasService ? `Pour accepter ce devis, réservez en ligne sur ${quote.siteUrl} ou répondez simplement à l'e-mail.` : "Pour accepter ce devis, répondez simplement à l'e-mail qui l'accompagne.", L + 16, by + 70, { width: W - 32 });

    // Pied de page
    doc.font("Helvetica").fontSize(8).fillColor(MUTED).text("Aélia · Laësia Laurent · SIRET 106 249 105 00011 · aelia.bylaesia@gmail.com", L, 765, { width: W, align: "center", lineBreak: false });
    doc.end();
  });
}

module.exports = { buildQuotePdf, eur, duration, dateFr };
