import test from "node:test";
import assert from "node:assert/strict";
import { AdaptiveInferenceScheduler, AngleRobustBlinkDetector, BlinkTrendTracker, OpenEyeExposureTracker, eyeVisibilityWeights, poseProfileKey, openReminderStatus } from "../blink-detector.js";

function landmarks(leftWidth = .1, rightWidth = .1, leftOpenness = 1, rightOpenness = 1, noseY = .48) {
  const points = Array.from({ length: 388 }, () => ({ x: 0, y: 0 }));
  points[10] = { x: .5, y: .2 };
  points[152] = { x: .5, y: .8 };
  points[1] = { x: .5, y: noseY };
  points[362] = { x: .6, y: .4 };
  points[263] = { x: .6 + leftWidth, y: .4 };
  points[33] = { x: .3, y: .4 };
  points[133] = { x: .3 + rightWidth, y: .4 };
  const leftHalfHeight = leftWidth * .175 * leftOpenness;
  const rightHalfHeight = rightWidth * .175 * rightOpenness;
  points[385] = { x: .6 + leftWidth * .35, y: .4 - leftHalfHeight };
  points[380] = { x: .6 + leftWidth * .35, y: .4 + leftHalfHeight };
  points[387] = { x: .6 + leftWidth * .65, y: .4 - leftHalfHeight };
  points[373] = { x: .6 + leftWidth * .65, y: .4 + leftHalfHeight };
  points[160] = { x: .3 + rightWidth * .35, y: .4 - rightHalfHeight };
  points[144] = { x: .3 + rightWidth * .35, y: .4 + rightHalfHeight };
  points[158] = { x: .3 + rightWidth * .65, y: .4 - rightHalfHeight };
  points[153] = { x: .3 + rightWidth * .65, y: .4 + rightHalfHeight };
  return points;
}

function calibratedDetector() {
  const detector = new AngleRobustBlinkDetector();
  for (let index = 0; index < 30; index += 1) detector.addCalibrationFrame(.05, .05, landmarks(), 1, index * 33);
  assert.equal(detector.finishCalibration(957), true);
  return detector;
}

function geometryCalibratedDetector() {
  return calibratedDetector();
}

function settlePose(detector, poseLandmarks, left = .05, right = .05, opennessFrames = 30) {
  const results = [];
  for (let index = 0; index < opennessFrames; index += 1) {
    results.push(detector.update({
      now: -1000 + index * 33,
      left,
      right,
      landmarks: poseLandmarks
    }));
  }
  return results;
}

test("keeps equal eye weights for a frontal face", () => {
  const weights = eyeVisibilityWeights(landmarks());
  assert.ok(Math.abs(weights.left - .5) < .0001);
  assert.ok(Math.abs(weights.right - .5) < .0001);
  assert.ok(weights.asymmetry < .0001);
});

test("counts a normal frontal blink after reopening", () => {
  const detector = calibratedDetector();
  const frames = [
    [0, .05, .05], [33, .8, .8], [66, .8, .8], [99, .8, .8],
    [132, .05, .05], [165, .05, .05], [198, .05, .05]
  ];
  const results = frames.map(([now, left, right]) => detector.update({ now, left, right, landmarks: landmarks() }));
  assert.equal(results.some((result) => result.blink), true);
});

test("uses the more visible eye when the face is angled", () => {
  const detector = calibratedDetector();
  const angled = landmarks(.16, .04);
  settlePose(detector, angled);
  const frames = [
    [0, .05, .05], [33, .8, .01], [66, .8, .01], [99, .8, .01],
    [132, .05, .05], [165, .05, .05], [198, .05, .05]
  ];
  const results = frames.map(([now, left, right]) => detector.update({ now, left, right, landmarks: angled }));
  assert.equal(results.some((result) => result.blink), true);
});

