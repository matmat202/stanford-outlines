/* Run: node site/game-logic.test.mjs   (a publish gate)
 *
 * What this is actually guarding. A quiz fails quietly: four names with none right, the
 * same building twice in one game, a mirrored outline, a "daily" puzzle that differs by
 * the viewer's time zone — none of those throw, and none show up in a screenshot. Every
 * check below is one of those failures, written so that it would go red.
 */
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const G = require("./game-logic.js");
const DATA = require("./data/buildings.json");

let pass = 0;
const fails = [];
function ok(name, cond, detail) {
  if (cond) pass++;
  else fails.push(name + (detail ? " — " + detail : ""));
}
const eq = (name, a, b) => ok(name, Object.is(a, b), `got ${JSON.stringify(a)}, want ${JSON.stringify(b)}`);

/* ---- the baked data ------------------------------------------------------- */
const B = DATA.buildings;
ok("data: buildings present", B.length > 250, `${B.length}`);
ok("data: playable pool is big enough for a 10-round game",
   B.filter((b) => b.q === 1).length >= 40,
   `${B.filter((b) => b.q === 1).length} playable`);
eq("data: counts.playable matches the rows", DATA.counts.playable, B.filter((b) => b.q === 1).length);
ok("data: every name is unique (two outlines under one name = two right answers)",
   new Set(B.map((b) => b.n)).size === B.length);
ok("data: every ring has at least 3 points and an even coordinate count",
   B.every((b) => b.p.length >= 6 && b.p.length % 2 === 0));
ok("data: every ring is inside the declared campus box",
   B.every((b) => b.p.every((v, i) => v >= 0 && v <= (i % 2 ? DATA.campus.h : DATA.campus.w) + 1)));
ok("data: the playable bars are the ones build.py documents",
   B.filter((b) => b.q === 1).every((b) => b.p.length / 2 >= 8 && b.f < 0.92 && b.a >= 600));
// Palo Alto High School sits on Stanford-leased land inside the box; build.py's not_stanfords
// leaves it out. These names were in 27 of 30 daily puzzles before that existed.
const PALY = ["PAHS Library", "Theater", "Science Building", "Tower Building", "Small Gym",
  "Palo Alto Unified School District", "Escondido Elementary School", "University Lutheran Church"];
ok("data: no Palo Alto school or church is asked or offered as a name",
   B.every((b) => !PALY.includes(b.n)), B.filter((b) => PALY.includes(b.n)).map((b) => b.n).join(", "));
ok("data: build.py recorded what it left out", (DATA.counts.not_stanford || 0) >= 10, `${DATA.counts.not_stanford}`);
ok("data: no playable building is a rectangle", B.filter((b) => b.q === 1 && b.p.length === 8).length === 0);

// The reveal links each building to its OSM way. A link to the wrong way sends the player
// to the wrong building with full confidence, so check every id against the extract it
// claims to come from: the way exists, and carries this building's name.
// The extract sits at ../data here (the sandbox) and at ./data in the public repo, where
// this file ships beside game-logic.js. Neither found is a crash, never a skipped check.
const RAW = (() => {
  for (const p of ["./data/osm.raw.json", "../data/osm.raw.json"]) {
    try { return require(p).elements; } catch (e) { if (e.code !== "MODULE_NOT_FOUND") throw e; }
  }
  throw new Error("osm.raw.json not found at ./data or ../data: the OSM way-id checks cannot run");
})();
const WAY = new Map(RAW.map((e) => [Number(e.id), e]));
ok("data: every building carries a positive integer OSM way id",
   B.every((b) => Number.isInteger(b.o) && b.o > 0), `${B.filter((b) => !(Number.isInteger(b.o) && b.o > 0)).length} without`);
const badWay = B.filter((b) => !WAY.has(b.o) || (WAY.get(b.o).tags || {}).name !== b.n);
ok("data: every OSM way id is a way in the extract with the same name", badWay.length === 0,
   badWay.slice(0, 3).map((b) => b.n + " -> " + b.o).join(", "));
eq("data: no two buildings share a way id", new Set(B.map((b) => b.o)).size, B.length);
eq("osmUrl: links the way", G.osmUrl({ o: 26249523 }), "https://www.openstreetmap.org/way/26249523");
eq("osmUrl: no id, no link", G.osmUrl({ n: "x" }), null);
eq("osmUrl: a non-integer id is no link", G.osmUrl({ o: "26249523" }), null);
// way 0 is not a way: OSM numbers from 1, so a 0 in the data is a missing id, not an id.
eq("osmUrl: way id 0 is a missing id, not a link", G.osmUrl({ o: 0 }), null);
eq("osmUrl: the lowest real way id still links", G.osmUrl({ o: 1 }), "https://www.openstreetmap.org/way/1");

/* ---- the PRNG and the seed ------------------------------------------------ */
const r1 = G.rng(42), r2 = G.rng(42), r3 = G.rng(43);
const take = (f) => [f(), f(), f(), f()];
const a = take(r1), b = take(r2), c = take(r3);
ok("rng: same seed, same stream", JSON.stringify(a) === JSON.stringify(b));
ok("rng: a different seed is a different stream", JSON.stringify(a) !== JSON.stringify(c));
ok("rng: stays in [0,1)", a.every((v) => v >= 0 && v < 1));
eq("seedFor: stable", G.seedFor("2026-10-26"), G.seedFor("2026-10-26"));
ok("seedFor: consecutive days differ", G.seedFor("2026-10-26") !== G.seedFor("2026-10-27"));
ok("seedFor: a 32-bit unsigned integer",
   Number.isInteger(G.seedFor("2026-10-26")) && G.seedFor("2026-10-26") >= 0);

/* ---- campusDay: the daily puzzle is the same puzzle everywhere ------------- */
/* 2026-10-27T05:00Z is still 2026-10-26 on campus (22:00 PDT). A page that used the
   viewer's clock would call it the 27th in Tokyo, London AND here — this laptop is set
   to America/Monterrey — and three people would get three different "daily" puzzles. */
eq("campusDay: 05:00Z belongs to the previous campus day",
   G.campusDay(new Date("2026-10-27T05:00:00Z")), "2026-10-26");
eq("campusDay: 08:00Z is the new campus day", G.campusDay(new Date("2026-10-27T08:00:00Z")), "2026-10-27");
eq("campusDay: after DST ends, 07:30Z is still the previous day",
   G.campusDay(new Date("2026-11-03T07:30:00Z")), "2026-11-02");

/* ---- geometry ------------------------------------------------------------- */
const box = G.bbox([0, 0, 10, 0, 10, 4, 0, 4]);
eq("bbox: width", box.w, 10);
eq("bbox: height", box.h, 4);
const fit = G.pathFor([0, 0, 10, 0, 10, 4, 0, 4], 200, 100, 10);
const pts = fit.d.slice(1, -1).split(/[ML]/).filter(Boolean)
  .map((s) => s.trim().split(" ").map(Number));
ok("pathFor: every point lands inside the box",
   pts.every(([x, y]) => x >= -0.05 && x <= 200.05 && y >= -0.05 && y <= 100.05),
   JSON.stringify(pts));
ok("pathFor: respects the padding", pts.every(([x, y]) => x >= 9.9 && x <= 190.1 && y >= 9.9 && y <= 90.1));
ok("pathFor: closes the ring", fit.d.endsWith("Z"));
/* North up. In metres the third point (10,4) is the NORTH-east corner, so on screen it
   must have a SMALLER y than the first point (0,0). Flip this and every building on the
   site is mirrored, which no other check here would notice. */
ok("pathFor: north is up (y is flipped)", pts[2][1] < pts[0][1], `${pts[2][1]} vs ${pts[0][1]}`);
ok("pathFor: aspect ratio preserved",
   Math.abs((pts[1][0] - pts[0][0]) / (pts[0][1] - pts[2][1]) - 10 / 4) < 1e-6);
const sq = G.pathFor([0, 0, 4, 0, 4, 4, 0, 4], 200, 100, 10).d.slice(1, -1)
  .split(/[ML]/).filter(Boolean).map((s) => s.trim().split(" ").map(Number));
ok("pathFor: a square stays square in a wide box",
   Math.abs((sq[1][0] - sq[0][0]) - (sq[0][1] - sq[2][1])) < 1e-6);

const bar = G.scaleBar(2, 400); /* want ~50 m */
eq("scaleBar: picks the nice length nearest a quarter of the drawing", bar.metres, 50);
eq("scaleBar: reports its own width in pixels", bar.px, 100);
eq("scaleBar: a tight zoom picks a short bar", G.scaleBar(20, 400).metres, 5);

/* ---- distractors ---------------------------------------------------------- */
const answer = B.find((x) => x.q === 1);
const d3 = G.distractors(answer, B, G.rng(7), 3);
eq("distractors: returns the number asked for", d3.length, 3);
ok("distractors: never the answer", d3.every((x) => x.n !== answer.n));
ok("distractors: never an outline indistinguishable from the answer's",
   d3.every((x) => !G.tooSimilar(x, answer)));
ok("tooSimilar: a building is similar to itself", G.tooSimilar(answer, answer));
ok("tooSimilar: a 600 m2 L-shape is not a 16,000 m2 hospital",
   !G.tooSimilar(B.find((x) => x.a < 700 && x.q === 1), B.slice().sort((p, q) => q.a - p.a)[0]));
