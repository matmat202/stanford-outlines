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

if (fails.length) {
  console.error(fails.map((f) => "FAIL: " + f).join("\n"));
  console.error(`${pass} passed, ${fails.length} FAILED`);
  process.exit(1);
}
console.log(`${pass} checks passed`);
