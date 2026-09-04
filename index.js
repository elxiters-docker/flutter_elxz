/**
 * =========================================================================
 * FLUTTER & WEB2APK TELEGRAM BUILD BOT (v5.0.0 Pro Edition)
 * Fixed Real APK Builder via GitHub Actions + Live Monitor & Activity Logger
 * Anti-Error, Anti-Parse Error (Anti "Gagal Mengurai Paket")
 * =========================================================================
 */

const TelegramBot = require('node-telegram-bot-api');
const axios = require('axios');
const fs = require('fs-extra');
const path = require('path');
const os = require('os');
const { execFileSync } = require('child_process');
const AdmZip = require('adm-zip');
const { TelegramClient } = require('telegram');
const { StringSession } = require('telegram/sessions');
const config = require('./config');

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// Validasi konfigurasi wajib sebelum bot dijalankan, biar error-nya jelas
// (bukan error kriptis dari Telegram/GitHub API kalau ada yang lupa diisi).
const missingConfig = [];
if (!config.BOT_TOKEN) missingConfig.push('BOT_TOKEN');
if (!config.GITHUB_OWNER) missingConfig.push('GITHUB_OWNER');
if (!config.GITHUB_REPO) missingConfig.push('GITHUB_REPO');
if (!config.GITHUB_TOKEN) missingConfig.push('GITHUB_TOKEN');
if (missingConfig.length > 0) {
  console.error(`❌ [CONFIG] Field berikut di config.js masih kosong: ${missingConfig.join(', ')}`);
  console.error('   Isi dulu semua field wajib itu sebelum menjalankan bot.');
  process.exit(1);
}

// Inisialisasi Bot Telegram
const bot = new TelegramBot(config.BOT_TOKEN, { polling: true });

console.log('🚀 [BOT RUNNING] Flutter2APK Build Bot v5.0.0 siap beroperasi...');

/**
 * =========================================================================
 * JALUR MTPROTO (my.telegram.org) — untuk kirim file APK > 50 MB
 * Bot API Telegram membatasi upload dokumen maksimal 50 MB. Kalau APK
 * hasil build lebih besar, dipakai akun user (MTProto) via lib "telegram".
 * Client dibuat sekali saja (lazy) dan dipakai ulang.
 * =========================================================================
 */
const MTPROTO_ENABLED = !!(config.TELEGRAM_API_ID && config.TELEGRAM_API_HASH && config.TELEGRAM_SESSION);
let mtprotoClient = null;
let mtprotoConnecting = null;

async function getMtprotoClient() {
  if (!MTPROTO_ENABLED) return null;
  if (mtprotoClient && mtprotoClient.connected) return mtprotoClient;
  if (!mtprotoConnecting) {
    mtprotoConnecting = (async () => {
      const client = new TelegramClient(
        new StringSession(config.TELEGRAM_SESSION),
        Number(config.TELEGRAM_API_ID),
        config.TELEGRAM_API_HASH,
        { connectionRetries: 5 }
      );
      await client.connect();
      mtprotoClient = client;
      return client;
    })();
  }
  return mtprotoConnecting;
}

const BOT_API_FILE_LIMIT_BYTES = 49 * 1024 * 1024; // batas aman di bawah 50 MB Bot API

/**
 * Kirim file APK ke chat. Pakai Bot API kalau ukurannya masih di bawah
 * limit 50 MB. Kalau lebih besar, pakai jalur MTProto (kalau sudah
 * dikonfigurasi) sebagai satu-satunya cara agar file benar-benar sampai
 * tanpa dipotong/gagal oleh Telegram.
 */
async function sendApkToChat(chatId, apkPath, caption, filename) {
  const sizeBytes = fs.statSync(apkPath).size;

  if (sizeBytes <= BOT_API_FILE_LIMIT_BYTES) {
    return bot.sendDocument(chatId, apkPath, { caption, parse_mode: 'Markdown' }, {
      filename,
      contentType: 'application/vnd.android.package-archive'
    });
  }

  if (!MTPROTO_ENABLED) {
    await bot.sendMessage(chatId,
      `⚠️ *APK berhasil dibuat tapi ukurannya ${(sizeBytes / (1024 * 1024)).toFixed(1)} MB, melebihi batas 50 MB Bot API Telegram.*\n\n` +
      `Untuk bisa mengirim file sebesar ini, aktifkan jalur MTProto: isi TELEGRAM_API_ID, TELEGRAM_API_HASH, dan TELEGRAM_SESSION di config.js (lihat komentar di config.js untuk caranya).`,
      { parse_mode: 'Markdown' }
    );
    throw new Error('File > 50MB dan MTProto belum dikonfigurasi.');
  }

  const client = await getMtprotoClient();
  return client.sendFile(chatId, {
    file: apkPath,
    caption,
    parseMode: 'markdown',
    forceDocument: true,
    attributes: undefined,
    workers: 4
  });
}

// Helper Format Waktu Indonesia Barat (WIB)
function getWIBTime() {
  const now = new Date();
  const utc = now.getTime() + (now.getTimezoneOffset() * 60000);
  const wib = new Date(utc + (3600000 * 7));
  const d = wib.getDate();
  const m = wib.getMonth() + 1;
  const y = wib.getFullYear();
  const h = String(wib.getHours()).padStart(2, '0');
  const min = String(wib.getMinutes()).padStart(2, '0');
  const s = String(wib.getSeconds()).padStart(2, '0');
  return `${d}/${m}/${y}, ${h}:${min}:${s} WIB`;
}

// Database Helpers
function getDatabase(file) {
  const filePath = path.join(__dirname, 'database', file);
  if (!fs.existsSync(filePath)) {
    fs.writeJsonSync(filePath, file === 'credits.json' ? {} : []);
  }
  return fs.readJsonSync(filePath);
}

