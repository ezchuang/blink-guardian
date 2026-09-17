const median = (values) => {
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
};

// Relative image size, NOT physical distance. Reject changed pose rather than
// treating perspective distortion as the user moving toward the screen.
export function readDistanceSample(landmarks, aspectRatio = 1) {
  const ids = [234, 454, 10, 152, 1, 33, 133, 362, 263];
  if (!Number.isFinite(aspectRatio) || aspectRatio <= 0 ||
      ids.some((id) => !Number.isFinite(landmarks?.[id]?.x) || !Number.isFinite(landmarks[id].y) ||
        landmarks[id].x < .01 || landmarks[id].x > .99 || landmarks[id].y < .01 || landmarks[id].y > .99)) return null;
  const point = (id) => ({ x: landmarks[id].x * aspectRatio, y: landmarks[id].y });
  const distance = (a, b) => Math.hypot(point(a).x - point(b).x, point(a).y - point(b).y);
  const width = distance(234, 454);
  const height = distance(10, 152);
  const left = distance(362, 263);
  const right = distance(33, 133);
  if (width < .05 || height < .08 || left + right < .02) return null;
  const yaw = (left - right) / (left + right);
  if (Math.abs(yaw) > .3) return null;
  const top = point(10), bottom = point(152), nose = point(1);
  const eyeA = point(33), eyeB = point(263);
  const pitch = ((nose.x - (eyeA.x + eyeB.x) / 2) * (bottom.x - top.x) +
    (nose.y - (eyeA.y + eyeB.y) / 2) * (bottom.y - top.y)) / (height * height);
  return { scale: Math.sqrt(width * height), yaw, pitch, shape: width / height };
}

export class RelativeDistanceTracker {
  constructor({ intervalMs = 500, holdMs = 5000, enterRatio = 1.25, exitRatio = 1.15, cooldownMs = 60000 } = {}) {
    Object.assign(this, { intervalMs, holdMs, enterRatio, exitRatio, cooldownMs });
    this.reset();
  }

  reset() {
    this.baseline = null;
    this.calibrating = false;
    this.samples = [];
    this.lastProcessedAt = -Infinity;
    this.lastReminderAt = -Infinity;
    this.reminded = false;
    this.invalidate();
  }

  invalidate() {
    this.ratio = null;
    this.lastValidAt = -Infinity;
    this.near = false;
    this.nearMs = 0;
    this.samples = [];
  }

  beginCalibration() {
    this.reset();
    this.calibrating = true;
  }

  update(now, landmarks, aspectRatio = 1) {
    if (now - this.lastProcessedAt < this.intervalMs) return;
    const previousAt = this.lastValidAt;
    this.lastProcessedAt = now;
    if (now - previousAt > 1000) this.invalidate();
    const sample = readDistanceSample(landmarks, aspectRatio);
    if (!sample) { this.invalidate(); return; }
    if (this.calibrating) {
      this.lastValidAt = now;
      this.samples.push({ ...sample, at: now });
      this.samples = this.samples.filter((item) => now - item.at <= 2500);
      if (this.samples.length < 5 || now - this.samples[0].at < 2000) return;
      const center = Object.fromEntries(["scale", "yaw", "pitch", "shape"].map((key) => [key, median(this.samples.map((item) => item[key]))]));
      const stable = this.samples.every((item) => Math.abs(item.scale / center.scale - 1) <= .05 &&
        Math.abs(item.yaw - center.yaw) <= .05 && Math.abs(item.pitch - center.pitch) <= .04);
      if (!stable) return;
      this.baseline = center;
      this.calibrating = false;
      this.samples = [];
      this.ratio = 1;
      return;
    }
    if (!this.baseline) return;
    if (Math.abs(sample.yaw - this.baseline.yaw) > .08 ||
        Math.abs(sample.pitch - this.baseline.pitch) > .06 ||
        Math.abs(sample.shape / this.baseline.shape - 1) > .15) { this.invalidate(); return; }
    this.ratio = sample.scale / this.baseline.scale;
    this.lastValidAt = now;
    if (this.ratio <= this.exitRatio) {
      this.near = false;
      this.nearMs = 0;
      this.reminded = false;
    } else if (this.ratio >= this.enterRatio || this.near) {
      if (this.near) this.nearMs += Math.min(this.intervalMs, Math.max(0, now - previousAt));
      this.near = true;
    }
  }

  snapshot(now) {
    const fresh = now - this.lastValidAt <= 1000;
    return {
      state: this.calibrating ? "calibrating" : !this.baseline ? "needs-baseline" :
        !fresh || this.ratio === null ? "uncertain" : this.near ? "near" : "normal",
      ratio: fresh ? this.ratio : null
    };
  }

  shouldRemind(now) {
    return this.snapshot(now).state === "near" && this.nearMs >= this.holdMs &&
      !this.reminded && now - this.lastReminderAt >= this.cooldownMs;
  }

  markReminded(now) {
    this.lastReminderAt = now;
    this.reminded = true;
  }
}

export function reminderSoundPattern(kind = "blink") {
  if (kind === "posture") return [{ delay: 0, frequency: 660, duration: .18 }, { delay: .26, frequency: 440, duration: .28 }];
  return kind === "distance"
    ? [{ delay: 0, frequency: 330, duration: .5 }]
    : [{ delay: 0, frequency: 470, duration: .16 }, { delay: .18, frequency: 590, duration: .16 }];
}
