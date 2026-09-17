import test from 'node:test';
import assert from 'node:assert/strict';
import { PostureTracker, readPosture, PostureMonitor } from '../posture-monitor.js';
import { reminderSoundPattern } from '../monitoring-features.js';

function pose(drop = 0, scale = 1) {
  const p = Array.from({ length: 33 }, () => ({ x: .5, y: .5, visibility: 1 }));
  for (const [id, x, y] of [[0,.5,.33+drop],[7,.42,.3+drop],[8,.58,.3+drop],[11,.3,.6],[12,.7,.6]]) {
    p[id] = { x: .5 + (x-.5)*scale, y: .5 + (y-.5)*scale, visibility: 1 };
  }
  return p;
}
function calibrated() {
  const t = new PostureTracker(); t.beginCalibration();
  for (let n=0; n<=3000; n+=500) t.update(n,pose());
  assert.equal(t.snapshot(3000).state,'normal'); return t;
}
test('posture requires manual stable calibration and rejects cropped or obscured shoulders', () => {
  const t = new PostureTracker(); t.update(0,pose()); assert.equal(t.baseline,null);
  const p=pose(); p[11].visibility=.2; assert.equal(readPosture(p),null);
  p[11].visibility=1; p[11].x=-.1; assert.equal(readPosture(p),null);
  assert.equal(readPosture(pose(),NaN),null);
  calibrated();
});
test('relative head/shoulder height is scale invariant and brief dips do not remind', () => {
  const t=calibrated();
  t.update(3500,pose(0,1.2)); assert.equal(t.snapshot(3500).state,'normal');
  for(let n=4000;n<=8500;n+=500)t.update(n,pose(.08));
  assert.equal(t.shouldRemind(8500),false);
  t.update(9000,pose()); assert.equal(t.badMs,0);
});
test('sustained posture drift reminds once, uses release hysteresis and cooldown', () => {
  const t=calibrated();
  for(let n=3500;n<=13500;n+=500)t.update(n,pose(.08));
  assert.equal(t.shouldRemind(13500),true); t.markReminded(13500);
  t.update(14000,pose(.045)); assert.equal(t.snapshot(14000).state,'slouch');
  assert.equal(t.shouldRemind(14000),false);
  t.update(14500,pose()); assert.equal(t.snapshot(14500).state,'normal');
  for(let n=15000;n<=25000;n+=500)t.update(n,pose(.08));
  assert.equal(t.shouldRemind(25000),false);
});
test('missing or stale frames cannot accumulate posture hold duration', () => {
  const t=calibrated();
  t.update(3500,pose(.08)); t.update(4000,pose(.08)); t.update(4500,null);
  assert.equal(t.badMs,0); assert.equal(t.snapshot(4500).state,'uncertain');
  t.update(5000,pose(.08)); t.update(20000,pose(.08));
  assert.equal(t.badMs,0); assert.equal(t.shouldRemind(22000),false);
  const turn=pose();turn[0].x=.57; t.update(20500,turn);
  assert.equal(t.snapshot(20500).state,'uncertain');
  t.reset(); assert.equal(t.baseline,null);
});
test('posture audio is distinct from both other reminders',()=>{
  assert.notDeepEqual(reminderSoundPattern('posture'),reminderSoundPattern('blink'));
  assert.notDeepEqual(reminderSoundPattern('posture'),reminderSoundPattern('distance'));
});
test('worker sampling has bounded frequency/backpressure and releases stopped in-flight frames',async()=>{
  const oldBitmap=globalThis.createImageBitmap, oldDocument=globalThis.document;
  let closeCount=0, sent=0, finish;
  globalThis.document={hidden:false};
  globalThis.createImageBitmap=()=>new Promise(resolve=>{finish=()=>resolve({close(){closeCount++;}});});
  try {
    const monitor=new PostureMonitor();
    monitor.worker={postMessage(){sent++;},terminate(){}};
    const video={readyState:2,currentTime:1,videoWidth:640,videoHeight:480};
    const pending=monitor.sample(video,1000);
    await monitor.sample(video,2000); assert.equal(monitor.lastFrameAt,1000);
    monitor.stop(); finish(); await pending;
    assert.equal(closeCount,1);assert.equal(sent,0);assert.equal(monitor.worker,null);
    globalThis.createImageBitmap=async()=>({close(){}});
    monitor.worker={postMessage(){sent++;},terminate(){}};
    await monitor.sample(video,3000); assert.equal(sent,1);
    monitor.pending=false;video.currentTime=2;
    await monitor.sample(video,3100);assert.equal(sent,1);
    monitor.stop();
  } finally {globalThis.createImageBitmap=oldBitmap;globalThis.document=oldDocument;}
});
