import { beforeEach, describe, expect, it } from 'vitest';
import { commands, mockState } from '../vscodeMock';
import { UserError } from '../../../src/util/errors';
import { safeCommand } from '../../../src/util/safeCommand';

describe('safeCommand', () => {
  beforeEach(() => mockState.reset());

  it('passes arguments through and returns the result', async () => {
    safeCommand('t.ok', (a: number, b: number) => a + b);
    expect(await commands.executeCommand('t.ok', 2, 3)).toBe(5);
    expect(mockState.messages).toEqual([]);
  });

  it('shows UserError messages verbatim as warnings', async () => {
    safeCommand('t.user', () => {
      throw new UserError('Nothing to preview. Open a file.');
    });
    expect(await commands.executeCommand('t.user')).toBeUndefined();
    expect(mockState.messages).toEqual([
      { level: 'warning', text: 'Nothing to preview. Open a file.', items: [] },
    ]);
    expect(mockState.logLines).toContain('[warn] t.user: Nothing to preview. Open a file.');
  });

  it('logs unexpected errors with stacks and offers the output channel', async () => {
    mockState.nextMessageChoice = 'Show Output';
    safeCommand('t.boom', async () => {
      throw new Error('disk on fire');
    });
    await commands.executeCommand('t.boom');
    expect(mockState.messages[0]).toEqual({
      level: 'error',
      text: 'RN Lens: disk on fire. See the RN Lens output for details.',
      items: ['Show Output'],
    });
    expect(mockState.logLines[0]).toMatch(/^\[error\] t\.boom failed: Error: disk on fire\n\s+at /);
    expect(mockState.logShown).toBe(true);
  });

  it('handles non-Error throwables', async () => {
    safeCommand('t.str', () => {
      throw 'nope';
    });
    await commands.executeCommand('t.str');
    expect(mockState.messages[0].text).toBe('RN Lens: nope. See the RN Lens output for details.');
    expect(mockState.logShown).toBe(false);
  });
});