/* Three candidates, deliberately given in the WRONG order, because a two-element array
   agrees with a broken comparator half the time and with a reversed one always. */
const target = { n: "T", a: 1000, f: 0.5, p: [0, 0, 10, 0, 10, 9, 5, 9, 0, 5] };
const three = [
  { n: "far", a: 100000, f: 0.5, p: [0, 0, 1, 0, 1, 1] },
  { n: "near", a: 1050, f: 0.4, p: [0, 0, 2, 0, 2, 2] },
  { n: "mid", a: 4000, f: 0.3, p: [0, 0, 3, 0, 3, 3] },
];
eq("distractors: the closest in size comes first",
   G.distractors(target, three.concat([target]), G.rng(1), 3).length, 3);
ok("distractors: size-ranking puts 'near' ahead of 'mid' and 'far'",
   (function () {
     const seen = G.distractors(target, three.concat([target]), () => 0, 3).map((x) => x.n);
     return seen[0] === "near" && seen[1] === "mid" && seen[2] === "far";
   })(), "rng()=0 always takes the head, so this reads the sort order directly");

/* ---- rounds --------------------------------------------------------------- */
const seed = G.seedFor("2026-10-26");
const R = G.pickRounds(B, seed, 10);
const R2 = G.pickRounds(B, seed, 10);
const R3 = G.pickRounds(B, G.seedFor("2026-10-27"), 10);
eq("pickRounds: ten rounds", R.length, 10);
// Both defaults, which no other call in this file exercises: every pickRounds call here
// passes n and none passes `choices`, so `n = n || 10` and `choices = choices || 4` were
// invisible. The choices one needs a caller that PASSES a different count -- omitting it
// cannot tell, because roundsFor re-defaults with its own `(choices || 4)`.
eq("pickRounds: n defaults to ten when the caller omits it", G.pickRounds(B, seed).length, 10);
eq("pickRounds: a caller asking for six names per round gets six",
   [...new Set(G.pickRounds(B, seed, 10, 6).map((r) => r.choices.length))].join(), "6");
ok("pickRounds: the same day is the same puzzle",
   JSON.stringify(R.map((r) => [r.answer.n, r.choices])) ===
   JSON.stringify(R2.map((r) => [r.answer.n, r.choices])));
ok("pickRounds: a different day is a different puzzle",
   JSON.stringify(R.map((r) => r.answer.n)) !== JSON.stringify(R3.map((r) => r.answer.n)));
ok("pickRounds: no building is asked twice in one game",
   new Set(R.map((r) => r.answer.n)).size === 10);
ok("pickRounds: `correct` really points at the answer",
   R.every((r) => r.choices[r.correct] === r.answer.n));
ok("pickRounds: four distinct names every round",
   R.every((r) => r.choices.length === 4 && new Set(r.choices).size === 4));
ok("pickRounds: the right answer is not always in the same slot",
   new Set(R.map((r) => r.correct)).size > 1, R.map((r) => r.correct).join(""));
ok("pickRounds: every answer is from the playable pool", R.every((r) => r.answer.q === 1));
ok("pickRounds: refuses a pool it cannot fill",
   (function () { try { G.pickRounds(B.slice(0, 2), seed, 10); return false; } catch (e) { return true; } })());

/* ---- the days already served, pinned by name ------------------------------
 * Everything above checks that a day reproduces ITSELF, which every rng, hash, shuffle
 * and landmark constant satisfies no matter what it deals. So the whole dealing path was
 * unguarded: change the FNV offset, the Fisher-Yates bound, the `30` nearest-by-area
 * slice or the 4 landmarks, and these tests stay green while every past day re-deals.
 *
 * That is not a cosmetic change. A stored day is matched back by building NAME
 * (`resume()` compares entry.n[i] to rounds[i].answer.n), so a re-deal silently discards
 * the player's completed day, breaks every `?day=` replay and invalidates the streak in
 * `stats()`. These two days have been served to the public — the site went live
 * 2026-10-26 — and `game-logic.js`, `app.js` and `data/buildings.json` were verified
 * byte-identical to https://matmat202.github.io/stanford-outlines/ when these were taken.
 *
 * A future session changing the dealing on purpose must re-pin these from the LIVE site,
 * never from the edited local file, and must accept that days already played are lost.
 */
const SERVED = {
  "2026-10-26": {
    answers: ["Stanford Cancer Center", "East Wing", "Meier Hall", "Jack McDonald Hall",
      "Lyman Building 3", "James H. Clark Center",
      "Center for Advanced Study in the Behavioral Sciences", "Kimball Hall",
      "Hewlett Teaching Center", "Pi Beta Phi House"],
    correct: [0, 1, 1, 3, 0, 3, 0, 1, 1, 2],
    round0: ["Stanford Cancer Center", "Arrillaga Family Sports Center", "Bing Wing",
      "Beckman Center for Molecular and Genetic Medicine"],
  },
  "2026-10-27": {
    answers: ["East Wing", "Encina Commons", "Kimball Hall", "Sequoia Hall", "Rinconada",
      "Jack McDonald Hall", "Beckman Center for Molecular and Genetic Medicine",
      "Frances C. Arrillaga Alumni Center", "Mirrielees", "Lathrop Library"],
    correct: [1, 3, 3, 2, 2, 3, 1, 3, 1, 2],
    round0: ["Computing & Data Science", "East Wing", "Stanford ChEM-H Building",
      "Branner Hall"],
  },
};
for (const [day, want] of Object.entries(SERVED)) {
  const got = G.pickRounds(B, G.seedFor(day), 10);
  ok(`served ${day}: the ten buildings are the ones that were played`,
     JSON.stringify(got.map((r) => r.answer.n)) === JSON.stringify(want.answers),
     JSON.stringify(got.map((r) => r.answer.n)));
  // The wrong names and their order are part of the served puzzle too: distractors()
  // and the per-round shuffle have their own constants, and a stored pick is an INDEX
  // into this list, so re-ordering the choices re-scores a finished day.
  ok(`served ${day}: the answer sits in the slot it was played in`,
     JSON.stringify(got.map((r) => r.correct)) === JSON.stringify(want.correct),
     JSON.stringify(got.map((r) => r.correct)));
  ok(`served ${day}: round 1 offers the same four names in the same order`,
     JSON.stringify(got[0].choices) === JSON.stringify(want.round0),
     JSON.stringify(got[0].choices));
}

/* ---- scoring and sharing -------------------------------------------------- */
const allRight = R.map((r) => r.correct);
eq("score: a perfect game", G.score(allRight, R).right, 10);
eq("score: an unanswered round is not a right one", G.score([], R).right, 0);
eq("score: a wrong pick", G.score(allRight.map((c, i) => (i === 0 ? (c + 1) % 4 : c)), R).right, 9);
eq("score: null is not an accidental match for choice 0",
   G.score(R.map(() => null), R).right, R.filter((r) => r.correct === null).length);
const share = G.shareText(allRight.map((c, i) => (i < 8 ? c : (c + 1) % 4)), R, "2026-10-26");
ok("shareText: reports the score", share.includes("8/10"));
ok("shareText: one square per round", (share.match(/\u{1F7E9}|\u{2B1C}/gu) || []).length === 10);
ok("shareText: gives nothing away", R.every((r) => !share.includes(r.answer.n)));

/* ---- families: two siblings in one round is not a question -------------- */
eq("family: Studio 5 and Studio 1 are one family", G.family("Studio 5"), G.family("Studio 1"));
eq("family: the four EVGR blocks are one family",
   G.family("Escondido Village, EVGR Bldg A"), G.family("Escondido Village, EVGR Bldg C"));
ok("family: unrelated halls are not", G.family("Memorial Hall") !== G.family("Maples Pavilion"));
ok("family: a shared last word is not a family",
   G.family("Bing Wing") !== G.family("East Wing"));
/* A positive control, because the obvious version of this check is vacuous: over the
   real data the Studio buildings are not each other's nearest by area, so the filter
   can be deleted and the assertion still passes. This pool is built so that WITHOUT the
   family rule the three siblings are exactly what `distractors` would return. */
const sibPool = [
  { n: "Studio 1", a: 1000, f: 0.5, q: 1, w: 0, p: [0, 0, 10, 0, 10, 9, 5, 9, 0, 5] },
  { n: "Studio 2", a: 1010, f: 0.6, q: 1, w: 0, p: [0, 0, 11, 0, 11, 7, 4, 7] },
  { n: "Studio 3", a: 1020, f: 0.7, q: 1, w: 0, p: [0, 0, 12, 0, 12, 6, 3, 6, 1, 2] },
  { n: "Studio 4", a: 1030, f: 0.8, q: 1, w: 0, p: [0, 0, 13, 0, 13, 5, 2, 5] },
  { n: "Green Library", a: 4000, f: 0.4, q: 1, w: 1, p: [0, 0, 40, 0, 40, 30, 10, 30] },
  { n: "Memorial Church", a: 9000, f: 0.3, q: 1, w: 1, p: [0, 0, 90, 0, 90, 60, 20, 60] },
  { n: "Hoover Tower", a: 300, f: 0.9, q: 0, w: 1, p: [0, 0, 15, 0, 15, 20, 0, 20] },
  { n: "Encina Hall", a: 1200, f: 0.55, q: 1, w: 0, p: [0, 0, 30, 0, 30, 20, 8, 20] },
];
ok("distractors: the control pool really would hand back siblings without the rule",
   sibPool.filter((x) => G.family(x.n) === G.family("Studio 1")).length === 4 &&
   sibPool.filter((x) => x.n !== "Studio 1")
     .sort((p, q) => Math.abs(Math.log(p.a) - Math.log(1000)) - Math.abs(Math.log(q.a) - Math.log(1000)))
     .slice(0, 3).every((x) => /^Studio /.test(x.n)),
   "the three nearest by area must all be Studios, or the next check proves nothing");
