import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const sourceUrl = new URL("../index.html", import.meta.url);
const builtUrl = new URL("../dist/index.html", import.meta.url);

test("ships the Blink Guardian experience", async () => {
  const [source, built] = await Promise.all([
    readFile(sourceUrl, "utf8"),
    readFile(builtUrl, "utf8"),
  ]);

  for (const html of [source, built]) {
    assert.match(html, /<title>眨眼守門員 Blink Guardian<\/title>/);
    assert.match(html, /https:\/\/ezchuang\.github\.io\/blink-guardian\//);
    assert.match(html, /navigator\.mediaDevices\.getUserMedia/);
    assert.match(html, /width: \{ ideal: 640, max: 960 \}/);
    assert.match(html, /height: \{ ideal: 480, max: 720 \}/);
    assert.match(html, /frameRate: \{ ideal: 24, max: 30 \}/);
    assert.match(html, /AdaptiveInferenceScheduler/);
    assert.match(html, /getBlinkGuardianDiagnostics/);
    assert.match(html, /function updateTimerDisplay\(now\)/);
    assert.match(html, /now - lastTimerUpdateAt < 20/);
    assert.match(html, /exposureTracker\.openMs \+ projectedOpenMs/);
    assert.match(html, /updateTimerDisplay\(now\);/);
    assert.match(html, /@mediapipe\/tasks-vision@\$\{MP_VERSION\}/);
    assert.match(html, /影像只在你的裝置上處理/);
    assert.match(html, /連續開眼提醒/);
    assert.match(html, /眨眼節奏紀錄/);
    assert.match(html, /AngleRobustBlinkDetector/);
    assert.match(html, /OpenEyeExposureTracker/);
    assert.match(html, /閉眼期間不會繼續計時/);
    assert.match(html, /會依臉部角度調整左右眼的判定權重/);
    assert.match(html, /眨眼靈敏度/);
    assert.match(html, /id="sensitivityRange"[^>]+max="6"[^>]+value="3"/);
    assert.doesNotMatch(html, /blinkGuardian\.sensitivity/);
    assert.match(html, /BlinkTrendTracker/);
    assert.match(html, /closureMs: currentClosureDuration/);
    assert.match(html, /平均閉眼時長/);
    assert.match(html, /TREND_REMINDER_COOLDOWN = 120000/);
    assert.match(html, /data-window="1440"/);
    assert.match(html, /HISTORY_MAX_AGE = 24 \* 60 \* 60 \* 1000/);
    assert.match(html, /localStorage\.setItem\(HISTORY_KEY/);
    assert.match(html, /visibilitychange/);
    assert.match(html, /頁面進入背景或視窗最小化/);
  }
});
