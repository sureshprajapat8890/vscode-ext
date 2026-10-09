declare module 'flow-remove-types' {
  interface Options {
    /** Strip types even without an `@flow` pragma. */
    all?: boolean;
    /** Remove whitespace left behind instead of preserving positions. */
    pretty?: boolean;
  }

  interface Result {
    toString(): string;
    generateMap(): unknown;
  }

  export default function flowRemoveTypes(source: string, options?: Options): Result;
}
