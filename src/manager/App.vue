<script setup>
import { computed, onMounted, reactive, ref, watch } from 'vue';
import {
  addNote,
  deleteNote,
  extractFirstUrl,
  getRootDomain,
  groupNotesByTags,
  iconForDomain,
  loadData,
  replaceNotes,
  searchNotes,
  setFavoriteGroup,
  updateNote
} from '../shared/store.js';

const notes = ref([]);
const index = ref({ byToken: {}, byId: {} });
const settings = ref({ favoriteGroups: [] });
const query = ref('');
const selectedId = ref('');
const selectedGroup = ref('');
const status = ref('');
const view = ref('notes');
const editor = reactive({ title: '', body: '', url: '', tags: '' });

const filtered = computed(() => searchNotes(notes.value, index.value, query.value, 200));
const tagGroups = computed(() => groupNotesByTags(filtered.value, settings.value.favoriteGroups));
const listedNotes = computed(() => {
  if (view.value !== 'tags' || !selectedGroup.value) return filtered.value;
  return filtered.value.filter((note) => note.tags?.includes(selectedGroup.value));
});
const selected = computed(() => notes.value.find((note) => note.id === selectedId.value));
const editorDomain = computed(() => getRootDomain(editor.url));
const editorDomainIcon = computed(() => (editorDomain.value ? iconForDomain(editorDomain.value) : ''));

onMounted(refresh);

watch(selected, (note) => {
  editor.title = note?.title || '';
  editor.body = note?.body || '';
  editor.url = note?.url || '';
  editor.tags = note?.tags?.join(' ') || '';
});

watch(() => [editor.url, editor.body], syncUrlDefaults);

async function refresh() {
  const data = await loadData();
  notes.value = data.notes;
  index.value = data.index;
  settings.value = data.settings;
  if (!selectedId.value && notes.value.length) selectedId.value = notes.value[0].id;
}

async function createNote() {
  const note = await addNote({ title: 'New note', body: '', url: '', tags: '' });
  await refresh();
  selectedId.value = note.id;
}

async function saveSelected() {
  if (!selectedId.value) return;
  await updateNote(selectedId.value, {
    title: editor.title,
    body: editor.body,
    url: editor.url,
    tags: editor.tags
  });
  status.value = 'Saved';
  await refresh();
  setTimeout(() => {
    if (status.value === 'Saved') status.value = '';
  }, 1200);
}

async function removeSelected() {
  if (!selectedId.value) return;
  await deleteNote(selectedId.value);
  selectedId.value = '';
  await refresh();
}

async function toggleFavoriteGroup(group) {
  settings.value = await setFavoriteGroup(group.tag, !group.favorite);
}

function selectGroup(group) {
  selectedGroup.value = group.tag;
  const first = group.notes[0];
  if (first) selectedId.value = first.id;
}

