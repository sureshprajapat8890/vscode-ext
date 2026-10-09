import * as vscode from 'vscode';

let channel: vscode.LogOutputChannel | undefined;

const TAIL_LINES = 300;
const tail: string[] = [];

function remember(level: string, message: string, args: unknown[]): void {
  const extra = args.map((a) => (a instanceof Error ? (a.stack ?? a.message) : String(a)));
  tail.push(`[${level}] ${[message, ...extra].join(' ')}`);
  if (tail.length > TAIL_LINES) tail.splice(0, tail.length - TAIL_LINES);
}

/** The shared "RN Lens" output channel. Created lazily on first use. */
export function getLog(): vscode.LogOutputChannel {
  if (!channel) {
    const created = vscode.window.createOutputChannel('RN Lens', { log: true });
    // Keep a short in-memory tail of what was logged (exposed to integration tests).
    for (const level of ['trace', 'debug', 'info', 'warn', 'error'] as const) {
      const write = created[level].bind(created) as (message: string, ...args: unknown[]) => void;
      created[level] = ((message: string | Error, ...args: unknown[]) => {
        remember(
          level,
          message instanceof Error ? (message.stack ?? message.message) : message,
          args,
        );
        write(message as string, ...args);
      }) as typeof created.info;
    }
    channel = created;
  }
  return channel;
}

/** The most recent lines written to the output channel, oldest first. */
export function recentLogLines(): readonly string[] {
  return tail;
}

export function disposeLog(): void {
  channel?.dispose();
  channel = undefined;
}
