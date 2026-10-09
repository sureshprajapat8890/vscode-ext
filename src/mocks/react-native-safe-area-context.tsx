/**
 * RN Lens mock: react-native-safe-area-context. Insets and frame come from the simulated device
 * (and follow rotation), because the library's web build measures CSS env() insets, which are
 * always zero inside an editor panel.
 */
import {
  createContext,
  createElement,
  forwardRef,
  useContext,
  type ComponentType,
  type ReactNode,
} from 'react';
import { StyleSheet, View } from 'react-native';
import { getFrame, getInsets, useDeviceFrame, useDeviceInsets } from 'rnlens:runtime/safeArea';

export type Edge = 'top' | 'right' | 'bottom' | 'left';
export type EdgeMode = 'off' | 'additive' | 'maximum';
export interface EdgeInsets {
  top: number;
  right: number;
  bottom: number;
  left: number;
}
export interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}
export interface Metrics {
  insets: EdgeInsets;
  frame: Rect;
}

export const SafeAreaInsetsContext = createContext<EdgeInsets | null>(null);
SafeAreaInsetsContext.displayName = 'SafeAreaInsetsContext';
export const SafeAreaFrameContext = createContext<Rect | null>(null);
SafeAreaFrameContext.displayName = 'SafeAreaFrameContext';

export const initialWindowMetrics: Metrics = { insets: getInsets(), frame: getFrame() };
export const initialWindowSafeAreaInsets: EdgeInsets = initialWindowMetrics.insets;

interface ProviderProps {
  children?: ReactNode;
  style?: unknown;
  initialMetrics?: Metrics | null;
  testID?: string;
}

export function SafeAreaProvider({
  children,
  style,
  initialMetrics: _initial,
  ...rest
}: ProviderProps) {
  const insets = useDeviceInsets();
  const frame = useDeviceFrame();
  return (
    <View {...rest} style={[{ flex: 1 }, style]}>
      <SafeAreaFrameContext.Provider value={frame}>
        <SafeAreaInsetsContext.Provider value={insets}>{children}</SafeAreaInsetsContext.Provider>
      </SafeAreaFrameContext.Provider>
    </View>
  );
}

export function useSafeAreaInsets(): EdgeInsets {
  const fromContext = useContext(SafeAreaInsetsContext);
  const device = useDeviceInsets();
  return fromContext ?? device;
}

export function useSafeAreaFrame(): Rect {
  const fromContext = useContext(SafeAreaFrameContext);
  const device = useDeviceFrame();
  return fromContext ?? device;
}

export const SafeAreaConsumer = SafeAreaInsetsContext.Consumer;

export function withSafeAreaInsets<P extends object>(
  Wrapped: ComponentType<P & { insets: EdgeInsets }>,
) {
  return forwardRef<unknown, P>(function WithSafeAreaInsets(props, ref) {
    const insets = useSafeAreaInsets();
    // Props are forwarded untouched; the generic P can't be re-narrowed after adding `ref`.
    return createElement(Wrapped as ComponentType<Record<string, unknown>>, {
      ...props,
      insets,
      ref,
    });
  });
}

type EdgesProp = readonly Edge[] | Partial<Record<Edge, EdgeMode>>;

interface SafeAreaViewProps {
  edges?: EdgesProp;
  mode?: 'padding' | 'margin';
  style?: unknown;
  children?: ReactNode;
  testID?: string;
}

const ALL_EDGES: readonly Edge[] = ['top', 'right', 'bottom', 'left'];

function edgeModes(edges: EdgesProp | undefined): Record<Edge, EdgeMode> {
  const modes: Record<Edge, EdgeMode> = { top: 'off', right: 'off', bottom: 'off', left: 'off' };
  if (!edges) {
    for (const e of ALL_EDGES) modes[e] = 'additive';
  } else if (Array.isArray(edges)) {
    for (const e of edges as readonly Edge[]) modes[e] = 'additive';
  } else {
    Object.assign(modes, edges);
  }
  return modes;
}

const CAPITAL: Record<Edge, string> = {
  top: 'Top',
  right: 'Right',
  bottom: 'Bottom',
  left: 'Left',
};

export const SafeAreaView = forwardRef<unknown, SafeAreaViewProps>(function SafeAreaView(
  { edges, mode = 'padding', style, ...rest },
  ref,
) {
  const insets = useSafeAreaInsets();
  const modes = edgeModes(edges);
  const flat = (StyleSheet.flatten(style) ?? {}) as Record<string, unknown>;
  const own = (edge: Edge): number => {
    const axis = edge === 'top' || edge === 'bottom' ? 'Vertical' : 'Horizontal';
    const value = flat[`${mode}${CAPITAL[edge]}`] ?? flat[`${mode}${axis}`] ?? flat[mode];
    return typeof value === 'number' ? value : 0;
  };
  const spacing: Record<string, number> = {};
  for (const edge of ALL_EDGES) {
    const edgeMode = modes[edge];
    if (edgeMode === 'off') continue;
    spacing[`${mode}${CAPITAL[edge]}`] =
      edgeMode === 'maximum' ? Math.max(insets[edge], own(edge)) : insets[edge] + own(edge);
  }
  return <View ref={ref} {...rest} style={[style, spacing]} />;
});
