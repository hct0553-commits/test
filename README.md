# 冰箱料理助手

拍一張食材照片，App 會辨識裡面有哪些食材，再推薦可以做的台灣家常菜與詳細做法。

## 使用流程

1. **拍照或從相簿選圖**：照片會在手機端先縮小，再送到伺服器。
2. **確認食材**：辨識結果以標籤呈現，把握度低的會加上「？」與虛線框。使用者可以刪掉認錯的，也能手動補上（可一次輸入多項，用「、」分隔）。
3. **推薦料理**：一次推薦 3 到 5 道台灣家常菜，涵蓋熱炒、湯品、涼拌、蒸煮、煎烤、滷燉。每道菜列出用到的食材、需另外準備的食材、調味料、步驟與小訣竅。

鹽、糖、醬油、米酒、香油、白胡椒粉、蠔油、烏醋、食用油、太白粉視為家裡已有，不會列在「需另外準備」。

## 架構

```
server.js                 Express 後端，呼叫 Claude API
  POST /api/ingredients   照片 → 食材清單
  POST /api/recipes       食材清單 → 食譜
public/
  index.html              手機優先的單頁介面
  app.js                  拍照、縮圖、食材編輯、食譜呈現
  style.css               樣式（支援深色模式）
  manifest.webmanifest    可加到手機主畫面
```

- 影像辨識與食譜產生都使用 Claude（`claude-opus-5-5`），透過結構化輸出（Zod schema）取得固定格式的 JSON，前端不需要解析自由文字。
- API 金鑰只存在伺服器端，前端不會接觸到。
- 已開啟伺服器端的 `fallbacks: "default"`：如果模型的安全機制婉拒某個請求，API 會自動改用備援模型重跑。

## 安裝與執行

需要 Node.js 22 以上。

```bash
npm install
cp .env.example .env      # 在 .env 中填入 ANTHROPIC_API_KEY
npm start
```

打開 http://localhost:3000 即可使用。

要在手機上測試相機功能，手機與電腦必須在同一個網路，並以 HTTPS 開啟（瀏覽器只在 HTTPS 或 localhost 下開放相機）。最簡單的做法是部署到 Render、Railway、Fly.io 這類平台，或在本機用 ngrok 之類的工具建立 HTTPS 通道。

## 部署到 Render

repo 裡的 `render.yaml` 已經寫好服務設定（Node 環境、新加坡區域、免費方案、健康檢查 `/healthz`）。

1. 登入 [dashboard.render.com](https://dashboard.render.com)，連結 GitHub 帳號。
2. 點「New」→「Blueprint」，選擇這個 repo。
3. Render 會提示填入 `ANTHROPIC_API_KEY`，貼上金鑰後按「Apply」。
4. 建置完成後會得到 `https://<服務名稱>.onrender.com` 網址，手機打開即可拍照使用。

之後每次推送到 repo 的預設分支，Render 都會自動重新部署。

免費方案的服務閒置約 15 分鐘後會休眠，下次開啟需等 30 到 60 秒喚醒。要避免休眠，把 `render.yaml` 中的 `plan: free` 改成 `plan: starter`（付費方案）。

## 可以調整的地方

- **推薦風格**：修改 `server.js` 中的 `RECIPE_SYSTEM` 提示詞，例如改成「適合小孩」、「低油低鹽」或「十分鐘快手菜」。
- **辨識與食譜的品質和速度**：`/api/ingredients` 使用 `effort: "low"` 求快，`/api/recipes` 使用 `effort: "medium"`。如果覺得食譜不夠講究，可以調高成 `"high"`，回應會比較慢。
