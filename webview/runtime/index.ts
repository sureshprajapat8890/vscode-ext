/**
 * `rnlens:runtime` — imported first by every preview entry, so the patches below are installed
 * before any user module is evaluated.
 */
import './platformPatch';
import { unmountAll } from './reactDomClient';

// The shell calls this before running the next bundle.
(globalThis as { __RNLENS_UNMOUNT__?: () => void }).__RNLENS_UNMOUNT__ = unmountAll;

export { ErrorBoundary } from './errorBoundary';
export { mountedRootCount } from './reactDomClient';
