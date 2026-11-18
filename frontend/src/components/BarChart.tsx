import { useId, useState } from "react";

export type BarDatum = { label: string; value: number };

type Props = {
  title: string;
  data: BarDatum[];
  formatValue: (value: number) => string;
  formatLabel?: (label: string) => string;
  height?: number;
};

const WIDTH = 720;
const PAD = { top: 12, right: 8, bottom: 26, left: 56 };

/** Rounded upper corners, square at the baseline. */
function columnPath(x: number, y: number, w: number, h: number): string {
  const r = Math.min(4, w / 2, h);
  return `M${x},${y + h} V${y + r} Q${x},${y} ${x + r},${y} H${x + w - r} Q${x + w},${y} ${x + w},${y + r} V${y + h} Z`;
}

function niceMax(value: number): number {
  if (value <= 0) return 1;
  const exponent = 10 ** Math.floor(Math.log10(value));
  const fraction = value / exponent;
  const step = fraction <= 1 ? 1 : fraction <= 2 ? 2 : fraction <= 5 ? 5 : 10;
  return step * exponent;
}

/**
 * Single-series column chart: one hue, thin columns from one baseline,
 * recessive hairline grid, hover tooltip and an equivalent data table.
 */
export function BarChart({
  title,
  data,
  formatValue,
  formatLabel = (label) => label,
  height = 200,
}: Props) {
  const id = useId();
  const [active, setActive] = useState<number | null>(null);
  const [showTable, setShowTable] = useState(false);
  const max = niceMax(Math.max(0, ...data.map((d) => d.value)));
  const plotW = WIDTH - PAD.left - PAD.right;
  const plotH = height - PAD.top - PAD.bottom;
  const band = plotW / Math.max(data.length, 1);
  const barW = Math.min(24, Math.max(2, band - 2));
  const ticks = [0, max / 2, max];
  const labelEvery = Math.ceil(data.length / 8);
  const current = active !== null ? data[active] : null;

  return (
    <figure className="m-0">
      <figcaption className="mb-2 flex items-center justify-between gap-2">
        <span className="font-mono text-xs uppercase tracking-wider text-fg-dim" id={`${id}-title`}>
          {title}
        </span>
        <button
          type="button"
          className="text-xs text-fg-dim hover:text-fg"
          onClick={() => setShowTable((v) => !v)}
        >
          {showTable ? "Ver gráfico" : "Ver tabla"}
        </button>
      </figcaption>

      {showTable ? (
        <div className="max-h-64 overflow-auto">
          <table className="w-full text-sm">
            <tbody>
              {data.map((d) => (
                <tr key={d.label} className="border-b border-line">
                  <td className="py-1 text-fg-muted">{formatLabel(d.label)}</td>
                  <td className="py-1 text-right text-fg">{formatValue(d.value)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <div className="relative">
          <svg
            viewBox={`0 0 ${WIDTH} ${height}`}
            className="h-auto w-full"
            role="img"
            aria-labelledby={`${id}-title`}
            onMouseMove={(event) => {
              const box = event.currentTarget.getBoundingClientRect();
              const x = ((event.clientX - box.left) / box.width) * WIDTH;
              const index = Math.floor((x - PAD.left) / band);
              setActive(index >= 0 && index < data.length ? index : null);
            }}
            onMouseLeave={() => setActive(null)}
          >
            <title>{title}</title>
            {ticks.map((tick) => {
              const y = PAD.top + plotH - (tick / max) * plotH;
              return (
                <g key={tick}>
                  <line
                    x1={PAD.left}
                    x2={WIDTH - PAD.right}
                    y1={y}
                    y2={y}
                    stroke="var(--color-line)"
                    strokeWidth={1}
                  />
                  <text
                    x={PAD.left - 8}
                    y={y + 4}
                    textAnchor="end"
                    fontSize={11}
                    fill="var(--color-fg-dim)"
                  >
                    {formatValue(tick)}
                  </text>
                </g>
              );
            })}
            {data.map((d, i) => {
              const h = (d.value / max) * plotH;
              const x = PAD.left + i * band + (band - barW) / 2;
              return (
                <g key={d.label}>
                  {/* Hover band: the whole column slot, wider than the mark. */}
                  <rect
                    x={PAD.left + i * band}
                    y={PAD.top}
                    width={band}
                    height={plotH}
                    fill={active === i ? "var(--color-overlay)" : "transparent"}
                    pointerEvents="none"
                  />
                  {d.value > 0 ? (
                    <path
                      d={columnPath(x, PAD.top + plotH - h, barW, h)}
                      fill="var(--color-accent)"
                      opacity={active === null || active === i ? 1 : 0.55}
                      pointerEvents="none"
                    />
                  ) : null}
                  {i % labelEvery === 0 ? (
                    <text
                      x={x + barW / 2}
                      y={height - 8}
                      textAnchor="middle"
                      fontSize={11}
                      fill="var(--color-fg-dim)"
                    >
                      {formatLabel(d.label)}
                    </text>
                  ) : null}
                </g>
              );
            })}
          </svg>
          {current && active !== null ? (
            <div
              className="pointer-events-none absolute top-0 rounded-ui border border-line bg-raised px-3 py-2 text-xs shadow-lg"
              style={{
                left: `${((PAD.left + active * band + band / 2) / WIDTH) * 100}%`,
                transform: active > data.length / 2 ? "translateX(-105%)" : "translateX(5%)",
              }}
            >
              <p className="text-fg-dim">{formatLabel(current.label)}</p>
              <p className="font-medium text-fg">{formatValue(current.value)}</p>
            </div>
          ) : null}
        </div>
      )}
    </figure>
  );
}
