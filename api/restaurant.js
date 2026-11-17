const { createHash, createHmac, randomBytes, randomUUID, timingSafeEqual } = require("node:crypto");
const catalog = require("../lib/catalog");
const store = require("../lib/store");

const same = (a, b) => typeof a === "string" && typeof b === "string" &&
  timingSafeEqual(createHash("sha256").update(a).digest(), createHash("sha256").update(b).digest());
const sign = value => createHmac("sha256", process.env.SESSION_SECRET).update(value).digest("base64url");
const allowedTable = number => Number.isInteger(number) && number >= 1 && number <= 8;
const uuid = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i;
const rupiah = session => session.orders.reduce((sum, order) => sum + order.items.reduce((subtotal, item) => subtotal + item.quantity * item.price, 0), 0);

function check(condition, message, status = 400) {
  if (!condition) throw Object.assign(Error(message), { status });
}

function getRole(req) {
  const cookie = (req.headers.cookie || "").split(/;\s*/).find(item => item.startsWith("ds_staff="))?.slice(9) || "";
  const [role, expires, signature] = cookie.split(".");
  return ["kasir", "dapur"].includes(role) && Number(expires) > Date.now() &&
    same(signature, sign(`${role}.${expires}`)) ? role : null;
}

function withCatalog(data) {
  return data.catalog || catalog;
}

function state(data, table, guestCode, role, view) {
  const menu = withCatalog(data);
  if (view === "kasir" || view === "dapur") {
    check(role === "kasir" || role === view, "Masuk sebagai staf terlebih dahulu.", 401);
    if (view === "dapur") {
      const sessions = Object.fromEntries(Object.entries(data.sessions).map(([number, session]) => [
        number, { orders: session.orders.filter(order => ["diterima", "siap"].includes(order.status)) }
      ]));
      return { sessions, soldOut: [], payments: [], menu };
    }
    return { sessions: data.sessions, soldOut: data.soldOut, payments: data.payments.slice(-15), menu };
  }
  const session = data.sessions[table];
  const joined = session && same(guestCode, session.code);
  return {
    sessions: joined ? { [table]: { id: session.id, bill: session.bill, orders: session.orders } } : {},
    occupied: Boolean(session), soldOut: data.soldOut, payments: [], menu: menu.filter(item => !item.hidden)
  };
}

function update(data, body, role, guestCode) {
  const { action, value } = body;
  let number = Number(body.table);
  if (action === "status") number = Number(String(value).split(":")[0]);
  check(allowedTable(number), "Nomor meja tidak valid.");
  const session = data.sessions[number];
  if (action === "send" || action === "bill") {
    check(session && same(guestCode, session.code) && session.id === body.session, "Sesi meja berubah. Masukkan kode meja aktif.", 409);
    if (action === "bill") {
      check(session.orders.length, "Belum ada pesanan.");
      session.bill = true;
      return;
    }
    check(uuid.test(body.requestId || ""), "Identitas pengiriman tidak valid.");
    if (session.orders.some(order => order.id === body.requestId)) return;
    check(session.orders.length < 100 && Array.isArray(body.items) && body.items.length > 0 && body.items.length <= 30, "Jumlah pesanan melebihi batas.");
    const items = body.items.map(entry => {
      const item = withCatalog(data).find(dish => dish.id === entry?.id && !dish.hidden);
      check(item && !data.soldOut.includes(item.id), item ? `${item.name} habis.` : "Menu sudah berubah.", 409);
      check(Number.isInteger(entry.quantity) && entry.quantity >= 1 && entry.quantity <= 10 &&
        typeof entry.note === "string" && entry.note.length <= 120, "Rincian pesanan tidak valid.");
      check(entry.price === item.price, "Harga menu berubah. Pilih ulang hidangan untuk melihat harga terbaru.", 409);
      return { id: item.id, name: item.name, price: item.price, quantity: entry.quantity, note: entry.note.trim() };
    });
    session.orders.push({ id: body.requestId, number: session.orders.length + 1, status: "baru", items, at: new Date().toISOString() });
    return;
  }
  check(role === "kasir" || (role === "dapur" && action === "status"), "Akses staf ditolak.", 403);
  switch (action) {
    case "open":
      data.sessions[number] ??= { id: randomUUID(), code: randomBytes(5).toString("hex").toUpperCase(), orders: [], bill: false };
      return;
    case "close":
      check(session?.id === body.session && session.orders.length === 0, "Meja berubah atau berisi pesanan.", 409);
      delete data.sessions[number];
      return;
    case "sold": {
      const id = Number(value);
      check(withCatalog(data).some(item => item.id === id) && typeof body.sold === "boolean", "Menu tidak valid.");
      data.soldOut = data.soldOut.filter(item => item !== id);
      if (body.sold) data.soldOut.push(id);
      return;
    }
    case "menu": {
      const item = body.item;
      check(item && typeof item.name === "string" && item.name.trim() && item.name.length <= 80 &&
        ["Makanan", "Minuman", "Camilan"].includes(item.category) &&
        Number.isInteger(item.price) && item.price >= 0 && item.price <= 10000000 &&
        typeof item.note === "string" && item.note.length <= 180, "Data menu tidak valid.");
      data.catalog ??= structuredClone(catalog);
      const existing = data.catalog.find(dish => dish.id === item.id);
      if (!existing) check(item.id === 0 && data.catalog.length < 250, "Menu tidak bisa ditambahkan.");
      const fields = { name: item.name.trim(), category: item.category, price: item.price, note: item.note.trim(), hidden: item.hidden === true };
      if (existing) Object.assign(existing, fields);
      else data.catalog.push({ ...fields, id: Math.max(0, ...data.catalog.map(dish => dish.id)) + 1 });
      return;
    }
    case "status": {
      const [, id, next] = String(value).split(":");
      const transitions = { diterima: "baru", siap: "diterima", disajikan: "siap" };
      check(role === "dapur" ? next === "siap" : ["diterima", "disajikan"].includes(next), "Akses status ditolak.", 403);
      const order = session?.orders.find(item => item.id === id);
      check(order && order.status === transitions[next], "Status pesanan sudah berubah.", 409);
      order.status = next;
      return;
    }
    case "pay":
      check(["Tunai", "QRIS"].includes(value), "Metode pembayaran tidak valid.");
      if (data.payments.some(payment => payment.session === body.session && payment.number === number)) return;
      check(session?.id === body.session && session.orders.length > 0 &&
        session.orders.every(order => order.status === "disajikan") && rupiah(session) === body.amount &&
        session.orders.length === body.orderCount, "Tagihan berubah. Periksa ulang sebelum membayar.", 409);
      data.payments.push({ number, session: session.id, amount: rupiah(session), method: value,
        orders: session.orders, at: new Date().toISOString() });
      delete data.sessions[number];
      return;
    default: check(false, "Tindakan tidak dikenal.");
  }
}

