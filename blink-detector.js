const clamp = (value, min = 0, max = 1) => Math.min(max, Math.max(min, value));

function median(values, fallback = 0) {
  if (!values.length) return fallback;
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
}

// These are plausibility guards, not a claim that a webcam can prove an eye is open.
// A new pose may shorten the apparent eye height, but collapsed geometry must not
// become its open baseline just because the blendshape score is low.
function plausibleOpen(score, ear, referenceEar) {
  return Number.isFinite(score) && score <= .35 && score >= 0 &&
    Number.isFinite(ear) && ear >= Math.max(.08, (referenceEar || 0) * .45) && ear <= .65;
}

class OpenBaselineWindow {
  constructor() { this.clear(); }

  clear() {
    this.key = null;
    this.frames = [];
  }

  add({ now, key, left, right, geometry, weights, reference = {} }) {
    if (key !== this.key || (this.frames.length && now - this.frames.at(-1).now > 250)) this.clear();
    this.key = key;
    const leftOk = plausibleOpen(left, geometry.leftEar, reference.openLeftEar);
    const rightOk = plausibleOpen(right, geometry.rightEar, reference.openRightEar);
    const angled = weights.asymmetry >= .1;
    const valid = angled ? (weights.left >= weights.right ? leftOk : rightOk) : leftOk && rightOk;
    if (!valid) { this.frames = []; return; }
    this.frames.push({ now, left, right, geometry, leftOk, rightOk,
      useLeft: !angled || weights.left >= weights.right,
      useRight: !angled || weights.right > weights.left });
    this.frames = this.frames.filter((frame) => now - frame.now <= 1500);
  }

  samples(now) {
    if (this.frames.length < 6 || now - this.frames.at(-1).now > 250) return null;
    const centerLeft = median(this.frames.map((frame) => frame.geometry.leftEar));
    const centerRight = median(this.frames.map((frame) => frame.geometry.rightEar));
    const near = (value, center) => Math.abs(value - center) <= Math.max(.01, center * .2);
    const stable = this.frames.filter((frame) =>
      (!frame.useLeft || near(frame.geometry.leftEar, centerLeft)) &&
      (!frame.useRight || near(frame.geometry.rightEar, centerRight)));
    if (stable.length < 6 || stable.length / this.frames.length < .75 ||
        stable.at(-1).now - stable[0].now < 600) return null;
    const leftFrames = stable.filter((frame) => frame.leftOk);
    const rightFrames = stable.filter((frame) => frame.rightOk);
    return {
      left: leftFrames.map((frame) => frame.left),
      right: rightFrames.map((frame) => frame.right),
      leftEar: leftFrames.map((frame) => frame.geometry.leftEar),
      rightEar: rightFrames.map((frame) => frame.geometry.rightEar)
    };
  }
}

function landmarkDistance(landmarks, first, second, aspectRatio) {
  const a = landmarks?.[first];
  const b = landmarks?.[second];
  if (!a || !b) return 0;
  return Math.hypot((a.x - b.x) * aspectRatio, a.y - b.y);
}

export function eyeVisibilityWeights(landmarks, aspectRatio = 1) {
  const leftWidth = landmarkDistance(landmarks, 362, 263, aspectRatio);
  const rightWidth = landmarkDistance(landmarks, 33, 133, aspectRatio);
  const total = leftWidth + rightWidth;
  if (total < .001) return { left: .5, right: .5, asymmetry: 0 };

  const left = clamp(leftWidth / total, .28, .72);
  return {
    left,
    right: 1 - left,
    asymmetry: Math.abs(leftWidth - rightWidth) / total
  };
}

