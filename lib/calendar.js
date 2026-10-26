// Accès à l'agenda iCloud (CalDAV). Identifiants : ICLOUD_USER (identifiant Apple) et
// ICLOUD_APP_PASSWORD (mot de passe d'application créé sur appleid.apple.com).
const crypto = require("crypto");
const { createDAVClient } = require("tsdav");
const ical = require("node-ical");

const { ICLOUD_USER, ICLOUD_APP_PASSWORD, ICLOUD_CALENDAR } = process.env;
const configured = () => Boolean(ICLOUD_USER && ICLOUD_APP_PASSWORD);

let clientPromise;
let calendarsCache = { at: 0, list: [] };

function getClient() {
  if (!clientPromise) {
    clientPromise = createDAVClient({
      serverUrl: "https://caldav.icloud.com",
      credentials: { username: ICLOUD_USER, password: ICLOUD_APP_PASSWORD },
      authMethod: "Basic",
      defaultAccountType: "caldav",
    }).catch((e) => { clientPromise = null; throw e; });
  }
  return clientPromise;
}

async function getCalendars() {
  if (Date.now() - calendarsCache.at < 10 * 60e3 && calendarsCache.list.length) return calendarsCache.list;
  const client = await getClient();
  const all = await client.fetchCalendars();
  // seuls les calendriers d'événements (pas les rappels)
  const list = all.filter((c) => !c.components || c.components.includes("VEVENT"));
  calendarsCache = { at: Date.now(), list };
  return list;
}

// Calendrier dans lequel les rendez-vous sont créés : celui nommé dans ICLOUD_CALENDAR, sinon le premier
async function targetCalendar() {
  const list = await getCalendars();
  const name = (ICLOUD_CALENDAR || "").toLowerCase();
  return (name && list.find((c) => String(c.displayName || "").toLowerCase() === name)) || list[0];
}

// Plages occupées sur l'ensemble des calendriers, récurrences comprises
async function getBusy(from, to, { ignoreAllDay = false } = {}) {
  const client = await getClient();
  const calendars = await getCalendars();
  const busy = [];
  for (const calendar of calendars) {
    const objects = await client.fetchCalendarObjects({
      calendar,
      timeRange: { start: from.toISOString(), end: to.toISOString() },
    });
    for (const o of objects) busy.push(...busyFromICS(o.data, from, to, ignoreAllDay));
  }
  return busy;
}

function busyFromICS(data, from, to, ignoreAllDay) {
  if (!data) return [];
  const out = [];
  const parsed = ical.sync.parseICS(data);
  for (const ev of Object.values(parsed)) {
    if (ev.type !== "VEVENT") continue;
    if (ev.status === "CANCELLED" || ev.transparency === "TRANSPARENT") continue;
    if (ev.datetype === "date" && ignoreAllDay) continue;
    const instances = ev.rrule || ev.recurrences
      ? ical.expandRecurringEvent(ev, { from, to, includeOverrides: true, excludeExdates: true })
      : [{ start: ev.start, end: ev.end }];
    for (const i of instances) {
      if (!i.start) continue;
      const end = i.end || new Date(new Date(i.start).getTime() + 3600e3);
      out.push({ start: new Date(i.start), end: new Date(end), uid: ev.uid });
    }
  }
  return out;
}

const fmtICS = (d) => d.toISOString().replace(/[-:]|\.\d{3}/g, "");
const escICS = (s) => String(s).replace(/\\/g, "\\\\").replace(/;/g, "\\;").replace(/,/g, "\\,").replace(/\r?\n/g, "\\n");

function buildICS({ uid, start, end, summary, description, location }) {
  return [
    "BEGIN:VCALENDAR", "VERSION:2.0", "PRODID:-//Aelia//Reservation//FR", "CALSCALE:GREGORIAN", "METHOD:PUBLISH",
    "BEGIN:VEVENT",
    `UID:${uid}`, `DTSTAMP:${fmtICS(new Date())}`, `DTSTART:${fmtICS(start)}`, `DTEND:${fmtICS(end)}`,
    `SUMMARY:${escICS(summary)}`, `DESCRIPTION:${escICS(description)}`,
    ...(location ? [`LOCATION:${escICS(location)}`] : []),
    "BEGIN:VALARM", "TRIGGER:-PT1H", "ACTION:DISPLAY", "DESCRIPTION:Rendez-vous Aélia", "END:VALARM",
    "END:VEVENT", "END:VCALENDAR",
  ].join("\r\n");
}

async function createEvent({ start, end, summary, description, location }) {
  const client = await getClient();
  const calendar = await targetCalendar();
  const uid = `${crypto.randomUUID()}@aelia`;
  const ics = buildICS({ uid, start, end, summary, description, location });
  const res = await client.createCalendarObject({ calendar, filename: `${uid}.ics`, iCalString: ics });
  if (res && res.ok === false) throw new Error(`CalDAV ${res.status}`);
  return { uid, ics };
}

async function eventExists(uid) {
  const client = await getClient();
  const calendar = await targetCalendar();
  const base = calendar.url.endsWith("/") ? calendar.url : calendar.url + "/";
  const found = await client.fetchCalendarObjects({ calendar, objectUrls: [new URL(`${uid}.ics`, base).href] });
  return found.length > 0;
}

async function deleteEvent(uid) {
  const client = await getClient();
  const calendar = await targetCalendar();
  const base = calendar.url.endsWith("/") ? calendar.url : calendar.url + "/";
  const url = new URL(`${uid}.ics`, base).href;
  const found = await client.fetchCalendarObjects({ calendar, objectUrls: [url] });
  if (!found.length) return false; // déjà supprimé
  const res = await client.deleteCalendarObject({ calendarObject: { url: found[0].url, etag: found[0].etag } });
  if (res && res.ok === false && res.status !== 404) throw new Error(`CalDAV ${res.status}`);
  return true;
}

module.exports = { configured, getBusy, createEvent, deleteEvent, eventExists, buildICS, busyFromICS };
