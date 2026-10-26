/* game-logic.js — everything about a round that is not the DOM.
 *
 * Kept separate so it can be run headless by game-logic.test.mjs, which is a publish
 * gate: a game that silently asks the same building twice, or offers four names none of
 * which is right, is broken in a way a screenshot does not show.
 *
 * Geometry convention, fixed by build.py: `p` is a flat [x0,y0,x1,y1,…] ring in metres
 * east/north of the campus bounding box's south-west corner. North is up and stays up —
 * orientation is a real cue and rotating it away would make the game harder by hiding
 * information rather than by asking more.
 */
(function (root) {
  "use strict";

  /** mulberry32 — a small, seedable PRNG. The daily puzzle has to be the same puzzle
   *  for everyone who opens it, and a test cannot assert anything about Math.random. */
  function rng(seed) {
    let a = seed >>> 0;
    return function () {
      a = (a + 0x6d2b79f5) >>> 0;
      let t = a;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  /** "2026-10-26" -> a stable 32-bit seed (FNV-1a). */
  function seedFor(dayString) {
    let h = 2166136261 >>> 0;
    for (let i = 0; i < dayString.length; i++) {
      h ^= dayString.charCodeAt(i);
      h = Math.imul(h, 16777619) >>> 0;
    }
    return h >>> 0;
  }

  /** The campus day, in Stanford's zone — not the viewer's. A phone in another
   *  time zone must get the same daily puzzle as a phone on the Quad (campus-clock). */
  function campusDay(now) {
    return new Intl.DateTimeFormat("en-CA", {
      timeZone: "America/Los_Angeles",
      year: "numeric", month: "2-digit", day: "2-digit",
    }).format(now || new Date());
  }

  function bbox(p) {
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    for (let i = 0; i < p.length; i += 2) {
      if (p[i] < x0) x0 = p[i];
      if (p[i] > x1) x1 = p[i];
      if (p[i + 1] < y0) y0 = p[i + 1];
      if (p[i + 1] > y1) y1 = p[i + 1];
    }
    return { x0: x0, y0: y0, x1: x1, y1: y1, w: x1 - x0, h: y1 - y0 };
  }

  /** Fit a ring into a box, preserving aspect and flipping y (SVG grows downward,
   *  metres north grow upward — getting this wrong mirrors every building). */
  function pathFor(p, boxW, boxH, pad) {
    pad = pad == null ? 8 : pad;
    const b = bbox(p);
    const s = Math.min((boxW - 2 * pad) / (b.w || 1), (boxH - 2 * pad) / (b.h || 1));
    const ox = (boxW - b.w * s) / 2, oy = (boxH - b.h * s) / 2;
    let d = "";
    for (let i = 0; i < p.length; i += 2) {
      const x = ox + (p[i] - b.x0) * s;
      const y = boxH - oy - (p[i + 1] - b.y0) * s;
      d += (i ? "L" : "M") + x.toFixed(1) + " " + y.toFixed(1);
    }
    return { d: d + "Z", scale: s, box: b };
  }

  const BARS = [5, 10, 20, 25, 50, 100, 200, 500];

  /** A scale bar is the difference between "an L-shaped thing" and "a 90 m L-shaped
   *  thing". Pick the nice round length nearest a quarter of the drawing. */
  function scaleBar(pxPerMetre, boxW) {
    const want = (boxW * 0.25) / pxPerMetre;
    let best = BARS[0];
    for (const m of BARS) if (Math.abs(m - want) < Math.abs(best - want)) best = m;
    return { metres: best, px: best * pxPerMetre };
  }

  /** The family a name belongs to: "Studio 5" and "Studio 1" are one, and so are the
   *  four "Escondido Village, EVGR Bldg A..D". It matters because the player is shown a
   *  shape and four names — offer two names from one family and the round stops being
   *  answerable from the drawing, since nothing on screen says which sibling it is.
   *  A trailing index (number, single letter, "Bldg C") or compass word is the marker. */
  function family(name) {
    return String(name).toLowerCase()
      .replace(/[\s,]+(?:bldg\.?|building)?\s*(?:[0-9]+[a-z]?|[a-z]|east|west|north|south)$/i, "")
      .trim() || String(name).toLowerCase();
  }

  function shape(b) {
    const g = bbox(b.p);
    const long = Math.max(g.w, g.h), short = Math.min(g.w, g.h);
    return { aspect: long / (short || 1), verts: b.p.length / 2, area: b.a, fill: b.f };
  }

  /** Two buildings whose outlines are the same outline. The player is shown one shape
   *  and four names; if a distractor's footprint is indistinguishable from the answer's,
   *  two of the four names are defensible and the round cannot be won on evidence. */
  function tooSimilar(a, b) {
    const x = shape(a), y = shape(b);
    return x.verts === y.verts &&
      Math.abs(x.aspect - y.aspect) / Math.max(x.aspect, y.aspect) < 0.02 &&
      Math.abs(x.area - y.area) / Math.max(x.area, y.area) < 0.05 &&
      Math.abs(x.fill - y.fill) < 0.02;
  }

  /** Wrong names, chosen from buildings of a similar size so that the scale bar
   *  narrows the field without handing over the answer. */
  function distractors(answer, all, rnd, k) {
    const near = all
      .filter(function (b) {
        return b.n !== answer.n && !tooSimilar(b, answer) &&
          family(b.n) !== family(answer.n);
      })
      .map(function (b) {
        return { b: b, d: Math.abs(Math.log(b.a || 1) - Math.log(answer.a || 1)) };
      })
      .sort(function (p, q) { return p.d - q.d || (p.b.n < q.b.n ? -1 : 1); })
      .slice(0, 30)
      .map(function (e) { return e.b; });
    const out = [];
    const pool = near.slice();
    while (out.length < k && pool.length) {
      out.push(pool.splice(Math.floor(rnd() * pool.length), 1)[0]);
    }
    return out;
  }

  function shuffled(list, rnd) {
    const a = list.slice();
    for (let i = a.length - 1; i > 0; i--) {
      const j = Math.floor(rnd() * (i + 1));
      const t = a[i]; a[i] = a[j]; a[j] = t;
    }
    return a;
  }

  /** n rounds, deterministic in `seed`. Answers are drawn only from the playable pool
   *  (q=1: >= 8 vertices, bbox fill < 0.92, >= 600 m^2 — measured in build.py); wrong
   *  names may be any named building, so "it looks distinctive" is never itself a tell. */
  function pickRounds(all, seed, n, choices, landmarks) {
    n = n || 10;
    choices = choices || 4;
    landmarks = landmarks == null ? 4 : landmarks;
    const rnd = rng(seed);
    const playable = all.filter(function (b) { return b.q === 1; });
    if (playable.length < n) throw new Error("not enough playable outlines: " + playable.length);
    /* Guarantee a few buildings somebody outside OSM thought notable (w=1), so a day is
       winnable by knowing the campus and not only by matching shapes. Then shuffle the
       whole ten, or the known ones would always be rounds 1-4. */
    const marks = shuffled(playable.filter(function (b) { return b.w === 1; }), rnd);
    const rest = shuffled(playable.filter(function (b) { return b.w !== 1; }), rnd);
    const want = Math.min(landmarks, marks.length, n);
    const chosen = shuffled(marks.slice(0, want).concat(rest.slice(0, n - want)), rnd);
    const pool = chosen.length === n ? chosen : shuffled(playable, rnd).slice(0, n);
    const rounds = [];
    for (let i = 0; i < n; i++) {
      const answer = pool[i];
      const names = shuffled(
        [answer].concat(distractors(answer, all, rnd, choices - 1)), rnd
      ).map(function (b) { return b.n; });
      rounds.push({ answer: answer, choices: names, correct: names.indexOf(answer.n) });
    }
    return rounds;
  }

  function score(picked, rounds) {
    let right = 0;
    for (let i = 0; i < rounds.length; i++) {
      if (picked[i] != null && picked[i] === rounds[i].correct) right++;
    }
    return { right: right, total: rounds.length };
  }

  /** The copyable result. No board, no spoilers: squares only, like the puzzle games
   *  this borrows the idea from, so pasting it cannot give the day away. */
  function shareText(picked, rounds, day) {
    const s = score(picked, rounds);
    const squares = rounds.map(function (r, i) {
      return picked[i] === r.correct ? "\u{1F7E9}" : "\u{2B1C}";
    }).join("");
    return "Stanford Outlines " + day + "  " + s.right + "/" + s.total + "\n" +
      squares + "\nhttps://matmat202.github.io/stanford-outlines/";
  }

  const api = {
    rng: rng, seedFor: seedFor, campusDay: campusDay, bbox: bbox, pathFor: pathFor,
    scaleBar: scaleBar, tooSimilar: tooSimilar, distractors: distractors, family: family,
    shuffled: shuffled, pickRounds: pickRounds, score: score, shareText: shareText,
    MIN_VERTS: 8, MAX_FILL: 0.92, MIN_AREA: 600,
  };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else root.GameLogic = api;
})(typeof self !== "undefined" ? self : this);
