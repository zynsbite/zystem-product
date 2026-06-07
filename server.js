const express = require('express');
const multer = require('multer');
const fs = require('fs');
const path = require('path');
const TelegramBot = require('node-telegram-bot-api');

const app = express();
const PORT = process.env.PORT || 3000;

// ─── CONFIG ────────────────────────────────────────────────
const BOT_TOKEN = process.env.BOT_TOKEN || '8917164649:AAEu_q70pKWd1uAw_FT7XGIkrXjnQCrx08o';
const ADMIN_CHAT_ID = process.env.ADMIN_CHAT_ID || '8266866004';
const bot = new TelegramBot(BOT_TOKEN, { polling: true });

// ─── CORS ───────────────────────────────────────────────────
app.use((req, res, next) => {
  res.header('Access-Control-Allow-Origin', '*');
  res.header('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.header('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.sendStatus(200);
  next();
});

// ─── MIDDLEWARE ─────────────────────────────────────────────
app.use(express.json());
app.use(express.static(path.join(__dirname, '../frontend')));
app.use('/uploads', express.static(path.join(__dirname, 'uploads')));

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
  const data = readJSON('stock/products.json');
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

    await bot.sendMessage(ADMIN_CHAT_ID, msg);

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
  const data = readJSON('stock/products.json');
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

  writeJSON('stock/products.json', data);
  orders[orderIdx].status = 'approved';
  orders[orderIdx].accounts = accountsDelivered;
  orders[orderIdx].approvedAt = new Date();
  writeJSON('orders.json', orders);

  bot.sendMessage(msg.chat.id, `✅ Order ${orderId} berhasil di-ACC!\nStok telah dikirim ke user.`);
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
});

const uploadProof = multer({ storage: storageProof });
const uploadTesti = multer({ storage: storageTestimoni });

// ─── HELPERS ────────────────────────────────────────────────
const readJSON = (file) => JSON.parse(fs.readFileSync(path.join(__dirname, file), 'utf8'));
const writeJSON = (file, data) => fs.writeFileSync(path.join(__dirname, file), JSON.stringify(data, null, 2));

// ─── API: GET PRODUCTS ──────────────────────────────────────
app.get('/api/products', (req, res) => {
  const data = readJSON('stock/products.json');
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

    await bot.sendMessage(ADMIN_CHAT_ID, msg);

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
  const data = readJSON('stock/products.json');
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

  writeJSON('stock/products.json', data);
  orders[orderIdx].status = 'approved';
  orders[orderIdx].accounts = accountsDelivered;
  orders[orderIdx].approvedAt = new Date();
  writeJSON('orders.json', orders);

  bot.sendMessage(msg.chat.id, `✅ Order ${orderId} berhasil di-ACC!\nStok telah dikirim ke user.`);
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
  catch { res.json({ open: true }); }
});

// ─── START ───────────────────────────────────────────────────
app.listen(PORT, () => console.log(`✅ Zystem running at http://localhost:${PORT}`));
}
function readOrders() {
  if (!fs.existsSync('orders.json')) return [];
  return JSON.parse(fs.readFileSync('orders.json', 'utf8'));
}
function writeOrders(data) {
  fs.writeFileSync('orders.json', JSON.stringify(data, null, 2));
}

app.get('/api/products', (req, res) => {
  const data = readProducts();
  const safe = data.products.map(({ stock, ...p }) => ({ ...p, stockCount: stock.length }));
  res.json(safe);
});

app.get('/api/testimoni', (req, res) => {
  const dir = 'uploads/testimoni';
  if (!fs.existsSync(dir)) return res.json([]);
  const files = fs.readdirSync(dir).filter(f => /\.(jpg|jpeg|png|webp)$/i.test(f));
  res.json(files.map(f => `/uploads/testimoni/${f}`));
});

app.get('/api/status', (req, res) => {
  try { res.json(JSON.parse(fs.readFileSync('status.json', 'utf8'))); }
  catch { res.json({ open: true }); }
});

