import { forwardRef, type ReactNode } from 'react';
import { View } from 'react-native-web';
import { createAutoMock } from './autoMock';

const warned = new Set<string>();

function warnOnce(key: string, message: string): void {
  if (warned.has(key)) return;
  warned.add(key);
  console.warn(message);
}

const hint =
  'Add a mock in .rnlens/mocks/ for the package that uses it to control what it renders or returns.';

/** `TurboModuleRegistry` whose modules are no-op auto-mocks instead of native code. */
export const TurboModuleRegistry = {
  get(name: string): unknown {
    warnOnce(
      `turbo:${name}`,
      `RN Lens: TurboModule "${name}" is native code, so it was replaced with a no-op mock. ${hint}`,
    );
    return createAutoMock(`TurboModuleRegistry.${name}`);
  },
  getEnforcing(name: string): unknown {
    return TurboModuleRegistry.get(name);
  },
};

interface NativeComponentProps {
  style?: unknown;
  children?: ReactNode;
  testID?: string;
}

/** `requireNativeComponent`: native views render as a plain View (keeping their children and style). */
export function requireNativeComponent(name: string) {
  warnOnce(
    `view:${name}`,
    `RN Lens: native view "${name}" can't render on web, so it's shown as an empty View. ${hint}`,
  );
  const Component = forwardRef<unknown, NativeComponentProps>(function NativeComponent(props, ref) {
    return (
      <View ref={ref} style={props.style} testID={props.testID} accessibilityLabel={name}>
        {props.children}
      </View>
    );
  });
  Component.displayName = name;
  return Component;
}
