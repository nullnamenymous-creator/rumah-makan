const http = require("node:http");
const fs = require("node:fs");
const api = require("./api/restaurant");
const assets = {
  "/": "text/html; charset=utf-8", "/index.html": "text/html; charset=utf-8",
  "/app.js": "text/javascript", "/sw.js": "text/javascript",
  "/style.css": "text/css", "/manifest.webmanifest": "application/manifest+json",
  "/assets/icon-192.png": "image/png", "/assets/icon-512.png": "image/png"
};

http.createServer(async (req, res) => {
  const path = new URL(req.url, "http://localhost").pathname;
  if (path === "/api/restaurant") {
    res.status = status => { res.statusCode = status; return res; };
    res.json = data => { res.setHeader("Content-Type", "application/json"); res.end(JSON.stringify(data)); };
    const parts = [];
    let bytes = 0;
    for await (const part of req) {
      bytes += part.length;
      if (bytes > 16000) return res.status(413).json({ error: "Permintaan terlalu besar." });
      parts.push(part);
    }
    req.body = Buffer.concat(parts).toString();
    return api(req, res);
  }
  if (!Object.hasOwn(assets, path)) return res.writeHead(404).end();
  res.setHeader("Content-Type", assets[path]);
  fs.createReadStream(path === "/" ? "index.html" : "." + path)
    .on("error", () => res.writeHead(404).end()).pipe(res);
}).listen(Number(process.env.PORT || 8766), "127.0.0.1");
