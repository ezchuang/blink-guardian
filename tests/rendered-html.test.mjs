import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const sourceUrl = new URL("../public/blink-guardian.html", import.meta.url);
const builtUrl = new URL("../dist/client/blink-guardian.html", import.meta.url);

test("ships the Blink Guardian experience", async () => {
  const [source, built] = await Promise.all([
    readFile(sourceUrl, "utf8"),
    readFile(builtUrl, "utf8"),
  ]);

  for (const html of [source, built]) {
    assert.match(html, /<title>眨眼守門員 Blink Guardian<\/title>/);
    assert.match(html, /navigator\.mediaDevices\.getUserMedia/);
    assert.match(html, /@mediapipe\/tasks-vision@\$\{MP_VERSION\}/);
    assert.match(html, /影像只在你的裝置上處理/);
    assert.match(html, /提醒目標/);
    assert.match(html, /眨眼節奏紀錄/);
    assert.match(html, /AngleRobustBlinkDetector/);
    assert.match(html, /會依臉部角度調整左右眼的判定權重/);
    assert.match(html, /data-window="1440"/);
    assert.match(html, /HISTORY_MAX_AGE = 24 \* 60 \* 60 \* 1000/);
    assert.match(html, /localStorage\.setItem\(HISTORY_KEY/);
    assert.match(html, /visibilitychange/);
    assert.match(html, /頁面進入背景或視窗最小化/);
  }
});
