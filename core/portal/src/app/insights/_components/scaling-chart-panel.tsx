// MCPForge — W0-J20 closing pass: the scaling-invariant chart (task item 4),
// now real instead of `DeferredPanel`. 03 §5.3: "TTFC for unrelated roles
// across wave boundaries, with the 5% band drawn. A wave that breaks the
// invariant should be visible as a line leaving a band, not as a number in a
// table." That needs a wave-over-wave series; this repo has exactly ONE
// committed baseline snapshot (`evals/baseline.json`), itself recorded over
// an empty catalogue and an empty intents suite. Fabricating a second point
// or a trend line to make the invariant band meaningful would be exactly the
// dishonesty CLAUDE.md §8 forbids — so this renders that one real point,
// honestly labelled as pre-scaling / single-baseline, and nothing else. No
// band is drawn: a 5% band around a single point asserts an invariant that
// has not been tested across a single wave boundary yet. The next real
// baseline (`forge bench --record-baseline`, run at the next wave boundary)
// is what turns this into the two-point start of a real series.
//
// SVG only — no chart library is vendored in this portal (CLAUDE.md's stack
// list names none), and a single point does not justify adding one. Every
// colour is a `var(--token)` reference (CLAUDE.md §2 no-raw-color), read at
// render time exactly as 02/TASKS.md's "charts read colours from CSS custom
// properties" note requires.
import type { ScalingChartPoint } from '../types';

const WIDTH = 360;
const HEIGHT = 160;
const PAD = { top: 16, right: 20, bottom: 28, left: 40 };
const PLOT_W = WIDTH - PAD.left - PAD.right;
const PLOT_H = HEIGHT - PAD.top - PAD.bottom;

export interface ScalingChartPanelProps {
  readonly point: ScalingChartPoint | null;
}

export function ScalingChartPanel({ point }: ScalingChartPanelProps) {
  return (
    <section
      aria-labelledby="scaling-chart-heading"
      data-testid="insights-scaling-chart"
      className="rounded-lg border border-line bg-bg-surface p-4"
    >
      <h3 id="scaling-chart-heading" className="mb-1 text-sm font-bold text-text-1">
        Scaling-invariant chart (TTFC vs. catalogue size)
      </h3>
      <p className="mb-3 max-w-[80ch] text-[11.5px] text-text-2">
        03 §5.3: TTFC for unrelated roles across wave boundaries, with a ±5% band so a wave that
        breaks the invariant reads as a line leaving the band. Only one baseline snapshot has ever
        been recorded, so there is no series yet — no band is drawn, and no second point is
        invented to draw one.
      </p>

      {point === null ? (
        <p data-testid="insights-scaling-chart-empty" className="text-[12.5px] text-text-2">
          No committed baseline read at <code>evals/baseline.json</code> — there is no point to
          plot yet.
        </p>
      ) : (
        <ScalingChartSinglePoint point={point} />
      )}
    </section>
  );
}

function ScalingChartSinglePoint({ point }: { readonly point: ScalingChartPoint }) {
  const x = PAD.left + PLOT_W / 2;
  const y = PAD.top + PLOT_H / 2;
  const ttfcText = point.ttfcCoreHitMax === null ? 'n/a (n=0)' : `${Math.round(point.ttfcCoreHitMax)} tokens`;

  return (
    <div className="flex flex-col gap-2">
      <div
        data-testid="insights-scaling-chart-badge"
        className="w-fit rounded-full border border-status-write-border bg-status-write-bg px-2 py-0.5 text-[11px] font-semibold text-status-write-strong"
      >
        pre-scaling — single baseline, more waves needed for a trend line
      </div>

      <svg
        role="img"
        aria-label={`Single baseline point: ${point.toolsInCatalogue} tools in catalogue, TTFC core-hit max ${ttfcText}, recorded ${point.recorded}${point.provisional ? ', provisional' : ''}`}
        viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
        width="100%"
        height={HEIGHT}
        data-testid="insights-scaling-chart-svg"
      >
        {/* axes */}
        <line
          x1={PAD.left}
          y1={PAD.top}
          x2={PAD.left}
          y2={HEIGHT - PAD.bottom}
          style={{ stroke: 'var(--line-strong)' }}
          strokeWidth={1}
        />
        <line
          x1={PAD.left}
          y1={HEIGHT - PAD.bottom}
          x2={WIDTH - PAD.right}
          y2={HEIGHT - PAD.bottom}
          style={{ stroke: 'var(--line-strong)' }}
          strokeWidth={1}
        />
        <text x={PAD.left} y={HEIGHT - 8} style={{ fill: 'var(--text-3)' }} fontSize={9}>
          catalogue size (tools)
        </text>
        <text
          x={10}
          y={PAD.top + 6}
          style={{ fill: 'var(--text-3)' }}
          fontSize={9}
          transform={`rotate(-90 10 ${PAD.top + 6})`}
        >
          TTFC core-hit max
        </text>

        {/* the one real point */}
        <circle
          cx={x}
          cy={y}
          r={5}
          data-testid="insights-scaling-chart-point"
          style={{ fill: point.provisional ? 'var(--status-write-strong)' : 'var(--accent)' }}
        />
        <text
          x={x + 10}
          y={y - 10}
          style={{ fill: 'var(--text-1)' }}
          fontSize={10}
          data-testid="insights-scaling-chart-point-label"
        >
          {point.toolsInCatalogue} tools · {ttfcText}
        </text>
      </svg>

      <p data-testid="insights-scaling-chart-caption" className="text-[11px] text-text-2">
        Recorded {point.recorded} at <code>evals/baseline.json</code>
        {point.provisional
          ? ' — provisional: recorded over an empty catalogue and/or empty intents suite (every value here is "nothing was measured", not "measured at zero").'
          : '.'}{' '}
        Unblocked by: recording a real baseline per wave (<code>forge bench --record-baseline</code>)
        until a second point exists to connect.
      </p>
    </div>
  );
}
