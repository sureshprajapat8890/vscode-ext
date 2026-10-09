import { useNavigation, type NavigationProp } from '@react-navigation/native';
import { Pressable, Text, View } from 'react-native';
import PlatformBadge from '../components/PlatformBadge';
import type { RootStackParamList } from './types';

export default function HomeScreen() {
  const navigation = useNavigation<NavigationProp<RootStackParamList>>();
  return (
    <View style={{ flex: 1, padding: 16, gap: 12 }}>
      <Text>Home screen</Text>
      <PlatformBadge />
      <Pressable accessibilityRole="button" onPress={() => navigation.navigate('Details', { id: 42 })}>
        <Text>Open details</Text>
      </Pressable>
      <Pressable accessibilityRole="button" onPress={() => navigation.navigate('Settings')}>
        <Text>Open settings</Text>
      </Pressable>
    </View>
  );
}
