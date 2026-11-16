/* The scrolling story: each <section class="step"> names a layout in data-step; as the
 * reader scrolls into a step, every building's dot moves to its place in that layout (CSS
 * transitions on an SVG). Numbers in the prose are not typed in: a <b data-fact="..."> is
 * computed here from story.json's rows, and test/story.test.mjs checks each against the
 * `check` block build_story.py computed in python. Modelled on lecture-flu/story. */
import { layout, peaks, onPeak, onSecond, gap, dist, COL, STEPS } from './layout.js';

const fmt = (n) => n.toLocaleString('en-US');
export const EAST = 700; // metres east of the anchor: the line chapter 3 draws

export function numbers(D) {
  const { p1, n1, p2, n2 } = peaks(D);
  const outer = D.rows.filter((r) => dist(r) >= D.core);
  const area = D.rows.reduce((t, r) => t + r.a, 0);
  const second = D.rows.filter((r) => onSecond(D, r));
  return {
    n: D.rows.length, peak: p1, n_peak: n1, expect: (D.rows.length * 2 * D.half) / 90,
    peak2: p2, n_2nd: n2,
    area_share: D.rows.filter((r) => onPeak(D, r)).reduce((t, r) => t + r.a, 0) / area,
    outer_n: outer.length, outer_peak: outer.filter((r) => onPeak(D, r)).length,
    outer_expect: (outer.length * 2 * D.half) / 90,
    anchor_o: D.rows.find((r) => r.n === D.anchor).o,
    east_peak: D.rows.filter((r) => onPeak(D, r) && r.x > EAST).length,
    east_2nd: second.filter((r) => r.x > EAST).length,
  };
}

/* "n_peak" -> "160". Unknown names throw: a typo must not render as blank */
export function fact(D, spec) {
  const N = numbers(D);
  switch (spec) {
    case 'n': return fmt(N.n);
    case 'n_peak': return fmt(N.n_peak);
    case 'half': return `${D.half}°`;
    case 'turn': return `${90 - N.peak}°`;
    case 'expect': return N.expect.toFixed(0);
    case 'times': return (N.n_peak / N.expect).toFixed(0);
    case 'area_share': return `${Math.round(N.area_share * 100)}%`;
    case 'anchor_o': return `${(90 - N.anchor_o).toFixed(1)}°`;
    case 'n_2nd': return fmt(N.n_2nd);
    case 'apart': return `${gap(N.peak, N.peak2)}°`;
    case 'east': return `${EAST} m`;
    case 'east_2nd': return fmt(N.east_2nd);
    case 'core': return `${D.core} m`;
    case 'outer_n': return fmt(N.outer_n);
    case 'outer_peak': return fmt(N.outer_peak);
    case 'outer_expect': return N.outer_expect.toFixed(0);
    default: throw new Error(`unknown fact ${spec}`);
  }
}

const row = (D, n) => D.rows.find((r) => r.n === n);
/* labelled dots per step: (D) -> [[row, text]] */
export const LABELS = {
  map: (D) => [[row(D, D.anchor), D.anchor]],
  angle: (D) => [[row(D, D.anchor), D.anchor]],
  quad: (D) => [[row(D, D.anchor), D.anchor], [row(D, 'Gates Computer Science'), 'Gates']],
  second: (D) => [[row(D, 'Maples Pavilion'), 'Maples Pavilion']],
  outer: (D) => [[row(D, D.anchor), D.anchor]],
};

const NS = 'http://www.w3.org/2000/svg';
const el = (tag, attrs = {}) => { const e = document.createElementNS(NS, tag); for (const k in attrs) e.setAttribute(k, attrs[k]); return e; };