export function poseProfileKey(landmarks, aspectRatio = 1) {
  const leftWidth = landmarkDistance(landmarks, 362, 263, aspectRatio);
  const rightWidth = landmarkDistance(landmarks, 33, 133, aspectRatio);
  const totalWidth = leftWidth + rightWidth;
  const nose = landmarks?.[1];
  const forehead = landmarks?.[10];
  const chin = landmarks?.[152];
  const leftOuter = landmarks?.[362];
  const rightOuter = landmarks?.[33];
  if (totalWidth < .001 || !nose || !forehead || !chin || !leftOuter || !rightOuter) return "neutral";

  const signedYaw = (leftWidth - rightWidth) / totalWidth;
  const faceHeight = Math.max(.001, Math.abs(chin.y - forehead.y));
  const eyeLine = (leftOuter.y + rightOuter.y) / 2;
  const pitch = (nose.y - eyeLine) / faceHeight;
  const yawBucket = Math.round(clamp(signedYaw, -.5, .5) / .12);
  const pitchBucket = Math.round(clamp(pitch, -.4, .6) / .08);
  return `${yawBucket}:${pitchBucket}`;
}

export class AngleRobustBlinkDetector {
  constructor({ sensitivity = 3 } = {}) {
    this.setSensitivity(sensitivity);
    this.resetCalibration();
  }

  setSensitivity(level) {
    this.sensitivityLevel = clamp(Math.round(Number(level) || 3), 1, 6);
    this.sensitivity = (this.sensitivityLevel - 1) / 5;
  }

  thresholds(angled = false) {
    const close = (angled ? .53 : .55) - this.sensitivity * .3;
    return {
      close,
      reopen: close * .45,
      strong: Math.min(.82, close + .28)
    };
  }

  resetCalibration() {
    this.calibrationWindow = new OpenBaselineWindow();
    this.openLeft = .05;
    this.openRight = .05;
    this.openLeftEar = null;
    this.openRightEar = null;
    this.poseProfiles = new Map();
    this.activePoseKey = null;
    this.poseCandidateKey = null;
    this.poseCandidateSince = null;
    this.poseWindow = null;
    this.resetMotion();
  }

  addCalibrationFrame(left, right, landmarks, aspectRatio = 1, now = performance.now()) {
    this.calibrationWindow.add({ now, left, right,
      key: poseProfileKey(landmarks, aspectRatio),
      geometry: eyeGeometry(landmarks, aspectRatio),
      weights: eyeVisibilityWeights(landmarks, aspectRatio) });
  }

  finishCalibration(now = performance.now()) {
    const samples = this.calibrationWindow.samples(now);
    if (!samples) return false;
    const profile = this.profileFromSamples(samples);
    this.activePoseKey = this.calibrationWindow.key;
    this.poseProfiles.set(this.activePoseKey, profile);
    this.loadProfile(profile);
    this.resetMotion();
    return true;
  }

  profileFromSamples(samples) {
    return {
      openLeft: clamp(median(samples.left, .05), .01, .4),
      openRight: clamp(median(samples.right, .05), .01, .4),
      openLeftEar: median(samples.leftEar) || null,
      openRightEar: median(samples.rightEar) || null
    };
  }

  loadProfile(profile) {
    this.openLeft = profile.openLeft;
    this.openRight = profile.openRight;
    this.openLeftEar = profile.openLeftEar;
    this.openRightEar = profile.openRightEar;
  }

  updatePoseProfile(now, key, left, right, geometry, weights) {
    let poseChanged = false;
    if (!this.activePoseKey) this.activePoseKey = key;
    if (key !== this.activePoseKey) {
      if (key !== this.poseCandidateKey) {
        this.poseCandidateKey = key;
        this.poseCandidateSince = now;
      }
      // Do not apply the previous pose's thresholds while the head is moving.
      if (now - this.poseCandidateSince < 160) return { poseChanged: false, recalibrating: true };
      this.activePoseKey = key;
      this.poseCandidateKey = null;
      this.poseCandidateSince = null;
      this.resetMotion();
      poseChanged = true;
      const cached = this.poseProfiles.get(key);
      if (cached) {
        this.loadProfile(cached);
        this.poseWindow = null;
      } else {
        this.poseWindow = new OpenBaselineWindow();
      }
    } else {
      this.poseCandidateKey = null;
      this.poseCandidateSince = null;
    }

    if (this.poseWindow) {
      this.poseWindow.add({ now, key, left, right, geometry, weights, reference: this });
      const samples = this.poseWindow.samples(now);
      if (samples) {
        const profile = this.profileFromSamples(samples);
        this.poseProfiles.set(this.activePoseKey, profile);
        this.loadProfile(profile);
        this.poseWindow = null;
        this.resetMotion();
      }
    }
    return { poseChanged, recalibrating: Boolean(this.poseWindow) };
  }

