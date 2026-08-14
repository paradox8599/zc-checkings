import { createServer } from "node:http";
import { createReadStream, existsSync, statSync } from "node:fs";
import { join, normalize } from "node:path";

const ROOT = join(import.meta.dirname, "..", "dist");
const PORT = Number(process.env.PORT || 8877);

createServer((req, res) => {
  const path = normalize(join(ROOT, req.url.split("?")[0]));
  if (!path.startsWith(ROOT) || !existsSync(path)) {
    res.writeHead(404).end("not found");
    return;
  }
  res.writeHead(200, {
    "Content-Type": "text/javascript",
    "Cache-Control": "no-store",
    "Content-Length": statSync(path).size,
  });
  createReadStream(path).pipe(res);
}).listen(PORT, () => console.log(`serving ${ROOT} on :${PORT}`));
