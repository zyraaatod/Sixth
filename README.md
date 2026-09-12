<div align="center">

<img src="https://readme-typing-svg.demolab.com?font=JetBrains+Mono&weight=800&size=34&duration=2600&pause=900&color=00E5A0&center=true&vCenter=true&width=760&lines=CYBERGUARD+ACADEMY+%F0%9F%9B%A1%EF%B8%8F;Menangkan+Pertempuran+di+Dunia+Digital;Fundamental+%E2%86%92+Offense+%E2%86%92+Defense+%E2%86%92+Karir" alt="CyberGuard Academy" />

### 🛡️ Platform Pembelajaran Keamanan Siber — Bahasa Indonesia

Dari **nol** sampai **profesional**: fundamental, katalog 60+ tools, teknik *offensive* & *defensive* yang legal, metodologi pentest, hingga jalur karir.

<p>
  <img src="https://img.shields.io/badge/HTML5-E34F26?style=for-the-badge&logo=html5&logoColor=white" alt="HTML5" />
  <img src="https://img.shields.io/badge/CSS3-1572B6?style=for-the-badge&logo=css3&logoColor=white" alt="CSS3" />
  <img src="https://img.shields.io/badge/JavaScript-F7DF1E?style=for-the-badge&logo=javascript&logoColor=black" alt="JavaScript" />
  <img src="https://img.shields.io/badge/Node.js-339933?style=for-the-badge&logo=nodedotjs&logoColor=white" alt="Node.js" />
</p>
<p>
  <img src="https://img.shields.io/badge/Responsive-Mobile%20Ready-00E5A0?style=for-the-badge&logo=googlechrome&logoColor=white" alt="Responsive" />
  <img src="https://img.shields.io/badge/No%20Framework-Zero%20Build-8B5CF6?style=for-the-badge&logo=vitess&logoColor=white" alt="Zero Build" />
  <img src="https://img.shields.io/github/stars/zyraaatod/Sixth?style=for-the-badge&color=00E5A0&logo=github" alt="Stars" />
  <img src="https://img.shields.io/github/last-commit/zyraaatod/Sixth?style=for-the-badge&color=8B5CF6&logo=git" alt="Last commit" />
</p>

<p>
  <a href="#-mulai-cepat"><img src="https://img.shields.io/badge/🚀%20Mulai%20Belajar-00E5A0?style=for-the-badge" alt="Mulai" /></a>
  <a href="#-terminal-sandbox"><img src="https://img.shields.io/badge/💻%20Coba%20Terminal-111827?style=for-the-badge" alt="Terminal" /></a>
  <a href="https://github.com/zyraaatod/Sixth/issues"><img src="https://img.shields.io/badge/🐛%20Laporkan%20Bug-dc2626?style=for-the-badge" alt="Laporkan Bug" /></a>
</p>

</div>

---

## 📖 Tentang Proyek

**CyberGuard Academy** adalah situs edukasi interaktif keamanan siber berbahasa Indonesia yang dibangun murni dengan **HTML, CSS, dan JavaScript** — tanpa framework, tanpa proses build. Cukup buka di browser dan langsung belajar.

Proyek ini menggabungkan materi terstruktur dengan **terminal sandbox real-time di dalam browser** yang mensimulasikan tools keamanan sungguhan (Nmap, SQLMap, Hydra, Hashcat, John, Gobuster, Nikto, Searchsploit, Tcpdump, dan lainnya) — lengkap dengan *virtual filesystem*, *command history*, *autocomplete*, *pipeline*, dan sistem **misi + flag + scoreboard** untuk latihan praktis di lingkungan yang 100% aman dan legal.

> **Etika & Legalitas** — Seluruh materi dan simulasi dibuat untuk tujuan edukasi. Hanya praktikkan pada sistem milikmu sendiri atau yang telah diizinkan secara tertulis.

---

## ✨ Fitur Unggulan

| | Fitur | Deskripsi |
|---|-------|-----------|
| 🖥️ | **Terminal Sandbox** | Shell emulator interaktif di browser: *virtual filesystem*, *history*, *tab-completion*, *pipe* `\|`, redirection `>`, dan chaining `&&`. |
| 🧪 | **Simulasi Tools Nyata** | `nmap`, `sqlmap`, `hydra`, `hashcat`, `john`, `gobuster`, `nikto`, `searchsploit`, `tcpdump`, `ssh`, `curl`, `ping`, dan banyak lagi. |
| 🎯 | **Misi, Flag & Scoreboard** | Tantangan bertingkat dengan sistem *capture-the-flag* dan papan skor untuk mengukur progres belajar. |
| 📚 | **7 Halaman Terstruktur** | Fundamental, Offensive, Defensive, Metodologi Pentest, Katalog Tools, dan Jalur Karir. |
| 🧰 | **60+ Tools Keamanan** | Katalog lengkap beserta deskripsi, kategori, dan contoh perintah yang siap dicoba. |
| 📱 | **Mobile Ready** | Tata letak responsif penuh — nyaman dipelajari dari ponsel maupun desktop. |
| ⚡ | **Zero Dependency** | Tanpa framework, tanpa build step, tanpa backend. Ringan dan cepat. |
| ✅ | **Test Harness** | Skrip Node.js memverifikasi **50/50 command** terminal berjalan tanpa error. |

