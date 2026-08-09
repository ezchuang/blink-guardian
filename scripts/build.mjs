import { copyFile, cp, mkdir, rm, writeFile } from "node:fs/promises";

const root = new URL("../", import.meta.url);
const dist = new URL("../dist/", import.meta.url);

await rm(dist, { recursive: true, force: true });
await mkdir(dist, { recursive: true });
await Promise.all([
  copyFile(new URL("index.html", root), new URL("index.html", dist)),
  copyFile(new URL("blink-detector.js", root), new URL("blink-detector.js", dist)),
  cp(new URL("assets/", root), new URL("assets/", dist), { recursive: true }),
  writeFile(new URL(".nojekyll", dist), "", "utf8")
]);

console.log("Static site built in dist/");