ok("distractors: never a sibling of the answer",
   G.distractors(sibPool[0], sibPool, G.rng(3), 3)
     .every((x) => G.family(x.n) !== G.family("Studio 1")),
   JSON.stringify(G.distractors(sibPool[0], sibPool, G.rng(3), 3).map((x) => x.n)));
ok("distractors: and over the real data too",
   B.filter((x) => x.q === 1).slice(0, 60).every((ans) =>
     G.distractors(ans, B, G.rng(3), 3).every((x) => G.family(x.n) !== G.family(ans.n))));

/* ---- the landmark quota -------------------------------------------------- */
ok("data: landmarks are flagged and counted",
   DATA.counts.landmarks === B.filter((b) => b.q === 1 && b.w === 1).length &&
   DATA.counts.landmarks >= 10, `${DATA.counts.landmarks}`);
ok("data: w is a flag", B.every((b) => b.w === 0 || b.w === 1));
eq("pickRounds: four of the ten are externally notable buildings",
   R.filter((r) => r.answer.w === 1).length, 4);
ok("pickRounds: the notable ones are not always rounds 1-4",
   (function () {
     const seen = new Set();
     for (let d = 1; d <= 12; d++) {
       G.pickRounds(B, G.seedFor("2026-11-" + String(d).padStart(2, "0")), 10)
         .forEach((r, i) => { if (r.answer.w === 1) seen.add(i); });
     }
     return seen.size > 4;                      /* landmarks land in more than 4 slots */
   })());
ok("pickRounds: honours a different quota", G.pickRounds(B, seed, 10, 4, 0)
   .filter((r) => r.answer.w === 1).length <= 10);
ok("pickRounds: still works when no building is flagged",
   G.pickRounds(B.map((b) => Object.assign({}, b, { w: 0 })), seed, 10).length === 10);

/* ---- the daily record: a reload must not hand back round 1 ---------------- */
{
  const day = "2026-10-26";
  const R10 = G.pickRounds(B, G.seedFor(day), 10);
  const allRight = R10.map((r) => r.correct);
  const wrongAt = (i) => (R10[i].correct + 1) % R10[i].choices.length;
  const half = allRight.slice(0, 4).concat(Array(6).fill(null));
  const H0 = G.parseHistory(null);
  eq("history: nothing stored reads as empty", Object.keys(H0.days).length, 0);
  for (const junk of ["{", "null", "[]", '{"days":[]}', '{"days":{"x":1}}', '{"days":{"2026-10-26":{"n":["a"],"c":[]}}}'])
    eq("history: junk reads as empty: " + junk, Object.keys(G.parseHistory(junk).days).length, 0);

  // resume mid-game, by name
  const Hh = G.record(H0, day, G.entryFor(half, R10));
  eq("history: record does not mutate its input", Object.keys(H0.days).length, 0);
  const back = G.parseHistory(JSON.stringify(Hh));
  ok("resume: a half-played day comes back at round 5 with the same picks",
     JSON.stringify(G.resume(back.days[day], R10)) === JSON.stringify(half));
  ok("resume: an entry for a different ten is refused, not misapplied",
     G.resume(back.days[day], G.pickRounds(B, G.seedFor("2026-10-27"), 10)) === null);
  eq("resume: same choices but a different answer is refused (the answer is what is stored)",
     G.resume(back.days[day], R10.map((r, i) => i === 7 ? Object.assign({}, r, { answer: { n: "Elsewhere" } }) : r)), null);
  const gap = G.entryFor(half, R10); gap.c[1] = null;
  eq("resume: an entry with a gap before a later answer is refused", G.resume(gap, R10), null);
  const renamed = G.entryFor(half, R10); renamed.c[0] = "No Such Building";
  eq("resume: a chosen name not among today's choices is refused", G.resume(renamed, R10), null);
  ok("resume: choices are matched by name, not index",
     (function () {
       const shifted = R10.map((r) => Object.assign({}, r, { choices: r.choices.slice().reverse(),
         correct: r.choices.length - 1 - r.correct }));
       const p = G.resume(G.entryFor(half, R10), shifted);
       return p && p.slice(0, 4).every((k, i) => shifted[i].choices[k] === R10[i].answer.n);
     })());

  // a finished day is final
  const done = allRight.slice(); done[3] = wrongAt(3);
  const Hd = G.record(Hh, day, G.entryFor(done, R10));
  ok("record: a finished day is complete", G.complete(Hd.days[day]));
  eq("record: the finished day scores 9", G.rightCount(Hd.days[day]), 9);
  const Hr = G.record(Hd, day, G.entryFor(allRight, R10));
  eq("record: replaying a finished day cannot improve it", G.rightCount(Hr.days[day]), 9);
  ok("record: partial progress is overwritten by more progress",
     G.complete(G.record(Hh, day, G.entryFor(allRight, R10)).days[day]));
  ok("resume: a finished day resumes with no unanswered round",
     G.resume(Hd.days[day], R10).indexOf(null) === -1);
  eq("shareEntry: a stored day copies the same text as the live game",
     G.shareEntry(Hd.days[day], day), G.shareText(done, R10, day));

  // dates and streaks
  eq("prevDay: across a month", G.prevDay("2026-11-01"), "2026-10-31");
  eq("prevDay: across a year", G.prevDay("2027-01-01"), "2026-12-31");
  eq("prevDay: leap day", G.prevDay("2028-03-01"), "2028-02-29");
  eq("prevDay: the DST fall-back day is one day", G.prevDay("2026-11-02"), "2026-11-01");
  const fin = (r) => ({ n: Array(10).fill("A"), c: Array(10).fill(null).map((_, i) => (i < r ? "A" : "B")) });
  const H = { days: { "2026-10-20": fin(3), "2026-10-21": fin(5), "2026-10-22": fin(5),
    "2026-10-24": fin(7), "2026-10-25": fin(10), "2026-10-26": { n: Array(10).fill("A"), c: ["A"].concat(Array(9).fill(null)) } } };
  // inserted out of order on purpose: stats must sort
  const Hs = { days: { "2026-10-25": H.days["2026-10-25"], "2026-10-20": H.days["2026-10-20"],
    "2026-10-24": H.days["2026-10-24"], "2026-10-22": H.days["2026-10-22"], "2026-10-21": H.days["2026-10-21"],
    "2026-10-26": H.days["2026-10-26"] } };
  const st = G.stats(Hs, "2026-10-26");
  eq("stats: an unfinished day is not played", st.played, 5);
  eq("stats: streak survives a today not yet finished", st.streak, 2);
  eq("stats: best streak is the longest run, not the latest", st.best, 3);
  eq("stats: distribution counts a score twice", st.dist[5], 2);
  eq("stats: distribution has a 10 slot", st.dist[10], 1);
  eq("stats: distribution has a 0 slot", st.dist.length, 11);
  eq("stats: a missed day breaks the streak", G.stats(Hs, "2026-10-27").streak, 0);
  eq("stats: finishing today extends the streak",
     G.stats(G.record(Hs, "2026-10-26", fin(4)), "2026-10-26").streak, 3);
  eq("stats: empty history", G.stats(H0, day).played, 0);
}

