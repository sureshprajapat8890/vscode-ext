export interface DevicePreset {
  id: string;
  name: string;
  /** Logical size in dp (= CSS px), portrait. */
  width: number;
  height: number;
  platform: 'ios' | 'android';
  cornerRadius: number;
  statusBarHeight: number;
  safeArea: { top: number; right: number; bottom: number; left: number };
  cutout: 'none' | 'notch' | 'dynamicIsland' | 'punchHole';
  homeIndicator: boolean;
}

export const IPHONE_15: DevicePreset = {
  id: 'iphone-15',
  name: 'iPhone 15',
  width: 393,
  height: 852,
  platform: 'ios',
  cornerRadius: 55,
  statusBarHeight: 54,
  safeArea: { top: 59, right: 0, bottom: 34, left: 0 },
  cutout: 'dynamicIsland',
  homeIndicator: true,
};

export const DEVICES: readonly DevicePreset[] = [IPHONE_15];
export const DEFAULT_DEVICE = IPHONE_15;
