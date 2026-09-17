// This is a calibrated head/shoulder posture cue, not spinal curvature diagnosis.
export function readPosture(points, aspect = 1) {
  const ids = [0, 7, 8, 11, 12];
  if (!(aspect > 0) || !Number.isFinite(aspect) || ids.some(i => {
    const p = points?.[i];
    return !p || !Number.isFinite(p.x) || !Number.isFinite(p.y) ||
      !(p.visibility >= .7) || p.x < .02 || p.x > .98 || p.y < .02 || p.y > .98;
  })) return null;
  const [nose, le, re, ls, rs] = ids.map(i => ({ x: points[i].x * aspect, y: points[i].y }));
  const dx = rs.x - ls.x, dy = rs.y - ls.y, width = Math.hypot(dx, dy);
  if (width < .15 || Math.abs(dy / width) > .25) return null;
  const earX = (le.x + re.x) / 2, earY = (le.y + re.y) / 2;
  const earWidth = Math.abs(le.x - re.x);
  if (earWidth < .05 || Math.abs(nose.x - earX) / earWidth > .3) return null;
  const height = ((ls.y + rs.y) / 2 - earY) / width;
  if (height < .05 || height > 1.5) return null;
  return { height, offset: (earX - (ls.x + rs.x) / 2) / width, yaw: (nose.x - earX) / earWidth };
}

export class PostureTracker {
  constructor() { this.reset(); }
  reset() {
    this.baseline = null; this.calibrating = false; this.samples = [];
    this.lastReminderAt = -Infinity; this.reminded = false; this.invalidate();
  }
  invalidate() { this.lastAt = -Infinity; this.badMs = 0; this.deviation = null; this.bad = false; this.samples = []; }
  beginCalibration() { this.reset(); this.calibrating = true; }
  update(now, points, aspect = 1) {
    const prior = this.lastAt;
    if (now - prior > 1500) this.invalidate();
    const p = readPosture(points, aspect);
    if (!p) { this.invalidate(); return; }
    this.lastAt = now;
    if (this.calibrating) {
      this.samples.push({ ...p, at: now });
      this.samples = this.samples.filter(s => now - s.at <= 3500);
      if (this.samples.length < 6 || now - this.samples[0].at < 3000) return;
      const mean = key => this.samples.reduce((sum, s) => sum + s[key], 0) / this.samples.length;
      const b = { height: mean('height'), offset: mean('offset'), yaw: mean('yaw') };
      if (this.samples.some(s => Math.abs(s.height - b.height) > .04 || Math.abs(s.offset - b.offset) > .04 || Math.abs(s.yaw - b.yaw) > .06)) return;
      this.baseline = b; this.calibrating = false; this.samples = [];
    }
    if (!this.baseline) return;
    if (Math.abs(p.yaw - this.baseline.yaw) > .12 || Math.abs(p.offset - this.baseline.offset) > .2) { this.invalidate(); return; }
    this.deviation = this.baseline.height - p.height;
    if (this.deviation <= .08) { this.bad = false; this.badMs = 0; this.reminded = false; }
    else if (this.deviation >= .15 || this.bad) {
      if (this.bad) this.badMs += Math.min(750, Math.max(0, now - prior));
      this.bad = true;
    }
  }
  snapshot(now) { return { state: this.calibrating ? 'calibrating' : !this.baseline ? 'needs-baseline' :
    now - this.lastAt > 1500 || this.deviation === null ? 'uncertain' : this.bad ? 'slouch' : 'normal' }; }
  shouldRemind(now) { return this.snapshot(now).state === 'slouch' && this.badMs >= 10000 && !this.reminded && now - this.lastReminderAt >= 60000; }
  markReminded(now) { this.reminded = true; this.lastReminderAt = now; }
}

// One in-flight frame; terminating the worker releases its model and drops stale results.
export class PostureMonitor {
  constructor() { this.tracker = new PostureTracker(); this.worker = null; this.pending = false; this.lastFrameAt = -Infinity; this.lastVideoTime = -1; this.error = null; }
  async start(moduleUrl, wasmUrl) {
    this.stop(); this.error = null; this.processedFrames = 0;
    // MediaPipe's WASM loader uses importScripts; a classic worker supports it.
    const worker = new Worker(new URL('./posture-worker.js', import.meta.url));
    this.worker = worker;
    await new Promise((resolve, reject) => {
      const timeout = setTimeout(() => { this.stop(); reject(new Error('Posture model loading timed out')); }, 45000);
      this.cancelLoad = () => { clearTimeout(timeout); reject(new Error('Posture loading cancelled')); };
      worker.onerror = () => {
        this.error = '姿勢模型發生錯誤，請關閉後重新開啟。';
        clearTimeout(timeout); this.cancelLoad = null; worker.terminate(); this.worker = null;
        this.tracker.invalidate(); reject(new Error(this.error));
      };
      worker.onmessage = ({ data }) => {
        if (this.worker !== worker) return;
        if (data.type === 'ready') { clearTimeout(timeout); this.cancelLoad = null; resolve(); }
        else if (data.type === 'error') {
          this.error = '姿勢偵測失敗，請關閉後重新開啟。';
          clearTimeout(timeout); this.cancelLoad = null; worker.terminate(); this.worker = null;
          this.pending = false; this.tracker.invalidate(); reject(new Error(data.message));
        } else if (data.type === 'result') {
          this.processedFrames++;
          this.pending = false;
          if (!document.hidden && performance.now() - data.at <= 1500) this.tracker.update(data.at, data.points, data.aspect);
        }
      };
      worker.postMessage({ type: 'init', moduleUrl, wasmUrl });
    });
  }
  stop() {
    this.cancelLoad?.(); this.cancelLoad = null;
    this.worker?.terminate(); this.worker = null; this.pending = false;
    this.lastFrameAt = -Infinity; this.lastVideoTime = -1; this.tracker.reset();
  }
  async sample(video, now) {
    if (!this.worker || this.pending || video.readyState < 2 || video.currentTime === this.lastVideoTime || now - this.lastFrameAt < 500) return;
    const worker = this.worker;
    this.pending = true; this.lastFrameAt = now; this.lastVideoTime = video.currentTime;
    try {
      const bitmap = await createImageBitmap(video, { resizeWidth: 320, resizeHeight: Math.round(320 * video.videoHeight / video.videoWidth) });
      if (this.worker !== worker || document.hidden) { bitmap.close(); if (this.worker === worker) this.pending = false; return; }
      worker.postMessage({ type: 'frame', bitmap, at: now, aspect: video.videoWidth / video.videoHeight }, [bitmap]);
    } catch { if (this.worker === worker) { this.pending = false; this.tracker.invalidate(); } }
  }
}