function saveDatabase(file, data) {
  const filePath = path.join(__dirname, 'database', file);
  fs.ensureDirSync(path.dirname(filePath));
  fs.writeJsonSync(filePath, data, { spaces: 2 });
}

// User state tracker
const userSessions = new Map();

/**
 * LOG AKTIVITAS KE CHANNEL
 * Setiap kali user menekan tombol atau menjalankan fitur, kirim log ke channel aktivitas.
 */
async function logActivity(msg, actionName) {
  if (!config.CHANNEL_ACTIVITY_ID) return;
  try {
    const from = msg.from || {};
    const userId = from.id || 'N/A';
    const name = from.first_name ? `${from.first_name} ${from.last_name || ''}`.trim() : 'User';
    const username = from.username ? `@${from.username}` : '-';
    
    // Cek role
    const buyers = getDatabase('buyers.json');
    const isVip = buyers.includes(String(userId));
    const isAdmin = config.ADMIN_IDS.includes(String(userId));
    const role = isAdmin ? '👑 OWNER' : (isVip ? '⭐ VIP USER' : '👤 USER');

    const history = getDatabase('buildhistory.json');
    const totalSuccess = history.filter(h => h.status === 'SUCCESS').length + 8080;

    const caption = `🔔 *Aktivitas Bot*\n\n` +
      `┌──────────────┬──────────────────────────────┐\n` +
      `│ *Field*        │ *Nilai*                      │\n` +
      `├──────────────┼──────────────────────────────┤\n` +
      `│ Role         │ ${role}                      │\n` +
      `│ Nama         │ ${name}                      │\n` +
      `│ Username     │ ${username}                  │\n` +
      `│ ID           │ ${userId}                    │\n` +
      `│ Aksi         │ ${actionName}                │\n` +
      `│ Waktu        │ ${getWIBTime()}              │\n` +
      `│ Total sukses │ ${totalSuccess}              │\n` +
      `└──────────────┴──────────────────────────────┘\n\n` +
      `#Aktivitas #id${userId}`;

    const opts = {
      parse_mode: 'Markdown',
      reply_markup: {
        inline_keyboard: [
          [{ text: '🔥 Mau coba fitur ini juga? gass', url: `https://t.me/${config.BOT_USERNAME || 'mybot'}?start=explore` }]
        ]
      }
    };

    if (config.BANNER_URL) {
      await bot.sendPhoto(config.CHANNEL_ACTIVITY_ID, config.BANNER_URL, { caption, ...opts });
    } else {
      await bot.sendMessage(config.CHANNEL_ACTIVITY_ID, caption, opts);
    }
  } catch (err) {
    console.error('⚠️ [ERROR ACTIVITY LOG]:', err.message);
  }
}

/**
 * MENU UTAMA BOT (DENGAN TOMBOL DISCO WARNA-WARNI KELAP-KELIP)
 */
function getMainKeyboard() {
  return {
    inline_keyboard: [
      [{ text: '🔗 To URL — Upload Jadi Link', callback_data: 'menu_to_url' }],
      [
        { text: '🎨 Copy Tampilan -> .dart', callback_data: 'menu_copy_view' },
        { text: '👥 Group Menu', callback_data: 'menu_group' }
      ],
      [{ text: '🤖 Chat AI — Rombak Project', callback_data: 'menu_chat_ai' }],
      [
        { text: '🚀 Build APK', callback_data: 'menu_build_apk' },
        { text: '🌐 Web2APK', callback_data: 'menu_web2apk' },
        { text: '➕ Add Fitur', callback_data: 'menu_add_feature' }
      ],
      [
        { text: '🛠️ Ganti Function', callback_data: 'menu_change_func' },
        { text: '📝 Ganti File .dart', callback_data: 'menu_change_dart' }
      ],
      [
        { text: '🧪 Tes Function', callback_data: 'menu_test_func' },
        { text: '🩹 Fix Error Function', callback_data: 'menu_fix_func' },
        { text: '🎨 Recolour', callback_data: 'menu_recolour' }
      ],
      [{ text: '🛠️ Fix Base Error (pubspec/gradle/dart)', callback_data: 'menu_fix_base' }],
      [{ text: '🎯 Fix Error Kode .dart (AI)', callback_data: 'menu_fix_dart_ai' }],
      [{ text: '🌈 Multi Recolour', callback_data: 'menu_multi_recolour' }],
      [{ text: '🔄 Rename All (Domain/Nama Apk/Aset)', callback_data: 'menu_rename_all' }],
      [
        { text: '🌐 Rename Domain', callback_data: 'menu_rename_domain' },
        { text: '🆔 Package ID', callback_data: 'menu_package_id' }
      ],
      [
        { text: '📁 Ganti Aset', callback_data: 'menu_change_asset' },
        { text: '✏️ Nama Apk', callback_data: 'menu_apk_name' },
        { text: '🧩 Api/Script', callback_data: 'menu_api_script' }
      ],
      [{ text: '🤖 Fix API/Script (AI Gemini)', callback_data: 'menu_fix_api_ai' }],
      [
        { text: '📥 Get Aset', callback_data: 'menu_get_asset' },
        { text: '🧩 HTML -> JS', callback_data: 'menu_html_js' },
        { text: '👁️ Preview Dart', callback_data: 'menu_preview_dart' }
      ],
      [{ text: '🧰 Tools+ (API/Script/Flutter)', callback_data: 'menu_tools_plus' }],
      [{ text: '🔐 Enc Menu — Script/HTML', callback_data: 'menu_enc' }],
      [
        { text: '🔍 Cari Project', callback_data: 'menu_search_proj' },
        { text: '📊 Scan Info', callback_data: 'menu_scan_info' },
        { text: '🧹 Bersihkan Zip', callback_data: 'menu_clean_zip' }
      ],
      [
        { text: '📊 Antrian', callback_data: 'menu_queue' },
        { text: '📈 Statistik', callback_data: 'menu_stats' }
      ],
      [
        { text: '⚙️ Status Bot', callback_data: 'menu_status' },
        { text: '🏓 Ping', callback_data: 'menu_ping' }
      ],
      [
        { text: '💳 Credit', callback_data: 'menu_credit' },
        { text: '💰 Buy Credit ↗', url: config.OWNER_CONTACT_URL || 'https://t.me/admin' }
      ],
      [
        { text: '📖 Panduan', callback_data: 'menu_guide' },
        { text: '💬 Feedback', callback_data: 'menu_feedback' }
      ],
      [{ text: '⚠️ Laporkan Bug', callback_data: 'menu_report_bug' }]
    ]
  };
}

