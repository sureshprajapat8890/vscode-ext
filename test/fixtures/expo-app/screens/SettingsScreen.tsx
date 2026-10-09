import { useFonts } from 'expo-font';
import { Text, View } from 'react-native';

export default function SettingsScreen() {
  const [loaded, error] = useFonts({ Ionicons: require('../assets/fonts/Ionicons.ttf') });
  return (
    <View style={{ flex: 1, padding: 16 }}>
      <Text>Settings screen</Text>
      <Text>Fonts: {error ? `error ${error.message}` : loaded ? 'loaded' : 'loading'}</Text>
    </View>
  );
}
