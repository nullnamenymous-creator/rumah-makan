const { cpSync, mkdirSync } = require("node:fs");
mkdirSync("dist", { recursive: true });
for (const file of ["index.html", "style.css", "app.js", "manifest.webmanifest", "sw.js", "assets"]) {
  cpSync(file, "dist/" + file, { recursive: true });
}