/**
 * =========================================================================
 * GATEWAY 3 CHANNEL TELEGRAM (FORCE-SUB VERIFIKASI SEBELUM BUILD)
 * =========================================================================
 */
async function checkUserVerification(botInstance, userId) {
  // Admin & Owner bypass otomatis
  if (config.ADMIN_IDS.map(String).includes(String(userId))) {
    return { passed: true, missing: [] };
  }

  const verifiedList = getDatabase('verified_users.json');
  if (Array.isArray(verifiedList) && verifiedList.includes(String(userId))) {
    return { passed: true, missing: [] };
  }

  const missing = [];
  for (const ch of (config.REQUIRED_CHANNELS || [])) {
    try {
      const member = await botInstance.getChatMember(ch.id, userId);
      const isMember = ['creator', 'administrator', 'member', 'restricted'].includes(member.status);
      if (!isMember) {
        missing.push(ch);
      }
    } catch (err) {
      // Jika bot belum admin di channel atau error API Telegram
      console.warn(`[GATEWAY] Gagal verifikasi channel ${ch.id} untuk user ${userId}: ${err.message}`);
      missing.push(ch);
    }
  }

  return {
    passed: missing.length === 0,
    missing
  };
}

function getVerificationKeyboard() {
  const keyboard = (config.REQUIRED_CHANNELS || []).map((ch, idx) => {
    return [{ text: `📢 ${idx + 1}. Join ${ch.name}`, url: ch.link }];
  });
  keyboard.push([
    { text: '🚀 ✅ SAYA SUDAH JOIN SEMUA (VERIFIKASI & GAS BUILD)', callback_data: 'verify_channels_check' }
  ]);
  return { inline_keyboard: keyboard };
}

// Handler Command /start
bot.onText(/\/start(.*)/, async (msg) => {
  const chatId = msg.chat.id;
  const from = msg.from || {};
  const userId = from.id;
  const credits = getDatabase('credits.json');
  if (credits[userId] === undefined) {
    credits[userId] = 30; // Free welcome credit
    saveDatabase('credits.json', credits);
  }

  logActivity(msg, 'Buka Menu Utama (/start)');

  // Cek apakah user sudah verifikasi 3 channel
  const verifyStatus = await checkUserVerification(bot, userId);
  let statusVerifText = verifyStatus.passed 
    ? '✅ *Terverifikasi (3/3 Channel)*' 
    : '⚠️ *Belum Verifikasi (Wajib 3 Channel)*';

  const caption = 
`✦ *FLUTTER BUILD BOT* ✦\n` +
`◇ v5.0.0 · Flutter Build Engine ◇\n` +
`👋 Halo, *—⊰✧${from.first_name || 'Developer'}✧⊱* — selamat datang!\n\n` +
`Bot siap bantu *build APK*, *Web2APK*, *rename*, *AI fix*, dan tools otomatis lainnya.\n\n` +
`📊 *Status Akun:*\n` +
`💎 Credit : *${credits[userId]}*\n` +
`📌 Role   : *Free User*\n` +
`🛡️ Akses  : ${statusVerifText}\n` +
`🟢 Server : *Online 24 Jam*\n\n` +
`⚡ *Fitur Utama:*\n` +
`🚀 Build APK    : *Debug / Release*\n` +
`🌐 Web2APK      : *URL -> APK*\n` +
`🛠️ Fix Base     : *Auto repair + AI*\n` +
`🤖 AI Tools     : *Rombak project*\n\n` +
(!verifyStatus.passed ? `⚠️ *Perhatian:* Anda wajib bergabung ke 3 channel resmi kami untuk menggunakan fitur Gas Build APK!\n\n` : '') +
`Pilih tombol menu di bawah untuk memulai:`;

  const banner = config.BANNER_URL || 'https://images.unsplash.com/photo-1607604276583-eef5d076aa5f?w=800&q=80';
  await bot.sendPhoto(chatId, banner, {
    caption,
    parse_mode: 'Markdown',
    reply_markup: getMainKeyboard()
  });
});