  resetMotion() {
    this.closed = false;
    this.closeCandidateAt = 0;
    this.closedAt = 0;
    this.lastBlinkAt = -Infinity;
    this.fastClosure = false;
    this.state = "open";
    this.smoothLeft = null;
    this.smoothRight = null;
  }

  normalizedBlendClosure(value, baseline) {
    return clamp((value - baseline) / Math.max(.2, 1 - baseline));
  }

  geometryClosure(ear, openEar) {
    if (!ear || !openEar) return 0;
    return clamp(1 - ear / openEar);
  }

  update({ now, left, right, landmarks, aspectRatio = 1 }) {
    this.smoothLeft = this.smoothLeft === null ? left : this.smoothLeft * .55 + left * .45;
    this.smoothRight = this.smoothRight === null ? right : this.smoothRight * .55 + right * .45;

    const geometry = eyeGeometry(landmarks, aspectRatio);
    const weights = eyeVisibilityWeights(landmarks, aspectRatio);
    const pose = this.activePoseKey
      ? this.updatePoseProfile(now, poseProfileKey(landmarks, aspectRatio), left, right, geometry, weights)
      : { poseChanged: false, recalibrating: true };
    if (pose.recalibrating) {
      this.resetMotion();
      this.state = "uncertain";
      return {
        blink: false,
        closureStarted: false,
        closureEnded: false,
        closureDuration: 0,
        state: "uncertain",
        openness: 0,
        leftLevel: 0,
        rightLevel: 0,
        combined: 0,
        angled: false,
        closeThreshold: this.thresholds(false).close,
        poseChanged: pose.poseChanged,
        recalibrating: true
      };
    }
    if (this.smoothLeft === null) {
      this.smoothLeft = left;
      this.smoothRight = right;
    }
    const leftGeometryLevel = this.geometryClosure(geometry.leftEar, this.openLeftEar);
    const rightGeometryLevel = this.geometryClosure(geometry.rightEar, this.openRightEar);
    const leftLevel = Math.max(this.normalizedBlendClosure(this.smoothLeft, this.openLeft), leftGeometryLevel);
    const rightLevel = Math.max(this.normalizedBlendClosure(this.smoothRight, this.openRight), rightGeometryLevel);
    const rawLeftLevel = Math.max(this.normalizedBlendClosure(left, this.openLeft), leftGeometryLevel);
    const rawRightLevel = Math.max(this.normalizedBlendClosure(right, this.openRight), rightGeometryLevel);
    const combined = leftLevel * weights.left + rightLevel * weights.right;
    const rawCombined = rawLeftLevel * weights.left + rawRightLevel * weights.right;
    const angled = weights.asymmetry >= .1;
    const threshold = this.thresholds(angled);
    const visibleLeft = weights.left >= weights.right;
    const visibleLevel = visibleLeft ? leftLevel : rightLevel;
    const rawVisibleLevel = visibleLeft ? rawLeftLevel : rawRightLevel;
    const closeSignal = angled
      ? visibleLevel >= threshold.close
      : combined >= threshold.close && Math.min(leftLevel, rightLevel) >= threshold.close * .55;
    const fastCloseSignal = angled
      ? rawVisibleLevel >= threshold.strong
      : rawCombined >= threshold.strong && Math.min(rawLeftLevel, rawRightLevel) >= threshold.close;
    const rawOpenSignal = angled ? rawVisibleLevel <= threshold.reopen : rawCombined <= threshold.reopen;
    const openSignal = angled ? visibleLevel <= threshold.reopen : combined <= threshold.reopen;
    let closureStarted = false;
    let closureEnded = false;
    let closureDuration = 0;

    if (!this.closed) {
      if (fastCloseSignal) {
        this.closed = true;
        this.fastClosure = true;
        this.closedAt = now;
        this.closeCandidateAt = 0;
        closureStarted = true;
      } else if (closeSignal) {
        this.closeCandidateAt ||= now;
        if (now - this.closeCandidateAt >= 28) {
          this.closed = true;
          this.fastClosure = false;
          this.closedAt = this.closeCandidateAt;
          closureStarted = true;
        }
      } else {
        this.closeCandidateAt = 0;
      }
    } else if (openSignal || (this.fastClosure && rawOpenSignal)) {
      closureDuration = now - this.closedAt;
      const minimumDuration = this.fastClosure ? 20 : 55;
      closureEnded = closureDuration >= minimumDuration && now - this.lastBlinkAt >= 150;
      if (closureEnded) this.lastBlinkAt = now;
      this.closed = false;
      this.fastClosure = false;
      this.closeCandidateAt = 0;
      this.closedAt = 0;
    }

    this.state = this.closed ? "resting" : this.closeCandidateAt || !openSignal ? "uncertain" : "open";
    if (this.state === "open") {
      if (leftLevel < .06) this.openLeft = this.openLeft * .997 + this.smoothLeft * .003;
      if (rightLevel < .06) this.openRight = this.openRight * .997 + this.smoothRight * .003;
      if (leftGeometryLevel < .06 && geometry.leftEar && this.openLeftEar) this.openLeftEar = this.openLeftEar * .997 + geometry.leftEar * .003;
      if (rightGeometryLevel < .06 && geometry.rightEar && this.openRightEar) this.openRightEar = this.openRightEar * .997 + geometry.rightEar * .003;
      const profile = this.poseProfiles.get(this.activePoseKey);
      if (profile) Object.assign(profile, {
        openLeft: this.openLeft,
        openRight: this.openRight,
        openLeftEar: this.openLeftEar,
        openRightEar: this.openRightEar
      });
    }

    return {
      blink: closureEnded,
      closureStarted,
      closureEnded,
      closureDuration,
      state: this.state,
      openness: 1 - (angled ? visibleLevel : combined),
      leftLevel,
      rightLevel,
      combined,
      angled,
      closeThreshold: threshold.close,
      poseChanged: pose.poseChanged,
      recalibrating: false
    };
  }
}

