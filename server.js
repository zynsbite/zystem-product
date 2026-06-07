const express = require('express');
const multer = require('multer');
const fs = require('fs');
const path = require('path');
const TelegramBot = require('node-telegram-bot-api');

const app = express();
const PORT = process.env.PORT || 3000;

// ─── CONFIG ────────────────────────────────────────────────
const BOT_TOKEN = process.env.BOT_TOKEN || '8965858471:AAFV66M2gvl5AJLGntSXxtHNRHprfLmEQVI';
const ADMIN_CHAT_ID = process.env.ADMIN_CHAT_ID || '8266866004';
const bot = new TelegramBot(BOT_TOKEN, { polling: true });

// ─── CORS ───────────────────────────────────────────────────
app.use((req, res, next) => {
  res.header('Access-Control-Allow-Origin', '*');
  res.header('Access-Control-Allow-Methods', 'GET, POST, DELETE, OPTIONS');
  res.header('Access-Control-Allow-Headers', 'Content-Type, x-admin-pass');
  if (req.method === 'OPTIONS') return res.sendStatus(200);
  next();
});

// ─── MIDDLEWARE ─────────────────────────────────────────────
app.use(express.json());
app.use(express.static(path.join(__dirname, '../frontend')));
app.use('/uploads', express.static(path.join(__dirname, 'uploads')));

// ─── AUTO CREATE FOLDERS & FILES ────────────────────────────
const uploadsDir = path.join(__dirname, 'uploads');
const testiDir = path.join(__dirname, 'uploads/testimoni');
if (!fs.existsSync(uploadsDir)) fs.mkdirSync(uploadsDir, { recursive: true });
if (!fs.existsSync(testiDir)) fs.mkdirSync(testiDir, { recursive: true });
if (!fs.existsSync(path.join(__dirname, 'orders.json'))) fs.writeFileSync(path.join(__dirname, 'orders.json'), '[]');
if (!fs.existsSync(path.join(__dirname, 'status.json'))) fs.writeFileSync(path.join(__dirname, 'status.json'), '{"open":true}');

// ─── MULTER SETUP ───────────────────────────────────────────
const storageProof = multer.diskStorage({
  destination: (req, file, cb) => cb(null, path.join(__dirname, 'uploads')),
  filename: (req, file, cb) => cb(null, `proof_${Date.now()}${path.extname(file.originalname)}`)
});
const storageTestimoni = multer.diskStorage({
  destination: (req, file, cb) => cb(null, path.join(__dirname, 'uploads/testimoni')),
  filename: (req, file, cb) => cb(null, `testi_${Date.now()}${path.extname(file.originalname)}`)
});

const uploadProof = multer({ storage: storageProof });
const uploadTesti = multer({ storage: storageTestimoni });

// ─── HELPERS ────────────────────────────────────────────────
const readJSON = (file) => JSON.parse(fs.readFileSync(path.join(__dirname, file), 'utf8'));
const writeJSON = (file, data) => fs.writeFileSync(path.join(__dirname, file), JSON.stringify(data, null, 2));

// ─── API: GET PRODUCTS ──────────────────────────────────────
app.get('/api/products', (req, res) => {
  const data = readJSON('products.json');
  // Kirim tanpa stock data ke frontend
  const safe = data.products.map(({ stock, ...p }) => ({ ...p, stockCount: stock.length }));
  res.json(safe);
});

// ─── API: GET TESTIMONI ─────────────────────────────────────
app.get('/api/testimoni', (req, res) => {
  const dir = path.join(__dirname, 'uploads/testimoni');
  if (!fs.existsSync(dir)) return res.json([]);
  const files = fs.readdirSync(dir).filter(f => /\.(jpg|jpeg|png|webp)$/i.test(f));
  res.json(files.map(f => `/uploads/testimoni/${f}`));
});