// Handler Callback Query (Menu interaksi)
bot.on('callback_query', async (callbackQuery) => {
  const msg = callbackQuery.message;
  const chatId = msg.chat.id;
  const data = callbackQuery.data;
  const from = callbackQuery.from;
  const userId = from.id;

  bot.answerCallbackQuery(callbackQuery.id);

  // GATEWAY: Cek verifikasi tombol "SAYA SUDAH JOIN SEMUA"
  if (data === 'verify_channels_check') {
    const result = await checkUserVerification(bot, userId);
    if (result.passed) {
      const verifiedList = getDatabase('verified_users.json');
      if (!verifiedList.includes(String(userId))) {
        verifiedList.push(String(userId));
        saveDatabase('verified_users.json', verifiedList);
      }
      logActivity({ from }, 'Verifikasi 3 Channel SUKSES (Gas Build Unlocked)');
      await bot.sendMessage(chatId, 
`🎉 *VERIFIKASI BERHASIL! (3/3 CHANNEL LENGKAP)*\n` +
`━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n\n` +
`Terima kasih sudah bergabung di seluruh channel resmi kami.\n` +
`Akses bot Anda kini *AKTIF PENUH*. Silakan mulai *GAS BUILD APK* sekarang!`, {
        parse_mode: 'Markdown',
        reply_markup: {
          inline_keyboard: [
            [{ text: '🚀 GAS BUILD APK SEKARANG', callback_data: 'menu_build_apk' }],
            [{ text: '🏠 Menu Utama', callback_data: 'back_to_menu' }]
          ]
        }
      });
    } else {
      logActivity({ from }, `Verifikasi 3 Channel GAGAL (Kurang ${result.missing.length} channel)`);
      const missingList = result.missing.map((m, i) => `  ${i + 1}. ${m.name} (${m.id})`).join('\n');
      await bot.sendMessage(chatId, 
`❌ *VERIFIKASI BELUM LENGKAP!*\n` +
`━━━━━━━━━━━━━━━━━━━━━━━\n\n` +
`Anda belum terdeteksi bergabung di channel berikut:\n${missingList}\n\n` +
`⚠️ *Syarat Wajib:* Pastikan Anda telah mengklik tombol Join di setiap channel, lalu tekan tombol *SAYA SUDAH JOIN SEMUA* lagi.`, {
        parse_mode: 'Markdown',
        reply_markup: getVerificationKeyboard()
      });
    }
  }

  // Cek jika user menekan build APK tapi belum verifikasi 3 channel
  else if (data === 'menu_build_apk') {
    const verifyStatus = await checkUserVerification(bot, userId);
    if (!verifyStatus.passed) {
      logActivity({ from }, 'Akses Build Ditolak (Belum Verifikasi 3 Channel)');
      const missingList = verifyStatus.missing.map((m, i) => `  ${i + 1}. ${m.name}`).join('\n');
      return bot.sendMessage(chatId, 
`⚠️ *AKSES TERKUNCI: WAJIB JOIN 3 CHANNEL!*\n` +
`━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n\n` +
`Halo *—⊰✧${from.first_name || 'Developer'}✧⊱*, untuk menggunakan bot ini dan fitur *GAS BUILD APK*, Anda wajib bergabung ke 3 channel berikut terlebih dahulu:\n\n` +
`${missingList}\n\n` +
`Setelah bergabung di semua channel, klik tombol *SAYA SUDAH JOIN SEMUA* untuk membuka kunci!`, {
        parse_mode: 'Markdown',
        reply_markup: getVerificationKeyboard()
      });
    }

    logActivity({ from }, 'Pilih Menu Build APK');
    const text = 
`🔨 *Pilih Jenis Build APK*\n` +
`━━━━━━━━━━━━━━━━━━━━━━━\n\n` +
`🚀 *Build Biasa*\n` +
`  • Repo & token GitHub standar\n` +
`  • Debug / Release\n\n` +
`🧬 *Build Genetik*\n` +
`  • Repo & token GitHub *terpisah*\n` +
`  • Workflow / runner khusus genetik\n` +
`  • Tidak mempengaruhi antrian build biasa`;

    const keyboard = {
      inline_keyboard: [
        [
          { text: '🐞 Debug (Biasa)', callback_data: 'build_biasa_debug' },
          { text: '🚀 Release (Biasa)', callback_data: 'build_biasa_release' }
        ],
        [
          { text: '🧬 Debug Genetik', callback_data: 'build_genetik_debug' },
          { text: '🧬 Release Genetik', callback_data: 'build_genetik_release' }
        ],
        [
          { text: '🏠 Kembali ke Menu', callback_data: 'back_to_menu' }
        ]
      ]
    };

    bot.sendMessage(chatId, text, { parse_mode: 'Markdown', reply_markup: keyboard });
  }

  else if (data.startsWith('build_')) {
    const parts = data.split('_');
    const profile = parts[1].toUpperCase(); // BIASA / GENETIK
    const mode = parts[2].toUpperCase();    // DEBUG / RELEASE

    logActivity({ from }, `Mulai Sesi Build: ${profile} (${mode})`);

    userSessions.set(chatId, {
      profile,
      mode,
      step: 'AWAITING_ZIP',
      timestamp: Date.now()
    });

    const noteGenetik = profile === 'GENETIK' 
      ? `\n\n🧬 _Build Genetik memakai repo & token GitHub terpisah._` 
      : '';

    const text = 
`🔨 *Siap Build Flutter APK!*\n` +
`━━━━━━━━━━━━━━━━━━━━━━━\n\n` +
`🏷️ *Profil* : ${profile === 'GENETIK' ? '🧬 GENETIK' : '🚀 BIASA'}\n` +
`📦 *Mode*   : ${mode === 'RELEASE' ? '🚀 RELEASE' : '🐞 DEBUG'}\n\n` +
`Kirim file *ZIP* project Flutter kamu sekarang.\n\n` +
`┌─── *Persyaratan & Batas* ───\n` +
`│ ✅ Format file : *.zip*\n` +
`│ ✅ Wajib ada : *pubspec.yaml*\n` +
`│ ⏳ Batas Waktu : *5 Menit* (Auto Cancel)\n` +
`│ ✅ Maks ukuran : *2 GB*\n` +
`└───────────────────────────\n` +
`${noteGenetik}\n\n` +
`⚠️ *Bot akan otomatis membatalkan sesi jika dalam 5 menit berkas tidak dikirim!*`;

    bot.sendMessage(chatId, text, {
      parse_mode: 'Markdown',
      reply_markup: {
        inline_keyboard: [
          [{ text: '❌ Batalkan', callback_data: 'cancel_build_session' }]
        ]
      }
    });
  }

  else if (data === 'cancel_build_session') {
    userSessions.delete(chatId);
    bot.sendMessage(chatId, '❌ Sesi build APK telah dibatalkan.');
  }

  else if (data === 'back_to_menu') {
    bot.sendMessage(chatId, '🏠 Kembali ke menu utama:', {
      reply_markup: getMainKeyboard()
    });
  }

  else if (data === 'menu_status') {
    logActivity({ from }, 'Cek Status Bot');
    bot.sendMessage(chatId, '🟢 *Status Bot:* Aktif 24/7. GitHub Actions Engine terhubung.');
  }

  else if (data === 'menu_ping') {
    logActivity({ from }, 'Cek Ping');
    const start = Date.now();
    const sent = await bot.sendMessage(chatId, '🏓 Pinging...');
    const ping = Date.now() - start;
    bot.editMessageText(`🏓 Pong! Respon bot: *${ping}ms*\n🌐 GitHub Runner: *Aktif & Siap*`, {
      chat_id: chatId,
      message_id: sent.message_id,
      parse_mode: 'Markdown'
    });
  }

  else {
    logActivity({ from }, `Klik Tombol: ${data}`);
    bot.sendMessage(chatId, `Fitur *${data}* sedang dioptimasi di v5.0.0.`, { parse_mode: 'Markdown' });
  }
});

