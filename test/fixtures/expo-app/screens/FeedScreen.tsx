import { FlatList, Text, View } from 'react-native';

const posts = ['First post', 'Second post', 'Third post'];

export default function FeedScreen() {
  return (
    <View style={{ flex: 1 }}>
      <Text style={{ padding: 16 }}>Feed screen</Text>
      <FlatList data={posts} keyExtractor={(p) => p} renderItem={({ item }) => <Text style={{ padding: 16 }}>{item}</Text>} />
    </View>
  );
}
