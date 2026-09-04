## ⚠️ CATATAN PERBAIKAN (baca dulu sebelum deploy)

1. **Token lama bocor.** `config.js` versi sebelumnya berisi `BOT_TOKEN` dan `GITHUB_TOKEN` asli yang ikut tersebar di source ini. Revoke keduanya lalu buat yang baru (BotFather → Revoke/New Token; GitHub → Settings → Developer settings → Personal access tokens → Revoke, lalu generate baru dengan scope `repo` + `workflow`). Isi token baru **langsung di `config.js`** (semua field ada di paling atas file, tinggal isi string kosongnya) — **jangan pernah upload/share file `config.js` yang sudah terisi ke siapa pun atau ke repo publik**, karena itu artinya token asli kamu ikut tersebar lagi seperti kemarin.
2. **Alur build sekarang nyata, bukan animasi.** Sebelumnya bot menampilkan progres palsu dengan durasi tetap ±7m46s lalu mengirim artifact GitHub yang tidak terkait dengan ZIP yang diunggah user (atau file dummy kalau tidak ada artifact). Sekarang bot: mengunduh ZIP dari Telegram → push ke branch khusus di repo builder → `workflow_dispatch` workflow `flutter_build.yml` pada branch tsb → memantau run itu spesifik lewat GitHub API → mengunduh APK asli dari run tsb → mengirim ke chat. Kalau build gagal, bot melaporkan gagal beserta link log asli — tidak lagi berpura-pura sukses.
3. **Prasyarat server:** binary `git` harus terpasang (`sudo apt install git`), dan `GITHUB_REPO` di `config.js` harus repo terpisah yang branch default-nya HANYA berisi folder `.github/workflows/` (jangan taruh project Flutter kamu sendiri di branch default repo itu — branch itu jadi "template", tiap build otomatis dibuatkan branch baru).
4. **Estimasi waktu build** sekarang mengikuti waktu asli GitHub Actions runner (biasanya 3–8 menit untuk project kecil-menengah), bukan angka karangan.
5. Bot akan langsung berhenti dengan pesan jelas di console kalau field wajib (`BOT_TOKEN`, `GITHUB_OWNER`, `GITHUB_REPO`, `GITHUB_TOKEN`) di `config.js` masih kosong — supaya tidak error membingungkan saat sudah jalan.
6. **Kirim APK > 50 MB (jalur MTProto, opsional tapi disarankan):** Bot API Telegram cuma bisa kirim dokumen maksimal 50 MB — APK release Flutter sering lebih besar dari itu. Untuk mengatasinya:
   - Buka https://my.telegram.org → API Development Tools → isi `TELEGRAM_API_ID` dan `TELEGRAM_API_HASH` di `config.js`.
   - Jalankan `npm run generate-session` sekali, login pakai nomor HP akun Telegram (bukan akun bot) yang jadi jalur kirim file besar, ikuti instruksi di layar.
   - Copy "SESSION STRING" yang muncul di akhir ke `config.js` pada `TELEGRAM_SESSION`.
   - **Penting:** akun MTProto ini terpisah dari akun bot. Supaya bisa kirim ke suatu chat, akun ini harus sudah "kenal" chat itu (jadi member grup yang sama, atau user penerima sudah pernah chat duluan ke akun ini) — ini batasan dari Telegram sendiri, bukan bug. Kalau file di bawah 50 MB, bot tetap pakai Bot API biasa seperti sebelumnya, MTProto cuma dipakai kalau memang perlu.

---

# ✦ FLUTTER & WEB2APK TELEGRAM BUILD BOT v5.0.0 ✦

Bot Telegram serbaguna dengan sistem build APK real berbasis cloud GitHub Actions runner, pemantauan status langsung di channel Telegram (Live Monitor), log aktivitas interaktif, dan tombol kelap-kelip neon disco.

## 🌟 Fitur Utama
- **Real APK Compilation**: Menghasilkan file APK resmi yang siap diinstall di semua tipe HP Android tanpa masalah "Gagal Mengurai Paket".
- **Live Build Monitor Channel**: Tampilan loading realtime dengan elapsed timer, persentase compile, centang hijau jika sukses, dan tanda silang merah jika gagal.
- **Log Aktivitas Channel**: Tabel info pengguna (Role, Nama, Username, ID, Aksi, Waktu WIB, Total Sukses) dikirim ke channel setiap ada klik fitur.
- **Dua Profil Runner**:
  1. *Build Biasa*: Menggunakan repo & token utama.
  2. *Build Genetik*: Menggunakan runner terpisah agar tidak mengganggu antrean biasa.
- **22+ Menu Tambahan**: Termasuk Web2APK, AI Fix Base Error, AI Code Refactor, Rename Domain/Package ID, dan Tools utilitas.