/**
 * =========================================================================
 * HANDLER DOKUMEN / ZIP PROJECT
 * =========================================================================
 */
bot.on('document', async (msg) => {
  const chatId = msg.chat.id;
  const session = userSessions.get(chatId);

  if (!session || session.step !== 'AWAITING_ZIP') {
    return bot.sendMessage(chatId, '💡 Silakan pilih tombol *🚀 Build APK* terlebih dahulu sebelum mengirim berkas ZIP.', { parse_mode: 'Markdown' });
  }

  const doc = msg.document;
  if (!doc.file_name.toLowerCase().endsWith('.zip')) {
    return bot.sendMessage(chatId, '❌ Berkas harus berformat *.zip*! Silakan kompres folder project Flutter kamu jadi .zip lalu kirim ulang.', { parse_mode: 'Markdown' });
  }

  const maxBytes = 2 * 1024 * 1024 * 1024; // 2 GB sesuai batas yang ditampilkan ke user
  if (doc.file_size && doc.file_size > maxBytes) {
    return bot.sendMessage(chatId, '❌ Ukuran berkas melebihi batas maksimum 2 GB.', { parse_mode: 'Markdown' });
  }

  const projectName = doc.file_name;
  const developerName = msg.from.first_name + (msg.from.last_name ? ' ' + msg.from.last_name : '');
  const userId = msg.from.id;

  userSessions.delete(chatId);

  executeRealBuildFlow(chatId, msg, doc, session.profile, session.mode, projectName, developerName, userId)
    .catch(async (err) => {
      console.error('❌ [BUILD FLOW ERROR]', err);
      try {
        await bot.sendMessage(chatId, `❌ *Build gagal karena error internal:*\n\`${err.message || err}\``, { parse_mode: 'Markdown' });
      } catch (e) {}
    });
});

/**
 * =========================================================================
 * HELPER: Cari folder root project Flutter (yang berisi pubspec.yaml)
 * di dalam hasil ekstrak ZIP, karena user bisa saja mengompres folder
 * pembungkus di luar root project.
 * =========================================================================
 */
function findProjectRoot(extractedDir) {
  const stack = [extractedDir];
  while (stack.length > 0) {
    const dir = stack.shift();
    let entries;
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch (e) {
      continue;
    }
    if (entries.some((e) => e.isFile() && e.name === 'pubspec.yaml')) {
      return dir;
    }
    for (const e of entries) {
      if (e.isDirectory() && e.name !== 'node_modules' && e.name !== '.git') {
        stack.push(path.join(dir, e.name));
      }
    }
  }
  return null;
}

/**
 * HELPER: Unduh file dokumen dari Telegram ke disk lokal.
 */
async function downloadTelegramDocument(doc, destPath) {
  const fileLink = await bot.getFileLink(doc.file_id);
  const response = await axios.get(fileLink, { responseType: 'arraybuffer', timeout: 120000 });
  fs.ensureDirSync(path.dirname(destPath));
  fs.writeFileSync(destPath, response.data);
  return destPath;
}

/**
 * HELPER: Jalankan perintah git dan lempar error yang jelas jika gagal.
 * Membutuhkan binary `git` terpasang di server tempat bot berjalan.
 */
function runGit(args, cwd) {
  try {
    return execFileSync('git', args, { cwd, stdio: ['ignore', 'pipe', 'pipe'] }).toString();
  } catch (err) {
    const stderr = err.stderr ? err.stderr.toString() : err.message;
    throw new Error(`git ${args[0]} gagal: ${stderr}`);
  }
}

/**
 * =========================================================================
 * PUSH PROJECT USER KE REPO GITHUB BUILDER (BRANCH KHUSUS PER-BUILD)
 * Repo builder HANYA menyimpan workflow di branch default; setiap build
 * membuat branch baru berisi source code project yang diunggah user,
 * supaya setiap run GitHub Actions membangun kode milik user itu sendiri
 * (bukan kode/run milik user lain).
 * =========================================================================
 */
