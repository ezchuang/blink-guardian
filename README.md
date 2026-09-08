# Blink Guardian／眨眼守門員

A privacy-first, browser-based blink timing and break reminder powered by MediaPipe Face Landmarker.

[線上使用](https://ezchuang.github.io/blink-guardian/) · [回報問題](https://github.com/ezchuang/blink-guardian/issues)

Blink Guardian 使用 Webcam 在瀏覽器端估算眼睛閉合狀態、連續開眼時間與眨眼節奏。影像不會錄製或上傳；偵測結果與最長 24 小時的歷史紀錄只保存在目前裝置。

GitHub 版本是純靜態單頁 Web app，可直接部署至 GitHub Pages；不需要 backend、database 或 OpenAI Sites runtime。頁面以 `index.html` 為入口，功能程式與 assets 分開管理，方便測試與維護。

## 功能

- 以連續開眼時間作為單次提醒安全網。
- 使用 60 秒移動窗與 session baseline 判斷持續偏低的眨眼節奏。
- 依臉部角度建立獨立的開眼 baseline，回到相同角度時重用 profile。
- 開眼校正需至少 0.6 秒的穩定可信樣本，以中位數排除少數異常值；閉合程度、眼瞼幾何或資料品質不符時會繼續等待，不會在倒數結束後強行接受基準。
- 換姿勢時暫停開眼累計，短暫中斷後接續；超過 3 秒無法判定時顯示連續時間已中斷，恢復後重新累計。此中斷不算一次眨眼或閉眼休息。
- 將視訊分析限制在 20 FPS，裝置負載偏高時自動降至 15 FPS，降低較舊 Mac 的卡頓與耗電。
- 桌面版可開啟不顯示鏡頭畫面的迷你監測窗；同一個 origin 只允許一個視窗持有監測工作。迷你窗內需點擊一次開始，以可靠啟用 Camera 權限與提醒音效。
- 迷你與手機省電模式只每秒更新一次讀秒；偵測頻率與畫面更新頻率彼此獨立。
- 手機省電模式使用較低的 Camera 解析度、15／12 FPS 自適應推論、低解析度圖表並停用裝飾動畫。
- 記錄有效閉合頻率、平均閉眼時長與提醒事件，時間窗最長 24 小時。
- 提供 20-20-20 遠望休息提醒。
- 靈敏度與連續開眼提醒秒數可在介面調整；靈敏度於重新開始時重設。

## 計時與提醒

- 開眼時間只累計可判定為張眼的時間；確認閉眼時歸零。換角度、找不到臉與影像停滯期間暫停累計。
- 單次開眼提醒預設為 10 秒，實際發出眨眼提醒後，開眼提醒至少間隔 60 秒。間隔期間仍會計時，介面會顯示剩餘秒數；閉眼休息、校正或判定不穩時不發出眨眼提醒。
- 「估算頻率」使用最近 60 秒內的有效閉合次數，除以可判定的觀測時間再換算成每分鐘頻率，並非固定 60 秒內的原始次數。觀測不足 5 秒時顯示「—」；不確定區段不加入頻率分母，也不累計節奏持續偏低的時間。
- 初次開始至少等待 3 秒、背景恢復至少等待 1.5 秒再嘗試完成校正；若有效樣本不足會繼續等待。主頁與迷你窗都會區分張眼、閉眼休息、判定不穩、角度校正與等待影像。

## 隱私與限制

- Webcam 影像只在瀏覽器中交由 MediaPipe 處理，不錄影或上傳。
- 第一次使用需從 CDN 下載 MediaPipe JavaScript、WebAssembly 與 Face Landmarker model。
- 瀏覽器進入背景或最小化時會暫停高頻影像處理，回到頁面後重新校正。
- 迷你監測窗可減少主頁切換造成的中斷，但視窗最小化、系統睡眠或手機回收分頁時仍會暫停；一般 Web app 無法保證背景 Camera 永遠持續。
- 「有效閉合」是 Webcam 模型的行為估計，不等同醫療等級的完整眨眼判定。
- 校正品質檢查仍是啟發式估計；眼型、瞇眼、仰角或遮擋可能使校正持續等待。請自然張眼、穩定姿勢並改善光線；靈敏度只調整眨眼門檻，不會略過校正品質檢查。
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
