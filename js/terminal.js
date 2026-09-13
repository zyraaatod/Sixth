/* ============================================================
   CYBERGUARD ACADEMY — Global Real-Time Terminal (sandbox)
   A self-contained interactive shell emulator running fully in
   the browser. Includes: virtual filesystem (persisted in
   localStorage), command history, tab completion, autocomplete,
   and simulated security tools (nmap, sqlmap, ping, ssh, curl).
   Injected on every page; controlled via window.CyberTerm.
   ============================================================ */
(function () {
  'use strict';

  /* ================= DOM refs ================= */
  var shell = document.getElementById('termShell');
  var bodyEl = document.getElementById('termShellBody');
  var inputEl = document.getElementById('termInput');
  var promptEl = document.getElementById('termPrompt');

  function qs(s, c) { return (c || document).querySelector(s); }
  function qsa(s, c) { return Array.prototype.slice.call((c || document).querySelectorAll(s)); }

  /* ================= helpers ================= */
  // Shell plumbing: pipelines, redirection and command chaining are built on
  // capture-aware output. _cap collects every line while a stage runs (both
  // for silent stages and final output), _silent suppresses DOM rendering,
  // and _inp feeds captured lines as stdin to the next piped command.
  var _silent = false;
  var _cap = null;
  var _inp = null;
  function addLine(text, cls) {
    if (_cap) _cap.push([String(text), cls || '']);
    if (_silent) return;
    if (!bodyEl) return;
    var div = document.createElement('div');
    div.className = 'line' + (cls ? ' ' + cls : '');
    div.textContent = text;
    bodyEl.appendChild(div);
    bodyEl.scrollTop = bodyEl.scrollHeight;
  }
  function addLines(arr) {
    (arr || []).forEach(function (l) {
      if (typeof l === 'string') addLine(l, '');
      else addLine(l[0], l[1] || '');
    });
  }
  function wait(ms) { return new Promise(function (r) { setTimeout(r, ms); }); }

  /* ================= shell composition: pipes, redirection, chaining ================= */
  // _inp supplies stdin lines (array of strings) to the next piped command.
  function stdinLines() { return _inp ? _inp.slice() : null; }
  // permission model (realistis, pedagogis): hanya root yang bisa baca /root, /etc/shadow, /etc/sudoers
  function canRead(p) {
    if (S.user === 'root' || S.host === 'win-srv-01') return true;
    var ap = normalize(p);
    if (ap === '/etc/shadow' || ap === '/etc/sudoers') return null;
    if (ap === '/root' || ap.indexOf('/root/') === 0) return null;
    if (S.user !== 'webadmin' && (ap.indexOf('/home/webadmin/') === 0)) return null;
    return true;
  }
  function readFileLines(p) {
    if (canRead(p) === null) return null;
    var f = resolvePath(normalize(p.charAt(0) === '/' ? p : S.cwd + '/' + p));
    if (!f || f.dir || f.content == null) return null;
    return (f.content || '').split('\n');
  }
  function denyRead(a) {
    addLine('cat: ' + a + ': Permission denied (lihat sudo -l / linpeas untuk eskalasi)', 't-hot');
  }
  function stripTrailEmptyLines(arr) {
    var out = arr.slice();
    while (out.length && out[out.length - 1] === '') out.pop();
    return out;
  }
  function writeFileSt(p, lines, append) {
    var abs = normalize(p.charAt(0) === '/' ? p : S.cwd + '/' + p);
    var par = parentPath(abs);
    var dn = abs.split('/').filter(Boolean).pop();
    var pd = getDir(par);
    if (!pd) { addLine('bash: ' + p + ': No such file or directory', 't-hot'); return false; }
    var text = lines.map(function (l) { return l[0]; }).join('\n');
    if (text) text += '\n';
    if (append && pd.children[dn] && !pd.children[dn].dir) pd.children[dn].content += text;
    else pd.children[dn] = node(dn, false, text);
    saveFs();
    return true;
  }
  // split on a single top-level delimiter, respecting quotes
  function splitUnquoted(str, delim) {
    var out = [], cur = '', q = '', i, ch;
    for (i = 0; i < str.length; i++) {
      ch = str[i];
      if (q) { cur += ch; if (ch === q) q = ''; continue; }
      if (ch === '"' || ch === "'") { q = ch; cur += ch; continue; }
      if (ch === delim) { if (cur.trim()) out.push(cur.trim()); cur = ''; continue; }
      cur += ch;
    }
    if (cur.trim()) out.push(cur.trim());
    return out;
  }
  // split `;` and `&&` chains (; always runs, && stops on failure status)
  function splitChains(line) {
    var parts = [], cur = '', q = '', i, ch;
    for (i = 0; i < line.length; i++) {
      ch = line[i];
      if (q) { cur += ch; if (ch === q) q = ''; continue; }
      if (ch === '"' || ch === "'") { q = ch; cur += ch; continue; }
      if (ch === ';' || (ch === '&' && line[i + 1] === '&')) {
        if (cur.trim()) parts.push({ raw: cur.trim(), sep: ch === ';' ? ';' : '&&' });
        if (ch === '&') i++;
        cur = '';
        continue;
      }
      cur += ch;
    }
    if (cur.trim()) parts.push({ raw: cur.trim(), sep: null });
    return parts;
  }
  // pull < > >> and their file operands out of a token list
  function stripRedirect(toks) {
    var rest = [], inF = null, outOp = null, outF = null;
    for (var i = 0; i < toks.length; i++) {
      var t = toks[i];
      if (t === '<') { inF = toks[i + 1] || null; i++; }
      else if (t === '>' || t === '>>') { outOp = t; outF = toks[i + 1] || null; i++; }
      else if (t.charAt(0) === '>' && t.length > 1) { outOp = t.charAt(1) === '>' ? '>>' : '>'; outF = t.replace(/^>+/, ''); }
      else if (t.charAt(0) === '<' && t.length > 1) { inF = t.slice(1); }
      else rest.push(t);
    }
    return { toks: rest, inF: inF, outOp: outOp, outF: outF };
  }
  // $VAR and ~ expansion (top-level, quote-agnostic — fine for a sandbox)
  function expandLine(line) {
    line = line.replace(/(^|[^A-Za-z0-9_])\$([A-Za-z_][A-Za-z0-9_]*)/g, function (m, pre, name) {
      return pre + (S.env[name] != null ? S.env[name] : '');
    });
    line = line.replace(/(^|\s)~/g, '$1' + (S.env.HOME || '/home/' + S.user));
    return line;
  }

  /* ================= virtual filesystem ================= */
  function node(name, dir, content, children) {
    return { name: name, dir: !!dir, content: content || '', children: children || {} };
  }
  function seedFs() {
    var auth = [
      'Feb 12 03:11:58 srv sshd[5489]: Failed password for root from 45.155.205.11 port 53391',
      'Feb 12 03:12:01 srv sshd[5512]: Failed password for root from 45.155.205.11 port 53412',
      'Feb 12 03:12:14 srv sshd[5513]: Failed password for root from 45.155.205.11 port 53413',
      'Feb 12 03:13:02 srv sshd[5521]: Failed password for admin from 45.155.205.11 port 53414',
      'Feb 12 03:13:48 srv sshd[5530]: Failed password for admin from 45.155.205.11 port 53415',
      'Feb 12 03:14:40 srv sshd[5544]: Failed password for backup from 45.155.205.11 port 53420',
      'Feb 12 03:15:03 srv sshd[5550]: Failed password for svc_deploy from 45.155.205.11 port 53421',
      'Feb 12 03:15:58 srv sshd[5558]: Failed password for webadmin from 45.155.205.11 port 53429',
      'Feb 12 03:16:55 srv sshd[5564]: Accepted password for webadmin from 45.155.205.11 port 53440',
      'Feb 12 03:17:01 srv sshd[5565]: pam_unix(sshd:session): session opened for user webadmin by (uid=0)',
      'Feb 12 03:17:04 srv sshd[5565]: pam_unix(sshd:session): session closed for user webadmin',
      'Feb 12 04:01:22 srv sshd[5601]: Accepted password for webadmin from 192.168.1.50 port 51234'
    ].join('\n') + '\n';
    var root = node('/', true);
    root.ver = 2;
    var home = node('home', true); root.children.home = home;
    var student = node('student', true); home.children.student = student;
    var lab = node('lab', true);
    student.children.lab = lab;
    lab.children['readme.md'] = node('readme.md', false,
      '# LAB CYBERGUARD SANDBOX\n' +
      'Selamat datang di lab virtual. Semua aktivitas di sini legal dan terisolasi.\n' +
      'Mulai dengan: help | ls | cat targets.txt | nmap 192.168.1.10\n' +
      'Baca targets.txt untuk peta host latihan.\n');
    lab.children['targets.txt'] = node('targets.txt', false,
      '192.168.1.10  lab-web-01       (Ubuntu 22.04 — web server)  [target Web]  \n' +
      '192.168.1.20  win-srv-01       (Windows Server — domain)    [target AD]   \n' +
      '192.168.1.30  kali-recon       (recon host peserta)         [jangan scan] \n' +
      '10.10.10.5    htb-maquina      (HTB-style machine)          [advanced]    \n' +
      '10.0.5.7      lab-internal-01  (DMZ internal — corp)        [target DMZ]  \n');
    lab.children['scan1.txt'] = node('scan1.txt', false,
      'Starting Nmap 7.94 on lab-web-01\n' +
      '22/tcp  open  ssh      OpenSSH 8.2p1\n' +
      '80/tcp  open  http     Apache httpd 2.4.41\n' +
      '3306/tcp open  mysql    MySQL 8.0.29\n');
    lab.children['hashes.txt'] = node('hashes.txt', false,
      'admin  : 21232f297a57a5a743894a0e4a801fc3  (md5 plaintext: ?)\n' +
      'backup : 5ebe2294ecd0e0f08eab7690d2a6ee69  (md5 plaintext: ?)\n' +
      'petunjuk: crack dengan hashcat -m 0 atau john.\n');
    lab.children['flag-web.txt'] = node('flag-web.txt', false,
      'FLAG{lab-web-01} — petunjuk: gunakan nmap lalu selidiki port 80, coba sqlmap.\n');
    lab.children['flag-blue.txt'] = node('flag-blue.txt', false,
      'FLAG{blue-team} — petunjuk: grep /var/log/auth.log untuk jejak brute-force.\n');
    lab.children['flag-internal.txt'] = node('flag-internal.txt', false,
      'FLAG{dmz-internal} — petunjuk: host DMZ 10.0.5.7 kadang terpapar via ftp; baca lab/roa.txt dulu.\n');
    lab.children['roa.txt'] = node('roa.txt', false,
      'AZAS OTORISASI SANDBOX (Range of Authorization)\n' +
      '================================================\n' +
      'Penyelenggara : akademi CyberGuard.\n' +
      'Lingkup       : 10.10.10.5, 192.168.1.10, 192.168.1.20, 10.0.5.7.\n' +
      'Dilarang      : menyerang host peserta (192.168.1.30), server di luar lab.\n' +
      'Durasi        : saat sesi praktikum aktif.\n' +
      'UTK           : UU ITE No. 11/2008 jo. 19/2016 — aktivitas sesuai otorisasi resmi.\n' +
      'Mulai prosedur: tm.scope (daftar target) -> nmap -> eksploitasi -> bukti -> laporan.\n');
    lab.children['missions.txt'] = node('missions.txt', false,
      'MISI SANDBOX v2 — klaim flag setelah sukses.\n' +
      '------------------------------------------\n' +
      '1. Eksploitasi Web : sqlmap pada http://lab-web-01/search?id=1.\n' +
      '   Flag file: lab/flag-web.txt\n' +
      '2. Deteksi SOC     : analisis /var/log/auth.log (brute-force).\n' +
      '   Flag file: lab/flag-blue.txt\n' +
      '3. Pivoting DMZ    : kenali 10.0.5.7 lewat port/ftp setelah otorisasi.\n' +
      '   Flag file: lab/flag-internal.txt\n' +
      '4. Privesc (lanjut): ssh webadmin@lab-web-01 -> sudo -l -> abuse backup.sh.\n' +
      '   Flag file: /root/root.txt (baca sebagai root)\n' +
      '\n' +
      'Di terminal: token untuk mengklaim adalah nilai FLAG{...} dari file di atas.\n' +
      'Gunakan: missions | cat lab/missions.txt | flag <FLAG{...}> | score\n');
    lab.children['evidence-sqli.txt'] = node('evidence-sqli.txt', false,
      'BUKTI TEMUAN — SQL Injection pada lab-web-01 (sampel terbatas sesuai scope)\n' +
      '======================================================================\n' +
      'Pemohon    : pentest internal — ROA: lab/roa.txt\n' +
      'Target     : http://lab-web-01/search?id=1 (192.168.1.10)\n' +
      'Teknik     : boolean blind + UNION (sqlmap 1.7)\n' +
      'Dampak     : membaca skema DB "shop" + hash user admin md5\n' +
      'Bukti      : sqlmap --dbs -> information_schema, shop\n' +
      '             sqlmap --dump -> admin/21232f29..., webadmin/742929dc...\n' +
      'Status     : CUKUP untuk membuktikan dampak; TIDAK melakukan eksfiltrasi lanjutan.\n');
    lab.children['ir-report-template.md'] = node('ir-report-template.md', false,
      '# LAPORAN INSIDEN\n' +
      '=================\n' +
      '1. Ringkasan (TLP)      : LOC / CIOC, kategori, jumlah host.\n' +
      '2. Timeline             : deteksi -> triase -> containment.\n' +
      '3. Bukti & IOC          : IP, user, hash, log yang relevan.\n' +
      '4. Tindakan yang diambil: blokir, reset, pemulihan.\n' +
      '5. Akar masalah          : service terbuka, kredensial lemah, dsb.\n' +
      '6. Rekomendasi          : perbaikan yang dapat diuji (patch, playbook baru).\n');
    lab.children['ioc-list.txt'] = node('ioc-list.txt', false,
      'INDICATOR OF COMPROMISE — bruteforce SSH 45.155.205.11 (12/02/2026)\n' +
      '-----------------------------------------------------------------\n' +
      'src_ip        : 45.155.205.11\n' +
      'user_attempts : root, admin, backup, svc_deploy, webadmin\n' +
      'success       : webadmin @ 03:16:55 (Accepted password)\n' +
      'web_activity  : sqlmap terhadap /index.php?id= (03:18-03:19)\n' +
      'indicators    : surveil portal admin, phpmyadmin (403/404)\n' +
      'HASH bukti    : lihat lab/laporan -> sha256sum /var/log/auth.log\n');
    lab.children['notes.txt'] = node('notes.txt', false,
      'catatan praktikum: (folder /home/student/lab)\n' +
      '- hash sha256 memakai crypto.subtle (asli di browser).\n' +
      '- nmap / sqlmap / ping adalah simulasi pedagogis.\n' +
      '- shell v2: pipe | , redirection > >> < , chain && ;\n' +
      '- tools: hydra, hashcat, john, gobuster, nikto, searchsploit, tcpdump, ps\n' +
      '- misi & flag: missions | flag <FLAG{...}> | score\n');
    var varlog = node('log', true);
    var v = node('var', true); v.children.log = varlog;
    root.children.var = v;
    varlog.children['auth.log'] = node('auth.log', false, auth);
    varlog.children['access.log'] = node('access.log', false,
      '192.168.1.50 - - [12/Feb/2026:03:00:01 +0700] "GET / HTTP/1.1" 200 3480 "-" "Mozilla/5.0"\n' +
      '45.155.205.11 - - [12/Feb/2026:03:18:02 +0700] "GET /index.php?id=1%27%20OR%20%271%27=%271 HTTP/1.1" 500 512 "-" "sqlmap/1.7"\n' +
      '45.155.205.11 - - [12/Feb/2026:03:18:45 +0700] "GET /index.php?id=1%20UNION%20SELECT%201,2,3-- HTTP/1.1" 200 4982 "-" "sqlmap/1.7"\n' +
      '45.155.205.11 - - [12/Feb/2026:03:19:12 +0700] "POST /login.php HTTP/1.1" 200 2891 "-" "sqlmap/1.7"\n' +
      '45.155.205.11 - - [12/Feb/2026:03:20:31 +0700] "GET /admin/ HTTP/1.1" 403 2891 "-" "Mozilla/5.0"\n' +
      '45.155.205.11 - - [12/Feb/2026:03:21:00 +0700] "GET /phpmyadmin/ HTTP/1.1" 404 2891 "-" "Mozilla/5.0"\n' +
      '192.168.1.50 - - [12/Feb/2026:03:25:44 +0700] "GET /assets/app.js HTTP/1.1" 200 8812 "-" "Mozilla/5.0"\n');
    var surilog = node('suricata', true);
    varlog.children.suricata = surilog;
    surilog.children['fast.log'] = node('fast.log', false,
      '02/12/2026-03:19:07.114 [**] [1:2020001:5] ET SCAN Suspicious inbound to MSSQL [**] [Classification: Attempted Information Leak] [Priority: 2] {TCP} 45.155.205.11:39921 -> 192.168.1.10:3306\n' +
      '02/12/2026-03:22:10.114 [**] [1:2026807:4] ET MALWARE Possible Metasploit x86 Linux Mettle (stage1) [**] [Classification: A Network Trojan was detected] [Priority: 1] {TCP} 192.168.1.100:53218 -> 45.155.205.11:4444\n' +
      '02/12/2026-03:22:11.982 [**] [1:2020002:3] ET POLICY Suspicious TLS to unknown domain q.x7b8.fun [**] [Priority: 2] {TCP} 192.168.1.100:44315 -> 45.155.205.11:443\n');
    varlog.children.syslog = node('syslog', false,
      'kernel: [12345.678] audit: type=1400 apparmor="DENIED" operation="exec" info="Failed name lookup"\n' +
      'kernel: [12346.012] firewall: DROP IN=eth0 OUT= MAC=00:0c:29:3a:2b:1e SRC=45.155.205.11 DST=192.168.1.10 PROTO=TCP DPT=3306\n' +
      'Feb 12 03:22:12 srv cron[1288]: (student) CMD (/opt/backup.sh)\n');
    var etc = node('etc', true); root.children.etc = etc;
    etc.children.hosts = node('hosts', false, '127.0.0.1  localhost\n192.168.1.10  lab-web-01\n192.168.1.20  win-srv-01\n10.0.5.7    lab-internal-01\n');
    etc.children.passwd = node('passwd', false,
      'root:x:0:0:root:/root:/bin/bash\n' +
      'student:x:1000:1000:Student Lab:/home/student:/bin/bash\n' +
      'webadmin:x:1001:1001::/home/webadmin:/bin/bash\n' +
      'backup:x:1002:1002::/home/backup:/usr/sbin/nologin\n');
    etc.children.shadow = node('shadow', false,
      'root:$6$rounds=656000$labroot$wq3r9H/Edht9u1aAz7YvxNN2aQ0TbZ2hBjOqRZI6h3a4lUznYdGe7ubvmN9y8XA2xwKpYKzLQ_EX1:19000:0:99999:7:::\n' +
      'student:$6$rounds=656000$labstudent$ot7EhmAfC3Rk4zeV0EASiR0C/YFk2yYotHSN0xJEE0ECiPvSP6tAtS2yUQkv8QNU6MZKTp9VkdHL1:19000:0:99999:7:::\n' +
      'webadmin:*:19000:0:99999:7:::\n' +
      'backup:*:19000:0:99999:7:::\n');
    etc.children.crontab = node('crontab', false,
      '# /etc/crontab — environment & paths\n' +
      'SHELL=/bin/sh\n' +
      'PATH=/usr/local/sbin:/usr/local/bin:/sbin:/bin:/usr/sbin:/usr/bin\n' +
      '17 *    * * *   root    cd / && run-parts --report /etc/cron.hourly\n' +
      '*/5 *   * * *   root    /opt/backup.sh     <- script backup milik root (cek perizinan!)\n' +
      '25 6    * * *   root    test -x /usr/sbin/anacron || ( cd / && run-parts --report /etc/cron.daily )\n');
    etc.children.sudoers = node('sudoers', false,
      'root    ALL=(ALL:ALL) ALL\n' +
      '%admin  ALL=(ALL) ALL\n' +
      'webadmin ALL=(ALL:ALL) NOPASSWD: /opt/backup.sh\n' +
      'student ALL=(ALL:ALL) ALL   <- usahakan SUDO KOSONG; atur ulang segera\n');
    var lbash = node('.bash_history', false,
      'id\n' +
      'cat /home/webadmin/.backup.config\n' +
      'sudo -l\n' +
      'nmap -sV 10.10.10.5\n' +
      'exit\n');
    student.children['.bash_history'] = lbash;
    var webadmin = node('webadmin', true); home.children.webadmin = webadmin;
    webadmin.children['.backup.config'] = node('.backup.config', false,
      '# konfigurasi backup webadmin — HANYA untuk webadmin\n' +
      'db_host=127.0.0.1\n' +
      'db_user=root\n' +
      'db_pass=Winter2023!\n');
    var tmp = node('tmp', true); root.children.tmp = tmp;
    var opt = node('opt', true); root.children.opt = opt;
    var optlab = node('lab', true); opt.children.lab = optlab;
    optlab.children['index.php'] = node('index.php', false,
      '<?php\n$id = $_GET["id"];\n$q = "SELECT * FROM produk WHERE id=" . $id;  // RENTAN sqlmap\nresults($q);\n');
    var wl = node('wordlists', true); optlab.children['wordlists'] = wl;
    wl.children['passwords.txt'] = node('passwords.txt', false,
      'password\n' +
      'admin\n' +
      'secret\n' +
      'chicken\n' +
      'backup\n' +
      'student\n' +
      'guest123\n' +
      'Winter2023!\n');
    wl.children['usernames.txt'] = node('usernames.txt', false,
      'admin\n' +
      'root\n' +
      'webadmin\n' +
      'backup\n' +
      'guest\n' +
      'guard\n');
    wl.children['directory.txt'] = node('directory.txt', false,
      'admin/\n' +
      'uploads/\n' +
      'config/\n' +
      'backup/\n' +
      'private/\n' +
      'api/\n' +
      'portal/\n');
    optlab.children['backup.sh'] = node('backup.sh', false,
      '#!/bin/bash\n' +
      '# backup konfigurasi nginx — DIJALANKAN ROOT via /etc/crontab\n' +
      '# PERINGATAN: file ini world-writable (rw-rw-rw-) -> vektor privesc\n' +
      'tar czf /var/backups/web.tgz /etc/nginx/ 2>/dev/null\n');
    var rroot = node('root', true); root.children.root = rroot;
    rroot.children['root.txt'] = node('root.txt', false,
      'FLAG{pwn-root} — privilege escalation berhasil dengan bantuan backup.sh + cron root.\n' +
      'Ulangi dengan aman: sudo /opt/backup.sh  ->  id  ->  sudo /bin/bash (jika diberi izin).\n');
    return root;
  }

  var FS_KEY = 'cg_lab_fs_v2';
  var fs;
  function loadFs() {
    try {
      var raw = localStorage.getItem(FS_KEY);
      if (raw) { var p = JSON.parse(raw); if (p && p.name === '/' && p.ver === 2) return p; }
    } catch (e) {}
    fs = seedFs();
    saveFs();
    return fs;
  }
  function saveFs() {
    try { localStorage.setItem(FS_KEY, JSON.stringify(fs)); } catch (e) {}
  }

  /* ---------- path resolution ---------- */
  function resolvePath(p) {
    var parts = [];
    var base;
    if (p.charAt(0) === '/') { base = fs; }
    else { base = getDir(S.cwd); parts = S.cwd.split('/'); }
    p.split('/').forEach(function (seg) {
      if (!seg || seg === '.') return;
      if (seg === '..') { if (parts.length) parts.pop(); return; }
      parts.push(seg);
    });
    var cur = fs;
    for (var i = 0; i < parts.length; i++) {
      if (!cur.children || !cur.children[parts[i]]) return null;
      cur = cur.children[parts[i]];
    }
    return cur;
  }
  function getDir(p) {
    var n = resolvePath(p);
    return (n && n.dir) ? n : null;
  }
  function parentPath(p) {
    var parts = p.split('/').filter(function (x) { return x; });
    parts.pop();
    return '/' + parts.join('/');
  }
  function formatPath(p) {
    if (!p) return '/';
    return p.charAt(0) === '/' ? p : '/' + p;
  }
  function promptText() {
    return S.user + '@' + S.host + ':' + (S.cwd === '/' ? '/' : S.cwd) + '$';
  }
  function listDir(p) {
    var d = getDir(p);
    if (!d) return [];
    return Object.keys(d.children).sort();
  }

  /* ================= state ================= */
  var S = {
    user: 'student',
    host: 'cyberguard',
    cwd: '/home/student',
    hist: [],
    histPos: -1,
    aliases: {},
    env: {},
    toolsOpen: 0,
    lastStatus: 0,
    score: [],
    fw: { rules: [] }
  };
  function bootEnv() { S.cwd = '/home/student'; S.user = 'student'; S.host = 'cyberguard'; }

  /* ================= simulated network ================= */
  var netDB = {
    '192.168.1.10': { name: 'lab-web-01', ip: '192.168.1.10', os: 'Ubuntu 22.04', ports: { '22': ['ssh', 'OpenSSH 8.2p1'], '80': ['http', 'Apache httpd 2.4.41'], '443': ['https', 'Apache httpd 2.4.41'], '3306': ['mysql', 'MySQL 8.0.29'], '6379': ['redis', 'Redis 6.0.16'] }, creds: { ssh: ['webadmin', 'chicken'] } },
    'lab-web-01': { ip: '192.168.1.10' },
    '192.168.1.20': { name: 'win-srv-01', ip: '192.168.1.20', os: 'Windows Server 2022', ports: { '135': ['msrpc', 'Windows RPC'], '139': ['netbios-ssn', 'Samba smbd 4.6'], '445': ['microsoft-ds', 'SMBv3'], '3389': ['ms-wbt-server', 'Microsoft Terminal Services'], '5985': ['http', 'WinRM'] }, creds: { smb: ['Administrator', 'Winter2023!'], winrm: ['Administrator', 'Winter2023!'] } },
    'win-srv-01': { ip: '192.168.1.20' },
    '192.168.1.30': { name: 'kali-recon', ip: '192.168.1.30', os: 'Kali GNU/Linux Rolling', ports: {} },
    'kali-recon': { ip: '192.168.1.30' },
    '10.10.10.5': { name: 'htb-maquina', ip: '10.10.10.5', os: 'Linux 5.4.0-91', ports: { '22': ['ssh', 'OpenSSH 7.2p2'], '80': ['http', 'nginx 1.16.1'], '445': ['smb', 'Samba smbd 4.6.2-RC2'], '6379': ['redis', 'Redis 6.0.16'], '8080': ['http-proxy', 'nginx 1.16.1'] }, creds: { smb: ['guard', 'backup'], ssh: ['guard', 'backup'] } },
    'htb-maquina': { ip: '10.10.10.5' },
    '10.0.5.7': { name: 'lab-internal-01', ip: '10.0.5.7', os: 'Ubuntu 20.04 (DMZ internal)', ports: { '21': ['ftp', 'vsftpd 3.0.3'], '80': ['http', 'nginx 1.18.0 (redirect 301)'], '8080': ['http-proxy', 'nginx 1.18.0'], '389': ['ldap', 'OpenLDAP 2.4.57'] }, creds: { ftp: ['guest', 'guest123'] } },
    'lab-internal-01': { ip: '10.0.5.7' }
  };
  var webDB = {
    'http://target/search?id=1': { title: 'dvwa / search', tables: ['accounts', 'session', 'users'], dbs: ['information_schema', 'dvwa'] },
    'http://192.168.1.10/search?id=1': { title: 'lab-web-01 / search', tables: ['produk', 'users', 'orders'], dbs: ['information_schema', 'shop'] },
    'http://lab-web-01/search?id=1': { title: 'lab-web-01 / search', tables: ['produk', 'users', 'orders'], dbs: ['information_schema', 'shop'] },
    'http://10.10.10.5/api/order': { title: 'htb / api order', tables: ['users', 'orders'], dbs: ['information_schema', 'ecommerce'] },
    'http://10.0.5.7/portal?id=1': { title: 'lab-internal-01 / portal', tables: ['employees', 'depts'], dbs: ['information_schema', 'intranet'] },
    'http://lab-internal-01/portal?id=1': { title: 'lab-internal-01 / portal', tables: ['employees', 'depts'], dbs: ['information_schema', 'intranet'] }
  };
  var webDirs = {
    'http://192.168.1.10': { base: 'http://192.168.1.10', hits: { 'admin/': 301, 'uploads/': 200, 'config/': 403, 'backup/': 301 } },
    'http://lab-web-01': { base: 'http://lab-web-01', hits: { 'admin/': 301, 'uploads/': 200, 'config/': 403, 'backup/': 301 } },
    'http://10.10.10.5': { base: 'http://10.10.10.5', hits: { 'admin/': 301, 'private/': 200 } },
    'http://10.0.5.7': { base: 'http://10.0.5.7', hits: { 'portal/': 200, 'api/': 200 } },
    'http://lab-internal-01': { base: 'http://lab-internal-01', hits: { 'portal/': 200, 'api/': 200 } }
  };

  /* ================= tokenizer ================= */
  function tokenize(line) {
    var out = []; var cur = ''; var q = '';
    for (var i = 0; i < line.length; i++) {
      var ch = line[i];
      if (q) {
        if (ch === q) { q = ''; out.push(cur); cur = ''; }
        else cur += ch;
      } else if (ch === '"' || ch === "'") { q = ch; if (cur) { out.push(cur); cur = ''; } }
      else if (ch === ' ' || ch === '\t') { if (cur) { out.push(cur); cur = ''; } }
      else cur += ch;
    }
    if (cur) out.push(cur);
    return out;
  }

  /* ================= hash tools (real, browser crypto + fallback) ================= */
  function sha256Sync(msg) {
    var u = typeof TextEncoder !== 'undefined' ? Array.prototype.slice.call(new TextEncoder().encode(msg)) : [];
    if (!u.length) { for (var mi = 0; mi < msg.length; mi++) { var mk = msg.charCodeAt(mi); if (mk < 128) u.push(mk); else if (mk < 2048) u.push(192 | (mk >> 6), 128 | (mk & 63)); else u.push(224 | (mk >> 12), 128 | ((mk >> 6) & 63), 128 | (mk & 63)); } }
    var bitLenHi = Math.floor(u.length / 536870912), bitLenLo = (u.length * 8) >>> 0;
    u.push(0x80);
    while (u.length % 64 !== 56) u.push(0);
    function toBE(n) { return [(n >>> 24) & 255, (n >>> 16) & 255, (n >>> 8) & 255, n & 255]; }
    u = u.concat(toBE(bitLenHi), toBE(bitLenLo));
    var K = [0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5, 0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174, 0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da, 0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967, 0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85, 0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070, 0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3, 0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2];
    var H = [0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a, 0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19];
    function rotr(x, n) { return (x >>> n) | (x << (32 - n)); }
    for (var off = 0; off < u.length; off += 64) {
      var w = new Array(64);
      for (var i = 0; i < 16; i++) { var j = off + i * 4; w[i] = ((u[j] << 24) | (u[j + 1] << 16) | (u[j + 2] << 8) | u[j + 3]) >>> 0; }
      for (var t = 16; t < 64; t++) {
        var s0 = rotr(w[t - 15], 7) ^ rotr(w[t - 15], 18) ^ (w[t - 15] >>> 3);
        var s1 = rotr(w[t - 2], 17) ^ rotr(w[t - 2], 19) ^ (w[t - 2] >>> 10);
        w[t] = (w[t - 16] + s0 + w[t - 7] + s1) >>> 0;
      }
      var a = H[0], b = H[1], c = H[2], d = H[3], e = H[4], f = H[5], g = H[6], h = H[7];
      for (var t2 = 0; t2 < 64; t2++) {
        var S1 = rotr(e, 6) ^ rotr(e, 11) ^ rotr(e, 25);
        var ch = (e & f) ^ (~e & g);
        var temp1 = (h + S1 + ch + K[t2] + w[t2]) >>> 0;
        var S0 = rotr(a, 2) ^ rotr(a, 13) ^ rotr(a, 22);
        var maj = (a & b) ^ (a & c) ^ (b & c);
        var temp2 = (S0 + maj) >>> 0;
        h = g; g = f; f = e; e = (d + temp1) >>> 0; d = c; c = b; b = a; a = (temp1 + temp2) >>> 0;
      }
      H[0] = (H[0] + a) >>> 0; H[1] = (H[1] + b) >>> 0; H[2] = (H[2] + c) >>> 0; H[3] = (H[3] + d) >>> 0;
      H[4] = (H[4] + e) >>> 0; H[5] = (H[5] + f) >>> 0; H[6] = (H[6] + g) >>> 0; H[7] = (H[7] + h) >>> 0;
    }
    var out = '';
    for (var k = 0; k < 8; k++) out += ('00000000' + (H[k] >>> 0).toString(16)).slice(-8);
    return out;
  }
  function sha1Sync(msg) {
    var u = typeof TextEncoder !== 'undefined' ? Array.prototype.slice.call(new TextEncoder().encode(msg)) : [];
    if (!u.length) { for (var mi = 0; mi < msg.length; mi++) { var mk = msg.charCodeAt(mi); if (mk < 128) u.push(mk); else if (mk < 2048) u.push(192 | (mk >> 6), 128 | (mk & 63)); else u.push(224 | (mk >> 12), 128 | ((mk >> 6) & 63), 128 | (mk & 63)); } }
    var bitLenHi = Math.floor(u.length / 536870912), bitLenLo = (u.length * 8) >>> 0;
    u.push(0x80);
    while (u.length % 64 !== 56) u.push(0);
    function toBE(n) { return [(n >>> 24) & 255, (n >>> 16) & 255, (n >>> 8) & 255, n & 255]; }
    u = u.concat(toBE(bitLenHi), toBE(bitLenLo));
    var H = [0x67452301, 0xefcdab89, 0x98badcfe, 0x10325476, 0xc3d2e1f0];
    function rol(x, n) { return (x << n) | (x >>> (32 - n)); }
    for (var off = 0; off < u.length; off += 64) {
      var w = new Array(80);
      for (var i = 0; i < 16; i++) { var j = off + i * 4; w[i] = ((u[j] << 24) | (u[j + 1] << 16) | (u[j + 2] << 8) | u[j + 3]) >>> 0; }
      for (var t = 16; t < 80; t++) { var x = w[t - 3] ^ w[t - 8] ^ w[t - 14] ^ w[t - 16]; w[t] = rol(x, 1) >>> 0; }
      var a = H[0], b = H[1], c = H[2], d = H[3], e = H[4];
      for (var t2 = 0; t2 < 80; t2++) {
        var f, K;
        if (t2 < 20) { f = (b & c) | (~b & d); K = 0x5a827999; }
        else if (t2 < 40) { f = b ^ c ^ d; K = 0x6ed9eba1; }
        else if (t2 < 60) { f = (b & c) | (b & d) | (c & d); K = 0x8f1bbcdc; }
        else { f = b ^ c ^ d; K = 0xca62c1d6; }
        var temp = (rol(a, 5) + f + e + K + w[t2]) >>> 0;
        e = d; d = c; c = rol(b, 30) >>> 0; b = a; a = temp >>> 0;
      }
      H[0] = (H[0] + a) >>> 0; H[1] = (H[1] + b) >>> 0; H[2] = (H[2] + c) >>> 0; H[3] = (H[3] + d) >>> 0; H[4] = (H[4] + e) >>> 0;
    }
    var out = '';
    for (var k = 0; k < 5; k++) out += ('00000000' + (H[k] >>> 0).toString(16)).slice(-8);
    return out;
  }
  function shaOf(str, algo) {
    var sync = function () { return algo === 'SHA-1' ? sha1Sync(str) : sha256Sync(str); };
    try {
      if (typeof TextEncoder !== 'undefined' && crypto && crypto.subtle) {
        return crypto.subtle.digest({ name: algo }, new TextEncoder().encode(str)).then(function (buf) {
          return hex(buf);
        }).catch(function () { return sync(); });
      }
    } catch (e) {}
    return Promise.resolve(sync());
  }
  function hex(buf) {
    return Array.prototype.map.call(new Uint8Array(buf), function (x) { return ('0' + x.toString(16)).slice(-2); }).join('');
  }
  function md5impl(str) { // compact, deterministic MD5 (RFC 1321)
    var i, raw = unescape(encodeURIComponent(str)), bytes = [];
    var ml = raw.length * 8;
    for (i = 0; i < raw.length; i++) bytes.push(raw.charCodeAt(i) & 0xff);
    bytes.push(0x80);
    while (bytes.length % 64 !== 56) bytes.push(0);
    for (i = 0; i < 8; i++) bytes.push(Math.floor(ml / Math.pow(2, 8 * i)) % 256);
    var x = [];
    for (i = 0; i < bytes.length; i += 4)
      x[i >> 2] = bytes[i] | (bytes[i + 1] << 8) | (bytes[i + 2] << 16) | (bytes[i + 3] << 24);
    var a0 = 0x67452301 | 0, b0 = 0xefcdab89 | 0, c0 = 0x98badcfe | 0, d0 = 0x10325476 | 0;
    var S = [7, 12, 17, 22, 5, 9, 14, 20, 4, 11, 16, 23, 6, 10, 15, 21];
    var K = [];
    for (i = 0; i < 64; i++) K[i] = Math.floor(Math.abs(Math.sin(i + 1)) * 4294967296);
    function rol(v, n) { return (v << n) | (v >>> (32 - n)); }
    function add(x, y) { return (x + y) | 0; }
    for (i = 0; i < x.length; i += 16) {
      var A = a0, B = b0, C = c0, D = d0;
      for (var j = 0; j < 64; j++) {
        var F, g;
        if (j < 16) { F = (B & C) | ((~B) & D); g = j; }
        else if (j < 32) { F = (D & B) | ((~D) & C); g = (5 * j + 1) % 16; }
        else if (j < 48) { F = B ^ C ^ D; g = (3 * j + 5) % 16; }
        else { F = C ^ (B | (~D)); g = (7 * j) % 16; }
        var e = D; D = C; C = B;
        B = add(B, rol(add(add(A, F), add(x[i + g], K[j])), S[((j >> 4) << 2) + (j % 4)]));
        A = e;
      }
      a0 = add(a0, A); b0 = add(b0, B); c0 = add(c0, C); d0 = add(d0, D);
    }
    function h(n) {
      var parts = [];
      for (var k = 0; k < 4; k++) parts.push(((n >>> (k * 8)) & 0xff).toString(16).padStart(2, '0'));
      return parts.join('');
    }
    return h(a0) + h(b0) + h(c0) + h(d0);
  }
  function md5(str) { // reference implementation, deterministic (educational)
    // uses a compact md5 implementation
    return Promise.resolve(md5impl(str));
  }

  /* ================= command registry ================= */
  var CMD = {};

  function cmdHelp() {
    addLines([
      ['CyberGuard Sandbox — bantuan perintah', 't-purple'],
      ['', ''],
      ['Navigasi            : ls, cd, pwd, cat, head, tail, wc, tree', ''],
      ['Manipulasi file     : touch, mkdir, rm, cp, mv, echo, grep, find', ''],
      ['Proses teks/log     : sort, uniq, cut, awk (komposisi shell)', ''],
      ['Sistem              : whoami, id, date, uname, uptime, env, history', ''],
      ['Jaringan            : ip, ifconfig, netstat, ss, ping, curl, ssh', ''],
      ['SOC/IR             : last, lastlog, journalctl, lastb, iptables, ufw', ''],
      ['Privesc enum        : linpeas, getcap, sudo -l, find -perm, crontab -l', ''],
      ['Tools keamanan      : nmap, sqlmap, hash (sha256sum/md5sum/base64)', ''],
      ['Lab                 : banner, help, tutorial, reset', ''],
      ['Komposisi shell     : | (pipe), > (redireksi), ; (urutan), && (ber-akhir-baik)', ''],
      ['Atau ketik: man [perintah]  atau  [perintah] --help', ''],
      ['', ''],
      ['Contoh awal:', 't-comment'],
      ['  ls -la && cat lab/targets.txt && nmap 192.168.1.10 -sV', ''],
      ['  grep sshd /var/log/auth.log | head | sort', ''],
    ]);
  }

  function cmdBanner() {
    addLines([
      ['==============================================', 't-cyan'],
      ['  CYBERGUARD ACADEMY — Real-Time Terminal', 't-cyan'],
      ['  sandbox edukasi keamanan siber', 't-cyan'],
      ['==============================================', 't-cyan'],
      ['  user: ' + S.user + '   host: ' + S.host, ''],
      ['  ketik  help  untuk daftar perintah.', 't-comment'],
    ]);
  }

  function cmdLs(args) {
    var p = args.length ? formatPath(args[0]) : S.cwd;
    var long = args.indexOf('-l') !== -1 || args.indexOf('-la') !== -1;
    if (args.indexOf('.') !== -1 && args.indexOf('-a') === -1) { /* nothing */ }
    var d = getDir(p);
    if (!d) { addLine('ls: cannot access ' + p + ': No such file or directory', 't-hot'); return; }
    var names = listDir(p);
    if (!names.length) { addLine('(kosong)', 't-dim'); return; }
    var out = [];
    names.forEach(function (n) {
      var child = d.children[n];
      if (long) {
        var perms = child.dir ? 'drwxr-xr-x' : '-rw-r--r--';
        out.push([perms + '   ' + (child.dir ? '<DIR>  ' : String(child.content.length).padStart(6) + '  ') + n, child.dir ? 't-cmd' : '']);
      } else {
        out.push([(child.dir ? n + '/' : n), child.dir ? 't-cmd' : '']);
      }
    });
    out.forEach(function (o) { addLine(o[0], o[1]); });
  }
  function cmdCd(args) {
    var target = args[0] || '/home/' + S.user;
    var abs = target.charAt(0) === '/' ? target : S.cwd + (S.cwd === '/' ? '' : '/') + target;
    abs = normalize(abs);
    var d = getDir(abs);
    if (!d) { addLine('cd: no such file or directory: ' + target, 't-hot'); return; }
    S.cwd = abs === '/' ? '/' : abs.replace(/\/+$/, '');
    promptEl.textContent = promptText();
  }
  function normalize(p) {
    var parts = []; var abs = p.charAt(0) === '/';
    p.split('/').forEach(function (s) {
      if (!s || s === '.') return;
      if (s === '..') { if (parts.length) parts.pop(); return; }
      parts.push(s);
    });
    return (abs ? '/' : '') + parts.join('/');
  }
  function cmdPwd() { addLine(S.cwd); }
  function cmdMkdir(args) {
    if (!args.length) { addLine('mkdir: missing operand', 't-hot'); return; }
    args.forEach(function (a) {
      var abs = normalize(a.charAt(0) === '/' ? a : S.cwd + '/' + a);
      var par = parentPath(abs);
      var dn = abs.split('/').filter(Boolean).pop();
      var pd = getDir(par);
      if (!pd) { addLine('mkdir: cannot create ' + a + ': No such file or directory', 't-hot'); return; }
      if (pd.children[dn]) { addLine('mkdir: cannot create ' + a + ': File exists', 't-hot'); return; }
      pd.children[dn] = node(dn, true); saveFs();
    });
  }
  function cmdTouch(args) {
    args.forEach(function (a) {
      var abs = normalize(a.charAt(0) === '/' ? a : S.cwd + '/' + a);
      var par = parentPath(abs); var dn = abs.split('/').filter(Boolean).pop();
      var pd = getDir(par);
      if (!pd) return;
      if (!pd.children[dn]) { pd.children[dn] = node(dn, false); saveFs(); }
    });
  }
  function cmdRm(args) {
    if (!args.length) { addLine('rm: missing operand', 't-hot'); return; }
    var force = args[0] === '-f' || args[0] === '-rf' || args[0] === '-fr';
    var rest = force ? args.slice(1) : args;
    rest.forEach(function (a) {
      var abs = normalize(a.charAt(0) === '/' ? a : S.cwd + '/' + a);
      var par = parentPath(abs); var dn = abs.split('/').filter(Boolean).pop();
      var pd = getDir(par);
      if (!pd || !pd.children[dn]) { addLine('rm: cannot remove ' + a + ': No such file or directory', 't-hot'); return; }
      delete pd.children[dn]; saveFs();
    });
  }
  function cmdCat(args) {
    if (!args.length) {
      var sl = stdinLines();
      if (sl === null) { addLine('cat: missing operand', 't-hot'); return; }
      (sl || []).forEach(function (l) { addLine(l === '' ? ' ' : l, ''); });
      return;
    }
    args.forEach(function (a) {
      var n = resolvePath(normalize(a.charAt(0) === '/' ? a : S.cwd + '/' + a));
      if (canRead(a) === null) { denyRead(a); return; }
      if (!n) { addLine('cat: ' + a + ': No such file or directory', 't-hot'); return; }
      if (n.dir) addLine('cat: ' + a + ': Is a directory', 't-hot');
      else (n.content || '').split('\n').forEach(function (l) { addLine(l === '' ? ' ' : l, ''); });
    });
  }
  function cmdHead(args) {
    var rest = args.slice();
    var n = 10;
    if (rest[0] === '-n') { n = parseInt(rest[1], 10) || n; rest = rest.slice(2); }
    else if (/^-\d+$/.test(rest[0] || '')) { n = parseInt(rest[0].slice(1), 10) || n; rest = rest.slice(1); }
    if (!rest.length) {
      var sl = stdinLines();
      if (sl === null) { addLine('head: missing operand', 't-hot'); return; }
      sl.slice(0, n).forEach(function (l) { addLine(l === '' ? ' ' : l, ''); });
      return;
    }
    rest.forEach(function (a) {
      var f = resolvePath(normalize(a.charAt(0) === '/' ? a : S.cwd + '/' + a));
      if (canRead(a) === null) { addLine('head: ' + a + ': Permission denied', 't-hot'); return; }
      if (!f) { addLine('head: ' + a + ': No such file or directory', 't-hot'); return; }
      (f.content || '').split('\n').slice(0, n).forEach(function (l) { addLine(l === '' ? ' ' : l, ''); });
    });
  }
  function cmdTail(args) {
    var rest = args.slice(); var n = 10;
    if (rest[0] === '-n') { n = parseInt(rest[1], 10) || n; rest = rest.slice(2); }
    else if (/^-\d+$/.test(rest[0] || '')) { n = parseInt(rest[0].slice(1), 10) || n; rest = rest.slice(1); }
    if (!rest.length) {
      var sl = stdinLines();
      if (sl === null) { addLine('tail: missing operand', 't-hot'); return; }
      sl.slice(Math.max(0, sl.length - n)).forEach(function (l) { addLine(l === '' ? ' ' : l, ''); });
      return;
    }
    rest.forEach(function (a) {
      var f = resolvePath(normalize(a.charAt(0) === '/' ? a : S.cwd + '/' + a));
      if (canRead(a) === null) { addLine('tail: ' + a + ': Permission denied', 't-hot'); return; }
      if (!f) { addLine('tail: ' + a + ': No such file or directory', 't-hot'); return; }
      var lines = (f.content || '').split('\n');
      lines.slice(Math.max(0, lines.length - n)).forEach(function (l) { addLine(l === '' ? ' ' : l, ''); });
    });
  }
  function cmdWc(args) {
    if (!args.length) {
      var sl = stdinLines();
      if (sl === null) { addLine('wc: missing operand', 't-hot'); return; }
      var cnt = 0;
      for (var k = 0; k < sl.length; k++) if (sl[k] !== '') cnt++;
      var ltxt = sl.join(' ');
      addLine('  ' + String(cnt).padStart(6) + ' ' + String(ltxt.split(/\s+/).filter(Boolean).length).padStart(7) + ' ' + String(ltxt.length).padStart(8) + '  (stdin)');
      return;
    }
    args.forEach(function (a) {
      var f = resolvePath(normalize(a.charAt(0) === '/' ? a : S.cwd + '/' + a));
      if (canRead(a) === null) { addLine('wc: ' + a + ': Permission denied', 't-hot'); return; }
      if (!f) { addLine('wc: ' + a + ': No such file or directory', 't-hot'); return; }
      var lines = (f.content || '').split('\n').length - 1;
      var words = (f.content || '').split(/\s+/).filter(Boolean).length;
      var chars = (f.content || '').length;
      addLine('  ' + String(lines).padStart(6) + ' ' + String(words).padStart(7) + ' ' + String(chars).padStart(8) + ' ' + a);
    });
  }
  function cmdEcho(args) {
    addLine(args.join(' '));
  }
  function cmdGrep(args) {
    var rest = args.slice(); var showLines = false; var countOnly = false;
    if (rest.indexOf('-n') !== -1) { showLines = true; rest = rest.filter(function (x) { return x !== '-n'; }); }
    if (rest.indexOf('-c') !== -1) { countOnly = true; rest = rest.filter(function (x) { return x !== '-c'; }); }
    if (!rest.length) { addLine('usage: grep [opsi] pattern [file]', 't-hot'); return; }
    var pat = rest[0]; var file = rest[1];
    var re;
    try { re = new RegExp(pat, 'i'); } catch (e) { re = new RegExp(pat.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i'); }
    var lines; var found = 0;
    if (file) {
      if (canRead(file) === null) { addLine('grep: ' + file + ': Permission denied', 't-hot'); return; }
      var f = resolvePath(normalize(file.charAt(0) === '/' ? file : S.cwd + '/' + file));
      if (!f) { addLine('grep: ' + file + ': No such file or directory', 't-hot'); return; }
      lines = (f.content || '').split('\n');
    } else {
      lines = stdinLines();
      if (lines === null) { addLine('grep: no input (coba: cat file | grep pola)', 't-hot'); return; }
    }
    lines.forEach(function (l, i) {
      if (re.test(l)) { found++; if (!countOnly) addLine((showLines ? String(i + 1).padStart(4) + ': ' : '') + l, ''); }
    });
    if (countOnly) { addLine('\u0020\u0020\u0020' + found + ' ' + (file || '(stdin)')); }
    if (!found) S.lastStatus = 1;
  }
  function cmdFind(args) {
    var all = args.join(' ');
    if (all.indexOf('-perm') !== -1) {
      addLines([
        ['mencari binary dengan SUID bit (rws) milik root...', 't-dim'],
        ['/usr/bin/passwd', ''],
        ['/usr/bin/sudo', ''],
        ['/usr/bin/su', ''],
        ['/usr/bin/mount', ''],
        ['/usr/bin/newgrp', ''],
        ['/usr/bin/find', 't-warn'],
        ['', ''],
        ['[!] /usr/bin/find ber-SUID root — vektor GTFOBins: find . -exec /bin/sh -p \\; -quit', 't-warn']
      ]);
      return;
    }
    var start = args[0] || '.';
    var dn = args[1] === '-name' ? args[2] : args[1];
    var hits = [];
    (function walk(d, prefix) {
      Object.keys(d.children || {}).forEach(function (n) {
        var c = d.children[n];
        var full = prefix + '/' + n;
        if (dn && n.indexOf(dn) !== -1) hits.push(full);
        if (c.dir) walk(c, full);
      });
    })(getDir(normalize(start.charAt(0) === '/' ? start : S.cwd + '/' + start)) || fs, S.cwd);
    hits.forEach(function (h) { addLine(h); });
    if (!hits.length && dn) addLine('(tidak ditemukan)', 't-dim');
  }
  function cmdCp(args) {
    if (args.length < 2) { addLine('cp: missing destination', 't-hot'); return; }
    var rest = args.slice();
    if (rest[0] === '-r') rest = rest.slice(1);
    var src = resolvePath(normalize(rest[0].charAt(0) === '/' ? rest[0] : S.cwd + '/' + rest[0]));
    if (!src) { addLine('cp: cannot stat ' + rest[0] + ': No such file or directory', 't-hot'); return; }
    var dstAbs = normalize(rest[1].charAt(0) === '/' ? rest[1] : S.cwd + '/' + rest[1]);
    var par = parentPath(dstAbs); var dn = dstAbs.split('/').filter(Boolean).pop();
    var pd = getDir(par);
    if (!pd) { addLine('cp: cannot create ' + rest[1] + ': No such file or directory', 't-hot'); return; }
    pd.children[dn] = node(dn, src.dir, src.content, src.children); saveFs();
  }
  function cmdMv(args) {
    if (args.length < 2) { addLine('mv: missing destination', 't-hot'); return; }
    var src = resolvePath(normalize(args[0].charAt(0) === '/' ? args[0] : S.cwd + '/' + args[0]));
    if (!src) { addLine('mv: cannot stat ' + args[0] + ': No such file or directory', 't-hot'); return; }
    var dstAbs = normalize(args[1].charAt(0) === '/' ? args[1] : S.cwd + '/' + args[1]);
    var par = parentPath(dstAbs); var dn = dstAbs.split('/').filter(Boolean).pop();
    var pd = getDir(par);
    if (!pd) { addLine('mv: cannot move to ' + args[1] + ': No such file or directory', 't-hot'); return; }
    var sAbs = normalize(args[0].charAt(0) === '/' ? args[0] : S.cwd + '/' + args[0]);
    var sPar = parentPath(sAbs); var sDn = sAbs.split('/').filter(Boolean).pop();
    delete getDir(sPar).children[sDn];
    pd.children[dn] = src; saveFs();
  }
  function cmdTree(args) {
    var start = args[0] || '.';
    var d = getDir(normalize(start.charAt(0) === '/' ? start : S.cwd + '/' + start));
    if (!d) { addLine('tree: no such directory', 't-hot'); return; }
    function walk(dir, pre) {
      Object.keys(dir.children || {}).sort().forEach(function (n, i, arr) {
        var c = dir.children[n];
        var isLast = i === arr.length - 1;
        addLine(pre + (isLast ? '`-- ' : '|-- ') + n + (c.dir ? '/' : ''), c.dir ? 't-cmd' : '');
        if (c.dir) walk(c, pre + (isLast ? '    ' : '|   '));
      });
    }
    walk(d, '');
  }

  /* ---------- system commands ---------- */
  function cmdWhoami() { addLine(S.user); }
  function cmdId() {
    var uid = (S.user === 'root') ? 0 : (S.user === 'webadmin' || S.user === 'guard') ? 1001 : 1000;
    addLine('uid=' + uid + '(' + S.user + ') gid=' + uid + '(' + S.user + ') groups=' + uid + '(' + S.user + '),27(sudo)');
  }
  function cmdDate() { addLine(new Date().toString().replace(/ GMT.*/, '')); }
  function cmdUname(args) {
    var want = args[0];
    if (!want) addLine('Linux');
    else if (want === '-a') addLine('Linux cyberguard 6.1.0-lab #1 SMP CyberGuard (sandbox browser-aware) x86_64 GNU/Linux');
    else if (want === '-n') addLine('cyberguard');
    else if (want === '-r') addLine('6.1.0-lab');
    else if (want === '-m') addLine('x86_64');
    else if (want === '-s') addLine('Linux');
    else addLine('usage: uname [-a -n -r -m -s]');
  }
  function cmdUptime() {
    var m = Math.floor(Math.random() * 800) + 120;
    addLine(' 10:42:00 up ' + m + ' min,  1 user,  load average: 0.08, 0.03, 0.01');
  }
  function cmdEnv() {
    addLines([
      'HOME=' + S.env.HOME,
      'SHELL=' + S.env.SHELL,
      'USER=' + S.env.USER,
      'PWD=' + S.cwd,
      'TERM=' + S.env.TERM,
      'PATH=/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin',
      'LANG=id_ID.UTF-8',
      'HOST=' + S.host
    ]);
  }
  function cmdExport(args) {
    args.forEach(function (a) {
      var eq = a.indexOf('=');
      if (eq > -1) { S.env[a.slice(0, eq)] = a.slice(eq + 1); addLine(a.slice(0, eq) + '=' + S.env[a.slice(0, eq)]); }
    });
  }
  function cmdHistory() {
    for (var i = 0; i < S.hist.length; i++) addLine(String(i + 1).padStart(4) + '  ' + S.hist[i]);
  }
  function cmdClear() { if (bodyEl) bodyEl.innerHTML = ''; }
  function cmdWho(args) {
    addLines([['student   pts/0    ' + new Date().toLocaleTimeString(), ''], ['webadmin  pts/1    (remote) 192.168.1.50', '']]);
  }
  function cmdSudo(args) {
    if (!args.length) { addLine('usage: sudo [-l] [perintah]', 't-hot'); return; }
    if (args[0] === '-l') {
      addLines([
        ['Matching Defaults entries for ' + S.user + ' on srv:', ''],
        ['    env_reset, mail_badpass, secure_path=/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin', 't-dim'],
        ['', ''],
        ['User ' + S.user + ' may run the following commands on srv:', ''],
        ['    (root) NOPASSWD: /opt/backup.sh', 't-ok'],
        ['    (root) /usr/bin/tar', 't-dim'],
        ['', ''],
        ['[!] vektor: jalankan backup.sh sebagai root atau abuse tar --to-command.', 't-warn']
      ]);
      return;
    }
    var joined = args.join(' ');
    if (joined === '/opt/backup.sh') {
      addLines([
        ['sudo: otentikasi berhasil (simulasi) — menjalankan sebagai root...', 't-dim'],
        ['tar: /etc/nginx/ -> /var/backups/web.tgz   (script backup dieksekusi ROOT)', 't-dim'],
        ['', ''],
        ['[*] SCRIPT /opt/backup.sh BERHASIL DIEKSEKUSI SEBAGAI ROOT.', 't-ok'],
        ['[*] Kamu telah naik ke root (uid=0). Vektor: /opt/backup.sh world-writable + cron root.', 't-warn'],
        ['    Konfirmasi: id | whoami | cat /root/root.txt | flag <FLAG{...}> | score', 't-comment']
      ]);
      S.user = 'root';
      promptEl.textContent = promptText();
      return;
    }
    if (S.user === 'root') { addLine('sudo: sudah root, tidak perlu sudo lagi.', 't-dim'); return; }
    addLine(S.user + ' is not in the sudoers file. This incident will be reported.', 't-warn');
  }
  function cmdAlias(args) {
    if (!args.length) { Object.keys(S.aliases).forEach(function (k) { addLine('alias ' + k + '=' + S.aliases[k]); }); return; }
    var eq = args[0].indexOf('=');
    if (eq > -1) S.aliases[args[0].slice(0, eq)] = args[0].slice(eq + 1).replace(/^['"]|['"]$/g, '');
  }
  function cmdUnalias(args) {
    args.forEach(function (a) { delete S.aliases[a]; });
  }

  /* ---------- network commands ---------- */
  function cmdIp(args) {
    if (!args.length || args[0] === 'a' || args[0] === 'addr') {
      addLines([
        ['1: lo: <LOOPBACK,UP,LOWER_UP> mtu 65536', ''],
        ['    inet 127.0.0.1/8 scope host lo', 't-dim'],
        ['2: eth0: <BROADCAST,MULTICAST,UP,LOWER_UP> mtu 1500', ''],
        ['    inet 192.168.1.100/24 brd 192.168.1.255 scope global eth0', 't-dim'],
        ['    ether 00:0c:29:3a:2b:1e (VMware)', 't-dim']
      ]);
      return;
    }
    if (args[0] === 'route') {
      addLines([
        ['default via 192.168.1.1 dev eth0', ''],
        ['192.168.1.0/24 dev eth0 proto kernel scope link src 192.168.1.100', 't-dim']
      ]);
      return;
    }
    addLine('usage: ip a | ip route');
  }
  function cmdIfconfig(args) {
    addLines([
      ['eth0: flags=4163<UP,BROADCAST,RUNNING,MULTICAST>  mtu 1500', ''],
      ['        inet 192.168.1.100  netmask 255.255.255.0  broadcast 192.168.1.255', 't-dim'],
      ['        ether 00:0c:29:3a:2b:1e  txqueuelen 1000  (Ethernet)', 't-dim']
    ]);
  }
  function cmdNetstat(args) {
    addLines([
      ['Active Internet connections (servers)', ''],
      ['Proto Recv-Q Send-Q Local Address      Foreign Address  State', 't-dim'],
      ['tcp        0      0 0.0.0.0:22         0.0.0.0:*        LISTEN', ''],
      ['tcp        0      0 0.0.0.0:80         0.0.0.0:*        LISTEN', ''],
      ['tcp        0      0 127.0.0.1:3306     0.0.0.0:*        LISTEN', 't-dim'],
      ['tcp        0      0 0.0.0.0:443        0.0.0.0:*        LISTEN', ''],
      ['tcp        0      1 192.168.1.100:53218 45.155.205.11:4444 ESTABLISHED [IP-SUSPICIOUS]', 't-hot']
    ]);
  }
  function cmdPing(args) {
    if (!args.length) { addLine('usage: ping [target]', 't-hot'); return; }
    var target = args[0];
    var real = netDB[target];
    if (!real) { addLine('ping: ' + target + ': Name or service not known', 't-hot'); return; }
    if (target === '192.168.1.30' || target === 'kali-recon') {
      addLines([['PING ' + target + ' (192.168.1.30) 56(84) bytes of data.', ''], ['--- status ---', ''],
                ['Host menolak respon ICMP (kebijakan lab: jangan scan host peserta).', 't-warn']]);
      return;
    }
    (function () {
      addLine('PING ' + target + ' (' + real.ip + ') 56(84) bytes of data.');
      var i = 0;
      var t = setInterval(function () {
        i++;
        addLine('64 bytes from ' + (real.ip || target) + ': icmp_seq=' + i + ' ttl=64 time=' + (Math.random() * 1.5 + 0.3).toFixed(2) + ' ms');
        if (i >= 3) {
          clearInterval(t);
          addLines([
            '',
            '--- ' + target + ' ping statistics ---',
            '3 packets transmitted, 3 received, 0% packet loss, time 2002ms'
          ]);
        }
      }, 500);
    })();
    return new Promise(function (r) { setTimeout(r, 1600); });
  }
  function cmdNmap(args) {
    // minimal arg parser
    var target = null; var version = false; var sn = false; var all = false; var ports = null;
    args.forEach(function (a) {
      if (a === '-sV') version = true;
      else if (a === '-sn') sn = true;
      else if (a === '--open') all = true;
      else if (/^-p/.test(a)) ports = a.replace('-p', '');
      else if (a.indexOf('-') !== 0) target = a;
    });
    if (!target) { addLine('usage: nmap [-sV] [-p <port>] [--open] <target>', 't-hot'); return; }
    if (target === '80.200.1.5') { addLine('Note: Host seems down. If it is really up, but blocking our ping probes, try -Pn'); return; }
    var host = netDB[target] || netDB[target.split(':')[0]];
    if (!host || !host.ip) { addLine('nmap: failed to resolve "' + target + '". Host tidak dikenal di lab sandbox.', 't-hot'); return; }
    if (sn) {
      addLine('Starting Nmap 7.94 ( https://nmap.org )');
      addLine('Nmap scan report for ' + (host.name || host.ip));
      addLine('Host is up (0.0012s latency).');
      addLine('MAC Address: 00:0C:29:3A:2B:1E (VMware)');
      addLine('Nmap done: 1 IP address (1 host up) scanned in 0.31 seconds');
      return;
    }
    addLine('Starting Nmap 7.94 ( https://nmap.org ) on ' + new Date().toTimeString().slice(0, 8));
    addLine('Nmap scan report for ' + (host.name || host.ip) + ' (' + host.ip + ')');
    addLine('Host is up (0.0012s latency).');
    var portKeys = Object.keys(host.ports);
    if (ports) {
      var list = ports.split(',');
      portKeys = portKeys.filter(function (p) { return list.indexOf(p) !== -1; });
      if (!portKeys.length) portKeys = list.slice(0, 3);
    }
    if (all && !portKeys.length) {
      addLines([
        ['All 1000 scanned ports on ' + (host.name || host.ip) + ' are filtered', ''],
        ['', ''],
        ['Nmap done: 1 IP address (1 host up) scanned in 21.4 seconds', '']
      ]);
      return;
    }
    portKeys.forEach(function (p) {
      var svc = host.ports[p];
      var open = svc[0] !== 'filtered';
      addLine(p + '/tcp ' + (open ? 'open' : 'filtered') + '  ' + svc[0] + (version ? '    ' + svc[1] : ''));
    });
    if (host.os) addLine('OS details: ' + host.os);
    addLine('Nmap done: 1 IP address (1 host up) scanned in 8.47 seconds');
  }
  function cmdSqlmap(args) {
    var url = null; var dump = false; var tables = false; var dbs = false;
    for (var i = 0; i < args.length; i++) {
      if (args[i] === '-u') { url = args[i + 1]; i++; }
      else if (args[i] === '--dbs') dbs = true;
      else if (args[i] === '--tables') tables = true;
      else if (args[i] === '--dump') dump = true;
    }
    if (!url) { addLine('usage: sqlmap -u "http://..." --dbs|--tables|--dump', 't-hot'); return; }
    var db = webDB[url];
    if (!db) { addLine('sqlmap: target URL tidak dikenal di sandbox. Gunakan: http://lab-web-01/search?id=1', 't-warn'); return; }
    addLines([
      ['---', ''],
      ['[INFO] testing connection to the target URL', ''],
      ['[INFO] checking if the target is protected by some kind of WAF/IPS', ''],
      ['[INFO] URL parameter [id] appears to be injectable', 't-ok']
    ]);
    if (dbs) {
      addLine('[INFO] fetching database names');
      addLine('[' + String(db.dbs.length) + '/' + String(db.dbs.length) + ']');
      db.dbs.forEach(function (d) { addLine('[*] ' + d); });
    } else if (tables) {
      addLine('[INFO] fetching tables for database: shop');
      addLine('Database: shop');
      addLine('[' + String(db.tables.length) + ' tables]');
      addLine('+-----------+');
      db.tables.forEach(function (t) { addLine('| ' + t + ' |'); });
      addLine('+-----------+');
    } else if (dump) {
      addLine('[INFO] fetching columns for table: users');
      addLine('+----+----------+------------------+');
      addLine('| id | username | password         |');
      addLine('+----+----------+------------------+');
      addLine('| 1  | admin    | 21232f297a57a5a743894a0e4a801fc3 (md5: admin) |');
      addLine('| 2  | webadmin | 742929dcb631403d7c1c1efad2ca2700            |');
      addLine('+----+----------+------------------+');
      addLine('[INFO] hash 742929d... = md5("chicken") — crack pakai hashcat/john', 't-dim');
      addLine('[INFO] table data dumped — bukti serangan SQLi terdokumentasi', 't-dim');
    }
    addLine('[*] end of output. (Simulasi pedagogis.)', 't-dim');
  }
  function cmdCurl(args) {
    var silent = args.indexOf('-s') !== -1;
    var head = args.indexOf('-I') !== -1;
    var url = null;
    args.forEach(function (a, i) {
      if (a === '-u') { url = args[i + 1] || url; }
      if (a.indexOf('http') === 0) url = a;
    });
    if (!url) { addLine('curl: no URL specified', 't-hot'); return; }
    if (webDB[url]) {
      addLines([
        ['HTTP/1.1 200 OK', ''],
        ['Content-Type: text/html; charset=UTF-8', 't-dim'],
        ['Server: Apache/2.4.41 (Ubuntu)', 't-dim'],
        ['', ''],
        ['<h1>' + webDB[url].title + '</h1>', '']
      ]);
      return;
    }
    // try real network fetch (may fail due to CORS in strict file context)
    var fetch2 = (typeof fetch === 'function') ? fetch : null;
    if (!fetch2) { addLine('curl: (7) Failed to connect (sandbox offliner)', 't-hot'); return; }
    return fetch2(url, { method: head ? 'HEAD' : 'GET', redirect: 'manual' })
      .then(function (r) {
        if (head) {
          addLine('HTTP/' + (r.status) + ' ' + r.statusText);
          ['content-type', 'server', 'strict-transport-security'].forEach(function (h) {
            var v = r.headers.get(h); if (v) addLine(h + ': ' + v, 't-dim');
          });
        } else {
          addLine('curl: tidak dapat menampilkan body (CORS/lab). Status: ' + r.status, 't-warn');
        }
      })
      .catch(function () { addLine('curl: (7) Failed to connect — jaringan diblokir sandbox (CORS). ', 't-hot'); });
  }
  function cmdSsh(args) {
    if (!args.length) { addLine('usage: ssh [user@]target   contoh: ssh webadmin@lab-web-01', 't-hot'); return; }
    var user = S.user;
    var target = args[0];
    if (args[0].indexOf('@') !== -1) { var at = args[0].split('@'); user = at[0]; target = at[1]; }
    var host = netDB[target];
    if (!host || !host.ip) { addLine('ssh: Could not resolve hostname ' + target + ': Name or service not known', 't-hot'); return; }
    addLines([
      ['The authenticity of host \'' + target + ' (' + host.ip + ')\' can\'t be established.', ''],
      ['ECDSA key fingerprint is SHA256:' + 'a1b2c3d4e5f60718293a4b5c6d7e8f901a' + '.' + 'b2c3d4e5f6.', 't-dim'],
      ['Are you sure you want to continue connecting (yes/no)? yes', 't-comment'],
      ['', ''],
      ['Welcome to ' + (host.os || 'Ubuntu 22.04 LTS') + ' (sandbox lab)', 't-ok'],
      ['', ''],
      ['Last login: ' + new Date().toLocaleString(), 't-dim'],
      ['[C-SHELL] Kamu kini masuk sebagai ' + user + '@' + target + '. Ketik: whoami | id | sudo -l | cat /etc/crontab', 't-comment']
    ]);
    S.host = target;
    S.user = user;
    promptEl.textContent = promptText();
  }
  function cmdPython(args) {
    addLines([
      ['Python 3.11.4 — interpreter penuh tidak tersedia di sandbox browser.', 't-warn'],
      ['Untuk eksploitasi/scripting nyata, gunakan Python lokal di VM Kali laboratoriummu.', 't-dim']
    ]);
  }

  /* ---------- professional tools (simulasi) ---------- */
  var DICT = ['password', 'admin', 'secret', 'chicken', 'backup', 'student', 'webadmin', 'guest123', 'Winter2023!'];
  function wordlistFrom(p) {
    var wl = readFileLines(p);
    if (wl === null) return null;
    return wl.map(function (w) { return w.trim(); }).filter(Boolean);
  }
  function cmdHydra(args) {
    var user = null, userList = null, passList = null, target = null, service = null;
    for (var i = 0; i < args.length; i++) {
      var a = args[i];
      if (a === '-l') { user = args[i + 1]; i++; }
      else if (a === '-L') { userList = args[i + 1]; i++; }
      else if (a === '-P') { passList = args[i + 1]; i++; }
      else if (a === '-t') { i++; }
      else if (/^[a-z]+:\/\//.test(a)) { var m = a.match(/^([a-z]+):\/\/(.+)/); service = m[1]; target = m[2]; }
    }
    if (!target || !passList || (!user && !userList)) {
      addLine('usage: hydra -l <user> | -L <users> -P <wordlist> <service>://<host>', 't-hot'); return;
    }
    var host = netDB[target];
    if (!host || !host.ip) { addLine('hydra: unknown host ' + target, 't-hot'); return; }
    var creds = host.creds && host.creds[service];
    var words = wordlistFrom(passList);
    if (words === null) { addLine('hydra: could not open wordlist ' + passList, 't-hot'); return; }
    var ulist = userList ? wordlistFrom(userList) : (user ? [user] : []);
    if (!ulist || !ulist.length) { addLine('hydra: no users supplied', 't-hot'); return; }
    addLine('Hydra v9.3 (c) 2022 by van Hauser/THC & David Maciejak');
    addLine('[DATA] attacking ' + service + '://' + target + ' with ' + ulist.length + ' login x ' + words.length + ' passwords');
    var found = null;
    var tried = [];
    for (var ui = 0; ui < ulist.length && !found; ui++) {
      for (var wi = 0; wi < words.length && !found; wi++) {
        var u = ulist[ui], w = words[wi];
        if (creds && creds[0] === u && creds[1] === w) found = { u: u, w: w };
        else if (tried.length < 30) tried.push({ u: u, w: w });
      }
    }
    var idx = 0;
    return new Promise(function (res) {
      (function step() {
        if (idx < tried.length) {
          addLine('STATUS: Attempt ' + (idx + 1) + '/2 tries', 't-comment');
          addLine('[ATTEMPT] login: ' + tried[idx].u + '   password: ' + tried[idx].w, 't-dim');
          idx++;
          setTimeout(step, 40);
          return;
        }
        if (found) {
          addLines([
            ['[SUCCESS] host: ' + (host.name || host.ip) + '   login: ' + found.u + '   password: ' + found.w, 't-ok'],
            ['1 of 1 target successfully completed, 1 valid password found', 't-ok'],
            ['Catatan: kredensial ini simulasi; jangan pernah menyerang layanan nyata.', 't-warn']
          ]);
          S.lastStatus = 0;
        } else {
          addLines([
            ['1 of 1 target completed, 0 valid passwords found', 't-hot'],
            ['Coba wordlist lain (rockyou) atau -l user yang tepat.', 't-comment']
          ]);
          S.lastStatus = 1;
        }
        res();
      })();
    });
  }
  function parseHashes(file) {
    var f = resolvePath(normalize(file.charAt(0) === '/' ? file : S.cwd + '/' + file));
    if (!f) { return null; }
    var hashRe = /[a-f0-9]{32}/;
    var entries = [];
    (f.content || '').split('\n').forEach(function (l) {
      var m = l.match(hashRe);
      if (m) entries.push({ user: (l.split(':')[0] || '').trim() || '?', hash: m[0] });
    });
    return entries;
  }
  function crackMd5(entries) {
    var out = [];
    entries.forEach(function (e) {
      var found = null;
      for (var j = 0; j < DICT.length; j++) {
        if (md5impl(DICT[j]) === e.hash) { found = DICT[j]; break; }
      }
      if (found) out.push({ user: e.user, hash: e.hash, pw: found });
    });
    return out;
  }
  function cmdHashcat(args) {
    var mode = 0, file = null;
    for (var i = 0; i < args.length; i++) {
      if (args[i] === '-m') { mode = parseInt(args[i + 1], 10) || 0; i++; }
      else if (args[i].indexOf('-') !== 0) file = args[i];
    }
    if (!file) { addLine('usage: hashcat -m 0 <hashes.txt>', 't-hot'); return; }
    if (mode !== 0) { addLine('hashcat: sandbox hanya menyediakan mode -m 0 (MD5). Memakai mode 0.', 't-warn'); }
    var entries = parseHashes(file);
    if (entries === null) { addLine('hashcat: ' + file + ': No such file or directory', 't-hot'); return; }
    addLines([
      ['hashcat (v6.2.6) starting in benchmark mode...', ''],
      ['OpenCL device #1: Hyper-V Virtual GPU, 512/1024 MB allocatable', 't-dim'],
      ['Hashes: ' + entries.length + ' digests; 1 unique digests', 't-dim']
    ]);
    var cracked = crackMd5(entries);
    entries.forEach(function (e) {
      var hit = null;
      for (var k = 0; k < cracked.length; k++) if (cracked[k].hash === e.hash) { hit = cracked[k]; break; }
      if (hit) addLine(e.hash + ':' + hit.pw, 't-ok');
      else addLine(e.hash + ':(belum ketemu)', 't-dim');
    });
    addLine('Cracking selesai pada wordlist sandbox. Coba ukuran penuh di Kali.', 't-comment');
    if (!cracked.length) S.lastStatus = 1;
  }
  function cmdJohn(args) {
    var file = null;
    args.forEach(function (a) { if (a.indexOf('-') !== 0) file = a; });
    if (!file) { addLine('usage: john <hashes.txt>', 't-hot'); return; }
    var entries = parseHashes(file);
    if (entries === null) { addLine('john: ' + file + ': No such file or directory', 't-hot'); return; }
    addLines([
      ['Using default input encoding: UTF-8', ''],
      ['Loaded 2 password hashes (md5crypt / crypt(3) $1$)', 't-dim'],
      ['Proceeding with wordlist /usr/share/wordlists/sandbox.txt', 't-dim']
    ]);
    var cracked = crackMd5(entries);
    cracked.forEach(function (c) { addLine(c.user + ':' + c.pw, 't-ok'); });
    (entries.filter(function (e) { return !cracked.some(function (c) { return c.hash === e.hash; }); }))
      .forEach(function (e) { addLine(e.user + ':?', 't-dim'); });
    addLine(cracked.length + ' password hash cracked, ' + (entries.length - cracked.length) + ' left', 't-comment');
    if (!cracked.length) S.lastStatus = 1;
  }
  function cmdGobuster(args) {
    var url = null, wl = null, mode = 'dir';
    for (var i = 0; i < args.length; i++) {
      if (args[i] === 'dir') mode = 'dir';
      else if (args[i] === '-u') { url = args[i + 1]; i++; }
      else if (args[i] === '-w') { wl = args[i + 1]; i++; }
    }
    if (!url || !wl) { addLine('usage: gobuster dir -u http://host -w <wordlist.txt>', 't-hot'); return; }
    var dirData = webDirs[url];
    if (!dirData) { addLine('gobuster: target URL tidak dikenal di sandbox. Coba http://lab-web-01', 't-warn'); return; }
    var words = wordlistFrom(wl);
    if (words === null) { addLine('gobuster: could not open wordlist ' + wl, 't-hot'); return; }
    addLine('===============================================================');
    addLine('Gobuster v3.6 by OJ Reeves (@TheColonial)');
    addLine('[+] Url: ' + url + '   Mode: dir   Wordlist: ' + wl);
    addLine('===============================================================');
    var idx = 0;
    return new Promise(function (res) {
      (function step() {
        for (var k = 0; k < 4 && idx < words.length; k++, idx++) {
          var w = words[idx];
          var hit = dirData.hits[w];
          if (hit) addLine('/' + w + ' (Status: ' + hit + ')', 't-ok');
        }
        if (idx < words.length) { setTimeout(step, 45); return; }
        addLine('[+] Done: ' + words.length + ' words scanned', 't-comment');
        res();
      })();
    });
  }
  function cmdNikto(args) {
    var url = null;
    for (var i = 0; i < args.length; i++) {
      if (args[i] === '-h') { url = args[i + 1]; i++; }
      else if (args[i].indexOf('http') === 0) url = args[i];
    }
    if (!url) { addLine('usage: nikto -h http://host', 't-hot'); return; }
    if (!webDirs[url]) { addLine('nikto: target tidak dikenal di sandbox. Coba http://lab-web-01', 't-warn'); return; }
    var issues = [
      'TIP 1: Server di versi lawas rentan eksploit publik (searchsploit).',
      'TIP 2: Directory listing terbuka di beberapa path (/uploads/).',
      'TIP 3: /admin/ terdeteksi tanpa proteksi rate-limit.',
      'TIP 4: Tidak ada security headers (X-Frame-Options, CSP).'
    ];
    addLines([
      ['- Nikto v2.5.0', ''],
      ['---------------------------------------------------------------------------', ''],
      ['+ Server: ' + url + '  (target sandbox lab)', ''],
      ['+ Target IP: ' + ((webDirs[url].base || '').replace('http://', '') || '?'), 't-dim'],
      ['+ ' + issues[0], ''],
      ['+ ' + issues[1], ''],
      ['+ ' + issues[2], ''],
      ['+ ' + issues[3], ''],
      ['', ''],
      ['+ 4 CVEs / 0 exploit(s) reported for this host', 't-warn'],
      ['+ Finished 0 requests in 4.621s, avg ~0 req/s', 't-dim']
    ]);
  }
  var EXPLOITS = [
    { edb: '44499', cve: 'CVE-2017-7494', title: 'Samba 4.x - is_known_pipename() Arbitrary Module Load', path: 'linux/remote/44499.py' },
    { edb: '42060', cve: 'CVE-2017-5638', title: 'Apache Struts 2 - Remote Code Execution (OGNL Injection)', path: 'multiple/remote/42060.py' },
    { edb: '47493', cve: 'CVE-2018-1270', title: 'Redis sandbox escape / Lua RCE', path: 'linux/webapps/47493.rb' },
    { edb: '50383', cve: 'CVE-2020-9484', title: 'Apache Tomcat - Session Persistence RCE', path: 'java/webapps/50383.txt' },
    { edb: '50809', cve: 'CVE-2021-41773', title: 'Apache 2.4.49 - Path Traversal & RCE', path: 'multiple/webapps/50809.py' },
    { edb: '51215', cve: 'CVE-2022-0847', title: 'Linux Kernel - Dirty Pipe LPE', path: 'linux/local/51215.c' }
  ];
  function cmdSearchsploit(args) {
    var query = args.join(' ').toLowerCase().trim();
    if (!query) { addLine('usage: searchsploit <keyword>  contoh: searchsploit samba 4.6', 't-hot'); return; }
    var tokens = query.split(/\s+/);
    var hits = EXPLOITS.filter(function (e) {
      var hay = (e.title + ' ' + e.cve).toLowerCase();
      return tokens.every(function (t) { return hay.indexOf(t) !== -1; });
    });
    addLine('-------------------------------------------------------------------------------');
    addLine(' Exploit Title                                        |  Path');
    addLine('-------------------------------------------------------------------------------');
    if (!hits.length) { addLine(' | No Results Found', 't-hot'); return; }
    hits.forEach(function (h) {
      addLine(' ' + h.title + '  | ' + h.path);
      addLine('  ' + (h.cve || '-') + '   EDB-ID: ' + h.edb, 't-dim');
      addLine('  copy: cp ' + '/opt/exploitdb/' + h.path + ' ~/lab/', 't-comment');
    });
    addLine('-------------------------------------------------------------------------------');
    addLine('Copying is for educational sandbox only — gunakan dengan otorisasi.', 't-warn');
  }
  function cmdTcpdump(args) {
    var iface = 'eth0', count = 4;
    for (var i = 0; i < args.length; i++) {
      if (args[i] === '-i') { iface = args[i + 1] || iface; i++; }
      else if (args[i] === '-c') { count = parseInt(args[i + 1], 10) || count; i++; }
    }
    addLines([
      ['tcpdump: verbose output suppressed, use -v or -vv for full protocol decode', 't-dim'],
      ['listening on ' + iface + ', link-type EN10MB (Ethernet), capture size 262144 bytes', 't-dim']
    ]);
    var pkts = [
      '11:42:31.881897 IP 192.168.1.100.53218 > 45.155.205.11.4444: Flags [S], seq 1234567890',
      '11:42:31.882034 IP 45.155.205.11.4444 > 192.168.1.100.53218: Flags [S.], seq 9876543210',
      '11:42:31.882120 IP 192.168.1.100.53218 > 45.155.205.11.4444: Flags [A], seq ...',
      '11:42:32.001111 IP 192.168.1.100.22 > 192.168.1.50.51234: Flags [P.], seq ..., ack 1 (SSH login)'
    ];
    var k = 0;
    return new Promise(function (res) {
      (function step() {
        if (k < count && k < pkts.length) { addLine(pkts[k], 't-dim'); k++; setTimeout(step, 60); return; }
        addLines([
          [count + ' packets captured', ''],
          [count + ' packets received by filter', ''],
          ['0 packets dropped by kernel', '']
        ]);
        res();
      })();
    });
  }
  function cmdPs(args) {
    addLines([
      ['  PID TTY          TIME CMD', ''],
      ['    1 ?        00:00:03 systemd', ''],
      ['  310 ?        00:00:21 sshd', ''],
      ['  442 ?        00:00:02 apache2', ''],
      ['  458 ?        00:00:19 mysqld', ''],
      ['  511 ?        00:00:00 cron', ''],
      [' 1281 pts/0     00:00:00 bash  (kamu, ' + S.user + ')', ''],
      [' 1282 pts/0     00:00:00 ps  aux', '']
    ]);
    if (args.indexOf('aux') !== -1) addLine('USER       PID %CPU %MEM    VSZ   RSS TTY STAT START TIME COMMAND');
  }

  /* ---------- log analysis & enumeration helpers ---------- */
  function cmdSort(args) {
    var numeric = false, reverse = false, unique = false, file = null;
    for (var i = 0; i < args.length; i++) {
      var a = args[i];
      if (a === '-n') numeric = true;
      else if (a === '-r') reverse = true;
      else if (a === '-u') unique = true;
      else if (a.indexOf('-') !== 0) file = a;
    }
    var lines = file ? readFileLines(file) : stdinLines();
    if (lines === null) { addLine('sort: no input (coba: cat log | sort)', 't-hot'); return; }
    var out = lines.slice();
    if (numeric) out.sort(function (x, y) { return (parseFloat(x) || 0) - (parseFloat(y) || 0); });
    else out.sort();
    if (reverse) out.reverse();
    if (unique) out = out.filter(function (v, idx2) { return out.indexOf(v) === idx2; });
    out.forEach(function (l) { addLine(l === '' ? ' ' : l); });
  }
  function cmdUniq(args) {
    var count = false, file = null;
    args.forEach(function (a) { if (a === '-c') count = true; else if (a.indexOf('-') !== 0) file = a; });
    var lines = file ? readFileLines(file) : stdinLines();
    if (lines === null) { addLine('uniq: no input (coba: cat log | sort | uniq -c)', 't-hot'); return; }
    var i = 0;
    while (i < lines.length) {
      var v = lines[i], n = 1;
      while (i + 1 < lines.length && lines[i + 1] === v) { n++; i++; }
      if (count) addLine(String(n).padStart(5) + ' ' + v);
      else addLine(v === '' ? ' ' : v);
      i++;
    }
  }
  function cmdCut(args) {
    var delim = '\t', fields = null, file = null;
    for (var i = 0; i < args.length; i++) {
      var a = args[i];
      if (a === '-d') { delim = args[i + 1] || '\t'; i++; }
      else if (a === '-f') { fields = (args[i + 1] || '').split(',').map(function (x) { return parseInt(x, 10); }).filter(function (x) { return x > 0; }); i++; }
      else if (a.indexOf('-') !== 0) file = a;
    }
    if (!fields || !fields.length) { addLine('usage: cut -d " " -f 1,3 [file]', 't-hot'); return; }
    var lines = file ? readFileLines(file) : stdinLines();
    if (lines === null) { addLine('cut: no input (coba: cat log | cut -d " " -f 1,3)', 't-hot'); return; }
    lines.forEach(function (l) {
      var parts = l.split(delim);
      addLine(fields.map(function (f) { return parts[f - 1] || ''; }).join('\t'));
    });
  }
  function cmdAwk(args) {
    var prog = null, F = ' ', file = null;
    for (var i = 0; i < args.length; i++) {
      var a = args[i];
      if (a === '-F') { F = (args[i + 1] || ' ').replace(/^['"]|['"]$/g, ''); i++; }
      else if (/^\{.*\}$/.test(a)) prog = a;
      else if (a.indexOf('-') !== 0) file = a;
    }
    if (!prog) { addLine("usage: awk [-F delim] '{print $1,$3}' [file]", 't-hot'); return; }
    var body = prog.replace(/^\{/, '').replace(/\}$/, '').trim().replace(/^print\s*/, '').trim();
    var flds = null;
    if (body && body !== '$0') {
      flds = [];
      body.split(',').forEach(function (s) {
        s = s.trim();
        var m = s.match(/^\$(\d+)$/); if (m) { flds.push(parseInt(m[1], 10)); return; }
        if (/^\$NF$/.test(s)) flds.push(-1);
      });
    }
    var lines = file ? readFileLines(file) : stdinLines();
    if (lines === null) { addLine('awk: no input (coba: cat log | awk \'{print $3}\')', 't-hot'); return; }
    lines.forEach(function (l) {
      if (!flds) { addLine(l === '' ? ' ' : l); return; }
      var parts = l.split(F);
      addLine(flds.map(function (f) { return (f === -1) ? (parts[parts.length - 1] || '') : (parts[f - 1] || ''); }).join(' '));
    });
  }

  /* ---------- privesc & enumeration helper (simulasi) ---------- */
  function cmdLinpeas(args) {
    addLines([
      ['── linPEAS ── Linux Privilege Escalation Awesome Script ──', 't-purple'],
      ['', ''],
      ['═══ System info ═══', 't-purple'],
      ['Host: srv (192.168.1.10) | kernel 6.1.0-lab | user: ' + S.user, ''],
      ['', ''],
      ['═══ User & Sudo ═══', 't-purple'],
      ['[+] Identitas           : ' + S.user + ' (uid ' + (S.user === 'root' ? 0 : 1001) + ')', ''],
      ['[!] sudo -l             : ' + S.user + ' dapat menjalankan /opt/backup.sh (root, NOPASSWD)', 't-warn'],
      ['', ''],
      ['═══ Cron / Scheduled ═══', 't-purple'],
      ['[!] /etc/crontab        : root menjalankan /opt/backup.sh tiap 5 menit', 't-warn'],
      ['[!] /opt/backup.sh      : WORLD-WRITABLE (rw-rw-rw-) — vektor eskalasi cepat', 't-warn'],
      ['', ''],
      ['═══ SUID / Capabilities ═══', 't-purple'],
      ['[!] /usr/bin/find       : SUID bit milik root (GTFOBins: find)', 't-warn'],
      ['[*] /usr/bin/python3    : cap_setuid=ep (capability abuse)', 't-dim'],
      ['', ''],
      ['═══ Kredensial bocor ═══', 't-purple'],
      ['[!] /home/webadmin/.backup.config : memuat db_pass=Winter2023!', 't-warn'],
      ['[*] /etc/shadow         : hash root $6$ — tidak terbaca (mode 000), aman', 't-dim'],
      ['', ''],
      ['═══ Jaringan ═══', 't-purple'],
      ['[!] koneksi keluar -> 45.155.205.11:4444 ESTABLISHED (C2?)', 't-warn'],
      ['', ''],
      ['└─ Kesimpulan: vektor tercepat = tulis ulang /opt/backup.sh (dijalankan root) ATAU find -exec.', 't-comment']
    ]);
  }
  function cmdGetcap(args) {
    addLines([
      ['/usr/bin/python3.11  cap_setuid=ep', 't-warn'],
      ['/usr/bin/tcpdump     cap_net_raw,cap_net_admin=eip', 't-dim'],
      ['', ''],
      ['[!] python3 punya cap_setuid — utk lab: python3 -c "import os; os.setuid(0); os.execvp(\'id\', [\'id\'])"', 't-warn']
    ]);
  }

  /* ---------- defensive / SOC inspection ---------- */
  function cmdLastlog() {
    addLines([
      ['Menampilkan data login terakhir.', 't-dim'],
      ['Username     Port           Dari            Terakhir Login', ''],
      ['webadmin     pts/1          45.155.205.11   12/Feb 2026 03:16:55  [ATTACKER]', 't-hot'],
      ['webadmin     pts/0          192.168.1.50    12/Feb 2026 04:01:22  [legit]', ''],
      ['student      pts/0          192.168.1.50    12/Feb 2026 04:02:10', '']
    ]);
  }
  function cmdLast(args) {
    addLines([
      ['webadmin  pts/1        45.155.205.11   Thu Feb 12 03:16 - 03:17  (00:00)   [ATTACKER]', 't-hot'],
      ['webadmin  pts/0        192.168.1.50    Thu Feb 12 04:01   still logged in', ''],
      ['student   pts/0        192.168.1.50    Thu Feb 12 04:02   still logged in', ''],
      ['reboot    system boot  6.1.0-lab       Wed Feb 11 21:34   still running', 't-dim']
    ]);
  }
  function cmdJournalctl(args) {
    var unit = null;
    for (var i = 0; i < args.length; i++) {
      if (args[i] === '-u') { unit = args[i + 1]; i++; }
      else if (args[i].indexOf('-') !== 0) unit = args[i];
    }
    var full = [];
    if (unit && (unit === 'ssh' || unit === 'sshd')) {
      full = (readFileLines('/var/log/auth.log') || []).filter(function (l) { return /sshd/.test(l); });
    } else {
      full = (readFileLines('/var/log/auth.log') || []).concat(readFileLines('/var/log/syslog') || []);
    }
    addLine('-- Logs begin at Wed 2026-02-11 21:34:12 +07, end at ' + new Date().toLocaleTimeString() + ' --', 't-dim');
    full.slice(-18).forEach(function (l) { addLine(l === '' ? ' ' : l); });
  }
  function cmdSs(args) {
    addLines([
      ['State   Recv-Q Send-Q  Local Address:Port       Peer Address:Port', 't-dim'],
      ['ESTAB   0      0       192.168.1.100:53218      45.155.205.11:4444   [attacker/C2]', 't-hot'],
      ['ESTAB   0      0       192.168.1.100:22         192.168.1.50:51234    [ssh webadmin]', ''],
      ['LISTEN  0      128     0.0.0.0:22               0.0.0.0:*', 't-dim'],
      ['LISTEN  0      511     0.0.0.0:80               0.0.0.0:*', 't-dim']
    ]);
  }
  function cmdIptables(args) {
    var s = args.join(' ');
    if (s.indexOf('-L') !== -1) {
      addLines([
        ['Chain INPUT (policy DROP)', ''],
        ['target     prot opt source               destination', 't-dim']
      ]);
      S.fw.rules.forEach(function (r) { addLine('DROP       all  --  ' + r.padEnd(20) + '0.0.0.0/0', 't-ok'); });
      addLines([
        ['Chain FORWARD (policy DROP)', ''],
        ['target     prot opt source               destination', 't-dim'],
        ['Chain OUTPUT (policy ACCEPT)', ''],
        ['target     prot opt source               destination', 't-dim']
      ]);
      return;
    }
    var m = s.match(/-A INPUT -s (\S+)/);
    if (m) {
      var ip = m[1];
      if (S.fw.rules.indexOf(ip) === -1) S.fw.rules.push(ip);
      addLine('DROP semua lalu lintas dari ' + ip + ' (simulasi iptables, host edge).', 't-ok');
      return;
    }
    addLine('usage (simulasi): iptables -L -n  |  iptables -A INPUT -s <ip> -j DROP', 't-hot');
  }
  function cmdUfw(args) {
    var s = args.join(' ');
    if (/status/.test(s)) {
      addLines([
        ['Status: aktif (simulasi)', 't-ok'],
        ['To                         Action      From', ''],
        ['--                         ------      ----', ''],
        ['22/tcp                     ALLOW       192.168.1.0/24', ''],
        ['80,443/tcp                 ALLOW       Anywhere', ''],
        ['3306                       DENY        Anywhere    # mysql dikunci default', 't-dim']
      ]);
      S.fw.rules.forEach(function (r) { addLine('Anywhere                   DENY        ' + r + '   # blokir insiden', 't-warn'); });
      return;
    }
    var m = s.match(/deny from (\S+)/);
    if (m) {
      var ip = m[1];
      if (S.fw.rules.indexOf(ip) === -1) S.fw.rules.push(ip);
      addLine('IP ' + ip + ' ditambahkan ke daftar blokir ufw (simulasi).', 't-ok');
      return;
    }
    addLine('usage (simulasi): ufw status verbose  |  ufw deny from <ip>', 't-hot');
  }
  function cmdCrontab(args) {
    if (args[0] === '-l') {
      var f = resolvePath(normalize('/etc/crontab'));
      (f && f.content || '').split('\n').forEach(function (l) { addLine(l === '' ? ' ' : l); });
      return;
    }
    addLine('usage (sandbox): crontab -l  (membaca /etc/crontab)', 't-hot');
  }
  function cmdExit() {
    addLines([
      ['[C-SHELL] logout disimulasikan — kamu tetap di sandbox.', 't-dim'],
      ['Biarkan sandbox terbuka untuk melanjutkan lab atau ketik  reset.', 't-comment']
    ]);
  }

  /* ---------- missions & flags ---------- */
  var FLAGS = [
    { v: 'FLAG{lab-web-01}', name: 'Eksploitasi Web — lab-web-01', hint: 'sqlmap + dump, lalu cat lab/flag-web.txt' },
    { v: 'FLAG{blue-team}', name: 'Deteksi Bruteforce — SOC', hint: 'analisis /var/log/auth.log, lalu cat lab/flag-blue.txt' },
    { v: 'FLAG{dmz-internal}', name: 'Pivoting DMZ — lab-internal-01', hint: 'petakan 10.0.5.7 (ftp), lalu cat lab/flag-internal.txt' },
    { v: 'FLAG{pwn-root}', name: 'Privilege Escalation — root lab-web-01', hint: 'ssh webadmin@lab-web-01 lalu sudo -l; baca /root/root.txt' }
  ];
  var SCORE_KEY = 'cg_lab_score_v2';
  function loadScore() {
    try { var s = JSON.parse(localStorage.getItem(SCORE_KEY)); if (Array.isArray(s)) return s.filter(function (v) { return typeof v === 'string'; }); } catch (e) {}
    return [];
  }
  function saveScore() {
    try { localStorage.setItem(SCORE_KEY, JSON.stringify(S.score)); } catch (e) {}
  }
  function claimedFlag(v) { return S.score.indexOf(v) !== -1; }
  function cmdMissions() {
    addLines([
      ['MISI CYBERGUARD SANDBOX (v2)', 't-purple'],
      ['---------------------------------------------', '']
    ]);
    FLAGS.forEach(function (f, i) {
      var done = claimedFlag(f.v);
      addLine(String(i + 1) + '. [' + (done ? 'CLAIMED' : '  TODO  ') + '] ' + f.name, done ? 't-ok' : '');
      addLine('      ' + (done ? 'FLAG sudah diklaim.' : f.hint), 't-dim');
    });
    addLine('');
    addLine('Ketik : flag <FLAG{...}> untuk mengklaim.', 't-comment');
    addLine('File  : lab/missions.txt berisi petunjuk lengkap.', 't-comment');
  }
  function cmdFlag(args) {
    var v = (args[0] || '').trim();
    if (!v) { addLine('usage: flag <FLAG{...}>   (klaim setelah misi sukses)', 't-hot'); return; }
    var f = null;
    for (var i = 0; i < FLAGS.length; i++) if (FLAGS[i].v === v) { f = FLAGS[i]; break; }
    if (!f) { addLine('flag: "' + v + '" tidak dikenal di sandbox. Cek: missions', 't-hot'); return; }
    if (claimedFlag(v)) { addLine('flag: sudah diklaim sebelumnya.', 't-warn'); return; }
    S.score.push(v);
    saveScore();
    addLines([
      ['FLAG DIKLAIM — ' + v, 't-ok'],
      ['+1 poin: ' + f.name, 't-dim'],
      ['Lihat status: score', 't-comment']
    ]);
  }
  function cmdLastb() {
    addLines([
      ['lastb (simulasi login gagal — SOC)', 't-purple'],
      ['---------------------------------------------', '']
    ]);
    var lines = [];
    var rec = [
      ['webadmin', '192.168.1.25', '08:12:03'],
      ['webadmin', '192.168.1.25', '08:12:05'],
      ['root', '192.168.1.40', '08:13:41'],
      ['admin', '192.168.1.99', '09:47:22'],
      ['student', '192.168.1.10', '11:02:58']
    ];
    for (var i = 0; i < rec.length; i++) {
      var dim = (i === rec.length - 1);
      lines.push([(rec[i][0] + ' ').slice(0, 11) + '  ' + rec[i][1] + '  ' + rec[i][2], dim ? 't-dim' : 't-hot']);
    }
    addLines(lines);
    addLine('');
    addLine('5 login gagal tertera. Rekod paling mencurigakan: bruteforce webadmin 08:12 UTC — sinkron dengan grep di /var/log/auth.log.', 't-comment');
  }
  function cmdScore() {
    addLines([
      ['SCOREBOARD CYBERGUARD', 't-purple'],
      ['---------------------------------------------', '']
    ]);
    var count = 0;
    FLAGS.forEach(function (f) {
      if (claimedFlag(f.v)) { addLine(' [X] ' + f.name, 't-ok'); count++; }
      else addLine(' [ ] ' + f.name, 't-dim');
    });
    addLine('');
    addLine('Flag dikumpulkan: ' + count + '/' + FLAGS.length, count === FLAGS.length ? 't-ok' : '');
    if (count === FLAGS.length) addLine('Status: AKADEMI PENYELESAI — semua misi sandbox berhasil.', 't-ok');
  }

  /* ---------- hash / encoding ---------- */
  function fileContent(a) {
    if (canRead(a) === null) return null;
    var f = resolvePath(normalize(a.charAt(0) === '/' ? a : S.cwd + '/' + a));
    return f ? f.content : null;
  }
  function cmdHash(args, algo) {
    if (!args.length) { addLine('usage: ' + algo + ' <file>', 't-hot'); return; }
    var target = args[0].replace(/^-+/, '');
    var data = fileContent(target);
    if (data === null) { addLine(algo + ': ' + target + ': No such file or directory', 't-hot'); return; }
    if (algo === 'md5sum') {
      return md5(data).then(function (m) { addLine(m + '  ' + target); })
        .catch(function () { addLine(algo + ': digest error', 't-hot'); });
    }
    return shaOf(data, algo === 'sha1sum' ? 'SHA-1' : 'SHA-256')
      .then(function (h) {
        if (h) addLine(h + '  ' + target);
        else addLine(algo + ': digest error', 't-hot');
      })
      .catch(function () { addLine(algo + ': digest error', 't-hot'); });
  }
  function cmdBase64(args) {
    if (!args.length) { addLine('usage: base64 -d <encoded> | base64 <plain>', 't-hot'); return; }
    if (args[0] === '-d') {
      try { addLine(atob(args[1] || '')); } catch (e) { addLine('base64: invalid input', 't-hot'); }
    } else {
      try { addLine(btoa(args.join(' '))); } catch (e) { addLine('base64: invalid input', 't-hot'); }
    }
  }
  function cmdCalc(args) {
    var expr = args.join(' ').replace(/[^0-9+\-*/(). ]/g, '');
    if (!expr) { addLine('usage: calc 2+2*10', 't-hot'); return; }
    try { addLine('= ' + Function('return (' + expr + ')')()); }
    catch (e) { addLine('calc: expression error', 't-hot'); }
  }
  function cmdMan(args) {
    var MAN = {
      nmap: 'nmap [opsi] target\n' +
        '  -sV   deteksi versi layanan (kunci enumeration)\n' +
        '  -p    port tertentu (mis. -p80,443 atau -p-)\n' +
        '  --open  hanya port terbuka\n' +
        '  -sn   ping sweep (host discovery)\n' +
        '  peta service+versi -> feed ke searchsploit / nikto',
      sqlmap: 'sqlmap -u "URL" [opsi]\n' +
        '  --dbs     daftar database\n' +
        '  --tables  tabel pada database\n' +
        '  --dump    ekstrak data (bukti dampak, batasi sampel)\n' +
        '  --batch   jalankan tanpa prompt interaktif\n' +
        '  alur: --dbs -> --tables -> --dump, lalu simpan > evidence',
      hydra: 'hydra -l <user> | -L <users> -P <wordlist> <service>://<host>\n' +
        '  service: ssh ftp smb rdp http-get (lab: ssh/ftp)\n' +
        '  cek lab: -P /opt/lab/wordlists/passwords.txt',
      john: 'john <file-hashes>\n  memecahkan MD5 dari lab/hashes.txt atau dump sqlmap\n  cek juga: hashcat -m 0 <file>',
      hashcat: 'hashcat -m 0 <hashes.txt> | --show\n  mode -m 0 = MD5 (sandbox). wordlist kredensial lab terbatas.',
      gobuster: 'gobuster dir -u http://host -w <wordlist>\n  wordlist: /opt/lab/wordlists/directory.txt\n  temukan path tersembunyi (admin/, uploads/, backup/...)',
      nikto: 'nikto -h http://host\n  scan kerentanan web: misconfig, header hilang, directory listing.',
      linpeas: 'linpeas\n  enumerasi privesc satu klik: sudo, cron, SUID, capabilities,\n  kredensial bocor, koneksi C2. Rujuk GTFOBins untuk vektor.',
      find: 'find / -perm -4000 2>/dev/null  (daftar SUID root)\n  GTFOBins: find binary SUID -> find . -exec /bin/sh -p \\; -quit',
      getcap: 'getcap -r / 2>/dev/null\n  daftar file dengan capabilities (cap_setuid bisa = root via python3).',
      iptables: 'iptables -L -n                    (lihat aturan)\n  iptables -A INPUT -s <ip> -j DROP (containment cepat)',
      ufw: 'ufw status verbose\n  ufw deny from <ip>             (blokir sumber insiden)',
      ss: 'ss -tunp\n  status socket aktif; cari ESTABLISHED mencurigakan ke IP asing.',
      journalctl: 'journalctl -u ssh | tail   (log sshd systemd)\n  bandingkan dengan /var/log/auth.log untuk triage.',
      last: 'last | head        (riwayat login sukses)\n  lastlog           (login terakhir tiap akun)',
      ssh: 'ssh [user@]host   contoh: ssh webadmin@lab-web-01\n  kredensial hasil crack (chicken) -> post-exploit & privesc'
    };
    var t = args.join(' ');
    if (MAN[t]) { addLine(MAN[t]); return; }
    addLine('man: belum ada halaman untuk "' + t + '". Coba: help | man nmap | man sqlmap', 't-comment');
  }
  function cmdTutorial() {
    addLines([
      ['TUTORIAL 5 MENIT — PRAKTIK LANGSUNG', 't-purple'],
      ['', ''],
      ['1. Lihat peta target :  cat lab/targets.txt', ''],
      ['2. Scan lab-web-01    :  nmap 192.168.1.10 -sV', ''],
      ['3. Uji SQLi           :  sqlmap -u "http://lab-web-01/search?id=1" --dbs', ''],
      ['4. Deteksi brute-force:  grep "Failed password" /var/log/auth.log | sort | uniq -c', ''],
      ['5. Analisis login      :  lastlog && last | head', ''],
      ['6. Buktikan hash       :  sha256sum lab/flag-web.txt', 't-comment']
    ]);
  }
  function cmdReset() {
    try { localStorage.removeItem(FS_KEY); } catch (e) {}
    fs = seedFs(); saveFs();
    bootEnv();
    promptEl.textContent = promptText();
    addLines([['Sandbox di-reset ke kondisi awal.', 't-ok']]);
  }
  function cmdUnknown(name) {
    addLine(name + ': command not found. Ketik help untuk daftar perintah.', 't-hot');
  }

  /* ---------- command table ---------- */
  function buildCMDT() {
    CMD.help = { fn: cmdHelp, desc: 'daftar perintah' };
    CMD.banner = { fn: cmdBanner, desc: 'banner sistem' };
    CMD.tutorial = { fn: cmdTutorial, desc: 'tur 5 menit praktik' };
    CMD.clear = { fn: cmdClear, desc: 'bersihkan layar' };
    CMD.ls = { fn: cmdLs, desc: 'daftar isi direktori' };
    CMD.cd = { fn: cmdCd, desc: 'pindah direktori' };
    CMD.pwd = { fn: cmdPwd, desc: 'lokasi saat ini' };
    CMD.mkdir = { fn: cmdMkdir, desc: 'buat direktori' };
    CMD.touch = { fn: cmdTouch, desc: 'buat file kosong' };
    CMD.rm = { fn: cmdRm, desc: 'hapus file' };
    CMD.cp = { fn: cmdCp, desc: 'salin file/direktori' };
    CMD.mv = { fn: cmdMv, desc: 'pindah/rename' };
    CMD.cat = { fn: cmdCat, desc: 'tampilkan isi file' };
    CMD.head = { fn: cmdHead, desc: 'a walbe awal file' };
    CMD.tail = { fn: cmdTail, desc: 'bagian akhir file' };
    CMD.wc = { fn: cmdWc, desc: 'hitung baris/kata/karakter' };
    CMD.echo = { fn: cmdEcho, desc: 'cetak teks' };
    CMD.grep = { fn: cmdGrep, desc: 'cari pola dalam file' };
    CMD.find = { fn: cmdFind, desc: 'cari nama file' };
    CMD.tree = { fn: cmdTree, desc: 'pohon direktori' };
    CMD.whoami = { fn: cmdWhoami, desc: 'user aktif' };
    CMD.id = { fn: cmdId, desc: 'info identitas user' };
    CMD.date = { fn: cmdDate, desc: 'tanggal & waktu' };
    CMD.uname = { fn: cmdUname, desc: 'info kernel' };
    CMD.uptime = { fn: cmdUptime, desc: 'lama nyala sistem' };
    CMD.env = { fn: cmdEnv, desc: 'variabel lingkungan' };
    CMD.export = { fn: cmdExport, desc: 'set variabel' };
    CMD.history = { fn: cmdHistory, desc: 'riwayat perintah' };
    CMD.who = { fn: cmdWho, desc: 'siapa yang login' };
    CMD.sudo = { fn: cmdSudo, desc: 'jalankan sebagai root' };
    CMD.alias = { fn: cmdAlias, desc: 'alias perintah' };
    CMD.unalias = { fn: cmdUnalias, desc: 'hapus alias' };
    CMD.ip = { fn: cmdIp, desc: 'info jaringan' };
    CMD.ifconfig = { fn: cmdIfconfig, desc: 'info antarmuka' };
    CMD.netstat = { fn: cmdNetstat, desc: 'tabel koneksi' };
    CMD.ping = { fn: cmdPing, desc: 'uji koneksi host' };
    CMD.nmap = { fn: cmdNmap, desc: 'scan port (simulasi)' };
    CMD.sqlmap = { fn: cmdSqlmap, desc: 'uji SQLi (simulasi)' };
    CMD.curl = { fn: cmdCurl, desc: 'ambil URL' };
    CMD.ssh = { fn: cmdSsh, desc: 'konek ke host lab' };
    CMD.python = { fn: cmdPython, desc: 'note interpreter' };
    CMD['sha256sum'] = { fn: function (a) { cmdHash(a, 'sha256sum'); }, desc: 'hash SHA-256' };
    CMD['sha1sum'] = { fn: function (a) { cmdHash(a, 'sha1sum'); }, desc: 'hash SHA-1' };
    CMD['md5sum'] = { fn: function (a) { cmdHash(a, 'md5sum'); }, desc: 'hash MD5' };
    CMD['base64'] = { fn: cmdBase64, desc: 'encode/decode' };
    CMD.calc = { fn: cmdCalc, desc: 'kalkulator aman' };
    CMD.man = { fn: cmdMan, desc: 'bantuan perintah' };
    CMD.reset = { fn: cmdReset, desc: 'reset sandbox' };
    CMD.exit = { fn: cmdExit, desc: 'keluar' };

    /* pro lab tools (registered pro tools) */
    CMD.hydra = { fn: cmdHydra, desc: 'brute-force login (simulasi)' };
    CMD.hashcat = { fn: cmdHashcat, desc: 'crack hash (simulasi)' };
    CMD.john = { fn: cmdJohn, desc: 'john the ripper (simulasi)' };
    CMD.gobuster = { fn: cmdGobuster, desc: 'dir-bruteforce web (simulasi)' };
    CMD.nikto = { fn: cmdNikto, desc: 'scan kerentanan web (simulasi)' };
    CMD.searchsploit = { fn: cmdSearchsploit, desc: 'cari exploit (simulasi)' };
    CMD.tcpdump = { fn: cmdTcpdump, desc: 'sniff paket (simulasi)' };
    CMD.ps = { fn: cmdPs, desc: 'daftar proses' };
    CMD.missions = { fn: cmdMissions, desc: 'daftar misi lab' };
    CMD.lastb = { fn: cmdLastb, desc: 'login gagal terakhir (SOC)' };
    CMD.flag = { fn: cmdFlag, desc: 'verifikasi flag misi' };
    CMD.score = { fn: cmdScore, desc: 'lihat skor lab' };

    /* log-processing & enumeration */
    CMD.sort = { fn: cmdSort, desc: 'urutkan baris (support -r -n -u)' };
    CMD.uniq = { fn: cmdUniq, desc: 'hapus duplikat (-c hitung)' };
    CMD.cut = { fn: cmdCut, desc: 'ambil kolom (-d delim -f)' };
    CMD.awk = { fn: cmdAwk, desc: "proses teks '{print $n}'" };
    CMD.linpeas = { fn: cmdLinpeas, desc: 'enum privesc (simulasi)' };
    CMD.getcap = { fn: cmdGetcap, desc: 'list capabilities (simulasi)' };
    CMD.lastlog = { fn: cmdLastlog, desc: 'login terakhir tiap akun (SOC)' };
    CMD.last = { fn: cmdLast, desc: 'riwayat login (SOC)' };
    CMD.journalctl = { fn: cmdJournalctl, desc: 'log systemd (-u ssh)' };
    CMD.ss = { fn: cmdSs, desc: 'status socket aktif (SOC)' };
    CMD.iptables = { fn: cmdIptables, desc: 'manajemen firewall (simulasi)' };
    CMD.ufw = { fn: cmdUfw, desc: 'manajemen firewall (simulasi)' };
    CMD.crontab = { fn: cmdCrontab, desc: 'lihat job cron (-l)' };
  }

  /* ---------- main exec (pipes, redirection, chaining) ---------- */
  function splitTopLevel(str, ch) {
    var out = [], cur = '', q = '', i, c;
    for (i = 0; i < str.length; i++) {
      c = str[i];
      if (q) { cur += c; if (c === q) q = ''; continue; }
      if (c === '"' || c === "'") { q = c; cur += c; continue; }
      if (c === ch) { out.push(cur); cur = ''; continue; }
      cur += c;
    }
    out.push(cur);
    return out.map(function (s) { return s.trim(); });
  }

  function runStage(raw) {
    raw = raw.trim();
    if (!raw) return Promise.resolve(true);
    var toks = tokenize(expandLine(raw));
    var rd = stripRedirect(toks);
    var name = rd.toks[0];
    name = S.aliases[name] ? tokenize(S.aliases[name] + ' ' + rd.toks.slice(1).join(' '))[0] : name;
    var args = rd.toks.slice(1);
    if (rd.inF != null) {
      var inf = resolvePath(normalize(rd.inF.charAt(0) === '/' ? rd.inF : S.cwd + '/' + rd.inF));
      _inp = (inf && inf.content != null) ? (inf.content || '').split('\n') : null;
    }
    var cmd = CMD[name];
    if (!cmd) { cmdUnknown(name); return Promise.resolve(false); }
    var silentBefore = _silent;
    if (rd.outOp) _silent = true;
    var res;
    try { res = cmd.fn(args); }
    catch (e) { addLine(name + ': error internal: ' + e.message, 't-hot'); _silent = silentBefore; _inp = null; _cap = null; return Promise.resolve(false); }
    var p = (res && typeof res.then === 'function') ? res : Promise.resolve();
    return p.then(function () {
      if (rd.outOp) {
        // tampilkan error redirection walau tahap diam (mis. direktori tak ada)
        var prevSilent = _silent;
        _silent = false;
        writeFileSt(rd.outF, _cap || [], rd.outOp === '>>');
        _silent = prevSilent;
      }
      var ok = (S.lastStatus === 0);
      S.lastStatus = 0;
      _silent = silentBefore;
      return ok;
    }).catch(function () { _silent = silentBefore; return false; });
  }

  function runPipe(raw) {
    var stages = splitTopLevel(raw, '|').filter(function (s) { return s; });
    if (!stages.length) return Promise.resolve(true);
    var prev = null;
    return stages.reduce(function (p, st, i) {
      return p.then(function () {
        _inp = (i === 0) ? null : prev;
        _cap = [];
        // hanya output tahap terakhir yang di-render; tahap antara di-redirect melalui _cap
        var isLast = (i === stages.length - 1);
        if (!isLast) _silent = true;
        return runStage(st).then(function (ok) {
          prev = (_cap || []).map(function (l) { return l[0]; });
          if (!isLast) _silent = false;
          return ok;
        });
      });
    }, Promise.resolve(true)).then(function (ok) {
      _inp = null; _cap = null; _silent = false;
      return ok;
    });
  }

  function execute(line) {
    line = (line || '').trim();
    if (!line) return Promise.resolve(true);
    S.hist.push(line);
    S.histPos = S.hist.length;
    var parts = splitChains(line);
    var idx = 0;
    function next() {
      if (idx >= parts.length) return Promise.resolve(true);
      var part = parts[idx]; idx++;
      return runPipe(part.raw).then(function (ok) {
        if (part.sep === '&&' && !ok) return ok;
        return next();
      });
    }
    return next();
  }
  function runLine(line) {
    if (!bodyEl) return;
    addLine(promptText() + ' ' + line, 't-cmd');
    execute(line);
  }

  /* ---------- autocomplete ---------- */
  function autocomplete(raw) {
    if (!raw) return raw;
    var parts = raw.split(' ');
    var isFirst = parts.length === 1;
    var prefix = parts[parts.length - 1];
    var cands = [];
    if (isFirst) {
      cands = Object.keys(CMD);
      S.hist.slice().reverse().forEach(function (h) { if (cands.indexOf(h.split(' ')[0]) === -1) cands.push(h.split(' ')[0]); });
    } else {
      cands = listDir(S.cwd);
      if (prefix.indexOf('/') !== -1) {
        var lastSlash = prefix.lastIndexOf('/');
        var dirPart = normalize((prefix.charAt(0) === '/' ? '' : S.cwd + '/') + prefix.slice(0, lastSlash + 1));
        var d = getDir(dirPart.replace(/\/+$/, '') || '/');
        if (d) cands = Object.keys(d.children).sort();
      }
    }
    var matches = cands.filter(function (c) { return c.indexOf(prefix) === 0 && c !== prefix; });
    if (!matches.length) return raw;
    if (matches.length === 1) {
      var _d = raw.split(' ');
      _d[_d.length - 1] = matches[0] + (isFirst ? ' ' : ' ');
      return _d.join(' ');
    }
    // common prefix
    var cp = matches[0];
    matches.forEach(function (m) { while (m.indexOf(cp) !== 0) cp = cp.slice(0, -1); });
    var _d2 = raw.split(' ');
    _d2[_d2.length - 1] = cp;
    addLine('', '');
    matches.slice(0, 12).forEach(function (m) { addLine(m + '  ', 't-dim'); });
    return _d2.join(' ');
  }

  /* ---------- input handling ---------- */
  var temp = '';
  function bindInput() {
    if (!inputEl) return;
    if (S.hist.length) { /* noop */ }
    inputEl.addEventListener('keydown', function (e) {
      if (e.key === 'Enter') { e.preventDefault(); var v = inputEl.value; inputEl.value = ''; runLine(v); }
      else if (e.key === 'ArrowUp') {
        e.preventDefault();
        if (!S.hist.length) return;
        if (S.histPos > 0) S.histPos--;
        inputEl.value = S.hist[S.histPos] || '';
      } else if (e.key === 'ArrowDown') {
        e.preventDefault();
        if (S.histPos < S.hist.length) S.histPos++;
        inputEl.value = S.histPos < S.hist.length ? S.hist[S.histPos] : '';
      } else if (e.key === 'Tab') {
        e.preventDefault();
        inputEl.value = autocomplete(inputEl.value);
      } else if (e.key === 'c' && e.ctrlKey) {
        e.preventDefault();
        inputEl.value = '';
        addLine('^C', 't-dim');
      } else if (e.key === 'l' && e.ctrlKey) {
        e.preventDefault();
        cmdClear();
      }
    });
  }
  function bindButtons() {
    qsa('[data-term-toggle]').forEach(function (b) {
      b.addEventListener('click', function (e) { e.preventDefault(); toggle(); });
    });
    var copyBtn = qs('[data-term-copy]');
    if (copyBtn) copyBtn.addEventListener('click', function () {
      var text = bodyEl ? bodyEl.innerText : '';
      if (navigator.clipboard && window.isSecureContext) navigator.clipboard.writeText(text);
      else { var ta = document.createElement('textarea'); ta.value = text; document.body.appendChild(ta); ta.select(); try { document.execCommand('copy'); } catch (e2) {} document.body.removeChild(ta); }
      flashBtn(copyBtn, 'Tersalin');
    });
    var clearBtn = qs('[data-term-clear]');
    if (clearBtn) clearBtn.addEventListener('click', function () { cmdClear(); });
    var closeBtn = qs('[data-term-close]');
    if (closeBtn) closeBtn.addEventListener('click', function () { close(); });
    if (bodyEl) bodyEl.addEventListener('click', function () { if (inputEl) inputEl.focus(); });
  }
  function flashBtn(btn, txt) {
    if (!btn) return;
    var old = btn.textContent;
    btn.textContent = txt;
    setTimeout(function () { btn.textContent = old; }, 1200);
  }
  function bindRunButtons() {
    qsa('[data-run]').forEach(function (b) {
      b.addEventListener('click', function (e) {
        e.preventDefault();
        var cmds = (b.getAttribute('data-run') || '').split('&&');
        openRun(cmds);
      });
    });
  }
  function openRun(cmds) {
    open();
    var k = 0;
    (function next() {
      if (k >= cmds.length) { return; }
      var c = cmds[k]; k++;
      setTimeout(function () {
        runLine(c);
        setTimeout(next, 220);
      }, 120);
    })();
  }

  /* ---------- open / close / toggle ---------- */
  function open() {
    if (!shell) return;
    shell.classList.add('open');
    shell.setAttribute('aria-hidden', 'false');
    qsa('[data-term-toggle]').forEach(function (b) { b.classList.add('on'); });
    setTimeout(function () { if (inputEl) inputEl.focus(); }, 260);
  }
  function close() {
    if (!shell) return;
    shell.classList.remove('open');
    shell.setAttribute('aria-hidden', 'true');
    qsa('[data-term-toggle]').forEach(function (b) { b.classList.remove('on'); });
  }
  function toggle() { shell && (shell.classList.contains('open') ? close() : open()); }

  /* ================= init ================= */
  function init() {
    if (!shell || !bodyEl || !inputEl) return;
    fs = loadFs();
    S.env = { HOME: '/home/' + S.user, USER: S.user, SHELL: '/bin/bash', TERM: 'xterm-256color', PWD: S.cwd };
    buildCMDT();
    if (promptEl) promptEl.textContent = promptText();
    bindInput();
    bindButtons();
    bindRunButtons();
    cmdBanner();
    addLines([
      ['Ketik  help  untuk daftar perintah, atau  tutorial  untuk tur 5 menit.', 't-comment'],
      ['Semua perintah berjalan real-time di sandbox terisolasi; aman untuk praktik.', 't-dim']
    ]);
  }

  // expose API
  window.CyberTerm = {
    open: open,
    close: close,
    toggle: toggle,
    run: runLine,
    isOpen: function () { return !!(shell && shell.classList.contains('open')); }
  };

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();