// ─── API: SUBMIT ORDER ──────────────────────────────────────
app.post('/api/order', uploadProof.single('proof'), async (req, res) => {
  try {
    const { items, total } = JSON.parse(req.body.orderData);
    const proofPath = req.file ? `/uploads/${req.file.filename}` : null;
    const orderId = `ORD-${Date.now()}`;

    const orders = readJSON('orders.json');
    const newOrder = { id: orderId, items, total, proofFile: req.file?.filename, status: 'pending', createdAt: new Date() };
    orders.push(newOrder);
    writeJSON('orders.json', orders);

    // Format pesan ke Telegram
    let msg = `🛒 ORDER BARU - ${orderId}\n\n`;
    items.forEach(i => {
      msg += `• ${i.name} (${i.duration}) x${i.qty} = Rp${(i.price * i.qty).toLocaleString('id-ID')}\n`;
    });
    msg += `\n💰 Total: Rp${Number(total).toLocaleString('id-ID')}\n\n`;
    msg += `Ketik /acc_${orderId} untuk ACC pesanan ini.`;

    // Tombol inline ACC
    const keyboard = { inline_keyboard: [[{ text: '✅ ACC Pesanan', callback_data: `acc_${orderId}` }]] };

    await bot.sendMessage(ADMIN_CHAT_ID, msg, { reply_markup: keyboard });

    if (proofPath) {
      await bot.sendPhoto(ADMIN_CHAT_ID, path.join(__dirname, 'uploads', req.file.filename), { caption: `Bukti TF - ${orderId}` });
    }

    res.json({ success: true, orderId });
  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, error: err.message });
  }
});

// ─── API: CHECK ORDER STATUS ─────────────────────────────────
app.get('/api/order/:id', (req, res) => {
  const orders = readJSON('orders.json');
  const order = orders.find(o => o.id === req.params.id);
  if (!order) return res.status(404).json({ error: 'Order not found' });
  res.json(order);
});

// ─── TELEGRAM BOT COMMANDS ──────────────────────────────────

// /testi — admin upload testimoni
bot.onText(/\/testi/, (msg) => {
  if (String(msg.chat.id) !== String(ADMIN_CHAT_ID)) return;
  bot.sendMessage(msg.chat.id, '📸 Kirim gambar testimoni sekarang:');
});

// Tangkap photo setelah /testi
bot.on('photo', async (msg) => {
  if (String(msg.chat.id) !== String(ADMIN_CHAT_ID)) return;
  const fileId = msg.photo[msg.photo.length - 1].file_id;
  const fileInfo = await bot.getFile(fileId);
  const fileUrl = `https://api.telegram.org/file/bot${BOT_TOKEN}/${fileInfo.file_path}`;

  const axios = require('axios');
  const response = await axios({ url: fileUrl, responseType: 'stream' });
  const ext = path.extname(fileInfo.file_path) || '.jpg';
  const filename = `testi_${Date.now()}${ext}`;
  const dest = path.join(__dirname, 'uploads/testimoni', filename);
  response.data.pipe(fs.createWriteStream(dest));
  bot.sendMessage(msg.chat.id, `✅ Testimoni berhasil ditambahkan!`);
});

// /acc_ORDERID — admin ACC pesanan
bot.onText(/\/acc_(.+)/, async (msg, match) => {
  if (String(msg.chat.id) !== String(ADMIN_CHAT_ID)) return;
  const orderId = match[1];
  const orders = readJSON('orders.json');
  const orderIdx = orders.findIndex(o => o.id === orderId);

  if (orderIdx === -1) return bot.sendMessage(msg.chat.id, '❌ Order tidak ditemukan.');

  const order = orders[orderIdx];
  if (order.status === 'approved') return bot.sendMessage(msg.chat.id, '⚠️ Order sudah di-ACC sebelumnya.');

  // Ambil stok produk
  const data = readJSON('products.json');
  let accountsDelivered = [];

  for (const item of order.items) {
    const product = data.products.find(p => p.id === item.id);
    if (!product) continue;
    for (let i = 0; i < item.qty; i++) {
      if (product.stock.length > 0) {
        accountsDelivered.push({ product: `${product.name} (${product.duration})`, account: product.stock.shift() });
      }
    }
  }

  writeJSON('products.json', data);
  orders[orderIdx].status = 'approved';
  orders[orderIdx].accounts = accountsDelivered;
  orders[orderIdx].approvedAt = new Date();
  writeJSON('orders.json', orders);

  bot.sendMessage(msg.chat.id, `✅ Order ${orderId} berhasil di-ACC!\nStok telah dikirim ke user.`);
});

