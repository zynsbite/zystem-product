const express = require('express');
const axios = require('axios');
const multer = require('multer');
const fs = require('fs');
const path = require('path');
const TelegramBot = require('node-telegram-bot-api');

const app = express();
const cors = require('cors');
app.use(cors());
const PORT = process.env.PORT || 3000;

const BOT_TOKEN = process.env.BOT_TOKEN || '8917164649:AAEu_q70pKWd1uAw_FT7XGIkrXjnQCrx08o';
const ADMIN_CHAT_ID = process.env.ADMIN_CHAT_ID || '8266866004';
const bot = new TelegramBot(BOT_TOKEN, { polling: true });

app.use(express.json());
app.use('/uploads', express.static('uploads'));
app.use(express.static('public'));

const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    const dir = req.query.type === 'testi' ? 'uploads/testimoni' : 'uploads';
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    cb(null, dir);
  },
  filename: (req, file, cb) => cb(null, `${Date.now()}${path.extname(file.originalname)}`)
});
const upload = multer({ storage });

function readProducts() {
  if (!fs.existsSync('products.json')) return { products: [] };
  return JSON.parse(fs.readFileSync('products.json', 'utf8'));
}
function writeProducts(data) {
  fs.writeFileSync('products.json', JSON.stringify(data, null, 2));
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
