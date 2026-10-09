# Wrap previews in your providers

Create `.rnlens/decorators.tsx` at your project root. RN Lens renders every preview inside it:

```tsx
import { ThemeProvider } from '../src/theme';

export default function Decorators({ children }: { children: React.ReactNode }) {
  return <ThemeProvider>{children}</ThemeProvider>;
}
```
