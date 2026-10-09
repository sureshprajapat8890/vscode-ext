import * as vscode from 'vscode';
import { UserError } from './errors';
import { getLog } from './log';

const SHOW_OUTPUT = 'Show Output';

/**
 * Registers a command whose failures are logged to the RN Lens output channel and surfaced as a
 * concise notification, so no handler can produce an unhandled rejection.
 */
export function safeCommand(id: string, handler: (...args: never[]) => unknown): vscode.Disposable {
  return vscode.commands.registerCommand(id, async (...args: never[]) => {
    try {
      return await handler(...args);
    } catch (err) {
      const log = getLog();
      if (err instanceof UserError) {
        log.warn(`${id}: ${err.message}`);
        void vscode.window.showWarningMessage(err.message);
        return undefined;
      }
      const message = err instanceof Error ? err.message : String(err);
      log.error(`${id} failed: ${err instanceof Error && err.stack ? err.stack : message}`);
      const choice = await vscode.window.showErrorMessage(
        `RN Lens: ${message}. See the RN Lens output for details.`,
        SHOW_OUTPUT,
      );
      if (choice === SHOW_OUTPUT) {
        log.show(true);
      }
      return undefined;
    }
  });
}
