let menu = [];
const query = new URLSearchParams(location.search);
const tables = [1, 2, 3, 4, 5, 6, 7, 8];
const table = tables.includes(Number(query.get("meja"))) ? Number(query.get("meja")) : 8;
const mode = ["kasir", "dapur"].includes(query.get("mode")) ? query.get("mode") : "menu";
const currency = new Intl.NumberFormat("id-ID", { style: "currency", currency: "IDR", maximumFractionDigits: 0 });
const money = value => currency.format(value);
const escape = value => String(value).replace(/[&<>"']/g, char => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"})[char]);
const codeKey = "dapur-sore-table-" + table;
let guestCode = sessionStorage.getItem(codeKey) || "";
let data = { sessions: {}, soldOut: [], payments: [], menu: [] };
let requestId = "", pendingRefresh;
const connection = document.querySelector("#connection");
const main = document.querySelector("#main");
const bar = document.querySelector("#bar");
const dialog = document.querySelector("#detail");
const notice = document.querySelector("#notice");
const cart = [];
const status = { baru: "Menunggu kasir", diterima: "Sedang disiapkan", siap: "Siap diantar", disajikan: "Disajikan" };
let category = "Semua", selected = 8, noticeTimer, sound, cartSession;
const load = () => data;
const current = () => load().sessions[table];
const total = items => items.reduce((sum, item) => sum + item.price * item.quantity, 0);
const sessionTotal = session => session.orders.reduce((sum, order) => sum + total(order.items), 0);
const button = (label, action, value = "", style = "btn") =>
  `<button type="button" class="${style}" data-action="${action}" data-value="${escape(value)}">${label}</button>`;
const list = items => `<ul>${items.map(item => `<li><strong>${item.quantity} × ${escape(item.name)}</strong>${item.note ? ` · ${escape(item.note)}` : ""}</li>`).join("")}</ul>`;
const ticket = (order, number, controls = "") => `<article class="ticket">
  <div class="row"><strong>Meja ${number} · Pesanan ${order.number}</strong><span class="pill">${status[order.status]}</span></div>
  ${list(order.items)}${controls}</article>`;

function flash(message) {
  notice.textContent = message;
  clearTimeout(noticeTimer);
  noticeTimer = setTimeout(() => { notice.textContent = ""; }, 4200);
}

async function api(body) {
  const response = await fetch("/api/restaurant?view=" + mode + "&table=" + table, {
    method: body ? "POST" : "GET",
    cache: "no-store",
    headers: { ...(body ? {"Content-Type": "application/json"} : {}),
      ...(mode === "menu" && guestCode ? {"X-Table-Code": guestCode} : {}) },
    ...(body ? {body: JSON.stringify(body)} : {}),
    signal: AbortSignal.timeout(10000)
  });
  const result = await response.json();
  if (!response.ok) throw Object.assign(Error(result.error || "Permintaan gagal."), {status: response.status});
  return result;
}

function staffLogin() {
  bar.replaceChildren();
  if (document.querySelector("#staff-form")) return;
  main.innerHTML = '<section class="pane login"><h2>Masuk ' + mode +
    '</h2><form id="staff-form"><label>Sandi staf<input type="password" name="password" required autocomplete="current-password"></label><button class="btn">Masuk</button></form></section>';
}

function refresh() { pendingRefresh ??= fetchState().finally(() => { pendingRefresh = null; }); return pendingRefresh; }
async function fetchState() {
  try {
    const next = await api();
    connection.textContent = "";
    if (mode === "kasir" && Object.entries(next.sessions).some(([number, session]) =>
      session.orders.length > (data.sessions[number]?.orders.length ?? 0) ||
      (session.bill && !data.sessions[number]?.bill))) beep();
    if (JSON.stringify(next) !== JSON.stringify(data) || !main.firstElementChild || document.querySelector("#staff-form")) {
      data = next;
      menu = next.menu;
      render();
    }
  } catch (error) {
    if (error.status === 401 && mode !== "menu") {
      connection.textContent = "";
      staffLogin();
    } else connection.textContent = "Koneksi ke server terputus. Mencoba lagi…";
  }
}

async function change(action, fields = {}, message = "") {
  try {
    await api({ action, table: selected, ...fields });
    await pendingRefresh;
    await refresh();
    if (message) flash(message);
    return true;
  } catch (error) {
    flash(error.message);
    return false;
  }
}

