const https = require('https');
const { spawn } = require('child_process');
require('dotenv').config();

if (!process.env.GH_TOKEN) {
  console.error('\n======================================================');
  console.error('❌ ERROR: GitHub Personal Access Token (GH_TOKEN) is not set!');
  console.error('Silakan tambahkan baris ini di dalam file .env Anda:');
  console.error('GH_TOKEN=ghp_token_anda_disini');
  console.error('Lalu jalankan ulang perintah publish.');
  console.error('======================================================\n');
  process.exit(1);
}

const token = process.env.GH_TOKEN;
console.log('⏳ Memvalidasi GH_TOKEN ke GitHub API...');

const options = {
  hostname: 'api.github.com',
  path: '/user',
  method: 'GET',
  headers: {
    'Authorization': `Bearer ${token}`,
    'User-Agent': 'Node.js-Token-Checker'
  }
};

const req = https.request(options, (res) => {
  if (res.statusCode === 200) {
    console.log('✅ GH_TOKEN valid. Memulai proses build & publish...\n');
    
    // Ambil semua argumen setelah "node check-token.js"
    const args = process.argv.slice(2);
    
    // Jalankan electron-builder, sambil meneruskan process.env (yang sudah berisi GH_TOKEN dari .env)
    const builder = spawn('npx', ['electron-builder', ...args], {
      stdio: 'inherit',
      env: process.env,
      shell: true
    });

    builder.on('close', (code) => {
      process.exit(code);
    });

  } else if (res.statusCode === 401) {
    console.error('\n======================================================');
    console.error('❌ ERROR: GH_TOKEN yang Anda masukkan TIDAK VALID (401 Unauthorized)!');
    console.error('Ini berarti token sudah expired, salah ketik, atau telah dicabut.');
    console.error('\nSilakan buat token baru di GitHub dan update di file .env');
    console.error('======================================================\n');
    process.exit(1);
  } else {
    console.error(`\n⚠️ Peringatan: GitHub API mengembalikan status ${res.statusCode}.`);
    console.error('Proses build akan tetap dilanjutkan...\n');
    process.exit(0);
  }
});

req.on('error', (error) => {
  console.error('\n❌ ERROR saat menghubungi GitHub:', error.message);
  console.error('Pastikan koneksi internet Anda stabil.');
  process.exit(1);
});

req.end();
