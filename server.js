import Anthropic from "@anthropic-ai/sdk";
import { betaZodOutputFormat } from "@anthropic-ai/sdk/helpers/beta/zod";
import express from "express";
import { z } from "zod";

const MODEL = "claude-opus-5-5";
const PORT = process.env.PORT || 3000;
const ALLOWED_MEDIA_TYPES = ["image/jpeg", "image/png", "image/webp", "image/gif"];

const client = new Anthropic();
const app = express();

app.use(express.json({ limit: "15mb" }));
app.use(express.static("public"));

// ---------- 結構化輸出格式 ----------

const IngredientsSchema = z.object({
  ingredients: z
    .array(
      z.object({
        name: z.string().describe("食材名稱，使用台灣常用的繁體中文說法，例如：芥蘭、青蔥、牛番茄"),
        confidence: z.enum(["高", "中", "低"]).describe("辨識把握程度"),
      }),
    )
    .describe("照片中可辨識的食材"),
  note: z.string().describe("給使用者的簡短提醒，例如照片模糊或有疑似但不確定的食材；沒有就留空字串"),
});

const RecipesSchema = z.object({
  recipes: z.array(
    z.object({
      name: z.string().describe("菜名，例如：番茄炒蛋"),
      category: z.enum(["熱炒", "湯品", "涼拌", "蒸煮", "煎烤", "滷燉"]),
      description: z.string().describe("一句話介紹這道菜"),
      time_minutes: z.number().int().describe("約需幾分鐘"),
      difficulty: z.enum(["簡單", "中等", "進階"]),
      servings: z.string().describe("份量，例如：2 人份"),
      used_ingredients: z.array(z.string()).describe("用到使用者手上的哪些食材，含份量"),
      missing_ingredients: z.array(z.string()).describe("使用者沒有、需要另外準備的食材；沒有就給空陣列"),
      seasonings: z.array(z.string()).describe("需要的家常調味料，含份量，例如：醬油 1 大匙"),
      steps: z.array(z.string()).describe("料理步驟，每步一句到兩句"),
      tip: z.string().describe("一個讓這道菜更好吃的小訣竅"),
    }),
  ),
});

// ---------- 提示詞 ----------

const INGREDIENT_SYSTEM = `你是一位熟悉台灣傳統市場與超市的料理助手。
使用者會上傳一張照片，可能是冰箱內部、流理台或購物袋裡的食材。
請列出照片中看得到的可食用食材，並遵守以下原則：
- 使用台灣常用的繁體中文名稱（例如：芥蘭、空心菜、地瓜葉、青江菜、牛番茄、雞蛋、板豆腐）。
- 外觀相近、容易混淆的食材（例如芥蘭與菜心、青蔥與蒜苗），把握度請標為「中」或「低」，並在 note 中說明。
- 不要列出包裝內看不清楚的東西，也不要列出非食材（碗盤、器具）。
- 同一種食材只列一次。`;

const RECIPE_SYSTEM = `你是一位台灣家常菜老師傅，擅長用手邊現有食材做出道地的台式家常料理。
根據使用者提供的食材清單，推薦可以做的台灣中式料理，遵守以下原則：
- 以台灣家庭常見的做法為主：熱炒、湯品、涼拌、蒸煮、煎烤、滷燉都可以。
- 優先推薦「只用手邊食材加上家常調味料」就能完成的菜；必須額外購買食材的菜排在後面，並在 missing_ingredients 中寫清楚。
- 家常調味料視為家裡已有：鹽、糖、醬油、米酒、香油、白胡椒粉、蠔油、烏醋、食用油、太白粉。請寫在 seasonings 中，不要放進 missing_ingredients。
- 份量使用台灣家庭習慣的單位（大匙、小匙、顆、把、瓣）。
- 步驟要具體到火候與時間，讓不常下廚的人也能照著做。
- 推薦 3 到 5 道，菜色之間盡量不要重複（例如不要三道都是炒蛋）。`;

// ---------- 共用：呼叫 Claude ----------

async function callClaude({ system, content, schema, effort }) {
  const response = await client.beta.messages.parse({
    model: MODEL,
    max_tokens: 16000,
    betas: ["server-side-fallback-2026-07-01"],
    fallbacks: "default",
    output_config: { effort, format: betaZodOutputFormat(schema) },
    system,
    messages: [{ role: "user", content }],
  });

  if (response.stop_reason === "refusal") {
    throw new UserFacingError("這張照片或這組食材目前無法處理，請換一張照片再試一次。");
  }
  if (response.stop_reason === "max_tokens" || !response.parsed_output) {
    throw new UserFacingError("回應不完整，請再試一次。");
  }
  return response.parsed_output;
}

class UserFacingError extends Error {}

function handleError(res, error) {
  if (error instanceof UserFacingError) {
    return res.status(422).json({ error: error.message });
  }
  if (error instanceof Anthropic.AuthenticationError) {
    console.error("API 金鑰無效或未設定");
    return res.status(500).json({ error: "伺服器的 API 金鑰設定有誤，請聯絡管理者。" });
  }
  if (error instanceof Anthropic.RateLimitError) {
    return res.status(429).json({ error: "目前使用人數較多，請稍後再試。" });
  }
  if (error instanceof Anthropic.BadRequestError) {
    console.error("Bad request:", error.message);
    return res.status(400).json({ error: "照片格式或內容無法處理，請換一張照片。" });
  }
  if (error instanceof Anthropic.APIError) {
    console.error(`API error ${error.status}:`, error.message);
    return res.status(502).json({ error: "辨識服務暫時無法使用，請稍後再試。" });
  }
  console.error(error);
  return res.status(500).json({ error: "發生未預期的錯誤。" });
}

// ---------- API ----------

app.get("/healthz", (req, res) => {
  res.json({ ok: true });
});

app.post("/api/ingredients", async (req, res) => {
  const { image, mediaType } = req.body ?? {};
  if (typeof image !== "string" || !image || !ALLOWED_MEDIA_TYPES.includes(mediaType)) {
    return res.status(400).json({ error: "請上傳 JPEG、PNG、WebP 或 GIF 格式的照片。" });
  }

  try {
    const result = await callClaude({
      system: INGREDIENT_SYSTEM,
      effort: "low",
      schema: IngredientsSchema,
      content: [
        { type: "image", source: { type: "base64", media_type: mediaType, data: image } },
        { type: "text", text: "請列出這張照片裡的食材。" },
      ],
    });
    res.json(result);
  } catch (error) {
    handleError(res, error);
  }
});

app.post("/api/recipes", async (req, res) => {
  const { ingredients } = req.body ?? {};
  const list = Array.isArray(ingredients)
    ? ingredients.filter((item) => typeof item === "string" && item.trim()).map((item) => item.trim().slice(0, 30))
    : [];
  if (list.length === 0 || list.length > 40) {
    return res.status(400).json({ error: "請提供 1 到 40 項食材。" });
  }

  try {
    const result = await callClaude({
      system: RECIPE_SYSTEM,
      effort: "medium",
      schema: RecipesSchema,
      content: `我手邊的食材有：${list.join("、")}。請推薦可以做的台灣家常菜。`,
    });
    res.json(result);
  } catch (error) {
    handleError(res, error);
  }
});

app.listen(PORT, () => {
  console.log(`冰箱料理助手已啟動：http://localhost:${PORT}`);
});