/* ---- what a stored day must and must not be accepted as --------------------
 * Everything above this block exercised the ten-round daily, which is the only shape
 * the daily ever has. But parseHistory/complete/resume are the LOAD path: they read
 * whatever localStorage holds, including a record written by an older build or by
 * another tab, and a misses game is 1..9 rounds, not 10. Nothing checked either edge,
 * so the length guards and the first-round comparison were unguarded in both
 * directions — too strict and too lax both passed.
 */
{
  const one = { n: ["Meier Hall"], c: ["Meier Hall"] };
  const R10 = G.pickRounds(B, G.seedFor("2026-10-26"), 10);

  // --- complete(): the bounds, from both sides
  ok("complete: a one-round entry is finished (a misses game can be one round)",
     G.complete(one));
  ok("complete: an entry with no rounds at all is NOT finished",
     !G.complete({ n: [], c: [] }));
  ok("complete: an unanswered round is not finished", !G.complete({ n: ["A"], c: [null] }));

  // --- parseHistory(): more shapes of junk, and the one-round day it must KEEP
  for (const junk of ["{}", '{"days":5}', '{"days":"x"}', '{"days":null}', "5", '"text"',
                      '{"days":{"2026-10-26":{"n":[],"c":[]}}}',
                      '{"days":{"26-10-26":{"n":["A"],"c":["A"]}}}'])
    eq("history: junk reads as empty: " + junk, Object.keys(G.parseHistory(junk).days).length, 0);
  eq("history: a one-round day is kept, not discarded as malformed",
     Object.keys(G.parseHistory(JSON.stringify({ days: { "2026-10-26": one } })).days).length, 1);

  // --- resume(): the first round is part of the comparison, and so is a gap at 0
  eq("resume: no stored entry at all is null, not a throw", G.resume(null, R10), null);
  eq("resume: undefined is null, not a throw", G.resume(undefined, R10), null);
  eq("resume: a different FIRST building is refused — the re-deal case, and the one a "
     + "loop starting at round 1 would wave through",
     G.resume(Object.assign({}, G.entryFor(R10.map((r) => r.correct), R10),
                            { n: ["Elsewhere"].concat(R10.slice(1).map((r) => r.answer.n)) }),
              R10),
     null);
  {
    // A gap at index 0 with a later answer: answers are given in order, so this is
    // corrupt. `first >= 0` must include round 0 itself.
    const g = G.entryFor(R10.map((r) => r.correct), R10);
    g.c[0] = null;
    eq("resume: a gap at round 1 with later answers is refused", G.resume(g, R10), null);
  }

  // --- stats() on an empty history: every figure is zero, not just `played`
  const empty = G.stats({ days: {} }, "2026-10-26");
  eq("stats: empty history has played 0", empty.played, 0);
  eq("stats: empty history has NO best streak", empty.best, 0);
  eq("stats: empty history has no current streak", empty.streak, 0);

  // --- shareEntry: the squares have to mean what they say
  // COUNTING the greens is not enough and this test said so the hard way: flipping
  // `===` to `!==` in shareEntry greens the WRONG rounds and blanks the right one,
  // which leaves the counts identical. The grid has to be pinned position by position,
  // and against a case where the right answer is not the first round — otherwise
  // "one green somewhere" passes either way. rightCount keeps using `===`, so under
  // that mutant the header says 1/3 while the grid shows the wrong square green.
  {
    const GREEN = "\u{1F7E9}", BLANK = "\u{2B1C}";
    const line = (e) => G.shareEntry(e, "2026-10-26").split("\n")[1];
    eq("share: right, wrong, unanswered -> green, blank, blank",
       line({ n: ["A", "B", "C"], c: ["A", "Wrong", null] }), GREEN + BLANK + BLANK);
    eq("share: the green moves with the right answer, it is not just a count",
       line({ n: ["A", "B", "C"], c: ["Wrong", "B", null] }), BLANK + GREEN + BLANK);
    eq("share: an all-wrong game has no green at all",
       line({ n: ["A", "B"], c: ["x", "y"] }), BLANK + BLANK);
    eq("share: the header score agrees with the grid",
       G.shareEntry({ n: ["A", "B", "C"], c: ["A", "Wrong", null] }, "2026-10-26")
         .split("\n")[0].slice(-3), "1/3");
  }
}

/* ---- the reveal's close-up ------------------------------------------------ */
// On a phone the outline has scrolled off by the time the answer is named, so the close-up
// is where the shape is seen again. A window that misses it (the y flip dropped, the centre
// off) shows the player some other street with nothing picked out, and nothing throws.
{
  const H = DATA.campus.h;
  const flipped = (b) => { const k = G.bbox(b.p); return { x0: k.x0, x1: k.x1, y0: H - k.y1, y1: H - k.y0 }; };
  let outside = [], tight = [], alone = 0;
  for (const b of B.filter((x) => x.q === 1)) {
    const v = G.closeView(b, H, 260), k = flipped(b);
    const m = Math.min(k.x0 - v.x, v.x + v.s - k.x1, k.y0 - v.y, v.y + v.s - k.y1);
    if (m < 0) outside.push(b.n);
    else if (m < v.s / 4) tight.push(b.n);
    const near = B.some((o) => o !== b && (() => { const q = flipped(o);
      return q.x1 > v.x && q.x0 < v.x + v.s && q.y1 > v.y && q.y0 < v.y + v.s; })());
    if (!near) alone++;
  }
  eq("closeView: every playable answer is drawn inside its close-up", outside.length, 0);
  eq("closeView: with a quarter of the window to spare on every side", tight.length, 0);
  ok("closeView: nearly every close-up shows a neighbour (it is context, not a second outline)",
     alone <= 5, `${alone} alone`);
  const small = G.closeView({ p: [0, 0, 10, 0, 10, 10, 0, 10] }, 100, 260);
  // The page calls closeView without a minSpan on the whole-campus view; the default is
  // the floor the comment promises, not whatever Math.max does with undefined.
  eq("closeView: minSpan defaults to 260 when the caller omits it",
     G.closeView({ p: [0, 0, 10, 0, 10, 10, 0, 10] }, 100).s, 260);
  eq("closeView: a small building still gets the minimum window", small.s, 260);
  eq("closeView: its scale bar is a round number about a quarter across", small.bar, 50);
  const big = G.closeView({ p: [0, 0, 400, 0, 400, 100, 0, 100] }, 1000, 260);
  eq("closeView: a big one gets three times its longer side", big.s, 1200);
  eq("closeView: centred on it, y flipped", [big.x, big.y].join(), [200 - 600, 1000 - 50 - 600].join());
}

/* ---- neighbours: the close-up's grey shapes, named ---------------------------- */
// The reveal numbers these on the close-up and lists them under it. A wrong list names a
// building that is not where the number sits, or one the window does not show at all,
// and on a phone it reads as fact: nothing throws.
{
  const sq = (n, x, y) => ({ n, p: [x - 5, y - 5, x + 5, y - 5, x + 5, y + 5, x - 5, y + 5] });
  const me = sq("Me", 500, 500);
  const all = [me, sq("Far", 500, 700), sq("North", 500, 570), sq("East", 590, 500), sq("288", 520, 500),
    sq("Me", 470, 500), sq("West", 400, 500), sq("West", 440, 500), sq("Out", 900, 500)];
  const v = G.closeView(me, 1000, 260), N = G.neighbours(me, all, v, 1000, 3);
  eq("neighbours: nearest first, at most k", N.map((o) => o.n).join(), "West,North,East");
  eq("neighbours: a name shared by two shapes is listed once, at the nearer", N[0].m, 60);
  eq("neighbours: drawn in map units, y flipped", [N[1].x, N[1].y].join(), [500, 1000 - 570].join());
  eq("neighbours: none outside the window", G.neighbours(me, all, v, 1000, 9).map((o) => o.n).join(), "West,North,East");
  eq("neighbours: distance rounded to 10 m", G.neighbours(me, [me, sq("A", 534, 500)], v, 1000).map((o) => o.m).join(), "30");
  const H = DATA.campus.h, play = B.filter((x) => x.q === 1);
  let three = 0, bad = [];
  for (const b of play) {
    const w = G.closeView(b, H, 260), n = G.neighbours(b, B, w, H, 3);
    if (n.length === 3) three++;
    for (const o of n) if (o.n === b.n || !(o.x > w.x && o.x < w.x + w.s && o.y > w.y && o.y < w.y + w.s)) bad.push(b.n + ">" + o.n);
  }
  eq("neighbours: every listed one is a different building inside the window", bad.length, 0);
  ok("neighbours: nearly every reveal names three", three >= play.length - 15, `${three}/${play.length}`);
  const lathrop = B.find((x) => x.n === "Lathrop Library");
  eq("neighbours: Lathrop Library's nearest is Memorial Hall (OSM, beside it on Memorial Way)",
     G.neighbours(lathrop, B, G.closeView(lathrop, H, 260), H)[0].n, "Memorial Hall");
}

// The window is half-open on every side: a building whose centre lands exactly on an edge
// is NOT in it, because the close-up is clipped there and the number would sit on the rim
// with nothing under it. All four comparisons are separate, so all four are checked.
{
  const sq = (n, x, y) => ({ n, p: [x - 5, y - 5, x + 5, y - 5, x + 5, y + 5, x - 5, y + 5] });
  const me = sq("Me", 500, 500);
  const v = G.closeView(me, 1000, 260);           // x 370..630, y 370..630 in flipped units
  eq("neighbours: the window's own corner coordinates", [v.x, v.y, v.s].join(), "370,370,260");
  // y is flipped (campusH - centre-y), so the raw y of a south-edge shape is 630, not 370.
  const edges = [me, sq("WestEdge", 370, 500), sq("EastEdge", 630, 500),
    sq("SouthEdge", 500, 630), sq("NorthEdge", 500, 370)];
  eq("neighbours: a centre exactly on an edge is outside the window",
     G.neighbours(me, edges, v, 1000, 9).map((o) => o.n).join(), "");
  // ... and one step inside each edge is in it, so the check above is not vacuous.
  const inside = [me, sq("WestIn", 371, 500), sq("EastIn", 629, 500),
    sq("SouthIn", 500, 629), sq("NorthIn", 500, 371)];
  eq("neighbours: one metre inside each edge is in the window",
     G.neighbours(me, inside, v, 1000, 9).map((o) => o.n).sort().join(),
     "EastIn,NorthIn,SouthIn,WestIn");
  // Two shapes under one name, exactly equidistant: the dedup keeps the first the caller
  // gave. Nothing above picks between them -- the tie-break compares names, and these are
  // the same name -- so this pins which one the list shows, in both input orders.
  const twins = [me, sq("Twin", 440, 500), sq("Twin", 560, 500)];
  eq("neighbours: two equidistant shapes under one name keep input order",
     G.neighbours(me, twins, v, 1000).map((o) => o.x).join(), "440");
  eq("neighbours: ... and the other way round, so it is order, not position",
     G.neighbours(me, [me, sq("Twin", 560, 500), sq("Twin", 440, 500)], v, 1000)
       .map((o) => o.x).join(), "560");

  // k defaults to 3: the reveal has room for three names under the close-up.
  const five = [me, sq("K1", 510, 500), sq("K2", 520, 500), sq("K3", 530, 500), sq("K4", 540, 500)];
  eq("neighbours: k defaults to three when the caller omits it",
     G.neighbours(me, five, v, 1000).map((o) => o.n).join(), "K1,K2,K3");
}