// Tombol inline ACC
bot.on('callback_query', async (query) => {
  if (String(query.from.id) !== String(ADMIN_CHAT_ID)) return;
  const data = query.data;
  if (!data.startsWith('acc_')) return;
  const orderId = data.replace('acc_', '');
  const orders = readJSON('orders.json');
  const orderIdx = orders.findIndex(o => o.id === orderId);
  if (orderIdx === -1) { bot.answerCallbackQuery(query.id, { text: '❌ Order tidak ditemukan' }); return; }
  const order = orders[orderIdx];
  if (order.status === 'approved') { bot.answerCallbackQuery(query.id, { text: '⚠️ Sudah di-ACC sebelumnya' }); return; }
  const prodData = readJSON('products.json');
  let accountsDelivered = [];
  for (const item of order.items) {
    const product = prodData.products.find(p => p.id === item.id);
    if (!product) continue;
    for (let i = 0; i < item.qty; i++) {
      if (product.stock.length > 0) accountsDelivered.push({ product: `${product.name} (${product.duration})`, account: product.stock.shift() });
    }
  }
  writeJSON('products.json', prodData);
  orders[orderIdx].status = 'approved';
  orders[orderIdx].accounts = accountsDelivered;
  orders[orderIdx].approvedAt = new Date();
  writeJSON('orders.json', orders);
  bot.answerCallbackQuery(query.id, { text: '✅ Order berhasil di-ACC!' });
  bot.editMessageText(`✅ ACC - ${orderId}
Stok telah dikirim ke user.`, { chat_id: query.message.chat.id, message_id: query.message.message_id });
});

// /open & /close
bot.onText(/\/open/, (msg) => {
  if (String(msg.chat.id) !== String(ADMIN_CHAT_ID)) return;
  writeJSON('status.json', { open: true });
  bot.sendMessage(msg.chat.id, '✅ Website sekarang BUKA.');
});

bot.onText(/\/close/, (msg) => {
  if (String(msg.chat.id) !== String(ADMIN_CHAT_ID)) return;
  writeJSON('status.json', { open: false });
  bot.sendMessage(msg.chat.id, '🔒 Website sekarang TUTUP.');
});

// ─── API: SITE STATUS ────────────────────────────────────────
app.get('/api/status', (req, res) => {
  try { res.json(readJSON('status.json')); }
  catch (e) { res.json({ open: true }); }
});

// ─── START ───────────────────────────────────────────────────
app.listen(PORT, () => console.log(`✅ Zystem running at http://localhost:${PORT}`));

// ─── ADMIN PASSWORD ──────────────────────────────────────────
const ADMIN_PASS = process.env.ADMIN_PASS || 'zystem2024';

function checkAdmin(req, res) {
  const pass = req.headers['x-admin-pass'];
  if (pass !== ADMIN_PASS) { res.status(401).json({ error: 'Unauthorized' }); return false; }
  return true;
}

// ─── ADMIN: GET ALL ORDERS ───────────────────────────────────
app.get('/api/admin/orders', (req, res) => {
  if (!checkAdmin(req, res)) return;
  res.json(readJSON('orders.json'));
});

