// Devis PDF (PDFKit, polices standard : aucun fichier de police à embarquer).
const path = require("path");
const PDFDocument = require("pdfkit");

const ACCENT = "#c4694a";
const MUTED = "#7a6a63";
const TEXT = "#2b2523";
const CREAM = "#f8eee8";

const eur = (n) => `${Number(n).toLocaleString("fr-FR", { minimumFractionDigits: 0, maximumFractionDigits: 2 }).replace(/ | /g, " ")} €`;
const dateFr = (d) => new Date(d).toLocaleDateString("fr-FR", { day: "numeric", month: "long", year: "numeric", timeZone: "Europe/Paris" });
const totalOf = (lines) => lines.reduce((s, l) => s + l.qty * l.unit, 0);

// quote : { number, date, validUntil, validityDays, preview, siteUrl, client: { name, email, phone },
//           lines: [{ label, note, qty, unit, kind }] }
function buildQuotePdf(quote) {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: "A4", margin: 50, info: { Title: `Devis ${quote.number} · Aélia`, Author: "Aélia" } });
    const chunks = [];
    doc.on("data", (c) => chunks.push(c));
    doc.on("end", () => resolve(Buffer.concat(chunks)));
    doc.on("error", reject);

    const W = doc.page.width - 100;
    const L = 50;

    // En-tête
    try { doc.image(path.join(__dirname, "..", "public", "assets", "images", "logo-aelia.png"), L, 42, { width: 110 }); } catch { /* logo facultatif */ }
    doc.font("Helvetica-Bold").fontSize(26).fillColor(ACCENT).text("DEVIS", L, 48, { width: W, align: "right" });
    doc.font("Helvetica").fontSize(10).fillColor(MUTED)
      .text(`N° ${quote.number}`, L, 80, { width: W, align: "right" })
      .text(`Émis le ${dateFr(quote.date)}`, { width: W, align: "right" })
      .text(`Valable jusqu'au ${dateFr(quote.validUntil)}`, { width: W, align: "right" });
    if (quote.preview) doc.font("Helvetica-Bold").fontSize(9).fillColor("#b3402a").text("APERÇU · non envoyé", L, 118, { width: W, align: "right" });

    // Émetteur / destinataire
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
    const head = (y0) => {
      doc.roundedRect(L, y0, W, 26, 6).fill(ACCENT);
      doc.font("Helvetica-Bold").fontSize(8.5).fillColor("#ffffff")
        .text("PRESTATION", L + 14, y0 + 9)
        .text("DURÉE / DÉLAI", L + 220, y0 + 9, { width: 80 })
        .text("QTÉ", L + 300, y0 + 9, { width: 36, align: "center" })
        .text("PRIX UNIT.", L + 338, y0 + 9, { width: 66, align: "right" })
        .text("TOTAL", L + 408, y0 + 9, { width: 77, align: "right" });
      return y0 + 26;
    };
    let y = head(300);
    quote.lines.forEach((l, i) => {
      doc.font("Helvetica").fontSize(10.5);
      const h = Math.max(30, doc.heightOfString(l.label, { width: 196 }) + 18);
      if (y + h > 740) { doc.addPage(); y = head(60); }
      if (i % 2 === 0) doc.rect(L, y, W, h).fill(CREAM);
      doc.font("Helvetica").fontSize(10.5).fillColor(TEXT).text(l.label, L + 14, y + 9, { width: 196 });
      doc.fontSize(9.5).fillColor(MUTED).text(l.note || "-", L + 220, y + 9.5, { width: 80 });
      doc.fontSize(10.5).fillColor(TEXT).text(String(l.qty), L + 300, y + 9, { width: 36, align: "center" });
      doc.text(eur(l.unit), L + 338, y + 9, { width: 66, align: "right" });
      doc.font("Helvetica-Bold").text(eur(l.qty * l.unit), L + 408, y + 9, { width: 77, align: "right" });
      y += h;
    });

    // Total
    if (y > 520) { doc.addPage(); y = 60; }
    const total = totalOf(quote.lines);
    y += 14;
    doc.moveTo(L + W - 250, y).lineTo(L + W, y).strokeColor(ACCENT).lineWidth(1).stroke();
    doc.font("Helvetica-Bold").fontSize(16).fillColor(ACCENT).text(`Total : ${eur(total)}`, L + W - 250, y + 14, { width: 250, align: "right" });
    doc.font("Helvetica").fontSize(8.5).fillColor(MUTED).text("TVA non applicable, article 293 B du CGI", L + W - 250, y + 38, { width: 250, align: "right" });

    // Conditions
    y += 74;
    const hasSeance = quote.lines.some((l) => l.kind === "seance");
    const hasRetouche = quote.lines.some((l) => l.kind === "retouche");
    doc.font("Helvetica-Bold").fontSize(8).fillColor(ACCENT).text("CONDITIONS", L, y);
    doc.font("Helvetica").fontSize(9.5).fillColor(MUTED).text(
      [
        `• Devis gratuit, valable ${quote.validityDays} jours à compter de sa date d'émission.`,
        ...(hasRetouche ? ["• Retouches : délai de réalisation d'environ une semaine à compter de la remise des vêtements, sans rendez-vous. Les modalités de dépôt sont indiquées par e-mail."] : []),
        ...(hasSeance ? ["• Les modalités pratiques et de règlement sont précisées lors de la confirmation du rendez-vous.", "• Rendez-vous réservable en ligne, avec annulation ou report possible via le lien reçu par e-mail."] : ["• Les modalités de règlement sont précisées lors de la validation du devis."]),
        "• Conditions générales de vente consultables sur le site.",
      ].join("\n"),
      L, y + 14, { width: W, lineGap: 3 },
    );

    // Bon pour accord
    let by = doc.y + 22;
    if (by > 700) { doc.addPage(); by = 60; }
    doc.roundedRect(L, by, W, 84, 10).lineWidth(1).strokeColor(ACCENT).stroke();
    doc.font("Helvetica-Bold").fontSize(9).fillColor(ACCENT).text("BON POUR ACCORD", L + 16, by + 12);
    doc.font("Helvetica").fontSize(9).fillColor(MUTED).text("Date, mention « Bon pour accord » et signature :", L + 16, by + 28);
    doc.text(hasSeance ? `Pour accepter ce devis, réservez en ligne sur ${quote.siteUrl} ou répondez simplement à l'e-mail.` : "Pour accepter ce devis, répondez simplement à l'e-mail qui l'accompagne.", L + 16, by + 64, { width: W - 32 });

    doc.font("Helvetica").fontSize(8).fillColor(MUTED).text("Aélia · Laësia Laurent · SIRET 106 249 105 00011 · aelia.bylaesia@gmail.com", L, Math.min(by + 100, 765), { width: W, align: "center", lineBreak: false });
    doc.end();
  });
}

module.exports = { buildQuotePdf, eur, dateFr, totalOf };
