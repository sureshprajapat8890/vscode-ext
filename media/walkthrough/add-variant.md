# Add a variant

Create a file next to your component named `<Name>.preview.tsx`. Every named export becomes a variant you can pick in the preview toolbar:

```tsx
// components/Button.preview.tsx
import { Button } from './Button';

export const Primary = () => <Button title="Continue" />;
export const Disabled = () => <Button title="Continue" disabled />;
```
