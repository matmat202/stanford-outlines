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

  let DATA = null, rounds = [], at = 0, picked = [], day = "", seedLabel = "", daily = false;
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
  function drawMini(b) {
    if (miniBase === null) {
      miniBase = DATA.buildings.map((x) => {
        let d = "";
        for (let i = 0; i < x.p.length; i += 2) {
          d += (i ? "L" : "M") + x.p[i].toFixed(0) + " " + (DATA.campus.h - x.p[i + 1]).toFixed(0);
        }
        return d + "Z";
      }).join(" ");
    }
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
      areasHtml() + "</div>";
    $("copy").addEventListener("click", function () {
      const text = G.shareEntry(e, isDaily ? day : label);
      const done = () => { this.textContent = "Copied"; };
      if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(text).then(done, () => { this.textContent = text; });
      } else { this.textContent = text; }
    });
    $("again").addEventListener("click", () => start((Math.random() * 4294967296) >>> 0, "A random ten", false));
    $("end").querySelectorAll("button[data-area]").forEach((btn) => btn.addEventListener("click", () => {
      const i = Number(btn.dataset.area);
      start((Math.random() * 4294967296) >>> 0, AREAS.list[i].label, false, null, i);
    }));
    $("end").scrollIntoView({ block: "nearest" });
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

  /* ---- start ------------------------------------------------------------- */

  function start(seed, label, isDaily, from, area) {
    const pool = area == null ? DATA.buildings : G.inArea(DATA.buildings, AREAS, area);
    rounds = G.pickRounds(pool, seed, ROUNDS);
    picked = from || [];
    at = from ? Math.max(0, picked.indexOf(null)) : 0;
    daily = !!isDaily;
    seedLabel = label;
    $("end").hidden = true;
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
    /* ?seed=N plays a fixed game — for sharing one, and for the screenshot test. */
    const q = new URLSearchParams(location.search).get("seed");
    if (q !== null && /^\d+$/.test(q)) {
      day = G.campusDay();
      start(Number(q) >>> 0, "Game #" + (Number(q) >>> 0), false);
    } else {
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
})();
