import test from "node:test";
import assert from "node:assert/strict";
import { AngleRobustBlinkDetector, OpenEyeExposureTracker, eyeVisibilityWeights, poseProfileKey } from "../public/blink-detector.js";

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
  for (let index = 0; index < 30; index += 1) detector.addCalibrationFrame(.05, .05, landmarks());
  detector.finishCalibration();
  return detector;
}

function geometryCalibratedDetector() {
  const detector = new AngleRobustBlinkDetector();
  for (let index = 0; index < 30; index += 1) detector.addCalibrationFrame(.05, .05, landmarks());
  detector.finishCalibration();
  return detector;
}

function settlePose(detector, poseLandmarks, left = .05, right = .05, opennessFrames = 18) {
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
