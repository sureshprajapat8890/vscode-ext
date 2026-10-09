/**
 * RN Lens mock: @expo/log-box/lib. Expo's LogBox draws its own error UI in a shadow root on the
 * page; in a preview, RN Lens's error overlay and output channel already show errors and warnings,
 * so setting it up does nothing.
 */
export function setupLogBox(): void {
  // Intentionally empty.
}
