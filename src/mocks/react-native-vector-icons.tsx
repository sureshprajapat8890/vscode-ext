/**
 * RN Lens mock: react-native-vector-icons (used only when @expo/vector-icons isn't installed —
 * otherwise imports are redirected to its web build). Icon fonts aren't available, so each icon
 * renders as an outlined square of the requested size, labelled with the glyph name.
 */
import { forwardRef, type ReactNode } from 'react';
import { Text, View } from 'react-native';

interface IconProps {
  name: string;
  size?: number;
  color?: string;
  style?: unknown;
  testID?: string;
}

interface ButtonProps extends IconProps {
  children?: ReactNode;
  backgroundColor?: string;
}

type GlyphMap = Record<string, number | string>;

function makeIcon(family: string) {
  const Icon = forwardRef<unknown, IconProps>(function Icon(
    { name, size = 12, color = '#888', style, ...rest },
    ref,
  ) {
    return (
      <View
        ref={ref}
        {...rest}
        accessibilityRole="image"
        accessibilityLabel={name}
        style={[
          {
            width: size,
            height: size,
            borderWidth: 1,
            borderColor: color,
            borderRadius: size / 6,
            alignItems: 'center',
            justifyContent: 'center',
          },
          style,
        ]}
      >
        <Text style={{ color, fontSize: size * 0.5, lineHeight: size * 0.6 }}>
          {name.charAt(0).toUpperCase()}
        </Text>
      </View>
    );
  });
  Icon.displayName = `${family}Icon`;

  function IconButton({ children, backgroundColor = '#007AFF', style, ...icon }: ButtonProps) {
    return (
      <View
        style={[
          {
            flexDirection: 'row',
            alignItems: 'center',
            padding: 8,
            borderRadius: 5,
            backgroundColor,
          },
          style,
        ]}
      >
        <Icon {...icon} color={icon.color ?? '#fff'} style={{ marginRight: 10 }} />
        {typeof children === 'string' ? (
          <Text style={{ color: '#fff' }}>{children}</Text>
        ) : (
          children
        )}
      </View>
    );
  }

  return Object.assign(Icon, {
    Button: IconButton,
    getImageSource: (): Promise<null> => Promise.resolve(null),
    getImageSourceSync: (): null => null,
    loadFont: (): Promise<void> => Promise.resolve(),
    hasIcon: (): boolean => true,
    getRawGlyphMap: (): GlyphMap => ({}),
    getFontFamily: (): string => family,
  });
}

export function createIconSet(_glyphMap: GlyphMap, fontFamily = 'Icon') {
  return makeIcon(fontFamily);
}

export const createIconSetFromFontello = (_config: unknown, fontFamily = 'Fontello') =>
  makeIcon(fontFamily);
export const createIconSetFromIcoMoon = (_config: unknown, fontFamily = 'IcoMoon') =>
  makeIcon(fontFamily);

export default makeIcon('Icon');
