import { Text } from 'react-native';

export default function ThrowDemo() {
  throw new Error('Kaboom from ThrowDemo');
  return <Text>unreachable</Text>;
}