app.post('/api/order', upload.single('proof'), async (req, res) => {
  try {
    const { items, total } = JSON.parse(req.body.orderData);
    const orderId = `ORD-${Date.now()}`;
    const orders = readOrders();
    orders.push({ id: orderId, items, total, proofFile: req.file?.filename, status: 'pending', createdAt: new Date() });
    writeOrders(orders);

    let msg = `🛒 *ORDER BARU — ${orderId}*\n\n`;
    items.forEach(i => {
      msg += `• ${i.name} (${i.duration}) x${i.qty} = Rp${(i.price * i.qty).toLocaleString('id-ID')}\n`;
    });
    msg += `\n💰 *Total: Rp${Number(total).toLocaleString('id-ID')}*\n\n`;
    msg += `Ketik /acc_${orderId} untuk ACC pesanan ini.`;

    await bot.sendMessage(ADMIN_CHAT_ID, msg, { parse_mode: 'Markdown' });
    if (req.file) {
      await bot.sendPhoto(ADMIN_CHAT_ID, `uploads/${req.file.filename}`, { caption: `Bukti TF — ${orderId}` });
    }
    res.json({ success: true, orderId });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

app.get('/api/order/:id', (req, res) => {
  const order = readOrders().find(o => o.id === req.params.id);
  if (!order) return res.status(404).json({ error: 'Not found' });
  res.json(order);
});

bot.onText(/\/testi/, (msg) => {
  if (String(msg.chat.id) !== String(ADMIN_CHAT_ID)) return;
  bot.sendMessage(msg.chat.id, '📸 Kirim foto testimoni sekarang:');
});

bot.on('photo', async (msg) => {
  if (String(msg.chat.id) !== String(ADMIN_CHAT_ID)) return;
  const fileId = msg.photo[msg.photo.length - 1].file_id;
  const fileInfo = await bot.getFile(fileId);
  const fileUrl = `https://api.telegram.org/file/bot${BOT_TOKEN}/${fileInfo.file_path}`;
  const ext = path.extname(fileInfo.file_path) || '.jpg';
  const filename = `testi_${Date.now()}${ext}`;
  const dir = 'uploads/testimoni';
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  const response = await axios({ url: fileUrl, responseType: 'stream' });
  response.data.pipe(fs.createWriteStream(`${dir}/${filename}`));
  bot.sendMessage(msg.chat.id, '✅ Testimoni berhasil ditambahkan!');
});

bot.onText(/\/acc_(.+)/, async (msg, match) => {
  if (String(msg.chat.id) !== String(ADMIN_CHAT_ID)) return;
  const orderId = match[1];
  const orders = readOrders();
  const idx = orders.findIndex(o => o.id === orderId);
  if (idx === -1) return bot.sendMessage(msg.chat.id, '❌ Order tidak ditemukan.');
  if (orders[idx].status === 'approved') return bot.sendMessage(msg.chat.id, '⚠️ Sudah di-ACC.');

  const data = readProducts();
  let accounts = [];
  for (const item of orders[idx].items) {
    const p = data.products.find(p => p.id === item.id);
    if (!p) continue;
    for (let i = 0; i < item.qty; i++) {
      if (p.stock.length > 0) accounts.push({ product: `${p.name} (${p.duration})`, account: p.stock.shift() });
    }
  }

  writeProducts(data);
  orders[idx].status = 'approved';
  orders[idx].accounts = accounts;
  orders[idx].approvedAt = new Date();
  writeOrders(orders);
  bot.sendMessage(msg.chat.id, `✅ Order ${orderId} di-ACC! Stok terkirim ke user.`);
});

bot.onText(/\/open/, (msg) => {
  if (String(msg.chat.id) !== String(ADMIN_CHAT_ID)) return;
  fs.writeFileSync('status.json', JSON.stringify({ open: true }));
  bot.sendMessage(msg.chat.id, '✅ Website BUKA.');
});

bot.onText(/\/close/, (msg) => {
  if (String(msg.chat.id) !== String(ADMIN_CHAT_ID)) return;
  fs.writeFileSync('status.json', JSON.stringify({ open: false }));
  bot.sendMessage(msg.chat.id, '🔒 Website TUTUP.');
});

app.listen(PORT, () => console.log(`✅ Zystem running at port ${PORT}`));
