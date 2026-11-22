import { createServer } from "node:http";
import { readFile, stat } from "node:fs/promises";
import { resolve, extname, sep } from "node:path";

const ROOT = resolve(process.cwd());
const PORT = Number(process.env.PORT || 3000);
const MIME = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".svg": "image/svg+xml",
  ".webp": "image/webp",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".png": "image/png",
  ".gif": "image/gif",
  ".ico": "image/x-icon",
  ".woff2": "font/woff2"
};

createServer(async (request, response) => {
  response.setHeader("X-Robots-Tag", "noindex, nofollow, noarchive");
  response.setHeader("X-Content-Type-Options", "nosniff");
  response.setHeader("Referrer-Policy", "strict-origin-when-cross-origin");
  response.setHeader("Cache-Control", "no-store");
  if (!["GET", "HEAD"].includes(request.method)) {
    response.writeHead(405, { Allow: "GET, HEAD" }).end();
    return;
  }

  let pathname;
  try { pathname = decodeURIComponent(new URL(request.url, "http://localhost").pathname); }
  catch { response.writeHead(400).end("Bad URL"); return; }
  // This is a public visual preview, not a repository source browser.
  const path = resolve(ROOT, "." + pathname);
  if (path !== ROOT && !path.startsWith(ROOT + sep)) {
    response.writeHead(403).end("Forbidden");
    return;
  }
  if (pathname.split("/").some(part => part.startsWith("."))) {
    response.writeHead(404).end("Not found");
    return;
  }
  const file = pathname.endsWith("/") ? resolve(path, "index.html") : path;
  const extension = extname(file).toLowerCase();
  if (!Object.hasOwn(MIME, extension)) {
    response.writeHead(404).end("Not found");
    return;
  }
  try {
    const meta = await stat(file);
    if (!meta.isFile() || meta.size > 10 * 1024 * 1024) {
      response.writeHead(404).end("Not found");
      return;
    }
    const content = await readFile(file);
    response.writeHead(200, { "Content-Type": MIME[extension], "Content-Length": content.length });
    response.end(request.method === "HEAD" ? undefined : content);
  } catch {
    response.writeHead(404).end("Not found");
  }
}).listen(PORT, "0.0.0.0", () => {
  console.log("Sdelano preview listening on port " + PORT);
});
