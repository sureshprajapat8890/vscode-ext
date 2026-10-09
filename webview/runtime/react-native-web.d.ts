/**
 * The subset of react-native-web that RN Lens's runtime and built-in mocks use. The real module is
 * resolved at bundle time from the project or the vendor directory.
 */
declare module 'react-native-web' {
  import type { ComponentType, ReactNode, Ref } from 'react';

  export type StyleProp = unknown;

  export interface ViewProps {
    style?: StyleProp;
    children?: ReactNode;
    accessibilityLabel?: string;
    accessibilityRole?: string;
    testID?: string;
    ref?: Ref<unknown>;
    [prop: string]: unknown;
  }

  export interface TextProps extends ViewProps {
    numberOfLines?: number;
  }

  export const View: ComponentType<ViewProps>;
  export const Text: ComponentType<TextProps>;

  export const StyleSheet: {
    create<T extends Record<string, Record<string, unknown>>>(styles: T): T;
    flatten(style: StyleProp): Record<string, unknown>;
  };

  export const Dimensions: object;
  export const Appearance: object;
  export const NativeModules: object;
  export const Animated: object;
  export const Platform: { OS: string; select<T>(spec: Record<string, T>): T | undefined };
  export const DeviceEventEmitter: object;
  export const SectionList: ComponentType<Record<string, unknown>>;
}