/* ---- areas: practise one part of campus ----------------------------------- */
{
  const A = G.areas(B);
  eq("areas: five of them", A.list.length, 5);
  eq("areas: the same data gives the same areas (no randomness in the split)",
     JSON.stringify(G.areas(B)), JSON.stringify(A));
  ok("areas: every named building is in exactly one area",
     B.every((b) => Number.isInteger(A.of[b.n]) && A.of[b.n] >= 0 && A.of[b.n] < A.list.length));
  eq("areas: named counts add up to every building",
     A.list.reduce((t, a) => t + a.named, 0), B.length);
  ok("areas: labels are distinct", new Set(A.list.map((a) => a.label)).size === A.list.length);
  ok("areas: ordered west to east",
     A.list.every((a, i) => i === 0 || A.list[i - 1].centre[0] <= a.centre[0]));
  A.list.forEach((a, i) => {
    const mine = G.inArea(B, A, i);
    ok(`areas[${i}]: enough playable outlines for ten rounds`, a.playable >= 10, `${a.playable}`);
    eq(`areas[${i}]: playable count matches its rows`, a.playable, mine.filter((b) => b.q === 1).length);
    ok(`areas[${i}]: named after a building that is in it`, A.of[a.near] === i, a.near);
    for (const seed of [1, 99, 123456789]) {
      const r = G.pickRounds(mine, seed, 10);
      ok(`areas[${i}] seed ${seed}: ten different answers`, new Set(r.map((x) => x.answer.n)).size === 10);
      ok(`areas[${i}] seed ${seed}: every answer and wrong name is from this area`,
         r.every((x) => x.choices.every((n) => A.of[n] === i)),
         r.flatMap((x) => x.choices).filter((n) => A.of[n] !== i).join("; "));
      ok(`areas[${i}] seed ${seed}: four names, the answer among them`,
         r.every((x) => x.choices.length === 4 && new Set(x.choices).size === 4 &&
                        x.choices[x.correct] === x.answer.n));
    }
  });
  /* A synthetic campus, so the split itself is checked and not only today's data:
     three tight clumps far apart must come back as exactly those three. */
  const sq = (n, x, y, q) => ({ n, a: 900, f: 0.5, q, w: 0, p: [x, y, x + 30, y, x + 30, y + 30, x, y + 30] });
  const toy = [];
  [[0, 0], [5000, 0], [0, 5000]].forEach(([x, y], c) => {
    for (let j = 0; j < 4; j++) toy.push(sq(`c${c}-${j}`, x + j * 40, y, 1));
  });
  const T = G.areas(toy, 3);
  ok("areas: three far-apart clumps split into exactly those three",
     [0, 1, 2].every((c) => new Set(toy.filter((b) => b.n.startsWith(`c${c}-`)).map((b) => T.of[b.n])).size === 1) &&
     new Set(Object.values(T.of)).size === 3);
  eq("areas: the west-most clump is area 0", T.of["c0-0"] === 0 || T.of["c2-0"] === 0, true);
  eq("areas: a comma'd estate name is shown as the estate",
     G.areas([sq("Escondido Village, EVGR Bldg A", 0, 0, 1)], 1).list[0].label, "Around Escondido Village");
}

/* ---- misses ---------------------------------------------------------------- */
{
  const P = B.filter((b) => b.q === 1);
  const [a, b, c, d] = P.map((x) => x.n);
  const wrong = P[10].n;
  const day = (n, c) => ({ n, c });
  /* Three misses on three days, listed out of order, so a sort that only swaps a pair
     cannot pass by luck. */
  const hist = { days: {
    "2026-10-21": day([b, a], [wrong, a]),         // b missed 21st, a right
    "2026-10-23": day([c], [wrong]),                // c missed 23rd
    "2026-10-20": day([d, a], [wrong, wrong]),     // d and a missed 20th (a fixed 21st)
  } };
  eq("misses: newest miss first, a later right answer closes one",
     G.misses(hist, {}, B).map((x) => x.n).join("|"), [c, b, d].join("|"));
  eq("misses: a fix on the miss day closes it",
     G.misses(hist, { [c]: "2026-10-23" }, B).map((x) => x.n).join("|"), [b, d].join("|"));
  eq("misses: a fix before a later miss does not",
     G.misses(hist, { [c]: "2026-10-22" }, B).map((x) => x.n).join("|"), [c, b, d].join("|"));
  const later = { days: Object.assign({}, hist.days, { "2026-10-25": day([a], [wrong]) }) };
  eq("misses: missing a fixed building again reopens it",
     G.misses(later, {}, B)[0].n, a);
  eq("misses: unanswered rounds of an unfinished day are not misses",
     G.misses({ days: { "2026-10-24": day([a, b], [wrong, null]) } }, {}, B).map((x) => x.n).join("|"), a);
  eq("misses: a building gone from the data is skipped, not thrown",
     G.misses({ days: { "2026-10-24": day(["No Such Hall", a], [wrong, wrong]) } }, {}, B).map((x) => x.n).join("|"), a);
  eq("misses: no history, no misses", G.misses({ days: {} }, {}, B).length, 0);
  const R = G.missRounds(G.misses(hist, {}, B), B, 42);
  ok("missRounds: one round per open miss, each answer offered exactly once",
     R.length === 3 && new Set(R.map((r) => r.answer.n)).size === 3);
  ok("missRounds: four distinct names, the answer among them",
     R.every((r) => r.choices.length === 4 && new Set(r.choices).size === 4 && r.choices[r.correct] === r.answer.n));
  const many = P.slice(0, 25);
  eq("missRounds: capped at ten", G.missRounds(many, B, 1).length, 10);
  ok("missRounds: the cap keeps the newest ten",
     G.missRounds(many, B, 1).every((r) => many.slice(0, 10).includes(r.answer)));
  eq("fix: keeps the later of two days",
     JSON.stringify(G.fix({ [a]: "2026-10-25" }, [a, b], "2026-10-24")),
     JSON.stringify({ [a]: "2026-10-25", [b]: "2026-10-24" }));
  eq("parseFixed: junk is empty", JSON.stringify(G.parseFixed("{nope")), "{}");
  eq("parseFixed: drops a bad date, keeps a good one",
     JSON.stringify(G.parseFixed(JSON.stringify({ x: "yesterday", y: "2026-10-24", z: 3 }))),
     JSON.stringify({ y: "2026-10-24" }));
}

/* ---- pin: find it on the map ---------------------------------------------- */
{
  const sq = { n: "Square", p: [0, 0, 100, 0, 100, 100, 0, 100] };
  const ell = { n: "Ell", p: [0, 0, 100, 0, 100, 40, 40, 40, 40, 100, 0, 100] };
  eq("pin: a tap inside the building is 0 m off", G.pinDistance([50, 50], sq), 0);
  eq("pin: a tap in an L's notch is outside, measured to the nearest wall",
     Math.round(G.pinDistance([70, 70], ell)), 30);
  eq("pin: distance is to a wall, not to a corner", G.pinDistance([50, 130], sq), 30);
  eq("pin: distance past a corner is to the corner", G.pinDistance([130, 140], sq), 50);
  ok("pin: inside() agrees with the L's arms and its notch",
     G.inside([20, 80], ell.p) && G.inside([80, 20], ell.p) && !G.inside([80, 80], ell.p));
  eq("pinPoints: full marks at the wall", G.pinPoints(0), 100);
  eq("pinPoints: full marks up to 25 m", G.pinPoints(25), 100);
  eq("pinPoints: zero at 500 m", G.pinPoints(500), 0);
  eq("pinPoints: zero beyond, never negative", G.pinPoints(2000), 0);
  ok("pinPoints: falls monotonically", [26, 100, 200, 300, 499].map(G.pinPoints)
     .every((v, i, a) => i === 0 || v < a[i - 1]), [26, 100, 200, 300, 499].map(G.pinPoints).join());
  eq("pinPoints: a missing tap scores 0, not NaN", G.pinPoints(undefined), 0);
  // Every real building: a tap at its own centre-of-ring is close (centre can fall in a
  // courtyard, so not always 0, but never a building away).
  const far = B.filter((b) => G.pinDistance(G.centre(b), b) > 60).map((b) => b.n);
  ok("pin: each building's centre is within 60 m of its own walls", far.length === 0, far.join(", "));
  const pool = G.pinPool(B);
  ok("pinPool: big enough for many distinct games, small enough to be findable",
     pool.length >= 100 && pool.every((b) => b.w === 1 || b.a >= 1000), `${pool.length}`);
  ok("pinPool: every notable (w=1) building is in it", B.filter((b) => b.w === 1).every((b) => pool.includes(b)));
  const R = G.pinRounds(B, 7, 10);
  eq("pinRounds: ten rounds", R.length, 10);
  ok("pinRounds: ten distinct name families", new Set(R.map((b) => G.family(b.n))).size === 10);
  eq("pinRounds: same seed, same game", G.pinRounds(B, 7, 10).map((b) => b.n).join("|"), R.map((b) => b.n).join("|"));
  ok("pinRounds: another seed, another game", G.pinRounds(B, 8, 10).map((b) => b.n).join("|") !== R.map((b) => b.n).join("|"));
  let famDup = 0;
  for (let s = 0; s < 300; s++) {
    const g = G.pinRounds(B, s, 10);
    if (new Set(g.map((b) => G.family(b.n))).size !== g.length) famDup++;
  }
  eq("pinRounds: no game in 300 seeds asks two of one family", famDup, 0);
  const sh = G.pinShare([0, 100, 300, 900], "Game #1");
  ok("pinShare: totals the points and draws one square per round",
     /— 226\/400\n/.test(sh) && sh.split("\n")[1] === "\u{1F7E9}\u{1F7E8}\u{1F7E7}\u{2B1C}", JSON.stringify(sh));
}

