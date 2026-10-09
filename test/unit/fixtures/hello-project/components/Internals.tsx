import codegenNativeComponent from 'react-native/Libraries/Utilities/codegenNativeComponent';
import { AsyncLocalStorage } from 'node:async_hooks';
import fs from 'fs';
import { which } from 'split-lib';
import { Text } from 'react-native';

const Native = codegenNativeComponent('Thing');
const store = new AsyncLocalStorage();

export const Internals = () => <Text>{which}{String(Native)}{String(store)}{String(fs)}</Text>;