function eyeGeometry(landmarks, aspectRatio = 1) {
  const ratio = (outer, inner, upperA, lowerA, upperB, lowerB) => {
    const width = landmarkDistance(landmarks, outer, inner, aspectRatio);
    if (width < .001) return 0;
    const heightA = landmarkDistance(landmarks, upperA, lowerA, aspectRatio);
    const heightB = landmarkDistance(landmarks, upperB, lowerB, aspectRatio);
    return (heightA + heightB) / (2 * width);
  };
  return {
    leftEar: ratio(362, 263, 385, 380, 387, 373),
    rightEar: ratio(33, 133, 160, 144, 158, 153)
  };
}

export class OpenEyeExposureTracker {
  constructor({ maximumUncertainMs = 3000 } = {}) {
    this.maximumUncertainMs = maximumUncertainMs;
    this.reset();
  }

  reset(now = null) {
    this.openMs = 0;
    this.lastAt = now;
    this.lastState = null;
    this.uncertainSince = null;
    this.continuityLost = false;
    this.restartedAt = -Infinity;
  }

  update(now, state) {
    const delta = this.lastAt === null ? 0 : Math.min(150, Math.max(0, now - this.lastAt));
    // No new frames is also an observation gap, even if the next frame is open.
    if (this.lastAt !== null && now - this.lastAt > 250) {
      this.uncertainSince ??= this.lastAt;
      this.lastState = "uncertain";
    }
    if (state === "uncertain") this.uncertainSince ??= this.lastAt ?? now;
    if (this.uncertainSince !== null && now - this.uncertainSince >= this.maximumUncertainMs) {
      this.openMs = 0;
      this.continuityLost = true;
    }
    if (state === "open") {
      if (this.continuityLost) this.restartedAt = now;
      if (this.lastState !== "uncertain") this.openMs += delta;
      this.continuityLost = false;
      this.uncertainSince = null;
    } else if (state === "resting") {
      this.openMs = 0;
      this.continuityLost = false;
      this.uncertainSince = null;
      this.restartedAt = -Infinity;
    }
    this.lastAt = now;
    this.lastState = state;
    return this.openMs;
  }
}

