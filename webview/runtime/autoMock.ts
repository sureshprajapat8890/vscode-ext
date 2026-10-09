/**
 * A recursive no-op stand-in for native APIs that don't exist on web: every property is another
 * auto-mock and every call returns `undefined`. It is deliberately not thenable, so `await`ing a
 * mocked value doesn't hang.
 */
/**
 * Properties React and other runtimes probe to classify a value. Answering them with more mocks
 * would make React treat a mock as a class component, memo or context, so they read as absent.
 */
const INTROSPECTION_KEYS = new Set<PropertyKey>([
  '$$typeof',
  'isReactComponent',
  'defaultProps',
  'propTypes',
  'contextType',
  'contextTypes',
  'childContextTypes',
  'getDerivedStateFromProps',
  'getDerivedStateFromError',
  'getDefaultProps',
  '_payload',
  '_init',
  'toJSON',
  'asymmetricMatch',
  'nodeType',
  'tagName',
]);

export function createAutoMock(name: string): unknown {
  const cache = new Map<PropertyKey, unknown>();
  const target = function autoMock(): undefined {
    return undefined;
  };
  // Bundlers' CommonJS interop (esbuild's __toESM) builds a new object that only copies *own*
  // properties but inherits from the module's prototype. Making the prototype resolve any name
  // keeps `import { Anything } from 'auto-mocked'` working.
  const lookup: object = new Proxy(Object.create(null) as object, {
    get: (_t, prop) => Reflect.get(proxy, prop),
  });
  const proxy: object = new Proxy(target, {
    getPrototypeOf: () => lookup,
    get(t, prop) {
      if (prop === 'then' || INTROSPECTION_KEYS.has(prop)) return undefined;
      // A plain function's own prototype: `prototype.isReactComponent` is absent (so React renders
      // the mock as a function component) and `class X extends Mock {}` still works.
      if (prop === 'prototype' || prop === 'length') return Reflect.get(t, prop);
      if (prop === '__esModule') return true;
      if (prop === 'default') return cache.get(prop) ?? remember(prop, createAutoMock(name));
      if (prop === Symbol.toPrimitive) return () => `[RN Lens mock ${name}]`;
      if (prop === 'toString') return () => `[RN Lens mock ${name}]`;
      if (prop === 'name') return name;
      if (typeof prop === 'symbol') return undefined;
      return cache.get(prop) ?? remember(prop, createAutoMock(`${name}.${prop}`));
    },
    apply() {
      return undefined;
    },
    construct(t, args, newTarget) {
      // `class X extends Mock {}`: build a real X instance; `new Mock()` returns another mock.
      if (newTarget !== proxy) return Reflect.construct(t, args, newTarget) as object;
      return createAutoMock(`new ${name}`) as object;
    },
  });
  return proxy;

  function remember(prop: PropertyKey, value: unknown): unknown {
    cache.set(prop, value);
    return value;
  }
}
