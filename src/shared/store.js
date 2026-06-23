const NOTES_KEY = 'quickPromptNotes.notes';
const INDEX_KEY = 'quickPromptNotes.index';

const STOP_WORDS = new Set([
  'a',
  'an',
  'and',
  'as',
  'at',
  'be',
  'by',
  'for',
  'from',
  'in',
  'is',
  'it',
  'of',
  'on',
  'or',
  'the',
  'to',
  'with'
]);

const storage = (() => {
  const api = globalThis.browser?.storage?.local || globalThis.chrome?.storage?.local;

  if (!api) {
    const memory = new Map();
    return {
      async get(keys) {
        const list = Array.isArray(keys) ? keys : [keys];
        return Object.fromEntries(list.map((key) => [key, memory.get(key)]));
      },
      async set(values) {
        Object.entries(values).forEach(([key, value]) => memory.set(key, value));
      }
    };
  }

  if (globalThis.browser?.storage?.local) {
    return api;
  }

  return {
    get(keys) {
      return new Promise((resolve) => api.get(keys, resolve));
    },
    set(values) {
      return new Promise((resolve) => api.set(values, resolve));
    }
  };
})();

export function tokenize(value) {
  return String(value || '')
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .match(/[a-z0-9][a-z0-9._:/-]{1,}/g)
    ?.filter((token) => token.length > 1 && !STOP_WORDS.has(token))
    .slice(0, 96) || [];
}

function noteText(note) {
  return [note.title, note.body, note.url, note.tags?.join(' ')].filter(Boolean).join(' ');
}

function uniqueTokens(values) {
  return [...new Set(values.flatMap((value) => tokenize(value)))];
}

export function buildIndex(notes) {
  const byToken = {};
  const byId = {};

  for (const note of notes) {
    const fields = {
      title: uniqueTokens([note.title]),
      body: uniqueTokens([note.body]),
      url: uniqueTokens([note.url]),
      tags: uniqueTokens(note.tags || [])
    };
    const all = [...new Set(Object.values(fields).flat())];
    byId[note.id] = fields;

    for (const token of all) {
      if (!byToken[token]) byToken[token] = [];
      byToken[token].push(note.id);
    }
  }

  return { byToken, byId, updatedAt: Date.now() };
}

async function persist(notes) {
  await storage.set({
    [NOTES_KEY]: notes,
    [INDEX_KEY]: buildIndex(notes)
  });
}

export async function loadData() {
  const data = await storage.get([NOTES_KEY, INDEX_KEY]);
  const notes = Array.isArray(data[NOTES_KEY]) ? data[NOTES_KEY] : [];
  const index = data[INDEX_KEY]?.byToken ? data[INDEX_KEY] : buildIndex(notes);

  if (!data[INDEX_KEY]?.byToken) {
    await storage.set({ [INDEX_KEY]: index });
  }

  return { notes, index };
}

export async function addNote(input) {
  const { notes } = await loadData();
  const now = Date.now();
  const note = {
    id: crypto.randomUUID(),
    title: input.title?.trim() || firstLine(input.body) || 'Untitled note',
    body: input.body?.trim() || '',
    url: input.url?.trim() || '',
    tags: normalizeTags(input.tags),
    createdAt: now,
    updatedAt: now
  };
  const next = [note, ...notes];
  await persist(next);
  return note;
}

export async function updateNote(id, patch) {
  const { notes } = await loadData();
  const next = notes.map((note) => {
    if (note.id !== id) return note;
    return {
      ...note,
      ...patch,
      tags: Object.hasOwn(patch, 'tags') ? normalizeTags(patch.tags) : note.tags,
      updatedAt: Date.now()
    };
  });
  await persist(next);
  return next.find((note) => note.id === id);
}

export async function deleteNote(id) {
  const { notes } = await loadData();
  const next = notes.filter((note) => note.id !== id);
  await persist(next);
}

export async function replaceNotes(notes) {
  const normalized = notes
    .filter((note) => note && (note.body || note.title || note.url))
    .map((note) => ({
      id: note.id || crypto.randomUUID(),
      title: String(note.title || firstLine(note.body) || 'Untitled note').trim(),
      body: String(note.body || '').trim(),
      url: String(note.url || '').trim(),
      tags: normalizeTags(note.tags || []),
      createdAt: Number(note.createdAt) || Date.now(),
      updatedAt: Number(note.updatedAt) || Date.now()
    }));

  await persist(normalized);
  return normalized;
}

export function searchNotes(notes, index, query, limit = 24) {
  const terms = tokenize(query);
  if (!terms.length) {
    return [...notes]
      .sort((a, b) => b.updatedAt - a.updatedAt)
      .slice(0, limit);
  }

  const candidateIds = collectCandidates(index.byToken || {}, terms);
  const candidates = candidateIds.size
    ? notes.filter((note) => candidateIds.has(note.id))
    : notes.filter((note) => noteText(note).toLowerCase().includes(query.toLowerCase()));

  return candidates
    .map((note) => ({ note, score: scoreNote(note, index.byId?.[note.id], terms, query) }))
    .filter((item) => item.score > 0)
    .sort((a, b) => b.score - a.score || b.note.updatedAt - a.note.updatedAt)
    .slice(0, limit)
    .map((item) => item.note);
}

function collectCandidates(byToken, terms) {
  const sets = terms
    .map((term) => new Set(byToken[term] || []))
    .filter((set) => set.size);

  if (!sets.length) return new Set();

  sets.sort((a, b) => a.size - b.size);
  let result = sets[0];
  for (const set of sets.slice(1)) {
    result = new Set([...result].filter((id) => set.has(id)));
    if (!result.size) break;
  }

  return result.size ? result : new Set(sets.flatMap((set) => [...set]));
}

function scoreNote(note, fields, terms, rawQuery) {
  const haystack = noteText(note).toLowerCase();
  let score = haystack.includes(rawQuery.toLowerCase()) ? 20 : 0;

  for (const term of terms) {
    if (fields?.title?.includes(term)) score += 9;
    if (fields?.tags?.includes(term)) score += 8;
    if (fields?.url?.includes(term)) score += 6;
    if (fields?.body?.includes(term)) score += 3;
    if (haystack.includes(term)) score += 1;
  }

  const ageDays = Math.max(0, (Date.now() - note.updatedAt) / 86400000);
  return score + Math.max(0, 4 - ageDays * 0.05);
}

function normalizeTags(tags) {
  const source = Array.isArray(tags) ? tags.join(',') : String(tags || '');
  return [...new Set(source.split(/[,\s#]+/).map((tag) => tag.trim().toLowerCase()).filter(Boolean))].slice(0, 12);
}

function firstLine(value) {
  return String(value || '').split(/\r?\n/).find((line) => line.trim())?.trim().slice(0, 80);
}

export async function getActiveTab() {
  const tabsApi = globalThis.browser?.tabs || globalThis.chrome?.tabs;
  if (!tabsApi?.query) return null;

  if (globalThis.browser?.tabs) {
    const [tab] = await tabsApi.query({ active: true, currentWindow: true });
    return tab || null;
  }

  return new Promise((resolve) => {
    tabsApi.query({ active: true, currentWindow: true }, ([tab]) => resolve(tab || null));
  });
}
