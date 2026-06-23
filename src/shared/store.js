const NOTES_KEY = 'quickPromptNotes.notes';
const INDEX_KEY = 'quickPromptNotes.index';
const SETTINGS_KEY = 'quickPromptNotes.settings';

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
  return [note.title, note.body, note.url, note.domain, note.tags?.join(' ')].filter(Boolean).join(' ');
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

async function persistSettings(settings) {
  await storage.set({ [SETTINGS_KEY]: normalizeSettings(settings) });
}

export async function loadData() {
  const data = await storage.get([NOTES_KEY, INDEX_KEY, SETTINGS_KEY]);
  const rawNotes = Array.isArray(data[NOTES_KEY]) ? data[NOTES_KEY] : [];
  const notes = rawNotes.map(normalizeNote);
  const index = data[INDEX_KEY]?.byToken ? data[INDEX_KEY] : buildIndex(notes);
  const settings = normalizeSettings(data[SETTINGS_KEY]);

  if (!data[INDEX_KEY]?.byToken || notesChanged(rawNotes, notes)) {
    await storage.set({ [NOTES_KEY]: notes, [INDEX_KEY]: index });
  }

  return { notes, index, settings };
}

export async function addNote(input) {
  const { notes } = await loadData();
  const now = Date.now();
  const note = normalizeNote({
    id: crypto.randomUUID(),
    title: input.title?.trim() || firstLine(input.body) || 'Untitled note',
    body: input.body?.trim() || '',
    url: input.url?.trim() || '',
    tags: normalizeTags(input.tags),
    createdAt: now,
    updatedAt: now
  });
  const next = [note, ...notes];
  await persist(next);
  return note;
}

export async function updateNote(id, patch) {
  const { notes } = await loadData();
  const next = notes.map((note) => {
    if (note.id !== id) return note;
    return normalizeNote({
      ...note,
      ...patch,
      tags: Object.hasOwn(patch, 'tags') ? normalizeTags(patch.tags) : note.tags,
      updatedAt: Date.now()
    });
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
    .map((note) => normalizeNote({
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

export async function setFavoriteGroup(tag, favorite) {
  const { settings } = await loadData();
  const favorites = new Set(settings.favoriteGroups);

  if (favorite) {
    favorites.add(tag);
  } else {
    favorites.delete(tag);
  }

  const next = { ...settings, favoriteGroups: [...favorites] };
  await persistSettings(next);
  return next;
}

export function groupNotesByTags(notes, favoriteGroups = []) {
  const favorites = new Set(favoriteGroups);
  const groups = new Map();

  for (const note of notes) {
    for (const tag of note.tags || []) {
      if (!groups.has(tag)) {
        const domain = tag === note.domain ? note.domain : '';
        groups.set(tag, {
          tag,
          icon: domain ? note.domainIcon : '',
          isDomain: Boolean(domain || isDomainTag(tag)),
          favorite: favorites.has(tag),
          notes: []
        });
      }

      const group = groups.get(tag);
      group.notes.push(note);
      if (!group.icon && tag === note.domain) group.icon = note.domainIcon;
      if (tag === note.domain) group.isDomain = true;
    }
  }

  return [...groups.values()].sort((a, b) => {
    if (a.favorite !== b.favorite) return a.favorite ? -1 : 1;
    if (a.isDomain !== b.isDomain) return a.isDomain ? -1 : 1;
    return b.notes.length - a.notes.length || a.tag.localeCompare(b.tag);
  });
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

function normalizeNote(note) {
  const candidateUrl = getValidUrl(note.url) || extractFirstUrl([note.title, note.body].join(' '));
  const domain = candidateUrl ? getRootDomain(candidateUrl) : '';
  const tags = normalizeTags(note.tags || []);
  const nextTags = domain && !tags.includes(domain) ? [domain, ...tags].slice(0, 12) : tags;

  return {
    ...note,
    title: String(note.title || firstLine(note.body) || 'Untitled note').trim(),
    body: String(note.body || '').trim(),
    url: candidateUrl || '',
    tags: nextTags,
    domain,
    domainIcon: domain ? iconForDomain(domain) : '',
    createdAt: Number(note.createdAt) || Date.now(),
    updatedAt: Number(note.updatedAt) || Date.now()
  };
}

function normalizeSettings(settings) {
  return {
    favoriteGroups: normalizeTags(settings?.favoriteGroups || [])
  };
}

function notesChanged(before, after) {
  if (before.length !== after.length) return true;
  return after.some((note, index) => {
    const raw = before[index] || {};
    return (
      raw.url !== note.url ||
      raw.domain !== note.domain ||
      raw.domainIcon !== note.domainIcon ||
      raw.title !== note.title ||
      raw.body !== note.body ||
      JSON.stringify(raw.tags || []) !== JSON.stringify(note.tags || [])
    );
  });
}

export function getValidUrl(value) {
  const source = String(value || '').trim();
  if (!source) return '';

  try {
    const url = new URL(source);
    return url.protocol === 'http:' || url.protocol === 'https:' ? url.href : '';
  } catch {
    return '';
  }
}

export function extractFirstUrl(value) {
  const match = String(value || '').match(/https?:\/\/[^\s<>"']+/i);
  return getValidUrl(match?.[0]?.replace(/[),.;]+$/, ''));
}

export function getRootDomain(value) {
  const valid = getValidUrl(value);
  if (!valid) return '';

  const hostname = new URL(valid).hostname.toLowerCase().replace(/^www\./, '');
  if (/^\d{1,3}(\.\d{1,3}){3}$/.test(hostname) || hostname === 'localhost') return hostname;

  const parts = hostname.split('.');
  if (parts.length <= 2) return hostname;

  const secondLevelSuffixes = new Set(['co', 'com', 'edu', 'gov', 'net', 'org']);
  const suffix = parts.at(-1);
  const second = parts.at(-2);
  const count = suffix.length === 2 && secondLevelSuffixes.has(second) ? 3 : 2;
  return parts.slice(-count).join('.');
}

export function iconForDomain(domain) {
  return `https://${domain}/favicon.ico`;
}

function isDomainTag(tag) {
  return /^[a-z0-9-]+(\.[a-z0-9-]+)+$/.test(tag);
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