function guest(data) {
  const session = data.sessions[table];
  if (cart.length && session?.id !== cartSession) cart.length = 0;
  const categories = ["Semua", ...new Set(menu.map(item => item.category))];
  main.innerHTML = `
    <section class="hero"><div class="hero-copy">
      <p class="eyebrow">Rumah makan Nusantara · Meja ${String(table).padStart(2, "0")}</p>
      <h1>Rasa rumahan,<br><em>disajikan hangat.</em></h1>
      <p>Masakan Nusantara, camilan renyah, dan minuman segar untuk menemani santap Anda.</p>
    </div></section>
    <div class="section-head"><div><h2>Pilih hidangan</h2><p>${session ? "Pesan langsung dari meja." : "Minta kode meja aktif kepada pelayan."}</p></div>
    <div class="filters" aria-label="Kategori menu">${categories.map(name =>
      `<button class="chip ${category === name ? "active" : ""}" aria-pressed="${category === name}" data-action="category" data-value="${name}">${name}</button>`).join("")}</div></div>
    ${!session && data.occupied ? `<form id="join-form" class="pane actions"><label>Kode meja<input name="code" required minlength="10" maxlength="10" autocapitalize="characters" autocomplete="off"></label><button class="btn">Masuk meja</button></form>` : ""}
    <section class="grid" aria-label="Daftar hidangan">${menu.filter(item => category === "Semua" || category === item.category).map(item => `
      <article class="card">
        ${item.image ? `<img class="dish-image" src="https://images.unsplash.com/photo-${item.image}?auto=format&fit=crop&w=620&q=78" alt="Ayam bakar dengan nasi" loading="lazy">` : ""}
        <div class="card-body"><p class="eyebrow">${escape(item.category)}</p><h3>${escape(item.name)}</h3><p class="muted">${escape(item.note)}</p>
        <div class="price-line"><span>${money(item.price)}</span><button class="btn" data-action="dish" data-value="${item.id}" ${!session || data.soldOut.includes(item.id) ? "disabled" : ""}>${data.soldOut.includes(item.id) ? "Habis" : "Pilih"}</button></div></div>
      </article>`).join("")}</section>
    ${session?.orders.length ? `<div class="section-head"><h2>Pesanan meja</h2>${session.bill ? '<span class="pill">Tagihan diminta</span>' : button("Minta tagihan", "bill", session.id, "secondary")}</div>
      <section class="pane stack">${session.orders.map(order => ticket(order, table)).join("")}<strong>Total pesanan · ${money(sessionTotal(session))}</strong></section>` : ""}`;
  bar.innerHTML = cart.length ? `<div class="bottom"><div class="wrap row"><strong>${cart.reduce((sum, item) => sum + item.quantity, 0)} item · ${money(total(cart))}</strong>
    ${button("Lihat keranjang", "cart", "", "btn warm")}</div></div>` : "";
}

function staff(data) {
  bar.replaceChildren();
  const entries = Object.entries(data.sessions);
  const all = entries.flatMap(([number, session]) => session.orders.map(order => ({ number, order })));
  if (mode === "dapur") {
    const queue = all.filter(({ order }) => ["diterima", "siap"].includes(order.status));
    main.innerHTML = `<div class="section-head"><div><p class="eyebrow">Dapur Sore</p><h2>Antrean dapur</h2></div><span class="pill">${queue.length} tiket aktif</span>${button("Keluar", "logout", "", "secondary")}</div>
      <section class="grid">${queue.map(({ number, order }) => `<div class="pane">${ticket(order, number, order.status === "diterima" ? button("Siap diantar", "status", `${number}:${order.id}:siap`) : "")}</div>`).join("") || '<p class="muted">Belum ada tiket untuk disiapkan.</p>'}</section>`;
    return;
  }
  const fresh = all.filter(({ order }) => order.status === "baru");
  const session = data.sessions[selected];
  const canPay = session?.orders.length && session.orders.every(order => order.status === "disajikan");
  main.innerHTML = `<div class="section-head"><div><p class="eyebrow">Dapur Sore</p><h2>Kasir</h2></div>
      <div class="actions">${button("Keluar", "logout", "", "secondary")}${button(sound ? "Suara aktif" : "Aktifkan suara", "sound", "", "secondary")}</div></div>
    <div class="ops">
      <div class="stack"><section class="pane"><h3>Peta meja</h3><p class="muted">Pilih meja untuk melihat tagihan.</p><div class="grid">${tables.map(number => {
        const seat = data.sessions[number];
        const state = seat?.bill ? "Minta bayar" : seat?.orders.some(order => order.status === "baru") ? "Pesanan baru" : seat ? "Terisi" : "Kosong";
        return button(`Meja ${number}<br><small>${state}</small>`, "table", number, selected === number ? "btn" : "secondary");
      }).join("")}</div></section>
      <section class="pane stack"><div class="row"><h3>Kelola menu</h3>${button('Tambah','edit-menu',0)}</div>${menu.map(item => `<div class="row"><span>${escape(item.name)}${item.hidden ? " · Tersembunyi" : ""}</span><div class="actions">${button("Edit", "edit-menu", item.id, "secondary")}${button(data.soldOut.includes(item.id) ? "Aktifkan" : "Tandai habis", "sold", item.id, "secondary")}</div></div>`).join("")}</section></div>
      <div class="stack">
        <section class="pane stack"><div class="row"><h3>Pesanan baru</h3><span class="pill">${fresh.length}</span></div>
        ${fresh.map(({ number, order }) => ticket(order, number, button("Terima pesanan", "status", `${number}:${order.id}:diterima`))).join("") || '<p class="muted">Antrean kosong.</p>'}</section>
        <section class="pane stack"><div class="row"><h3>Meja ${selected}</h3>${button("QR meja", "qr", selected, "secondary")}</div>
        ${session ? `<div class="row"><span>Kode sesi tamu</span><strong>${escape(session.code)}</strong></div>${session.bill ? '<span class="pill">Tamu meminta tagihan</span>' : ""}
          ${session.orders.map(order => ticket(order, selected, order.status === "siap" ? button("Sudah disajikan", "status", `${selected}:${order.id}:disajikan`) : "")).join("")}
          <div class="row totals"><strong>Total</strong><strong>${money(sessionTotal(session))}</strong></div>
          ${canPay ? `<div class="actions">${button("Lunas tunai", "pay", "Tunai")}${button("Lunas QRIS", "pay", "QRIS")}</div>` :
            session.orders.length ? '<p class="muted">Pembayaran tersedia setelah semua pesanan disajikan.</p>' : button("Tutup meja kosong", "close", "", "secondary")}
        ` : button("Buka meja", "open")}</section>
        ${data.payments.length ? `<section class="pane"><h3>Pembayaran tercatat</h3>${data.payments.slice(-5).reverse().map(payment => `<p class="row"><span>Meja ${payment.number} · ${payment.method}</span><strong>${money(payment.amount)}</strong></p>`).join("")}</section>` : ""}
      </div></div>`;
}