test("uses the visible right eye when the face turns the other way", () => {
  const detector = calibratedDetector();
  const angled = landmarks(.04, .16);
  settlePose(detector, angled);
  const frames = [
    [0, .05, .05], [33, .01, .8], [66, .01, .8], [99, .01, .8],
    [132, .05, .05], [165, .05, .05], [198, .05, .05]
  ];
  const results = frames.map(([now, left, right]) => detector.update({ now, left, right, landmarks: angled }));
  assert.equal(results.some((result) => result.blink), true);
});

test("does not count a frontal wink as a blink", () => {
  const detector = calibratedDetector();
  detector.update({ now: 0, left: .05, right: .05, landmarks: landmarks() });
  detector.update({ now: 40, left: .8, right: .06, landmarks: landmarks() });
  detector.update({ now: 90, left: .8, right: .06, landmarks: landmarks() });
  const result = detector.update({ now: 150, left: .05, right: .05, landmarks: landmarks() });
  assert.equal(result.blink, false);
});

test("counts a high-confidence one-frame fast blink", () => {
  const detector = calibratedDetector();
  detector.update({ now: 0, left: .05, right: .05, landmarks: landmarks() });
  detector.update({ now: 33, left: .9, right: .9, landmarks: landmarks() });
  const result = detector.update({ now: 66, left: .05, right: .05, landmarks: landmarks() });
  assert.equal(result.blink, true);
});

test("ignores an asymmetric one-frame score spike", () => {
  const detector = calibratedDetector();
  detector.update({ now: 0, left: .05, right: .05, landmarks: landmarks() });
  detector.update({ now: 33, left: .9, right: .08, landmarks: landmarks() });
  const result = detector.update({ now: 66, left: .05, right: .05, landmarks: landmarks() });
  assert.equal(result.blink, false);
});

test("lowers the close threshold when sensitivity increases", () => {
  const detector = new AngleRobustBlinkDetector({ sensitivity: 1 });
  const conservative = detector.thresholds(false).close;
  detector.setSensitivity(6);
  assert.ok(detector.thresholds(false).close < conservative);
});

test("detects closure from eyelid geometry when blendshape scores stay low", () => {
  const detector = geometryCalibratedDetector();
  detector.update({ now: 0, left: .08, right: .08, landmarks: landmarks() });
  const closed = detector.update({ now: 33, left: .12, right: .12, landmarks: landmarks(.1, .1, .05, .05) });
  assert.equal(closed.closureStarted, true);
  assert.equal(closed.state, "resting");
});

test("keeps long closures resting and counts once after reopening", () => {
  const detector = geometryCalibratedDetector();
  detector.update({ now: 0, left: .05, right: .05, landmarks: landmarks() });
  detector.update({ now: 33, left: .1, right: .1, landmarks: landmarks(.1, .1, .05, .05) });
  const held = detector.update({ now: 2500, left: .1, right: .1, landmarks: landmarks(.1, .1, .05, .05) });
  const reopened = detector.update({ now: 2533, left: .05, right: .05, landmarks: landmarks() });
  assert.equal(held.state, "resting");
  assert.equal(held.closureEnded, false);
  assert.equal(reopened.closureEnded, true);
  assert.ok(reopened.closureDuration > 1200);
});

test("accumulates only confirmed open exposure and resets while resting", () => {
  const tracker = new OpenEyeExposureTracker();
  tracker.reset(0);
  assert.equal(tracker.update(100, "open"), 100);
  assert.equal(tracker.update(200, "uncertain"), 100);
  assert.equal(tracker.update(300, "resting"), 0);
  assert.equal(tracker.update(1000, "resting"), 0);
  assert.equal(tracker.update(1100, "open"), 100);
});