/* ---- the exact edges of every shared square -------------------------------
 * The equivalence sweep (game-logic.equiv-sweep.mjs) said these bands DO change what a
 * player sees, and nothing here pinned them: every threshold was checked only well
 * inside a band, so `<=` -> `<` at any boundary passed. A square is the whole shared
 * result, so an off-by-one at the edge silently re-grades a game.
 */
{
  const GREEN = "\u{1F7E9}", YELLOW = "\u{1F7E8}", ORANGE = "\u{1F7E7}", BLANK = "\u{2B1C}";
  // pin: on it (<=25 m), close (<=150), near (<=500), off. Both sides of each edge.
  for (const [m, want, why] of [
    [0, GREEN, "a tap inside the building"],
    [G.PIN_FULL, GREEN, "exactly PIN_FULL is still ON it"],
    [G.PIN_FULL + 1, YELLOW, "one metre past PIN_FULL is only close"],
    [150, YELLOW, "exactly 150 m is still close"],
    [151, ORANGE, "one metre past 150 is only near"],
    [G.PIN_ZERO, ORANGE, "exactly PIN_ZERO is still near"],
    [G.PIN_ZERO + 1, BLANK, "past PIN_ZERO is off the map"],
  ]) eq(`pinSquare: ${m} m — ${why}`, G.pinSquare(m), want);
  eq("pinPoints: exactly PIN_FULL is a full hundred", G.pinPoints(G.PIN_FULL), 100);
  eq("pinPoints: exactly PIN_ZERO scores nothing", G.pinPoints(G.PIN_ZERO), 0);
  eq("pinPoints: past PIN_ZERO never goes negative", G.pinPoints(G.PIN_ZERO * 3), 0);
  eq("pinPoints: an unplayed round is not a hundred", G.pinPoints(NaN), 0);
  eq("pinPoints: a negative distance is not a hundred", G.pinPoints(-1), 0);

  // then: THEN_FULL years is spot on, <=5 close, then orange UP TO but NOT including
  // THEN_ZERO — the one band whose edge is `<`, not `<=`.
  for (const [off, want, why] of [
    [0, GREEN, "the exact year"],
    [G.THEN_FULL, GREEN, "exactly THEN_FULL years out is still spot on"],
    [G.THEN_FULL + 1, YELLOW, "one year past THEN_FULL is only close"],
    [5, YELLOW, "exactly five years out is still close"],
    [6, ORANGE, "six years out is only near"],
    [G.THEN_ZERO - 1, ORANGE, "one year inside THEN_ZERO is still near"],
    [G.THEN_ZERO, BLANK, "exactly THEN_ZERO is OFF, not near — this edge is < not <="],
    [-1, BLANK, "a round never answered"],
    [NaN, BLANK, "a round with no guess at all"],
  ]) eq(`thenSquare: ${off} — ${why}`, G.thenSquare(off), want);
  eq("thenPoints: the exact year is a hundred", G.thenPoints(1906, 1906), 100);
  eq("thenPoints: THEN_FULL out is still a hundred", G.thenPoints(1906 + G.THEN_FULL, 1906), 100);
  eq("thenPoints: THEN_ZERO out scores nothing", G.thenPoints(1906 + G.THEN_ZERO, 1906), 0);
  eq("thenPoints: a wild guess never goes negative", G.thenPoints(1500, 1906), 0);

  // pinPool's area floor: a building sitting exactly ON the floor is askable.
  {
    const ring = [0, 0, 0, 10, 10, 10, 10, 0];
    const mk = (n, a, w) => ({ n, a, w, q: 1, f: 0.5, p: ring });
    const pool = G.pinPool([mk("Exactly", 1000, 0), mk("Just under", 999, 0),
                            mk("Tiny but notable", 1, 1)]).map((b) => b.n);
    ok("pinPool: a building exactly on the area floor is askable",
       pool.includes("Exactly"), pool.join("|"));
    ok("pinPool: one square metre under the floor is not", !pool.includes("Just under"),
       pool.join("|"));
    ok("pinPool: a notable building is asked however small", pool.includes("Tiny but notable"));
  }
}

/* ---- misses: two missed on the SAME day are ordered by name ----------------
 * The queue is newest-miss-first; the tie-break is the only thing that decides the
 * order of a day's own misses, and every earlier check used distinct days, so the
 * whole tie branch was unguarded. Three names, handed over in reverse, because V8
 * compares a single pair for a two-element array.
 */
{
  const P = B.filter((b) => b.q === 1).map((b) => b.n).slice().sort();
  const [n1, n2, n3] = [P[0], P[1], P[2]];
  const wrong = "Not A Building";
  const hist = { days: { "2026-10-20": { n: [n3, n2, n1], c: [wrong, wrong, wrong] } } };
  eq("misses: same-day misses come back in name order, not storage order",
     G.misses(hist, {}, B).map((b) => b.n).join("|"), [n1, n2, n3].join("|"));
  const mixed = { days: {
    "2026-10-20": { n: [n3, n1], c: [wrong, wrong] },
    "2026-10-22": { n: [n2], c: [wrong] } } };
  eq("misses: a newer miss still outranks the name order",
     G.misses(mixed, {}, B).map((b) => b.n).join("|"), [n2, n1, n3].join("|"));
}

/* ---- then: guess the year ------------------------------------------------- */
{
  eq("thenPoints: the right year is full marks", G.thenPoints(1906, 1906), 100);
  eq("thenPoints: a year off is still full marks", G.thenPoints(1905, 1906), 100);
  eq("thenPoints: symmetric — early and late by the same are worth the same",
     G.thenPoints(1896, 1906), G.thenPoints(1916, 1906));
  eq("thenPoints: zero at 25 years off", G.thenPoints(1931, 1906), 0);
  eq("thenPoints: zero beyond, never negative", G.thenPoints(1990, 1906), 0);
  ok("thenPoints: falls monotonically", [2, 5, 10, 20, 24].map((o) => G.thenPoints(1906 + o, 1906))
     .every((v, i, a) => i === 0 || v < a[i - 1]), [2, 5, 10, 20, 24].map((o) => G.thenPoints(1906 + o, 1906)).join());
  eq("thenPoints: a missing guess scores 0, not NaN", G.thenPoints(undefined, 1906), 0);
  const fake = [];
  for (let y = 1885; y < 2000; y += 3) for (let k = 0; k < 3; k++) fake.push({ y: y, f: "F" + y + "_" + k });
  const R = G.thenRounds(fake, 7, 10);
  eq("thenRounds: ten rounds", R.length, 10);
  eq("thenRounds: n defaults to ten when the caller omits it", G.thenRounds(fake, 7).length, 10);
  ok("thenRounds: no file twice", new Set(R.map((p) => p.f)).size === 10);
  let crowded = 0;
  for (let s = 0; s < 300; s++) {
    const per = {};
    G.thenRounds(fake, s, 10).forEach((p) => { per[Math.floor(p.y / 10)] = (per[Math.floor(p.y / 10)] || 0) + 1; });
    if (Object.values(per).some((c) => c > 2)) crowded++;
  }
  eq("thenRounds: no game in 300 seeds has three from one decade", crowded, 0);
  eq("thenRounds: same seed, same game", G.thenRounds(fake, 7, 10).map((p) => p.f).join(), R.map((p) => p.f).join());
  ok("thenRounds: another seed, another game", G.thenRounds(fake, 8, 10).map((p) => p.f).join() !== R.map((p) => p.f).join());
  const sorted = R.slice().sort((a, b) => a.y - b.y).map((p) => p.f).join();
  ok("thenRounds: not served in date order", R.map((p) => p.f).join() !== sorted);
  const sh = G.thenShare([0, 3, 12, 40], "Game #1");
  ok("thenShare: totals the points and draws one square per round",
     /— 246\/400\n/.test(sh) && sh.split("\n")[1] === "\u{1F7E9}\u{1F7E8}\u{1F7E7}\u{2B1C}", JSON.stringify(sh));
}

/* ---- then: the baked photos ----------------------------------------------- */
{
  const T = require("./data/then.json").photos;
  ok("then data: enough photos for many distinct games", T.length >= 60, `${T.length}`);
  const dec = {};
  T.forEach((p) => { dec[Math.floor(p.y / 10)] = (dec[Math.floor(p.y / 10)] || 0) + 1; });
  const deep = Object.values(dec).filter((c) => c >= 5).length;
  ok("then data: at least 4 decades with 5+ photos (else a game is one era guessed by default)", deep >= 4, JSON.stringify(dec));
  ok("then data: every year is on the slider", T.every((p) => p.y >= G.THEN_MIN && p.y <= G.THEN_MAX));
  ok("then data: every photo has a file, a year and a licence", T.every((p) => p.f && p.y && p.l));
  ok("then data: no file twice", new Set(T.map((p) => p.f)).size === T.length);
  let short = 0;
  for (let s = 0; s < 200; s++) if (G.thenRounds(T, s, 10).length !== 10) short++;
  eq("then data: 200 seeds all make a full ten under the two-per-decade rule", short, 0);
}

