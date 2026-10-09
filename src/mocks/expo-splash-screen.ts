/** RN Lens mock: expo-splash-screen. There is no splash screen in a preview; calls resolve at once. */
export const preventAutoHideAsync = (): Promise<boolean> => Promise.resolve(true);
export const hideAsync = (): Promise<boolean> => Promise.resolve(true);
export const hide = (): void => undefined;
export const setOptions = (_options: { duration?: number; fade?: boolean }): void => undefined;
