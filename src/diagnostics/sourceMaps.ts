import path from 'node:path';
import { SourceMapConsumer, type RawSourceMap } from 'source-map-js';

export interface StackFrame {
  functionName: string | undefined;
  /** Absolute source path when the frame maps into a real file. */
  file: string | undefined;
  /** 1-based. */
  line: number | undefined;
  /** 1-based. */
  column: number | undefined;
  /** True for frames in the project's own code (not node_modules, not RN Lens internals). */
  userCode: boolean;
  /** The original stack line, for frames that couldn't be mapped. */
  raw: string;
}

export interface RawFrame {
  functionName: string | undefined;
  url: string;
  line: number;
  column: number;
  raw: string;
}

// V8: "    at fn (url:1:2)", "    at url:1:2", "    at async fn (url:1:2)", "    at new Foo (url:1:2)".
const V8_FRAME = /^\s*at (?:(?:async |new )?(.+?) \()?(.+?):(\d+):(\d+)\)?\s*$/;

/** Parses V8-style stack (or React component stack) lines; non-frame lines are skipped. */
export function parseStack(stack: string): RawFrame[] {
  const frames: RawFrame[] = [];
  for (const line of stack.split('\n')) {
    const m = V8_FRAME.exec(line);
    if (!m) continue;
    frames.push({
      functionName: m[1],
      url: m[2],
      line: Number(m[3]),
      column: Number(m[4]),
      raw: line.trim(),
    });
  }
  return frames;
}

function unmappedFrame(frame: RawFrame): StackFrame {
  return {
    functionName: frame.functionName,
    file: undefined,
    line: undefined,
    column: undefined,
    userCode: false,
    raw: frame.raw,
  };
}

/**
 * Maps a stack whose frames come from several bundles (the app and vendor bundles), choosing each
 * frame's source map by the URL the frame's code was loaded from.
 */
export function mapStackAcross(
  stack: string | undefined | null,
  maps: ReadonlyMap<string, BundleSourceMap>,
): StackFrame[] {
  if (!stack) return [];
  return parseStack(stack).map(
    (frame) => maps.get(frame.url)?.mapFrame(frame) ?? unmappedFrame(frame),
  );
}

const isInside = (parent: string, child: string): boolean => {
  const rel = path.relative(parent, child);
  return rel === '' || (!rel.startsWith('..') && !path.isAbsolute(rel));
};

/**
 * Maps stack frames of a preview bundle (loaded from a `blob:` URL) back to original sources using
 * the bundle's external source map. Source paths in the map are relative to `outDir`.
 */
export class BundleSourceMap {
  private readonly consumer: SourceMapConsumer;

  constructor(
    mapJson: string,
    private readonly outDir: string,
    private readonly projectRoot: string,
    /** Directories whose files are never "user code" (the extension's runtime and mocks). */
    private readonly internalDirs: readonly string[] = [],
  ) {
    this.consumer = new SourceMapConsumer(JSON.parse(mapJson) as RawSourceMap);
  }

  mapStack(stack: string | undefined | null): StackFrame[] {
    return stack ? parseStack(stack).map((f) => this.mapFrame(f)) : [];
  }

  mapFrame(frame: RawFrame): StackFrame {
    const unmapped = unmappedFrame(frame);
    if (!frame.url.startsWith('blob:')) return unmapped;

    const pos = this.consumer.originalPositionFor({ line: frame.line, column: frame.column - 1 });
    if (!pos.source || pos.line === null) return unmapped;
    // Virtual modules (e.g. "rnlens-entry:entry") have no file on disk.
    if (/^[a-z-]+:/i.test(pos.source) && !/^[a-z]:[\\/]/i.test(pos.source)) return unmapped;

    const file = path.resolve(this.outDir, pos.source);
    const userCode =
      isInside(this.projectRoot, file) &&
      !file.split(/[\\/]/).includes('node_modules') &&
      !this.internalDirs.some((d) => isInside(d, file));
    return {
      functionName: pos.name ?? frame.functionName,
      file,
      line: pos.line,
      column: (pos.column ?? 0) + 1,
      userCode,
      raw: frame.raw,
    };
  }
}
