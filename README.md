# Blink Guardian／眨眼守門員

使用 Webcam 與 MediaPipe Face Landmarker 在瀏覽器端監測眨眼節奏。低於設定頻率或超過 10 秒未眨眼時，介面會提示使用者完成 3 次完整眨眼；每 20 分鐘另有 20-20-20 休息提醒。

## 本機開發

需求：Node.js 22.13 以上。

```powershell
npm ci
npm run dev
```

依終端機顯示的 Local URL 開啟網站，並允許瀏覽器使用鏡頭。

## 驗證

```powershell
npm test
```

`npm test` 會建立 Sites 相容的 production build，並檢查核心頁面、鏡頭 API、MediaPipe 模型設定與隱私說明是否存在。

## 專案結構

- `public/blink-guardian.html`：主要 UI 與眨眼偵測邏輯。
- `app/page.tsx`：將網站根路徑導向主要頁面。
- `scripts/vinext.mjs`：跨 Windows／macOS／Linux 的 vinext 啟動器。
- `.openai/hosting.json`：OpenAI Sites project linkage。

## 隱私與限制

- 鏡頭畫面只在瀏覽器中交由 MediaPipe 處理，不錄影或上傳。
- 第一次載入需從 CDN 下載 MediaPipe JavaScript、WebAssembly 與 Face Landmarker model。
- 預設 12 次／分鐘及 10 秒間隔是行為提醒門檻，不是醫療診斷標準。
- 若持續乾澀、疼痛、畏光或視力改變，應諮詢眼科醫師。

目前私人部署：<https://blink-guardian-tw.kate0099.chatgpt.site>
