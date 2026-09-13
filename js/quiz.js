/* ============================================================
   CYBERGUARD ACADEMY — Quiz Engine (hubungan dgn quiz-data.js)
   Rendering kategori + kartu soal + navigasi + hasil akhir.
   ============================================================ */
(function () {
  'use strict';

  function qs(s, c) { return (c || document).querySelector(s); }
  function qsa(s, c) { return Array.prototype.slice.call((c || document).querySelectorAll(s)); }

  var DATA = window.QUIZ_DATA || [];

  var tabsEl = qs('#quizTabs');
  var panelEl = qs('#quizPanel');
  if (!tabsEl || !panelEl || !DATA.length) return;

  var LETTERS = ['A', 'B', 'C', 'D', 'E'];

  var state = {
    cat: 0,
    q: 0,
    answers: []
  };

  function currentCat() { return DATA[state.cat]; }
  function currentQ() { return currentCat().questions[state.q]; }

  /* ---------- helpers ---------- */
  function el(tag, cls, html) {
    var e = document.createElement(tag);
    if (cls) e.className = cls;
    if (html != null) e.innerHTML = html;
    return e;
  }

  function scoreFor() {
    var cat = currentCat();
    var ok = 0;
    for (var i = 0; i < cat.questions.length; i++) {
      if (state.answers[i] === cat.questions[i].correct) ok++;
    }
    return ok;
  }
  function answeredCount() {
    var c = 0;
    for (var i = 0; i < state.answers.length; i++) if (state.answers[i] != null) c++;
    return c;
  }

  /* ---------- render: tabs ---------- */
  function renderTabs() {
    tabsEl.innerHTML = '';
    DATA.forEach(function (cat, i) {
      var b = el('button', 'tab-btn' + (i === state.cat ? ' active' : ''));
      b.setAttribute('data-tab', cat.key);
      var it = cat.icon ? '<svg class="quiz-tab-ic"><use href="#' + cat.icon + '"/></svg>' : '';
      b.innerHTML = it + '<span>' + cat.label + '</span><span class="quiz-tab-count">' + cat.questions.length + '</span>';
      b.addEventListener('click', function () {
        switchCat(i);
      });
      tabsEl.appendChild(b);
    });
  }

  /* ---------- render: question card ---------- */
  function renderQuestion() {
    var cat = currentCat();
    var q = currentQ();
    var total = cat.questions.length;

    panelEl.innerHTML = '';
    panelEl.className = 'quiz-stage';

    /* progress + meta */
    var meta = el('div', 'quiz-meta');
    var progWrap = el('div', 'quiz-progress');
    var bar = el('div', 'quiz-progress-bar');
    bar.style.width = ((state.q + 1) / total * 100) + '%';
    progWrap.appendChild(bar);
    var posTxt = el('span', 'quiz-pos', 'Soal <b>' + (state.q + 1) + '</b> / ' + total);
    var scoreTxt = el('span', 'quiz-score', 'Benar: <b>' + scoreFor() + '</b> / ' + total);
    meta.appendChild(posTxt);
    meta.appendChild(scoreTxt);
    panelEl.appendChild(progWrap);
    panelEl.appendChild(meta);

    /* question */
    var qNum = el('span', 'quiz-qnum', cat.label.toUpperCase() + ' · Q' + (state.q + 1));
    var qText = el('h3', 'quiz-q', qNum.outerHTML + ' ' + q.q);
    panelEl.appendChild(qText);

    /* options */
    var answered = state.answers[state.q];
    var optsWrap = el('div', 'quiz-opts');
    q.opts.forEach(function (txt, i) {
      var o = el('button', 'quiz-opt');
      o.setAttribute('type', 'button');
      o.innerHTML = '<span class="ab">' + LETTERS[i] + '</span><span>' + txt + '</span>';
      if (answered != null) {
        o.disabled = true;
        if (i === q.correct) o.classList.add('correct');
        else if (i === answered) o.classList.add('wrong');
      }
      o.addEventListener('click', function () {
        if (state.answers[state.q] != null) return;
        state.answers[state.q] = i;
        highlightAnswer(i);
      });
      optsWrap.appendChild(o);
    });
    panelEl.appendChild(optsWrap);

    /* feedback */
    var fb = el('div', 'quiz-feedback');
    if (answered != null) {
      var isOk = answered === q.correct;
      fb.className = 'quiz-feedback ' + (isOk ? 'ok' : 'bad');
      fb.innerHTML = (isOk ? '<strong>Benar.</strong> ' : '<strong>Belum tepat.</strong> ') + q.explain;
    } else {
      fb.innerHTML = '<span class="quiz-hint">Klik salah satu jawaban di atas.</span>';
    }
    panelEl.appendChild(fb);

    /* nav */
    var nav = el('div', 'quiz-nav');
    if (state.q > 0) {
      nav.appendChild(btn('Sebelumnya', 'q-btn q-prev', function () { state.q--; renderQuestion(); }));
    }
    if (state.q < total - 1) {
      nav.appendChild(btn('Lanjut →', 'q-btn q-next', function () { state.q++; renderQuestion(); }));
    } else {
      nav.appendChild(btn('Lihat Hasil', 'q-btn q-result', function () { renderResult(); }));
    }
    if (answeredCount() === total) {
      nav.appendChild(btn('Ulangi Kategori', 'q-btn q-reset', function () { resetCat(); }));
    }
    if (nav.childNodes.length) panelEl.appendChild(nav);

    panelEl.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  function highlightAnswer(chosen) {
    var opts = qsa('.quiz-opt', panelEl);
    var q = currentQ();
    var fb = qs('.quiz-feedback', panelEl);
    opts.forEach(function (o, i) {
      o.disabled = true;
      if (i === q.correct) o.classList.add('correct');
      else if (i === chosen) o.classList.add('wrong');
    });
    var isOk = chosen === q.correct;
    fb.className = 'quiz-feedback ' + (isOk ? 'ok' : 'bad');
    fb.innerHTML = (isOk ? '<strong>Benar.</strong> ' : '<strong>Belum tepat.</strong> ') + q.explain;
    var scoreTxt = qs('.quiz-score');
    if (scoreTxt) scoreTxt.innerHTML = 'Benar: <b>' + scoreFor() + '</b> / ' + currentCat().questions.length;
  }

  function btn(txt, cls, fn) {
    var b = el('button', cls, txt);
    b.setAttribute('type', 'button');
    b.addEventListener('click', fn);
    return b;
  }

  /* ---------- render: result ---------- */
  function renderResult() {
    var cat = currentCat();
    var total = cat.questions.length;
    var ok = scoreFor();
    var pct = Math.round(ok / total * 100);

    panelEl.innerHTML = '';
    panelEl.className = 'quiz-stage';

    var box = el('div', 'quiz-result');
    var verdict = el('div', 'quiz-verdict');
    verdict.appendChild(el('div', 'quiz-verdict-score', '<b>' + ok + '</b> / ' + total));
    verdict.appendChild(el('div', 'quiz-verdict-pct', pct + '%'));
    var msg = 'Terus latihan!';
    if (pct === 100) msg = 'Sempurna! Kamu menguasai ' + cat.label + '.';
    else if (pct >= 80) msg = 'Luar biasa — sedikit lagi sempurna.';
    else if (pct >= 60) msg = 'Cukup baik. Ulangi modul terkait lalu coba lagi.';
    verdict.appendChild(el('div', 'quiz-verdict-msg', msg));
    box.appendChild(verdict);

    var bar = el('div', 'quiz-progress quiz-progress-lg');
    var fill = el('div', 'quiz-progress-bar');
    fill.style.width = pct + '%';
    bar.appendChild(fill);
    box.appendChild(bar);

    var listWrap = el('div', 'quiz-review');
    cat.questions.forEach(function (q, i) {
      var sel = state.answers[i];
      var isOk = sel === q.correct;
      var item = el('div', 'quiz-review-item ' + (isOk ? 'ok' : 'bad'));
      var mark = el('span', 'quiz-review-mark', isOk ? '✓' : '✕');
      var body = el('div', 'quiz-review-body');
      body.appendChild(el('div', 'quiz-review-q', '<b>' + (i + 1) + '.</b> ' + q.q));
      var ansInfo = isOk
        ? 'Jawabanmu benar: <b class="q-correct">' + LETTERS[q.correct] + '. ' + q.opts[q.correct] + '</b>'
        : 'Jawabanmu: ' + (sel == null ? '— (tidak dijawab)' : '<b class="q-wrong">' + LETTERS[sel] + '. ' + q.opts[sel] + '</b>') + ' · Jawaban benar: <b class="q-correct">' + LETTERS[q.correct] + '. ' + q.opts[q.correct] + '</b>';
      body.appendChild(el('div', 'quiz-review-ans', ansInfo));
      if (q.explain) body.appendChild(el('div', 'quiz-review-exp', q.explain));
      item.appendChild(mark);
      item.appendChild(body);
      listWrap.appendChild(item);
    });
    box.appendChild(listWrap);

    var actions = el('div', 'quiz-nav');
    actions.appendChild(btn('Ulangi Kategori Ini', 'q-btn q-reset', function () { resetCat(); }));
    actions.appendChild(btn('Kembali ke Awal Kategori', 'q-btn q-prev', function () { state.q = 0; renderQuestion(); }));
    box.appendChild(actions);

    panelEl.appendChild(box);
    panelEl.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  /* ---------- control ---------- */
  function resetCat() {
    state.q = 0;
    state.answers = [];
    renderQuestion();
  }
  function switchCat(i) {
    if (i === state.cat) return;
    state.cat = i;
    state.q = 0;
    state.answers = [];
    renderTabs();
    renderQuestion();
  }

  /* ---------- init ---------- */
  renderTabs();
  state.answers = new Array(currentCat().questions.length).fill(null);
  renderQuestion();
})();