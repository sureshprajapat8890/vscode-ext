/** RN Lens mock: expo-haptics. Haptics can't be felt in a preview; calls resolve immediately. */
export enum ImpactFeedbackStyle {
  Light = 'light',
  Medium = 'medium',
  Heavy = 'heavy',
  Soft = 'soft',
  Rigid = 'rigid',
}

export enum NotificationFeedbackType {
  Success = 'success',
  Warning = 'warning',
  Error = 'error',
}

export enum AndroidHaptics {
  Confirm = 'confirm',
  Reject = 'reject',
  Context_Click = 'context-click',
  Long_Press = 'long-press',
  Virtual_Key = 'virtual-key',
}

export const impactAsync = (_style?: ImpactFeedbackStyle): Promise<void> => Promise.resolve();
export const notificationAsync = (_type?: NotificationFeedbackType): Promise<void> =>
  Promise.resolve();
export const selectionAsync = (): Promise<void> => Promise.resolve();
export const performAndroidHapticsAsync = (_type: AndroidHaptics): Promise<void> =>
  Promise.resolve();
