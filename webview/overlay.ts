import type { OverlaySnapshot, ProtocolBuildMessage, ProtocolFrame } from '../src/preview/protocol';

export interface OverlayFrame {
  label: string;
  file: string | undefined;
  line: number | undefined;
  column: number | undefined;
  /** Emphasised (the project's own code) vs. dimmed (libraries, unmapped). */
  primary: boolean;
}

const basename = (file: string): string => file.split(/[\\/]/).pop() ?? file;

export function framesFromBuildErrors(errors: readonly ProtocolBuildMessage[]): OverlayFrame[] {
  return errors
    .filter((e) => e.file)
    .map((e) => ({
      label: `${basename(e.file as string)}:${e.line ?? 0}:${(e.column ?? 0) + 1}`,
      file: e.file,
      line: e.line,
      column: (e.column ?? 0) + 1,
      primary: true,
    }));
}

export function framesFromStack(frames: readonly ProtocolFrame[]): OverlayFrame[] {
  return frames.map((f) => ({
    label: f.file
      ? `${f.functionName ?? '(anonymous)'} — ${basename(f.file)}:${f.line ?? 0}:${f.column ?? 0}`
      : f.raw,
    file: f.file,
    line: f.line,
    column: f.column,
    primary: f.userCode,
  }));
}

/**
 * Error overlay over the device frame. Frames that map to files are buttons that open the source
 * in the editor; the last successful render stays mounted underneath.
 */
export class ErrorOverlay {
  readonly element: HTMLElement;
  private readonly title: HTMLElement;
  private readonly message: HTMLElement;
  private readonly list: HTMLOListElement;
  private frames: OverlayFrame[] = [];

  constructor(private readonly onOpen: (frame: OverlayFrame) => void) {
    const el = document.createElement('section');
    el.className = 'overlay';
    el.hidden = true;
    el.setAttribute('role', 'alert');

    const header = document.createElement('div');
    header.className = 'overlay-header';
    this.title = document.createElement('h2');
    this.title.className = 'overlay-title';
    const dismiss = document.createElement('button');
    dismiss.type = 'button';
    dismiss.className = 'overlay-dismiss';
    dismiss.textContent = 'Dismiss';
    dismiss.addEventListener('click', () => this.hide());
    header.append(this.title, dismiss);

    this.message = document.createElement('pre');
    this.message.className = 'overlay-message';
    this.list = document.createElement('ol');
    this.list.className = 'overlay-frames';
    el.append(header, this.message, this.list);
    this.element = el;
  }

  show(title: string, message: string, frames: OverlayFrame[]): void {
    this.title.textContent = title;
    this.message.textContent = message;
    this.frames = frames;
    this.list.replaceChildren(
      ...frames.map((frame) => {
        const item = document.createElement('li');
        item.className = frame.primary ? 'stack-frame primary' : 'stack-frame';
        if (frame.file && frame.line !== undefined) {
          const button = document.createElement('button');
          button.type = 'button';
          button.className = 'frame-link';
          button.textContent = frame.label;
          button.title = `Open ${frame.file}:${frame.line}`;
          button.addEventListener('click', () => this.onOpen(frame));
          item.append(button);
        } else {
          item.textContent = frame.label;
        }
        return item;
      }),
    );
    this.element.hidden = false;
  }

  hide(): void {
    this.element.hidden = true;
  }

  get visible(): boolean {
    return !this.element.hidden;
  }

  /** Clicks the n-th frame that links to a file (test hook). */
  clickLinked(index: number): void {
    this.list.querySelectorAll<HTMLButtonElement>('button.frame-link')[index]?.click();
  }

  snapshot(): OverlaySnapshot {
    return {
      visible: this.visible,
      title: this.title.textContent ?? '',
      message: this.message.textContent ?? '',
      frames: this.frames.map((f) => ({ label: f.label, file: f.file, line: f.line })),
    };
  }
}
