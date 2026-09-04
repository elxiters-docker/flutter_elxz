/**
 * =========================================================================
 * KONFIGURASI BOT BUILD FLUTTER & WEB2APK
 * Isi semua nilai di bawah ini langsung di file ini (tidak pakai .env lagi).
 * PENTING: jangan pernah share/upload file ini ke publik/orang lain setelah
 * diisi token asli — kalau file ini tersebar, token di dalamnya ikut bocor
 * dan siapa pun bisa pakai bot & repo GitHub kamu.
 * =========================================================================
 */

module.exports = {
  // ==== Telegram ====
  BOT_TOKEN: '8903285716:AAFqZnHovKkko4Hjh1dAmj0C4v1w9-PONKE',                 // Token dari @BotFather
  BOT_USERNAME: 'elxzbuildbot',              // Username bot tanpa @
  ADMIN_IDS: [7571009414],                 // Contoh: ['123456789', '987654321']
  CHANNEL_ACTIVITY_ID: '-1003349859994',       // Contoh: '-1001234567890'
  CHANNEL_MONITOR_ID: '-1003349859994',        // Contoh: '-1001234567890'

  // ==========================================
  // WAJIB VERIFIKASI 3 CHANNEL (FORCE-SUB GATEWAY)
  // Kosongkan array ini (isi []) kalau tidak mau pakai gateway ini.
  // ==========================================
  REQUIRED_CHANNELS: [
    { id: '-1003349859994', name: 'Channel 1', link: 'https://t.me/informasichnlel' },
    { id: '-1003994810604', name: 'Channel 2', link: 'https://t.me/elxzchannel' },
    { id: '-1004342133156', name: 'Channel 3', link: 'https://t.me/informasipenukaranell' }
  ],

  BANNER_URL: 'https://files.catbox.moe/e1j1zy.jpg',
  OWNER_CONTACT_URL: 'https://t.me/elnicholl',

  // ==========================================
  // GITHUB ACTIONS (BUILD BIASA)
  // Token: GitHub Settings -> Developer settings -> Personal access tokens
  // Scope WAJIB: repo (full control) + workflow
  // Repo ini harus sudah punya .github/workflows/flutter_build.yml
  // di branch default-nya.
  // ==========================================
  GITHUB_OWNER: 'elxiters-docker',
  GITHUB_REPO: 'elxzflutter',
  GITHUB_TOKEN: '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',
  GITHUB_WORKFLOW_FILE: 'flutter_build.yml',

  // ==========================================
  // GITHUB ACTIONS (BUILD GENETIK) — opsional, boleh dikosongkan semua
  // ==========================================
  GENETIK_GITHUB_OWNER: 'elxiters-docker',
  GENETIK_GITHUB_REPO: 'elxzflutter',
  GENETIK_GITHUB_TOKEN: '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',
  GENETIK_GITHUB_WORKFLOW_FILE: 'flutter_build.yml',

  // Batas maksimum menunggu satu build (menit) sebelum bot lapor timeout
  BUILD_TIMEOUT_MINUTES: 45,

  // Opsional: Google Gemini API Key untuk fitur AI Fix
  GEMINI_API_KEY: '',

  // ==========================================
  // TELEGRAM MTPROTO (my.telegram.org) — WAJIB untuk kirim APK > 50 MB
  // Bot API Telegram cuma bisa kirim file maks 50 MB. Kalau APK hasil
  // build lebih besar dari itu, bot butuh akun user (MTProto) sebagai
  // jalur kirim. Ambil API_ID & API_HASH di https://my.telegram.org
  // -> API Development Tools. TELEGRAM_SESSION diisi otomatis dengan
  // menjalankan: npm run generate-session (sekali saja, login interaktif).
  //
  // CATATAN PENTING: akun MTProto ini terpisah dari akun bot. Supaya
  // bisa kirim ke suatu chat/grup, akun ini harus sudah "kenal" chat
  // itu juga (jadi member grup yang sama, atau user penerima sudah
  // pernah chat duluan ke akun ini). Kalau tidak, pengiriman akan gagal
  // dengan error "Cannot find any entity" dari Telegram.
  // ==========================================
  MTROTO_ENABLED: true,
  TELEGRAM_API_ID: 34724046,      // Angka dari my.telegram.org, contoh: 1234567
  TELEGRAM_API_HASH: '554248e6b16063ae890fbd42790e63c9',   // String dari my.telegram.org
  TELEGRAM_SESSION: ''     // Diisi otomatis oleh generate_session.js
};
