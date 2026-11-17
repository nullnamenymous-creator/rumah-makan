const production = process.env.VERCEL === "1";
let database;

function local() {
  if (production || !process.env.LOCAL_DB_PATH) throw Error("Database belum dikonfigurasi.");
  if (!database) {
    const { DatabaseSync } = require("node:sqlite");
    database = new DatabaseSync(process.env.LOCAL_DB_PATH);
    database.exec(`create table if not exists restaurant (id integer primary key, revision integer, data text);
      insert or ignore into restaurant values (1, 0, '{"sessions":{},"soldOut":[],"payments":[]}');`);
  }
  return database;
}

async function request(filter, options = {}) {
  const key = process.env.SUPABASE_SECRET_KEY;
  if (!key) throw Error("Database belum dikonfigurasi.");
  const response = await fetch(`${process.env.SUPABASE_URL.replace(/\/$/, "")}/rest/v1/dapur_sore_state?${filter}`, {
    ...options,
    headers: { apikey: key, ...(key.startsWith("eyJ") ? { Authorization: `Bearer ${key}` } : {}),
      "Content-Type": "application/json", Prefer: "return=representation" },
    signal: AbortSignal.timeout(7000)
  });
  if (!response.ok) throw Error(`Database mengembalikan HTTP ${response.status}.`);
  return response.json();
}

async function read() {
  if (process.env.SUPABASE_URL) {
    const [row] = await request("id=eq.1&select=revision,data");
    if (!row) throw Error("Database belum diinisialisasi.");
    return row;
  }
  const row = local().prepare("select revision,data from restaurant where id=1").get();
  return { revision: row.revision, data: JSON.parse(row.data) };
}

async function mutate(update) {
  for (let attempt = 0; attempt < 8; attempt++) {
    const { revision, data } = await read();
    const result = update(data);
    if (process.env.SUPABASE_URL) {
      const rows = await request(`id=eq.1&revision=eq.${revision}`, {
        method: "PATCH", body: JSON.stringify({ revision: revision + 1, data })
      });
      if (rows.length) return result;
    } else {
      const { changes } = local().prepare("update restaurant set revision=revision+1,data=? where id=1 and revision=?")
        .run(JSON.stringify(data), revision);
      if (changes) return result;
    }
  }
  const error = Error("Ada perubahan bersamaan. Silakan coba kembali.");
  error.status = 409;
  throw error;
}

module.exports = { read, mutate };
