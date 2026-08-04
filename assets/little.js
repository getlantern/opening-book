/* Little people.
 *
 * After teamLab's "A Musical Wall where Little People Live" (2017–, Athletics Forest, teamLab
 * Planets Tokyo), where tiny figures run around inside a wall and climb, slide and jump on
 * whatever is attached to it.
 *
 * Here the page is the wall. Real elements — headings, cards, rows, buttons — are measured and
 * become solid boxes in the figures' world. They wander; walk into the side of something and
 * they build a ladder up its face and carry on over the top; meet a small gap and they leap it;
 * and a drifting ember that passes too close sends one spinning into the air.
 *
 * A deploy hazard worth knowing about, because the failure was silent and lasted four hours.
 *
 * This file is served from a content-hashed path (see build.sh), and for a while every new hash
 * came back as index.html on the live domain — status 200, content-type text/html — so the page
 * rendered and this script simply never ran, with nothing in the console to say why.
 *
 * The cause was not caching, though it looked exactly like it. Cloudflare Pages decides how to
 * answer an unmatched path by looking at which files a project ships: with no 404.html it infers
 * a single-page app and serves index.html with 200. The site had no 404.html. So during the brief
 * window after a deploy when a colo has the new HTML (served DYNAMIC, never cached) but has not
 * yet resolved the new asset, a request for this file got a 200 — a cacheable success — and
 * /assets/* carries a long max-age, so that HTML was pinned under this script's URL for hours.
 * The site now ships a 404.html, which flips Pages to returning a real 404 for unmatched paths.
 *
 * Two corollaries. Anything that fetches an asset promptly after a deploy could trigger it, not
 * just a person. And "the live HTML names the new hash" is not evidence the asset has propagated,
 * because HTML and assets are cached differently — an earlier deploy check assumed it was and so
 * poisoned the path it was verifying. deploy.sh now probes through a unique query string, which
 * is a separate cache key, and touches the real URL only once the probe returns JavaScript.
 *
 * Constraints this respects:
 *   - Same-origin file, so the strict `script-src 'self'` CSP holds.
 *   - `pointer-events: none`; it must never intercept a click.
 *   - Stops for `prefers-reduced-motion`, leaving a legible static scene.
 *   - Sleeps when the tab is hidden, and only draws near the viewport.
 */