// ─── ADMIN: ACC ORDER ────────────────────────────────────────
app.post('/api/admin/acc/:id', (req, res) => {
  if (!checkAdmin(req, res)) return;
  const orderId = req.params.id;
  const orders = readJSON('orders.json');
  const orderIdx = orders.findIndex(o => o.id === orderId);
  if (orderIdx === -1) return res.status(404).json({ error: 'Order tidak ditemukan' });
  const order = orders[orderIdx];
  if (order.status === 'approved') return res.json({ error: 'Sudah di-ACC' });

  const data = readJSON('products.json');
  let accountsDelivered = [];
  for (const item of order.items) {
    const product = data.products.find(p => p.id === item.id);
    if (!product) continue;
    for (let i = 0; i < item.qty; i++) {
      if (product.stock.length > 0) accountsDelivered.push({ product: `${product.name} (${product.duration})`, account: product.stock.shift() });
    }
  }
  writeJSON('products.json', data);
  orders[orderIdx].status = 'approved';
  orders[orderIdx].accounts = accountsDelivered;
  orders[orderIdx].approvedAt = new Date();
  writeJSON('orders.json', orders);
  res.json({ success: true });
});

// ─── ADMIN: GET PRODUCTS (WITH STOCK) ────────────────────────
app.get('/api/admin/products', (req, res) => {
  if (!checkAdmin(req, res)) return;
  res.json(readJSON('products.json'));
});

// ─── ADMIN: ADD STOCK ────────────────────────────────────────
app.post('/api/admin/stock/:id', (req, res) => {
  if (!checkAdmin(req, res)) return;
  const { accounts } = req.body;
  const data = readJSON('products.json');
  const product = data.products.find(p => p.id == req.params.id);
  if (!product) return res.status(404).json({ error: 'Produk tidak ditemukan' });
  const lines = accounts.split('\n').map(l => l.trim()).filter(Boolean);
  product.stock.push(...lines);
  writeJSON('products.json', data);
  res.json({ success: true, added: lines.length, total: product.stock.length });
});

// ─── ADMIN: TOGGLE STATUS ────────────────────────────────────
app.post('/api/admin/status', (req, res) => {
  if (!checkAdmin(req, res)) return;
  const { open } = req.body;
  writeJSON('status.json', { open });
  res.json({ success: true, open });
});

// ─── ADMIN: DELETE TESTIMONI ─────────────────────────────────
app.delete('/api/admin/testimoni/:filename', (req, res) => {
  if (!checkAdmin(req, res)) return;
  const filePath = path.join(__dirname, 'uploads/testimoni', req.params.filename);
  if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
  res.json({ success: true });
});

// ─── ADMIN: UPLOAD TESTIMONI ─────────────────────────────────
app.post('/api/admin/testimoni', (req, res, next) => {
  const pass = req.headers['x-admin-pass'];
  if (pass !== ADMIN_PASS) return res.status(401).json({ error: 'Unauthorized' });
  next();
}, uploadTesti.single('image'), (req, res) => {
  res.json({ success: true, filename: req.file.filename });
});

// ─── STATE: sesi /add dan /new ───────────────────────────────
const sessions = {};

// /start
bot.onText(/\/start/, (msg) => {
  if (String(msg.chat.id) !== String(ADMIN_CHAT_ID)) return;
  const adminUrl = 'https://zynsproduct.kesug.com/admin.html';
  bot.sendMessage(msg.chat.id,
`👋 Halo Admin! Selamat datang di Zystem Bot.

Berikut daftar perintah yang tersedia:

📦 ORDER
/acc_[OrderID] — ACC pesanan masuk

📊 STATISTIK
/sum — Lihat total pembeli & pemasukan

🗂️ STOK
/add [ID Produk] — Tambah stok akun ke produk
/testi — Upload foto testimoni

🆕 PRODUK
/new — Buat produk baru

🔛 TOKO
/open — Buka toko
/close — Tutup toko

🖥️ Admin Panel: ${adminUrl}`
  );
});

// /sum — statistik
bot.onText(/\/sum/, (msg) => {
  if (String(msg.chat.id) !== String(ADMIN_CHAT_ID)) return;
  const orders = readJSON('orders.json');
  const approved = orders.filter(o => o.status === 'approved');
  const pending = orders.filter(o => o.status === 'pending');
  const totalIncome = approved.reduce((sum, o) => sum + Number(o.total), 0);
  bot.sendMessage(msg.chat.id,
`📊 Statistik Zystem.Product

Total Order: ${orders.length}
✅ Approved: ${approved.length}
⏳ Pending: ${pending.length}

💰 Total Pemasukan: Rp${totalIncome.toLocaleString('id-ID')}`
  );
});

