import { createServer } from "node:http";
import { createReadStream, readFileSync, statSync } from "node:fs";
import path from "node:path";
import process from "node:process";

const version = process.argv[2];
if (!version) throw new Error("Usage: node feed-server.mjs <version>");

const generatedRoot = process.env.DST_SPARKLE_GENERATED_ROOT ?? "/private/tmp/debate-studio-sparkle-validation";
const root = path.resolve(generatedRoot, "feed", version);
const mode = process.env.DST_SPARKLE_FEED_MODE ?? "normal";
const types = new Map([
  [".xml", "application/xml; charset=utf-8"],
  [".zip", "application/zip"],
  [".md", "text/markdown; charset=utf-8"],
]);

const server = createServer((request, response) => {
  const rawPath = new URL(request.url ?? "/", "http://127.0.0.1").pathname;
  const name = rawPath === "/" ? "appcast.xml" : decodeURIComponent(rawPath.slice(1));
  if (name.includes("/") || name.includes("\\") || name.includes("..")) {
    response.writeHead(400).end("invalid path");
    return;
  }
  const file = path.join(root, name);
  try {
    const stats = statSync(file);
    response.writeHead(200, {
      "Content-Type": types.get(path.extname(file)) ?? "application/octet-stream",
      "Content-Length": stats.size,
      "Cache-Control": "no-store",
    });
    if (mode === "truncate-archive" && path.extname(file) === ".zip") {
      const cutoff = Math.min(stats.size - 1, 1024 * 1024);
      const stream = createReadStream(file, { start: 0, end: cutoff - 1 });
      stream.on("end", () => response.destroy());
      stream.pipe(response, { end: false });
      process.stdout.write(
        `${new Date().toISOString()} ${request.method} ${rawPath} interrupted ${cutoff}/${stats.size}\n`,
      );
      return;
    }
    if (path.extname(file) === ".zip") {
      createReadStream(file).pipe(response);
    } else {
      response.end(readFileSync(file));
    }
    process.stdout.write(
      `${new Date().toISOString()} ${request.method} ${rawPath} 200 ${stats.size} mode=${mode}\n`,
    );
  } catch {
    response.writeHead(404).end("not found");
  }
});

server.listen(27891, "127.0.0.1", () => {
  process.stdout.write(
    `Sparkle test feed ${version} (${mode}): http://127.0.0.1:27891/appcast.xml\n`,
  );
});
