# Stanford Outlines

**<https://matmat202.github.io/stanford-outlines/>**

Ten Stanford buildings a day, drawn as their real footprints. Name each one from its
outline alone.

Every shape on the page is the building's actual polygon from
[OpenStreetMap](https://www.openstreetmap.org/copyright), drawn to scale with north up —
no illustration, no simplification. The scale bar is the only other clue, and it is the
one that turns "an L-shaped thing" into "a 90-metre L-shaped thing".

## How a round is chosen

A building is only asked if its outline carries information. Of the 306 named buildings
in the extract, **154** clear all three bars: at least 8 corners, filling less than 92%
of their own bounding box, and at least 600 m². A rectangle is not a puzzle.

Four of the day's ten are buildings with a Wikidata entity — somebody outside OSM thought
them notable — so a day is winnable by knowing the campus and not only by matching shapes.

Wrong answers are drawn from buildings of a similar size, so the scale bar narrows the
field without handing the answer over. Two rules keep a round answerable:

- no decoy whose own footprint is indistinguishable from the answer's, and
- no decoy from the same name family — *Studio 5* is never offered against *Studio 1*,
  because nothing on screen could tell you which sibling you are looking at.

The puzzle is seeded by the date **in Stanford's time zone**, so everyone gets the same
ten whatever clock their phone is on. `?seed=N` plays a fixed game.

## Practise one part of campus

After a game, five buttons offer ten rounds from one area — answers *and* wrong names
from the same part of campus, which is harder and is how you learn a neighbourhood. The
areas are a k-means split of the playable footprints' centres (farthest-point start, so
the same data always gives the same five), and each is named after the biggest notable
building in it: *Around Bing Concert Hall* is checkable, an invented neighbourhood name
would not be. Each button draws its area on the campus map. Practice games never touch
the daily score.

The day is remembered in the browser (localStorage, nothing leaves the phone): a reload
resumes where you were, a finished day shows its result rather than a replay, and the end
screen counts days played, the current and best streak, and how your days have scored.
Answers are stored by building name, so a later data rebuild cannot rescore a past day.

## Practise your misses

A building you miss in the daily comes back a median **8 days** later (p90 35 — measured
over 365 seeded days), so the daily alone never tells you whether you learned it. Every
end screen therefore lists how many buildings you have got wrong in a daily and not got
right since, and offers them as a game of their own, ten at a time, newest miss first.
A right answer there — or on a later daily — clears it; missing it again on a later day
reopens it. Like the area games, this never touches the daily score. The fixes are kept
in the browser by building name and campus day, next to the daily record.

## Running it

```sh
python3 -m http.server 8000 --directory site    # then open localhost:8000
node site/game-logic.test.mjs                   # the logic suite
test/run-misses.sh                              # misses, end to end in Electron
./refetch.sh                                    # refresh the OSM extract, then rebuild
```

`site/game-logic.js` holds every decision worth testing — round selection, decoys,
scoring, the geometry fit — so that "does the game work" is a question the suite can
answer. `site/app.js` is only wiring.

## Caveats

OpenStreetMap is volunteer-mapped. A name can be out of date, a corner can be wrong, and
a building split into several mapped ways keeps only its largest piece. Treat a
disagreement with reality as a bug in the map, and
[fix it there](https://www.openstreetmap.org/).

Building footprints © OpenStreetMap contributors, [ODbL](https://opendatacommons.org/licenses/odbl/).
