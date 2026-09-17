import test from "node:test";
import assert from "node:assert/strict";
import { readDistanceSample, RelativeDistanceTracker, reminderSoundPattern } from "../monitoring-features.js";

export function face(scale = 1) {
  const points = [];
  for (const [id, x, y] of [[234,.35,.5],[454,.65,.5],[10,.5,.25],[152,.5,.75],
    [1,.5,.5],[33,.42,.42],[133,.46,.42],[362,.54,.42],[263,.58,.42]]) {
    points[id] = { x: .5 + (x - .5) * scale, y: .5 + (y - .5) * scale };
  }
  return points;
}

function calibrated() {
  const tracker = new RelativeDistanceTracker();
  tracker.beginCalibration();
  for (let now = 0; now <= 2000; now += 500) tracker.update(now, face());
  assert.equal(tracker.snapshot(2000).state, "normal");
  return tracker;
}

test("distance baseline requires an explicit request and stable samples", () => {
  const tracker = new RelativeDistanceTracker();
  for (let now = 0; now <= 5000; now += 500) tracker.update(now, face());
  assert.equal(tracker.snapshot(5000).state, "needs-baseline");
  tracker.beginCalibration();
  for (let now = 6000; now <= 10000; now += 500) tracker.update(now, face(now % 1000 ? 1.3 : 1));
  assert.equal(tracker.snapshot(10000).state, "calibrating");
  for (let now = 10500; now <= 14000; now += 500) tracker.update(now, face());
  assert.equal(tracker.snapshot(14000).state, "normal");
});

test("distance reminder requires five sustained seconds and rearms only after recovery", () => {
  const tracker = calibrated();
  for (let now = 2500; now < 7500; now += 500) {
    tracker.update(now, face(1.3));
    assert.equal(tracker.shouldRemind(now), false);
  }
  tracker.update(7500, face(1.3));
  assert.equal(tracker.shouldRemind(7500), true);
  tracker.markReminded(7500);
  for (let now = 8000; now <= 70000; now += 500) tracker.update(now, face(1.3));
  assert.equal(tracker.shouldRemind(70000), false);
  tracker.update(70500, face());
  for (let now = 71000; now <= 76000; now += 500) tracker.update(now, face(1.3));
  assert.equal(tracker.shouldRemind(76000), true);
});

test("brief approaches and small threshold oscillations do not repeatedly alert", () => {
  const tracker = calibrated();
  tracker.update(2500, face(1.3));
  tracker.update(3000, face(1.2));
  assert.equal(tracker.snapshot(3000).state, "near");
  tracker.update(3500, face(1.1));
  assert.equal(tracker.snapshot(3500).state, "normal");
  assert.equal(tracker.nearMs, 0);
  assert.equal(tracker.shouldRemind(3500), false);
});

test("invalid pose, missing face and stale frames interrupt proximity evidence", () => {
  const tracker = calibrated();
  for (let now = 2500; now <= 7000; now += 500) tracker.update(now, face(1.3));
  const turned = face(1.3);
  turned[133].x = turned[33].x + .01;
  tracker.update(7500, turned);
  assert.equal(tracker.snapshot(7500).state, "uncertain");
  assert.equal(tracker.shouldRemind(7500), false);
  tracker.update(8000, face(1.3));
  assert.equal(tracker.nearMs, 0);
  assert.equal(tracker.snapshot(9100).state, "uncertain");
  tracker.update(10000, face(1.3));
  assert.equal(tracker.nearMs, 0);
  tracker.update(10500, null);
  assert.equal(tracker.snapshot(10500).ratio, null);
});

test("baseline does not adapt to gradual approaches, and reset requires recalibration", () => {
  const tracker = calibrated();
  const baseline = { ...tracker.baseline };
  for (let now = 2500; now <= 10000; now += 500) tracker.update(now, face(1 + now / 30000));
  assert.deepEqual(tracker.baseline, baseline);
  tracker.reset();
  assert.equal(tracker.snapshot(10500).state, "needs-baseline");
});

test("sampling stays at two checks per second and never interprets image size as centimeters", () => {
  const tracker = calibrated();
  tracker.update(2500, face(1.3));
  tracker.update(2510, face());
  assert.ok(Math.abs(tracker.snapshot(2510).ratio - 1.3) < .0001);
  assert.equal(readDistanceSample([]), null);
  assert.equal(readDistanceSample(face(3)), null);
  assert.equal(readDistanceSample(face(), NaN), null);
  const pitched = face(1.3);
  pitched[1].y += .1;
  tracker.update(3000, pitched);
  assert.equal(tracker.snapshot(3000).state, "uncertain");
});

test("blink and distance tones differ in pitch, duration and rhythm", () => {
  const blink = reminderSoundPattern("blink");
  const distance = reminderSoundPattern("distance");
  assert.equal(blink.length, 2);
  assert.equal(distance.length, 1);
  assert.ok(distance[0].duration > blink[0].duration);
  assert.notEqual(distance[0].frequency, blink[0].frequency);
});
