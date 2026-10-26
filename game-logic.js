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
    return roundsFor(pool, all, rnd, choices);
  }

  /** One round per answer, in the order given, wrong names drawn from `all` by the same
   *  rules as the daily (similar size, no twin footprint, no sibling name). */
  function roundsFor(answers, all, rnd, choices) {
    return answers.map(function (answer) {
      const names = shuffled(
        [answer].concat(distractors(answer, all, rnd, (choices || 4) - 1)), rnd
      ).map(function (b) { return b.n; });
      return { answer: answer, choices: names, correct: names.indexOf(answer.n) };
    });
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
    return shareEntry(entryFor(picked, rounds), day);
  }

  /** The same text from a stored day — what a reloaded end screen copies. */
  function shareEntry(e, day) {
    const squares = e.n.map(function (n, i) {
      return e.c[i] != null && e.c[i] === n ? "\u{1F7E9}" : "\u{2B1C}";
    }).join("");
    return "Stanford Outlines " + day + "  " + rightCount(e) + "/" + e.n.length + "\n" +
      squares + "\nhttps://matmat202.github.io/stanford-outlines/";
  }

  /* ---- the daily record ----------------------------------------------------
   * A daily puzzle that forgets you played it is not a daily puzzle: a reload handed
   * back round 1, so today's ten could be replayed until perfect, and nothing knew a
   * streak existed. What is kept per campus day is the ten ANSWER NAMES and what was
   * chosen, by name — not indices into a round list. buildings.json is rebuilt on
   * republish, and if today's rounds come out different after that, a stored index
   * would silently point at another building; a stored name cannot. */

  const KEY = "outlines.v1";

  /** One day's entry from a game in progress: n = the answers, c = the names chosen
   *  (null where not yet answered). */
  function entryFor(picked, rounds) {
    return {
      n: rounds.map(function (r) { return r.answer.n; }),
      c: rounds.map(function (r, i) { return picked[i] == null ? null : r.choices[picked[i]]; }),
    };
  }

  function complete(e) {
    return !!e && Array.isArray(e.c) && e.c.length > 0 && e.c.every(function (x) { return x != null; });
  }

  function rightCount(e) {
    let k = 0;
    for (let i = 0; i < e.n.length; i++) if (e.c[i] != null && e.c[i] === e.n[i]) k++;
    return k;
  }

  /** A stored record, from whatever localStorage held: junk, an old shape, or nothing
   *  all read as an empty history rather than throwing the game away on load. */
  function parseHistory(raw) {
    let h = null;
    try { h = JSON.parse(raw); } catch (e) { h = null; }
    if (!h || typeof h !== "object" || !h.days || typeof h.days !== "object" || Array.isArray(h.days)) {
      return { days: {} };
    }
    const days = {};
    Object.keys(h.days).forEach(function (d) {
      const e = h.days[d];
      if (/^\d{4}-\d{2}-\d{2}$/.test(d) && e && Array.isArray(e.n) && Array.isArray(e.c) &&
          e.n.length === e.c.length && e.n.length > 0) days[d] = { n: e.n, c: e.c };
    });
    return { days: days };
  }

  /** Record progress on `day`. A finished day is never overwritten: the first full game
   *  is the day's result, so replaying after a reload cannot improve it. Returns a new
   *  history; the old one is not mutated. */
  function record(hist, day, entry) {
    const days = Object.assign({}, hist.days);
    if (!complete(days[day])) days[day] = { n: entry.n.slice(), c: entry.c.slice() };
    return { days: days };
  }

  /** What to do with today's rounds given a stored entry: picked indices to resume
   *  from, or null when the entry is for a different ten (data changed) or absent. */
  function resume(entry, rounds) {
    if (!entry || entry.n.length !== rounds.length) return null;
    for (let i = 0; i < rounds.length; i++) if (entry.n[i] !== rounds[i].answer.n) return null;
    const picked = [];
    for (let i = 0; i < rounds.length; i++) {
      if (entry.c[i] == null) { picked.push(null); continue; }
      const k = rounds[i].choices.indexOf(entry.c[i]);
      if (k < 0) return null;
      picked.push(k);
    }
    /* Answers are given in order, so a gap before a later answer is a corrupt entry. */
    const first = picked.indexOf(null);
    if (first >= 0 && picked.slice(first).some(function (x) { return x != null; })) return null;
    return picked;
  }

  /** "2026-10-26" -> "2026-10-25", by calendar, in UTC so no DST hour can skip a day. */
  function prevDay(d) {
    const t = Date.UTC(+d.slice(0, 4), +d.slice(5, 7) - 1, +d.slice(8, 10)) - 86400000;
    return new Date(t).toISOString().slice(0, 10);
  }

  /** played, current streak, best streak, and how many days scored each 0..n. A streak
   *  is consecutive campus days with a finished game; it is still alive today if
   *  yesterday was played and today is not yet, because the day is not over. */
  function stats(hist, today) {
    const done = Object.keys(hist.days).filter(function (d) { return complete(hist.days[d]); }).sort();
    const set = new Set(done);
    let size = 0;
    done.forEach(function (d) { size = Math.max(size, hist.days[d].n.length); });
    const dist = new Array(Math.max(size, 10) + 1).fill(0);
    done.forEach(function (d) { dist[rightCount(hist.days[d])]++; });
    let best = 0, run = 0, prev = null;
    done.forEach(function (d) {
      run = prev !== null && prevDay(d) === prev ? run + 1 : 1;
      if (run > best) best = run;
      prev = d;
    });
    let streak = 0;
    let d = set.has(today) ? today : prevDay(today);
    while (set.has(d)) { streak++; d = prevDay(d); }
    return { played: done.length, streak: streak, best: best, dist: dist };
  }


  /* ---- misses: practise what you got wrong ------------------------------------
   * A building missed in the daily comes back a median 8 days later (p90 35, measured
   * over 365 seeded days), so the daily alone never tells you whether you learned it.
   * A miss stays open until that building is answered right — on a later daily, or in
   * a misses round. Fixes are a second record, by name and campus day, so a miss on a
   * day after the fix reopens it. */

  const FIXED_KEY = "outlines.fixed.v1";

  /** {name: "YYYY-MM-DD"} from whatever localStorage held; junk reads as empty. */
  function parseFixed(raw) {
    let h = null;
    try { h = JSON.parse(raw); } catch (e) { h = null; }
    const out = {};
    if (!h || typeof h !== "object" || Array.isArray(h)) return out;
    Object.keys(h).forEach(function (n) {
      if (typeof h[n] === "string" && /^\d{4}-\d{2}-\d{2}$/.test(h[n])) out[n] = h[n];
    });
    return out;
  }

  /** Mark the names answered right in a misses round as fixed on `day`. New object. */
  function fix(fixed, names, day) {
    const out = Object.assign({}, fixed);
    names.forEach(function (n) { if (!out[n] || out[n] < day) out[n] = day; });
    return out;
  }

  /** The open misses, newest miss first, as building records still in `all`'s playable
   *  pool (a rebuild can drop a building; its miss is then unaskable, not an error).
   *  A day's unanswered rounds are not misses — the game was just not finished. */
  function misses(hist, fixed, all) {
    const lastMiss = {}, lastRight = {};
    Object.keys(hist.days).sort().forEach(function (d) {
      const e = hist.days[d];
      e.n.forEach(function (n, i) {
        if (e.c[i] == null) return;
        if (e.c[i] === n) lastRight[n] = d; else lastMiss[n] = d;
      });
    });
    const by = {};
    all.forEach(function (b) { if (b.q === 1) by[b.n] = b; });
    return Object.keys(lastMiss).filter(function (n) {
      const ok = [lastRight[n], fixed[n]].filter(Boolean).sort().pop();
      return by[n] && !(ok && ok >= lastMiss[n]);
    }).sort(function (a, b) {
      return lastMiss[a] < lastMiss[b] ? 1 : lastMiss[a] > lastMiss[b] ? -1 : (a < b ? -1 : 1);
    }).map(function (n) { return by[n]; });
  }

  /** Up to n rounds from the open misses, the newest first, shuffled within the game. */
  function missRounds(open, all, seed, n) {
    const rnd = rng(seed);
    return roundsFor(shuffled(open.slice(0, n || 10), rnd), all, rnd);
  }

  /* ---- areas: practise one part of campus ------------------------------------ */

  function centre(b) {
    let x = 0, y = 0;
    const n = b.p.length / 2;
    for (let i = 0; i < b.p.length; i += 2) { x += b.p[i]; y += b.p[i + 1]; }
    return [x / n, y / n];
  }

  /** Split campus into k areas by where its playable buildings cluster (k-means on
   *  footprint centres, farthest-point start, so the same data always gives the same
   *  areas and no Math.random is involved). Every named building then joins its nearest
   *  area, so wrong names come from the same part of campus as the answer. Each area is
   *  named after a building in it ("Around Maples Pavilion" is checkable, an invented
   *  neighbourhood name would not be), and the page also draws it on a map. Sorted by x. */
  function areas(all, k) {
    k = k || 5;
    const play = all.filter(function (b) { return b.q === 1; })
      .slice().sort(function (a, b) { return a.n < b.n ? -1 : 1; });
    const pts = play.map(centre);
    const d2 = function (a, b) { return (a[0] - b[0]) * (a[0] - b[0]) + (a[1] - b[1]) * (a[1] - b[1]); };
    let first = 0;
    pts.forEach(function (p, i) { if (p[0] < pts[first][0]) first = i; });
    const cen = [pts[first]];
    while (cen.length < k) {
      let bi = 0, bd = -1;
      pts.forEach(function (p, i) {
        const m = Math.min.apply(null, cen.map(function (c) { return d2(p, c); }));
        if (m > bd) { bd = m; bi = i; }
      });
      cen.push(pts[bi]);
    }
    const nearest = function (p) {
      let bi = 0;
      for (let j = 1; j < cen.length; j++) if (d2(p, cen[j]) < d2(p, cen[bi])) bi = j;
      return bi;
    };
    let g = [];
    for (let it = 0; it < 100; it++) {
      const ng = pts.map(nearest);
      if (ng.join() === g.join()) break;
      g = ng;
      for (let j = 0; j < k; j++) {
        let sx = 0, sy = 0, c = 0;
        pts.forEach(function (p, i) { if (g[i] === j) { sx += p[0]; sy += p[1]; c++; } });
        if (c) cen[j] = [sx / c, sy / c];
      }
    }
    const order = cen.map(function (c, j) { return j; })
      .sort(function (a, b) { return cen[a][0] - cen[b][0]; });
    const rank = {};
    order.forEach(function (j, r) { rank[j] = r; });
    const of = {};
    all.forEach(function (b) { of[b.n] = rank[nearest(centre(b))]; });
    const used = {};
    const list = order.map(function (j, r) {
      const mine = all.filter(function (b) { return of[b.n] === r; });
      /* The biggest notable building is the one a newcomer has most likely walked past;
         an area with none (Escondido Village has no w=1 entry) falls back to its biggest
         playable one, and "Escondido Village, EVGR Bldg A" is shown as its estate. */
      const biggest = function (pool) {
        return pool.filter(function (b) { return !used[b.n]; })
          .sort(function (a, b) { return b.a - a.a || (a.n < b.n ? -1 : 1); })[0];
      };
      const mark = biggest(mine.filter(function (b) { return b.w === 1; })) ||
        biggest(mine.filter(function (b) { return b.q === 1; }));
      used[mark.n] = true;
      return {
        label: "Around " + mark.n.split(",")[0], near: mark.n, centre: cen[j],
        named: mine.length, playable: mine.filter(function (b) { return b.q === 1; }).length,
      };
    });
    return { list: list, of: of };
  }

  /** The buildings of area i, for pickRounds: answers and wrong names both from there. */
  function inArea(all, A, i) {
    return all.filter(function (b) { return A.of[b.n] === i; });
  }

  const api = {
    rng: rng, seedFor: seedFor, campusDay: campusDay, bbox: bbox, pathFor: pathFor,
    scaleBar: scaleBar, tooSimilar: tooSimilar, distractors: distractors, family: family,
    shuffled: shuffled, pickRounds: pickRounds, score: score, shareText: shareText, shareEntry: shareEntry,
    KEY: KEY, entryFor: entryFor, complete: complete, rightCount: rightCount,
    parseHistory: parseHistory, record: record, resume: resume, prevDay: prevDay, stats: stats,
    centre: centre, areas: areas, inArea: inArea, roundsFor: roundsFor,
    FIXED_KEY: FIXED_KEY, parseFixed: parseFixed, fix: fix, misses: misses, missRounds: missRounds,
    MIN_VERTS: 8, MAX_FILL: 0.92, MIN_AREA: 600,
  };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else root.GameLogic = api;
})(typeof self !== "undefined" ? self : this);
