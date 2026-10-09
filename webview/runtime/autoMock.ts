/**
 * A recursive no-op stand-in for native APIs that don't exist on web: every property is another
 * auto-mock and every call returns `undefined`. It is deliberately not thenable, so `await`ing a
 * mocked value doesn't hang.
 */
export function createAutoMock(name: string): unknown {
  const cache = new Map<PropertyKey, unknown>();
  const target = function autoMock(): undefined {
    return undefined;
  };
  return new Proxy(target, {
    get(_t, prop) {
      if (prop === 'then') return undefined;
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
    construct() {
      return createAutoMock(`new ${name}`) as object;
    },
  });

  function remember(prop: PropertyKey, value: unknown): unknown {
    cache.set(prop, value);
    return value;
  }
}
