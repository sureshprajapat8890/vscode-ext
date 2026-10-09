import { createElement, type ComponentType, type ReactNode } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { storyComponent } from '../../../webview/runtime/storybook';

const Button = ({ label, tone }: { label?: string; tone?: string }) =>
  createElement('b', { 'data-tone': tone }, label);
const frame =
  (name: string) =>
  (Story: ComponentType): ReactNode =>
    createElement('div', { 'data-frame': name }, createElement(Story));

const render = (stories: Record<string, unknown>, name: string): string =>
  renderToStaticMarkup(
    createElement(storyComponent(stories, name, Button as never, 'B.stories.tsx')),
  );

describe('storyComponent', () => {
  const stories = {
    default: {
      component: Button,
      args: { label: 'meta', tone: 'calm' },
      decorators: [frame('meta')],
    },
    Plain: {},
    Loud: { args: { tone: 'loud' }, decorators: frame('story') },
    Custom: {
      args: { label: 'custom' },
      render: (args: { label: string }, ctx: { name: string }) =>
        createElement('i', null, `${args.label} in ${ctx.name}`),
    },
    Legacy: () => createElement('u', null, 'csf2'),
  };

  it('merges args and renders the meta component, inside meta decorators', () => {
    expect(render(stories, 'Plain')).toBe(
      '<div data-frame="meta"><b data-tone="calm">meta</b></div>',
    );
  });

  it('applies story decorators inside meta decorators, and story args over meta args', () => {
    expect(render(stories, 'Loud')).toBe(
      '<div data-frame="meta"><div data-frame="story"><b data-tone="loud">meta</b></div></div>',
    );
  });

  it('uses a story render function with the story context, and CSF2 function stories', () => {
    expect(render(stories, 'Custom')).toBe('<div data-frame="meta"><i>custom in Custom</i></div>');
    expect(render(stories, 'Legacy')).toBe('<div data-frame="meta"><u>csf2</u></div>');
  });

  it('falls back to the previewed component without a meta, and explains missing stories', () => {
    expect(render({ One: { args: { label: 'x' } } }, 'One')).toBe('<b>x</b>');
    expect(() => render(stories, 'Nope')).toThrow(/B\.stories\.tsx has no story named "Nope"/);
  });
});
