let model;
self.onmessage = async ({ data }) => {
  try {
    if (data.type === 'init') {
      const { PoseLandmarker, FilesetResolver } = await import(data.moduleUrl);
      model = await PoseLandmarker.createFromOptions(await FilesetResolver.forVisionTasks(data.wasmUrl), {
        baseOptions: { modelAssetPath: 'https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_lite/float16/1/pose_landmarker_lite.task', delegate: 'CPU' },
        runningMode: 'VIDEO', numPoses: 1, outputSegmentationMasks: false,
        minPoseDetectionConfidence: .6, minPosePresenceConfidence: .6, minTrackingConfidence: .6
      });
      self.postMessage({ type: 'ready' });
    } else if (data.type === 'frame') {
      try {
        const result = model.detectForVideo(data.bitmap, data.at);
        self.postMessage({ type: 'result', points: result.landmarks?.[0] || null, at: data.at, aspect: data.aspect });
      } finally { data.bitmap.close(); }
    }
  } catch (error) { self.postMessage({ type: 'error', message: String(error) }); }
};
