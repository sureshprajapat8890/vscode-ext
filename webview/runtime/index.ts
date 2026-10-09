/**
 * `rnlens:runtime` — imported first by every preview entry, so the patches below are installed
 * before any user module is evaluated.
 */
import './platformPatch';

export { ErrorBoundary } from './errorBoundary';
