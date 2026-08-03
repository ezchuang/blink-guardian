const clamp = (value, min = 0, max = 1) => Math.min(max, Math.max(min, value));

function percentile(values, ratio, fallback = .05) {
  if (!values.length) return fallback;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.floor((sorted.length - 1) * ratio)] ?? fallback;
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

export class AngleRobustBlinkDetector {
  constructor({ sensitivity = 5 } = {}) {
    this.setSensitivity(sensitivity);
    this.resetCalibration();
  }

  setSensitivity(level) {
    this.sensitivityLevel = clamp(Math.round(Number(level) || 5), 1, 6);
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
    this.calibrationLeft = [];
    this.calibrationRight = [];
    this.calibrationLeftEar = [];
    this.calibrationRightEar = [];
    this.openLeft = .05;
    this.openRight = .05;
    this.openLeftEar = null;
    this.openRightEar = null;
    this.resetMotion();
  }

  addCalibrationFrame(left, right, landmarks, aspectRatio = 1) {
    this.calibrationLeft.push(clamp(left));
    this.calibrationRight.push(clamp(right));
    const geometry = eyeGeometry(landmarks, aspectRatio);
    if (geometry.leftEar) this.calibrationLeftEar.push(geometry.leftEar);
    if (geometry.rightEar) this.calibrationRightEar.push(geometry.rightEar);
  }

  finishCalibration() {
    this.openLeft = clamp(percentile(this.calibrationLeft, .25), .01, .32);
    this.openRight = clamp(percentile(this.calibrationRight, .25), .01, .32);
    this.openLeftEar = percentile(this.calibrationLeftEar, .7, 0) || null;
    this.openRightEar = percentile(this.calibrationRightEar, .7, 0) || null;
    this.resetMotion();
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
    const leftGeometryLevel = this.geometryClosure(geometry.leftEar, this.openLeftEar);
    const rightGeometryLevel = this.geometryClosure(geometry.rightEar, this.openRightEar);
    const leftLevel = Math.max(this.normalizedBlendClosure(this.smoothLeft, this.openLeft), leftGeometryLevel);
    const rightLevel = Math.max(this.normalizedBlendClosure(this.smoothRight, this.openRight), rightGeometryLevel);
    const rawLeftLevel = Math.max(this.normalizedBlendClosure(left, this.openLeft), leftGeometryLevel);
    const rawRightLevel = Math.max(this.normalizedBlendClosure(right, this.openRight), rightGeometryLevel);
    const weights = eyeVisibilityWeights(landmarks, aspectRatio);
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
      closeThreshold: threshold.close
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
  constructor() {
    this.reset();
  }

  reset(now = null) {
    this.openMs = 0;
    this.lastAt = now;
  }

  update(now, state) {
    const delta = this.lastAt === null ? 0 : Math.min(150, Math.max(0, now - this.lastAt));
    this.lastAt = now;
    if (state === "open") this.openMs += delta;
    else if (state === "resting") this.openMs = 0;
    return this.openMs;
  }
}
