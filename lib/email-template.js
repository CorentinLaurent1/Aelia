// Modèle d'e-mail aux couleurs d'Aélia (styles en ligne : compatible avec les messageries).
// compose() construit à la fois la version HTML et la version texte brut à partir des mêmes éléments.
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const br = (s) => esc(s).replace(/\r?\n/g, "<br>");

const ACCENT = "#a24428";
const BRAND = "#c4694a";
const SERIF = "Georgia,'Times New Roman',serif";
const SANS = "Helvetica,Arial,sans-serif";

const SIGNATURE = { name: "Laësia Laurent", role: "Conseillère en style et en image", phone: "07 69 02 87 87", email: "aelia.bylaesia@gmail.com" };
const LEGAL = "Aélia · Laësia Laurent, entrepreneure individuelle · SIRET 106 249 105 00011 · 57 rue Saint Nicolas, 45550 Saint-Denis-de-l'Hôtel";

// paras : textes simples (une chaîne par paragraphe) ; rows : [[libellé, valeur]] en texte simple
function compose({ base, eyebrow = "", title, preheader = "", paras = [], rows = [], after = [], button, note = "", signoff = true, reason = "" }) {
  const para = (t) => `<p style="margin:0 0 14px;font:300 15px/1.7 ${SANS};color:#2b2523">${br(t)}</p>`;
  const rowsHtml = rows.length
    ? `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:22px 0;background:#f8eee8;border-radius:14px;border-left:4px solid ${BRAND}">${rows.map(([k, v], i) => `
        <tr><td style="padding:${i === 0 ? 16 : 10}px 20px 0;font:500 11px ${SANS};letter-spacing:.14em;text-transform:uppercase;color:#6b5a53">${esc(k)}</td></tr>
        <tr><td style="padding:2px 20px ${i === rows.length - 1 ? 16 : 6}px;font:400 17px/1.4 ${SERIF};color:#2b2523">${br(v)}</td></tr>`).join("")}
      </table>`
    : "";
  const btn = button
    ? `<p style="margin:26px 0 6px;text-align:center"><a href="${esc(button.url)}" style="display:inline-block;background:${ACCENT};color:#ffffff;text-decoration:none;font:500 14px ${SANS};letter-spacing:.04em;padding:14px 32px;border-radius:999px">${esc(button.label)}</a></p>`
    : "";
  const sign = signoff
    ? `<p style="margin:26px 0 0;font:300 15px/1.7 ${SANS};color:#2b2523">Bien cordialement,</p>
       <p style="margin:6px 0 0;font:400 20px ${SERIF};color:${ACCENT}">${esc(SIGNATURE.name)}</p>
       <p style="margin:0;font:300 13px/1.6 ${SANS};color:#6b5a53">${esc(SIGNATURE.role)}<br>${esc(SIGNATURE.phone)} · <a href="mailto:${SIGNATURE.email}" style="color:${ACCENT}">${esc(SIGNATURE.email)}</a></p>`
    : "";

  const html = `<!DOCTYPE html><html lang="fr"><body style="margin:0;padding:0;background:#f1e2d9">
<span style="display:none;max-height:0;overflow:hidden;opacity:0;color:transparent">${esc(preheader)}</span>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f1e2d9;padding:28px 12px"><tr><td align="center">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:580px;background:#ffffff;border-radius:20px;overflow:hidden">
    <tr><td align="center" style="background:#f8eee8;padding:26px 20px 18px;border-bottom:3px solid ${BRAND}">
      <img src="${esc(base)}/assets/images/logo-aelia.png" width="120" alt="Aélia · Conseil en style et image" style="display:block;height:auto;border:0">
    </td></tr>
    <tr><td style="padding:30px 36px 34px">
      ${eyebrow ? `<p style="margin:0 0 8px;font:500 11px ${SANS};letter-spacing:.2em;text-transform:uppercase;color:${ACCENT}">${esc(eyebrow)}</p>` : ""}
      <h1 style="margin:0 0 18px;font:400 28px/1.2 ${SERIF};color:#2b2523">${esc(title)}</h1>
      ${paras.map(para).join("")}
      ${rowsHtml}
      ${after.map(para).join("")}
      ${btn}
      ${note ? `<p style="margin:14px 0 0;font:300 12px/1.6 ${SANS};color:#6b5a53;text-align:center">${br(note)}</p>` : ""}
      ${sign}
    </td></tr>
    <tr><td align="center" style="background:#2b2827;padding:20px 24px;font:300 11px/1.7 ${SANS};color:#d9cfc9">
      ${esc(LEGAL)}<br>
      ${reason ? esc(reason) : "Cet e-mail est un message de service lié à votre demande sur le site d'Aélia."}
    </td></tr>
  </table>
</td></tr></table></body></html>`;

  const text = [
    title.toUpperCase(),
    "",
    ...paras.flatMap((p) => [p, ""]),
    ...rows.map(([k, v]) => `${k} : ${String(v).replace(/\r?\n/g, " ")}`),
    ...(rows.length ? [""] : []),
    ...after.flatMap((p) => [p, ""]),
    ...(button ? [`${button.label} : ${button.url}`, ""] : []),
    ...(note ? [note, ""] : []),
    ...(signoff ? ["Bien cordialement,", SIGNATURE.name, `${SIGNATURE.role}`, `${SIGNATURE.phone} · ${SIGNATURE.email}`, ""] : []),
    "--",
    LEGAL,
  ].join("\n");

  return { html, text };
}

module.exports = { compose, esc };
