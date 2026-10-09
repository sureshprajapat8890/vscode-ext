import { forwardRef, type ReactNode } from 'react';
import { View } from 'react-native-web';
import { useDeviceInsets } from './safeArea';

interface SafeAreaViewProps {
  style?: unknown;
  children?: ReactNode;
  testID?: string;
}

/** React Native's SafeAreaView, padded with the simulated device's insets instead of CSS env(). */
export const SafeAreaView = forwardRef<unknown, SafeAreaViewProps>(function SafeAreaView(
  { style, ...rest },
  ref,
) {
  const insets = useDeviceInsets();
  const padding = {
    paddingTop: insets.top,
    paddingRight: insets.right,
    paddingBottom: insets.bottom,
    paddingLeft: insets.left,
  };
  return <View ref={ref} {...rest} style={[style, padding]} />;
});
