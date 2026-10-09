/** RN Lens mock: react-native-haptic-feedback. Haptics can't be felt in a preview; calls are no-ops. */
export enum HapticFeedbackTypes {
  selection = 'selection',
  impactLight = 'impactLight',
  impactMedium = 'impactMedium',
  impactHeavy = 'impactHeavy',
  rigid = 'rigid',
  soft = 'soft',
  notificationSuccess = 'notificationSuccess',
  notificationWarning = 'notificationWarning',
  notificationError = 'notificationError',
}

export function trigger(_type?: HapticFeedbackTypes | string, _options?: object): void {
  // No haptic engine in the preview.
}

export default { trigger };