/* ---- survivors the sweep showed DIFFER (2026-11-19) -------------------------
 * 49 mutants were accepted as equivalent when this module was first pinned, and the
 * equiv sweep says each one changes what a player is shown. Most hid behind fixtures
 * that cannot tell x from y: the pin square and L were symmetric about x = y and sat at
 * the origin, so p[i+1] -> p[i-1] or `- x0` -> `+ x0` changed nothing a check could see;
 * the pathFor box was always wide, so the height term never bound. Everything below is
 * off the origin and lopsided on purpose, and its numbers are worked by hand. */
{
  const near = (a, b) => Math.abs(a - b) < 1e-9;
  const same = (p, q) => p.length === q.length && p.every((v, i) => near(v, q[i]));
  // An L whose arms differ: x 10..90 by y 20..40 along the bottom, x 10..40 up to y 70.
  const L = { n: "Lopsided", p: [10, 20, 90, 20, 90, 40, 40, 40, 40, 70, 10, 70] };
  for (const [pt, want, why] of [
    [[80, 30], [80, 30, 0], "inside the long arm is its own nearest point"],
    [[20, 60], [20, 60, 0], "inside the tall arm"],
    [[70, 60], [70, 40, 20], "in the notch, to the arm's top wall, not the tall arm's side (30)"],
    [[50, 10], [50, 20, 10], "below, straight up to the south wall"],
    [[25, 80], [25, 70, 10], "above the tall arm"],
    [[0, 35], [10, 35, 10], "west, to the closing edge (last vertex back to the first)"],
    [[95, 45], [90, 40, Math.SQRT2 * 5], "past a corner, to the corner"],
  ]) {
    const got = G.pinNearest(pt, L);
    ok(`pinNearest: ${JSON.stringify(pt)} — ${why}`, same(got, want), JSON.stringify(got));
  }
  // Level with a vertex: the ray runs along a wall and through a corner, the case the
  // half-open (yi > y) !== (yj > y) test exists for. Taps are floats, but a building's
  // corners are where a player aims.
  ok("inside: a point level with a corner, inside, is inside", G.inside([20, 40], L.p));
  ok("inside: level with a corner, west of the building, is outside", !G.inside([5, 40], L.p));
  ok("inside: level with a corner, east of it, is outside", !G.inside([95, 40], L.p));
  ok("inside: level with the tall arm's top, inside it, is inside", G.inside([20, 69.5], L.p));
  // A slanted wall, so the distance is not along an axis: the hypotenuse x + 2y = 60,
  // shifted to (100, 50). From (130, 80) the foot is (124, 68), 30/sqrt(5) away.
  const T = { n: "Wedge", p: [100, 50, 160, 50, 100, 80] };
  ok("pinNearest: to a slanted wall, at its foot",
     same(G.pinNearest([130, 80], T), [124, 68, 30 / Math.sqrt(5)]), JSON.stringify(G.pinNearest([130, 80], T)));
  ok("inside: just under the slanted wall (y 70 at x 120) is inside", G.inside([120, 69], T.p));
  ok("inside: just over it is not", !G.inside([120, 71], T.p));

  // bbox over a ring whose LAST vertex holds the extreme y.
  const tri = G.bbox([0, 0, 10, 0, 5, 8]);
  eq("bbox: the last vertex counts for height", tri.h, 8);
  eq("bbox: the last vertex counts for the top", tri.y1, 8);

  // pathFor, exact. Tall in a wide box, so the HEIGHT bounds the scale: s = 80/10 = 8,
  // the 32-wide drawing is centred at x 84..116, and y runs 90 (south) up to 10 (north).
  const tall = G.pathFor([100, 200, 104, 200, 104, 210, 100, 210], 200, 100, 10);
  eq("pathFor: a tall shape is bounded by the height", tall.scale, 8);
  eq("pathFor: off-origin, tall, exact path", tall.d, "M84.0 90.0L116.0 90.0L116.0 10.0L84.0 10.0Z");
  eq("pathFor: a wide shape is bounded by the width (180/10, not 80/4)", fit.scale, 18);

  // tooSimilar: aspect is a ratio, so a footprint and its double are one shape; and
  // same verts, area and fill with a different aspect are NOT twins.
  const rect = (w, h, a) => ({ n: `${w}x${h}`, a: a, f: 0.5, p: [0, 0, w, 0, w, h, 0, h] });
  ok("tooSimilar: a footprint and the same footprint scaled are one shape",
     G.tooSimilar(rect(10, 20, 1000), rect(20, 40, 1000)));
  ok("tooSimilar: same area and fill, 10:1 vs square, are different shapes",
     !G.tooSimilar(rect(10, 100, 1000), rect(32, 32, 1000)));

  // The daily is the same puzzle for everyone only while the stream is the same stream;
  // change rng and every stored day stops resuming (resume() compares answer names).
  const r = G.rng(20261026);
  eq("rng: the stream is pinned (a change re-deals every stored day)",
     JSON.stringify([r(), r(), r()]), "[0.805018633371219,0.11630934686399996,0.8520807938184589]");

  // Every bar length is reachable: a drawing exactly four bars wide picks that bar.
  for (const m of [5, 10, 20, 25, 50, 100, 200, 500]) eq(`scaleBar: ${m} m is offered`, G.scaleBar(1, 4 * m).metres, m);

  // The pin bands in metres, as the page's help states them, not relative to the constants.
  eq("pinSquare: 26 m is close, not on it", G.pinSquare(26), "\u{1F7E8}");
  eq("pinSquare: 501 m is off the map", G.pinSquare(501), "\u{2B1C}");

  // An area is named after its biggest notable building; with none, its biggest playable one.
  const A = G.areas(B);
  A.list.forEach((a, i) => {
    const mine = B.filter((b) => A.of[b.n] === i);
    const big = (xs) => xs.slice().sort((x, y) => y.a - x.a || (x.n < y.n ? -1 : 1))[0];
    const want = big(mine.filter((b) => b.w === 1)) || big(mine.filter((b) => b.q === 1));
    eq(`areas[${i}]: named after its biggest notable building`, a.near, want.n);
  });
  ok("areas: the control — some area's biggest notable is not its alphabetical first",
     A.list.some((a, i) => {
       const m = B.filter((b) => A.of[b.n] === i && b.w === 1).map((b) => b.n).sort();
       return m.length > 1 && m[0] !== a.near;
     }));
  eq("bbox: the FIRST vertex counts for the bottom", G.bbox([0, 0, 10, 5, 5, 8]).y0, 0);

  // k-means, converged: every area's centre is the mean of its playable buildings, and
  // every playable building is nearer its own area's centre than any other. A split that
  // stopped early, skipped an area's update or seeded a sum at 1 breaks one of the two.
  {
    const play = B.filter((b) => b.q === 1);
    const off = [];
    A.list.forEach((a, r) => {
      const m = play.filter((b) => A.of[b.n] === r).map(G.centre);
      const mx = m.reduce((s, p) => s + p[0], 0) / m.length, my = m.reduce((s, p) => s + p[1], 0) / m.length;
      if (!(Math.abs(mx - a.centre[0]) < 1e-6 && Math.abs(my - a.centre[1]) < 1e-6)) off.push(`centre ${r}`);
    });
    play.forEach((b) => {
      const c = G.centre(b), d = A.list.map((a) => Math.hypot(c[0] - a.centre[0], c[1] - a.centre[1]));
      if (d[A.of[b.n]] > Math.min.apply(null, d) + 1e-9) off.push(b.n);
    });
    eq("areas: converged — centres are means, buildings sit in their nearest area", off.join("; "), "");
  }
  // The seed is the WEST-most building, then the farthest from it. Worked by hand: start
  // at (205,405), farthest is (905,405); one step gives {(405,105),(205,405)} against the
  // other three, and that is stable. Seeding from the south-most instead splits it 1+4.
  {
    const sq5 = (n, x, y) => ({ n, a: 900, f: 0.5, q: 1, w: 0, p: [x, y, x + 10, y, x + 10, y + 10, x, y + 10] });
    const toy = [[400, 100], [200, 400], [900, 400], [600, 300], [600, 600]].map(([x, y], i) => sq5(`t${i}`, x, y));
    const T = G.areas(toy, 2);
    eq("areas: k-means is seeded from the west-most building", toy.map((b) => T.of[b.n]).join(""), "00111");
  }
  ok("areas: the control — some area has no notable building, so the fallback runs",
     A.list.some((a, i) => !B.some((b) => A.of[b.n] === i && b.w === 1)));

  // Two per decade is the cap, not one: five decades of three photos still make a ten.
  const five = [];
  for (const y of [1900, 1910, 1920, 1930, 1940]) for (let k = 0; k < 3; k++) five.push({ y: y + k, f: `D${y}_${k}` });
  let shortGames = 0;
  for (let s = 0; s < 50; s++) if (G.thenRounds(five, s, 10).length !== 10) shortGames++;
  eq("thenRounds: five decades make a full ten (two each)", shortGames, 0);
  ok("thenShare: an unplayed round scores nothing", /— 100\/200\n/.test(G.thenShare([0, undefined], "x")),
     JSON.stringify(G.thenShare([0, undefined], "x")));

  // Same-day misses in any storage order come back in name order.
  const P = B.filter((b) => b.q === 1).map((b) => b.n).slice().sort();
  const want = P.slice(0, 4).join("|");
  for (const order of [[1, 3, 0, 2], [2, 0, 3, 1], [0, 2, 1, 3], [3, 1, 2, 0]]) {
    const n = order.map((k) => P[k]);
    eq(`misses: same-day ties in name order from storage ${order.join("")}`,
       G.misses({ days: { "2026-10-20": { n: n, c: n.map(() => "Not A Building") } } }, {}, B).map((b) => b.n).join("|"), want);
  }
}

