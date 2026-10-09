/** The subset of react-refresh/runtime RN Lens uses (the package ships no types). */
declare module 'react-refresh/runtime' {
  const RefreshRuntime: {
    injectIntoGlobalHook(globalObject: unknown): void;
    register(type: unknown, id: string): void;
    setSignature(
      type: unknown,
      key: string,
      forceReset?: boolean,
      getCustomHooks?: () => unknown[],
    ): void;
    performReactRefresh(): unknown;
  };
  export default RefreshRuntime;
}