// /add [productId] — tambah stok
bot.onText(/\/add(?:\s+(\d+))?/, (msg, match) => {
  if (String(msg.chat.id) !== String(ADMIN_CHAT_ID)) return;
  const chatId = msg.chat.id;
  const data = readJSON('products.json');

  if (!match[1]) {
    // Tampilkan daftar produk dulu
    const list = data.products.map(p => `${p.id}. ${p.name} (${p.duration}) — stok: ${p.stock.length}`).join('\n');
    bot.sendMessage(chatId, `Pilih produk dengan ketik:\n/add [nomor]\n\n${list}`);
    return;
  }

  const productId = parseInt(match[1]);
  const product = data.products.find(p => p.id === productId);
  if (!product) return bot.sendMessage(chatId, '❌ Produk tidak ditemukan.');

  sessions[chatId] = { action: 'add_stock', productId };
  bot.sendMessage(chatId,
`Tambah stok untuk: ${product.name} (${product.duration})
Stok saat ini: ${product.stock.length}

Kirim akun satu per baris, contoh:
email@gmail.com | pass: abc123
email2@gmail.com | pass: xyz456`
  );
});

// /new — buat produk baru
bot.onText(/\/new/, (msg) => {
  if (String(msg.chat.id) !== String(ADMIN_CHAT_ID)) return;
  sessions[msg.chat.id] = { action: 'new_product', step: 'name' };
  bot.sendMessage(msg.chat.id, '🆕 Buat produk baru\n\nKetik nama produk:');
});

// Handler pesan teks biasa (untuk sesi /add dan /new)
bot.on('message', async (msg) => {
  if (String(msg.chat.id) !== String(ADMIN_CHAT_ID)) return;
  if (msg.text && msg.text.startsWith('/')) return;
  if (msg.photo) return;

  const chatId = msg.chat.id;
  const text = msg.text?.trim();
  const session = sessions[chatId];
  if (!session || !text) return;

  // Sesi tambah stok
  if (session.action === 'add_stock') {
    const data = readJSON('products.json');
    const product = data.products.find(p => p.id === session.productId);
    if (!product) return;
    const lines = text.split('\n').map(l => l.trim()).filter(Boolean);
    product.stock.push(...lines);
    writeJSON('products.json', data);
    delete sessions[chatId];
    bot.sendMessage(chatId, `✅ ${lines.length} akun ditambahkan ke ${product.name}!\nTotal stok sekarang: ${product.stock.length}`);
    return;
  }

  // Sesi buat produk baru
  if (session.action === 'new_product') {
    if (session.step === 'name') {
      sessions[chatId].name = text;
      sessions[chatId].step = 'duration';
      bot.sendMessage(chatId, `Nama: ${text}\n\nKetik durasi produk (contoh: 1 Bulan, 1 Tahun, Selamanya):`);
    } else if (session.step === 'duration') {
      sessions[chatId].duration = text;
      sessions[chatId].step = 'price';
      bot.sendMessage(chatId, `Durasi: ${text}\n\nKetik harga produk (angka saja, contoh: 15000):`);
    } else if (session.step === 'price') {
      const price = parseInt(text.replace(/\D/g, ''));
      if (isNaN(price)) return bot.sendMessage(chatId, '❌ Harga harus angka. Coba lagi:');
      const data = readJSON('products.json');
      const newId = Math.max(...data.products.map(p => p.id), 0) + 1;
      data.products.push({ id: newId, name: session.name, duration: session.duration, price, stock: [] });
      writeJSON('products.json', data);
      delete sessions[chatId];
      bot.sendMessage(chatId,
`✅ Produk baru berhasil dibuat!

ID: ${newId}
Nama: ${session.name}
Durasi: ${session.duration}
Harga: Rp${price.toLocaleString('id-ID')}

Tambah stok dengan: /add ${newId}`
      );
    }
  }
});
