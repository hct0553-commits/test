// 照片在送出前先縮小，長邊不超過 1568px（Claude 影像辨識的建議上限），減少上傳時間與費用
const MAX_IMAGE_EDGE = 1568;

const state = {
  ingredients: [],
};

const $ = (id) => document.getElementById(id);

// ---------- 步驟一：照片 ----------

for (const input of [$("camera-input"), $("album-input")]) {
  input.addEventListener("change", async (event) => {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (file) await handlePhoto(file);
  });
}

async function handlePhoto(file) {
  setStatus("photo-status", "正在辨識食材……", "loading");
  $("step-ingredients").hidden = true;
  $("step-recipes").hidden = true;

  try {
    const { dataUrl, base64 } = await resizeImage(file);
    $("preview").src = dataUrl;
    $("preview").hidden = false;

    const result = await postJson("/api/ingredients", { image: base64, mediaType: "image/jpeg" });
    state.ingredients = result.ingredients.map((item) => ({ name: item.name, confidence: item.confidence }));

    if (state.ingredients.length === 0) {
      setStatus("photo-status", "照片中沒有找到食材，換個角度再拍一次看看。", "error");
      return;
    }

    setStatus("photo-status", `找到 ${state.ingredients.length} 樣食材`);
    const note = $("ingredient-note");
    note.textContent = result.note;
    note.hidden = !result.note;
    renderIngredients();
    $("step-ingredients").hidden = false;
    $("step-ingredients").scrollIntoView({ behavior: "smooth" });
  } catch (error) {
    setStatus("photo-status", error.message, "error");
  }
}

function resizeImage(file) {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      const scale = Math.min(1, MAX_IMAGE_EDGE / Math.max(img.width, img.height));
      const canvas = document.createElement("canvas");
      canvas.width = Math.round(img.width * scale);
      canvas.height = Math.round(img.height * scale);
      canvas.getContext("2d").drawImage(img, 0, 0, canvas.width, canvas.height);
      URL.revokeObjectURL(url);
      const dataUrl = canvas.toDataURL("image/jpeg", 0.85);
      resolve({ dataUrl, base64: dataUrl.split(",")[1] });
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error("無法讀取這張照片，請換一張。"));
    };
    img.src = url;
  });
}

// ---------- 步驟二：食材清單 ----------

function renderIngredients() {
  const list = $("ingredient-list");
  list.replaceChildren();

  state.ingredients.forEach((item, index) => {
    const li = document.createElement("li");
    li.className = "chip" + (item.confidence === "低" ? " uncertain" : "");
    li.title = item.confidence ? `辨識把握度：${item.confidence}` : "手動新增";

    const label = document.createElement("span");
    label.textContent = item.name + (item.confidence === "低" ? "？" : "");

    const remove = document.createElement("button");
    remove.type = "button";
    remove.textContent = "×";
    remove.setAttribute("aria-label", `刪除${item.name}`);
    remove.addEventListener("click", () => {
      state.ingredients.splice(index, 1);
      renderIngredients();
    });

    li.append(label, remove);
    list.append(li);
  });

  $("recipe-button").disabled = state.ingredients.length === 0;
}

$("add-form").addEventListener("submit", (event) => {
  event.preventDefault();
  const input = $("add-input");
  const names = input.value.split(/[、,，\s]+/).map((s) => s.trim()).filter(Boolean);
  for (const name of names) {
    if (!state.ingredients.some((item) => item.name === name)) {
      state.ingredients.push({ name, confidence: null });
    }
  }
  input.value = "";
  renderIngredients();
});

// ---------- 步驟三：食譜 ----------

$("recipe-button").addEventListener("click", async () => {
  const button = $("recipe-button");
  button.disabled = true;
  setStatus("recipe-status", "師傅正在想菜單……", "loading");

  try {
    const result = await postJson("/api/recipes", {
      ingredients: state.ingredients.map((item) => item.name),
    });
    renderRecipes(result.recipes);
    setStatus("recipe-status", "");
    $("step-recipes").hidden = false;
    $("step-recipes").scrollIntoView({ behavior: "smooth" });
  } catch (error) {
    setStatus("recipe-status", error.message, "error");
  } finally {
    button.disabled = state.ingredients.length === 0;
  }
});

function renderRecipes(recipes) {
  const container = $("recipe-list");
  const template = $("recipe-template");
  container.replaceChildren();

  for (const recipe of recipes) {
    const card = template.content.cloneNode(true);
    const q = (selector) => card.querySelector(selector);

    q(".recipe-name").textContent = recipe.name;
    q(".recipe-meta").textContent =
      `${recipe.category}｜約 ${recipe.time_minutes} 分鐘｜${recipe.difficulty}｜${recipe.servings}`;
    q(".recipe-desc").textContent = recipe.description;
    fillList(q(".recipe-used"), recipe.used_ingredients);
    fillList(q(".recipe-seasonings"), recipe.seasonings);
    fillList(q(".recipe-steps"), recipe.steps);

    if (recipe.missing_ingredients.length > 0) {
      fillList(q(".recipe-missing"), recipe.missing_ingredients);
    } else {
      q(".recipe-missing-block").remove();
    }

    if (recipe.tip) {
      q(".recipe-tip").textContent = `小訣竅：${recipe.tip}`;
    } else {
      q(".recipe-tip").remove();
    }

    container.append(card);
  }
}

function fillList(list, items) {
  for (const text of items) {
    const li = document.createElement("li");
    li.textContent = text;
    list.append(li);
  }
}

// ---------- 共用 ----------

async function postJson(url, body) {
  let response;
  try {
    response = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
  } catch {
    throw new Error("連不上伺服器，請檢查網路連線。");
  }
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error || "發生錯誤，請再試一次。");
  return data;
}

function setStatus(id, text, kind = "") {
  const el = $(id);
  el.textContent = text;
  el.className = "status" + (kind ? ` ${kind}` : "");
}
