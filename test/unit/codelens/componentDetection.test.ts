import { describe, expect, it } from 'vitest';
import { detectComponents, pickDefaultComponent } from '../../../src/codelens/componentDetection';

const names = (src: string): string[] => detectComponents(src).map((c) => c.exportName);

describe('detectComponents', () => {
  it('finds an anonymous default arrow component', () => {
    expect(names(`export default () => <View><Text>Hello</Text></View>;`)).toEqual(['default']);
  });

  it('finds named function, arrow and function-expression components in source order', () => {
    const src = `
      export const Zeta = () => <View />;
      export function Alpha() { return <Text>a</Text>; }
      export const Mid = function () { return <></>; };
    `;
    expect(names(src)).toEqual(['Zeta', 'Alpha', 'Mid']);
  });

  it('reports export locations (0-based line)', () => {
    const [c] = detectComponents(`\n\n  export const Card = () => <View />;`);
    expect(c).toMatchObject({ exportName: 'Card', localName: 'Card', line: 2, column: 2 });
  });

  it('ignores non-PascalCase, non-JSX and type-only exports', () => {
    const src = `
      export const useThing = () => <View />;
      export const Helper = () => 42;
      export function format() { return 'x'; }
      export const CONSTANT = 3;
      export type Props = { a: string };
      export interface Other {}
    `;
    expect(names(src)).toEqual([]);
  });

  it('only counts returns of the component itself, not nested callbacks', () => {
    const src = `
      export function NotAComponent() {
        const render = () => <View />;
        return render;
      }
      export function List({ items }) {
        if (!items.length) return null;
        return <View>{items.map((i) => <Text key={i}>{i}</Text>)}</View>;
      }
      export function Cond({ on }) { return on ? <A /> : null; }
    `;
    expect(names(src)).toEqual(['List', 'Cond']);
  });

  it('unwraps memo, forwardRef and React.* wrappers, including nesting', () => {
    const src = `
      export const A = memo(() => <View />);
      export const B = React.forwardRef((props, ref) => <View ref={ref} />);
      export const C = React.memo(forwardRef(function C(p, r) { return <View />; }));
      export const D = memo(42);
      export const E = somethingElse(() => <View />);
    `;
    expect(names(src)).toEqual(['A', 'B', 'C']);
  });

  it('follows local bindings for export specifiers and default identifiers', () => {
    const src = `
      const Inner = () => <View />;
      function helper() { return 1; }
      const Wrapped = memo(Inner);
      export { Inner, helper, Wrapped as Fancy };
      export default Inner;
    `;
    expect(detectComponents(src).map((c) => [c.exportName, c.localName])).toEqual([
      ['Inner', 'Inner'],
      ['Fancy', 'Wrapped'],
      ['default', 'Inner'],
    ]);
  });

  it('supports `export { X as default }` and string export names', () => {
    expect(names(`const X = () => <View />; export { X as default };`)).toEqual(['default']);
    expect(names(`const X = () => <View />; export { X as "Y" };`)).toEqual(['Y']);
  });

  it('detects class components with a JSX render method', () => {
    const src = `
      export class Old extends React.Component { render() { return <View />; } }
      export class Pure extends PureComponent { render() { return <View />; } }
      export class Store extends Base { render() { return <View />; } }
      export class NoRender extends Component { other() { return <View />; } }
      export default class extends Component { render() { return <Text />; } }
    `;
    expect(names(src)).toEqual(['Old', 'Pure', 'default']);
  });

  it('handles TypeScript wrappers and typed components', () => {
    const src = `
      export const Typed: React.FC<{ a: string }> = ({ a }) => <Text>{a}</Text>;
      export const Cast = (() => <View />) as unknown as React.FC;
      export const Sat = (() => <View />) satisfies React.FC;
      export default function Screen(): JSX.Element { return <View />; }
    `;
    expect(names(src)).toEqual(['Typed', 'Cast', 'Sat', 'default']);
  });

  it('skips re-exports from other modules and declared functions', () => {
    const src = `
      export { Button } from './Button';
      export * from './all';
      export default function declared(): void;
    `;
    expect(names(src)).toEqual([]);
  });

  it('does not loop on self-referencing bindings', () => {
    expect(names(`const A = B; const B = A; export { A };`)).toEqual([]);
    expect(names(`const A = memo(A); export { A };`)).toEqual([]);
  });

  it('recovers from syntax errors and returns [] when unparseable', () => {
    expect(names(`export const A = () => <View />;\nexport const B = (`)).toEqual([]);
    expect(names(`export const A = () => <View />; let x; let x;`)).toEqual(['A']);
  });

  it('reports each export name once', () => {
    expect(names(`export const A = () => <View />; export { A as A };`)).toEqual(['A']);
  });
});

describe('pickDefaultComponent', () => {
  it('prefers the default export, else the first component', () => {
    expect(
      pickDefaultComponent(
        detectComponents(`export const A = () => <V />; export default () => <V />;`),
      )?.exportName,
    ).toBe('default');
    expect(
      pickDefaultComponent(
        detectComponents(`export const B = () => <V />; export const A = () => <V />;`),
      )?.exportName,
    ).toBe('B');
    expect(pickDefaultComponent([])).toBeUndefined();
  });
});
