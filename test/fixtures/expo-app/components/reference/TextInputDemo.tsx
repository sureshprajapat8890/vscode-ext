import { useState } from 'react';
import { Text, TextInput, View } from 'react-native';

export default function TextInputDemo() {
  const [name, setName] = useState('Ada');
  return (
    <View style={{ paddingTop: 60, paddingHorizontal: 16 }}>
      <TextInput value={name} onChangeText={setName} placeholder="Your name" style={{ borderWidth: 1, padding: 8 }} />
      <Text>Hello, {name}</Text>
    </View>
  );
}
