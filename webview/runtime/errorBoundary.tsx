import { Component, type ErrorInfo, type ReactNode } from 'react';
import { getHost } from './host';

interface Props {
  children?: ReactNode;
}

interface State {
  error: unknown;
}

/** Top-level boundary around every preview: reports render errors to the shell's overlay. */
export class ErrorBoundary extends Component<Props, State> {
  override state: State = { error: undefined };

  static getDerivedStateFromError(error: unknown): State {
    return { error: error ?? new Error('Unknown render error') };
  }

  override componentDidCatch(error: unknown, info: ErrorInfo): void {
    getHost().reportError(error, info.componentStack);
  }

  override render(): ReactNode {
    return this.state.error === undefined ? this.props.children : null;
  }
}