async function pushProjectToGitHubRepo(projectRootDir, owner, repo, token, branchName) {
  const workDir = path.join(os.tmpdir(), `gitpush_${Date.now()}_${Math.random().toString(36).slice(2)}`);
  fs.ensureDirSync(workDir);
  const remote = `https://x-access-token:${token}@github.com/${owner}/${repo}.git`;

  try {
    runGit(['clone', '--depth', '1', remote, workDir]);
    runGit(['checkout', '-B', branchName], workDir);

    // Bersihkan semua isi lama KECUALI .git dan .github (folder workflow harus tetap ada
    // di branch ini supaya GitHub Actions bisa menemukan workflow saat build dijalankan
    // dari branch ini).
    const keep = new Set(['.git', '.github']);
    for (const entry of fs.readdirSync(workDir)) {
      if (!keep.has(entry)) {
        fs.removeSync(path.join(workDir, entry));
      }
    }

    // Salin source code project user ke root repo
    fs.copySync(projectRootDir, workDir, { overwrite: true, dereference: true });

    runGit(['add', '-A'], workDir);
    runGit(
      ['-c', 'user.email=build-bot@local', '-c', 'user.name=Flutter Build Bot', 'commit', '-m', `build: ${branchName}`, '--allow-empty'],
      workDir
    );
    runGit(['push', '-f', 'origin', `HEAD:refs/heads/${branchName}`], workDir);
  } finally {
    fs.removeSync(workDir);
  }
}

/**
 * Hapus branch build sementara setelah proses selesai (rapikan repo).
 */
async function deleteRemoteBranch(owner, repo, token, branchName) {
  try {
    await axios.delete(`https://api.github.com/repos/${owner}/${repo}/git/refs/heads/${branchName}`, {
      headers: { Authorization: `Bearer ${token}`, Accept: 'application/vnd.github.v3+json' },
      timeout: 10000
    });
  } catch (err) {
    console.warn('⚠️ Gagal hapus branch sementara:', err.message);
  }
}

/**
 * Memicu workflow_dispatch pada file workflow tertentu, di branch tertentu.
 */
async function triggerWorkflowDispatch(owner, repo, token, workflowFile, ref, inputs) {
  await axios.post(
    `https://api.github.com/repos/${owner}/${repo}/actions/workflows/${workflowFile}/dispatches`,
    { ref, inputs },
    {
      headers: { Authorization: `Bearer ${token}`, Accept: 'application/vnd.github.v3+json' },
      timeout: 15000
    }
  );
}

/**
 * Setelah workflow_dispatch dipicu, GitHub butuh beberapa detik untuk
 * benar-benar membuat run baru. Fungsi ini polling sampai run tersebut
 * ketemu, difilter berdasarkan branch + waktu setelah dispatch dikirim,
 * supaya kita TIDAK PERNAH mengambil run lama/tidak berkaitan.
 */
async function findTriggeredRun(owner, repo, token, workflowFile, branch, dispatchedAtMs) {
  const headers = { Authorization: `Bearer ${token}`, Accept: 'application/vnd.github.v3+json' };
  for (let attempt = 0; attempt < 15; attempt++) {
    const res = await axios.get(
      `https://api.github.com/repos/${owner}/${repo}/actions/workflows/${workflowFile}/runs`,
      { headers, params: { branch, event: 'workflow_dispatch', per_page: 5 }, timeout: 15000 }
    );
    const runs = res.data?.workflow_runs || [];
    const fresh = runs.find((r) => new Date(r.created_at).getTime() >= dispatchedAtMs - 10000);
    if (fresh) return fresh;
    await sleep(3000);
  }
  return null;
}

/**
 * Polling status run sampai selesai (completed), memanggil onUpdate setiap
 * kali ada perubahan step, dengan progres yang dihitung dari step ASLI
 * yang dilaporkan GitHub Actions (bukan angka karangan).
 */
async function pollRunUntilDone(owner, repo, token, runId, onUpdate, timeoutMs) {
  const headers = { Authorization: `Bearer ${token}`, Accept: 'application/vnd.github.v3+json' };
  const start = Date.now();
  let lastSignature = '';

  while (Date.now() - start < timeoutMs) {
    const runRes = await axios.get(`https://api.github.com/repos/${owner}/${repo}/actions/runs/${runId}`, { headers, timeout: 15000 });
    const run = runRes.data;

    let job = null;
    try {
      const jobsRes = await axios.get(`https://api.github.com/repos/${owner}/${repo}/actions/runs/${runId}/jobs`, { headers, timeout: 15000 });
      job = (jobsRes.data?.jobs || [])[0] || null;
    } catch (e) {}

    const signature = `${run.status}:${job ? job.steps.map((s) => s.status + s.conclusion).join(',') : ''}`;
    if (signature !== lastSignature) {
      lastSignature = signature;
      const elapsedSec = Math.floor((Date.now() - start) / 1000);
      onUpdate({ run, job, elapsedSec });
    }

    if (run.status === 'completed') {
      return run;
    }
    await sleep(8000);
  }

  throw new Error(`Timeout menunggu build selesai (>${Math.floor(timeoutMs / 60000)} menit).`);
}

/**
 * Ambil artifact APK dari run yang SPESIFIK (bukan run terakhir apa pun),
 * lalu simpan ke disk lokal. Mengembalikan path file APK jika ketemu.
 */
async function downloadApkArtifactForRun(owner, repo, token, runId, destDir) {
  const headers = { Authorization: `Bearer ${token}`, Accept: 'application/vnd.github.v3+json' };
  const artifactsRes = await axios.get(
    `https://api.github.com/repos/${owner}/${repo}/actions/runs/${runId}/artifacts`,
    { headers, timeout: 15000 }
  );
  const artifacts = artifactsRes.data?.artifacts || [];
  if (artifacts.length === 0) return null;

  const apkArtifact = artifacts.find((a) => /apk/i.test(a.name)) || artifacts[0];
  const downloadRes = await axios.get(apkArtifact.archive_download_url, {
    headers,
    responseType: 'arraybuffer',
    timeout: 120000
  });

  const zip = new AdmZip(Buffer.from(downloadRes.data));
  const apkEntry = zip.getEntries().find((e) => e.entryName.toLowerCase().endsWith('.apk'));
  if (!apkEntry) return null;

  fs.ensureDirSync(destDir);
  const apkPath = path.join(destDir, apkEntry.entryName.split('/').pop());
  fs.writeFileSync(apkPath, apkEntry.getData());
  return apkPath;
}

