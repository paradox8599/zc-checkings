const http = require("http");
const fs = require("fs");

const records = [
  { date: "2026-07-01", clockIn: "08:55", clockOut: "18:20" },
  { date: "2026-07-02", clockIn: "09:10", clockOut: "19:40" },
  { date: "2026-07-03", clockIn: "09:00", clockOut: "21:00" },
  { date: "2026-07-04", clockIn: "", clockOut: "" },
  { date: "2026-07-07", clockIn: "09:05", clockOut: "17:50" },
];

http
  .createServer((req, res) => {
    if (req.url.startsWith("/api/attendance/list")) {
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ code: 0, data: { list: records, total: records.length } }));
    } else if (req.url === "/") {
      res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
      res.end(fs.readFileSync(__dirname + "/mock.html"));
    } else {
      res.writeHead(404);
      res.end("not found");
    }
  })
  .listen(8878, () => console.log("mock on 8878"));