---

## 🗂️ Modul Pembelajaran

| # | Modul | Halaman | Isi Singkat |
|---|-------|---------|-------------|
| 01 | **Fundamental Keamanan** | [`fundamentals.html`](fundamentals.html) | CIA Triad, OSI/TCP-IP, kriptografi, CVE/CVSS, aktor ancaman. |
| 02 | **Katalog Tools Modern** | [`tools.html`](tools.html) | 60+ tools dengan kategori & contoh perintah. |
| 03 | **Offensive Security** | [`offensive.html`](offensive.html) | Recon, scanning, exploitation, web, wireless, Active Directory. |
| 04 | **Defensive Security** | [`defensive.html`](defensive.html) | SOC, incident response, SIEM/EDR, hardening, forensik. |
| 05 | **Metodologi Pentest** | [`methodology.html`](methodology.html) | PTES, OWASP WSTG, OSSTMM, scoping & laporan. |
| 06 | **Jalur Karir & Sertifikasi** | [`careers.html`](careers.html) | Roadmap, eJPT/OSCP/CEH/CISSP/BTL1, strategi kerja pertama. |
| 07 | **Beranda** | [`index.html`](index.html) | Pusat navigasi, ringkasan lanskap ancaman, Red vs Blue Team. |

---

## 💻 Terminal Sandbox

Setiap halaman dilengkapi terminal yang dapat dibuka dari bilah navigasi. Terminal berjalan **sepenuhnya di sisi klien** dan menyimpan state di `localStorage`.

```console
student@cyberguard:~$ nmap -sV lab-web-01
student@cyberguard:~$ gobuster dir -u http://lab-web-01 -w /opt/lab/wordlists/directory.txt
student@cyberguard:~$ searchsploit samba 3
student@cyberguard:~$ hydra -l webadmin -P /opt/lab/wordlists/passwords.txt ssh://lab-web-01
student@cyberguard:~$ missions
student@cyberguard:~$ flag FLAG{lab-web-01}
student@cyberguard:~$ score
```

**Dukungan shell:** pipeline (`cat file | grep pass`), redirection (`echo hi > file.txt`), chaining (`cmd1 && cmd2`), serta auto-complete perintah dan path.

---

## 🚀 Mulai Cepat

Karena proyek ini statis, tidak diperlukan instalasi. Pilih salah satu cara berikut:

**1. Buka langsung**
```bash
git clone https://github.com/zyraaatod/Sixth.git
cd Sixth
# lalu buka index.html di browser
```

**2. Jalankan server lokal** (disarankan agar semua fitur berjalan optimal)
```bash
# Python
python3 -m http.server 8080

# atau Node.js
npx serve .
```
Buka `http://localhost:8080` di browser.

---

## 🧪 Menjalankan Test

Test harness memverifikasi seluruh perintah terminal yang dipakai di situs.

```bash
node tests/term_harness.js
```

Output yang diharapkan:

```text
FULL: 50 cmds, 0 failures
```

---

## 🗂️ Struktur Proyek

```text
Sixth/
├── index.html            # Beranda
├── fundamentals.html     # Modul 01 — Fundamental
├── offensive.html        # Modul 03 — Offensive Security
├── defensive.html        # Modul 04 — Defensive Security
├── methodology.html      # Modul 05 — Metodologi Pentest
├── tools.html            # Modul 02 — Katalog Tools
├── careers.html          # Modul 06 — Jalur Karir
├── css/
│   └── styles.css        # Design system & tema
├── js/
│   ├── script.js         # Interaksi UI, animasi, typewriter
│   └── terminal.js       # Terminal sandbox & simulasi tools
├── tests/
│   └── term_harness.js   # Test otomatis perintah terminal
└── README.md
```

---

## 🛣️ Roadmap

- [x] 7 halaman modul pembelajaran
- [x] Terminal sandbox + virtual filesystem
- [x] Simulasi 60+ security tools
- [x] Misi, flag & scoreboard
- [x] Mobile responsive v2
- [ ] Mode gelap/terang otomatis
- [ ] Leaderboard online
- [ ] Progres belajar tersinkron (akun)
- [ ] Ekspor write-up ke PDF

---

## 🤝 Kontribusi

Kontribusi sangat welcome! Baik itu perbaikan materi, penambahan tool, atau laporan bug.

1. **Fork** repositori ini
2. Buat branch fitur: `git checkout -b fitur/namamu`
3. Commit perubahan: `git commit -m "feat: tambah modul X"`
4. Push: `git push origin fitur/namamu`
5. Buka **Pull Request**

---

## ⚖️ Lisensi & Disclaimer

Proyek ini dirilis dengan lisensi **MIT**. Materi disediakan **untuk tujuan edukasi**. Penulis tidak bertanggung jawab atas penyalahgunaan. Selalu patuhi hukum yang berlaku (mis. UU ITE di Indonesia) dan dapatkan izin tertulis sebelum menguji sistem apa pun.

<div align="center">

---

**Dibuat dengan 🛡️ untuk generasi profesional keamanan siber Indonesia**

⭐ Jangan lupa beri **star** jika proyek ini bermanfaat!

<img src="https://capsule-render.vercel.app/api?type=waving&color=gradient&customColorList=12,20,24&height=120&section=footer" width="100%" alt="footer" />

</div>
