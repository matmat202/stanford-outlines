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

  let DATA = null, rounds = [], at = 0, picked = [], day = "", seedLabel = "";

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
    const s = G.score(picked, rounds);
    $("game").hidden = true;
    const squares = rounds.map((r, i) => picked[i] === r.correct ? "\u{1F7E9}" : "\u{2B1C}").join("");
    $("end").hidden = false;
    $("end").innerHTML =
      '<div class="stage final"><p class="big">' + s.right + "/" + s.total + "</p>" +
      "<p>" + esc(seedLabel) + '</p><p class="sq" aria-hidden="true">' + squares + "</p>" +
      '<ul class="recap">' + rounds.map((r, i) =>
        '<li><span class="mark ' + (picked[i] === r.correct ? "ok" : "no") + '" aria-hidden="true">' +
        (picked[i] === r.correct ? "✓" : "✗") + "</span><span>" + esc(r.answer.n) +
        (picked[i] === r.correct ? "" : " <em>— you said " +
          esc(r.choices[picked[i]] || "nothing") + "</em>") + "</span></li>").join("") +
      '</ul><div class="actions"><button type="button" class="go" id="copy">Copy result</button>' +
      '<button type="button" class="ghost" id="again">Another ten</button></div></div>';
    $("copy").addEventListener("click", function () {
      const text = G.shareText(picked, rounds, day);
      const done = () => { this.textContent = "Copied"; };
      if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(text).then(done, () => { this.textContent = text; });
      } else { this.textContent = text; }
    });
    $("again").addEventListener("click", () => start((Math.random() * 4294967296) >>> 0, "A random ten"));
    $("end").scrollIntoView({ block: "nearest" });
  }

  /* ---- start ------------------------------------------------------------- */

  function start(seed, label) {
    rounds = G.pickRounds(DATA.buildings, seed, ROUNDS);
    picked = [];
    at = 0;
    seedLabel = label;
    $("end").hidden = true;
    $("game").hidden = false;
    $("sub").textContent = label + " · tap a name, or press 1–4.";
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
    $("stats").textContent = DATA.counts.named + " named buildings, " +
      DATA.counts.playable + " distinctive enough to ask";
    $("next").addEventListener("click", next);
    /* ?seed=N plays a fixed game — for sharing one, and for the screenshot test. */
    const q = new URLSearchParams(location.search).get("seed");
    if (q !== null && /^\d+$/.test(q)) {
      day = G.campusDay();
      start(Number(q) >>> 0, "Game #" + (Number(q) >>> 0));
    } else {
      day = G.campusDay();
      start(G.seedFor(day), "Today’s ten · " + day);
    }
  })();
})();
