/**
 * RN Lens mock: react-native-device-info. Values describe the simulated device in the preview
 * toolbar. Getters this mock doesn't know return no-op auto-mocks instead of throwing.
 */
import { getHost } from 'rnlens:runtime/host';
import { createAutoMock } from 'rnlens:runtime/autoMock';

const env = () => getHost().env;
const isIOS = () => env().platform === 'ios';
const resolved = <T>(value: T): Promise<T> => Promise.resolve(value);

export const getModel = (): string => env().device.name;
export const getBrand = (): string => (isIOS() ? 'Apple' : 'Google');
export const getManufacturer = (): Promise<string> => resolved(getBrand());
export const getManufacturerSync = (): string => getBrand();
export const getDeviceId = (): string => env().device.id;
export const getSystemName = (): string => (isIOS() ? 'iOS' : 'Android');
export const getSystemVersion = (): string => (isIOS() ? '17.0' : '14');
export const getVersion = (): string => '1.0.0';
export const getBuildNumber = (): string => '1';
export const getReadableVersion = (): string => '1.0.0.1';
export const getApplicationName = (): string => 'RN Lens Preview';
export const getBundleId = (): string => 'dev.rnlens.preview';
export const getUniqueId = (): Promise<string> => resolved('rnlens-preview-device');
export const getUniqueIdSync = (): string => 'rnlens-preview-device';
export const getDeviceName = (): Promise<string> => resolved(env().device.name);
export const getDeviceNameSync = (): string => env().device.name;
export const getDeviceType = (): string => (env().device.isTablet ? 'Tablet' : 'Handset');
export const getUserAgent = (): Promise<string> => resolved(navigator.userAgent);
export const getUserAgentSync = (): string => navigator.userAgent;
export const getBatteryLevel = (): Promise<number> => resolved(0.8);
export const getBatteryLevelSync = (): number => 0.8;
export const getFontScale = (): Promise<number> => resolved(env().window.fontScale);
export const getFontScaleSync = (): number => env().window.fontScale;
export const isTablet = (): boolean => env().device.isTablet;
export const hasNotch = (): boolean => env().device.hasNotch;
export const hasDynamicIsland = (): boolean => env().device.hasDynamicIsland;
export const isEmulator = (): Promise<boolean> => resolved(true);
export const isEmulatorSync = (): boolean => true;
export const isLandscape = (): Promise<boolean> =>
  resolved(env().window.width > env().window.height);
export const isLandscapeSync = (): boolean => env().window.width > env().window.height;
export const getFirstInstallTime = (): Promise<number> => resolved(0);
export const getCarrier = (): Promise<string> => resolved('');
export const getTotalMemory = (): Promise<number> => resolved(6 * 1024 ** 3);
export const getUsedMemory = (): Promise<number> => resolved(1024 ** 3);
export const getIpAddress = (): Promise<string> => resolved('127.0.0.1');

const known = {
  getModel,
  getBrand,
  getManufacturer,
  getManufacturerSync,
  getDeviceId,
  getSystemName,
  getSystemVersion,
  getVersion,
  getBuildNumber,
  getReadableVersion,
  getApplicationName,
  getBundleId,
  getUniqueId,
  getUniqueIdSync,
  getDeviceName,
  getDeviceNameSync,
  getDeviceType,
  getUserAgent,
  getUserAgentSync,
  getBatteryLevel,
  getBatteryLevelSync,
  getFontScale,
  getFontScaleSync,
  isTablet,
  hasNotch,
  hasDynamicIsland,
  isEmulator,
  isEmulatorSync,
  isLandscape,
  isLandscapeSync,
  getFirstInstallTime,
  getCarrier,
  getTotalMemory,
  getUsedMemory,
  getIpAddress,
};

const DeviceInfo = new Proxy(known as Record<string, unknown>, {
  get: (target, prop) =>
    typeof prop !== 'string' || prop in target
      ? Reflect.get(target, prop)
      : createAutoMock(`react-native-device-info.${prop}`),
});

export default DeviceInfo;
