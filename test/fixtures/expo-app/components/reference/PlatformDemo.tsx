import { Platform, Text, useColorScheme, useWindowDimensions, View } from 'react-native';

export default function PlatformDemo() {
  const { width, height } = useWindowDimensions();
  const scheme = useColorScheme();
  return (
    <View style={{ paddingTop: 60 }}>
      <Text>{Platform.select({ ios: 'Platform: iOS', android: 'Platform: Android', default: 'Platform: other' })}</Text>
      <Text>
        Window: {width}x{height}
      </Text>
      <Text>Scheme: {scheme}</Text>
    </View>
  );
}