export class BlinkTrendTracker {
  constructor({ windowMs = 60000, minimumObservedMs = 45000 } = {}) {
    this.windowMs = windowMs;
    this.minimumObservedMs = minimumObservedMs;
    this.reset();
  }

  reset(now = null) {
    this.blinks = [];
    this.observed = [];
    this.baselineRates = [];
    this.lastAt = now;
    this.lastBaselineSampleAt = -Infinity;
    this.lastBlinkAt = -Infinity;
    this.lowObservedMs = 0;
    this.suppressUntil = 0;
  }

  resetWindow(now = null) {
    this.blinks = [];
    this.observed = [];
    this.lastAt = now;
    this.lastBlinkAt = -Infinity;
    this.lowObservedMs = 0;
  }

  addObserved(start, end) {
    if (end <= start) return;
    const previous = this.observed.at(-1);
    if (previous && start <= previous.end) previous.end = Math.max(previous.end, end);
    else this.observed.push({ start, end });
  }

  prune(now) {
    const cutoff = now - this.windowMs;
    while (this.blinks.length && this.blinks[0] < cutoff) this.blinks.shift();
    while (this.observed.length && this.observed[0].end < cutoff) this.observed.shift();
  }

  metrics(now) {
    this.prune(now);
    const cutoff = now - this.windowMs;
    const observedMs = this.observed.reduce((sum, segment) => (
      sum + Math.max(0, segment.end - Math.max(cutoff, segment.start))
    ), 0);
    const rate = observedMs >= 5000 ? this.blinks.length * 60000 / observedMs : 0;
    const sortedBaseline = [...this.baselineRates].sort((a, b) => a - b);
    const baseline = sortedBaseline.length
      ? sortedBaseline[Math.floor(sortedBaseline.length / 2)]
      : null;
    const threshold = baseline === null ? null : clamp(baseline * .55, 6, 12);
    return {
      observedMs,
      rate,
      baseline,
      threshold,
      ready: this.baselineRates.length >= 6,
      lowDurationMs: this.lowObservedMs,
      sinceLastBlinkMs: now - this.lastBlinkAt,
      suppressed: now < this.suppressUntil
    };
  }

  update(now, state) {
    const delta = this.lastAt === null ? 0 : Math.min(250, Math.max(0, now - this.lastAt));
    if (state === "open" || state === "resting") this.addObserved(now - delta, now);
    this.lastAt = now;

    let metrics = this.metrics(now);
    if (
      state !== "uncertain" &&
      metrics.observedMs >= this.minimumObservedMs &&
      this.baselineRates.length < 18 &&
      now - this.lastBaselineSampleAt >= 10000
    ) {
      this.baselineRates.push(metrics.rate);
      this.lastBaselineSampleAt = now;
      metrics = this.metrics(now);
    }

    const low = metrics.ready && metrics.observedMs >= this.minimumObservedMs && metrics.rate < metrics.threshold;
    if (!low) this.lowObservedMs = 0;
    else if (state === "open" || state === "resting") this.lowObservedMs += delta;
    return this.metrics(now);
  }

