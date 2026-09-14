/* ============================================================
   CYBERGUARD ACADEMY v2 — Interactivity Script
   Features: dropdown nav, tabs, accordions, copy buttons,
   interactive demo terminals, quiz engine, TOC scrollspy,
   tool search, back-to-top, robust reveal animations.
   ============================================================ */
(function () {
  'use strict';

  document.documentElement.classList.add('js');

  if (window.top !== window.self) {
    try { window.top.location.href = window.self.location.href; }
    catch (e) { window.location.href = 'about:blank'; }
  }

  function qs(sel, ctx) { return (ctx || document).querySelector(sel); }
  function qsa(sel, ctx) { return Array.prototype.slice.call((ctx || document).querySelectorAll(sel)); }

  /* ================= MOBILE NAV ================= */
  var toggle = qs('.nav-toggle');
  var navLinks = qs('.nav-links');
  if (toggle && navLinks) {
    function closeMobileNav() {
      navLinks.classList.remove('open');
      toggle.classList.remove('open');
      qsa('.nav-dd').forEach(function (o) { o.classList.remove('open'); });
    }
    toggle.addEventListener('click', function (e) {
      e.stopPropagation();
      var willOpen = !navLinks.classList.contains('open');
      navLinks.classList.toggle('open', willOpen);
      toggle.classList.toggle('open', willOpen);
      if (!willOpen) qsa('.nav-dd').forEach(function (o) { o.classList.remove('open'); });
    });
    document.addEventListener('click', function (e) {
      if (navLinks.classList.contains('open') && !navLinks.contains(e.target) && !toggle.contains(e.target)) {
        closeMobileNav();
      }
    });
    window.addEventListener('resize', function () {
      if (window.innerWidth > 1024) closeMobileNav();
    });
  }

  /* ================= DROPDOWN NAVS ================= */
  qsa('.nav-dd').forEach(function (dd) {
    var link = qs('.nav-link', dd);
    if (!link) return;
    link.addEventListener('click', function (e) {
      if (window.innerWidth <= 1024) {
        e.preventDefault();
        dd.classList.toggle('open');
        qsa('.nav-dd').forEach(function (o) { if (o !== dd) o.classList.remove('open'); });
      }
    });
    dd.addEventListener('mouseenter', function () { if (window.innerWidth > 1024) dd.classList.add('open'); });
    dd.addEventListener('mouseleave', function () { if (window.innerWidth > 1024) dd.classList.remove('open'); });
  });

  /* ================= TABS ================= */
  qsa('.tab-nav').forEach(function (nav) {
    nav.addEventListener('click', function (e) {
      var btn = e.target.closest('.tab-btn');
      if (!btn) return;
      var tabs = nav.closest('.tabs');
      if (!tabs) return;
      qsa('.tab-btn', nav).forEach(function (b) { b.classList.remove('active'); });
      qsa('.tab-panel', tabs).forEach(function (p) { p.classList.remove('active'); });
      btn.classList.add('active');
      var panel = qs('#' + 'tab-' + btn.getAttribute('data-tab'), tabs);
      if (panel) panel.classList.add('active');
    });
  });

  /* TOC links that target a tab category switch to that tab first */
  qsa('.toc a[href^="#"]').forEach(function (a) {
    a.addEventListener('click', function (e) {
      var key = a.getAttribute('href').slice(1);
      var btn = qs('.tab-btn[data-tab="' + key + '"]');
      if (!btn) return;
      var nav = btn.closest('.tab-nav');
      var tabs = btn.closest('.tabs');
      if (!nav || !tabs) return;
      e.preventDefault();
      qsa('.tab-btn', nav).forEach(function (b) { b.classList.remove('active'); });
      qsa('.tab-panel', tabs).forEach(function (p) { p.classList.remove('active'); });
      btn.classList.add('active');
      var panel = qs('#tab-' + key, tabs);
      if (panel) {
        panel.classList.add('active');
        if (panel.scrollIntoView) panel.scrollIntoView({ behavior: 'smooth', block: 'start' });
      }
    });
  });

  /* ================= ACCORDIONS ================= */
  var accs = qsa('details.acc');
  accs.forEach(function (acc) {
    acc.addEventListener('toggle', function () {
      if (acc.open) {
        accs.forEach(function (o) { if (o !== acc) o.open = false; });
      }
    });
  });

  /* ================= COPY TERMINAL CODE ================= */
  qsa('.term-copy').forEach(function (btn) {
    btn.addEventListener('click', function () {
      var term = btn.closest('.terminal');
      var code = term ? qs('pre', term).innerText : '';
      var done = function () {
        btn.classList.add('copied');
        var old = btn.innerHTML;
        btn.innerHTML = 'Salin';
        showToast('Perintah berhasil disalin');
        setTimeout(function () { btn.classList.remove('copied'); btn.innerHTML = old; }, 1600);
      };
      if (navigator.clipboard && window.isSecureContext) {
        navigator.clipboard.writeText(code).then(done, function () { fallbackCopy(code, done); });
      } else {
        fallbackCopy(code, done);
      }
    });
  });

  function fallbackCopy(text, cb) {
    var ta = document.createElement('textarea');
    ta.value = text;
    ta.style.position = 'fixed';
    ta.style.opacity = '0';
    document.body.appendChild(ta);
    ta.select();
    try { document.execCommand('copy'); cb(); } catch (e) {}
    document.body.removeChild(ta);
  }

  /* ================= TOAST ================= */
  var toastEl = qs('.toast');
  var toastTimer;
  function showToast(msg) {
    if (!toastEl) return;
    qs('span', toastEl).textContent = msg;
    toastEl.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { toastEl.classList.remove('show'); }, 2400);
  }

  /* ================= BACK TO TOP ================= */
  var backTop = qs('.back-top');
  if (backTop) {
    var onScrollBt = function () { backTop.classList.toggle('visible', window.scrollY > 420); };
    window.addEventListener('scroll', onScrollBt, { passive: true });
    onScrollBt();
    backTop.addEventListener('click', function () { window.scrollTo({ top: 0, behavior: 'smooth' }); });
  }

  /* ================= TOC SCROLLSPY ================= */
  var toc = qs('.toc');
  var tocLinks = toc ? qsa('a[href^="#"]', toc) : [];
  if (tocLinks.length) {
    var titles = tocLinks
      .map(function (a) { return qs(a.getAttribute('href')); })
      .filter(Boolean);
    var onScrollSpy = function () {
      var pos = window.scrollY + 120;
      var current = null;
      titles.forEach(function (el) {
        if (el.offsetTop <= pos) current = el;
      });
      tocLinks.forEach(function (a) {
        a.classList.toggle('active', current && a.getAttribute('href') === '#' + current.id);
      });
    };
    window.addEventListener('scroll', onScrollSpy, { passive: true });
    onScrollSpy();
  }

  /* ================= TOOLS SEARCH ================= */
  var searchInput = qs('#toolSearch');
  if (searchInput) {
    var toolItems = qsa('.tool-item');
    var toolPanes = qsa('.tab-panel');
    searchInput.addEventListener('input', function () {
      var q = searchInput.value.trim().toLowerCase();
      toolItems.forEach(function (it) {
        var hit = q === '' || it.textContent.toLowerCase().indexOf(q) !== -1;
        it.style.display = hit ? '' : 'none';
      });
      toolPanes.forEach(function (p) {
        var any = qsa('.tool-item', p).some(function (it) { return it.style.display !== 'none'; });
        p.style.display = any ? '' : 'none';
      });
    });
  }

  /* ================= REVEAL ON SCROLL (robust) ================= */
  var revealEls = qsa('.reveal');
  if (window.IntersectionObserver) {
    var io = new IntersectionObserver(function (entries) {
      entries.forEach(function (en) {
        if (en.isIntersecting) { en.target.classList.add('in'); io.unobserve(en.target); }
      });
    }, { threshold: 0.06 });
    revealEls.forEach(function (el, i) {
      el.style.transitionDelay = (i % 4) * 0.05 + 's';
      io.observe(el);
    });
    // Safety net: force shown after load so nothing stays invisible
    setTimeout(function () {
      revealEls.forEach(function (el, i) {
        var r = el.getBoundingClientRect();
        if (r.top < window.innerHeight) el.classList.add('in');
      });
    }, 1400);
  }

  /* ================= INTERACTIVE DEMO TERMINALS ================= */
  var demoDB = {
    'nmap': [
      { in: 'nmap -sV -p- --open 10.10.10.5', out: [
        'Starting Nmap 7.94 ( https://nmap.org )',
        'Nmap scan report for 10.10.10.5',
        '22/tcp  open  ssh     OpenSSH 8.2p1 Ubuntu 4ubuntu0.5',
        '80/tcp  open  http    Apache httpd 2.4.41',
        '445/tcp open  smb     Samba smbd 4.6.2-RC2',
        'MAC Address: 00:0C:29:3A:2B:1E (VMware)',
        'Nmap done: 1 IP address (1 host up) scanned in 8.47 seconds'] },
      { in: 'nmap --script vulners -sV -p445 10.10.10.5', out: [
        'PORT   STATE SERVICE VERSION',
        '445/tcp open  smb     Samba smbd 4.6.2-RC2',
        '| vulners:',
        '|   cpe:/a:oracle:samba:4.6.2:',
        '|       CVE-2017-7494   9.8    https://vulners.com/.../CVE-2017-7494',
        '|_      CVE-2017-10993  7.5    https://vulners.com/.../CVE-2017-10993'] },
      { in: 'nmap -sV 80.200.1.5', out: 'Host is down.' }
    ],
    'sqlmap': [
      { in: 'sqlmap -u "http://target/search?id=1" --dbs --batch', out: [
        '---',
        '[INFO] testing connection to the target URL',
        '[INFO] checking if the target is protected by some kind of WAF/IPS',
        '[INFO] URL parameter [id] appears to be injectable',
        '[INFO] fetching database names',
        '[2/2]',
        '[*] information_schema',
        '[+] dvwa'] },
      { in: 'sqlmap -u "http://target/search?id=1" -D dvwa --tables --batch', out: [
        'Database: dvwa',
        '[3 tables]',
        '+----------+',
        '| accounts |',
        '| session  |',
        '| users    |',
        '+----------+'] },
      { in: 'sqlmap --help', out: ['sqlmap/1.7. - automatic SQL injection and database takeover tool'] }
    ],
    'msfconsole': [
      { in: 'msfconsole -q', out: [...[], 'msf6 >', 'Metasploit Framework ready. Type help to list commands.'] },
      { in: 'search samba 4.6', out: [
        'Matching Modules',
        '================',
        '#   Name                               Disclosure Date  Rank    Check  Description',
        '0   exploit/linux/samba/is_known_pipid  2017-05-24       great   Yes    Samba is_known_pipid()'] },
      { in: 'use exploit/linux/samba/is_known_pipid', out: ['[*] Using exploit/linux/samba/is_known_pipid'] }
    ],
    'curl': [
      { in: 'curl -sI https://example.com', out: [
        'HTTP/2 200',
        'content-type: text/html; charset=UTF-8',
        'server: ECS (dcb/7E98)',
        'strict-transport-security: max-age=31536000'] },
      { in: 'curl -X POST -d "user=admin&pass=letmein" http://target/login', out: [
        'HTTP/1.1 302 Found',
        'Location: /dashboard.php',
        'Set-Cookie: PHPSESSID=9a8b7c6d5e4f'] }
    ],
    'generic': [
      { in: 'whoami', out: ['www-data'] },
      { in: 'pwd', out: ['/var/www/html'] },
      { in: 'uname -a', out: ['Linux target 5.4.0-91-generic #102-Ubuntu SMP x86_64 GNU/Linux'] },
      { in: 'ip a', out: ['eth0: inet 10.10.10.5/24 scope global'] }
    ],
    'soc': [
      { in: 'search bruteforce', out: [
        'index=splunk EventCode=4625',
        '',
        '28 events (last 60 minutes) | top src_ip:',
        '  45.155.205.11  -> 17 events [match: intel.bad]',
        '  10.20.5.14     -> 6 events  [corporate, escalate]',
        '  172.26.8.3     -> 5 events  [false positive, test acc]',
        '',
        'next: tail authlog untuk detail host 10.20.5.14'] },
      { in: 'tail authlog', out: [
        '/var/log/auth.log (last 12 lines)',
        'Feb 12 03:12:01 srv sshd[5512]: Failed password for root from 45.155.205.11 port 53412',
        'Feb 12 03:12:11 srv sshd[5513]: Failed password for admin from 45.155.205.11 port 53413',
        'Feb 12 03:13:02 srv sshd[5521]: Failed password for admin from 45.155.205.11 port 53414',
        'Feb 12 03:14:40 srv sshd[5544]: Failed password for backup from 45.155.205.11 port 53420',
        'Feb 12 03:15:03 srv sshd[5550]: Failed password for svc_deploy from 45.155.205.11 port 53421',
        '[!] pattern: sesuai kata sandi aktor brute-force | dideteksi tkit'] },
      { in: 'check pcap', out: [
        'suricata -r session.pcap -S /etc/suricata/rules/',
        '',
        'EVENT  1: ET MALWARE Timed Out .NET connection to C2',
        'EVENT  2: ET POLICY Suspicious TLS to unknown domain: q.x7b8.fun',
        'EVENT  3: ET INFO outbound to 185.220.101.4:4444',
        'next: list process pada host yang sama'] },
      { in: 'list process', out: [
        'SELECT name, path, pid FROM processes',
        '',
        'powershell.exe    C:\\Windows\\System32\\WindowsPowerShell\\v1.0  PID 2012',
        'rundll32.exe      C:\\Windows\\Temp\\prox32.dll                  PID 3018 [SUSPICIOUS]',
        'msiexec.exe       C:\\Windows\\system32\\msiexec.exe             PID 2120',
        '',
        '[+] EDR kicked isolation; ticket escalated to IR Tier 2'] },
      { in: 'help', out: [
        'commands tersedia:',
        '  search bruteforce  -- contoh query SIEM failed logon',
        '  tail authlog       -- lihat log otentikasi terakhir',
        '  check pcap         -- analisis paket dengan Suricata',
        '  list process       -- telemetri proses mencurigakan'] },
      { in: 'whoami', out: ['soc-analyst'] }
    ]
  };

  qsa('.demo-term').forEach(function (term) {
    var body = qs('.demo-term-body', term);
    if (!body) return;
    var profile = term.getAttribute('data-profile') || 'generic';
    var inputWrap = qs('.dt-input-line', term);
    var input = qs('.dt-input', term);
    if (!input || !inputWrap) return;

    function typeAndRun() {
      var val = input.value.trim();
      if (!val) return;
      input.value = '';
      appendLine('$ ' + val, 'dt-cmd');
      var entry = null;
      var db = demoDB[profile] || demoDB.generic;
      for (var i = 0; i < db.length; i++) {
        if (val === db[i].in) { entry = db[i]; break; }
      }
      if (entry) {
        setTimeout(function () {
          entry.out.forEach(function (l, idx) {
            setTimeout(function () { appendLine(l, ''); }, idx * 120);
          });
        }, 120);
      } else {
        var low = val.toLowerCase();
        var ctx = (profile === 'nmap') ? 'nmap' : (profile === 'sqlmap') ? 'sqlmap' : (profile === 'msfconsole') ? 'metasploit' : 'shell';
        appendLine('command not found: ' + val + ' (coba "help" untuk konteks ' + ctx + ')', 't-hot');
      }
    }
    function appendLine(text, cls) {
      var div = document.createElement('div');
      div.className = 'line ' + cls;
      div.textContent = text;
      body.insertBefore(div, inputWrap);
      body.scrollTop = body.scrollHeight;
    }
    input.addEventListener('keydown', function (e) {
      if (e.key === 'Enter') typeAndRun();
    });
    body.addEventListener('click', function () { input.focus(); });
  });

  /* ================= QUIZ ENGINE ================= */
  qsa('.quiz').forEach(function (quiz) {
    var opts = qsa('.quiz-opt', quiz);
    var dataIdx = parseInt(quiz.getAttribute('data-correct'), 10);
    var feedback = qs('.quiz-feedback', quiz);
    opts.forEach(function (opt, i) {
      opt.addEventListener('click', function () {
        opts.forEach(function (o) {
          o.classList.remove('selected', 'correct', 'wrong');
        });
        opt.classList.add('selected');
        if (i === dataIdx) {
          opt.classList.add('correct');
          feedback.textContent = quiz.getAttribute('data-explain') || 'Jawaban benar.';
          feedback.className = 'quiz-feedback ok';
        } else {
          opt.classList.add('wrong');
          feedback.textContent = quiz.getAttribute('data-explain-wrong') || 'Belum tepat. Coba pilih jawaban lain.';
          feedback.className = 'quiz-feedback bad';
        }
      });
    });
  });
})();