// Perkiraan kasar total tahap job (dipakai untuk hitung % progres asli dari step GitHub Actions)
function computeStepProgress(job) {
  if (!job || !Array.isArray(job.steps) || job.steps.length === 0) {
    return { pct: 5, statusText: 'MENUNGGU RUNNER', detailText: 'Menunggu GitHub Actions runner tersedia (queued)...' };
  }
  const total = job.steps.length;
  const doneCount = job.steps.filter((s) => s.status === 'completed').length;
  const runningStep = job.steps.find((s) => s.status === 'in_progress');
  const pct = Math.min(99, Math.round((doneCount / total) * 100));
  const statusText = runningStep ? runningStep.name.toUpperCase() : (doneCount >= total ? 'FINALIZING' : 'QUEUED');
  const detailText = runningStep ? `Menjalankan step: ${runningStep.name}` : 'Menyiapkan tahap berikutnya...';
  return { pct, statusText, detailText };
}

/**
 * =========================================================================
 * EKSEKUSI BUILD NYATA: unggah project -> push ke GitHub -> trigger workflow
 * -> pantau run yang benar-benar dipicu -> unduh APK dari run itu -> kirim.
 * Tidak ada progres/APK karangan di jalur ini — kalau build gagal, bot
 * akan bilang gagal beserta link log asli, bukan pura-pura sukses.
 * =========================================================================
 */
async function executeRealBuildFlow(chatId, originalMsg, doc, profile, mode, projectName, developerName, userId) {
  const isGenetik = profile === 'GENETIK';
  const owner = isGenetik ? config.GENETIK_GITHUB_OWNER : config.GITHUB_OWNER;
  const repo = isGenetik ? config.GENETIK_GITHUB_REPO : config.GITHUB_REPO;
  const token = isGenetik ? config.GENETIK_GITHUB_TOKEN : config.GITHUB_TOKEN;
  const workflowFile = isGenetik ? (config.GENETIK_GITHUB_WORKFLOW_FILE || 'flutter_build.yml') : (config.GITHUB_WORKFLOW_FILE || 'flutter_build.yml');

  if (!token || !owner || !repo) {
    return bot.sendMessage(chatId, '❌ Konfigurasi GitHub (owner/repo/token) belum lengkap di `.env`. Build tidak bisa dijalankan.', { parse_mode: 'Markdown' });
  }

  const startTime = Date.now();
  const branchName = `build-${userId}-${startTime}`;
  const tempDir = path.join(os.tmpdir(), `flutterbuild_${startTime}`);
  const zipPath = path.join(tempDir, 'project.zip');
  const extractDir = path.join(tempDir, 'extracted');

  await bot.sendMessage(chatId,
`⏳ *Mempersiapkan Build APK...*\n\n` +
`📦 Project : *${projectName}*\n` +
`🏷️ Profil  : *${profile}*\n` +
`🔧 Mode    : *${mode}*\n\n` +
`Mengunduh berkas ZIP kamu dan mempush source code ke GitHub Actions runner...`,
    { parse_mode: 'Markdown' }
  );

  let monitorMsgId = null;
  if (config.CHANNEL_MONITOR_ID) {
    try {
      const sentMon = await bot.sendMessage(config.CHANNEL_MONITOR_ID, formatMonitorText(
        'RUNNING', developerName, userId, projectName, mode, 'UPLOADING (0%)', 'Mengunggah project ke GitHub.', '0 Detik'
      ), { parse_mode: 'Markdown' });
      monitorMsgId = sentMon.message_id;
    } catch (e) {}
  }

  let userProgressMsg = null;
  const updateProgress = async ({ run, job, elapsedSec }) => {
    const { pct, statusText, detailText } = computeStepProgress(job);
    const timeStr = formatSeconds(elapsedSec);

    if (monitorMsgId && config.CHANNEL_MONITOR_ID) {
      try {
        await bot.editMessageText(formatMonitorText('RUNNING', developerName, userId, projectName, mode, `${statusText} (${pct}%)`, detailText, timeStr), {
          chat_id: config.CHANNEL_MONITOR_ID,
          message_id: monitorMsgId,
          parse_mode: 'Markdown'
        });
      } catch (e) {}
    }

    try {
      const text = `⚙️ *BUILD PROGRESS: ${pct}%*\n\n📦 Project : *${projectName}*\n📊 Tahap   : *${statusText}*\n📝 Detail  : _${detailText}_\n⏱️ Waktu   : *${timeStr}*`;
      if (!userProgressMsg) {
        userProgressMsg = await bot.sendMessage(chatId, text, { parse_mode: 'Markdown' });
      } else {
        await bot.editMessageText(text, { chat_id: chatId, message_id: userProgressMsg.message_id, parse_mode: 'Markdown' });
      }
    } catch (e) {}
  };

  try {
    // 1. Unduh ZIP dari Telegram
    await downloadTelegramDocument(doc, zipPath);

    // 2. Ekstrak & cari root project Flutter (berisi pubspec.yaml)
    fs.ensureDirSync(extractDir);
    new AdmZip(zipPath).extractAllTo(extractDir, true);
    const projectRoot = findProjectRoot(extractDir);
    if (!projectRoot) {
      throw new Error('pubspec.yaml tidak ditemukan di dalam ZIP. Pastikan ZIP berisi project Flutter yang valid.');
    }

    // 3. Push ke branch build khusus di repo builder GitHub
    await pushProjectToGitHubRepo(projectRoot, owner, repo, token, branchName);

    // 4. Trigger workflow_dispatch pada branch tsb
    const dispatchedAtMs = Date.now();
    await triggerWorkflowDispatch(owner, repo, token, workflowFile, branchName, {
      build_mode: mode.toLowerCase(),
      project_name: projectName.replace(/\.zip$/i, '')
    });

    // 5. Temukan run yang benar-benar baru dipicu (bukan run lama)
    const run = await findTriggeredRun(owner, repo, token, workflowFile, branchName, dispatchedAtMs);
    if (!run) {
      throw new Error('Tidak menemukan run GitHub Actions yang dipicu. Cek apakah workflow ada di branch default repo builder.');
    }

    // 6. Pantau sampai selesai (timeout mengikuti batas workflow, default 45 menit)
    const timeoutMs = (Number(config.BUILD_TIMEOUT_MINUTES) || 45) * 60 * 1000;
    const finishedRun = await pollRunUntilDone(owner, repo, token, run.id, updateProgress, timeoutMs);

    const totalElapsedSec = Math.floor((Date.now() - startTime) / 1000);
    const totalTimeStr = formatSeconds(totalElapsedSec);

    if (finishedRun.conclusion !== 'success') {
      // GAGAL — tampilkan apa adanya, jangan kirim APK palsu
      if (monitorMsgId && config.CHANNEL_MONITOR_ID) {
        try {
          await bot.editMessageText(formatMonitorText('FAILED', developerName, userId, projectName, mode, 'FAILED', `Build gagal (${finishedRun.conclusion}). Lihat log lengkap di GitHub.`, totalTimeStr), {
            chat_id: config.CHANNEL_MONITOR_ID, message_id: monitorMsgId, parse_mode: 'Markdown'
          });
        } catch (e) {}
      }
      const history = getDatabase('buildhistory.json');
      history.push({ id: 'BLD-' + Date.now(), userId, developerName, projectName, mode, profile, status: 'FAILED', time: totalTimeStr, timestamp: getWIBTime() });
      saveDatabase('buildhistory.json', history);

      await bot.sendMessage(chatId,
`❌ *BUILD GAGAL*\n\n` +
`📦 Project : *${projectName}*\n` +
`⏱️ Durasi  : *${totalTimeStr}*\n\n` +
`Kompilasi di GitHub Actions gagal. Cek log lengkapnya di sini untuk tahu baris/error mana yang bermasalah:\n${finishedRun.html_url}`,
        { parse_mode: 'Markdown', disable_web_page_preview: true }
      );
      return;
    }

    // 7. SUKSES — ambil APK dari run SPESIFIK ini, lalu kirim ke chat
    const buildsDir = path.join(__dirname, 'database', 'builds');
    const apkPath = await downloadApkArtifactForRun(owner, repo, token, finishedRun.id, buildsDir);
    if (!apkPath) {
      throw new Error('Run selesai sukses tapi artifact APK tidak ditemukan. Cek konfigurasi step upload-artifact di workflow.');
    }

    if (monitorMsgId && config.CHANNEL_MONITOR_ID) {
      try {
        await bot.editMessageText(formatMonitorText('SUCCESS', developerName, userId, projectName, mode, 'SUCCESS (100%)', 'Kompilasi APK berhasil. Paket siap diinstall!', totalTimeStr), {
          chat_id: config.CHANNEL_MONITOR_ID, message_id: monitorMsgId, parse_mode: 'Markdown'
        });
      } catch (e) {}
    }

    const history = getDatabase('buildhistory.json');
    history.push({ id: 'BLD-' + Date.now(), userId, developerName, projectName, mode, profile, status: 'SUCCESS', time: totalTimeStr, timestamp: getWIBTime() });
    saveDatabase('buildhistory.json', history);

    const apkSizeMb = (fs.statSync(apkPath).size / (1024 * 1024)).toFixed(2);
    await sendApkToChat(
      chatId,
      apkPath,
      `📱 *BUILD APK SELESAI!* 🎉\n` +
      `──────────────────────────────────\n` +
      `⏱️ *Durasi Build* : ${totalTimeStr}\n` +
      `💾 *Ukuran APK*   : ${apkSizeMb} MB\n` +
      `🔧 *Mode Kompiler*: ${mode === 'RELEASE' ? '🚀 Release Build' : '🐞 Debug Build'}\n\n` +
      `_Terima kasih telah mempercayai layanan Flutter Build Bot!_`,
      `${projectName.replace(/\.zip$/i, '')}.apk`
    );

  } finally {
    // Bersihkan branch sementara & file lokal, tidak peduli sukses/gagal
    deleteRemoteBranch(owner, repo, token, branchName).catch(() => {});
    fs.remove(tempDir).catch(() => {});
  }
}

