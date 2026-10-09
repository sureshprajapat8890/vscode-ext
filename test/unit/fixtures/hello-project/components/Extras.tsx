import { EventEmitter } from 'events';
import { screen } from './Screen';
import { dir } from 'dir-mock';
import { Text } from 'react-native';

export const Extras = () => <Text>{String(EventEmitter)}{screen}{dir}{process.env.EXPO_PUBLIC_API_URL}</Text>;