test("builds and reuses a baseline for a changed face angle", () => {
  const detector = geometryCalibratedDetector();
  const frontal = landmarks();
  const reclined = landmarks(.1, .1, .62, .62, .58);
  assert.notEqual(poseProfileKey(frontal), poseProfileKey(reclined));

  const firstVisit = settlePose(detector, reclined, .12, .12);
  assert.equal(firstVisit.some((result) => result.poseChanged), true);
  assert.equal(firstVisit.some((result) => result.recalibrating), true);
  assert.equal(firstVisit.at(-1).recalibrating, false);
  assert.equal(firstVisit.at(-1).state, "open");

  settlePose(detector, frontal);
  const returnVisit = settlePose(detector, reclined, .12, .12, 6);
  const switched = returnVisit.find((result) => result.poseChanged);
  assert.ok(switched);
  assert.equal(switched.recalibrating, false);
  assert.equal(switched.state, "open");
});

test("does not finish initial calibration with closed eyes, missing geometry or too few samples", () => {
  for (const points of [landmarks(.1, .1, .05, .05), []]) {
    const detector = new AngleRobustBlinkDetector();
    for (let now = 0; now <= 3000; now += 50) detector.addCalibrationFrame(.12, .12, points, 1, now);
    assert.equal(detector.finishCalibration(3000), false);
    assert.equal(detector.activePoseKey, null);
    assert.equal(detector.update({ now: 3050, left: .12, right: .12, landmarks: points }).state, "uncertain");
  }
  const detector = new AngleRobustBlinkDetector();
  detector.addCalibrationFrame(.05, .05, landmarks(), 1, 0);
  assert.equal(detector.finishCalibration(3000), false);
});

test("uses stable time, not frame count, to accept calibration across supported frame rates", () => {
  for (const fps of [12, 15, 20, 30]) {
    const detector = new AngleRobustBlinkDetector();
    const interval = 1000 / fps;
    for (let now = 0; now < 600; now += interval) {
      detector.addCalibrationFrame(.05, .05, landmarks(), 1, now);
      assert.equal(detector.finishCalibration(now), false);
    }
    for (let now = 600; now <= 1000; now += interval) detector.addCalibrationFrame(.05, .05, landmarks(), 1, now);
    assert.equal(detector.finishCalibration(1000), true);
  }
});

test("minority geometry spikes do not define the open baseline", () => {
  const detector = new AngleRobustBlinkDetector();
  for (let index = 0; index < 16; index += 1) {
    const openness = [4, 8, 12].includes(index) ? 1.7 : 1;
    detector.addCalibrationFrame(.05, .05, landmarks(.1, .1, openness, openness), 1, index * 50);
  }
  assert.equal(detector.finishCalibration(750), true);
  assert.ok(Math.abs(detector.openLeftEar - .35) < .0001);
  const result = detector.update({ now: 800, left: .05, right: .05, landmarks: landmarks() });
  assert.equal(result.state, "open");
  assert.ok(result.combined < .01);
});

test("a new pose held closed stays uncertain until stable open samples arrive", () => {
  const detector = calibratedDetector();
  const closedPose = landmarks(.1, .1, .05, .05, .58);
  const openPose = landmarks(.1, .1, .62, .62, .58);
  for (let now = 1000; now <= 4000; now += 50) {
    const result = detector.update({ now, left: .12, right: .12, landmarks: closedPose });
    assert.equal(result.state, "uncertain");
    assert.equal(result.blink, false);
  }
  assert.equal(detector.poseProfiles.has(poseProfileKey(closedPose)), false);
  let result;
  for (let now = 4050; now <= 5000; now += 50) result = detector.update({ now, left: .12, right: .12, landmarks: openPose });
  assert.equal(result.state, "open");
  assert.ok(Math.abs(detector.openLeftEar - .35 * .62) < .0001);
});

test("calibrates the visible eye without requiring the occluded eye to open", () => {
  const detector = calibratedDetector();
  const angled = landmarks(.16, .04, 1, .05);
  let result;
  for (let now = 1000; now <= 2500; now += 50) result = detector.update({ now, left: .05, right: .95, landmarks: angled });
  assert.equal(result.recalibrating, false);
  assert.equal(result.state, "open");
});

