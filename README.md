# Blink Guardian／眨眼守門員

A privacy-first, browser-based blink timing and break reminder powered by MediaPipe Face Landmarker.

[線上使用](https://ezchuang.github.io/blink-guardian/) · [回報問題](https://github.com/ezchuang/blink-guardian/issues)

Blink Guardian 使用 Webcam 在瀏覽器端估算眼睛閉合狀態、連續開眼時間與眨眼節奏。影像不會錄製或上傳；偵測結果與最長 24 小時的歷史紀錄只保存在目前裝置。

GitHub 版本是純靜態單頁 Web app，可直接部署至 GitHub Pages；不需要 backend、database 或 OpenAI Sites runtime。頁面以 `index.html` 為入口，功能程式與 assets 分開管理，方便測試與維護。

## 功能

- 以連續開眼時間作為單次提醒安全網。
- 使用 60 秒移動窗與 session baseline 判斷持續偏低的眨眼節奏。
- 依臉部角度建立獨立的開眼 baseline，回到相同角度時重用 profile。
- 將視訊分析限制在 20 FPS，裝置負載偏高時自動降至 15 FPS，降低較舊 Mac 的卡頓與耗電。
- 記錄有效閉合頻率、平均閉眼時長與提醒事件，時間窗最長 24 小時。
- 提供 20-20-20 遠望休息提醒。
- 靈敏度與連續開眼提醒秒數可在介面調整；靈敏度於重新開始時重設。

## 隱私與限制

- Webcam 影像只在瀏覽器中交由 MediaPipe 處理，不錄影或上傳。
- 第一次使用需從 CDN 下載 MediaPipe JavaScript、WebAssembly 與 Face Landmarker model。
- 瀏覽器進入背景或最小化時會暫停高頻影像處理，回到頁面後重新校正。
- 「有效閉合」是 Webcam 模型的行為估計，不等同醫療等級的完整眨眼判定。
- 這是習慣提醒工具，不是醫療器材或診斷。若持續乾澀、疼痛、畏光或視力改變，請諮詢眼科醫師。

## 本機開發

需求：Node.js 22.13 以上。

```powershell
npm ci
npm run dev
```

開啟終端機顯示的 `http://127.0.0.1:4317/`，並允許瀏覽器使用鏡頭。

## 驗證

```powershell
npm test
npm run lint
```

`npm test` 會建立 `dist/` static site，並驗證偵測狀態機、移動窗提醒與頁面必要功能。GitHub Pages workflow 只會在驗證成功後發布 `dist/`。

## 技術

- Vanilla HTML、CSS、JavaScript
- MediaPipe Face Landmarker
- Canvas history charts
- Browser `localStorage`
- GitHub Pages／GitHub Actions

## License

[MIT](LICENSE) © 2026 ezchuang
