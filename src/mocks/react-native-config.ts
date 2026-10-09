/**
 * RN Lens mock: react-native-config. Values come from the project's `.env` file, parsed as plain
 * text by the extension (never executed).
 */
declare const __RNLENS_DOTENV__: Record<string, string>;

const Config: Record<string, string> = { ...__RNLENS_DOTENV__ };

export const getConstants = (): Record<string, string> => Config;
export default Config;
