declare module '*.css';

interface VsCodeApi<T> {
  postMessage(message: T): void;
  getState(): unknown;
  setState(state: unknown): void;
}

declare function acquireVsCodeApi<T>(): VsCodeApi<T>;

/* eslint-disable no-var -- globals shared with the preview bundle's entry module */
declare var __RNLENS_ROOT__: HTMLElement | undefined;
declare var __RNLENS_UNMOUNT__: (() => void) | undefined;
