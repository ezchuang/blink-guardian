import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import vm from "node:vm";
import { openReminderStatus, OpenEyeExposureTracker, BlinkTrendTracker, StableMonitoringStatus, AdaptiveInferenceScheduler } from "../blink-detector.js";
import { RelativeDistanceTracker } from "../monitoring-features.js";

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
    new vm.Script(script.replace(/^\s*import .* from .*;$/gm, ""));
  }
});

test("main and mini status ignore brief flicker, show sustained changes, and stop immediately", async () => {
  const source = await readFile(sourceUrl, "utf8");
  const fn = source.match(/function setStatus\([^)]*\) \{[\s\S]*?\n    \}/)?.[0];
  assert.ok(fn);
  const node = () => ({ textContent: "", classList: { contains: () => false, toggle() {} } });
  const ui = Object.fromEntries(["status", "title", "hint", "live", "miniStatus", "miniTitle", "miniHint", "miniLive"].map((key) => [key, node()]));
  let now = 0;
  const context = vm.createContext({ ui, performance: { now: () => now }, statusDisplay: new StableMonitoringStatus() });
  vm.runInContext(fn, context);
  context.setStatus("監測中", "保持自然", "", true);
  for (now = 250; now <= 3000; now += 250) {
    context.setStatus(now % 500 ? "角度校正" : "監測中", "保持自然", "", true, true);
    assert.equal(ui.miniStatus.textContent, "監測中");
  }
  now = 4000;
  context.setStatus("閉眼休息", "休息中", "", true, true);
  now = 4750;
  context.setStatus("閉眼休息", "休息中", "", true, true);
  assert.equal(ui.miniStatus.textContent, "監測中");
  now = 5000;
  context.setStatus("閉眼休息", "休息中", "", true, true);
  assert.equal(ui.miniStatus.textContent, "閉眼休息");
  assert.equal(ui.status.textContent, "閉眼休息");
  now = 5100;
  context.setStatus("監測中", "保持自然", "", true, true);
  context.setStatus("已停止", "鏡頭已關閉", "", false);
  assert.equal(ui.miniStatus.textContent, "已停止");
  assert.equal(ui.title.textContent, "鏡頭已關閉");
});

test("monitoring UI explains calibration, eye rest, lost continuity and cooldown", async () => {
  const source = await readFile(sourceUrl, "utf8");
  const fn = source.match(/function updateMonitoringStatus\(now, reminder\) \{[\s\S]*?\n    \}/)?.[0];
  assert.ok(fn);
  let displayed;
  const context = vm.createContext({
    faceLastSeen: 20000, OBSERVATION_STALE_MS: 250, calibrationUntil: 0,
    features: { blink: true, distance: false },
    lastDetection: null, currentEyeState: "open",
    exposureTracker: { continuityLost: false, restartedAt: -Infinity },
    blinkTrendTracker: { metrics: () => ({ observedMs: 10000 }) },
    setStatus: (...args) => { displayed = args; }
  });
  vm.runInContext(fn, context);
  const reminder = openReminderStatus({ now: 20000, eyeState: "open", openMs: 15000, targetMs: 10000, lastReminderAt: 10000 });
  context.updateMonitoringStatus(20000, reminder);
  assert.equal(displayed[0], "監測中");
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
    features: { blink: true, distance: false }, busy: false, document: { hidden: false },
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
  const beforeDisabled = detectionCalls;
  let distanceCalls = 0;
  context.features.blink = false;
  context.features.distance = true;
  context.distanceTracker = { update() { distanceCalls++; } };
  context.blinkDetector.resetMotion = () => { throw new Error("disabled blink analysis ran"); };
  context.landmarker.detectForVideo = () => ({ faceLandmarks: [[{ x: .5, y: .5 }]] });
  now += 500;
  context.ui.video.currentTime++;
  context.loop();
  assert.equal(distanceCalls, 1, "distance-only processing works without blendshapes");
  assert.equal(detectionCalls, beforeDisabled);
});

