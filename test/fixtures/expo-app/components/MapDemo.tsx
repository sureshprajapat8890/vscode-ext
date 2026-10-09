import { Text, View } from 'react-native';
// Not installed in this project: RN Lens auto-mocks it and offers "Create mock for react-native-maps".
import MapView, { Marker } from 'react-native-maps';

export default function MapDemo() {
  return (
    <View style={{ paddingTop: 60 }}>
      <Text>Map demo</Text>
      <MapView style={{ height: 100 }}>
        <Marker />
      </MapView>
    </View>
  );
}
