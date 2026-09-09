/* ═══════════════════════════════════════════════════════════════
   CONTACT — reveal observer, the live intake sheet, and validation.

   The sheet on the right is the point of the page: everything typed
   into the form is read straight back as studio paperwork, with the
   loader's own progress rail counting how complete the brief is. It
   is bound to the form by `input` and `change` on one delegated
   listener rather than per-field handlers, so adding a field to the
   HTML with a matching [data-slot] is all it takes to include it.

   Validation is deliberately quiet: nothing complains until a field
   has been left (blur) or the form has been submitted once. After
   that a field re-checks as it is corrected, so an error clears the
   moment it stops being true.

   No endpoint ships with this page. Set data-endpoint on the form
   and the submit handler POSTs the FormData there; without it the
   send is simulated so the flow can be demonstrated end to end.
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
     STUDIO CLOCK
     The studio keeps New Delhi hours; the visitor may not. So the zone
     is named explicitly rather than read off the visitor's machine.

     The IST label is written by hand instead of asked for via
     timeZoneName: engines disagree there, and en-US in particular
     renders Asia/Kolkata as "GMT+5:30" rather than "IST".
     ═══════════════════════════════════════════════════════════════ */
  var clockEl = document.getElementById('clock');
  if (clockEl) {
    var fmt = null;
    try {
      fmt = new Intl.DateTimeFormat('en-GB', {
        timeZone: 'Asia/Kolkata',
        hour: '2-digit', minute: '2-digit', second: '2-digit',
        /* hour12:false alone still yields a 24:00 hour on some older
           engines; hourCycle pins it to 00-23. */
        hour12: false, hourCycle: 'h23'
      });
    } catch (err) { fmt = null; }

    var pad = function (n) { return (n < 10 ? '0' : '') + n; };

    var tick = function () {
      var now = new Date();
      var time;

      if (fmt) {
        time = fmt.format(now);
      } else {
        /* IST is a flat +05:30 and observes no daylight saving, so
           where Intl carries no zone data the offset is exact. */
        var ist = new Date(now.getTime() +
                           (now.getTimezoneOffset() + 330) * 60000);
        time = pad(ist.getHours()) + ':' + pad(ist.getMinutes()) +
               ':' + pad(ist.getSeconds());
      }

      clockEl.textContent = time + ' IST';
    };
    tick();
    setInterval(tick, 1000);
  }

  /* ═══════════════════════════════════════════════════════════════
     MAIL LINKS

     Every mailto: on the page is rewritten, once at load, into a Gmail
     compose URL that opens in a new tab.

     The obvious implementation — catch the click and call window.open —
     does not survive contact with a popup blocker. Chrome in particular
     blocks window.open from a file:// page and fails silently, so the
     link simply does nothing when the page is opened straight off disk,
     which is exactly how it gets demonstrated. Rewriting the href means
     the click is an ordinary link navigation: there is no handler left
     to block, and nothing to go wrong at click time.

     The original address is parked on data-mailto so it stays
     recoverable, and remains in the markup as the no-JavaScript state.
     ═══════════════════════════════════════════════════════════════ */
  function gmailCompose(href) {
    var raw = String(href).replace(/^mailto:/i, '');
    var split = raw.split('?');

    var to = decodeURIComponent(split[0] || '').trim();
    if (!to) { return ''; }

    var url = 'https://mail.google.com/mail/?view=cm&fs=1' +
              '&to=' + encodeURIComponent(to);

    /* Carry a subject or body through if an address ever grows one. */
    if (split[1]) {
      split[1].split('&').forEach(function (pair) {
        var eq = pair.indexOf('=');
        if (eq < 0) { return; }
        var key = pair.slice(0, eq).toLowerCase();
        var val = pair.slice(eq + 1);
        if (key === 'subject' || key === 'su') {
          url += '&su=' + val;
        } else if (key === 'body') {
          url += '&body=' + val;
        }
      });
    }
    return url;
  }

  var mailLinks = document.querySelectorAll('a[href^="mailto:"]');
  for (var m = 0; m < mailLinks.length; m++) {
    var mailLink = mailLinks[m];
    var mailto   = mailLink.getAttribute('href');
    var compose  = gmailCompose(mailto);
    if (!compose) { continue; }

    mailLink.setAttribute('data-mailto', mailto);
    mailLink.setAttribute('href', compose);
    mailLink.setAttribute('target', '_blank');
    mailLink.setAttribute('rel', 'noopener noreferrer');
  }

  /* ═══════════════════════════════════════════════════════════════
     THE SHEET
     ═══════════════════════════════════════════════════════════════ */
  var form = document.getElementById('briefForm');
  if (!form) { return; }

  var sheet     = document.getElementById('sheet');
  var sheetState= document.getElementById('sheetState');
  var synopsis  = document.getElementById('synopsis');
  var railFill  = document.getElementById('rail');
  var pctEl     = document.getElementById('pct');
  var counter   = document.getElementById('counter');
  var briefEl   = document.getElementById('f-brief');

  /* Every name the sheet reads back, in the order it reads them. */
  var FIELDS = ['name', 'email', 'org', 'discipline', 'budget', 'start'];

  var slots = {};
  if (sheet) {
    FIELDS.forEach(function (key) {
      slots[key] = sheet.querySelector('[data-slot="' + key + '"]');
    });
  }

  function value(key) {
    var els = form.elements[key];
    if (!els) { return ''; }
    /* A radio group comes back as a RadioNodeList, whose .value is
       already the checked entry (empty when nothing is checked). */
    var v = els.value || '';
    return v.trim();
  }

  function esc(s) {
    return String(s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;')
      .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }

  function strong(s) { return '<b>' + esc(s) + '</b>'; }

  /* One sentence a producer could read out loud. Missing pieces are
     simply left out rather than replaced with blanks, so the line
     stays grammatical at every stage of filling the form. */
  function composeSynopsis(v, words) {
    if (!v.name && !v.org && !v.discipline && !v.budget && !v.start && !words) {
      return 'The sheet fills in as you write.';
    }

    var who = v.name ? strong(v.name) : 'Someone';
    if (v.org) { who += ' at ' + strong(v.org); }

    var line;
    if (v.discipline === 'Still working it out') {
      line = who + ' has a project and is still working out the shape of it.';
    } else if (v.discipline) {
      line = who + ' is asking about ' + strong(v.discipline.toLowerCase()) + '.';
    } else {
      line = who + ' is starting a project with us.';
    }

    if (v.budget && v.budget !== 'Not set yet') {
      line += ' Budget ' + strong(v.budget) + '.';
    } else if (v.budget) {
      line += ' Budget still open.';
    }

    if (v.start === 'The date is fixed') {
      line += ' The date is fixed.';
    } else if (v.start) {
      line += ' First frame ' + strong(v.start.toLowerCase()) + '.';
    }

    if (words) {
      line += ' The brief runs ' + words + (words === 1 ? ' word.' : ' words.');
    }

    return line;
  }

  function wordCount(s) {
    var t = s.trim();
    return t ? t.split(/\s+/).length : 0;
  }

  function paint() {
    var v = {};
    var filled = 0;

    FIELDS.forEach(function (key) {
      var val = value(key);
      v[key] = val;
      if (val) { filled++; }

      var slot = slots[key];
      if (slot) {
        slot.textContent = val || '—';
        slot.classList.toggle('is-empty', !val);
      }
    });

    var text = briefEl ? briefEl.value : '';
    var words = wordCount(text);
    if (text.trim()) { filled++; }

    if (synopsis) { synopsis.innerHTML = composeSynopsis(v, words); }

    /* Seven signals: the six spec rows plus the brief itself. */
    var pct = Math.round((filled / (FIELDS.length + 1)) * 100);
    if (railFill) { railFill.style.transform = 'scaleX(' + (pct / 100) + ')'; }
    if (pctEl) { pctEl.textContent = ('00' + pct).slice(-3); }

    if (counter && briefEl) {
      var max = parseInt(briefEl.getAttribute('maxlength'), 10) || 1200;
      counter.innerHTML = text.length + ' <span class="dim">/ ' + max + '</span>';
      counter.classList.toggle('is-near', text.length > max - 120);
    }
  }

  form.addEventListener('input', paint);
  form.addEventListener('change', paint);
  paint();

  /* ═══════════════════════════════════════════════════════════════
     VALIDATION
     ═══════════════════════════════════════════════════════════════ */
  var summary     = document.getElementById('errSummary');
  var summaryH    = document.getElementById('summaryH');
  var summaryList = document.getElementById('summaryList');
  var submitted   = false;

  var RULES = [
    {
      id: 'f-name', err: 'e-name', label: 'Your name',
      test: function (val) {
        if (!val) { return 'Add your name'; }
        return '';
      }
    },
    {
      id: 'f-email', err: 'e-email', label: 'Email',
      test: function (val) {
        if (!val) { return 'Add an email we can reply to'; }
        /* Deliberately loose. The only address that matters is one a
           reply reaches, and a strict pattern rejects valid ones. */
        if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(val)) {
          return 'That address looks incomplete';
        }
        return '';
      }
    },
    {
      id: 'f-brief', err: 'e-brief', label: 'The project',
      test: function (val) {
        if (!val) { return 'Tell us what the project is'; }
        if (val.length < 24) { return 'A couple more sentences would help'; }
        return '';
      }
    }
  ];

  function fieldOf(input) {
    var n = input.parentNode;
    while (n && n !== form) {
      if (n.classList && n.classList.contains('field')) { return n; }
      n = n.parentNode;
    }
    return null;
  }

  function check(rule, show) {
    var input = document.getElementById(rule.id);
    var errEl = document.getElementById(rule.err);
    if (!input || !errEl) { return ''; }

    var message = rule.test(input.value.trim());
    var wrap = fieldOf(input);

    if (message && show) {
      errEl.textContent = message;
      errEl.hidden = false;
      input.setAttribute('aria-invalid', 'true');
      if (wrap) { wrap.classList.add('is-bad'); }
    } else {
      errEl.textContent = '';
      errEl.hidden = true;
      input.removeAttribute('aria-invalid');
      if (wrap) { wrap.classList.remove('is-bad'); }
    }
    return message;
  }

  RULES.forEach(function (rule) {
    var input = document.getElementById(rule.id);
    if (!input) { return; }

    /* Complain on leaving a field, never while it is being typed into
       for the first time. Once it has complained, it re-checks on every
       keystroke so the error clears as soon as it is fixed. */
    input.addEventListener('blur', function () { check(rule, true); });
    input.addEventListener('input', function () {
      if (submitted || input.getAttribute('aria-invalid') === 'true') {
        check(rule, true);
      }
    });
  });

  function hideSummary() {
    if (!summary) { return; }
    summary.hidden = true;
    if (summaryList) { summaryList.innerHTML = ''; }
  }

  function showSummary(problems) {
    if (!summary || !summaryList) { return; }

    summaryList.innerHTML = '';
    problems.forEach(function (p) {
      var li = document.createElement('li');
      var a = document.createElement('a');
      a.href = '#' + p.id;
      a.textContent = p.label + ': ' + p.message;
      /* An in-page hash would work, but focusing by hand keeps the
         page from jumping past the field on browsers that scroll the
         target to the very top, under the fixed nav. */
      a.addEventListener('click', function (e) {
        e.preventDefault();
        var target = document.getElementById(p.id);
        if (target) {
          target.focus();
          target.scrollIntoView({
            block: 'center',
            behavior: REDUCED ? 'auto' : 'smooth'
          });
        }
      });
      li.appendChild(a);
      summaryList.appendChild(li);
    });

    if (summaryH) {
      summaryH.textContent = problems.length === 1
        ? 'One field still needs you'
        : problems.length + ' fields still need you';
    }

    summary.hidden = false;
    summary.focus();
  }

  /* ═══════════════════════════════════════════════════════════════
     SUBMIT
     ═══════════════════════════════════════════════════════════════ */
  var sendBtn = document.getElementById('sendBtn');
  var sentEl  = document.getElementById('sent');
  var refEl   = document.getElementById('ref');
  var againBtn= document.getElementById('againBtn');

  function reference() {
    var d = new Date();
    var stamp = String(d.getFullYear()).slice(-2) +
                ('0' + (d.getMonth() + 1)).slice(-2);
    var n = ('000' + Math.floor(Math.random() * 1000)).slice(-3);
    return 'PM-' + stamp + '-' + n;
  }

  function succeed() {
    if (refEl) { refEl.textContent = reference(); }
    form.hidden = true;
    hideSummary();

    if (sentEl) {
      sentEl.hidden = false;
      sentEl.focus();
    }
    if (sheetState) { sheetState.textContent = 'Sent'; }
    if (railFill) { railFill.style.transform = 'scaleX(1)'; }
    if (pctEl) { pctEl.textContent = '100'; }
  }

  function fail() {
    if (sendBtn) {
      sendBtn.classList.remove('is-sending');
      sendBtn.disabled = false;
      sendBtn.querySelector('.send-label').textContent = 'Send the brief';
    }
    if (summary && summaryH && summaryList) {
      summaryList.innerHTML = '';
      summaryH.textContent =
        'That did not send. Try again, or write to promotion.frames@gmail.com';
      summary.hidden = false;
      summary.focus();
    }
  }

  form.addEventListener('submit', function (e) {
    e.preventDefault();
    submitted = true;

    /* A filled honeypot is a bot. Behave exactly as though it worked
       so nothing is learned from the difference. */
    var trap = form.elements.website;
    if (trap && trap.value) { succeed(); return; }

    var problems = [];
    RULES.forEach(function (rule) {
      var message = check(rule, true);
      if (message) {
        problems.push({ id: rule.id, label: rule.label, message: message });
      }
    });

    if (problems.length) { showSummary(problems); return; }
    hideSummary();

    if (sendBtn) {
      sendBtn.classList.add('is-sending');
      sendBtn.disabled = true;
      sendBtn.querySelector('.send-label').textContent = 'Sending';
    }

    var endpoint = form.getAttribute('data-endpoint');

    if (endpoint) {
      fetch(endpoint, {
        method: 'POST',
        headers: { 'Accept': 'application/json' },
        body: new FormData(form)
      }).then(function (res) {
        if (res.ok) { succeed(); } else { fail(); }
      }).catch(fail);
    } else {
      /* No endpoint wired yet. The rail animation is 1.1s, so the
         panel lands as it finishes rather than cutting it short. */
      setTimeout(succeed, REDUCED ? 120 : 1100);
    }
  });

  if (againBtn) {
    againBtn.addEventListener('click', function () {
      form.reset();
      submitted = false;

      RULES.forEach(function (rule) { check(rule, false); });
      hideSummary();

      if (sentEl) { sentEl.hidden = true; }
      form.hidden = false;

      if (sendBtn) {
        sendBtn.classList.remove('is-sending');
        sendBtn.disabled = false;
        sendBtn.querySelector('.send-label').textContent = 'Send the brief';
      }
      if (sheetState) { sheetState.textContent = 'Draft'; }

      paint();

      var first = document.getElementById('f-name');
      if (first) { first.focus(); }
    });
  }
})();
