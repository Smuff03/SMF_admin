import { useLayoutEffect, useRef, useState } from 'react';
import { kfmt } from '../utils.js';

function useWidth() {
  const ref = useRef(null);
  const [w, setW] = useState(600);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    setW(Math.max(260, el.clientWidth));
    const ro = new ResizeObserver(([e]) => setW(Math.max(260, Math.floor(e.contentRect.width))));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  return [ref, w];
}

function niceMax(max) {
  const raw = max / 4 || 1;
  const p = 10 ** Math.floor(Math.log10(raw));
  const step = [1, 1.5, 2, 2.5, 3, 5, 10].map((m) => m * p).find((s) => s >= raw);
  return { step, top: step * 4 };
}

function Axes({ w, h, L, R, T, B, top, step, format }) {
  return [0, 1, 2, 3, 4].map((i) => {
    const y = T + ((h - T - B) * (4 - i)) / 4;
    return (
      <g key={i}>
        <line x1={L} x2={w - R} y1={y} y2={y} stroke="#e5e7eb" />
        <text x={L - 10} y={y + 4} textAnchor="end" fontSize="12" fill="#94a3b8">{format(i * step)}</text>
      </g>
    );
  });
}

export function AreaChart({ data, labels, height = 290, format = kfmt }) {
  const [ref, w] = useWidth();
  const [hover, setHover] = useState(null);
  const L = 54, R = 8, T = 10, B = 30, h = height;
  const { step, top } = niceMax(Math.max(...data));
  const x = (i) => L + (i * (w - L - R)) / Math.max(1, data.length - 1);
  const y = (v) => T + (h - T - B) * (1 - v / top);
  const pts = data.map((v, i) => [x(i), y(v)]);
  const line = pts.map(([px, py], i) => (i ? `C${(pts[i - 1][0] + px) / 2},${pts[i - 1][1]} ${(pts[i - 1][0] + px) / 2},${py} ${px},${py}` : `M${px},${py}`)).join(' ');
  const area = `${line} L${x(data.length - 1)},${y(0)} L${x(0)},${y(0)} Z`;
  const every = data.length <= 10 ? 1 : Math.round(data.length / 7);
  const move = (e) => {
    const rect = e.currentTarget.getBoundingClientRect();
    setHover(Math.min(data.length - 1, Math.max(0, Math.round(((e.clientX - rect.left - L) / (w - L - R)) * (data.length - 1)))));
  };
  return (
    <div ref={ref} className="chart">
      <svg width={w} height={h} onMouseMove={move} onMouseLeave={() => setHover(null)} role="img" aria-label="Sales over time">
        <defs>
          <linearGradient id="area-g" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0" stopColor="#22c55e" stopOpacity=".22" /><stop offset="1" stopColor="#22c55e" stopOpacity="0" />
          </linearGradient>
        </defs>
        <Axes {...{ w, h, L, R, T, B, top, step, format }} />
        <path d={area} fill="url(#area-g)" />
        <path d={line} fill="none" stroke="#16a34a" strokeWidth="2.5" strokeLinecap="round" />
        {labels.map((l, i) => (i % every === 0 || (i === data.length - 1 && data.length - 1 - Math.floor((data.length - 1) / every) * every >= every / 2)) && (
          <text key={i} x={x(i)} y={h - 8} textAnchor="middle" fontSize="12" fill="#94a3b8">{l}</text>
        ))}
        {hover !== null && <><line x1={x(hover)} x2={x(hover)} y1={T} y2={y(0)} stroke="#cbd5e1" strokeDasharray="3 3" /><circle cx={x(hover)} cy={y(data[hover])} r="5" fill="#fff" stroke="#16a34a" strokeWidth="2.5" /></>}
      </svg>
      {hover !== null && (
        <div className="tip" style={{ left: Math.min(Math.max(x(hover), 70), w - 70), top: Math.max(y(data[hover]) - 52, 0) }}>
          <b>{`₹${data[hover].toLocaleString('en-IN')}`}</b><span>Day {labels[hover]}</span>
        </div>
      )}
    </div>
  );
}

export function BarChart({ data, height = 240, format = kfmt }) {
  const [ref, w] = useWidth();
  const L = 54, R = 8, T = 10, B = 30, h = height;
  const { step, top } = niceMax(Math.max(...data.map((d) => d.value), 1));
  const slot = (w - L - R) / data.length;
  const bw = Math.min(44, slot * 0.6);
  return (
    <div ref={ref} className="chart">
      <svg width={w} height={h} role="img" aria-label="Bar chart">
        <Axes {...{ w, h, L, R, T, B, top, step, format }} />
        {data.map((d, i) => {
          const y = T + (h - T - B) * (1 - d.value / top);
          return (
            <g key={d.label}>
              <rect x={L + slot * i + (slot - bw) / 2} y={y} width={bw} height={h - B - y} rx="6" fill="#22c55e"><title>{`${d.label}: ₹${d.value.toLocaleString('en-IN')}`}</title></rect>
              <text x={L + slot * i + slot / 2} y={h - 8} textAnchor="middle" fontSize="12" fill="#94a3b8">{d.label}</text>
            </g>
          );
        })}
      </svg>
    </div>
  );
}

export function Donut({ parts, size = 200, stroke = 24, children }) {
  const r = (size - stroke) / 2, c = 2 * Math.PI * r;
  const total = parts.reduce((a, p) => a + p.value, 0) || 1;
  let offset = 0;
  return (
    <div className="donut" style={{ width: size, height: size }}>
      <svg viewBox={`0 0 ${size} ${size}`} width={size} height={size} style={{ transform: 'rotate(-90deg)' }} role="img" aria-label="Sales mix">
        {parts.map((p) => {
          const len = (p.value / total) * c;
          const el = <circle key={p.label} cx={size / 2} cy={size / 2} r={r} fill="none" stroke={p.color} strokeWidth={stroke} strokeDasharray={`${len} ${c - len}`} strokeDashoffset={-offset} />;
          offset += len;
          return el;
        })}
      </svg>
      <div className="donut-c">{children}</div>
    </div>
  );
}

export function HBars({ data, color = '#22c55e', suffix = '' }) {
  const max = Math.max(...data.map((d) => d.value), 1);
  return (
    <div className="hbars">
      {data.map((d) => (
        <div key={d.label} className="hbar">
          <div className="hbar-t"><span>{d.label}</span><b>{d.value.toLocaleString('en-IN')}{suffix}</b></div>
          <div className="bar"><i style={{ width: `${(d.value / max) * 100}%`, background: color }} /></div>
        </div>
      ))}
    </div>
  );
}
