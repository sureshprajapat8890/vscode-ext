import AsyncStorage from '@react-native-async-storage/async-storage';
import Icon from 'react-native-vector-icons/MaterialIcons';
import Maps from 'react-native-maps';
import { thing } from '@acme/native';
import { Text } from 'react-native';

export function Mocked() {
  void AsyncStorage.getItem('k');
  return <Text>{String(Maps)}{thing}<Icon name="home" /></Text>;
}
