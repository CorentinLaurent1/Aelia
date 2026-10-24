const { DateTime } = require("luxon");

// Calcule les créneaux libres d'une prestation entre deux dates (incluses, format YYYY-MM-DD).
// busy : [{ start: Date, end: Date }] issus de l'agenda. Retourne { "YYYY-MM-DD": ["ISO UTC", ...] }.
function computeSlots({ minutes, from, to, busy, cfg, now = DateTime.now() }) {
  const zone = cfg.timezone;
  const earliest = now.plus({ hours: cfg.minNoticeHours });
  const latest = now.setZone(zone).startOf("day").plus({ days: cfg.horizonDays });
  const buffer = cfg.bufferMinutes * 60e3;
  const busyMs = busy.map((b) => [b.start.getTime() - buffer, b.end.getTime() + buffer]);
  const out = {};

  let day = DateTime.fromISO(from, { zone }).startOf("day");
  const last = DateTime.fromISO(to, { zone }).startOf("day");
  for (; day <= last; day = day.plus({ days: 1 })) {
    const key = day.toISODate();
    if (day >= latest || cfg.closedDates.includes(key)) continue;
    const ranges = cfg.weekly[String(day.weekday)] || [];
    const slots = [];
    for (const [open, close] of ranges) {
      const [oh, om] = open.split(":").map(Number);
      const [ch, cm] = close.split(":").map(Number);
      const windowEnd = day.set({ hour: ch, minute: cm });
      for (let s = day.set({ hour: oh, minute: om }); s.plus({ minutes }) <= windowEnd; s = s.plus({ minutes: cfg.slotStepMinutes })) {
        const e = s.plus({ minutes });
        if (s < earliest) continue;
        const a = s.toMillis(), b = e.toMillis();
        if (busyMs.some(([bs, be]) => a < be && b > bs)) continue;
        slots.push(s.toUTC().toISO());
      }
    }
    if (slots.length) out[key] = slots;
  }
  return out;
}

module.exports = { computeSlots };