module.exports = async (req, res) => {
  res.setHeader("Cache-Control", "no-store");
  res.setHeader("X-Content-Type-Options", "nosniff");
  try {
    check(process.env.SESSION_SECRET?.length >= 32, "Aplikasi belum dikonfigurasi.", 503);
    const role = getRole(req);
    const guestCode = req.headers["x-table-code"];
    const url = new URL(req.url, "http://localhost");
    if (req.method === "GET") {
      const view = url.searchParams.get("view");
      const table = Number(url.searchParams.get("table"));
      if (view === "qr") {
        check(role === "kasir", "Masuk sebagai kasir terlebih dahulu.", 401);
        check(allowedTable(table), "Nomor meja tidak valid.");
        const host = process.env.VERCEL_PROJECT_PRODUCTION_URL;
        check(process.env.VERCEL !== "1" || process.env.PUBLIC_APP_ORIGIN || host, "Alamat publik untuk QR belum dikonfigurasi.", 503);
        const origin = process.env.PUBLIC_APP_ORIGIN || (host ? "https://" + host : "http://127.0.0.1:" + (process.env.PORT || 8766));
        const target = new URL("/", origin);
        target.searchParams.set("meja", table);
        const png = await require("qrcode").toBuffer(target.href, { width: 360, margin: 4 });
        res.setHeader("Content-Type", "image/png");
        return res.end(png);
      }
      return res.json(state((await store.read()).data, table, guestCode, role, view));
    }
    check(req.method === "POST", "Metode tidak didukung.", 405);
    check(req.headers["sec-fetch-site"] !== "cross-site" && req.headers["content-type"]?.startsWith("application/json"), "Permintaan ditolak.", 403);
    const body = typeof req.body === "string" ? JSON.parse(req.body) : req.body;
    check(body && typeof body === "object", "Format permintaan tidak valid.");
    const secure = process.env.VERCEL === "1" ? "; Secure" : "";
    if (body.action === "login") {
      const password = { kasir: process.env.CASHIER_PASSWORD, dapur: process.env.KITCHEN_PASSWORD }[body.role];
      check(typeof password === "string" && password.length >= 16 && same(body.password, password), "Akun atau sandi staf keliru.", 401);
      const token = `${body.role}.${Date.now() + 12 * 60 * 60 * 1000}`;
      res.setHeader("Set-Cookie", `ds_staff=${token}.${sign(token)}; Path=/; HttpOnly; SameSite=Strict; Max-Age=43200${secure}`);
      return res.json({ ok: true });
    }
    if (body.action === "logout") {
      res.setHeader("Set-Cookie", `ds_staff=; Path=/; HttpOnly; SameSite=Strict; Max-Age=0${secure}`);
      return res.json({ ok: true });
    }
    if (body.action === "join") {
      const session = (await store.read()).data.sessions[Number(body.table)];
      check(session && same(guestCode, session.code), "Kode meja tidak cocok atau sesi sudah habis.", 403);
      return res.json({ ok: true });
    }
    await store.mutate(data => update(data, body, role, guestCode));
    return res.json({ ok: true });
  } catch (error) {
    if (!error.status) console.error(error.message);
    const status = error.status || (error instanceof SyntaxError ? 400 : 503);
    return res.status(status).json({ error: error.status ? error.message : status === 400 ? "Format permintaan tidak valid." : "Layanan pesanan sedang tidak tersedia." });
  }
};


