import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import vm from "node:vm";
import { openReminderStatus, OpenEyeExposureTracker, BlinkTrendTracker } from "../blink-detector.js";

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
    assert.match(html, /取得可信的開眼基準後恢復計時/);
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

test("source and published entry scripts parse successfully", async () => {
  for (const url of [sourceUrl, builtUrl]) {
    const html = await readFile(url, "utf8");
    const script = html.match(/<script type="module">([\s\S]*?)<\/script>/)?.[1];
    assert.ok(script);
    new vm.Script(script.replace(/^\s*import .* from .*;$/m, ""));
  }
});

test("monitoring UI explains calibration, eye rest, lost continuity and cooldown", async () => {
  const source = await readFile(sourceUrl, "utf8");
  const fn = source.match(/function updateMonitoringStatus\(now, reminder\) \{[\s\S]*?\n    \}/)?.[0];
  assert.ok(fn);
  let displayed;
  const context = vm.createContext({
    faceLastSeen: 20000, OBSERVATION_STALE_MS: 250, calibrationUntil: 0,
    lastDetection: null, currentEyeState: "open",
    exposureTracker: { continuityLost: false, restartedAt: -Infinity },
    blinkTrendTracker: { metrics: () => ({ observedMs: 10000 }) },
    setStatus: (...args) => { displayed = args; }
  });
  vm.runInContext(fn, context);
  const reminder = openReminderStatus({ now: 20000, eyeState: "open", openMs: 15000, targetMs: 10000, lastReminderAt: 10000 });
  context.updateMonitoringStatus(20000, reminder);
  assert.equal(displayed[0], "張眼中");
  assert.match(displayed[2], /間隔中，還有 50 秒/);
  context.lastDetection = { recalibrating: true };
  context.updateMonitoringStatus(20000, reminder);
  assert.equal(displayed[0], "角度校正");
  context.lastDetection = null;
  context.currentEyeState = "resting";
  context.updateMonitoringStatus(20000, reminder);
  assert.equal(displayed[0], "閉眼休息");
  context.currentEyeState = "uncertain";
  context.exposureTracker.continuityLost = true;
  context.updateMonitoringStatus(20000, reminder);
  assert.match(displayed[2], /連續時間已中斷/);
  context.currentEyeState = "open";
  context.exposureTracker.continuityLost = false;
  context.exposureTracker.restartedAt = 20000;
  context.updateMonitoringStatus(20000, reminder);
  assert.match(displayed[1], /重新累計/);
  context.updateMonitoringStatus(21000, reminder);
  assert.equal(displayed[0], "等待影像");
});

test("page loop waits for accepted calibration and preserves exposure during a pose transition", async () => {
  const source = await readFile(sourceUrl, "utf8");
  let now = 10000;
  let calibrationReady = false;
  let detectionCalls = 0;
  let result = { state: "open", leftLevel: 0, rightLevel: 0, closeThreshold: .43 };
  const tracker = new OpenEyeExposureTracker();
  tracker.reset(now);
  const context = vm.createContext({
    running: true, performance: { now: () => now }, lastVideoTime: -1, lastMeterUpdateAt: -Infinity,
    calibrationUntil: 9000, currentEyeState: "uncertain", lastDetection: null,
    faceLastSeen: -Infinity, OBSERVATION_STALE_MS: 250, animationId: null,
    ui: { video: { readyState: 2, currentTime: 1, videoWidth: 640, videoHeight: 480 }, left: { style: {} }, right: { style: {} } },
    landmarker: { detectForVideo: () => ({ faceBlendshapes: [{ categories: [{ categoryName: "eyeBlinkLeft", score: .05 }] }], faceLandmarks: [[]] }) },
    inferenceScheduler: { shouldRun: () => true, record() {} },
    blinkDetector: { addCalibrationFrame() {}, finishCalibration: () => calibrationReady,
      update: () => { detectionCalls++; return result; }, resetMotion() {} },
    exposureTracker: tracker, blinkTrendTracker: new BlinkTrendTracker(),
    setThresholdMarker() {}, registerRest() {}, registerBlink() {}, updateStats() {}, updateTimerDisplay() {},
    requestAnimationFrame() {}, console
  });
  for (const name of ["loop", "finishCalibration", "blendScore"]) {
    const fn = source.match(new RegExp(`function ${name}\\([^)]*\\) \\{[\\s\\S]*?\\n    \\}`))?.[0];
    assert.ok(fn);
    vm.runInContext(fn, context);
  }
  context.loop();
  assert.equal(context.calibrationUntil, 9000, "elapsed time alone must not finish calibration");
  assert.equal(detectionCalls, 0);
  assert.equal(tracker.openMs, 0);
  calibrationReady = true;
  now += 50;
  context.ui.video.currentTime++;
  context.loop();
  assert.equal(context.calibrationUntil, 0);
  assert.equal(detectionCalls, 1);
  assert.equal(context.currentEyeState, "open");
  for (let index = 0; index < 20; index++) {
    now += 50;
    context.ui.video.currentTime++;
    context.loop();
  }
  const beforePose = tracker.openMs;
  assert.ok(beforePose > 0);
  result = { ...result, poseChanged: true, recalibrating: true, state: "uncertain" };
  now += 50;
  context.ui.video.currentTime++;
  context.loop();
  assert.equal(tracker.openMs, beforePose);
  assert.equal(context.currentEyeState, "uncertain");
  now += 3500;
  context.loop(); // The video timestamp is unchanged: no inference result is available.
  assert.equal(tracker.continuityLost, true);
  assert.equal(tracker.openMs, 0);
});

test("resuming monitoring does not consume the reminder cooldown", async () => {
  const source = await readFile(sourceUrl, "utf8");
  const handler = source.match(/function handleVisibilityChange\(\) \{[\s\S]*?\n    \}/)?.[0];

  assert.ok(handler, "visibility change handler should exist");
  assert.match(handler, /exposureTracker\.reset\(now\)/);
  assert.doesNotMatch(handler, /lastReminderAt\s*=/);
});