function render() {
  const data = load();
  if (mode === "menu") guest(data);
  else staff(data);
}

function showCart() {
  dialog.innerHTML = `<h3>Keranjang · Meja ${table}</h3><div class="stack">${cart.map((item, index) => `
    <div class="row"><p><strong>${item.quantity} × ${escape(item.name)}</strong><br>${escape(item.note)}</p>${button("Hapus", "remove", index, "secondary")}</div>`).join("")}
    <div class="row totals"><strong>Total</strong><strong>${money(total(cart))}</strong></div>
    <div class="actions">${button("Kembali", "dismiss", "", "secondary")}${cart.length ? button("Kirim pesanan", "send", "", "btn warm") : ""}</div></div>`;
  if (!dialog.open) dialog.showModal();
}

document.addEventListener("submit", async event => {
  if (["staff-form", "join-form", "menu-form"].includes(event.target.id)) {
    event.preventDefault();
    const fields = new FormData(event.target);
    const submit = event.target.querySelector("button[type=submit],button:not([type])");
    submit.disabled = true;
    if (event.target.id === "staff-form") {
      await change("login", { role: mode, password: fields.get("password") });
    } else if (event.target.id === "join-form") {
      guestCode = String(fields.get("code")).trim().toUpperCase();
      if (await change("join", { table })) sessionStorage.setItem(codeKey, guestCode);
      else guestCode = sessionStorage.getItem(codeKey) || "";
    } else if (await change("menu", { item: { id: Number(fields.get("id")), name: fields.get("name"),
      category: fields.get("category"), price: Number(fields.get("price")), note: fields.get("note"),
      hidden: fields.has("hidden") } }, "Menu disimpan.")) dialog.close();
    submit.disabled = false;
    return;
  }
  if (event.target.id !== "dish-form") return;
  event.preventDefault();
  const session = current();
  if (!session || session.id !== event.target.dataset.session) {
    dialog.close();
    flash("Sesi meja berubah. Silakan pilih menu lagi.");
    return;
  }
  const fields = new FormData(event.target);
  const item = menu.find(dish => dish.id === Number(fields.get("id")));
  cartSession = session.id;
  requestId = "";
  cart.push({ id: item.id, name: item.name, price: item.price, quantity: Number(fields.get("quantity")), note: String(fields.get("note")).trim() });
  dialog.close();
  render();
  flash("Ditambahkan ke keranjang.");
});

