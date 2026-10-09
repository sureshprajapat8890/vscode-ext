# Writing mocks

Packages with native code (Objective-C, Swift, Java, Kotlin) can't run in the RN Lens preview, which is a web page. RN Lens replaces them with mocks: plain JavaScript modules that export the same names. This guide shows how to write your own when the built-in or automatic ones aren't enough.

## How RN Lens picks a module

For each import, RN Lens uses the first of these that applies:

1. **Your mock** in `.rnlens/mocks/` (see below).
2. **A mock from `rnlens.config.js`**: `mocks: { 'react-native-maps': './.rnlens/maps.tsx' }`. Trusted workspaces only.
3. **A preferred alternative.** `react-native-vector-icons/*` uses `@expo/vector-icons` when it's installed.
4. **A built-in mock:**

   | Package | Built-in mock |
   |---|---|
   | `@react-native-async-storage/async-storage` | Backed by `localStorage` |
   | `react-native-safe-area-context` | Insets of the simulated device |
   | `react-native-device-info` | Reports the simulated device |
   | `react-native-haptic-feedback`, `expo-haptics` | No-ops |
   | `react-native-vector-icons` | Placeholders, when `@expo/vector-icons` isn't installed |
   | `expo-constants` | Values from `app.json` |
   | `expo-status-bar` | The frame draws the status bar |
   | `expo-splash-screen` | No-op |
   | `react-native-config` | Values from `.env` |

5. **The real package**, if it's installed and works on web.
6. **An auto-mock**, for:
   - packages that aren't installed;
   - `react-native/Libraries/*` internals;
   - Node built-ins;
   - unknown `NativeModules.*`, `TurboModuleRegistry` modules and `requireNativeComponent` views.

   Every property of an auto-mock is another auto-mock, every call returns `undefined`, and as a component it renders nothing.

The toolbar's **⚠ N mocked** badge and the *RN Lens* output channel list which packages were mocked and why.

## Creating a mock with the quick fix

When your code imports a package that was auto-mocked, the import line gets a warning: *"react-native-maps" can't run in the RN Lens preview*. To create a mock from it:

1. Put the cursor on the import and press **Ctrl+.** (**Cmd+.** on macOS).
2. Choose **Create mock for react-native-maps**.

RN Lens reads how your files import the package and writes a typed stub to `.rnlens/mocks/react-native-maps.tsx`:

- **PascalCase names** (`MapView`, `Marker`) become components that render a `View` with their children.
- **UPPER_CASE names** become constants.
- **Everything else** becomes a function that returns `undefined`.

The stub opens in the editor and the preview reloads. Edit it to return what your components need. If the mock already exists, RN Lens opens it rather than overwriting it.

## Writing a mock by hand

Create a file in `.rnlens/mocks/` named after the import specifier:

| Import | Mock file |
|---|---|
| `react-native-biometrics` | `.rnlens/mocks/react-native-biometrics.ts` |
| `@acme/native-camera` | `.rnlens/mocks/@acme/native-camera.tsx` |
| `react-native-firebase/auth` | `.rnlens/mocks/react-native-firebase/auth.ts` |
| A package, as a folder | `.rnlens/mocks/<package>/index.ts` |

Extensions `.ts`, `.tsx`, `.js` and `.jsx` all work. A mock for a package doesn't cover its subpaths: `pkg/sub` needs its own `pkg/sub.ts`.

Export the same names the package exports, as far as your code uses them. Mocks run in the preview like your own code, so they can import `react`, `react-native` and your project's files.

### A function API

```ts
// .rnlens/mocks/react-native-biometrics.ts
export default class ReactNativeBiometrics {
  async isSensorAvailable() {
    return { available: true, biometryType: 'FaceID' };
  }
  async simplePrompt() {
    return { success: true };
  }
}
```

### A native view

Render something with the same size and children, so layout stays realistic:

```tsx
// .rnlens/mocks/react-native-maps.tsx
import type { ReactNode } from 'react';
import { Text, View, type ViewProps } from 'react-native';

export default function MapView({ style, children }: ViewProps & { children?: ReactNode }) {
  return (
    <View style={[{ backgroundColor: '#dfe8d8', alignItems: 'center', justifyContent: 'center' }, style]}>
      <Text>Map</Text>
      {children}
    </View>
  );
}

export const Marker = (_props: { coordinate: { latitude: number; longitude: number } }) => null;
export const PROVIDER_GOOGLE = 'google';
```

### State that changes

Mocks can hold state and use React. This one lets a preview show both a signed-in and a signed-out screen:

```ts
// .rnlens/mocks/@acme/auth.ts
import { useSyncExternalStore } from 'react';

let user: { name: string } | null = { name: 'Ada' };
const listeners = new Set<() => void>();

export function signOut() {
  user = null;
  listeners.forEach((l) => l());
}

export function useUser() {
  return useSyncExternalStore(
    (l) => (listeners.add(l), () => listeners.delete(l)),
    () => user,
  );
}
```

## Tips

- **Match the shape, not the behaviour.** A mock only needs to let your UI render. Return realistic sample data, so the preview looks like the real screen.
- **Promises resolve.** Return resolved promises for async APIs. Auto-mocks return `undefined`, which `await` handles, but code that calls `.then()` on the result fails.
- **Saving reloads.** Saving a file in `.rnlens/mocks/` rebuilds the preview from scratch, so a new mock takes effect right away.
- **Different data for different variants.** Combine mocks with [variants](../README.md#variants-props-for-previews): read a module-level setting in the mock and set it from a `.preview.tsx` file.
- **Commit `.rnlens/`**, so your team shares the mocks and decorators.
- **`rnlens.config.js`** is the place for a mock that lives elsewhere, or that's shared across projects: `mocks: { pkg: './path/to/mock.ts' }`.
