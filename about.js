/* ═══════════════════════════════════════════════════════════════
   ABOUT — reveal observer + the film player.

   Native controls are not used: the loader established a visual
   grammar (mono micro-caps, 1px rails, corner ticks) that a browser
   chrome would break the moment it appeared over the frame. So the
   transport is ours, and everything the native controls gave away
   for free — keyboard, ARIA state, buffering feedback — is put back
   by hand below.

   The source is a large master file. Nothing here fetches more than
   its header until the visitor starts it, or until the frame is
   comfortably in view and the browser has told us it can autoplay
   muted.
   ═══════════════════════════════════════════════════════════════ */
(function () {
  'use strict';

  var REDUCED = window.matchMedia &&
                window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  /* ── nav condenses once the page has moved ─────────────────── */
  var scrolled = false;
  function onScroll() {
    var past = window.scrollY > 24;
    if (past !== scrolled) {
      scrolled = past;
      document.body.classList.toggle('is-scrolled', past);
    }
  }
  window.addEventListener('scroll', onScroll, { passive: true });
  onScroll();

  /* ── entrance ──────────────────────────────────────────────── */
  var risers = document.querySelectorAll('.rise');
  if (!('IntersectionObserver' in window) || REDUCED) {
    for (var i = 0; i < risers.length; i++) { risers[i].classList.add('is-in'); }
  } else {
    var reveal = new IntersectionObserver(function (entries) {
      entries.forEach(function (e) {
        if (e.isIntersecting) {
          e.target.classList.add('is-in');
          reveal.unobserve(e.target);
        }
      });
    }, { rootMargin: '0px 0px -12% 0px', threshold: 0.08 });
    for (var j = 0; j < risers.length; j++) { reveal.observe(risers[j]); }
  }

  /* ═══════════════════════════════════════════════════════════════
     PLAYER
     ═══════════════════════════════════════════════════════════════ */
  var video  = document.getElementById('film-video');
  var screen = document.getElementById('screen');
  if (!video || !screen) { return; }

  var playBtn  = document.getElementById('playBtn');
  var soundBtn = document.getElementById('soundBtn');
  var fsBtn    = document.getElementById('fsBtn');
  var scrub    = document.getElementById('scrub');
  var fill     = document.getElementById('fill');
  var buf      = document.getElementById('buf');
  var head     = document.getElementById('head');
  var tcNow    = document.getElementById('tcNow');
  var tcEnd    = document.getElementById('tcEnd');

  function clock(s) {
    if (!isFinite(s) || s < 0) { return '--:--'; }
    var m = Math.floor(s / 60);
    var r = Math.floor(s % 60);
    return (m < 10 ? '0' : '') + m + ':' + (r < 10 ? '0' : '') + r;
  }

  /* The plate stays up until a real frame exists to replace it, so the
     panel never cuts from gradient to black to picture. */
  function ready() { screen.classList.add('is-ready'); }
  video.addEventListener('loadeddata', ready);
  if (video.readyState >= 2) { ready(); }

  video.addEventListener('loadedmetadata', function () {
    tcEnd.textContent = clock(video.duration);
  });

  /* ── transport ─────────────────────────────────────────────── */
  function play() {
    var p = video.play();
    /* A rejected play() is normal (autoplay policy, a decode still in
       flight) and must not leave the UI claiming to be playing. */
    if (p && typeof p.catch === 'function') { p.catch(function () { paint(); }); }
  }
  function toggle() { if (video.paused) { play(); } else { video.pause(); } }

  function paint() {
    var playing = !video.paused && !video.ended;
    screen.classList.toggle('is-playing', playing);
    /* Idle keeps the veil and transport pinned open while stopped;
       once running they follow hover and focus instead. */
    screen.classList.toggle('is-idle', !playing);
    playBtn.setAttribute('aria-label', playing ? 'Pause film' : 'Play film');
  }
  video.addEventListener('play', paint);
  video.addEventListener('pause', paint);
  video.addEventListener('ended', paint);
  paint();

  playBtn.addEventListener('click', function (e) { e.stopPropagation(); toggle(); });

  /* Click anywhere on the picture, the way a player is expected to
     behave — but not on the transport itself. */
  screen.addEventListener('click', function (e) {
    if (e.target.closest('.bar') || e.target.closest('.play')) { return; }
    toggle();
  });

  /* ── sound ─────────────────────────────────────────────────── */
  function setMuted(m) {
    video.muted = m;
    soundBtn.innerHTML = m ? 'Sound&nbsp;off' : 'Sound&nbsp;on';
    soundBtn.setAttribute('aria-pressed', String(m));
  }
  soundBtn.addEventListener('click', function (e) {
    e.stopPropagation();
    setMuted(!video.muted);
    /* Unmuting is an explicit request to hear it — start it if the
       visitor unmuted a stopped film. */
    if (!video.muted && video.paused) { play(); }
  });
  setMuted(true);

  /* ── full screen ───────────────────────────────────────────── */
  fsBtn.addEventListener('click', function (e) {
    e.stopPropagation();
    var box = screen;
    if (document.fullscreenElement) {
      document.exitFullscreen();
    } else if (box.requestFullscreen) {
      box.requestFullscreen().catch(function () {});
    } else if (video.webkitEnterFullscreen) {
      video.webkitEnterFullscreen();          // iPhone: video only
    }
  });

  /* ── progress ──────────────────────────────────────────────── */
  function setBar(el, v) { el.style.transform = 'scaleX(' + v + ')'; }

  video.addEventListener('timeupdate', function () {
    var d = video.duration;
    var p = (isFinite(d) && d > 0) ? video.currentTime / d : 0;
    setBar(fill, p);
    head.style.left = (p * 100) + '%';
    tcNow.textContent = clock(video.currentTime);
    scrub.setAttribute('aria-valuenow', Math.round(p * 100));
    scrub.setAttribute('aria-valuetext', clock(video.currentTime) + ' of ' + clock(d));
  });

  video.addEventListener('progress', function () {
    var d = video.duration;
    if (!isFinite(d) || d <= 0 || !video.buffered.length) { return; }
    /* The last range is not necessarily the one being watched; report
       the range that actually contains the playhead. */
    var t = video.currentTime, end = 0;
    for (var k = 0; k < video.buffered.length; k++) {
      if (video.buffered.start(k) <= t && t <= video.buffered.end(k)) {
        end = video.buffered.end(k);
        break;
      }
    }
    setBar(buf, end / d);
  });

  /* ── seeking ───────────────────────────────────────────────── */
  function seekTo(clientX) {
    var d = video.duration;
    if (!isFinite(d) || d <= 0) { return; }
    var r = scrub.getBoundingClientRect();
    var p = Math.min(1, Math.max(0, (clientX - r.left) / r.width));
    video.currentTime = p * d;
    setBar(fill, p);
    head.style.left = (p * 100) + '%';
    tcNow.textContent = clock(video.currentTime);
  }

  var dragging = false;
  scrub.addEventListener('pointerdown', function (e) {
    e.stopPropagation();
    dragging = true;
    scrub.setPointerCapture(e.pointerId);
    seekTo(e.clientX);
  });
  scrub.addEventListener('pointermove', function (e) {
    if (dragging) { seekTo(e.clientX); }
  });
  function endDrag(e) {
    if (!dragging) { return; }
    dragging = false;
    if (e.pointerId !== undefined && scrub.hasPointerCapture(e.pointerId)) {
      scrub.releasePointerCapture(e.pointerId);
    }
  }
  scrub.addEventListener('pointerup', endDrag);
  scrub.addEventListener('pointercancel', endDrag);
  /* The scrub is a <button>; without this a click would also fire
     Space/Enter activation and a second seek. */
  scrub.addEventListener('click', function (e) { e.stopPropagation(); e.preventDefault(); });

  /* Arrow keys give the slider role something to do. */
  scrub.addEventListener('keydown', function (e) {
    var d = video.duration;
    if (!isFinite(d) || d <= 0) { return; }
    var step = e.shiftKey ? 30 : 5;
    if (e.key === 'ArrowRight' || e.key === 'ArrowUp') {
      video.currentTime = Math.min(d, video.currentTime + step);
    } else if (e.key === 'ArrowLeft' || e.key === 'ArrowDown') {
      video.currentTime = Math.max(0, video.currentTime - step);
    } else if (e.key === 'Home') { video.currentTime = 0;
    } else if (e.key === 'End')  { video.currentTime = d;
    } else { return; }
    e.preventDefault();
    e.stopPropagation();
  });

  /* ── page-level keys ───────────────────────────────────────── */
  document.addEventListener('keydown', function (e) {
    var t = e.target;
    if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable)) { return; }
    /* Let Space activate a focused button normally. */
    if (e.code === 'Space' && t && t.tagName === 'BUTTON') { return; }

    if (e.code === 'Space' || e.key === 'k') {
      e.preventDefault();
      toggle();
    } else if (e.key === 'm' || e.key === 'M') {
      setMuted(!video.muted);
    }
  });

  /* ── viewport behaviour ────────────────────────────────────────
     Muted autoplay when the frame is properly in view, and a pause on
     the way out so a scrolled-past film is not still decoding. Once
     the visitor has taken control by hand, the observer stops making
     decisions for them. */
  var manual = false;
  ['click', 'keydown'].forEach(function (evt) {
    screen.addEventListener(evt, function () { manual = true; });
  });
  playBtn.addEventListener('click', function () { manual = true; });

  if ('IntersectionObserver' in window && !REDUCED) {
    var watch = new IntersectionObserver(function (entries) {
      entries.forEach(function (e) {
        if (e.isIntersecting && e.intersectionRatio > 0.55) {
          if (!manual && video.paused) { play(); }
        } else if (!video.paused) {
          video.pause();
        }
      });
    }, { threshold: [0, 0.55] });
    watch.observe(screen);
  }

  /* A tab switch should not leave audio playing in the background. */
  document.addEventListener('visibilitychange', function () {
    if (document.hidden && !video.paused) { video.pause(); }
  });
})();
