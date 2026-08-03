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
  constructor() {
    this.resetCalibration();
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
    const weights = eyeVisibilityWeights(landmarks, aspectRatio);
    const combined = leftLevel * weights.left + rightLevel * weights.right;
    const angled = weights.asymmetry >= .1;
    const closeSignal = angled
      ? combined >= .32 && Math.max(leftLevel, rightLevel) >= .4 && Math.min(leftLevel, rightLevel) >= .06
      : combined >= .34 && Math.min(leftLevel, rightLevel) >= .16;
    const openSignal = combined <= .13 && Math.max(leftLevel, rightLevel) <= .22;
    let blink = false;

    if (!this.closed) {
      if (closeSignal) {
        this.closeCandidateAt ||= now;
        if (now - this.closeCandidateAt >= 28) {
          this.closed = true;
          this.closedAt = this.closeCandidateAt;
        }
      } else {
        this.closeCandidateAt = 0;
      }
    } else if (openSignal) {
      const duration = now - this.closedAt;
      blink = duration >= 55 && duration <= 1200 && now - this.lastBlinkAt >= 180;
      if (blink) this.lastBlinkAt = now;
      this.closed = false;
      this.closeCandidateAt = 0;
      this.closedAt = 0;
    } else if (now - this.closedAt > 1200) {
      this.closed = false;
      this.closeCandidateAt = 0;
      this.closedAt = 0;
    }

    return { blink, leftLevel, rightLevel, combined, angled };
  }
}
