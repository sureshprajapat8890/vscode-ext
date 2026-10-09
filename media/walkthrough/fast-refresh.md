# Edit with Fast Refresh

Change a component's text, styles or JSX and save. RN Lens rebuilds only your project's code and applies it with React Fast Refresh, as Metro does on a device:

- **State is kept.** A counter's `useState` value, a scroll position or the current screen survive the edit.
- **Hook changes reset state.** Adding, removing or changing a hook's initial value remounts that component.
- **Some edits remount.** Editing a module that exports more than components (constants, hooks, context) re-runs it and everything that imports it. If that change reaches your app's entry file, the whole preview reloads.

The toolbar shows **⚡** after a hot update and **✓** after a full reload.

Prefer updates while you type? Set `rnLens.updateMode` to `onType`.
