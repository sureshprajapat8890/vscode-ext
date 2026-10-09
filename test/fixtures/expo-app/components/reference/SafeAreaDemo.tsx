import { useState } from 'react';
import { SafeAreaView, Text, View, type LayoutChangeEvent } from 'react-native';

export default function SafeAreaDemo() {
  const [top, setTop] = useState<number | null>(null);
  const onLayout = (e: LayoutChangeEvent) => setTop(e.nativeEvent.layout.y);
  return (
    <SafeAreaView style={{ flex: 1 }}>
      <View onLayout={onLayout}>
        <Text>Content starts at {top === null ? '?' : Math.round(top)}</Text>
      </View>
    </SafeAreaView>
  );
}
