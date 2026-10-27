// Base de données Postgres (Neon via Vercel) : suivi des demandes de devis et de leurs photos.
// Variable : DATABASE_URL (ou POSTGRES_URL), ajoutée automatiquement par l'intégration Neon de Vercel.
const { Pool } = require("pg");

const url = () => process.env.DATABASE_URL || process.env.POSTGRES_URL;
let pool = null;
let ready = null;

const STATUSES = ["nouvelle", "devis_envoye", "accepte", "en_cours", "rendu", "refuse"];

const SCHEMA = [
  `CREATE TABLE IF NOT EXISTS quotes (
    id SERIAL PRIMARY KEY,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    type TEXT NOT NULL,
    name TEXT NOT NULL,
    email TEXT NOT NULL,
    phone TEXT NOT NULL DEFAULT '',
    message TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'nouvelle',
    amount NUMERIC(10,2),
    note TEXT NOT NULL DEFAULT '',
    due_at TIMESTAMPTZ,
    delivered_at TIMESTAMPTZ
  )`,
  `CREATE TABLE IF NOT EXISTS quote_photos (
    id SERIAL PRIMARY KEY,
    quote_id INTEGER NOT NULL REFERENCES quotes(id) ON DELETE CASCADE,
    filename TEXT NOT NULL,
    content_type TEXT NOT NULL,
    data BYTEA NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS quote_documents (
    id SERIAL PRIMARY KEY,
    quote_id INTEGER NOT NULL REFERENCES quotes(id) ON DELETE CASCADE,
    number TEXT NOT NULL UNIQUE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    valid_until TIMESTAMPTZ NOT NULL,
    validity_days INTEGER NOT NULL DEFAULT 30,
    lines TEXT NOT NULL,
    intro TEXT NOT NULL DEFAULT '',
    total NUMERIC(10,2) NOT NULL,
    sent_at TIMESTAMPTZ
  )`,
];

const enabled = () => Boolean(pool || url());

function getPool() {
  if (!pool) pool = new Pool({ connectionString: url(), max: 3, idleTimeoutMillis: 10000 });
  return pool;
}

// Pour les tests : injecter un faux Postgres
function setPool(p) { pool = p; ready = null; }

async function init() {
  if (!ready) {
    ready = (async () => { for (const sql of SCHEMA) await getPool().query(sql); })().catch((e) => { ready = null; throw e; });
  }
  return ready;
}

async function query(text, params) {
  await init();
  return getPool().query(text, params);
}

const refOf = (id) => `D-${String(id).padStart(4, "0")}`;

async function insertQuote(q, photos) {
  const { rows } = await query(
    "INSERT INTO quotes (type, name, email, phone, message) VALUES ($1, $2, $3, $4, $5) RETURNING id",
    [q.type, q.name, q.email, q.phone, q.msg],
  );
  const id = rows[0].id;
  for (const p of photos) {
    await query("INSERT INTO quote_photos (quote_id, filename, content_type, data) VALUES ($1, $2, $3, $4)", [id, p.filename, p.contentType, "\\x" + p.content.toString("hex")]);
  }
  return id;
}

async function photoCounts() {
  const { rows } = await query("SELECT quote_id, count(*) AS n FROM quote_photos GROUP BY quote_id");
  return new Map(rows.map((r) => [Number(r.quote_id), Number(r.n)]));
}

async function listQuotes(status) {
  const where = STATUSES.includes(status) ? "WHERE status = $1" : "";
  const { rows } = await query(
    `SELECT id, created_at, type, name, email, phone, status, amount, due_at, delivered_at, note, message FROM quotes ${where} ORDER BY created_at DESC LIMIT 300`,
    where ? [status] : [],
  );
  const photos = await photoCounts();
  // extrait calculé ici (portable) plutôt qu'en SQL
  return rows.map(({ message, ...r }) => ({ ...r, amount: r.amount === null ? null : Number(r.amount), excerpt: String(message || "").slice(0, 160), photos: photos.get(r.id) || 0 }));
}

async function getQuote(id) {
  const { rows } = await query("SELECT * FROM quotes WHERE id = $1", [id]);
  if (!rows.length) return null;
  const photoList = (await query("SELECT id, filename FROM quote_photos WHERE quote_id = $1 ORDER BY id", [id])).rows;
  const q = rows[0];
  return { ...q, amount: q.amount === null ? null : Number(q.amount), photos: photoList.length, photo_list: photoList };
}

