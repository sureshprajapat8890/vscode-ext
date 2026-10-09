import type { ComponentType } from 'react';
import { Text, View } from 'react-native';
import { Greeting } from './Greeting';

function Frame(Story: ComponentType) {
  return (
    <View>
      <Text>Story frame</Text>
      <Story />
    </View>
  );
}

export default {
  title: 'Greeting',
  component: Greeting,
  args: { name: 'Storybook' },
  decorators: [Frame],
  excludeStories: ['sampleNames'],
};

export const sampleNames = ['Alan', 'Grace'];

export const Basic = {};

export const Linus = { args: { name: 'Linus' } };

export const Pair = {
  render: (args: { name: string }) => (
    <View>
      <Greeting {...args} />
      <Greeting name="Margaret" />
    </View>
  ),
};

export const Legacy = () => <Greeting name="CSF2" />;
