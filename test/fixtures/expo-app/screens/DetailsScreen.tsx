import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { Text, View } from 'react-native';
import type { RootStackParamList } from './types';

export default function DetailsScreen({ route }: NativeStackScreenProps<RootStackParamList, 'Details'>) {
  return (
    <View style={{ flex: 1, padding: 16 }}>
      <Text>Details screen for item {route.params.id}</Text>
    </View>
  );
}
