/**
 * Minimal in-memory stand-in for the `vscode` module, aliased in vitest.config.ts.
 * Only the APIs the extension actually uses are implemented; tests drive state via `mockState`.
 */
type Listener<T> = (e: T) => unknown;

export class EventEmitter<T> {
  private listeners = new Set<Listener<T>>();
  event = (listener: Listener<T>): { dispose(): void } => {
    this.listeners.add(listener);
    return { dispose: () => this.listeners.delete(listener) };
  };
  fire(data: T): void {
    for (const l of [...this.listeners]) l(data);
  }
  dispose(): void {
    this.listeners.clear();
  }
}

export class Uri {
  private constructor(
    readonly scheme: string,
    readonly fsPath: string,
  ) {}
  static file(fsPath: string): Uri {
    return new Uri('file', fsPath);
  }
  static from(parts: { scheme: string; path: string }): Uri {
    return new Uri(parts.scheme, parts.path);
  }
  toString(): string {
    return `${this.scheme}://${this.fsPath}`;
  }
}

export interface MockWatcher {
  pattern: string;
  create: EventEmitter<Uri>;
  change: EventEmitter<Uri>;
  delete: EventEmitter<Uri>;
  disposed: boolean;
}

export const mockState = {
  files: new Map<string, string>(),
  /** Result of workspace.findFiles; tests set this directly. */
  foundFiles: [] as Uri[],
  findFilesCalls: [] as { include: string; exclude: string | undefined; max: number | undefined }[],
  contextKeys: new Map<string, unknown>(),
  watchers: [] as MockWatcher[],
  workspaceFoldersChanged: new EventEmitter<unknown>(),
  workspaceFolders: [] as { uri: Uri }[],
  logLines: [] as string[],
  logShown: false,
  commands: new Map<string, (...args: never[]) => unknown>(),
  messages: [] as { level: 'warning' | 'error'; text: string; items: string[] }[],
  /** Item returned by the next showErrorMessage / showWarningMessage call. */
  nextMessageChoice: undefined as string | undefined,
  reset(): void {
    this.files.clear();
    this.foundFiles = [];
    this.findFilesCalls = [];
    this.contextKeys.clear();
    this.watchers = [];
    this.workspaceFoldersChanged = new EventEmitter<unknown>();
    this.workspaceFolders = [];
    this.logLines = [];
    this.logShown = false;
    this.commands.clear();
    this.messages = [];
    this.nextMessageChoice = undefined;
  },
};

function isInside(parent: string, child: string): boolean {
  const norm = (p: string) => p.replace(/\\/g, '/').replace(/\/$/, '');
  return norm(child) === norm(parent) || norm(child).startsWith(`${norm(parent)}/`);
}

export const workspace = {
  createFileSystemWatcher(pattern: string) {
    const w: MockWatcher = {
      pattern,
      create: new EventEmitter<Uri>(),
      change: new EventEmitter<Uri>(),
      delete: new EventEmitter<Uri>(),
      disposed: false,
    };
    mockState.watchers.push(w);
    return {
      onDidCreate: w.create.event,
      onDidChange: w.change.event,
      onDidDelete: w.delete.event,
      dispose: () => {
        w.disposed = true;
      },
    };
  },
  async findFiles(include: string, exclude?: string, max?: number): Promise<Uri[]> {
    mockState.findFilesCalls.push({ include, exclude, max });
    return mockState.foundFiles;
  },
  onDidChangeWorkspaceFolders(listener: Listener<unknown>) {
    return mockState.workspaceFoldersChanged.event(listener);
  },
  getWorkspaceFolder(uri: Uri) {
    return mockState.workspaceFolders.find((f) => isInside(f.uri.fsPath, uri.fsPath));
  },
  fs: {
    async readFile(uri: Uri): Promise<Uint8Array> {
      const text = mockState.files.get(uri.fsPath);
      if (text === undefined) {
        throw new Error(`ENOENT: ${uri.fsPath}`);
      }
      return new TextEncoder().encode(text);
    },
  },
};

export const commands = {
  async executeCommand(command: string, ...args: unknown[]): Promise<unknown> {
    if (command === 'setContext') {
      mockState.contextKeys.set(args[0] as string, args[1]);
      return undefined;
    }
    return mockState.commands.get(command)?.(...(args as never[]));
  },
  registerCommand(command: string, handler: (...args: never[]) => unknown) {
    mockState.commands.set(command, handler);
    return { dispose: () => mockState.commands.delete(command) };
  },
};

const showMessage =
  (level: 'warning' | 'error') =>
  async (text: string, ...items: string[]): Promise<string | undefined> => {
    mockState.messages.push({ level, text, items });
    return mockState.nextMessageChoice;
  };

const record =
  (level: string) =>
  (message: string, ...rest: unknown[]): void => {
    mockState.logLines.push(`[${level}] ${[message, ...rest.map(String)].join(' ')}`);
  };

export const window = {
  showWarningMessage: showMessage('warning'),
  showErrorMessage: showMessage('error'),
  createOutputChannel(name: string) {
    return {
      name,
      info: record('info'),
      warn: record('warn'),
      error: record('error'),
      debug: record('debug'),
      trace: record('trace'),
      appendLine: record('line'),
      show: () => {
        mockState.logShown = true;
      },
      dispose: () => undefined,
    };
  },
};
