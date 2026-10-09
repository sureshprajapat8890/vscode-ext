import { useState } from 'react';
import { Pressable, Text, View } from 'react-native';

export default function StatefulCounter() {
  const [count, setCount] = useState(0);
  return (
    <View style={{ paddingTop: 60 }}>
      <Pressable onPress={() => setCount((c) => c + 1)}>
        <Text>Increment</Text>
      </Pressable>
      <Text>Label A: {count}</Text>
    </View>
  );
}