function exportNotes() {
  const blob = new Blob([JSON.stringify(notes.value, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = `quick-prompt-notes-${new Date().toISOString().slice(0, 10)}.json`;
  link.click();
  URL.revokeObjectURL(url);
}

async function importNotes(event) {
  const file = event.target.files?.[0];
  if (!file) return;
  try {
    const imported = JSON.parse(await file.text());
    await replaceNotes(Array.isArray(imported) ? imported : imported.notes || []);
    selectedId.value = '';
    await refresh();
    status.value = 'Imported';
  } catch {
    status.value = 'Import failed';
  } finally {
    event.target.value = '';
  }
}

function formatDate(value) {
  return new Intl.DateTimeFormat(undefined, {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit'
  }).format(new Date(value));
}

function syncUrlDefaults() {
  const validUrl = editor.url || extractFirstUrl(editor.body);
  if (!editor.url && validUrl) editor.url = validUrl;

  const domain = getRootDomain(validUrl);
  if (!domain) return;

  const current = editor.tags.split(/\s+/).filter(Boolean);
  if (!current.includes(domain)) {
    editor.tags = [domain, ...current].join(' ');
  }
}
</script>

<template>
  <main class="manager-shell">
    <aside class="sidebar">
      <header class="sidebar-head">
        <div>
          <h1>Vivlos Notes</h1>
          <p>{{ notes.length }} notes indexed locally</p>
        </div>
        <button class="primary" type="button" @click="createNote">New</button>
      </header>

      <div class="view-tabs" role="tablist" aria-label="Manager views">
        <button type="button" :class="{ active: view === 'notes' }" @click="view = 'notes'">Notes</button>
        <button type="button" :class="{ active: view === 'tags' }" @click="view = 'tags'">Tags</button>
      </div>

      <input v-model="query" class="manager-search" type="search" placeholder="Search by term, URL, tag" />

      <section v-if="view === 'tags'" class="group-list" aria-label="Tag groups">
        <article
          v-for="group in tagGroups"
          :key="group.tag"
          class="group-row"
          :class="{ active: group.tag === selectedGroup, favorite: group.favorite }"
        >
          <button class="group-main" type="button" @click="selectGroup(group)">
            <img v-if="group.icon" :src="group.icon" alt="" @error="$event.target.style.display = 'none'" />
            <span v-else class="tag-dot">#</span>
            <strong>{{ group.tag }}</strong>
            <small>{{ group.notes.length }} notes</small>
          </button>
          <button class="favorite-button" type="button" :title="group.favorite ? 'Unfavorite group' : 'Favorite group'" @click="toggleFavoriteGroup(group)">
            {{ group.favorite ? '★' : '☆' }}
          </button>
        </article>
        <p v-if="!tagGroups.length" class="empty">No tag groups found</p>
      </section>

      <section class="note-list" aria-label="Notes">
        <button
          v-for="note in listedNotes"
          :key="note.id"
          class="note-row"
          :class="{ active: note.id === selectedId }"
          type="button"
          @click="selectedId = note.id"
        >
          <strong>{{ note.title }}</strong>
          <span>{{ note.body || note.url || 'Empty note' }}</span>
          <span v-if="note.domain" class="domain-chip">
            <img :src="note.domainIcon" alt="" @error="$event.target.style.display = 'none'" />
            {{ note.domain }}
          </span>
          <small>{{ formatDate(note.updatedAt) }}</small>
        </button>
        <p v-if="!listedNotes.length" class="empty">No notes found</p>
      </section>
    </aside>

    <section class="editor" aria-label="Selected note">
      <header class="editor-toolbar">
        <div class="toolbar-group">
          <button class="secondary" type="button" @click="exportNotes">Export</button>
          <label class="secondary import-button">
            Import
            <input type="file" accept="application/json" @change="importNotes" />
          </label>
        </div>
        <span class="muted">{{ status }}</span>
      </header>

      <form v-if="selected" class="editor-form" @submit.prevent="saveSelected">
        <input v-model="editor.title" class="title-input" placeholder="Title" />
        <input v-model="editor.url" type="url" placeholder="URL" />
        <div v-if="editorDomain" class="domain-preview">
          <img :src="editorDomainIcon" alt="" @error="$event.target.style.display = 'none'" />
          <span>{{ editorDomain }}</span>
        </div>
        <input v-model="editor.tags" placeholder="Tags" />
        <textarea v-model="editor.body" placeholder="Prompt, note, or snippet"></textarea>
        <footer class="editor-actions">
          <button class="danger" type="button" @click="removeSelected">Delete</button>
          <button class="primary" type="submit">Save changes</button>
        </footer>
      </form>

      <div v-else class="blank-state">
        <h2>No note selected</h2>
        <button class="primary" type="button" @click="createNote">Create note</button>
      </div>
    </section>
  </main>
</template>

<style scoped>
.manager-shell {
  min-height: 100vh;
  display: grid;
  grid-template-columns: minmax(280px, 380px) minmax(0, 1fr);
  background: #f7f3eb;
}

.sidebar {
  min-height: 100vh;
  display: grid;
  grid-template-rows: auto auto auto minmax(0, 0.9fr) minmax(0, 1fr);
  gap: 14px;
  padding: 18px;
  border-right: 1px solid #dcd6c9;
  background: #f0ecdf;
}

.sidebar-head,
.editor-toolbar,
.editor-actions {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
}

h1,
h2,
p {
  margin: 0;
}

h1 {
  font-size: 22px;
  line-height: 1.1;
}

.sidebar-head p {
  margin-top: 5px;
  color: #65716d;
  font-size: 13px;
}

.manager-search {
  height: 40px;
  padding: 0 12px;
}

.view-tabs {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 4px;
  padding: 4px;
  border-radius: 8px;
  background: #e1dccf;
}

.view-tabs button {
  height: 34px;
  border-radius: 6px;
  color: #40504b;
  background: transparent;
  font-weight: 800;
}

.view-tabs button.active {
  color: #fffdf8;
  background: #237a6b;
}

.group-list {
  min-height: 0;
  overflow: auto;
  display: flex;
  flex-direction: column;
  gap: 8px;
  padding-right: 2px;
}

.group-row {
  display: grid;
  grid-template-columns: minmax(0, 1fr) 34px;
  gap: 6px;
  align-items: stretch;
}

.group-main {
  min-width: 0;
  height: 44px;
  display: grid;
  grid-template-columns: 24px minmax(0, 1fr) auto;
  align-items: center;
  gap: 8px;
  border: 1px solid #ddd7cb;
  border-radius: 8px;
  padding: 0 10px;
  color: #18211f;
  background: #fffdf8;
  text-align: left;
}

.group-row.active .group-main {
  border-color: #237a6b;
  box-shadow: inset 4px 0 0 #237a6b;
}

.group-row.favorite .group-main {
  border-color: #c9a03a;
}

.group-main img,
.domain-chip img,
.domain-preview img {
  width: 18px;
  height: 18px;
  border-radius: 4px;
  object-fit: contain;
}

.group-main strong,
.group-main small {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.group-main small {
  color: #65716d;
}

.tag-dot {
  width: 22px;
  height: 22px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  border-radius: 6px;
  color: #237a6b;
  background: #d6ece5;
  font-weight: 900;
}

.favorite-button {
  width: 34px;
  height: 44px;
  border-radius: 8px;
  color: #8a6417;
  background: #efe0b5;
  font-size: 17px;
}

.note-list {
  min-height: 0;
  overflow: auto;
  display: flex;
  flex-direction: column;
  gap: 8px;
  padding-right: 2px;
}

.note-row {
  min-height: 78px;
  border: 1px solid #ddd7cb;
  border-radius: 8px;
  padding: 10px;
  text-align: left;
  color: #18211f;
  background: #fffdf8;
}

.note-row.active {
  border-color: #237a6b;
  box-shadow: inset 4px 0 0 #237a6b;
}

.note-row strong,
.note-row span,
.note-row small {
  display: block;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.note-row span {
  margin-top: 5px;
  color: #65716d;
}

.domain-chip {
  width: fit-content;
  max-width: 100%;
  display: inline-flex !important;
  align-items: center;
  gap: 6px;
  margin-top: 8px;
  padding: 3px 7px;
  border-radius: 999px;
  color: #2d514b !important;
  background: #d6ece5;
  font-size: 12px;
}

.note-row small {
  margin-top: 8px;
  color: #7c8581;
}

.editor {
  min-width: 0;
  display: grid;
  grid-template-rows: auto minmax(0, 1fr);
  padding: 18px;
}

.editor-toolbar {
  min-height: 42px;
  margin-bottom: 14px;
}

.toolbar-group {
  display: flex;
  align-items: center;
  gap: 8px;
}

.import-button {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  cursor: pointer;
}

.import-button input {
  position: fixed;
  width: 1px;
  height: 1px;
  opacity: 0;
  pointer-events: none;
}

.editor-form {
  min-height: 0;
  display: grid;
  grid-template-rows: auto auto auto auto minmax(240px, 1fr) auto;
  gap: 12px;
}

.editor-form input {
  height: 42px;
  padding: 0 12px;
}

.title-input {
  font-size: 22px;
  font-weight: 800;
}

.domain-preview {
  width: fit-content;
  max-width: 100%;
  min-height: 34px;
  display: inline-flex;
  align-items: center;
  gap: 8px;
  padding: 0 10px;
  border-radius: 8px;
  color: #2d514b;
  background: #d6ece5;
  font-weight: 800;
}

.domain-preview span {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.editor-form textarea {
  min-height: 240px;
  resize: none;
  padding: 14px;
  line-height: 1.45;
}

.blank-state {
  min-height: 360px;
  display: grid;
  place-content: center;
  justify-items: center;
  gap: 16px;
  color: #65716d;
}

@media (max-width: 760px) {
  .manager-shell {
    grid-template-columns: 1fr;
  }

  .sidebar {
    min-height: 42vh;
    border-right: 0;
    border-bottom: 1px solid #dcd6c9;
  }

  .editor {
    min-height: 58vh;
  }
}
</style>
