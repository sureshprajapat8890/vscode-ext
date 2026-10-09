import type { ReactNode } from 'react';
import { ThemeContext } from '../theme';

export default function Decorators({ children }: { children: ReactNode }) {
  return <ThemeContext.Provider value="ocean">{children}</ThemeContext.Provider>;
}
