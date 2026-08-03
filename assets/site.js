/* Spark site behaviour. Small on purpose.

   External rather than inline so the Content-Security-Policy in `_headers` can keep
   `script-src 'self'` — with no inline script anywhere, an injected <script> does not run.
   It also means this reveal logic exists once instead of being copy-pasted into six pages.

   Everything here is progressive: with JS disabled the reveal class never lands, so the
   `.rise` elements would stay at opacity 0 — the stylesheet must therefore treat visibility
   as the JS-enabled enhancement, which it does via `prefers-reduced-motion` and the fallback
   below that reveals everything if IntersectionObserver is missing. */
(function () {
  'use strict';

  var revealables = document.querySelectorAll('.rise');

  function revealAll() {
    for (var i = 0; i < revealables.length; i++) revealables[i].classList.add('in');
  }

  // No IntersectionObserver (or the user prefers reduced motion): show everything at once
  // rather than leaving content invisible. Content must never depend on an animation.
  var reduced = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  if (!('IntersectionObserver' in window) || reduced) {
    revealAll();
  } else {
    var io = new IntersectionObserver(function (entries) {
      entries.forEach(function (e) {
        if (e.isIntersecting) { e.target.classList.add('in'); io.unobserve(e.target); }
      });
    }, { threshold: 0.1, rootMargin: '0px 0px -6% 0px' });

    for (var j = 0; j < revealables.length; j++) io.observe(revealables[j]);

    // Anything already in the first viewport should not wait for a scroll that may never come.
    requestAnimationFrame(function () {
      document.querySelectorAll('header .rise').forEach(function (el) { el.classList.add('in'); });
    });
  }

  /* Scrollspy — only for same-page anchors. A chapter's nav links point at `index.html#adapt`,
     which is a different document; spying on those would highlight a section that isn't here. */
  var navLinks = [].slice.call(document.querySelectorAll('.topnav a.nl'))
    .filter(function (a) { return (a.getAttribute('href') || '').charAt(0) === '#'; });

  if (navLinks.length && 'IntersectionObserver' in window) {
    var byId = {};
    navLinks.forEach(function (a) { byId[a.getAttribute('href').slice(1)] = a; });

    var spy = new IntersectionObserver(function (entries) {
      entries.forEach(function (e) {
        var a = byId[e.target.id];
        if (a && e.isIntersecting) {
          navLinks.forEach(function (l) { l.classList.remove('on'); });
          a.classList.add('on');
        }
      });
    }, { rootMargin: '-45% 0px -50% 0px' });

    Object.keys(byId).forEach(function (id) {
      var sec = document.getElementById(id);
      if (sec) spy.observe(sec);
    });
  }
})();
