import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const root = path.resolve(__dirname, '../../..');
const manifest = JSON.parse(readFileSync(path.join(root, 'package.json'), 'utf8')) as {
  contributes: {
    commands: { command: string }[];
    walkthroughs: {
      steps: {
        id: string;
        description: string;
        media: { markdown: string };
        completionEvents: string[];
      }[];
    }[];
  };
};

describe('walkthrough', () => {
  const steps = manifest.contributes.walkthroughs.flatMap((w) => w.steps);
  const commands = new Set(manifest.contributes.commands.map((c) => c.command));

  it('covers the PRD flow: open a preview, add a variant, add a decorator', () => {
    const ids = steps.map((s) => s.id);
    expect(ids.indexOf('openPreview')).toBeLessThan(ids.indexOf('addVariant'));
    expect(ids.indexOf('addVariant')).toBeLessThan(ids.indexOf('addDecorator'));
  });

  it('has media for every step and only references contributed RN Lens commands', () => {
    for (const step of steps) {
      expect(existsSync(path.join(root, step.media.markdown)), step.media.markdown).toBe(true);
      const referenced = [
        ...step.description.matchAll(/command:(rnLens\.[A-Za-z]+)/g),
        ...step.completionEvents.join(' ').matchAll(/onCommand:(rnLens\.[A-Za-z]+)/g),
      ].map((m) => m[1]);
      for (const id of referenced) expect(commands.has(id), `${step.id} → ${id}`).toBe(true);
    }
  });
});
