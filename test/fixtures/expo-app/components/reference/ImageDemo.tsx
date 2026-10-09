import { useState } from 'react';
import { Image, Text, View } from 'react-native';

// favicon.png is ~1 KB (inlined as a data URL); icon.png is ~390 KB (served from the cache dir).
const small = require('../../assets/favicon.png');
const large = require('../../assets/icon.png');

export default function ImageDemo() {
  const [loaded, setLoaded] = useState<string[]>([]);
  const onLoad = (name: string) => () => setLoaded((l) => [...l, name].sort());
  return (
    <View style={{ paddingTop: 60, alignItems: 'center' }}>
      <Image source={small} style={{ width: 32, height: 32 }} onLoad={onLoad('small')} />
      <Image source={large} style={{ width: 96, height: 96 }} onLoad={onLoad('large')} />
      <Text>Loaded: {loaded.join(',') || 'none'}</Text>
      <Text>
        Size: {large.width}x{large.height}
      </Text>
    </View>
  );
}
