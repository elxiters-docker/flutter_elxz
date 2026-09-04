# 📘 TUTORIAL SETUP LENGKAP — Flutter Build Bot (via Panel / VPS NAT)

Panduan ini khusus untuk kamu yang menjalankan bot ini lewat **panel** (Pterodactyl atau sejenisnya) di **VPS NAT** (tanpa IP publik). Karena bot memakai *polling* (bukan webhook) untuk Telegram, dan cuma memanggil API GitHub/Telegram keluar (bukan menerima koneksi masuk), setup ini **tidak butuh IP publik atau domain sama sekali**. Cukup ikuti urutan di bawah.

---

## BAGIAN 1 — Buat Repo GitHub Khusus Builder

Repo ini fungsinya cuma nyimpen file workflow (`flutter_build.yml` & `web2apk.yml`). Setiap kali ada user build APK, bot otomatis bikin branch baru di repo ini berisi source code project mereka — jadi **jangan taruh project Flutter kamu sendiri** di branch utama repo ini.

### 1.1 Buat repository baru
1. Buka [github.com](https://github.com), login (buat akun dulu kalau belum ada).
2. Klik tombol **"+"** di kanan atas → **New repository**.
3. Isi nama, misalnya `flutter-builder-workflow`.
4. Boleh **Private** atau **Public**, bebas.
5. **JANGAN** centang "Add a README file" — biarkan repo kosong total.
6. Klik **Create repository**.
7. Catat URL repo-nya, formatnya: `https://github.com/USERNAME/flutter-builder-workflow.git`

### 1.2 Upload folder workflow (cara paling gampang — lewat browser, tanpa command line)
1. Di halaman repo yang baru dibuat, klik **"uploading an existing file"** (atau menu **Add file → Upload files**).
2. Dari folder hasil ekstrak zip bot ini, buka folder `.github/workflows/`.
3. Drag & drop kedua file: `flutter_build.yml` dan `web2apk.yml` ke halaman upload GitHub.
   - **Penting:** GitHub harus tetap mengenali strukturnya sebagai `.github/workflows/flutter_build.yml`. Cara paling aman: drag folder `.github` itu sendiri (bukan cuma file .yml-nya) ke kotak upload — browser modern (Chrome/Edge) akan mempertahankan struktur foldernya otomatis.
4. Scroll ke bawah, isi commit message (misal "add workflow"), klik **Commit changes**.

### 1.2b Alternatif — lewat command line (kalau familiar dengan git)
```bash
mkdir builder-repo && cd builder-repo
git init
git remote add origin https://github.com/USERNAME/flutter-builder-workflow.git
# copy folder .github dari hasil ekstrak zip bot ke folder ini
git add .github
git commit -m "add workflow"
git branch -M main
git push -u origin main
```
Saat diminta login, pakai username GitHub + **Personal Access Token** (bukan password akun) sebagai password — token dibuat di Bagian 2.

### 1.3 Pastikan Actions aktif & workflow muncul
1. Buka tab **Actions** di repo tersebut.
2. Harus muncul 2 workflow: **"Flutter Auto Build APK (Release & Debug)"** dan **"Web to APK Builder"**.
3. Kalau ada peringatan Actions belum aktif: **Settings → Actions → General → Allow all actions and reusable workflows → Save**.

---

## BAGIAN 2 — Buat Personal Access Token (PAT)

1. Buka **github.com → foto profil (kanan atas) → Settings**.
2. Scroll ke bawah kiri → **Developer settings**.
3. **Personal access tokens → Tokens (classic) → Generate new token (classic)**.
4. Beri nama (misal "flutter-build-bot").
5. Centang scope **`repo`** (full control) dan **`workflow`**.
6. Klik **Generate token**, lalu **copy token-nya sekarang juga** (formatnya `ghp_xxxxxxxxxxxx`) — token cuma ditampilkan sekali, kalau kelewat harus generate ulang.

---

## BAGIAN 3 — Isi `config.js`

Buka `config.js` di project bot, isi bagian ini:

```js
GITHUB_OWNER: 'USERNAME_GITHUB_KAMU',
GITHUB_REPO: 'flutter-builder-workflow',
GITHUB_TOKEN: 'ghp_xxxxxxxxxxxx',   // token dari Bagian 2
```

Isi juga `BOT_TOKEN` (dari @BotFather Telegram) dan field lain sesuai kebutuhan (channel ID, admin ID, dst — semua ada penjelasannya sebagai komentar di dalam `config.js`).

**Jangan pernah upload `config.js` yang sudah terisi token asli ke tempat publik** (repo publik, grup, dijual lagi sebagai SC, dll) — siapa pun yang punya isi file itu bisa pakai token kamu.

---

## BAGIAN 4 — (Opsional tapi disarankan) Setup MTProto untuk APK > 50 MB

Bot API Telegram cuma bisa kirim file maksimal 50 MB. APK release Flutter sering lebih besar. Supaya tetap bisa terkirim otomatis:

1. Buka [my.telegram.org](https://my.telegram.org) → login pakai nomor HP → **API Development Tools**.
2. Isi form (nama app bebas), submit → kamu dapat **api_id** dan **api_hash**.
3. Isi ke `config.js`:
   ```js
   TELEGRAM_API_ID: 1234567,        // ganti dengan api_id kamu
   TELEGRAM_API_HASH: 'xxxxxxxx',   // ganti dengan api_hash kamu
   ```
4. Di panel/terminal, jalankan sekali: `npm run generate-session`
5. Ikuti instruksi: masukkan nomor HP akun Telegram (boleh akun pribadi kamu, terpisah dari akun bot), kode OTP, password 2FA kalau ada.
6. Copy "SESSION STRING" yang muncul di akhir, tempel ke `config.js` pada `TELEGRAM_SESSION`.
7. **Penting:** akun ini harus "kenal" chat/grup tempat bot dipakai — masukkan akun tsb ke grup yang sama dengan bot, atau pastikan user penerima sudah pernah chat duluan ke akun ini.

---

## BAGIAN 5 — Jalankan di Panel (VPS NAT)

Karena bot pakai *polling*, tidak perlu buka port apa pun di panel/firewall — cukup pastikan proses Node.js-nya nyala terus.

1. Upload/extract seluruh isi zip ini ke folder project di panel.
2. Startup command di panel: `npm install && npm start` (atau kalau panel punya field terpisah: Install command `npm install`, Start command `node index.js`).
3. Pastikan environment panel menyediakan **git** (binary `git` harus ada di container/VPS panel-nya) — bot butuh ini untuk push source code user ke GitHub. Kalau panel berbasis Docker/LXC, biasanya perlu ditambahkan lewat Dockerfile/egg panel (`apt install git` atau setara).
4. Start service dari panel.
5. Cek log/console panel — kalau ada field `config.js` yang masih kosong, bot akan langsung berhenti dan kasih tahu field mana yang kurang.

---

## BAGIAN 6 — Tes

1. Chat bot di Telegram → **Build APK** → kirim ZIP project Flutter kecil yang jelas bisa dikompilasi.
2. Buka tab **Actions** di repo builder GitHub → harus muncul branch baru `build-<userId>-<timestamp>` dan job sedang berjalan.
3. Tunggu sampai selesai (progres real-time terlihat di chat & channel monitor).
4. Kalau sukses → APK otomatis terkirim ke chat. Kalau gagal → bot kasih link log GitHub Actions yang sebenarnya untuk kamu telusuri errornya.

---

Kalau ada langkah yang error, kirim screenshot/teks error persis yang muncul (dari Telegram, log panel, atau tab Actions GitHub), biar bisa ditelusuri di baris mana masalahnya.
