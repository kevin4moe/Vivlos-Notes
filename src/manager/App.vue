<script setup>
import { computed, onMounted, reactive, ref, watch } from 'vue';
import { addNote, deleteNote, loadData, replaceNotes, searchNotes, updateNote } from '../shared/store.js';

const notes = ref([]);
const index = ref({ byToken: {}, byId: {} });
const query = ref('');
const selectedId = ref('');
const status = ref('');
const editor = reactive({ title: '', body: '', url: '', tags: '' });

const filtered = computed(() => searchNotes(notes.value, index.value, query.value, 200));
const selected = computed(() => notes.value.find((note) => note.id === selectedId.value));

onMounted(refresh);

watch(selected, (note) => {
  editor.title = note?.title || '';
  editor.body = note?.body || '';
  editor.url = note?.url || '';
  editor.tags = note?.tags?.join(' ') || '';
});

async function refresh() {
  const data = await loadData();
  notes.value = data.notes;
  index.value = data.index;
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
</script>

<template>
  <main class="manager-shell">
    <aside class="sidebar">
      <header class="sidebar-head">
        <div>
          <h1>Prompt Notes</h1>
          <p>{{ notes.length }} notes indexed locally</p>
        </div>
        <button class="primary" type="button" @click="createNote">New</button>
      </header>

      <input v-model="query" class="manager-search" type="search" placeholder="Search by term, URL, tag" />

      <section class="note-list" aria-label="Notes">
        <button
          v-for="note in filtered"
          :key="note.id"
          class="note-row"
          :class="{ active: note.id === selectedId }"
          type="button"
          @click="selectedId = note.id"
        >
          <strong>{{ note.title }}</strong>
          <span>{{ note.body || note.url || 'Empty note' }}</span>
          <small>{{ formatDate(note.updatedAt) }}</small>
        </button>
        <p v-if="!filtered.length" class="empty">No notes found</p>
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
  grid-template-rows: auto auto minmax(0, 1fr);
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
  grid-template-rows: auto auto auto minmax(240px, 1fr) auto;
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