test("rejects stale calibration samples and samples mixed between poses", () => {
  const detector = new AngleRobustBlinkDetector();
  for (let now = 0; now <= 1000; now += 50) {
    const pose = now % 100 === 0 ? landmarks() : landmarks(.1, .1, .62, .62, .58);
    detector.addCalibrationFrame(.05, .05, pose, 1, now);
  }
  assert.equal(detector.finishCalibration(1000), false);
  for (let now = 1050; now <= 2000; now += 50) detector.addCalibrationFrame(.05, .05, landmarks(), 1, now);
  assert.equal(detector.finishCalibration(2400), false);
});

test("a pose transition pauses exposure without fabricating a rest or resetting the timer", () => {
  const detector = calibratedDetector();
  const tracker = new OpenEyeExposureTracker();
  tracker.reset(1000);
  for (let now = 1050; now <= 3000; now += 50) tracker.update(now, "open");
  const before = tracker.openMs;
  const angled = landmarks(.1, .1, .62, .62, .58);
  let resumed = false;
  for (let now = 3050; now <= 4500; now += 50) {
    const result = detector.update({ now, left: .12, right: .12, landmarks: angled });
    tracker.update(now, result.state);
    assert.equal(result.closureStarted, false);
    assert.ok(tracker.openMs >= before);
    if (result.state === "uncertain") assert.equal(tracker.openMs, before);
    else resumed = true;
  }
  assert.equal(resumed, true);
  assert.ok(tracker.openMs > before);
});

test("prolonged uncertainty loses continuity and resumes from a new interval", () => {
  const tracker = new OpenEyeExposureTracker();
  tracker.reset(0);
  for (let now = 100; now <= 1000; now += 100) tracker.update(now, "open");
  tracker.update(1100, "uncertain");
  assert.equal(tracker.openMs, 1000);
  tracker.update(2000, "uncertain");
  assert.equal(tracker.continuityLost, false);
  tracker.update(4000, "uncertain");
  assert.equal(tracker.continuityLost, true);
  assert.equal(tracker.openMs, 0);
  tracker.update(4050, "open");
  assert.equal(tracker.continuityLost, false);
  assert.equal(tracker.restartedAt, 4050);
  assert.equal(tracker.openMs, 0);
  assert.equal(tracker.update(4100, "open"), 50);
  assert.equal(tracker.update(9000, "open"), 0, "a stalled video must not preserve continuity");
});

test("counts only observed intervals without bridging uncertain gaps", () => {
  const tracker = new BlinkTrendTracker();
  tracker.reset(0);
  for (let now = 50; now <= 10000; now += 50) tracker.update(now, now % 100 === 0 ? "uncertain" : "open");
  tracker.recordBlink(10000, 100);
  assert.equal(tracker.metrics(10000).observedMs, 5000);
  assert.equal(tracker.metrics(10000).rate, 12);
  tracker.resetWindow(10000);
  tracker.update(11000, "open");
  assert.equal(tracker.metrics(11000).observedMs, 250);
});

test("reminder eligibility matches cooldown and excludes uncertain or resting eyes", () => {
  const input = { now: 10000, eyeState: "open", openMs: 10000, targetMs: 10000, lastReminderAt: -Infinity };
  assert.equal(openReminderStatus(input).eligible, true);
  for (const eyeState of ["uncertain", "resting"]) assert.equal(openReminderStatus({ ...input, eyeState }).eligible, false);
  assert.equal(openReminderStatus({ ...input, facePresent: false }).eligible, false);
  assert.equal(openReminderStatus({ ...input, reminderVisible: true }).eligible, false);
  assert.equal(openReminderStatus({ ...input, openMs: 9999 }).eligible, false);
  assert.deepEqual(openReminderStatus({ ...input, now: 20000, lastReminderAt: 10000 }), { eligible: false, cooldownSeconds: 50 });
  assert.deepEqual(openReminderStatus({ ...input, now: 70000, lastReminderAt: 10000 }), { eligible: true, cooldownSeconds: 0 });
});

