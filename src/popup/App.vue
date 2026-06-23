<script setup>
import { computed, onMounted, ref } from 'vue';
import { addNote, getActiveTab, loadData, searchNotes } from '../shared/store.js';

const notes = ref([]);
const index = ref({ byToken: {}, byId: {} });
const query = ref('');
const body = ref('');
const title = ref('');
const url = ref('');
const tags = ref('');
const status = ref('');
const saving = ref(false);

const results = computed(() => searchNotes(notes.value, index.value, query.value, 8));
const canSave = computed(() => body.value.trim() || title.value.trim() || url.value.trim());

onMounted(async () => {
  await refresh();
  const tab = await getActiveTab();
  if (tab?.url && /^https?:|^file:/.test(tab.url)) {
    url.value = tab.url;
    title.value = tab.title || '';
  }
});

async function refresh() {
  const data = await loadData();
  notes.value = data.notes;
  index.value = data.index;
}

async function save() {
  if (!canSave.value || saving.value) return;
  saving.value = true;
  await addNote({
    title: title.value,
    body: body.value,
    url: url.value,
    tags: tags.value
  });
  body.value = '';
  tags.value = '';
  status.value = 'Saved';
  await refresh();
  saving.value = false;
  setTimeout(() => {
    if (status.value === 'Saved') status.value = '';
  }, 1300);
}

function openManager() {
  const runtime = globalThis.browser?.runtime || globalThis.chrome?.runtime;
  const tabs = globalThis.browser?.tabs || globalThis.chrome?.tabs;
  const target = runtime?.getURL?.('manager.html') || 'manager.html';

  if (tabs?.create) {
    tabs.create({ url: target });
  } else {
    window.open(target, '_blank');
  }
}

function copyNote(note) {
  navigator.clipboard?.writeText(note.body || note.url || note.title);
  status.value = 'Copied';
}
</script>

<template>
  <main class="popup-shell">
    <header class="topbar">
      <div>
        <h1>Vivlos Notes</h1>
        <p>{{ notes.length }} saved</p>
      </div>
      <button class="icon-button" type="button" title="Open manager" @click="openManager">□</button>
    </header>

    <section class="search-zone">
      <input v-model="query" type="search" autocomplete="off" placeholder="Search prompts, URLs, tags" />
      <div class="results" aria-live="polite">
        <article v-for="note in results" :key="note.id" class="result">
          <button type="button" class="result-main" @click="copyNote(note)">
            <strong>{{ note.title }}</strong>
            <span>{{ note.body || note.url }}</span>
          </button>
          <a v-if="note.url" :href="note.url" target="_blank" rel="noreferrer" title="Open URL">↗</a>
        </article>
        <p v-if="query && !results.length" class="empty">No matches yet</p>
      </div>
    </section>

    <form class="capture" @submit.prevent="save">
      <input v-model="title" placeholder="Title" autocomplete="off" />
      <textarea v-model="body" rows="5" placeholder="Prompt, note, command, or snippet"></textarea>
      <input v-model="url" type="url" placeholder="URL" autocomplete="off" />
      <input v-model="tags" placeholder="Tags: prompt ai docs idea" autocomplete="off" />
      <div class="actions">
        <span class="muted">{{ status }}</span>
        <button class="primary" type="submit" :disabled="!canSave || saving">Save</button>
      </div>
    </form>
  </main>
</template>

<style scoped>
.popup-shell {
  height: 520px;
  display: grid;
  grid-template-rows: auto minmax(140px, 1fr) auto;
  gap: 12px;
  padding: 14px;
  background: #f7f3eb;
}

.topbar,
.actions {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
}

h1 {
  margin: 0;
  font-size: 18px;
  line-height: 1.1;
}

p {
  margin: 0;
}

.topbar p {
  margin-top: 4px;
  color: #65716d;
  font-size: 12px;
}

.search-zone {
  min-height: 0;
  display: grid;
  grid-template-rows: auto 1fr;
  gap: 8px;
}

.search-zone input,
.capture input {
  height: 36px;
  padding: 0 10px;
}

.results {
  min-height: 0;
  overflow: auto;
  display: flex;
  flex-direction: column;
  gap: 6px;
  padding-right: 2px;
}

.result {
  display: grid;
  grid-template-columns: minmax(0, 1fr) 34px;
  gap: 6px;
  align-items: stretch;
}

.result-main {
  min-width: 0;
  border-radius: 8px;
  padding: 9px 10px;
  text-align: left;
  color: #18211f;
  background: #fffdf8;
  border: 1px solid #e2ded2;
}

.result-main:hover {
  border-color: #9bb5aa;
}

.result strong,
.result span {
  display: block;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.result strong {
  font-size: 13px;
}

.result span {
  margin-top: 3px;
  color: #65716d;
  font-size: 12px;
}

.result a {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  border-radius: 8px;
  color: #18211f;
  background: #e5e9de;
  text-decoration: none;
  font-weight: 800;
}

.capture {
  display: grid;
  gap: 8px;
  padding-top: 12px;
  border-top: 1px solid #ddd7cb;
}

.capture textarea {
  resize: none;
  padding: 9px 10px;
}

.primary:disabled {
  cursor: not-allowed;
  opacity: 0.45;
}
</style>
