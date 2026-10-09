import { ScrollView, Text } from 'react-native';

const rows = Array.from({ length: 30 }, (_, i) => `Row ${i + 1}`);

export default function ScrollViewDemo() {
  return (
    <ScrollView contentContainerStyle={{ paddingTop: 60 }}>
      {rows.map((row) => (
        <Text key={row} style={{ padding: 12 }}>
          {row}
        </Text>
      ))}
    </ScrollView>
  );
}