async function updateQuote(id, { status, amount, note }) {
  const cur = await getQuote(id);
  if (!cur) return null;
  const newStatus = STATUSES.includes(status) ? status : cur.status;
  const newAmount = amount === "" || amount === null || amount === undefined ? null : Number(amount);
  if (newAmount !== null && (!Number.isFinite(newAmount) || newAmount < 0 || newAmount > 100000)) throw new Error("Montant invalide");
  const newNote = String(note ?? cur.note).slice(0, 4000);
  // échéance d'une retouche : 7 jours après acceptation ; date de rendu enregistrée automatiquement
  const dueAt = cur.due_at || (cur.type === "retouche" && ["accepte", "en_cours"].includes(newStatus) ? new Date(Date.now() + 7 * 864e5) : null);
  const deliveredAt = newStatus === "rendu" ? (cur.delivered_at || new Date()) : null;
  await query(
    "UPDATE quotes SET status = $2, amount = $3, note = $4, due_at = $5, delivered_at = $6, updated_at = now() WHERE id = $1",
    [id, newStatus, newAmount, newNote, dueAt, deliveredAt],
  );
  return getQuote(id);
}

async function deleteQuote(id) {
  const r = await query("DELETE FROM quotes WHERE id = $1", [id]);
  return r.rowCount > 0;
}

async function getPhoto(id) {
  const { rows } = await query("SELECT filename, content_type, data FROM quote_photos WHERE id = $1", [id]);
  return rows[0] || null;
}

async function counts() {
  const { rows } = await query("SELECT status, count(*)::int AS n FROM quotes GROUP BY status");
  const out = Object.fromEntries(STATUSES.map((s) => [s, 0]));
  for (const r of rows) out[r.status] = Number(r.n);
  return out;
}

// Chiffre d'affaires des retouches/devis rendus sur la période
async function deliveredAmount(from, to) {
  const { rows } = await query("SELECT COALESCE(SUM(amount), 0)::float AS total FROM quotes WHERE status = 'rendu' AND delivered_at >= $1 AND delivered_at < $2", [from, to]);
  return Number(rows[0].total);
}

// Devis émis depuis le tableau de bord : numérotation continue par année (DEV-2026-0001, 0002…)
async function createDocument(quoteId, { lines, intro, validityDays }) {
  const year = new Date().getFullYear();
  const { rows } = await query("SELECT number FROM quote_documents");
  const last = rows.map((r) => r.number).filter((n) => n.startsWith(`DEV-${year}-`)).map((n) => Number(n.split("-")[2])).reduce((a, b) => Math.max(a, b), 0);
  const number = `DEV-${year}-${String(last + 1).padStart(4, "0")}`;
  const total = lines.reduce((s, l) => s + l.qty * l.unit, 0);
  const validUntil = new Date(Date.now() + validityDays * 864e5);
  const ins = await query(
    "INSERT INTO quote_documents (quote_id, number, valid_until, validity_days, lines, intro, total) VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING id",
    [quoteId, number, validUntil, validityDays, JSON.stringify(lines), intro, total],
  );
  return getDocument(ins.rows[0].id);
}

const parseDoc = (r) => ({ ...r, total: Number(r.total), lines: JSON.parse(r.lines) });

async function getDocument(id) {
  const { rows } = await query("SELECT * FROM quote_documents WHERE id = $1", [id]);
  return rows.length ? parseDoc(rows[0]) : null;
}

async function listDocuments(quoteId) {
  const { rows } = await query("SELECT * FROM quote_documents WHERE quote_id = $1 ORDER BY id DESC", [quoteId]);
  return rows.map(parseDoc);
}

async function markDocumentSent(id) {
  await query("UPDATE quote_documents SET sent_at = now() WHERE id = $1", [id]);
}

module.exports = { createDocument, getDocument, listDocuments, markDocumentSent, enabled, setPool, query, refOf, insertQuote, listQuotes, getQuote, updateQuote, deleteQuote, getPhoto, counts, deliveredAmount, STATUSES };
