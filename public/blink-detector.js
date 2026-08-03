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
    const close = (angled ? .37 : .39) - this.sensitivity * .2;
    return {
      close,
      minEye: .2 - this.sensitivity * .08,
      open: .13 + this.sensitivity * .05,
      openEye: .22 + this.sensitivity * .08
    };
  }

  resetCalibration() {
    this.calibrationLeft = [];
    this.calibrationRight = [];
    this.openLeft = .05;
    this.openRight = .05;
    this.resetMotion();
  }

  addCalibrationFrame(left, right) {
    this.calibrationLeft.push(clamp(left));
    this.calibrationRight.push(clamp(right));
  }

  finishCalibration() {
    this.openLeft = clamp(percentile(this.calibrationLeft, .25), .01, .32);
    this.openRight = clamp(percentile(this.calibrationRight, .25), .01, .32);
    this.resetMotion();
  }

  resetMotion() {
    this.closed = false;
    this.closeCandidateAt = 0;
    this.closedAt = 0;
    this.lastBlinkAt = -Infinity;
    this.fastClosure = false;
    this.smoothLeft = null;
    this.smoothRight = null;
  }

  normalizedClosure(value, baseline) {
    return clamp((value - baseline) / Math.max(.2, 1 - baseline));
  }

  update({ now, left, right, landmarks, aspectRatio = 1 }) {
    this.smoothLeft = this.smoothLeft === null ? left : this.smoothLeft * .55 + left * .45;
    this.smoothRight = this.smoothRight === null ? right : this.smoothRight * .55 + right * .45;

    if (!this.closed && !this.closeCandidateAt) {
      if (this.smoothLeft < this.openLeft + .16) this.openLeft = this.openLeft * .995 + this.smoothLeft * .005;
      if (this.smoothRight < this.openRight + .16) this.openRight = this.openRight * .995 + this.smoothRight * .005;
    }

    const leftLevel = this.normalizedClosure(this.smoothLeft, this.openLeft);
    const rightLevel = this.normalizedClosure(this.smoothRight, this.openRight);
    const rawLeftLevel = this.normalizedClosure(left, this.openLeft);
    const rawRightLevel = this.normalizedClosure(right, this.openRight);
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
      : combined >= threshold.close && Math.min(leftLevel, rightLevel) >= threshold.minEye;
    const fastCloseSignal = angled
      ? rawVisibleLevel >= threshold.close + .16
      : rawCombined >= threshold.close + .16 && Math.min(rawLeftLevel, rawRightLevel) >= threshold.minEye + .18;
    const rawOpenSignal = angled
      ? rawVisibleLevel <= threshold.openEye
      : rawCombined <= threshold.open && Math.max(rawLeftLevel, rawRightLevel) <= threshold.openEye;
    const openSignal = (angled
      ? visibleLevel <= threshold.openEye
      : combined <= threshold.open && Math.max(leftLevel, rightLevel) <= threshold.openEye)
      || (this.fastClosure && rawOpenSignal);
    let blink = false;

    if (!this.closed) {
      if (fastCloseSignal) {
        this.closed = true;
        this.fastClosure = true;
        this.closedAt = now;
        this.closeCandidateAt = 0;
      } else if (closeSignal) {
        this.closeCandidateAt ||= now;
        if (now - this.closeCandidateAt >= 28) {
          this.closed = true;
          this.fastClosure = false;
          this.closedAt = this.closeCandidateAt;
        }
      } else {
        this.closeCandidateAt = 0;
      }
    } else if (openSignal) {
      const duration = now - this.closedAt;
      const minimumDuration = this.fastClosure ? 20 : 55;
      blink = duration >= minimumDuration && duration <= 1200 && now - this.lastBlinkAt >= 150;
      if (blink) this.lastBlinkAt = now;
      this.closed = false;
      this.fastClosure = false;
      this.closeCandidateAt = 0;
      this.closedAt = 0;
    } else if (now - this.closedAt > 1200) {
      this.closed = false;
      this.fastClosure = false;
      this.closeCandidateAt = 0;
      this.closedAt = 0;
    }

    return { blink, leftLevel, rightLevel, combined, angled, closeThreshold: threshold.close };
  }
}