document.addEventListener("click", async event => {
  const control = event.target.closest("[data-action]");
  if (!control) return;
  const { action, value } = control.dataset;
  switch (action) {
    case "category": category = value; render(); break;
    case "table": selected = Number(value); render(); break;
    case "dismiss": dialog.close(); break;
    case "cart": showCart(); break;
    case "remove": requestId = ""; cart.splice(Number(value), 1); render(); showCart(); break;
    case "qr": {
      dialog.innerHTML = '<div class="table-qr"><h3>Dapur Sore · Meja ' + Number(value) +
        '</h3><img width="240" height="240" alt="QR menu meja"><p>Pindai untuk membuka menu.</p><div class="actions">' +
        button("Tutup", "dismiss", "", "secondary") + button("Cetak", "print") + '</div></div>';
      try { dialog.querySelector("img").src = "/api/restaurant?view=qr&table=" + Number(value); dialog.showModal(); }
      catch { flash("QR meja tidak bisa dibuat."); }
      break;
    }
    case "print": window.print(); break;
    case "logout": if (await change("logout")) location.reload(); break;
    case "edit-menu": {
      const item = menu.find(dish => dish.id === Number(value)) || {id:0,name:"",price:0,category:"Makanan",note:""};
      dialog.innerHTML = '<form id="menu-form"><h3>' + (item.id ? 'Edit hidangan' : 'Tambah hidangan') + '</h3>' +
        '<input type="hidden" name="id" value="' + item.id + '">' +
        '<label>Nama<input name="name" required maxlength="80" value="' + escape(item.name) + '"></label>' +
        '<label>Kategori<select name="category">' + ["Makanan","Minuman","Camilan"].map(category =>
          '<option ' + (category === item.category ? 'selected' : '') + '>' + category + '</option>').join("") + '</select></label>' +
        '<label>Harga (Rp)<input name="price" required type="number" min="0" max="10000000" value="' + item.price + '"></label>' +
        '<label>Deskripsi<textarea name="note" maxlength="180">' + escape(item.note) + '</textarea></label>' +
        '<label><span><input type="checkbox" name="hidden" ' + (item.hidden ? 'checked' : '') + '> Sembunyikan dari menu</span></label>' +
        '<div class="actions">' + button("Batal", "dismiss", "", "secondary") + '<button class="btn">Simpan</button></div></form>';
      dialog.showModal();
      break;
    }
    case "dish": {
      const item = menu.find(dish => dish.id === Number(value));
      const session = current();
      if (!session) return;
      dialog.innerHTML = `<form id="dish-form" data-session="${session.id}"><h3>${escape(item.name)}</h3><p>${money(item.price)}</p>
        <input type="hidden" name="id" value="${item.id}"><label>Jumlah<select name="quantity">${Array.from({length: 10}, (_, index) => `<option>${index + 1}</option>`).join("")}</select></label>
        <label>Catatan dapur<textarea name="note" maxlength="120" rows="2" placeholder="Misalnya, sambal dipisah"></textarea></label>
        <div class="actions">${button("Batal", "dismiss", "", "secondary")}<button class="btn">Tambah ke keranjang</button></div></form>`;
      dialog.showModal();
      break;
    }
    case "send": {
      control.disabled = true;
      requestId ||= crypto.randomUUID();
      if (await change("send", { table, session: cartSession, requestId, items: [...cart] }, "Pesanan dikirim ke kasir.")) {
        cart.length = 0;
        requestId = "";
        dialog.close();
        render();
      }
      control.disabled = false;
      break;
    }
    case "bill": await change("bill", { table, session: value }, "Kasir menerima permintaan tagihan."); break;
    case "open": await change("open"); break;
    case "close": await change("close", { session: data.sessions[selected]?.id }); break;
    case "sold": await change("sold", { value, sold: !data.soldOut.includes(Number(value)) }); break;
    case "status": await change("status", { value }); break;
    case "pay": {
      const session = data.sessions[selected];
      if (!session) break;
      const amount = sessionTotal(session);
      if (!confirm("Catat pembayaran " + value + " sebesar " + money(amount) + " untuk Meja " + selected + "?")) break;
      await change("pay", { value, session: session.id, amount, orderCount: session.orders.length }, "Pembayaran dicatat. Meja ditutup.");
      break;
    }
    case "sound":
      try {
        sound ??= new AudioContext();
        await sound.resume();
        beep();
        render();
      } catch { flash("Suara tidak tersedia di browser ini."); }
      break;
  }
});

function beep() {
  if (sound?.state !== "running") return;
  const tone = sound.createOscillator();
  const volume = sound.createGain();
  volume.gain.setValueAtTime(.14, sound.currentTime);
  volume.gain.exponentialRampToValueAtTime(.001, sound.currentTime + .29);
  tone.frequency.value = 740;
  tone.connect(volume).connect(sound.destination);
  tone.start();
  tone.stop(sound.currentTime + .3);
}

document.querySelector('[data-view="' + mode + '"]').setAttribute("aria-current", "page");
refresh();
setInterval(refresh, mode === "menu" ? 5000 : 3000);
window.addEventListener("focus", refresh);
if ("serviceWorker" in navigator && location.protocol !== "file:") {
  navigator.serviceWorker.register("sw.js").catch(error => console.warn("Service worker:", error));
}


