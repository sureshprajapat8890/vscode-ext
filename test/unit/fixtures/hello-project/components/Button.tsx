import { Text } from 'react-native';

export const Button = ({ title = 'Default' }: { title?: string }) => <Text>{title}</Text>;

export const previews = {
  Big: { title: 'BIG' },
  Primary: { title: 'shadowed by Button.preview.tsx' },
};