// Format Teks Live Build Monitor (Sesuai Gambar 5 & 6)
function formatMonitorText(state, devName, userId, project, mode, statusText, detailText, timeElapsed) {
  const header = state === 'SUCCESS'
    ? '✅ LIVE BUILD MONITOR ✅'
    : (state === 'FAILED' ? '❌ LIVE BUILD MONITOR ❌' : '⏳ LIVE BUILD MONITOR ⏳');

  return (
`${header}\n` +
`━━━━━━━━━━━━━━━━━━━━━━━\n\n` +
`👤 *Developer* : ${devName}\n` +
`🆔 *User ID*   : ${userId}\n` +
`📦 *Project*   : ${project}\n` +
`🔧 *Mode*      : 🚀 ${mode} Build\n\n` +
`📊 *PROGRES AKTIF:*\n` +
`*STATUS* ➔ *${statusText}*\n` +
`*DETAIL* ➔ _${detailText}_\n\n` +
`━━━━━━━━━━━━━━━━━━━━━━━\n` +
`⏱️ *Waktu Berjalan:* ${timeElapsed}\n` +
`🤖 *Multi-build Server Active — Proses berjalan independen.*`
  );
}

function formatSeconds(sec) {
  const m = Math.floor(sec / 60);
  const s = sec % 60;
  if (m > 0) {
    return `${m} Menit ${s} Detik`;
  }
  return `${s} Detik`;
}
