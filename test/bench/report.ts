/** Raw measurements written by the bench suite (inside VS Code) and read by the runner. */
export interface BenchResults {
  environment: string;
  activationMs: number;
  coldApp: ColdBuild;
  coldComponent: ColdBuild;
  warm: { buildMs: number[]; renderedMs: number[] };
  memory: { baselineRssMb: number; peakRssMb: number; peakHeapMb: number };
  notes: string[];
}

interface ColdBuild {
  buildMs: number;
  renderedMs: number;
  modules: number;
}

export interface Row {
  metric: string;
  target: string;
  measured: string;
  pass: boolean;
}

export function percentile(values: readonly number[], p: number): number {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.ceil((p / 100) * sorted.length) - 1)];
}

/** PRD §7 targets. Timings are judged end to end (until the preview shows the result). */
export function evaluate(r: BenchResults): Row[] {
  const warmBuild = percentile(r.warm.buildMs, 90);
  const warmRendered = percentile(r.warm.renderedMs, 90);
  const overhead = r.memory.peakRssMb - r.memory.baselineRssMb;
  const cold = (what: string, c: ColdBuild): Row => ({
    metric: `Cold build, ${what} (${c.modules} modules)`,
    target: '< 3000 ms',
    measured: `${c.renderedMs} ms to render (esbuild ${c.buildMs} ms)`,
    pass: c.renderedMs < 3000,
  });
  return [
    {
      metric: 'Extension activation',
      target: '< 200 ms',
      measured: `${r.activationMs} ms`,
      pass: r.activationMs < 200,
    },
    cold('Expo app', r.coldApp),
    cold('one component', r.coldComponent),
    {
      metric: `Warm rebuild p90 (${r.warm.renderedMs.length} edits)`,
      target: '< 300 ms',
      measured: `${warmRendered} ms save→rendered (esbuild ${warmBuild} ms)`,
      pass: warmRendered < 300,
    },
    {
      metric: 'Extension host memory overhead',
      target: '< 250 MB',
      measured: `+${overhead} MB RSS (peak ${r.memory.peakRssMb} MB, JS heap ${r.memory.peakHeapMb} MB)`,
      pass: overhead < 250,
    },
  ];
}

/** A Markdown table (readable in a terminal, pasteable into docs). */
export function formatTable(rows: readonly Row[]): string {
  const header = ['Metric', 'Target', 'Measured', 'Result'];
  const cells = rows.map((r) => [r.metric, r.target, r.measured, r.pass ? 'PASS' : 'FAIL']);
  const widths = header.map((h, i) => Math.max(h.length, ...cells.map((c) => c[i].length)));
  const line = (c: string[]): string => `| ${c.map((v, i) => v.padEnd(widths[i])).join(' | ')} |`;
  const rule = `|${widths.map((w) => '-'.repeat(w + 2)).join('|')}|`;
  return [line(header), rule, ...cells.map(line)].join('\n');
}
