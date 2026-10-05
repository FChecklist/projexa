// Placeholder web node: proves the phone is reachable before a real PROJEXA
// bundle is deployed. Same port and health route as the real app.
const http = require("http");
const os = require("os");
const started = Date.now();
http
  .createServer((req, res) => {
    if (req.url === "/api/health") {
      res.writeHead(200, { "content-type": "application/json" });
      return res.end(
        JSON.stringify({
          ok: true,
          placeholder: true,
          node: process.version,
          arch: process.arch,
          uptime_s: Math.round((Date.now() - started) / 1000),
          free_mb: Math.round(os.freemem() / 1048576),
          rss_mb: Math.round(process.memoryUsage().rss / 1048576),
        }),
      );
    }
    res.writeHead(200, { "content-type": "text/plain" });
    res.end("projexa phone node up (placeholder)\n");
  })
  .listen(3100, "0.0.0.0", () => console.log("placeholder listening on 3100"));
