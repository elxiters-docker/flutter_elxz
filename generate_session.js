/**
 * =========================================================================
 * GENERATE SESSION MTPROTO (jalankan SEKALI saja)
 *
 * Cara pakai:
 *   1. Isi TELEGRAM_API_ID & TELEGRAM_API_HASH di config.js dulu
 *      (ambil dari https://my.telegram.org -> API Development Tools).
 *   2. Jalankan: npm run generate-session
 *   3. Login pakai NOMOR HP AKUN TELEGRAM (bukan akun bot) yang mau
 *      dipakai sebagai jalur kirim file besar. Ikuti instruksi di layar
 *      (nomor HP -> kode OTP -> password 2FA kalau ada).
 *   4. Script akan mencetak "SESSION STRING" di akhir. Copy nilai itu
 *      dan tempel ke config.js pada field TELEGRAM_SESSION.
 *
 * PENTING: session string itu setara dengan login penuh ke akun
 * Telegram tsb. Perlakukan seperti password — jangan taruh di tempat
 * publik/repo publik.
 * =========================================================================
 */

const readline = require('readline');
const { TelegramClient } = require('telegram');
const { StringSession } = require('telegram/sessions');
const config = require('./config');

function ask(question) {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  return new Promise((resolve) => rl.question(question, (answer) => { rl.close(); resolve(answer.trim()); }));
}

(async () => {
  if (!config.TELEGRAM_API_ID || !config.TELEGRAM_API_HASH) {
    console.error('❌ Isi dulu TELEGRAM_API_ID dan TELEGRAM_API_HASH di config.js sebelum menjalankan script ini.');
    process.exit(1);
  }

  console.log('🔐 Login akun Telegram untuk jalur kirim file besar (MTProto)...\n');

  const client = new TelegramClient(new StringSession(''), Number(config.TELEGRAM_API_ID), config.TELEGRAM_API_HASH, {
    connectionRetries: 5
  });

  await client.start({
    phoneNumber: async () => ask('Nomor HP (format internasional, contoh +6281234567890): '),
    password: async () => ask('Password 2FA (kosongkan/Enter jika tidak pakai 2FA): '),
    phoneCode: async () => ask('Kode OTP yang dikirim Telegram: '),
    onError: (err) => console.error('❌ Login error:', err.message)
  });

  console.log('\n✅ Login berhasil!\n');
  console.log('Salin baris di bawah ini ke config.js pada field TELEGRAM_SESSION:\n');
  console.log('----------------------------------------------------------------');
  console.log(client.session.save());
  console.log('----------------------------------------------------------------\n');

  await client.disconnect();
  process.exit(0);
})();
