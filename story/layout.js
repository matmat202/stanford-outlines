/* Where each building's dot sits on each step of the story. Pure: no DOM, so
 * test/story.test.mjs runs every layout at several plot sizes.
 *
 * One dot per named building. On a map step it sits where the building is (metres east and
 * north of Hoover Tower, north up, to scale), sized by its footprint; on the angle step it
 * is stacked in a histogram of facings, one column per degree.
 */
/* per-dataset memo: the colour of each dot asks these, and recomputing per dot is O(n^2) */
const memo = (f) => { const m = new WeakMap(); return (D) => { if (!m.has(D)) m.set(D, f(D)); return m.get(D); }; };
export const COL = { ink: '#16202a', peak: '#b8322a', second: '#1f5f8b', dim: '#c9cbd1', faint: '#e3e4e8' };

/* degrees between two facings, on the 90-degree circle (python's gap) */
export const gap = (a, b) => Math.abs((((a - b + 45) % 90) + 90) % 90 - 45);
export const dist = (r) => Math.hypot(r.x, r.y);

/* the fullest +-half window, centres every half degree; first wins ties, as in python */
export function bestWindow(D, avoid = null) {
  let best = [-1, null];
  for (let k = 0; k < 180; k++) {
    const c = k / 2;
    if (avoid != null && gap(c, avoid) < D.apart) continue;
    const n = D.rows.filter((r) => gap(r.o, c) <= D.half).length;
    if (n > best[0]) best = [n, c];
  }
  return best;
}
export const peaks = memo((D) => { const [n1, p1] = bestWindow(D); const [n2, p2] = bestWindow(D, p1); return { p1, n1, p2, n2 }; });
export const onPeak = (D, r) => gap(r.o, peaks(D).p1) <= D.half;
export const onSecond = (D, r) => gap(r.o, peaks(D).p2) <= D.half;

const both = (D, r) => (onPeak(D, r) ? 'peak' : onSecond(D, r) ? 'second' : 'dim');
/* step -> [kind, colour(r) -> key of COL] */
export const STEPS = {
  map: ['map', () => 'ink'],
  angle: ['angle', both],
  quad: ['map', (D, r) => (onPeak(D, r) ? 'peak' : 'dim')],
  second: ['map', both],
  outer: ['map', (D, r) => (dist(r) < D.core ? 'faint' : onPeak(D, r) ? 'peak' : 'dim')],
};

const bounds = memo((D) => {
  const xs = D.rows.map((r) => r.x), ys = D.rows.map((r) => r.y);
  return [Math.min(...xs), Math.max(...xs), Math.min(...ys), Math.max(...ys)];
});
/* each row's place in its degree column, by facing then name */
const stack = memo((D) => {
  const cols = new Map(), at = new Map();
  for (const r of [...D.rows].sort((a, b) => a.o - b.o || (a.n < b.n ? -1 : 1))) {
    const b = Math.min(89, Math.floor(r.o));
    const k = cols.get(b) || 0;
    at.set(r, [b, k]); cols.set(b, k + 1);
  }
  return { at, max: Math.max(...cols.values()) };
});

/* -> {kind, X, Y, s, dots: [{x, y, r, fill, op}] in px of a w x h box, same order as D.rows} */
export function layout(name, D, w, h) {
  const [kind, colour] = STEPS[name] || (() => { throw new Error(`unknown step ${name}`); })();
  const pad = 8;
  if (kind === 'angle') {
    const { at, max } = stack(D);
    // x runs by degrees turned clockwise from north (90 - facing), so 0 is on the left
    const X = (o) => pad + ((90 - o) / 90) * (w - 2 * pad);
    const step = Math.min((w - 2 * pad) / 90, (h - 2 * pad) / max);
    const r = Math.max(1.2, step / 2 - 0.2);
    const dots = D.rows.map((row) => {
      const [b, k] = at.get(row);
      return { x: X(b + 0.5), y: h - pad - (k + 0.5) * step, r, fill: COL[colour(D, row)], op: 1 };
    });
    return { kind, X, Y: null, s: null, step, dots };
  }
  const [x0, x1, y0, y1] = bounds(D), m = 8; // m: room for the biggest dot
  const s = Math.min((w - 2 * pad - 2 * m) / (x1 - x0), (h - 2 * pad - 2 * m) / (y1 - y0));
  const ox = (w - s * (x1 - x0)) / 2, oy = (h - s * (y1 - y0)) / 2;
  const X = (x) => ox + (x - x0) * s, Y = (y) => h - oy - (y - y0) * s;
  const dots = D.rows.map((row) => ({
    x: X(row.x), y: Y(row.y), r: Math.max(2, Math.min(m, Math.sqrt(row.a) * s * 0.55)),
    fill: COL[colour(D, row)], op: 1,
  }));
  return { kind, X, Y, s, dots };
}
