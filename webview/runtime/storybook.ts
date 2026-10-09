import { createElement, type ComponentType, type ReactNode } from 'react';

type Args = Record<string, unknown>;

interface StoryContext {
  id: string;
  name: string;
  title: string;
  args: Args;
  argTypes: Record<string, unknown>;
  globals: Record<string, unknown>;
  parameters: Record<string, unknown>;
  viewMode: 'story';
}

type Render = (args: Args, context: StoryContext) => ReactNode;
type Decorator = (Story: ComponentType, context: StoryContext) => ReactNode;

interface Annotations {
  args?: Args;
  render?: Render;
  decorators?: Decorator | Decorator[];
  parameters?: Record<string, unknown>;
  argTypes?: Record<string, unknown>;
  name?: string;
  storyName?: string;
}

interface Meta extends Annotations {
  title?: string;
  component?: ComponentType<Args>;
}

const asList = (d: Decorator | Decorator[] | undefined): Decorator[] =>
  d === undefined ? [] : Array.isArray(d) ? d : [d];

/**
 * A component rendering story `exportName` of a Storybook CSF module (CSF3 story objects, or CSF2
 * story functions), composed the way Storybook does: meta args then story args, the story's
 * `render` (else the meta's, else `<component {...args} />`), then story decorators inside meta
 * decorators. Loaders and `play` functions don't run in the preview.
 */
export function storyComponent(
  stories: Record<string, unknown>,
  exportName: string,
  fallbackComponent: ComponentType<Args>,
  file: string,
): ComponentType {
  const meta = (stories.default ?? {}) as Meta;
  const raw = stories[exportName];
  if (raw == null) {
    throw new Error(
      `RN Lens: ${file} has no story named "${exportName}". Pick another variant in the preview toolbar.`,
    );
  }
  const story: Annotations =
    typeof raw === 'function'
      ? { ...(raw as Annotations), render: raw as Render }
      : (raw as Annotations);
  const component = meta.component ?? fallbackComponent;
  const args: Args = { ...meta.args, ...story.args };
  const name = story.name ?? story.storyName ?? exportName;
  const context: StoryContext = {
    id: `${meta.title ?? file}--${exportName}`,
    name,
    title: meta.title ?? '',
    args,
    argTypes: { ...meta.argTypes, ...story.argTypes },
    globals: {},
    parameters: { ...meta.parameters, ...story.parameters },
    viewMode: 'story',
  };
  const render: Render =
    story.render ?? meta.render ?? ((storyArgs) => createElement(component, storyArgs));

  let Inner: ComponentType = function Story() {
    return render(context.args, context) as never;
  };
  for (const decorator of [...asList(story.decorators), ...asList(meta.decorators)]) {
    const Wrapped: ComponentType = Inner;
    Inner = function Decorated(): ReactNode {
      return decorator(Wrapped, context);
    };
  }
  return Inner;
}
