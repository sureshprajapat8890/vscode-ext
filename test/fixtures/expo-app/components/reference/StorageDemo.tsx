import AsyncStorage from '@react-native-async-storage/async-storage';
import { useEffect, useState } from 'react';
import { Text, View } from 'react-native';

export default function StorageDemo() {
  const [value, setValue] = useState('loading');
  useEffect(() => {
    void (async () => {
      await AsyncStorage.setItem('greeting', 'stored hello');
      setValue((await AsyncStorage.getItem('greeting')) ?? 'missing');
    })();
  }, []);
  return (
    <View style={{ paddingTop: 60 }}>
      <Text>Storage: {value}</Text>
    </View>
  );
}
