/**
 * `react-dom/client` as seen by every module in a preview bundle (react-native-web, Expo's
 * AppRegistry, user code). Roots are tracked so the shell can unmount whatever a bundle rendered,
 * however it mounted itself, before running the next bundle.
 */
import * as client from 'react-dom/client';

type Root = ReturnType<typeof client.createRoot>;

const roots = new Set<Root>();

function track<R extends Root>(root: R): R {
  const unmount = root.unmount.bind(root);
  roots.add(root);
  root.unmount = () => {
    roots.delete(root);
    unmount();
  };
  return root;
}

export const createRoot: typeof client.createRoot = (container, options) =>
  track(client.createRoot(container, options));

export const hydrateRoot: typeof client.hydrateRoot = (container, initialChildren, options) =>
  track(client.hydrateRoot(container, initialChildren, options));

// Everything else (e.g. `version`) is forwarded; the explicit exports above take precedence.
export * from 'react-dom/client';

// `import ReactDOM from 'react-dom/client'` (the real module is CommonJS, so its default import is
// the whole module object).
export default { ...client, createRoot, hydrateRoot };

/** Number of roots currently mounted by this bundle. */
export function mountedRootCount(): number {
  return roots.size;
}

/** Unmounts every root this bundle created. */
export function unmountAll(): void {
  for (const root of [...roots]) {
    try {
      root.unmount();
    } catch (err) {
      console.warn('RN Lens: a preview root failed to unmount', err);
    }
  }
  roots.clear();
}
