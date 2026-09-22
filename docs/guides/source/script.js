(function () {
  'use strict';
  var reduce = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  /* ---------- тема: явный выбор поверх системной ---------- */
  var root = document.documentElement;
  var themeBtn = document.querySelector('[data-theme-toggle]');
  function currentTheme() {
    var stamped = root.getAttribute('data-theme');
    if (stamped) return stamped;
    return window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
  }
  function paintThemeBtn() {
    if (!themeBtn) return;
    themeBtn.textContent = currentTheme() === 'dark' ? '☀ Светлая тема' : '☾ Темная тема';
  }
  try {
    var saved = localStorage.getItem('sm-guide-theme');
    if (saved === 'dark' || saved === 'light') root.setAttribute('data-theme', saved);
  } catch (e) {}
  paintThemeBtn();
  if (themeBtn) {
    themeBtn.addEventListener('click', function () {
      var next = currentTheme() === 'dark' ? 'light' : 'dark';
      root.setAttribute('data-theme', next);
      try { localStorage.setItem('sm-guide-theme', next); } catch (e) {}
      paintThemeBtn();
    });
  }

  /* ---------- повторные снимки берут src у первого вхождения ---------- */
  document.querySelectorAll('img[data-img]').forEach(function (img) {
    var src = document.querySelector('img[data-key="' + img.getAttribute('data-img') + '"]');
    if (src) img.src = src.getAttribute('src');
  });

  /* ---------- появление при прокрутке ---------- */
  var inView = document.querySelectorAll('.reveal, .section, .fsm, .clock, .matrix');
  var vh = window.innerHeight || 800;
  Array.prototype.forEach.call(inView, function (el) {
    var r = el.getBoundingClientRect();
    if (r.top < vh * 0.9) { el.classList.add('is-in', 'no-anim'); }
  });
  if ('IntersectionObserver' in window) {
    var io = new IntersectionObserver(function (entries) {
      entries.forEach(function (en) {
        if (en.isIntersecting) { en.target.classList.add('is-in'); io.unobserve(en.target); }
      });
    }, { rootMargin: '0px 0px -8% 0px', threshold: 0.08 });
    Array.prototype.forEach.call(inView, function (el) { if (!el.classList.contains('is-in')) io.observe(el); });
  } else {
    Array.prototype.forEach.call(inView, function (el) { el.classList.add('is-in', 'no-anim'); });
  }
  // индексы для каскадных задержек
  document.querySelectorAll('.stagger').forEach(function (g) {
    Array.prototype.forEach.call(g.children, function (c, i) { c.style.setProperty('--i', i); });
  });
  document.querySelectorAll('.matrix').forEach(function (t) {
    var i = 0;
    t.querySelectorAll('.chk, .no, .part').forEach(function (c) { c.style.setProperty('--i', i++); });
  });

  /* ---------- оглавление: подсветка текущего раздела ---------- */
  var links = Array.prototype.slice.call(document.querySelectorAll('.toc a[href^="#"]'));
  var targets = links.map(function (a) { return document.getElementById(a.getAttribute('href').slice(1)); }).filter(Boolean);
  function spy() {
    var y = window.scrollY + 120;
    var current = targets[0];
    for (var i = 0; i < targets.length; i++) { if (targets[i].offsetTop <= y) current = targets[i]; }
    links.forEach(function (a) { a.classList.toggle('is-current', current && a.getAttribute('href') === '#' + current.id); });
  }
  var ticking = false;
  window.addEventListener('scroll', function () {
    if (ticking) return;
    ticking = true;
    requestAnimationFrame(function () { spy(); ticking = false; });
  }, { passive: true });
  spy();

  /* ---------- лайтбокс для скриншотов ---------- */
  var lb = document.createElement('div');
  lb.className = 'lb';
  lb.innerHTML = '<img alt=""><div class="lb__cap"></div>';
  document.body.appendChild(lb);
  var lbImg = lb.querySelector('img');
  var lbCap = lb.querySelector('.lb__cap');
  function openLb(img, cap) {
    lbImg.src = img.src;
    lbCap.textContent = cap || img.alt || '';
    lb.classList.add('is-open');
    document.body.style.overflow = 'hidden';
  }
  function closeLb() { lb.classList.remove('is-open'); document.body.style.overflow = ''; }
  lb.addEventListener('click', closeLb);
  document.addEventListener('keydown', function (e) { if (e.key === 'Escape') closeLb(); });
  document.querySelectorAll('.shot__frame, .stage__img').forEach(function (f) {
    f.addEventListener('click', function () {
      var img = f.querySelector('img');
      var cap = f.closest('.shot') ? f.closest('.shot').querySelector('.shot__cap') : f.parentNode.querySelector('.stage__txt');
      if (img) openLb(img, cap ? cap.textContent.trim().slice(0, 140) : '');
    });
  });

  /* ---------- сценарии: пошаговый проигрыватель ---------- */
  document.querySelectorAll('.scenario').forEach(function (sc) {
    var steps = Array.prototype.slice.call(sc.querySelectorAll('.step'));
    var panes = Array.prototype.slice.call(sc.querySelectorAll('.stage__pane'));
    var playBtn = sc.querySelector('[data-play]');
    var stepMs = Number(sc.getAttribute('data-step-ms')) || 5000;
    var idx = 0, timer = null, playing = !reduce, hovered = false;
    sc.style.setProperty('--step-ms', stepMs + 'ms');

    function show(i) {
      idx = (i + steps.length) % steps.length;
      steps.forEach(function (s, k) {
        s.classList.toggle('is-active', k === idx);
        s.classList.toggle('is-done', k < idx);
        s.classList.toggle('is-playing', k === idx && playing && !hovered);
        var bar = s.querySelector('.step__bar i');
        if (bar) { bar.style.animation = 'none'; void bar.offsetWidth; bar.style.animation = ''; }
      });
      panes.forEach(function (p, k) { p.classList.toggle('is-active', k === idx); });
      schedule();
    }
    function schedule() {
      clearTimeout(timer);
      if (playing && !hovered) timer = setTimeout(function () { show(idx + 1); }, stepMs);
    }
    function setPlaying(v) {
      playing = v;
      if (playBtn) { playBtn.textContent = playing ? '❚❚' : '▶'; playBtn.title = playing ? 'Пауза' : 'Играть'; }
      steps[idx].classList.toggle('is-playing', playing && !hovered);
      schedule();
    }
    steps.forEach(function (s, k) { s.addEventListener('click', function () { show(k); }); });
    sc.querySelector('[data-prev]') && sc.querySelector('[data-prev]').addEventListener('click', function () { show(idx - 1); });
    sc.querySelector('[data-next]') && sc.querySelector('[data-next]').addEventListener('click', function () { show(idx + 1); });
    playBtn && playBtn.addEventListener('click', function () { setPlaying(!playing); });
    sc.addEventListener('mouseenter', function () { hovered = true; steps[idx].classList.remove('is-playing'); clearTimeout(timer); });
    sc.addEventListener('mouseleave', function () { hovered = false; if (playing) { steps[idx].classList.add('is-playing'); show(idx); } });
    // Автопроигрывание начинается, когда блок попал на экран.
    if ('IntersectionObserver' in window && !reduce) {
      playing = false;
      var seen = false;
      var o = new IntersectionObserver(function (en) {
        if (en[0].isIntersecting && !seen) { seen = true; setPlaying(true); o.disconnect(); }
      }, { threshold: 0.35 });
      o.observe(sc);
    }
    if (playBtn) { playBtn.textContent = playing ? '❚❚' : '▶'; }
    show(0);
  });

  /* ---------- живая карточка сигнала в hero ---------- */
  var demo = document.querySelector('[data-demo]');
  if (demo && !reduce) {
    var badge = demo.querySelector('.sig__badge');
    var tLabel = demo.querySelector('.sig__timer-label');
    var tValue = demo.querySelector('.sig__timer-value');
    var event = demo.querySelector('.sig__event');
    var foot = demo.querySelector('.sig__foot-r');
    var track = demo.querySelectorAll('.sig__track span');
    var stepMs = 3400;
    demo.style.setProperty('--sig-step', stepMs + 'ms');
    var phases = [
      { color: 'var(--yellow)', cls: 'badge--yellow', badge: 'Новая проблема', label: 'В работе уже', from: 46 * 60 + 12, run: true, ev: 'Сигнал создан · автор', foot: 'До эскалации: 1 ч 48 мин' },
      { color: 'var(--red)', cls: 'badge--red', badge: 'Критичная проблема', label: 'В работе уже', from: 48 * 60, run: true, ev: 'Автоэскалация · Система', foot: 'Порог 48 ч пройден' },
      { color: 'var(--green)', cls: 'badge--green', badge: 'Проблема решена', label: 'Время решения', from: 49 * 60 + 5, run: false, ev: 'Закрыт · Администратор', foot: 'Терминальный статус' },
    ];
    var ph = 0, minutes = phases[0].from, tick = null;
    function plural(n, a, b, c) { var m = n % 10, mm = n % 100; if (m === 1 && mm !== 11) return a; if (m >= 2 && m <= 4 && (mm < 10 || mm >= 20)) return b; return c; }
    function fmt(m) { var d = Math.floor(m / 1440), h = Math.floor((m % 1440) / 60), mm = m % 60; return d > 0 ? d + ' ' + plural(d, 'день', 'дня', 'дней') + ' ' + h + ' ч' : h + ' ч ' + mm + ' мин'; }
    function apply(i) {
      ph = i; var p = phases[i];
      demo.style.setProperty('--sig-color', p.color);
      badge.className = 'badge sig__badge ' + p.cls;
      badge.textContent = p.badge;
      tLabel.textContent = p.label;
      minutes = p.from; tValue.textContent = fmt(minutes);
      foot.textContent = p.foot;
      event.textContent = p.ev; event.classList.add('is-on');
      setTimeout(function () { event.classList.remove('is-on'); }, 1900);
      track.forEach(function (t, k) { t.classList.toggle('is-done', k < i); t.classList.toggle('is-live', k === i); });
      clearInterval(tick);
      if (p.run) tick = setInterval(function () { minutes += 7; tValue.textContent = fmt(minutes); }, 240);
    }
    apply(0);
    setInterval(function () { apply((ph + 1) % phases.length); }, stepMs);
  }
})();
