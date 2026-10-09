export interface DevicePreset {
  id: string;
  name: string;
  /** Logical size in dp (= CSS px), portrait. */
  width: number;
  height: number;
  /** Device pixel ratio reported by PixelRatio / Dimensions. */
  scale: number;
  platform: 'ios' | 'android';
  isTablet: boolean;
  cornerRadius: number;
  statusBarHeight: number;
  /** Portrait safe-area insets. */
  safeArea: { top: number; right: number; bottom: number; left: number };
  cutout: 'none' | 'notch' | 'dynamicIsland' | 'punchHole';
  homeIndicator: boolean;
}

export const DEVICES: readonly DevicePreset[] = [
  {
    id: 'iphone-se',
    name: 'iPhone SE',
    width: 375,
    height: 667,
    scale: 2,
    platform: 'ios',
    isTablet: false,
    cornerRadius: 0,
    statusBarHeight: 20,
    safeArea: { top: 20, right: 0, bottom: 0, left: 0 },
    cutout: 'none',
    homeIndicator: false,
  },
  {
    id: 'iphone-15',
    name: 'iPhone 15',
    width: 393,
    height: 852,
    scale: 3,
    platform: 'ios',
    isTablet: false,
    cornerRadius: 55,
    statusBarHeight: 54,
    safeArea: { top: 59, right: 0, bottom: 34, left: 0 },
    cutout: 'dynamicIsland',
    homeIndicator: true,
  },
  {
    id: 'iphone-15-pro-max',
    name: 'iPhone 15 Pro Max',
    width: 430,
    height: 932,
    scale: 3,
    platform: 'ios',
    isTablet: false,
    cornerRadius: 55,
    statusBarHeight: 54,
    safeArea: { top: 59, right: 0, bottom: 34, left: 0 },
    cutout: 'dynamicIsland',
    homeIndicator: true,
  },
  {
    id: 'pixel-8',
    name: 'Pixel 8',
    width: 412,
    height: 915,
    scale: 2.625,
    platform: 'android',
    isTablet: false,
    cornerRadius: 32,
    statusBarHeight: 32,
    safeArea: { top: 32, right: 0, bottom: 24, left: 0 },
    cutout: 'punchHole',
    homeIndicator: true,
  },
  {
    id: 'galaxy-s24',
    name: 'Galaxy S24',
    width: 360,
    height: 780,
    scale: 3,
    platform: 'android',
    isTablet: false,
    cornerRadius: 28,
    statusBarHeight: 28,
    safeArea: { top: 28, right: 0, bottom: 24, left: 0 },
    cutout: 'punchHole',
    homeIndicator: true,
  },
  {
    id: 'ipad-10',
    name: 'iPad (10th gen)',
    width: 820,
    height: 1180,
    scale: 2,
    platform: 'ios',
    isTablet: true,
    cornerRadius: 18,
    statusBarHeight: 24,
    safeArea: { top: 24, right: 0, bottom: 20, left: 0 },
    cutout: 'none',
    homeIndicator: true,
  },
];

export const DEFAULT_DEVICE_ID = 'iphone-15';

export function findDevice(id: string): DevicePreset | undefined {
  return DEVICES.find((d) => d.id === id);
}

/** A user-sized screen with no hardware chrome. */
export function customDevice(width: number, height: number): DevicePreset {
  return {
    id: 'custom',
    name: `Custom ${width}×${height}`,
    width,
    height,
    scale: 2,
    platform: 'ios',
    isTablet: Math.min(width, height) >= 600,
    cornerRadius: 0,
    statusBarHeight: 0,
    safeArea: { top: 0, right: 0, bottom: 0, left: 0 },
    cutout: 'none',
    homeIndicator: false,
  };
}

export interface OrientedDevice {
  width: number;
  height: number;
  insets: { top: number; right: number; bottom: number; left: number };
  showStatusBar: boolean;
}

/**
 * Logical size and safe-area insets for an orientation. In landscape (rotated clockwise from
 * portrait), the top inset moves to the left and phones hide the status bar.
 */
export function orient(device: DevicePreset, landscape: boolean): OrientedDevice {
  if (!landscape) {
    return {
      width: device.width,
      height: device.height,
      insets: { ...device.safeArea },
      showStatusBar: device.statusBarHeight > 0,
    };
  }
  const { top, bottom } = device.safeArea;
  const hasCutout = device.cutout !== 'none';
  return {
    width: device.height,
    height: device.width,
    insets: {
      top: device.isTablet ? device.safeArea.top : 0,
      right: hasCutout ? top : 0,
      bottom: device.homeIndicator ? Math.min(bottom, 21) : 0,
      left: hasCutout ? top : 0,
    },
    showStatusBar: device.isTablet && device.statusBarHeight > 0,
  };
}
