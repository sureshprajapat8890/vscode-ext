/**
 * React Native public APIs that react-native-web doesn't implement. Without these, a single
 * `import { PlatformColor } from 'react-native'` anywhere (often deep in a library) fails the whole
 * preview build. Each gets the closest sensible web behaviour, or a no-op.
 */
import { createContext, forwardRef, useRef, type ReactNode } from 'react';
import {
  Animated,
  Appearance,
  DeviceEventEmitter,
  SectionList,
  Text,
  View,
} from 'react-native-web';
import { createAutoMock } from './autoMock';
import { requireNativeComponent } from './nativeComponents';

type Listener = (...args: unknown[]) => unknown;

interface ViewLikeProps {
  style?: unknown;
  children?: ReactNode;
  testID?: string;
}

function viewLike(name: string) {
  const Component = forwardRef<unknown, ViewLikeProps>(function ViewLike(props, ref) {
    return (
      <View ref={ref} style={props.style} testID={props.testID}>
        {props.children}
      </View>
    );
  });
  Component.displayName = name;
  return Component;
}

/** iOS semantic colours (light appearance) for `PlatformColor`. */
const SEMANTIC_COLORS: Record<string, string> = {
  label: '#000000',
  secondaryLabel: 'rgba(60,60,67,0.6)',
  tertiaryLabel: 'rgba(60,60,67,0.3)',
  quaternaryLabel: 'rgba(60,60,67,0.18)',
  link: '#007AFF',
  placeholderText: 'rgba(60,60,67,0.3)',
  separator: 'rgba(60,60,67,0.29)',
  opaqueSeparator: '#C6C6C8',
  systemBackground: '#FFFFFF',
  secondarySystemBackground: '#F2F2F7',
  tertiarySystemBackground: '#FFFFFF',
  systemGroupedBackground: '#F2F2F7',
  systemFill: 'rgba(120,120,128,0.2)',
  systemBlue: '#007AFF',
  systemGreen: '#34C759',
  systemIndigo: '#5856D6',
  systemOrange: '#FF9500',
  systemPink: '#FF2D55',
  systemPurple: '#AF52DE',
  systemRed: '#FF3B30',
  systemTeal: '#5AC8FA',
  systemYellow: '#FFCC00',
  systemGray: '#8E8E93',
  systemGray2: '#AEAEB2',
  systemGray3: '#C7C7CC',
  systemGray4: '#D1D1D6',
  systemGray5: '#E5E5EA',
  systemGray6: '#F2F2F7',
};

