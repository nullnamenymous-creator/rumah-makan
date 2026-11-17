# Dapur Sore

Aplikasi pemesanan rumah makan dengan menu tamu, kasir, dan tiket dapur. Harga, status, dan pembayaran disimpan oleh server. Kasir mengonfirmasi pembayaran tunai atau QRIS setelah melihat pembayaran diterima.

## Vercel

1. Buat satu project Supabase untuk Dapur Sore dan jalankan `supabase/schema.sql` melalui SQL Editor.
2. Impor repo ini ke Vercel. Tambahkan variabel dari `.env.example` pada Production. Gunakan Supabase secret key hanya di server. Gunakan nilai acak yang berbeda untuk `SESSION_SECRET` (minimal 32 karakter), `CASHIER_PASSWORD`, dan `KITCHEN_PASSWORD` (masing-masing minimal 16 karakter).
3. Aktifkan system environment variables Vercel atau isi `PUBLIC_APP_ORIGIN` dengan alamat publik permanen. QR cetak memakai alamat tersebut. Deploy ulang setelah mengubah variabel.
4. Buka `/?mode=kasir`. Perbarui menu contoh, buka meja, cetak QR, lalu berikan kode sesi pada tamu. Buka `/?mode=dapur` pada layar dapur.
5. Uji dari ponsel memakai seluler, kasir, dan layar dapur sebelum dipakai pelanggan.

## Lokal

Gunakan Node 24 dan `npm ci`. Jalankan `node --env-file=.env server.js`, lalu buka `http://127.0.0.1:8766`. Untuk database lokal, kosongkan `SUPABASE_URL` lalu isi `LOCAL_DB_PATH` dengan nama file yang berakhiran `.sqlite`. Server pengembangan hanya mendengarkan di localhost.
