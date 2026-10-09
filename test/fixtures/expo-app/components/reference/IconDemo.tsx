import { Ionicons } from '@expo/vector-icons';
import { Text, View } from 'react-native';

export default function IconDemo() {
  return (
    <View style={{ paddingTop: 60, flexDirection: 'row', alignItems: 'center', gap: 8 }}>
      <Ionicons name="home" size={24} color="tomato" accessibilityLabel="home icon" />
      <Text>Home</Text>
    </View>
  );
}
