import { flowLabel } from 'flow-lib';
import { plain } from 'plain-lib';
import { Text } from 'react-native';

export const Flowed = () => <Text>{flowLabel({ label: plain })}</Text>;
