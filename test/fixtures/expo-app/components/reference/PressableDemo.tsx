import { useState } from 'react';
import { Pressable, Text, View } from 'react-native';

export default function PressableDemo() {
  const [count, setCount] = useState(0);
  return (
    <View style={{ paddingTop: 60, alignItems: 'center' }}>
      <Pressable
        accessibilityRole="button"
        onPress={() => setCount((c) => c + 1)}
        style={({ pressed }) => ({ padding: 12, backgroundColor: pressed ? '#ddd' : '#eee' })}
      >
        <Text>Pressed {count} times</Text>
      </Pressable>
    </View>
  );
}
