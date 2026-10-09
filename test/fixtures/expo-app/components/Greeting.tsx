import { useContext } from 'react';
import { Text, View } from 'react-native';
import { ThemeContext } from '../theme';

export function Greeting({ name = 'world' }: { name?: string }) {
  const theme = useContext(ThemeContext);
  return (
    <View style={{ paddingTop: 60 }}>
      <Text>
        Hi {name} ({theme})
      </Text>
    </View>
  );
}
