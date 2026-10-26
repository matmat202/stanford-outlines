/* app.js — the DOM half. Every decision worth testing lives in game-logic.js; what is
 * here is wiring, and it is kept thin on purpose so that "does the game work" is a
 * question `node site/game-logic.test.mjs` can answer.
 */
(function () {
  "use strict";
  const $ = (id) => document.getElementById(id);
  const G = window.GameLogic;
  const ROUNDS = 10;
  const SIDE = 460;            /* the outline canvas, in SVG units */
  const SVGNS = "http://www.w3.org/2000/svg";

  let DATA = null, rounds = [], at = 0, picked = [], day = "", seedLabel = "", daily = false, missGame = false;
  let AREAS = null;

  /* The daily record (game-logic.js has the why). Storage can be absent or refuse a
   * write (private mode, a full quota); the game must still play, just unremembered. */
  function loadHist() {
    try { return G.parseHistory(localStorage.getItem(G.KEY)); } catch (e) { return { days: {} }; }
  }
  function saveDay() {
    if (!daily) return;
    try {
      localStorage.setItem(G.KEY, JSON.stringify(G.record(loadHist(), day, G.entryFor(picked, rounds))));
    } catch (e) { /* unremembered, still playable */ }
  }
  function loadFixed() {
    try { return G.parseFixed(localStorage.getItem(G.FIXED_KEY)); } catch (e) { return {}; }
  }
  /* A right answer in a misses round closes that miss (game-logic.js misses()). */
  function saveFix(name) {
    try {
      localStorage.setItem(G.FIXED_KEY, JSON.stringify(G.fix(loadFixed(), [name], G.campusDay())));
    } catch (e) { /* unremembered, still playable */ }
  }
  const openMisses = () => G.misses(loadHist(), loadFixed(), DATA.buildings);

  const esc = (s) => String(s).replace(/[&<>"]/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));

  /* ---- drawing ----------------------------------------------------------- */

  function drawOutline(b) {
    const fit = G.pathFor(b.p, SIDE, SIDE, 26);
    const bar = G.scaleBar(fit.scale, SIDE);
    const y = SIDE - 12;
    $("stage").innerHTML =
      '<svg viewBox="0 0 ' + SIDE + " " + SIDE + '" role="img" aria-label="' +
      'The footprint of a Stanford building, ' + Math.round(b.a).toLocaleString("en-US") +
      ' square metres, drawn with north up">' +
      '<path class="shape" d="' + fit.d + '"/>' +
      '<g class="scale"><line x1="26" y1="' + y + '" x2="' + (26 + bar.px) + '" y2="' + y + '"/>' +
      '<line x1="26" y1="' + (y - 4) + '" x2="26" y2="' + (y + 4) + '"/>' +
      '<line x1="' + (26 + bar.px) + '" y1="' + (y - 4) + '" x2="' + (26 + bar.px) + '" y2="' + (y + 4) + '"/>' +
      '<text x="' + (30 + bar.px) + '" y="' + (y + 4) + '">' + bar.metres + ' m</text>' +
      '<text x="' + (SIDE - 26) + '" y="30" text-anchor="end">N &#8593;</text></g></svg>';
  }

  /** The reveal map: the whole campus as it is actually built, with the answer picked
   *  out. Same geometry the big outline came from — there is no second dataset. */
  let miniBase = null;
  function campusBase() {
    if (miniBase === null) {
      miniBase = DATA.buildings.map((x) => {
        let d = "";
        for (let i = 0; i < x.p.length; i += 2) {
          d += (i ? "L" : "M") + x.p[i].toFixed(0) + " " + (DATA.campus.h - x.p[i + 1]).toFixed(0);
        }
        return d + "Z";
      }).join(" ");
    }
    return miniBase;
  }
  function drawMini(b) {
    campusBase();
    let one = "";
    for (let i = 0; i < b.p.length; i += 2) {
      one += (i ? "L" : "M") + b.p[i].toFixed(0) + " " + (DATA.campus.h - b.p[i + 1]).toFixed(0);
    }
    $("mini").innerHTML =
      '<svg viewBox="0 0 ' + DATA.campus.w + " " + DATA.campus.h +
      '" role="img" aria-label="Where it is on campus"><path class="mini-all" d="' +
      miniBase + '"/><path class="mini-one" d="' + one + 'Z"/></svg>';
  }

  /* ---- a round ----------------------------------------------------------- */

  function showRound() {
    const r = rounds[at];
    $("roundLabel").textContent = "Round " + (at + 1) + " of " + rounds.length;
    const s = G.score(picked, rounds);
    $("tally").textContent = s.right + " right";
    drawOutline(r.answer);
    $("verdict").className = "verdict";
    $("verdict").setAttribute("aria-hidden", "true");
    $("choices").innerHTML = r.choices.map((n, i) =>
      '<li><button type="button" data-i="' + i + '"><span class="key" aria-hidden="true">' +
      (i + 1) + "</span><span>" + esc(n) + "</span></button></li>").join("");
    $("choices").querySelectorAll("button").forEach((btn) => {
      btn.addEventListener("click", () => answer(Number(btn.dataset.i)));
    });
  }

  function answer(i) {
    if (picked[at] != null) return;
    const r = rounds[at];
    picked[at] = i;
    saveDay();
    const right = i === r.correct;
    if (missGame && right) saveFix(r.answer.n);
    $("choices").querySelectorAll("button").forEach((btn) => {
      const k = Number(btn.dataset.i);
      btn.disabled = true;
      if (k === r.correct) btn.className = "right";
      else if (k === i) btn.className = "wrong";
    });
    const s = G.score(picked, rounds);
    $("tally").textContent = s.right + " right";
    $("verdictName").textContent = (right ? "Yes — " : "No — ") + r.answer.n;
    $("verdictNote").textContent =
      Math.round(r.answer.a).toLocaleString("en-US") + " m² of footprint, " +
      (r.answer.p.length / 2) + " corners.";
    $("verdictWhere").textContent = "Where it sits on campus — every mapped building, with this one picked out.";
    drawMini(r.answer);
    $("verdict").className = "verdict on";
    $("verdict").setAttribute("aria-hidden", "false");
    $("said").textContent = (right ? "Correct. " : "Wrong. ") + "It was " + r.answer.n +
      ". " + s.right + " right out of " + (at + 1) + ".";
    $("next").textContent = at + 1 < rounds.length ? "Next" : "See the result";
    $("next").focus();
  }

  function next() {
    at++;
    if (at < rounds.length) { showRound(); $("stage").scrollIntoView({ block: "nearest" }); }
    else finish();
  }

  /* ---- the end ----------------------------------------------------------- */

  function finish() {
    renderEnd(G.entryFor(picked, rounds), seedLabel, daily);
  }

  /** The end screen, drawn from a stored entry rather than from the live rounds, so a
   *  reload of a finished day shows the same thing whether or not the rounds can still
   *  be rebuilt from today's data. */
  function renderEnd(e, label, isDaily) {
    const total = e.n.length, right = G.rightCount(e);
    const okAt = (i) => e.c[i] != null && e.c[i] === e.n[i];
    $("game").hidden = true;
    $("sub").textContent = label;
    const squares = e.n.map((n, i) => okAt(i) ? "\u{1F7E9}" : "\u{2B1C}").join("");
    $("end").hidden = false;
    $("end").innerHTML =
      '<div class="stage final"><p class="big">' + right + "/" + total + "</p>" +
      "<p>" + esc(label) + '</p><p class="sq" aria-hidden="true">' + squares + "</p>" +
      (isDaily ? statsHtml(right) : "") +
      '<ul class="recap">' + e.n.map((n, i) =>
        '<li><span class="mark ' + (okAt(i) ? "ok" : "no") + '" aria-hidden="true">' +
        (okAt(i) ? "✓" : "✗") + "</span><span>" + esc(n) +
        (okAt(i) ? "" : " <em>— you said " + esc(e.c[i] || "nothing") + "</em>") +
        "</span></li>").join("") +
      '</ul><div class="actions"><button type="button" class="go" id="copy">Copy result</button>' +
      '<button type="button" class="ghost" id="again">Another ten</button></div>' +
      (isDaily ? '<p class="note">A new ten at midnight, campus time. Another ten is just for fun — it does not change today’s score.</p>' : "") +
      missesHtml() + pinHtml() + areasHtml() + "</div>";
    $("copy").addEventListener("click", function () {
      const text = G.shareEntry(e, isDaily ? day : label);
      const done = () => { this.textContent = "Copied"; };
      if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(text).then(done, () => { this.textContent = text; });
      } else { this.textContent = text; }
    });
    $("again").addEventListener("click", () => start((Math.random() * 4294967296) >>> 0, "A random ten", false));
    $("pinGo").addEventListener("click", () => startPin((Math.random() * 4294967296) >>> 0, "On the map"));
    const mb = $("misses");
    if (mb) mb.addEventListener("click", startMisses);
    $("end").querySelectorAll("button[data-area]").forEach((btn) => btn.addEventListener("click", () => {
      const i = Number(btn.dataset.area);
      start((Math.random() * 4294967296) >>> 0, AREAS.list[i].label, false, null, i);
    }));
    $("end").scrollIntoView({ block: "nearest" });
  }

  /* Practise your misses: every building got wrong in a daily and not yet got right
   * since, ten at a time, newest first. A right answer here clears it; the daily score
   * is never touched. */
  function missesHtml() {
    const open = openMisses();
    if (!open.length) {
      return missGame ? '<p class="note misses-none">No misses left — every building you got wrong, you have since got right.</p>' : "";
    }
    const n = Math.min(open.length, ROUNDS);
    return '<h2 class="areas-h">Your misses</h2>' +
      '<p class="note">' + open.length + (open.length === 1 ? " building" : " buildings") +
      " you got wrong in a daily and have not got right since. A right answer here clears it.</p>" +
      '<div class="actions"><button type="button" class="go" id="misses">Practise ' +
      (n === open.length ? (n === 1 ? "it" : n === 2 ? "both" : "all " + n) : "the newest " + n) + "</button></div>";
  }

  function startMisses() {
    const open = openMisses();
    if (!open.length) return;
    rounds = G.missRounds(open, DATA.buildings, (Math.random() * 4294967296) >>> 0, ROUNDS);
    picked = [];
    at = 0;
    daily = false;
    missGame = true;
    seedLabel = "Your misses";
    $("end").hidden = true;
    $("game").hidden = false;
    $("sub").textContent = seedLabel + " · tap a name, or press 1–4.";
    showRound();
  }

  /* Practise one part of campus: ten rounds whose answers and wrong names all come from
   * one area (game-logic.js areas()), each button drawing that area on the campus map. */
  function areasHtml() {
    if (!AREAS) return "";
    const ring = (x) => {
      let d = "";
      for (let i = 0; i < x.p.length; i += 2) {
        d += (i ? "L" : "M") + x.p[i].toFixed(0) + " " + (DATA.campus.h - x.p[i + 1]).toFixed(0);
      }
      return d + "Z";
    };
    return '<h2 class="areas-h">Practise one part of campus</h2>' +
      '<p class="note">Ten from one area, wrong names from the same area. Just for fun.</p>' +
      '<div class="areas">' + AREAS.list.map((a, i) => {
        let mine = "", rest = "";
        DATA.buildings.forEach((b) => { if (AREAS.of[b.n] === i) mine += ring(b); else rest += ring(b); });
        return '<button type="button" class="area" data-area="' + i + '">' +
          '<svg viewBox="0 0 ' + DATA.campus.w + " " + DATA.campus.h + '" aria-hidden="true">' +
          '<path class="mini-all" d="' + rest + '"/><path class="mini-one" d="' + mine + '"/></svg>' +
          "<span>" + esc(a.label) + "<small>" + a.named + " buildings</small></span></button>";
      }).join("") + "</div>";
  }

  function statsHtml(today) {
    const st = G.stats(loadHist(), day);
    if (!st.played) return "";
    const top = Math.max.apply(null, st.dist) || 1;
    const rows = [];
    for (let k = st.dist.length - 1; k >= 0; k--) {
      if (k > 10 && !st.dist[k]) continue;
      rows.push('<li' + (k === today ? ' class="now"' : "") + '><span class="k">' + k +
        '</span><span class="bar"><span style="width:' + Math.max(st.dist[k] ? 6 : 0, Math.round(100 * st.dist[k] / top)) +
        '%"></span></span><span class="v">' + st.dist[k] + "</span></li>");
    }
    return '<dl class="nums">' +
      "<div><dt>Played</dt><dd>" + st.played + "</dd></div>" +
      "<div><dt>Streak</dt><dd>" + st.streak + "</dd></div>" +
      "<div><dt>Best streak</dt><dd>" + st.best + "</dd></div></dl>" +
      '<ul class="dist" aria-label="Days by score, out of 10">' + rows.join("") + "</ul>";
  }


  /* ---- pin: find it on the map --------------------------------------------
   * The name is the question and a tap on the campus map is the answer, scored by
   * metres from the building's walls (game-logic.js pinNearest/pinPoints). Just for
   * fun: nothing here touches the daily record. */

  let pinGame = [], pinAt = 0, pinDists = [], pinTap = null, pinLabelText = "";

  function ringD(x) {
    let d = "";
    for (let i = 0; i < x.p.length; i += 2) {
      d += (i ? "L" : "M") + x.p[i].toFixed(0) + " " + (DATA.campus.h - x.p[i + 1]).toFixed(0);
    }
    return d + "Z";
  }

  function drawPinMap(answer, tap, near) {
    const H = DATA.campus.h;
    let extra = "";
    if (answer) extra += '<path class="mini-one" d="' + ringD(answer) + '"/>';
    if (tap && near && near[2] > 0) {
      extra += '<line class="pin-line" x1="' + tap[0].toFixed(0) + '" y1="' + (H - tap[1]).toFixed(0) +
        '" x2="' + near[0].toFixed(0) + '" y2="' + (H - near[1]).toFixed(0) + '"/>';
    }
    if (tap) extra += '<circle class="pin-dot" r="26" cx="' + tap[0].toFixed(0) + '" cy="' + (H - tap[1]).toFixed(0) + '"/>';
    $("pinMap").innerHTML =
      '<svg viewBox="0 0 ' + DATA.campus.w + " " + H + '" role="img" aria-label="Campus map: every mapped building' +
      (answer ? ", with " + esc(answer.n) + " picked out" : "") + '"' + (answer ? ' class="pinned"' : "") +
      '><path class="mini-all" d="' + campusBase() + '"/>' + extra + "</svg>";
    if (!answer) $("pinMap").querySelector("svg").addEventListener("click", pinClick);
  }

  /* A tap in screen pixels -> campus metres, through the SVG's own transform, so it is
     right at any zoom or width. */
  function pinClick(ev) {
    const svg = ev.currentTarget, m = svg.getScreenCTM();
    if (!m) return;
    const pt = svg.createSVGPoint();
    pt.x = ev.clientX; pt.y = ev.clientY;
    const c = pt.matrixTransform(m.inverse());
    pinTap = [c.x, DATA.campus.h - c.y];
    drawPinMap(null, pinTap, null);
    $("pinLock").disabled = false;
  }

  function startPin(seed, label) {
    pinGame = G.pinRounds(DATA.buildings, seed, ROUNDS);
    pinAt = 0; pinDists = []; pinLabelText = label;
    $("game").hidden = true; $("end").hidden = true; $("pin").hidden = false;
    $("sub").textContent = label + " · find each building on the map.";
    showPin();
  }

  function pinTotal() { return pinDists.reduce((s, m) => s + G.pinPoints(m), 0); }

  function showPin() {
    const b = pinGame[pinAt];
    pinTap = null;
    $("pinLabel").textContent = "Round " + (pinAt + 1) + " of " + pinGame.length;
    $("pinTally").textContent = pinTotal() + " points";
    $("pinAsk").textContent = "Where is " + b.n + "?";
    $("pinVerdict").className = "verdict";
    $("pinVerdict").setAttribute("aria-hidden", "true");
    $("pinActs").hidden = false; $("pinHint").hidden = false;
    $("pinLock").disabled = true;
    drawPinMap(null, null, null);
  }

  function lockPin(skip) {
    if (pinDists.length > pinAt) return;
    const b = pinGame[pinAt];
    const near = !skip && pinTap ? G.pinNearest(pinTap, b) : null;
    const m = near ? near[2] : Infinity;
    pinDists.push(m);
    const pts = G.pinPoints(m);
    drawPinMap(b, near ? pinTap : null, near);
    $("pinActs").hidden = true; $("pinHint").hidden = true;
    $("pinTally").textContent = pinTotal() + " points";
    $("pinName").textContent = b.n;
    $("pinNote").textContent = !near ? "Skipped — this is where it is." :
      m === 0 ? "Right on it. 100 points." :
      Math.round(m).toLocaleString("en-US") + " m from its walls. " + pts + (pts === 1 ? " point." : " points.");
    $("pinVerdict").className = "verdict on";
    $("pinVerdict").setAttribute("aria-hidden", "false");
    $("pinSaid").textContent = b.n + ": " + $("pinNote").textContent;
    $("pinNext").textContent = pinAt + 1 < pinGame.length ? "Next" : "See the result";
    $("pinNext").focus();
  }

  function nextPin() {
    pinAt++;
    if (pinAt < pinGame.length) { showPin(); $("pinAsk").scrollIntoView({ block: "nearest" }); }
    else endPin();
  }

  const offText = (m) => !isFinite(m) ? "skipped" : m === 0 ? "on it" : Math.round(m).toLocaleString("en-US") + " m";

  function endPin() {
    const total = pinTotal(), max = pinGame.length * 100;
    $("pin").hidden = true;
    $("end").hidden = false;
    $("end").innerHTML =
      '<div class="stage final"><p class="big">' + total + "</p><p>of " + max + " · " + esc(pinLabelText) + "</p>" +
      '<p class="sq" aria-hidden="true">' + pinDists.map(G.pinSquare).join("") + "</p>" +
      '<ul class="recap">' + pinGame.map((b, i) => {
        const p = G.pinPoints(pinDists[i]);
        return '<li><span class="mark ' + (p >= 50 ? "ok" : "no") + '" aria-hidden="true">' + (p >= 50 ? "✓" : "✗") +
          "</span><span>" + esc(b.n) + '</span><span class="m">' + offText(pinDists[i]) + "</span></li>";
      }).join("") +
      '</ul><div class="actions"><button type="button" class="go" id="copy">Copy result</button>' +
      '<button type="button" class="ghost" id="pinAgain">Ten more on the map</button>' +
      '<button type="button" class="ghost" id="toDaily">Today’s outlines</button></div>' +
      '<p class="note">100 points within 25 m of a building’s walls, nothing from 500 m. Just for fun — today’s score is not touched.</p></div>';
    $("copy").addEventListener("click", function () {
      const text = G.pinShare(pinDists, pinLabelText);
      const done = () => { this.textContent = "Copied"; };
      if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(text).then(done, () => { this.textContent = text; });
      } else { this.textContent = text; }
    });
    $("pinAgain").addEventListener("click", () => startPin((Math.random() * 4294967296) >>> 0, "On the map"));
    $("toDaily").addEventListener("click", () => { $("pin").hidden = true; openDaily(); });
    $("end").scrollIntoView({ block: "nearest" });
  }

  function pinHtml() {
    return '<h2 class="areas-h">Find them on the map</h2>' +
      '<p class="note">The other way round: a building’s name, and you tap where it is on campus. Scored by how many metres you are off.</p>' +
      '<div class="actions"><button type="button" class="go" id="pinGo">Ten on the map</button></div>';
  }

  /* ---- start ------------------------------------------------------------- */

  function start(seed, label, isDaily, from, area) {
    const pool = area == null ? DATA.buildings : G.inArea(DATA.buildings, AREAS, area);
    missGame = false;
    rounds = G.pickRounds(pool, seed, ROUNDS);
    picked = from || [];
    at = from ? Math.max(0, picked.indexOf(null)) : 0;
    daily = !!isDaily;
    seedLabel = label;
    $("end").hidden = true;
    $("pin").hidden = true;
    $("game").hidden = false;
    $("sub").textContent = label + " · tap a name, or press 1–4.";
    if (from && picked.indexOf(null) < 0) { finish(); return; }
    showRound();
  }

  document.addEventListener("keydown", (e) => {
    if (e.metaKey || e.ctrlKey || e.altKey) return;
    if ($("game").hidden) return;
    if (e.key >= "1" && e.key <= "4" && picked[at] == null) {
      const btn = $("choices").querySelector('button[data-i="' + (Number(e.key) - 1) + '"]');
      if (btn) { e.preventDefault(); answer(Number(e.key) - 1); }
    } else if ((e.key === "Enter" || e.key === " ") && picked[at] != null &&
               document.activeElement === $("next")) {
      /* let the button handle it */
    }
  });

  (async function () {
    try {
      DATA = await (await fetch("data/buildings.json", { cache: "no-cache" })).json();
    } catch (e) {
      $("sub").textContent = "Could not load the campus outlines. Try reloading.";
      return;
    }
    AREAS = G.areas(DATA.buildings);
    $("stats").textContent = DATA.counts.named + " named buildings, " +
      DATA.counts.playable + " distinctive enough to ask";
    $("next").addEventListener("click", next);
    $("pinLock").addEventListener("click", () => lockPin(false));
    $("pinSkip").addEventListener("click", () => lockPin(true));
    $("pinNext").addEventListener("click", nextPin);
    /* ?seed=N plays a fixed game — for sharing one, and for the screenshot test. */
    const q = new URLSearchParams(location.search).get("seed");
    /* ?pin=N plays a fixed map game, the same way. */
    const pq = new URLSearchParams(location.search).get("pin");
    if (q !== null && /^\d+$/.test(q)) {
      day = G.campusDay();
      start(Number(q) >>> 0, "Game #" + (Number(q) >>> 0), false);
    } else if (pq !== null && /^\d+$/.test(pq)) {
      day = G.campusDay();
      startPin(Number(pq) >>> 0, "Map game #" + (Number(pq) >>> 0));
    } else {
      openDaily();
    }
  })();

  function openDaily() {
    day = G.campusDay();
    const label = "Today’s ten · " + day;
    const stored = loadHist().days[day];
    const from = G.resume(stored, G.pickRounds(DATA.buildings, G.seedFor(day), ROUNDS));
    if (!from && G.complete(stored)) {
      /* Finished today on data that has since changed: still finished. */
      daily = true;
      renderEnd(stored, label, true);
    } else {
      start(G.seedFor(day), label, true, from);
    }
  }
})();