  recordBlink(now, closureDuration = 0) {
    this.blinks.push(now);
    this.lastBlinkAt = now;
    if (closureDuration >= 800) {
      this.suppressUntil = Math.max(this.suppressUntil, now + 30000);
      this.lowObservedMs = 0;
    }
    this.prune(now);
  }

  shouldRemind(now, state = "open") {
    const metrics = this.metrics(now);
    return state === "open" &&
      metrics.ready &&
      metrics.observedMs >= this.minimumObservedMs &&
      metrics.lowDurationMs >= 25000 &&
      metrics.sinceLastBlinkMs >= 8000 &&
      !metrics.suppressed;
  }
}

export function openReminderStatus({ now, eyeState, openMs, targetMs, lastReminderAt,
  cooldownMs = 60000, facePresent = true, reminderVisible = false }) {
  const cooldownSeconds = Math.ceil(Math.max(0, lastReminderAt + cooldownMs - now) / 1000);
  return {
    cooldownSeconds,
    eligible: facePresent && eyeState === "open" && openMs >= targetMs &&
      cooldownSeconds === 0 && !reminderVisible
  };
}

export class AdaptiveInferenceScheduler {
  constructor({
    standardFps = 20,
    degradedFps = 15,
    sampleWindowMs = 5000,
    minimumObservationMs = 2000,
    minimumSamples = 12,
    degradeP90Ms = 45,
    recoverP90Ms = 34,
    degradedHoldMs = 30000
  } = {}) {
    this.standardFps = standardFps;
    this.degradedFps = degradedFps;
    this.sampleWindowMs = sampleWindowMs;
    this.minimumObservationMs = minimumObservationMs;
    this.minimumSamples = minimumSamples;
    this.degradeP90Ms = degradeP90Ms;
    this.recoverP90Ms = recoverP90Ms;
    this.degradedHoldMs = degradedHoldMs;
    this.reset();
  }

  reset(now = 0) {
    this.mode = "standard";
    this.lastRunAt = now - this.intervalMs();
    this.samples = [];
    this.modeUntil = 0;
  }

  resetSchedule(now = 0) {
    this.lastRunAt = now - this.intervalMs();
  }

  intervalMs() {
    const fps = this.mode === "degraded" ? this.degradedFps : this.standardFps;
    return 1000 / fps;
  }

  shouldRun(now) {
    if (now - this.lastRunAt + .5 < this.intervalMs()) return false;
    this.lastRunAt = now;
    return true;
  }

  percentile90() {
    if (!this.samples.length) return 0;
    const sorted = this.samples.map((sample) => sample.duration).sort((a, b) => a - b);
    return sorted[Math.min(sorted.length - 1, Math.ceil(sorted.length * .9) - 1)];
  }

  record(duration, now) {
    if (!Number.isFinite(duration) || duration < 0) return false;
    this.samples.push({ at: now, duration });
    const cutoff = now - this.sampleWindowMs;
    while (this.samples.length && this.samples[0].at < cutoff) this.samples.shift();

    const observedMs = this.samples.length > 1 ? now - this.samples[0].at : 0;
    if (this.samples.length < this.minimumSamples || observedMs < this.minimumObservationMs) return false;

    const p90 = this.percentile90();
    if (this.mode === "standard" && p90 >= this.degradeP90Ms) {
      this.mode = "degraded";
      this.modeUntil = now + this.degradedHoldMs;
      this.lastRunAt = now;
      return true;
    }
    if (this.mode === "degraded" && now >= this.modeUntil) {
      if (p90 <= this.recoverP90Ms) {
        this.mode = "standard";
        this.modeUntil = 0;
        this.lastRunAt = now;
        return true;
      }
      this.modeUntil = now + Math.min(10000, this.degradedHoldMs);
    }
    return false;
  }

  snapshot() {
    return {
      mode: this.mode,
      targetFps: this.mode === "degraded" ? this.degradedFps : this.standardFps,
      p90InferenceMs: Math.round(this.percentile90() * 10) / 10,
      sampleCount: this.samples.length
    };
  }
}
