export interface ModuleRecord {
  /** Hash of the module's source as built. */
  hash: string;
  /** Exports only components (see analyzeForRefresh). */
  isBoundary: boolean;
}

export type HotPlan =
  | { kind: 'full'; reason: string }
  | {
      kind: 'hot';
      /** Project modules that must run again; every other project module reuses its exports. */
      reexecute: string[];
    };

/**
 * Decides how to apply a new app bundle, React Refresh style:
 * - Changed modules re-run.
 * - A re-run module that exports only components (a boundary) is handled by Fast Refresh; its
 *   importers keep their exports, because React swaps component implementations by family.
 * - Any other re-run module makes its importers re-run too, transitively.
 * - Reaching a module that isn't a project module (the virtual entry, expo-router's route
 *   context) means the change can't be applied in place: full reload.
 *
 * `importers` maps a module to the modules that import it.
 */
export function planUpdate(
  previous: ReadonlyMap<string, ModuleRecord> | undefined,
  next: ReadonlyMap<string, ModuleRecord>,
  importers: ReadonlyMap<string, readonly string[]>,
): HotPlan {
  if (!previous) return { kind: 'full', reason: 'first build' };

  const changed = [...next.entries()]
    .filter(([id, record]) => previous.get(id)?.hash !== record.hash)
    .map(([id]) => id);

  const reexecute = new Set(changed);
  const queue = changed.filter((id) => !next.get(id)?.isBoundary);
  while (queue.length > 0) {
    const id = queue.shift() as string;
    for (const importer of importers.get(id) ?? []) {
      if (!next.has(importer)) {
        return {
          kind: 'full',
          reason: `${id} exports more than components and is used by the app entry`,
        };
      }
      if (reexecute.has(importer)) continue;
      reexecute.add(importer);
      if (!next.get(importer)?.isBoundary) queue.push(importer);
    }
  }
  return { kind: 'hot', reexecute: [...reexecute].sort() };
}

/** What a webview last received, so the next build can be planned against it. */
export interface DeliveredBundle {
  /** The esbuild context it came from (project, target and simulated platform). */
  contextId: string;
  vendorVersion: string;
  /** Hash of the virtual entry's source (which target, variant and decorators it mounts). */
  entryHash: string | undefined;
  modules: ReadonlyMap<string, ModuleRecord>;
}

/**
 * Plans a build against the bundle a particular webview is running (not the previous build: a
 * build superseded before delivery, or one delivered only to another panel, must not hide changes).
 */
export function planDelivery(
  previous: DeliveredBundle | undefined,
  next: DeliveredBundle,
  importers: ReadonlyMap<string, readonly string[]>,
): HotPlan {
  if (!previous) return { kind: 'full', reason: 'first build' };
  if (previous.contextId !== next.contextId) {
    return { kind: 'full', reason: 'the preview target or platform changed' };
  }
  if (previous.vendorVersion !== next.vendorVersion) {
    return { kind: 'full', reason: 'the app uses new modules' };
  }
  if (previous.entryHash !== next.entryHash) {
    return { kind: 'full', reason: 'the preview target changed' };
  }
  return planUpdate(previous.modules, next.modules, importers);
}