async function featureHarness() {
  const source = await readFile(sourceUrl, "utf8");
  const ui = new Proxy({}, { get(target, key) {
    if (!(key in target)) {
      const classes = new Set();
      target[key] = { textContent: "", style: { setProperty() {} }, setAttribute() {},
        classList: { contains: (name) => classes.has(name), add: (name) => classes.add(name), remove: (name) => classes.delete(name) } };
    }
    return target[key];
  } });
  const calls = { stopped: 0, closed: 0, released: 0, options: [] };
  const context = vm.createContext({
    ui, features: { blink: true, distance: true, posture: false }, running: true, busy: false,
    document: { body: { classList: { remove() {} } } },
    postureMonitor: { stop() {}, worker: null, async start() { this.worker = {}; } },
    MP_MODULE: "mock", MP_WASM: "mock",
    performance: { now: () => 10000 }, MOBILE_COMPACT: false,
    distanceTracker: new RelativeDistanceTracker(), exposureTracker: new OpenEyeExposureTracker(),
    blinkTrendTracker: new BlinkTrendTracker(), inferenceScheduler: new AdaptiveInferenceScheduler(),
    blinkDetector: { resetCalibration() {} }, currentEyeState: "open", lastDetection: null,
    calibrationUntil: 0, nextBreakAt: 100000, lastVideoTime: 0, animationId: 1,
    activeReminder: null, breakTimer: null, DEFAULT_SENSITIVITY: 3,
    landmarker: { async setOptions(options) { calls.options.push(options); }, close() { calls.closed++; } },
    stream: { getTracks: () => [{ stop() { calls.stopped++; } }] },
    recordSample: () => false, releaseOwnership() { calls.released++; },
    cancelAnimationFrame() {}, updateSensitivity() {}, setStatus() {}, toast() {}, clearInterval() {}, console
  });
  for (const name of ["setFeature", "stop", "start", "updateFeatureControls", "updateDistanceReadout", "configureInference", "dismissReminder", "registerRest"]) {
    const fn = source.match(new RegExp(`(?:async )?function ${name}\\([^)]*\\) \\{[\\s\\S]*?\\n    \\}`))?.[0];
    assert.ok(fn, name);
    vm.runInContext(fn, context);
  }
  return { context, calls, ui };
}

test("feature switches reduce work, release camera when all off, and do not auto-start", async () => {
  const { context, calls, ui } = await featureHarness();
  context.exposureTracker.openMs = 9000;
  await context.setFeature("blink", false);
  assert.equal(context.running, true);
  assert.equal(context.exposureTracker.openMs, 0);
  assert.equal(context.inferenceScheduler.snapshot().targetFps, 2);
  assert.equal(calls.options.at(-1).outputFaceBlendshapes, false);
  assert.equal(calls.stopped, 0);
  await context.setFeature("distance", false);
  assert.equal(context.running, false);
  assert.equal(calls.stopped, 1);
  assert.equal(calls.closed, 1);
  assert.equal(calls.released, 1);
  assert.equal(ui.start.disabled, true);
  await context.start();
  assert.equal(context.running, false);
  await context.setFeature("blink", true);
  assert.equal(context.running, false);
  assert.equal(ui.start.disabled, false);
});

test("re-enabling blink restores inference speed and requires fresh calibration", async () => {
  const { context, calls } = await featureHarness();
  await context.setFeature("blink", false);
  await context.setFeature("blink", true);
  assert.equal(context.inferenceScheduler.snapshot().targetFps, 20);
  assert.equal(context.calibrationUntil, 11500);
  assert.equal(calls.options.at(-1).outputFaceBlendshapes, true);
});

test("eye rest cannot dismiss a distance alert, but disabling distance can", async () => {
  const { context, calls, ui } = await featureHarness();
  context.activeReminder = "distance";
  ui.reminder.classList.add("show");
  context.registerRest();
  assert.equal(ui.reminder.classList.contains("show"), true);
  await context.setFeature("distance", false);
  assert.equal(ui.reminder.classList.contains("show"), false);
  assert.equal(context.running, true);
  assert.equal(calls.stopped, 0);
  context.activeReminder = "exposure";
  ui.reminder.classList.add("show");
  context.registerRest();
  assert.equal(ui.reminder.classList.contains("show"), false);
});

test("a failed model switch shuts down the camera and releases ownership", async () => {
  const { context, calls } = await featureHarness();
  context.console = { error() {} };
  context.landmarker.setOptions = async () => { throw new Error("test failure"); };
  await context.setFeature("blink", false);
  assert.equal(context.running, false);
  assert.equal(context.busy, false);
  assert.equal(calls.stopped, 1);
  assert.equal(calls.released, 1);
});

test("posture-only monitoring keeps camera alive and releases it when the last toggle turns off", async () => {
  const { context, calls, ui } = await featureHarness();
  let workerStops=0;
  context.postureMonitor.stop=()=>{workerStops++;context.postureMonitor.worker=null;};
  await context.setFeature("posture",true);
  assert.ok(context.postureMonitor.worker);
  await context.setFeature("blink",false);
  await context.setFeature("distance",false);
  assert.equal(context.running,true);
  assert.equal(context.landmarker,null);
  assert.equal(calls.stopped,0);
  context.activeReminder="posture"; ui.reminder.classList.add("show");
  context.registerRest();assert.equal(ui.reminder.classList.contains("show"),true);
  await context.setFeature("posture",false);
  assert.equal(context.running,false);assert.equal(calls.stopped,1);
  assert.ok(workerStops>=2);assert.equal(ui.start.disabled,true);
});

test("resuming monitoring does not consume the reminder cooldown", async () => {
  const source = await readFile(sourceUrl, "utf8");
  const handler = source.match(/function handleVisibilityChange\(\) \{[\s\S]*?\n    \}/)?.[0];

  assert.ok(handler, "visibility change handler should exist");
  assert.match(handler, /exposureTracker\.reset\(now\)/);
  assert.doesNotMatch(handler, /lastReminderAt\s*=/);
});