async function main() {
  const D = await (await fetch('story.json')).json();
  for (const e of document.querySelectorAll('[data-fact]')) e.textContent = fact(D, e.dataset.fact);
  for (const name of Object.keys(LABELS)) for (const [r] of LABELS[name](D)) if (!r) throw new Error(`label row missing on ${name}`);

  const steps = [...document.querySelectorAll('.step')];
  for (const s of steps) if (!STEPS[s.dataset.step]) throw new Error(`unknown step ${s.dataset.step}`);
  const plot = document.getElementById('plot');
  const svg = el('svg', { id: 'chart' });
  const gAxis = el('g', { class: 'axis' }), gDots = el('g'), gLab = el('g', { class: 'labels' });
  svg.append(gAxis, gDots, gLab);
  plot.append(svg);
  const dots = D.rows.map((r) => {
    const c = gDots.appendChild(el('circle', { r: 3 }));
    c.append(el('title'));
    c.firstChild.textContent = `${r.n}: walls ${(90 - r.o).toFixed(1)}° from north, ${fmt(r.a)} m²`;
    return c;
  });
  const tick = (x, y, text, cls = 'tick') => { const t = el('text', { x, y, class: cls }); t.textContent = text; gAxis.append(t); };

  let shown = -1;
  const draw = (i) => {
    const name = steps[i].dataset.step;
    const box = plot.getBoundingClientRect(), W = box.width, H = box.height;
    svg.setAttribute('viewBox', `0 0 ${W} ${H}`);
    const L = layout(name, D, W, H), N = numbers(D);
    L.dots.forEach((d, k) => {
      const c = dots[k];
      c.style.transform = `translate(${d.x}px, ${d.y}px)`;
      c.setAttribute('r', d.r);
      c.style.fill = d.fill;
      c.style.opacity = d.op;
    });
    gAxis.replaceChildren();
    if (L.kind === 'angle') {
      // the two windows as bands, degrees turned from north along the bottom
      for (const [c, cls] of [[N.peak, 'band'], [N.peak2, 'band2']])
        gAxis.append(el('rect', { x: L.X(c + D.half), width: L.X(c - D.half) - L.X(c + D.half), y: 0, height: H, class: cls }));
      for (let v = 0; v <= 90; v += 15) {
        gAxis.append(el('line', { x1: L.X(90 - v), x2: L.X(90 - v), y1: H, y2: H + 4, class: 'grid' }));
        tick(L.X(90 - v), H + 16, `${v}°`, 'tick mid');
      }
      tick(W / 2, H + 32, 'walls turned clockwise from north', 'tick mid');
    } else {
      // a scale bar and a north arrow: the map is to scale, north up
      const len = 500 * L.s, y = H + 14;
      gAxis.append(el('line', { x1: 0, x2: len, y1: y, y2: y, class: 'scale' }));
      tick(0, y + 14, '0'); tick(len, y + 14, '500 m', 'tick mid');
      tick(W - 4, 12, 'N ↑', 'tick end');
      if (name === 'outer') gAxis.append(el('circle', { cx: L.X(0), cy: L.Y(0), r: D.core * L.s, class: 'core' }));
      if (name === 'second') gAxis.append(el('line', { x1: L.X(EAST), x2: L.X(EAST), y1: 0, y2: H, class: 'east' }));
    }
    gLab.replaceChildren();
    for (const [r, text] of LABELS[name](D)) {
      const d = L.dots[D.rows.indexOf(r)];
      gLab.append(el('circle', { cx: d.x, cy: d.y, r: d.r + 2.5, class: 'ring' }));
      const right = d.x < W * 0.6;
      const tx = el('text', { x: d.x + (right ? 1 : -1) * (d.r + 5), y: d.y - d.r - 3, class: `lab${right ? '' : ' end'}` });
      tx.textContent = text;
      gLab.append(tx);
    }
    document.body.dataset.step = i;
    window.__story = { step: i, name, shown: L.dots.filter((d) => d.op > 0).length };
  };

  const pick = () => {
    const line = innerHeight * 0.5;
    let i = 0;
    for (let k = 0; k < steps.length; k++) if (steps[k].getBoundingClientRect().top < line) i = k;
    if (i !== shown) { shown = i; draw(i); }
  };
  addEventListener('scroll', pick, { passive: true });
  addEventListener('resize', () => { shown = -1; pick(); });
  pick();
}

export { COL };

if (typeof document !== 'undefined') main().catch((e) => {
  document.body.classList.add('failed');
  document.getElementById('err').textContent = String(e.message || e);
  console.error(e);
});