(function () {
  'use strict';

  var host = document.querySelector('[data-little-people]');
  if (!host || !window.requestAnimationFrame) return;

  var reduced = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  /* Terrain by selector rather than hand-marked elements, so new sections are inhabited without
     anyone remembering to annotate them. */
  /* The hero copy is deliberately absent: nobody stands on the headline or the kicker. In the
     hero the only terrain is the barren ground and the shelf at the break, so everyone there is
     working on getting through. Other sections keep their cards and rows. */
  var LEDGE_SEL = '[data-ledge], .card, .shead h2, .row, .lp, .fig .box, .note';

  var CAPS = ['#ff8a3d', '#5fd4b4', '#9d7bff', '#ffb072'];     // site accents, for hats
  var FIRE = ['#fff1d2', '#ffe0a8', '#ffc98c', '#ffb072',      // embers are NOT site accents:
              '#ff9a52', '#ff8a3d', '#f4761f', '#e05a15'];     // teal and violet do not burn
  var INK = '#ece7dd', BG = '#0a0b11';

  var FIG_H = 26;
  var WALK = 24, CLIMB = 30, FALL_G = 470, BUILD_RATE = 46;
  var JUMP_GAP = 82, JUMP_RISE = 30, JUMP_DROP = 54, JUMP_SPEED = 92;
  var MAX_DROP = 300;          // beyond this they think better of stepping off
  var LADDER_REACH = 118;      // taller and a ladder becomes a fence across the copy

  var canvas = document.createElement('canvas');
  canvas.setAttribute('aria-hidden', 'true');
  canvas.style.cssText = 'position:fixed;inset:0;width:100vw;height:100vh;pointer-events:none;z-index:3';
  document.body.appendChild(canvas);
  var ctx = canvas.getContext('2d');

  var boxes = [], walls = [], figures = [], ladders = [], sparks = [];
  var lipBox = null, mouthBox = null, groundBox = null, vanish = null, goal = null;
  var W = 0, H = 0, docH = 0, FLOOR = 0, running = false, last = 0;

  /* ---- terrain ---------------------------------------------------------------------------- */

  /* Layout position via the offsetParent chain. getBoundingClientRect() includes the `.rise`
     reveal transform, so anything not yet scrolled into view measures 18px low and the ground
     would shift under the figures as the reader scrolls. offsetTop ignores transforms. */
  function docRect(el) {
    var x = 0, y = 0, n = el;
    while (n) { x += n.offsetLeft; y += n.offsetTop; n = n.offsetParent; }
    return { x0: x, x1: x + el.offsetWidth, yTop: y, yBot: y + el.offsetHeight };
  }

  function measure() {
    var dpr = Math.min(window.devicePixelRatio || 1, 2);
    W = window.innerWidth; H = window.innerHeight;
    docH = Math.max(document.body.scrollHeight, document.documentElement.scrollHeight);
    canvas.width = Math.round(W * dpr); canvas.height = Math.round(H * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

    boxes = [];
    var sel = document.querySelectorAll(LEDGE_SEL);
    for (var i = 0; i < sel.length; i++) {
      var el = sel[i];
      if (el.offsetWidth < 34 || el.offsetHeight < 10) continue;
      // The full-bleed guard keeps page-width containers from being treated as ground, but it
      // only applies to elements matched by selector. Anything carrying data-ledge is an explicit
      // author declaration and is trusted: the barren ground is deliberately 144% of the breach
      // so it fades off-frame, which on a phone is wider than the viewport — this guard was
      // silently discarding it, so the crowd had nowhere to stand and never appeared.
      if (!el.hasAttribute('data-ledge') && el.offsetWidth > W * 0.96) continue;
      boxes.push(docRect(el));
    }
    // The crack, the foothold at it, and the ground beneath — the one place on the page where
    // a figure can actually leave.
    lipBox = mouthBox = groundBox = vanish = null;
    var mouthEl = document.querySelector('.crack-mouth');
    if (mouthEl) mouthBox = docRect(mouthEl);
    var lipEl = document.querySelector('.crack-lip');
    var gndEl = document.querySelector('.ground');
    var brEl  = document.querySelector('.breach');
    if (lipEl) lipBox = docRect(lipEl);
    if (gndEl) groundBox = docRect(gndEl);
    var tgt = mouthBox || lipBox;
    if (tgt) goal = { x: (tgt.x0 + tgt.x1) / 2, y: tgt.yTop };
    if (brEl) {
      var br = docRect(brEl);
      // The bright middle of the opening, measured from the artwork rather than guessed: the
      // brightness centroid of the rasterised SVG lands at 56.4% / 44.8%, its brightest pixel at
      // 55.9% / 40.9%. x was 0.50 here, which had them receding past the side of the crack.
      vanish = { x: br.x0 + (br.x1 - br.x0) * 0.565, y: br.yTop + (br.yBot - br.yTop) * 0.425 };
    }

    FLOOR = docH - 36;
    buildWalls();
  }

  /* Collision uses MERGED spans; surfaces and landings use the individual boxes. Without this a
     figure standing in the 12px gap between two buttons walks into a button's side and builds a
     ladder there — a 10px ladder crammed into a 12px slot. Merged, the row is one obstacle: one
     ladder at its outer edge, and those small gaps become something to leap. */
  function buildWalls() {
    var src = boxes.slice().sort(function (a, b) { return a.x0 - b.x0; });
    walls = [];
    for (var i = 0; i < src.length; i++) {
      var b = src[i], merged = false;
      for (var j = 0; j < walls.length; j++) {
        var w = walls[j];
        if (Math.abs(w.yTop - b.yTop) > 8) continue;
        if (b.x0 - w.x1 > 26 || w.x0 - b.x1 > 26) continue;
        w.x0 = Math.min(w.x0, b.x0); w.x1 = Math.max(w.x1, b.x1);
        w.yTop = Math.min(w.yTop, b.yTop); w.yBot = Math.max(w.yBot, b.yBot);
        merged = true; break;
      }
      if (!merged) walls.push({ x0: b.x0, x1: b.x1, yTop: b.yTop, yBot: b.yBot });
    }
  }

  /* Where this one is trying to get to. Everybody wants the break, but you cannot reach it from
     anywhere except the barren ground beneath it — so until you are standing on that, the ground
     IS the goal. Two stages, not one. */
  function onGround(f) {
    return !!groundBox && Math.abs(f.y - groundBox.yTop) < 4 &&
           f.x > groundBox.x0 - 6 && f.x < groundBox.x1 + 6;
  }
  function goalFor(f) {
    if (!groundBox) return goal;
    if (onGround(f)) return goal;                       // the opening
    return { x: (groundBox.x0 + groundBox.x1) / 2, y: groundBox.yTop };
  }

  function surfaceUnder(x, y) {
    var best = FLOOR;
    for (var i = 0; i < boxes.length; i++) {
      var b = boxes[i];
      if (x < b.x0 || x > b.x1) continue;
      if (b.yTop >= y - 1 && b.yTop < best) best = b.yTop;
    }
    return best;
  }

  function boxUnder(x, y) {
    for (var i = 0; i < boxes.length; i++) {
      var b = boxes[i];
      if (x >= b.x0 - 2 && x <= b.x1 + 2 && Math.abs(b.yTop - y) < 3) return b;
    }
    return null;
  }

  function obstacleAt(x, y) {
    for (var i = 0; i < walls.length; i++) {
      var w = walls[i];
      if (x < w.x0 - 1 || x > w.x1 + 1) continue;
      if (w.yTop < y - 3 && w.yBot > y - 3) return w;
    }
    return null;
  }

  /* A ledge above and within reach. Scored on whether it actually helps: height gained, and
     how much nearer to the break it puts you. Everyone here is going the same place. */
  function ledgeAbove(x, y, aim) {
    var best = null, bestScore = -1e9;
    for (var i = 0; i < walls.length; i++) {
      var w = walls[i], rise = y - w.yTop;
      if (rise < 26 || rise > LADDER_REACH) continue;
      if (x < w.x0 + 6 || x > w.x1 - 6) continue;
      var score = rise;                                     // height is progress
      if (aim) {
        var here = Math.abs(x - aim.x);
        var there = Math.abs(Math.max(w.x0 + 6, Math.min(w.x1 - 6, aim.x)) - aim.x);
        score += (here - there) * 0.55;                     // and so is getting closer
        if (w.yTop < aim.y - 2) score -= 40;                // no point overshooting past it
      }
      if (score > bestScore) { bestScore = score; best = w; }
    }
    return best;
  }

  /* Somewhere to land on the far side of a gap. The interesting case is a row of buttons: they
     rest on the same surface, so the gaps that matter are between their tops. */
  function landingAhead(x, y, dir) {
    var best = null;
    for (var i = 0; i < boxes.length; i++) {
      var b = boxes[i];
      var edge = dir > 0 ? b.x0 : b.x1;
      var gap = dir > 0 ? edge - x : x - edge;
      if (gap < 5 || gap > JUMP_GAP) continue;
      var dy = b.yTop - y;
      if (dy < -JUMP_RISE || dy > JUMP_DROP) continue;
      if (!best || gap < best.gap) best = { gap: gap, x: edge + dir * 7, y: b.yTop };
    }
    return best;
  }

  /* Is there already a ladder here? Without this check a figure that cannot make progress keeps
     raising more beside the ones it just built, and the result is a lattice. */
  function ladderNear(x, y) {
    for (var i = 0; i < ladders.length; i++) {
      var L = ladders[i];
      if (Math.abs(L.x - x) < 22 && Math.abs(L.yBot - y) < 6) return true;
    }
    return false;
  }

  /* A ladder needs clear air beside the thing it leans on. */
  function ladderFits(x, y, against) {
    if (x < 8 || x > W - 8) return false;
    for (var i = 0; i < walls.length; i++) {
      var w = walls[i];
      if (w === against) continue;
      if (w.yBot < y - 4 || w.yTop > y + 4) continue;
      if (x > w.x0 - 7 && x < w.x1 + 7) return false;
    }
    return true;
  }

  /* ---- population ------------------------------------------------------------------------- */
  function spawn(n) {
    figures = [];
    if (!boxes.length) return;

    /* Weight the first viewport. Spread evenly over the document it gets its proportional
       share — about a tenth on a ten-screen page — which leaves the one screen everybody
       actually sees looking empty. */
    var topBoxes = [];
    for (var t = 0; t < boxes.length; t++) if (boxes[t].yTop < H) topBoxes.push(boxes[t]);
    var nTop = topBoxes.length ? Math.max(7, Math.round(n * 0.18)) : 0;

    for (var i = 0; i < n; i++) {
      var b, frac;
      if (i < nTop && topBoxes.length) {
        // Round-robin, and spread along each ledge. Picking at random piled eight of them onto
        // the kicker pill and left the rest of the hero bare.
        b = topBoxes[i % topBoxes.length];
        frac = ((Math.floor(i / topBoxes.length) + 0.5) / Math.ceil(nTop / topBoxes.length));
        frac = Math.min(0.92, Math.max(0.08, frac + (Math.random() - 0.5) * 0.12));
      } else {
        b = boxes[(Math.random() * boxes.length) | 0];
        frac = 0.08 + Math.random() * 0.84;
      }
      figures.push({
        x: b.x0 + 8 + frac * Math.max(1, b.x1 - b.x0 - 16),
        y: b.yTop,
        dir: Math.random() < 0.5 ? -1 : 1,
        phase: Math.random() * 6.28,
        accent: CAPS[i % CAPS.length],
        state: 'walk', t: 0, idle: 2 + Math.random() * 7,
        ladder: null, target: 0, vy: 0, vx: 0, rot: 0, spin: 0, home: null,
        jx0: 0, jy0: 0, jx1: 0, jy1: 0, jdur: 0, arc: 0, tx0: 0, ty0: 0
      });
    }
  }

  /* The population is conserved: whoever goes through the crack is replaced by someone
     arriving on the ground below, so the scene never empties. */
  function reseed(f) {
    var b = groundBox || boxes[(Math.random() * boxes.length) | 0];
    if (!b) { f.state = 'walk'; f.t = 0; return; }
    // arrive at the far end of the ground, so there is a journey to make
    var far = goal && goal.x > (b.x0 + b.x1) / 2 ? b.x0 + 12 : b.x1 - 12;
    f.x = far + (Math.random() - 0.5) * (b.x1 - b.x0) * 0.3;
    f.y = b.yTop;
    f.dir = goal ? (goal.x > f.x ? 1 : -1) : 1;
    f.state = 'walk'; f.t = 0; f.rot = 0; f.home = null;
    f.idle = 1 + Math.random() * 5;
  }

  function newSpark(atBottom) {
    var sy = window.scrollY || 0;
    var q = Math.random();
    return {
      x: Math.random() * W,
      y: atBottom ? sy + H + Math.random() * 140 : Math.random() * Math.max(H, docH),
      vy: -(8 + Math.random() * 22),
      drift: (Math.random() - 0.5) * 16,
      ph: Math.random() * 6.28,
      r: q > 0.92 ? 2.4 + Math.random() * 1.4                 // a few proper embers
        : q > 0.7 ? 1.4 + Math.random()
                  : 0.6 + Math.random() * 0.8,               // mostly motes
      col: FIRE[(Math.pow(Math.random(), 1.5) * FIRE.length) | 0],
      life: 0, max: 14 + Math.random() * 26
    };
  }
  function seedSparks(n) { sparks = []; for (var i = 0; i < n; i++) sparks.push(newSpark(false)); }

  function stepSparks(dt) {
    var sy = window.scrollY || 0;
    for (var i = 0; i < sparks.length; i++) {
      var s = sparks[i];
      s.life += dt; s.ph += dt * 2.4;
      s.y += s.vy * dt;
      s.x += (s.drift + Math.sin(s.ph) * 11) * dt;
      if (s.life > s.max || s.y < sy - 160 || s.x < -40 || s.x > W + 40) sparks[i] = newSpark(true);
    }
  }

  /* ---- simulation ------------------------------------------------------------------------- */
  function step(dt) {
    var i, f;

    for (i = 0; i < figures.length; i++) {
      f = figures[i];
      f.t += dt;

      if (f.state === 'walk') {
        f.phase += dt * 8.5;
        f.idle -= dt;

        // Standing under the break with it in reach? Then go, right now. Waiting for the wander
        // timer meant walking straight past the one thing everybody is trying to get to.
        if (lipBox && onGround(f) && f.y > lipBox.yTop + 20 && f.y - lipBox.yTop <= LADDER_REACH &&
            f.x > lipBox.x0 - 4 && f.x < lipBox.x1 + 4 && !ladderNear(f.x, f.y)) {
          f.state = 'build'; f.t = 0;
          f.ladder = { x: f.x, yBot: f.y, yTop: lipBox.yTop, h: f.y - lipBox.yTop,
                       grow: 0, life: 0, onto: lipBox };
          ladders.push(f.ladder);
          continue;
        }
        if (f.idle <= 0) {
          f.idle = 2 + Math.random() * 5;
          // Everyone is trying to reach the break. Head that way, mostly — a little noise so it
          // is a crowd of individuals rather than a column on rails.
          var aim = goalFor(f);
          if (aim && Math.random() < 0.82) f.dir = aim.x > f.x ? 1 : -1;
          else if (Math.random() < 0.3) f.dir *= -1;

          var up = ledgeAbove(f.x, f.y, aim);
          // Climb whenever climbing helps; only dawdle when it does not.
          if (up && !ladderNear(f.x, f.y) && Math.random() < 0.72) {
            f.state = 'build'; f.t = 0;
            f.ladder = { x: f.x, yBot: f.y, yTop: up.yTop, h: f.y - up.yTop,
                         grow: 0, life: 0, onto: up };
            ladders.push(f.ladder);
            continue;
          }
          if (Math.random() < 0.22) { f.state = 'pause'; f.t = 0; continue; }
        }

        var nx = f.x + f.dir * WALK * dt;
        if (nx < 12 || nx > W - 12) {
          var edgeAim = goalFor(f);
          f.dir = edgeAim ? (edgeAim.x > f.x ? 1 : -1) : -f.dir;
          continue;
        }

        var ob = obstacleAt(nx, f.y);
        if (ob) {                                            // walked into the side of something
          var lx = f.dir > 0 ? ob.x0 - 7 : ob.x1 + 7;
          if (!ladderFits(lx, f.y, ob) || f.y - ob.yTop > LADDER_REACH || ladderNear(lx, f.y)) {
            f.dir *= -1; continue;
          }
          f.state = 'build'; f.t = 0;
          f.ladder = { x: lx, yBot: f.y, yTop: ob.yTop, h: f.y - ob.yTop,
                       grow: 0, life: 0, onto: ob };
          ladders.push(f.ladder);
          continue;
        }

        var surf = surfaceUnder(nx, f.y);
        if (surf > f.y + 2) {                                // about to step off an edge
          var land = landingAhead(f.x, f.y, f.dir);
          if (land) {
            var span = Math.abs(land.x - f.x);
            f.state = 'jump'; f.t = 0;
            f.jx0 = f.x; f.jy0 = f.y; f.jx1 = land.x; f.jy1 = land.y;
            f.jdur = Math.max(0.34, span / JUMP_SPEED);
            f.arc = 6 + Math.min(18, span * 0.34);
            continue;
          }
          // A single page-bottom floor meant anyone stepping off the lowest thing in a section
          // fell out of it and piled up at the end of the document, emptying the top of the page.
          if (surf - f.y > MAX_DROP) { f.dir *= -1; continue; }
          f.state = 'fall'; f.vy = 0; f.target = surf; f.x = nx;
          continue;
        }
        f.x = nx; f.y = surf;

      } else if (f.state === 'build') {
        f.ladder.grow = Math.min(1, (f.t * BUILD_RATE) / Math.max(1, f.ladder.h));
        if (f.ladder.grow >= 1) { f.state = 'climb'; f.t = 0; }

      } else if (f.state === 'climb') {
        var p = Math.min(1, (f.t * CLIMB) / Math.max(1, f.ladder.h));
        f.x = f.ladder.x;
        f.y = f.ladder.yBot - f.ladder.h * p;
        if (p >= 1) {
          f.y = f.ladder.yTop;
          var o = f.ladder.onto;
          if (o) {
            if (f.x < o.x0 || f.x > o.x1) f.x = f.dir > 0 ? o.x0 + 6 : o.x1 - 6;
            f.x = Math.max(o.x0 + 5, Math.min(o.x1 - 5, f.x));
          }
          f.state = 'pause'; f.t = 0; f.idle = 3 + Math.random() * 7;
        }

      } else if (f.state === 'jump') {
        var jp = Math.min(1, f.t / f.jdur);
        f.x = f.jx0 + (f.jx1 - f.jx0) * jp;
        f.y = f.jy0 + (f.jy1 - f.jy0) * jp - Math.sin(Math.PI * jp) * f.arc;
        if (jp >= 1) { f.x = f.jx1; f.y = f.jy1; f.state = 'walk'; f.t = 0; f.phase = 0; }

      } else if (f.state === 'launch') {
        f.vy += FALL_G * dt;
        f.x += f.vx * dt;
        f.y += f.vy * dt;
        f.rot += f.spin * dt;
        // Keep them over whatever they were flung off. Without this the horizontal kick carries
        // them clear of it, the surface search finds something far below, and they drain out of
        // the section entirely.
        if (f.home) {
          if (f.x < f.home.x0 + 6) { f.x = f.home.x0 + 6; f.vx = Math.abs(f.vx); }
          if (f.x > f.home.x1 - 6) { f.x = f.home.x1 - 6; f.vx = -Math.abs(f.vx); }
        } else {
          if (f.x < 10) { f.x = 10; f.vx = Math.abs(f.vx); }
          if (f.x > W - 10) { f.x = W - 10; f.vx = -Math.abs(f.vx); }
        }
        var ground = f.home ? f.home.yTop : surfaceUnder(f.x, f.y);
        if (f.vy > 0 && f.y >= ground) {
          f.y = ground; f.rot = 0; f.state = 'pause'; f.t = 0; f.idle = 2 + Math.random() * 6;
        }

      } else if (f.state === 'fall') {
        f.vy += FALL_G * dt;
        f.y += f.vy * dt;
        if (f.y >= f.target) { f.y = f.target; f.state = 'pause'; f.t = 0; }

      } else if (f.state === 'pause') {
        // Reached the crack? Then take it.
        // Up on the shelf is not through. Only a figure standing in the opening itself can
        // crawl in — which is what makes where you plant the ladder matter.
        var gap = mouthBox || lipBox;
        if (gap && vanish && f.state !== 'through' &&
            Math.abs(f.y - gap.yTop) < 4 && f.x > gap.x0 - 2 && f.x < gap.x1 + 2 &&
            f.t > 0.5) {
          f.state = 'through'; f.t = 0;
          f.tx0 = f.x; f.ty0 = f.y;
          continue;
        }
        if (f.t > 0.5 + Math.random() * 0.4) { f.state = 'walk'; f.t = 0; }

      } else if (f.state === 'through') {
        // Crawl in, then away. The first third barely moves — that is climbing into the gap —
        // and only then do they recede toward the light.
        var tp = Math.min(1, f.t / 3.4);
        var e = tp < 0.33 ? (tp / 0.33) * 0.10               // easing through the opening
                          : 0.10 + 0.90 * (function (u) { return u * u * (3 - 2 * u); })((tp - 0.33) / 0.67);
        f.x = f.tx0 + (vanish.x - f.tx0) * e;
        f.y = f.ty0 + (vanish.y - f.ty0) * e;
        if (tp >= 1) reseed(f);                             // someone new turns up below
      }
    }

    // an ember passing close to someone's middle launches them
    for (i = 0; i < figures.length; i++) {
      f = figures[i];
      if (f.state === 'launch' || f.state === 'build' || f.state === 'climb' ||
          f.state === 'through') continue;
      var cx = f.x, cy = f.y - FIG_H * 0.45;
      for (var k = 0; k < sparks.length; k++) {
        var sp = sparks[k], dx = sp.x - cx, dy = sp.y - cy;
        if (dx * dx + dy * dy > 400) continue;               // within 20px
        f.state = 'launch'; f.t = 0;
        f.home = boxUnder(f.x, f.y);
        f.vy = -(165 + Math.random() * 90);
        f.vx = (dx > 0 ? -1 : 1) * (24 + Math.random() * 46);
        f.spin = (Math.random() < 0.5 ? -1 : 1) * (7 + Math.random() * 6);
        f.rot = 0;
        sparks[k] = newSpark(true);                          // the ember is spent
        break;
      }
    }

    for (var j = ladders.length - 1; j >= 0; j--) {
      ladders[j].life += dt;
      if (ladders[j].life > 18) ladders.splice(j, 1);
    }
  }

  /* ---- drawing ---------------------------------------------------------------------------- */
  function glow(c, b) { ctx.shadowColor = c; ctx.shadowBlur = b; }

  function drawSpark(s) {
    var fade = Math.min(1, s.life / 1.2) * Math.max(0, 1 - Math.max(0, s.life - (s.max - 3)) / 3);
    var tw = 0.65 + 0.35 * Math.sin(s.ph * 3.1);
    ctx.save();
    ctx.globalAlpha = fade * tw;
    ctx.fillStyle = s.col; glow(s.col, 7);
    ctx.beginPath(); ctx.arc(s.x, s.y, s.r, 0, 6.284); ctx.fill();
    ctx.restore();
  }

  function drawLadder(L) {
    var top = L.yBot - L.h * L.grow;
    var fade = L.life > 14 ? Math.max(0, 1 - (L.life - 14) / 4) : 1;
    ctx.save();
    ctx.globalAlpha = 0.55 * fade;
    ctx.strokeStyle = INK; ctx.lineWidth = 1.2; ctx.lineCap = 'round';
    glow(INK, 3);
    ctx.beginPath();
    ctx.moveTo(L.x - 5, L.yBot); ctx.lineTo(L.x - 5, top);
    ctx.moveTo(L.x + 5, L.yBot); ctx.lineTo(L.x + 5, top);
    for (var y = L.yBot - 6; y > top; y -= 7) { ctx.moveTo(L.x - 5, y); ctx.lineTo(L.x + 5, y); }
    ctx.stroke();
    ctx.restore();
  }

  /* Laid out from the feet up. Deriving it head-downward gave a 0.6px torso, and a tall filled
     triangle above the head read as a candle flame — hence the hood, clipped to the skull so it
     sits ON the head rather than floating above it. */
  function drawFigure(f) {
    var h = FIG_H;
    var HIP = -0.30 * h, SHO = -0.52 * h, HR = 0.19 * h, HC = SHO - HR * 0.92;
    var walking = f.state === 'walk', climbing = f.state === 'climb';
    var airborne = f.state === 'jump' || f.state === 'launch' || f.state === 'fall';
    var swing = walking ? Math.sin(f.phase) : 0;
    var cs = climbing ? Math.sin(f.t * 9) : 0;
    var bob = walking ? Math.abs(Math.cos(f.phase)) * h * 0.025 : 0;

    ctx.save();
    ctx.translate(f.x, f.y - bob);
    if (f.state === 'through') {                            // crawling in, then receding
      var tp = Math.min(1, f.t / 3.4);
      ctx.globalAlpha = tp < 0.25 ? 1 : Math.max(0, 1 - Math.pow((tp - 0.25) / 0.75, 1.7));
      var k = 1 - 0.90 * (tp < 0.3 ? tp * 0.5 : tp);        // barely shrinks while still in the gap
      ctx.scale(Math.max(0.08, k), Math.max(0.08, k));
    }
    if (f.state === 'launch') { ctx.translate(0, -h * 0.45); ctx.rotate(f.rot); ctx.translate(0, h * 0.45); }
    ctx.lineCap = 'round'; ctx.lineJoin = 'round';
    ctx.strokeStyle = INK; ctx.lineWidth = 1.6;
    glow(INK, 4);

    ctx.beginPath(); ctx.arc(0, HC, HR, 0, 6.284);
    ctx.fillStyle = BG; ctx.fill(); ctx.stroke();                            // head
    ctx.beginPath(); ctx.moveTo(0, SHO); ctx.lineTo(0, HIP); ctx.stroke();   // torso

    ctx.beginPath();                                                          // legs
    if (climbing) {
      ctx.moveTo(0, HIP); ctx.lineTo(-h * 0.15, HIP - HIP * (1 + cs * 0.3));
      ctx.moveTo(0, HIP); ctx.lineTo(h * 0.15, HIP - HIP * (1 - cs * 0.3));
    } else if (airborne) {
      ctx.moveTo(0, HIP); ctx.lineTo(-h * 0.15 * f.dir, HIP + h * 0.11);
      ctx.moveTo(0, HIP); ctx.lineTo(h * 0.06 * f.dir, HIP + h * 0.17);
    } else {
      ctx.moveTo(0, HIP); ctx.lineTo(swing * h * 0.16, 0);
      ctx.moveTo(0, HIP); ctx.lineTo(-swing * h * 0.16, 0);
    }
    ctx.stroke();

    ctx.beginPath();                                                          // arms
    if (climbing) {
      ctx.moveTo(0, SHO + h * 0.03); ctx.lineTo(-h * 0.15, SHO - h * 0.09 * (1 - cs * 0.6));
      ctx.moveTo(0, SHO + h * 0.03); ctx.lineTo(h * 0.15, SHO - h * 0.09 * (1 + cs * 0.6));
    } else if (f.state === 'build') {
      var hammer = Math.abs(Math.sin(f.t * 7.5)) * h * 0.15;
      ctx.moveTo(0, SHO + h * 0.03); ctx.lineTo(h * 0.18 * f.dir, SHO - hammer);
      ctx.moveTo(0, SHO + h * 0.03); ctx.lineTo(-h * 0.13 * f.dir, SHO + h * 0.10);
    } else if (airborne) {
      ctx.moveTo(0, SHO + h * 0.03); ctx.lineTo(-h * 0.16, SHO - h * 0.13);
      ctx.moveTo(0, SHO + h * 0.03); ctx.lineTo(h * 0.16, SHO - h * 0.13);
    } else {
      ctx.moveTo(0, SHO + h * 0.03); ctx.lineTo(-swing * h * 0.14, SHO + h * 0.12);
      ctx.moveTo(0, SHO + h * 0.03); ctx.lineTo(swing * h * 0.14, SHO + h * 0.12);
    }
    ctx.stroke();

    /* Hood. The point sweeps BACKWARD off the crown, the way the teamLab figures' caps trail
       behind them. A point standing straight up above the head is a candle flame, which is what
       every earlier attempt here looked like. */
    ctx.fillStyle = f.accent; ctx.shadowBlur = 0;
    ctx.save();
    ctx.beginPath(); ctx.arc(0, HC, HR, 0, 6.284); ctx.clip();
    ctx.fillRect(-HR, HC - HR - 1, HR * 2, HR * 1.02);                        // crown
    ctx.restore();
    ctx.beginPath();                                                          // trailing point
    ctx.moveTo(-f.dir * HR * 0.86, HC - HR * 0.30);
    ctx.lineTo(-f.dir * HR * 1.95, HC - HR * 0.86);
    ctx.lineTo(-f.dir * HR * 0.15, HC - HR * 0.94);
    ctx.closePath(); ctx.fill();

    ctx.fillStyle = INK; ctx.shadowBlur = 0;                                  // eyes
    ctx.beginPath(); ctx.arc(f.dir * HR * 0.26 - HR * 0.24, HC + HR * 0.10, 0.85, 0, 6.284); ctx.fill();
    ctx.beginPath(); ctx.arc(f.dir * HR * 0.26 + HR * 0.24, HC + HR * 0.10, 0.85, 0, 6.284); ctx.fill();

    ctx.strokeStyle = f.accent; ctx.lineWidth = 1.5; glow(f.accent, 3);       // scarf
    ctx.beginPath(); ctx.moveTo(0, SHO + 1); ctx.lineTo(-f.dir * h * 0.09, SHO + h * 0.12);
    ctx.stroke();
    ctx.restore();
  }

  function draw() {
    var sy = window.scrollY || 0;
    ctx.clearRect(0, 0, W, H);
    ctx.save();
    ctx.translate(0, -sy);                                   // world is in document coordinates
    var top = sy - 120, bot = sy + H + 120;                  // draw only near the viewport
    for (var k = 0; k < sparks.length; k++)
      if (sparks[k].y > top && sparks[k].y < bot) drawSpark(sparks[k]);
    for (var i = 0; i < ladders.length; i++)
      if (ladders[i].yBot > top && ladders[i].yTop < bot) drawLadder(ladders[i]);
    for (var j = 0; j < figures.length; j++)
      if (figures[j].y > top && figures[j].y < bot) drawFigure(figures[j]);
    ctx.restore();
  }

  /* ---- loop --------------------------------------------------------------------------------- */
  function frame(now) {
    if (!running) return;
    var dt = Math.min(0.05, (now - last) / 1000 || 0);       // a backgrounded tab returns a huge
    last = now;                                              // delta and would teleport everyone
    step(dt); stepSparks(dt); draw();
    requestAnimationFrame(frame);
  }
  function start() {
    if (running || reduced) return;
    running = true; last = performance.now(); requestAnimationFrame(frame);
  }
  function stop() { running = false; }

  function staticScene() {
    spawn(6);
    if (boxes.length > 1) {
      var lo = boxes[1], hi = boxes[0];
      if (lo.yTop - hi.yTop > 30) {
        ladders.push({ x: lo.x0 + 20, yBot: lo.yTop, yTop: hi.yTop,
                       h: lo.yTop - hi.yTop, grow: 1, life: 0, onto: hi });
      }
    }
    draw();
  }

  function init() {
    measure();
    ladders = [];
    seedSparks(Math.round(Math.min(120, Math.max(30, (W / 26) * Math.max(1, docH / H) * 0.5))));
    if (reduced) { staticScene(); return; }
    // Scale to viewports, not raw page height: sized by pixels, a long page ends up with roughly
    // one figure per screen.
    spawn(Math.max(16, Math.min(70, Math.round((docH / H) * 5.5))));
    start();
  }

  var t;
  window.addEventListener('resize', function () { clearTimeout(t); t = setTimeout(init, 200); });
  document.addEventListener('visibilitychange', function () { document.hidden ? stop() : start(); });
  if (document.fonts && document.fonts.ready) document.fonts.ready.then(init);
  else window.addEventListener('load', init);
})();