test("reminds only after a sustained low blink trend", () => {
  const tracker = new BlinkTrendTracker();
  tracker.reset(0);
  for (let now = 100; now <= 80000; now += 100) {
    tracker.update(now, "open");
    if (now % 5000 === 0) tracker.recordBlink(now, 120);
  }
  for (let now = 80100; now <= 150000; now += 100) tracker.update(now, "open");

  const metrics = tracker.metrics(150000);
  assert.equal(metrics.ready, true);
  assert.ok(metrics.rate < metrics.threshold);
  assert.equal(tracker.shouldRemind(150000, "open"), true);
});

test("excludes uncertain time and credits a long eye rest", () => {
  const tracker = new BlinkTrendTracker({ minimumObservedMs: 5000 });
  tracker.reset(0);
  for (let now = 100; now <= 10000; now += 100) tracker.update(now, "open");
  const beforeUncertain = tracker.metrics(10000).observedMs;
  for (let now = 10100; now <= 20000; now += 100) tracker.update(now, "uncertain");
  assert.equal(tracker.metrics(20000).observedMs, beforeUncertain);

  tracker.recordBlink(20000, 1200);
  assert.equal(tracker.metrics(20000).suppressed, true);
  assert.equal(tracker.shouldRemind(20000, "open"), false);
});

test("uncertain time does not advance sustained low-trend duration", () => {
  const tracker = new BlinkTrendTracker();
  tracker.reset(0);
  for (let now = 100; now <= 100000; now += 100) tracker.update(now, "open");
  const before = tracker.metrics(100000).lowDurationMs;
  assert.ok(before > 0);
  for (let now = 100100; now <= 102000; now += 100) tracker.update(now, "uncertain");
  assert.equal(tracker.metrics(102000).lowDurationMs, before);
  tracker.update(102100, "resting");
  assert.equal(tracker.metrics(102100).lowDurationMs, before + 100, "short closures must not erase the low trend");
});

test("limits standard inference to twenty frames per second", () => {
  const scheduler = new AdaptiveInferenceScheduler();
  assert.equal(scheduler.shouldRun(0), true);
  assert.equal(scheduler.shouldRun(49), false);
  assert.equal(scheduler.shouldRun(50), true);
  assert.equal(scheduler.snapshot().targetFps, 20);
});

test("degrades to fifteen frames per second after sustained slow inference", () => {
  const scheduler = new AdaptiveInferenceScheduler({
    sampleWindowMs: 1000,
    minimumObservationMs: 100,
    minimumSamples: 3,
    degradedHoldMs: 300
  });
  scheduler.record(50, 0);
  scheduler.record(48, 50);
  assert.equal(scheduler.record(47, 100), true);
  assert.deepEqual(scheduler.snapshot(), {
    mode: "degraded",
    targetFps: 15,
    p90InferenceMs: 50,
    sampleCount: 3
  });
  assert.equal(scheduler.shouldRun(166), false);
  assert.equal(scheduler.shouldRun(167), true);
});

test("returns to standard mode after the degraded hold and sustained recovery", () => {
  const scheduler = new AdaptiveInferenceScheduler({
    sampleWindowMs: 200,
    minimumObservationMs: 100,
    minimumSamples: 3,
    degradedHoldMs: 300
  });
  scheduler.record(50, 0);
  scheduler.record(50, 50);
  scheduler.record(50, 100);
  scheduler.record(20, 400);
  scheduler.record(22, 450);
  assert.equal(scheduler.record(24, 500), true);
  assert.equal(scheduler.snapshot().mode, "standard");
  assert.equal(scheduler.snapshot().targetFps, 20);
  assert.equal(scheduler.shouldRun(549), false);
  assert.equal(scheduler.shouldRun(550), true);
});
