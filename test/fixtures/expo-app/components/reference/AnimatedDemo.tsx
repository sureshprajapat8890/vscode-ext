import { useEffect, useRef, useState } from 'react';
import { Animated, Text, View } from 'react-native';

export default function AnimatedDemo() {
  const opacity = useRef(new Animated.Value(0)).current;
  const [done, setDone] = useState(false);
  useEffect(() => {
    Animated.timing(opacity, { toValue: 1, duration: 150, useNativeDriver: false }).start(() =>
      setDone(true),
    );
  }, [opacity]);
  return (
    <View style={{ paddingTop: 60 }}>
      <Animated.View style={{ opacity }}>
        <Text>Fading in</Text>
      </Animated.View>
      <Text>{done ? 'Animation finished' : 'Animating'}</Text>
    </View>
  );
}
