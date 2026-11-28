import { contentHash } from "./scan.js";

const DAY = 86_400_000;

export function dayOffset(baseline, days) {
  const date = new Date(Date.parse(`${baseline}T00:00:00Z`) + days * DAY);
  return Number.isFinite(date.getTime()) ? date.toISOString().slice(0, 10) : undefined;
}

export function localToday(now = new Date()) {
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
}

const SCORES = new Set([0, 2, 4, 5]);

export function noteCards(note) {
  const lines = note.body.split("\n");
  const cards = [];
  let order = 0;
  for (let index = 0; index < lines.length; index++) {
    const text = lines[index].trim();
    if (!text) continue;
    const single = /^(.+?)\s+::\s+(.+)$/.exec(text);
    if (single) {
      cards.push({ question: single[1].trim(), answer: single[2].trim(), index: order++ });
      continue;
    }
    if (lines[index + 1]?.trim() === "?" && lines[index + 2]?.trim()) {
      let end = index + 2;
      while (lines[end]?.trim()) end++;
      cards.push({ question: text, answer: lines.slice(index + 2, end).join("\n").trim(), index: order++ });
      index = end - 1;
      continue;
    }
    if (note.tags.includes("flashcard")) {
      for (const match of text.matchAll(/==([^=\n]+)==/g)) {
        const question = text.slice(0, match.index) + "［…］" + text.slice(match.index + match[0].length);
        // The omitted phrase is included in the identity so edits reset this card.
        cards.push({ question, answer: match[1].trim(), identity: text, index: order++ });
      }
    }
  }
  return cards;
}

export async function buildCards(notes, hash = contentHash) {
  const cards = [];
  for (const note of notes) {
    const unique = new Set();
    const batch = [];
    for (const { question, answer, identity, index } of noteCards(note)) {
      const key = `${note.path}\0${identity ?? question}${identity ? `\0${index}` : ""}`;
      if (unique.has(key)) continue;
      unique.add(key);
      batch.push({ path: note.path, name: note.name, question, answer, key });
    }
    for (let i = 0; i < batch.length; i += 32) {
      const next = await Promise.all(batch.slice(i, i + 32).map(async ({ key, ...card }) => ({ ...card, id: await hash(key) })));
      cards.push(...next);
    }
  }
  return cards;
}

export function scheduleCard(previous, quality, today = localToday()) {
  if (!SCORES.has(quality)) throw new Error("评分超出范围");
  const oldEase = previous?.ease ?? 2.5;
  const missing = 5 - quality;
  const ease = Math.max(1.3, Number((oldEase + 0.1 - missing * (0.08 + missing * 0.02)).toFixed(2)));
  const repetitions = quality < 3 ? 0 : (previous?.repetitions ?? 0) + 1;
  const interval = repetitions <= 1 ? 1 : repetitions === 2 ? 6 : Math.max(1, Math.round((previous?.interval ?? 1) * ease));
  return {
    ease, repetitions, interval,
    due: dayOffset(today, interval), reviewed: today,
    version: (previous?.version ?? 0) + 1,
  };
}

export function recordRating(records, id, version, quality, today = localToday()) {
  const previous = Object.hasOwn(records, id) ? records[id] : undefined;
  if ((previous?.version ?? 0) !== version || (previous?.due && previous.due > today)) {
    return { records, updated: false };
  }
  return { records: { ...records, [id]: scheduleCard(previous, quality, today) }, updated: true };
}

export function pruneReviews(records, cards) {
  const active = new Set(cards.map(({ id }) => id));
  return Object.fromEntries(Object.entries(records).filter(([id]) => active.has(id)));
}

export function reviewQueue(cards, records, today = localToday(), daysReviewed = []) {
  const previous = cards.map((card) => records[card.id]).filter(Boolean);
  const queue = cards.filter(({ id }) => !records[id] || records[id].due <= today)
    .sort((a, b) => (records[a.id]?.due ?? today).localeCompare(records[b.id]?.due ?? today));
  const counts = new Map();
  for (const record of previous) counts.set(record.due, (counts.get(record.due) ?? 0) + 1);
  const upcoming = Array.from({ length: 7 }, (_, i) => {
    const date = dayOffset(today, i + 1);
    return { date, count: counts.get(date) ?? 0 };
  });
  const dates = new Set([...daysReviewed, ...previous.map(({ reviewed }) => reviewed)]);
  let streak = 0;
  for (let date = dates.has(today) ? today : dayOffset(today, -1); dates.has(date); date = dayOffset(date, -1)) streak++;
  return {
    due: queue.length, reviewedToday: previous.filter(({ reviewed }) => reviewed === today).length, upcoming, streak,
    next: queue[0] ? { ...queue[0], version: records[queue[0].id]?.version ?? 0 } : null,
  };
}