/** The first colour name RN Lens knows, as a CSS colour (unknown names fall back to black). */
export function PlatformColor(...names: string[]): string {
  for (const name of names) {
    const color = SEMANTIC_COLORS[name.replace(/^\?attr\/|^@android:color\//, '')];
    if (color) return color;
  }
  return '#000000';
}

export function DynamicColorIOS(tuple: { light: string; dark: string }): string {
  const scheme = (Appearance as { getColorScheme(): string }).getColorScheme();
  return scheme === 'dark' ? tuple.dark : tuple.light;
}

/** React Native's vendored EventEmitter. */
export class EventEmitter {
  private readonly listeners = new Map<string, Set<Listener>>();

  addListener(eventType: string, listener: Listener): { remove(): void } {
    const set = this.listeners.get(eventType) ?? new Set<Listener>();
    set.add(listener);
    this.listeners.set(eventType, set);
    return { remove: () => set.delete(listener) };
  }

  emit(eventType: string, ...args: unknown[]): void {
    for (const listener of [...(this.listeners.get(eventType) ?? [])]) listener(...args);
  }

  removeAllListeners(eventType?: string): void {
    if (eventType === undefined) this.listeners.clear();
    else this.listeners.delete(eventType);
  }

  listenerCount(eventType: string): number {
    return this.listeners.get(eventType)?.size ?? 0;
  }
}

export const NativeAppEventEmitter = DeviceEventEmitter;

const RESULTS = {
  GRANTED: 'granted',
  DENIED: 'denied',
  NEVER_ASK_AGAIN: 'never_ask_again',
} as const;

/** Every permission is granted in the preview. */
export const PermissionsAndroid = {
  RESULTS,
  PERMISSIONS: new Proxy({} as Record<string, string>, {
    get: (_t, name) => (typeof name === 'string' ? `android.permission.${name}` : undefined),
  }),
  check: (_permission: string): Promise<boolean> => Promise.resolve(true),
  request: (_permission: string): Promise<string> => Promise.resolve(RESULTS.GRANTED),
  requestMultiple: (permissions: string[]): Promise<Record<string, string>> =>
    Promise.resolve(Object.fromEntries(permissions.map((p) => [p, RESULTS.GRANTED]))),
};

/** Toasts are written to the console (and so to the RN Lens output). */
export const ToastAndroid = {
  SHORT: 0,
  LONG: 1,
  TOP: 0,
  BOTTOM: 1,
  CENTER: 2,
  show: (message: string): void => console.info(`[Toast] ${message}`),
  showWithGravity: (message: string): void => console.info(`[Toast] ${message}`),
  showWithGravityAndOffset: (message: string): void => console.info(`[Toast] ${message}`),
};

export const ActionSheetIOS = {
  showActionSheetWithOptions: (options: { title?: string }): void =>
    console.info(`[ActionSheetIOS] ${options.title ?? 'action sheet'} (not shown in the preview)`),
  showShareActionSheetWithOptions: (): void => undefined,
  dismissActionSheet: (): void => undefined,
};

export const Settings = {
  get: (_key: string): unknown => undefined,
  set: (_settings: Record<string, unknown>): void => undefined,
  watchKeys: (_keys: string | string[], _callback: () => void): number => 0,
  clearWatch: (_id: number): void => undefined,
};

export const DevSettings = {
  addMenuItem: (_title: string, _handler: () => void): void => undefined,
  reload: (_reason?: string): void => undefined,
  onFastRefresh: (): void => undefined,
};

export const DevMenu = { show: (): void => undefined, reload: (): void => undefined };

export const Systrace = {
  isEnabled: (): boolean => false,
  beginEvent: (): void => undefined,
  endEvent: (): void => undefined,
  beginAsyncEvent: (): number => 0,
  endAsyncEvent: (): void => undefined,
  counterEvent: (): void => undefined,
};

export const DeviceInfo = {
  getConstants: () => ({ isIPhoneX_deprecated: false }),
};

export const ReactNativeVersion = { version: { major: 0, minor: 0, patch: 0, prerelease: null } };

export const UTFSequence = {
  BOM: '﻿',
  BULLET: '•',
  BULLET_SP: ' • ',
  MIDDOT: '·',
  MIDDOT_SP: ' · ',
  MIDDOT_KATAKANA: '・',
  MDASH: '—',
  MDASH_SP: ' — ',
  NDASH: '–',
  NDASH_SP: ' – ',
  NEWLINE: '\n',
  NBSP: ' ',
  PIZZA: '🍕',
  TRIANGLE_LEFT: '◀',
  TRIANGLE_RIGHT: '▶',
};

export const RootTagContext = createContext(0);
export const unstable_TextAncestorContext = createContext(false);
export const unstable_NativeText = Text;
export const unstable_NativeView = View;
export const unstable_DEFAULT_INITIAL_NUM_TO_RENDER = 10;
export const unstable_getScrollParent = (): null => null;
export const unstable_VirtualView = viewLike('VirtualView');
export const VirtualizedSectionList = SectionList;
export const DrawerLayoutAndroid = viewLike('DrawerLayoutAndroid');
export const ProgressBarAndroid = viewLike('ProgressBarAndroid');

export function experimental_LayoutConformance({ children }: { children?: ReactNode }) {
  return <>{children}</>;
}

export const codegenNativeComponent = (name: string) => requireNativeComponent(name);
export const codegenNativeCommands = (): unknown => createAutoMock('codegenNativeCommands');
export const registerCallableModule = (_name: string, _module: unknown): void => undefined;
export const usePressability = (_config: unknown): Record<string, never> => ({});

export const NativeComponentRegistry = {
  get: (name: string) => requireNativeComponent(name),
  getWithFallback_DEPRECATED: (name: string) => requireNativeComponent(name),
  setRuntimeConfigProvider: (): void => undefined,
};

type AnimatedLike = {
  Value: new (value: number, config?: unknown) => unknown;
  ValueXY: new (value?: { x: number; y: number }, config?: unknown) => unknown;
  Color?: new (value?: unknown, config?: unknown) => unknown;
};
const AnimatedApi = Animated as unknown as AnimatedLike;

export function useAnimatedValue(initialValue: number, config?: unknown): unknown {
  const ref = useRef<unknown>(null);
  ref.current ??= new AnimatedApi.Value(initialValue, config);
  return ref.current;
}

export function useAnimatedValueXY(
  initialValue?: { x: number; y: number },
  config?: unknown,
): unknown {
  const ref = useRef<unknown>(null);
  ref.current ??= new AnimatedApi.ValueXY(initialValue, config);
  return ref.current;
}

export function useAnimatedColor(initialValue?: unknown, config?: unknown): unknown {
  const ref = useRef<unknown>(null);
  ref.current ??= AnimatedApi.Color
    ? new AnimatedApi.Color(initialValue, config)
    : createAutoMock('Animated.Color');
  return ref.current;
}

export const NativeDialogManagerAndroid = createAutoMock('NativeDialogManagerAndroid');
export const Networking = createAutoMock('Networking');
export const PushNotificationIOS = createAutoMock('PushNotificationIOS');
export const VirtualViewMode = createAutoMock('VirtualViewMode');
export const unstable_VirtualArray = createAutoMock('unstable_VirtualArray');
export const unstable_VirtualColumn = createAutoMock('unstable_VirtualColumn');
export const unstable_VirtualColumnGenerator = createAutoMock('unstable_VirtualColumnGenerator');
export const unstable_VirtualRow = createAutoMock('unstable_VirtualRow');
export const unstable_createVirtualCollectionView = createAutoMock(
  'unstable_createVirtualCollectionView',
);
