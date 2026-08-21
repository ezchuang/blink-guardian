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
    assert.match(html, /TIMER_UPDATE_INTERVAL = MINI_MODE \|\| MOBILE_COMPACT \? 1000 : 20/);
    assert.match(html, /now - lastTimerUpdateAt < TIMER_UPDATE_INTERVAL/);
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
    assert.match(html, /id="miniMonitorPanel"/);
    assert.match(html, /id="miniRateValue">0</);
    assert.match(html, /window\.open\(miniUrl\.href, "blinkGuardianMonitor"/);
    assert.match(html, /popup,width=320,height=240/);
    assert.doesNotMatch(html, /searchParams\.set\("autostart"/);
    assert.match(html, /function primeAudio\(\)/);
    assert.match(html, /class="mini-sound-setting"><span>提示音<\/span><button class="toggle" id="miniSoundButton"[^>]+aria-pressed="true"><\/button>/);
    assert.match(html, /navigator\.locks\.request\(MONITOR_LOCK_NAME, \{ ifAvailable: true \}/);
    assert.match(html, /new BroadcastChannel\("blink-guardian"\)/);
    assert.match(html, /standardFps: 15, degradedFps: 12/);
    assert.match(html, /width: \{ ideal: 480, max: 640 \}/);
    assert.match(html, /frameRate: \{ ideal: 15, max: 20 \}/);
    assert.match(html, /Math\.min\(MOBILE_COMPACT \? 1 : 2, window\.devicePixelRatio/);
  }
});

test("resuming monitoring does not consume the reminder cooldown", async () => {
  const source = await readFile(sourceUrl, "utf8");
  const handler = source.match(/function handleVisibilityChange\(\) \{[\s\S]*?\n    \}/)?.[0];

  assert.ok(handler, "visibility change handler should exist");
  assert.match(handler, /exposureTracker\.reset\(now\)/);
  assert.doesNotMatch(handler, /lastReminderAt\s*=/);
});
