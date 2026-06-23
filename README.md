# Vivlos Notes

A Firefox WebExtension built with Vue for saving prompt snippets, URLs, references, and quick notes.

## Design

- Popup: fast capture and search in a compact browser-action window.
- Manager: full-tab note management through the extension options page.
- Search: persisted inverted term index with token intersection and field-weighted ranking.
- Storage: Firefox `browser.storage.local`, with a small Chrome-compatible fallback wrapper.

The extension intentionally prioritizes a term index over local vector search. Vectors add model size, compute, and startup cost that are usually worse for short notes, prompts, and URLs. The index is rebuilt on writes and persisted beside the notes for instant popup search.

## Development

```bash
pnpm install
pnpm build
```

Load `dist` as a temporary add-on in Firefox:

1. Open `about:debugging#/runtime/this-firefox`.
2. Click `Load Temporary Add-on`.
3. Select `dist/manifest.json`.

## Files

- `src/shared/store.js`: storage, URL/domain enrichment, indexing, scoring, import/export helpers.
- `src/popup/App.vue`: small popup search and quick capture UI.
- `src/manager/App.vue`: full-page note management UI.
