import { FlatList, Text, View } from 'react-native';

const items = ['Apples', 'Bananas', 'Cherries'];

export default function FlatListDemo() {
  return (
    <View style={{ paddingTop: 60 }}>
      <FlatList data={items} keyExtractor={(item) => item} renderItem={({ item }) => <Text>{item}</Text>} />
    </View>
  );
}
