# zystem.product — Marketplace

> Digital marketplace premium dengan tampilan dark & gold.

---

## 📁 Struktur Project

```
zystem/
├── frontend/
│   ├── index.html
│   ├── css/style.css
│   ├── js/app.js
│   └── images/
│       └── qr.jpg          ← Taruh QR code kamu di sini!
├── backend/
│   ├── server.js
│   ├── orders.json         ← Data pesanan (auto)
│   ├── uploads/
│   │   └── testimoni/      ← Upload testimoni via Telegram
│   └── stock/
│       └── products.json   ← Data stok akun
├── package.json
└── README.md
```

---

## ⚡ Setup & Jalankan

### 1. Install dependencies
```bash
npm install
```

### 2. Konfigurasi Telegram Bot
Edit `backend/server.js`, isi bagian ini:
```js
const BOT_TOKEN = 'ISI_TOKEN_BOT_TELEGRAM_KAMU';
const ADMIN_CHAT_ID = 'ISI_CHAT_ID_ADMIN_KAMU';
```

**Cara dapat TOKEN:** Buat bot di [@BotFather](https://t.me/BotFather)
**Cara dapat CHAT_ID:** Kirim pesan ke [@userinfobot](https://t.me/userinfobot)

### 3. Tambahkan QR Code
Simpan gambar QR code kamu ke: `frontend/images/qr.jpg`

### 4. Jalankan server
```bash
npm start
```

Buka: [http://localhost:3000](http://localhost:3000)

---

## 🤖 Perintah Telegram Bot

| Perintah | Fungsi |
|----------|--------|
| `/testi` | Kemudian kirim foto → masuk ke halaman Testimoni |
| `/acc_ORD-XXXX` | ACC pesanan + kirim stok akun ke user |
| `/open` | Buka website |
| `/close` | Tutup website (tampil popup) |

---

## 📦 Update Stok Produk

Edit `backend/stock/products.json`:
```json
{
  "products": [
    {
      "id": 1,
      "name": "Alight Motion Pro",
      "duration": "1 Tahun",
      "price": 5000,
      "stock": [
        "email: akun@gmail.com | pass: Password123",
        "email: akun2@gmail.com | pass: Password456"
      ]
    }
  ]
}
```

---

## 🔄 Alur Transaksi

```
User beli → Upload bukti TF
    ↓
Data dikirim ke Telegram admin
    ↓
Admin /acc_ORDERID
    ↓
Stok akun otomatis dikirim ke halaman website user
```