/* ---- pairFor: a miss drawn beside its answer, at one scale ----------------------------
 * The whole point is the shared scale: fitted separately, a shed and a library come out the
 * same size and the comparison says nothing about the clue the scale bar exists to give. */
{
  const xs = (d) => d.slice(1, -1).split("L").map((q) => q.split(" ").map(Number));
  const span = (d) => { const p = xs(d), X = p.map((q) => q[0]), Y = p.map((q) => q[1]);
    return { x0: Math.min(...X), x1: Math.max(...X), y0: Math.min(...Y), y1: Math.max(...Y) }; };
  // 10x4 m beside 5x2 m in 100x100 boxes, pad 10: the big one binds, s = 80/10 = 8.
  const big = { p: [0, 0, 10, 0, 10, 4, 0, 4] }, small = { p: [50, 50, 55, 50, 55, 52, 50, 52] };
  const pr = G.pairFor(small, big, 100, 100, 10);
  eq("pairFor: the larger building sets the one scale", pr.scale, 8);
  eq("pairFor: argument order does not change the scale", G.pairFor(big, small, 100, 100, 10).scale, 8);
  const sb = span(pr.b), sa = span(pr.a);
  eq("pairFor: the larger fills its box to the padding (x0)", sb.x0, 10);
  eq("pairFor: the larger fills its box to the padding (x1)", sb.x1, 90);
  eq("pairFor: the smaller is drawn at the same px per metre, not stretched (width)", sa.x1 - sa.x0, 40);
  eq("pairFor: the smaller is centred in its own box (x0)", sa.x0, 30);
  eq("pairFor: the smaller is centred in its own box (y0)", sa.y0, 42);
  eq("pairFor: north is up in the pair too (y flipped)", xs(pr.a)[2][1] < xs(pr.a)[0][1], true);
  eq("pairFor: scale bar is scaleBar at the shared scale", pr.bar.metres, G.scaleBar(8, 100).metres);
  // Exact paths, like the pathFor case above. Without a string-exact check the
  // coordinate `toFixed(1)` is invisible: every assertion here parses with Number(),
  // and Number("30.00") === 30, so toFixed(2) passes them all. mutwatch caught both
  // toFixed mutants surviving on 2026-11-21; these two lines are what kill them.
  eq("pairFor: exact path for the smaller building", pr.a,
     "M30.0 58.0L70.0 58.0L70.0 42.0L30.0 42.0Z");
  eq("pairFor: exact path for the larger building", pr.b,
     "M10.0 66.0L90.0 66.0L90.0 34.0L10.0 34.0Z");
  // The pad defaults to 6. Every check above passes one explicitly, so the default was
  // never executed and `pad == null ? 6 : pad` could have said any number.
  eq("pairFor: pad defaults to 6", G.pairFor(small, big, 100, 100).scale,
     G.pairFor(small, big, 100, 100, 6).scale);
  eq("pairFor: and that default is 6 exactly, not merely some default",
     G.pairFor(small, big, 100, 100).scale, 8.8);
  eq("pairFor: pad 7 would give a different scale, so the default is observed",
     G.pairFor(small, big, 100, 100, 7).scale, 8.6);
  // Wide beside tall in a wide box: each binds on a different side, and the shared scale is
  // the smaller of the two own-fits (tall: 80/10 = 8), not either building's own fit.
  const wide = { p: [0, 0, 10, 0, 10, 2, 0, 2] }, tall = { p: [0, 0, 2, 0, 2, 10, 0, 10] };
  const wt = G.pairFor(wide, tall, 200, 100, 10);
  eq("pairFor: wide vs tall takes the tighter of the two fits", wt.scale, 8);
  eq("pairFor: wide vs tall draws the wide one 80 px wide, not its own-fit 180", span(wt.a).x1 - span(wt.a).x0, 80);
  // Real data, every pairing of a real game's answers with their offered names: drawn widths
  // keep the metre ratio, and both stay inside their boxes.
  const g = G.pickRounds(B, 20261121, 10, 4, 4);
  let bad = [];
  for (const r of g) for (const n of r.choices) {
    if (n === r.answer.n) continue;
    const pick = B.find((b) => b.n === n), q = G.pairFor(pick, r.answer, 150, 150, 6);
    const A = span(q.a), Z = span(q.b), ma = G.bbox(pick.p), mz = G.bbox(r.answer.p);
    const okRatio = Math.abs((A.x1 - A.x0) / (Z.x1 - Z.x0) - ma.w / mz.w) < 0.02;
    const inBox = [A, Z].every((S) => S.x0 >= 5.9 && S.x1 <= 144.1 && S.y0 >= 5.9 && S.y1 <= 144.1);
    if (!okRatio || !inBox) bad.push(n + " vs " + r.answer.n);
  }
  ok("pairFor: on a real game every wrong name and its answer keep their true size ratio, inside the box",
     bad.length === 0, bad.slice(0, 3).join(", "));
}

/* ---- survivors the sweep could not judge until 2026-11-21 -------------------
 * Six mutants sat ACCEPTED as "measured equivalent" only because the equivalence sweep
 * never reached the lines (bin/mutwatch blind said 21 of 57 public names were unswept).
 * Widening the sweep re-scored all six as DIFFERS — real changes nothing here caught.
 * projects/mutation-audit/NOTES.md has the measurement.
 */
{
  // scaleBar picks the bar NEAREST a quarter of the drawing, and on an exact tie the
  // SHORTER one — `<` not `<=`, because a tie should not silently grow the bar. The
  // existing checks all land on an exact match, so neither comparator could fail them.
  eq("scaleBar: a tie between 5 m and 10 m takes the shorter bar", G.scaleBar(1, 30).metres, 5);
  eq("scaleBar: a tie between 10 m and 20 m takes the shorter bar", G.scaleBar(1, 60).metres, 10);
  eq("scaleBar: a tie between 25 m and 50 m takes the shorter bar", G.scaleBar(1, 150).metres, 25);

  // inside() is half-open: a point exactly on the left or bottom edge counts as in, on the
  // right or top edge as out. That is what stops a tap on the shared wall of two adjacent
  // buildings scoring as inside both. `<` -> `<=` flips it, and no test looked at an edge.
  const sq = [0, 0, 10, 0, 10, 10, 0, 10];
  eq("inside: a point on the left edge is in", G.inside([0, 5], sq), true);
  eq("inside: a point on the right edge is out", G.inside([10, 5], sq), false);
  eq("inside: a point on the bottom edge is in", G.inside([5, 0], sq), true);
  eq("inside: a point on the top edge is out", G.inside([5, 10], sq), false);
  eq("inside: the middle is in", G.inside([5, 5], sq), true);
  eq("inside: a point beyond the left edge is out", G.inside([-1, 5], sq), false);

  // MIN_VERTS / MAX_FILL / MIN_AREA are published here but APPLIED in build.py, which is
  // what actually sets each building's `q`. Recomputing the rule from the published numbers
  // is the drift check: if build.py's thresholds move and these do not, a building's q stops
  // matching and this goes red. Measured 2026-11-21: 0 mismatches over 294 buildings, and
  // MIN_VERTS 8->9 produces 7, MAX_FILL 0.92->0.93 produces 2.
  const wrong = B.filter((b) => {
    const want = (b.p.length / 2 >= G.MIN_VERTS && b.f < G.MAX_FILL && b.a >= G.MIN_AREA) ? 1 : 0;
    return want !== b.q;
  });
  ok("data: every building's q is exactly what the published thresholds say it should be",
     wrong.length === 0, wrong.slice(0, 3).map((b) => b.n).join(", "));
  ok("the vertex floor is load-bearing: some building is excluded by it alone",
     B.some((b) => b.p.length / 2 < G.MIN_VERTS && b.f < G.MAX_FILL && b.a >= G.MIN_AREA));

  // No shipped building has an area in [600, 601) and no photo is from 1880 or 2000, so a
  // one-step change to these four is invisible to every data-driven check above. They are
  // pinned to their values outright: each is a contract app.js and build.py rely on, and an
  // accidental edit to one has nothing else to trip over.
  eq("MIN_AREA is the 600 m² floor build.py applies", G.MIN_AREA, 600);
  eq("MIN_VERTS is 8", G.MIN_VERTS, 8);
  eq("MAX_FILL is 0.92", G.MAX_FILL, 0.92);
  eq("THEN_MIN is the 1880 slider floor", G.THEN_MIN, 1880);
  eq("THEN_MAX is the 2000 slider ceiling", G.THEN_MAX, 2000);
}

if (fails.length) {
  console.error(fails.map((f) => "FAIL: " + f).join("\n"));
  console.error(`${pass} passed, ${fails.length} FAILED`);
  process.exit(1);
}
console.log(`${pass} passed, 0 failed`);
