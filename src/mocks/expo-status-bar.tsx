/**
 * RN Lens mock: expo-status-bar. The preview frame draws its own status bar, so the component
 * renders nothing and the imperative setters are no-ops.
 */
export type StatusBarStyle = 'auto' | 'inverted' | 'light' | 'dark';
export type StatusBarAnimation = 'none' | 'fade' | 'slide';

export interface StatusBarProps {
  style?: StatusBarStyle;
  animated?: boolean;
  hidden?: boolean;
  hideTransitionAnimation?: StatusBarAnimation;
  networkActivityIndicatorVisible?: boolean;
  backgroundColor?: string;
  translucent?: boolean;
}

export function StatusBar(_props: StatusBarProps): null {
  return null;
}

export const setStatusBarStyle = (_style: StatusBarStyle, _animated?: boolean): void => undefined;
export const setStatusBarHidden = (_hidden: boolean, _animation?: StatusBarAnimation): void =>
  undefined;
export const setStatusBarBackgroundColor = (_color: string, _animated?: boolean): void => undefined;
export const setStatusBarTranslucent = (_translucent: boolean): void => undefined;
export const setStatusBarNetworkActivityIndicatorVisible = (_visible: boolean): void => undefined;
