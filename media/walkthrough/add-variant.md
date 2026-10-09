# Add variants

Variants let you switch between states of a component from the preview toolbar. RN Lens reads three sources.

**A `.preview` file** next to the component. Every named export is a variant:

```tsx
// components/Button.preview.tsx
import { Button } from './Button';

export const Primary = () => <Button title="Continue" />;
export const Disabled = () => <Button title="Continue" disabled />;
```

**A `previews` object** in the component file. Each key is a variant and its value is the props:

```tsx
export const previews = {
  Long: { title: 'A very long button label' },
};
```

**Storybook stories** in `Button.stories.tsx`, written in CSF3. Each story is a variant, with its `args`, `render` and `decorators` applied:

```tsx
export default { component: Button, args: { title: 'Continue' } };
export const Disabled = { args: { disabled: true } };
```
