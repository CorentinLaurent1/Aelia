// Modèle d'e-mail aux couleurs d'Aélia (styles en ligne : compatible avec les messageries).
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

const ACCENT = "#c4694a";

// rows : [[libellé, valeur]], button : { url, label }
function layout({ base, preheader = "", title, intro = "", rows = [], outro = "", button, note = "" }) {
  const rowsHtml = rows.length
    ? `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:24px 0;background:#f8eee8;border-radius:14px;border-left:4px solid ${ACCENT}">
        ${rows.map(([k, v]) => `<tr><td style="padding:12px 20px 0;font:500 11px Arial,sans-serif;letter-spacing:.14em;text-transform:uppercase;color:#7a6a63">${esc(k)}</td></tr>
        <tr><td style="padding:2px 20px 12px;font:400 17px Georgia,serif;color:#2b2523">${v}</td></tr>`).join("")}
      </table>`
    : "";
  const btn = button
    ? `<p style="margin:28px 0 8px;text-align:center"><a href="${esc(button.url)}" style="display:inline-block;background:${ACCENT};color:#ffffff;text-decoration:none;font:500 14px Arial,sans-serif;letter-spacing:.04em;padding:14px 32px;border-radius:999px">${esc(button.label)}</a></p>`
    : "";
  return `<!DOCTYPE html><html lang="fr"><body style="margin:0;padding:0;background:#f1e2d9">
<span style="display:none;max-height:0;overflow:hidden;opacity:0">${esc(preheader)}</span>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f1e2d9;padding:32px 12px"><tr><td align="center">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;background:#ffffff;border-radius:20px;overflow:hidden">
    <tr><td align="center" style="background:#f8eee8;padding:28px 20px 20px">
      <img src="${esc(base)}/assets/images/logo-aelia.png" width="130" alt="Aélia · Conseil en style et image" style="display:block;height:auto;border:0">
    </td></tr>
    <tr><td style="padding:32px 36px 36px;font:300 15px/1.65 Arial,sans-serif;color:#2b2523">
      <h1 style="margin:0 0 16px;font:400 30px/1.2 Georgia,serif;color:${ACCENT}">${esc(title)}</h1>
      ${intro}
      ${rowsHtml}
      ${outro}
      ${btn}
      ${note ? `<p style="margin:20px 0 0;font:300 12px/1.6 Arial,sans-serif;color:#7a6a63;text-align:center">${note}</p>` : ""}
    </td></tr>
    <tr><td align="center" style="background:#2b2827;padding:20px;font:300 12px/1.6 Arial,sans-serif;color:#d9cfc9">
      Aélia · Laësia Laurent · Saint-Denis-de-l'Hôtel<br>
      <a href="mailto:aelia.bylaesia@gmail.com" style="color:#e8a58b;text-decoration:none">aelia.bylaesia@gmail.com</a>
    </td></tr>
  </table>
</td></tr></table></body></html>`;
}

module.exports = { layout, esc };
