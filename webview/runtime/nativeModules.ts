import { NativeModules as WebNativeModules } from 'react-native-web';
import { createAutoMock } from './autoMock';

const warned = new Set<string>();

/**
 * `NativeModules` that never throws: modules react-native-web provides are returned as-is, anything
 * else is a no-op auto-mock with a one-time warning naming the module.
 */
export const NativeModules: Record<string, unknown> = new Proxy(
  WebNativeModules as Record<string, unknown>,
  {
    get(target, prop) {
      if (typeof prop !== 'string' || prop in target) {
        return Reflect.get(target, prop);
      }
      if (!warned.has(prop)) {
        warned.add(prop);
        console.warn(
          `RN Lens: NativeModules.${prop} is a native module, which can't run in the web preview, so it was replaced with a no-op mock. ` +
            'Add a mock in .rnlens/mocks/ to control what it returns.',
        );
      }
      const mock = createAutoMock(`NativeModules.${prop}`);
      Reflect.set(target, prop, mock);
      return mock;
    },
  },
);
