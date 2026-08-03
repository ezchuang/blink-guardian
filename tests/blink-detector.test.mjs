import test from "node:test";
import assert from "node:assert/strict";
import { AngleRobustBlinkDetector, eyeVisibilityWeights } from "../public/blink-detector.js";

function landmarks(leftWidth = .1, rightWidth = .1) {
  const points = Array.from({ length: 363 }, () => ({ x: 0, y: 0 }));
  points[362] = { x: .6, y: .4 };
  points[263] = { x: .6 + leftWidth, y: .4 };
  points[33] = { x: .3, y: .4 };
  points[133] = { x: .3 + rightWidth, y: .4 };
  return points;
}

function calibratedDetector() {
  const detector = new AngleRobustBlinkDetector();
  for (let index = 0; index < 30; index += 1) detector.addCalibrationFrame(.05, .05);
  detector.finishCalibration();
  return detector;
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
  const frames = [
    [0, .05, .05], [33, .8, .18], [66, .8, .18], [99, .8, .18],
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
  detector.setSensitivity(5);
  assert.ok(detector.thresholds(false).close < conservative);
});
