import * as pdfjsLib from "https://cdnjs.cloudflare.com/ajax/libs/pdf.js/4.4.168/pdf.min.mjs";

pdfjsLib.GlobalWorkerOptions.workerSrc =
  "https://cdnjs.cloudflare.com/ajax/libs/pdf.js/4.4.168/pdf.worker.min.mjs";

const input = document.querySelector("#pdf-input");
const dropZone = document.querySelector("#drop-zone");
const status = document.querySelector("#status");
const progress = document.querySelector("#progress");
const resultSection = document.querySelector("#result-section");
const resultNote = document.querySelector("#result-note");
const results = document.querySelector("#results");
const allergenButton = document.querySelector("#allergen-button");
const allergenSelect = document.querySelector("#allergen-select");
const platingInput = document.querySelector("#plating-input");
const platingDropZone = document.querySelector("#plating-drop-zone");
const platingStatus = document.querySelector("#plating-status");
const notationStatus = document.querySelector("#notation-status");
const platingResult = document.querySelector("#plating-result");
const platingPages = document.querySelector("#plating-pages");
let allergenCheckEnabled = false;
let flaggedMenuTerms = [];
let platingFile = null;
let mealMenuTerms = [];
let platingLinesCache = [];

const allergenTerms = {
  milk: ["牛乳", "乳", "（乳）", "(乳)", "チーズ", "ヨーグルト", "バター", "脱脂粉乳"],
  wheat: ["小麦", "パン", "ラーメン", "うどん", "スパゲッティ", "麩"],
  egg: ["卵", "たまご", "玉子", "液卵", "オムレツ", "マヨネーズ"],
  shrimp: ["えび", "エビ"],
  crab: ["かに", "カニ"],
  buckwheat: ["そば"],
  peanut: ["落花生", "ピーナッツ"],
  walnut: ["くるみ", "胡桃"],
  soy: ["大豆", "豆腐", "とうふ", "みそ", "味噌", "しょうゆ", "醤油"],
};

input.addEventListener("change", () => input.files[0] && processPdf(input.files[0]));
platingInput.addEventListener("change", () => platingInput.files[0] && processPlatingPdf(platingInput.files[0]));
["dragenter", "dragover"].forEach((eventName) =>
  dropZone.addEventListener(eventName, (event) => {
    event.preventDefault();
    dropZone.classList.add("is-dragging");
  }),
);
["dragleave", "drop"].forEach((eventName) =>
  dropZone.addEventListener(eventName, (event) => {
    event.preventDefault();
    dropZone.classList.remove("is-dragging");
  }),
);
dropZone.addEventListener("drop", (event) => {
  const file = event.dataTransfer.files[0];
  if (file) processPdf(file);
});
["dragenter", "dragover"].forEach((eventName) =>
  platingDropZone.addEventListener(eventName, (event) => {
    event.preventDefault();
    platingDropZone.classList.add("is-dragging");
  }),
);
["dragleave", "drop"].forEach((eventName) =>
  platingDropZone.addEventListener(eventName, (event) => {
    event.preventDefault();
    platingDropZone.classList.remove("is-dragging");
  }),
);
platingDropZone.addEventListener("drop", (event) => {
  const file = event.dataTransfer.files[0];
  if (file) processPlatingPdf(file);
});
document.querySelector("#clear-button").addEventListener("click", () => {
  input.value = "";
  resultSection.hidden = true;
  results.replaceChildren();
  status.textContent = "PDFを選択してください。";
  progress.hidden = true;
  allergenCheckEnabled = false;
  flaggedMenuTerms = [];
  allergenButton.classList.remove("is-active");
  allergenButton.setAttribute("aria-pressed", "false");
  allergenButton.textContent = "アレルギーチェック";
});
allergenButton.addEventListener("click", () => {
  allergenCheckEnabled = !allergenCheckEnabled;
  allergenButton.classList.toggle("is-active", allergenCheckEnabled);
  allergenButton.setAttribute("aria-pressed", String(allergenCheckEnabled));
  allergenButton.textContent = allergenCheckEnabled ? "アレルギーチェック中" : "アレルギーチェック";
  refreshAllergenHighlights();
});
allergenSelect.addEventListener("change", () => {
  refreshAllergenHighlights();
});

async function processPlatingPdf(file) {
  if ((!isPdfFile(file) && !isImageFile(file)) || file.size > 20 * 1024 * 1024) {
    platingStatus.textContent = "20MB以下のPDFまたは画像ファイルを選択してください。";
    return;
  }
  platingFile = file;
  platingStatus.textContent = "盛り付け表を解析しています…";
  try {
    if (isImageFile(file)) {
      platingPages.replaceChildren(await imageToCanvas(file));
      platingResult.hidden = false;
      platingStatus.textContent = "盛り付け表の画像を表示しています。";
      return;
    }
    const pdf = await pdfjsLib.getDocument({ data: await file.arrayBuffer() }).promise;
    platingPages.replaceChildren();
    const platingLines = [];
    for (let pageNumber = 1; pageNumber <= pdf.numPages; pageNumber += 1) {
      const page = await pdf.getPage(pageNumber);
      const content = await page.getTextContent();
      platingLines.push(...getPlatingLines(content.items));
      const viewport = page.getViewport({ scale: 1.5 });
      const canvas = document.createElement("canvas");
      canvas.width = viewport.width;
      canvas.height = viewport.height;
      await page.render({ canvasContext: canvas.getContext("2d"), viewport }).promise;
      drawMenuWarnings(canvas, viewport, content.items);
      platingPages.append(canvas);
    }
    platingLinesCache = platingLines;
    platingResult.hidden = false;
    platingStatus.textContent = `${pdf.numPages}ページの盛り付け表を画像で表示しています。`;
    verifyMenuNotation(platingLines);
  } catch (error) {
    console.error(error);
    platingStatus.textContent = `盛り付け表の読み込みに失敗しました: ${error.message || "不明なエラー"}`;
  }
}

async function processPdf(file) {
  if ((!isPdfFile(file) && !isImageFile(file)) || file.size > 20 * 1024 * 1024) {
    status.textContent = "20MB以下のPDFまたは画像ファイルを選択してください。";
    return;
  }

  progress.hidden = false;
  progress.value = 5;
  status.textContent = "PDFを解析しています…";
  try {
    if (isImageFile(file)) {
      if (!window.Tesseract) throw new Error("OCR library is unavailable");
      const result = await window.Tesseract.recognize(file, "jpn");
      renderOcrResult(result.data.text);
      progress.value = 100;
      status.textContent = "画像のOCR解析が完了しました。";
      return;
    }
    const pdf = await pdfjsLib.getDocument({ data: await file.arrayBuffer() }).promise;
    const pages = [];
    for (let pageNumber = 1; pageNumber <= pdf.numPages; pageNumber += 1) {
      const page = await pdf.getPage(pageNumber);
      const content = await page.getTextContent();
      pages.push(content.items);
      progress.value = 5 + (pageNumber / pdf.numPages) * 70;
    }

    async function imageToCanvas(file) {
      const image = new Image();
      image.src = URL.createObjectURL(file);
      await image.decode();
      const canvas = document.createElement("canvas");
      canvas.width = image.naturalWidth;
      canvas.height = image.naturalHeight;
      canvas.getContext("2d").drawImage(image, 0, 0);
      URL.revokeObjectURL(image.src);
      return canvas;
    }

    function renderOcrResult(text) {
      const lines = text.split(/\n+/).map((line) => line.trim()).filter(Boolean);
      resultSection.hidden = false;
      resultNote.textContent = "画像から読み取った内容を表示しています。";
      results.replaceChildren(...lines.map((line) => {
        const row = document.createElement("tr");
        const cell = document.createElement("td");
        cell.colSpan = 3;
        cell.textContent = line;
        row.append(cell);
        return row;
      }));
    }
    const rows = pages.flatMap(parsePageItems);
    if (rows.length === 0) {
      status.textContent = "文字を読み取れませんでした。画像PDFのOCR対応は次の段階で追加できます。";
      resultSection.hidden = false;
      resultNote.textContent = "このPDFには抽出可能な文字情報がないようです。";
      results.innerHTML = '<tr><td colspan="3" class="empty">表示できる給食データがありません。</td></tr>';
      return;
    }
    renderRows(rows);
    progress.value = 100;
    status.textContent = `${pdf.numPages}ページの解析が完了しました。`;
  } catch (error) {
    console.error(error);
    status.textContent = `材料表の読み込みに失敗しました: ${error.message || "不明なエラー"}`;
  }
}

function isPdfFile(file) {
  return file.type === "application/pdf" || file.name.toLowerCase().endsWith(".pdf");
}

function isImageFile(file) {
  return file.type.startsWith("image/") || /\.(png|jpe?g|gif|webp)$/i.test(file.name);
}

function parsePageItems(items) {
  const placed = items
    .filter((item) => item.str.trim())
    .map((item) => ({
      text: normalize(item.str),
      x: item.transform[4],
      y: item.transform[5],
    }));
  const datePattern = /(\d{1,2})\s*月\s*(\d{1,2})\s*日/;
  const dates = placed
    .map((item) => ({ ...item, match: item.text.match(datePattern) }))
    .filter((item) => item.match);
  if (dates.length === 0) return [];

  const dateBands = [...new Set(dates.map((date) => Math.round(date.y / 10) * 10))].sort((a, b) => b - a);
  const rows = dates.map((date) => {
    const bandIndex = dateBands.findIndex((band) => Math.abs(band - date.y) < 8);
    const lowerBound = dateBands[bandIndex + 1] === undefined ? 80 : dateBands[bandIndex + 1] + 20;
    const sameBand = dates
      .filter((other) => Math.abs(other.y - date.y) < 8)
      .sort((a, b) => a.x - b.x);
    const columnItems = placed.filter((item) =>
      item.y < date.y &&
      item.y > lowerBound &&
      columnOwner(item, placed, sameBand) === date,
    );
    const lines = groupByLine(columnItems);
    const dishes = [];
    lines.forEach((line) => {
      const text = line.map((item) => item.text).join("");
      if (isMenuLine(line)) {
        dishes.push({ menu: text, ingredients: [] });
      } else if (dishes.length && line.some((item) => /\d/.test(item.text))) {
        const ingredients = line
          .filter((item) => !/\d/.test(item.text))
          .map((item) => item.text)
          .join("");
        if (ingredients && !/エネルギー|塩分/.test(ingredients)) {
          dishes.at(-1).ingredients.push(ingredients);
        }
      }
    });
    return {
      date: `${date.match[1]}月${date.match[2]}日`,
      dishes,
    };
  });
  return rows.sort(compareDates);
}

function isMenuLine(line) {
  const text = line.map((item) => item.text).join("");
  return !line.some((item) => /\d/.test(item.text)) &&
    !text.startsWith("※") &&
    text.length > 1 &&
    !/エネルギー|塩分|中学校|献立|材料/.test(text);
}

function columnOwner(item, placed, dateBand) {
  if (/\d/.test(item.text)) {
    const sameLineText = placed
      .filter((candidate) =>
        !/\d/.test(candidate.text) &&
        candidate.x < item.x &&
        item.x - candidate.x < 80 &&
        Math.abs(candidate.y - item.y) < 4,
      )
      .sort((a, b) => b.x - a.x)[0];
    if (sameLineText) item = sameLineText;
  }
  return dateBand.reduce((nearest, candidate) =>
    Math.abs(candidate.x - item.x) < Math.abs(nearest.x - item.x) ? candidate : nearest,
  );
}

function groupByLine(items) {
  const lines = [];
  items.sort((a, b) => b.y - a.y || a.x - b.x).forEach((item) => {
    const line = lines.find((candidate) => Math.abs(candidate.y - item.y) < 4);
    if (line) line.items.push(item);
    else lines.push({ y: item.y, items: [item] });
  });
  return lines.sort((a, b) => b.y - a.y).map((line) => line.items.sort((a, b) => a.x - b.x));
}

function normalize(value) {
  return value
    .replace(/[０-９]/g, (digit) => String.fromCharCode(digit.charCodeAt(0) - 0xfee0))
    .replace(/\s+/g, "");
}

function compareDates(a, b) {
  const [aMonth, aDay] = a.date.match(/\d+/g).map(Number);
  const [bMonth, bDay] = b.date.match(/\d+/g).map(Number);
  return aMonth - bMonth || aDay - bDay;
}

function renderRows(rows) {
  resultSection.hidden = false;
  const displayRows = rows.flatMap((row) =>
    row.dishes.map((dish) => ({ date: row.date, menu: dish.menu, ingredients: dish.ingredients.join("、") })),
  );
  mealMenuTerms = displayRows.map((row) => row.menu);
  verifyMenuNotation(platingLinesCache);
  resultNote.textContent = `${displayRows.length}件のメニューを表示しています。`;
  results.replaceChildren(...displayRows.map((row) => {
    const tr = document.createElement("tr");
    [row.date, row.menu, row.ingredients || "（材料を取得できませんでした）"].forEach((value, index) => {
      const td = document.createElement("td");
      if (index === 0) {
        td.textContent = value;
      } else {
        td.className = "checkable";
        td.dataset.kind = index === 1 ? "menu" : "ingredients";
        td.dataset.value = value;
        if (index === 1) td.dataset.allergenSource = `${value} ${row.ingredients}`;
        if (index === 1 && allergenCheckEnabled && hasSelectedAllergen(td.dataset.allergenSource)) {
          td.classList.add("allergen-warning");
        }

        function getPlatingLines(items) {
          const positioned = items
            .filter((item) => item.str.trim())
            .map((item) => ({ text: normalize(item.str), x: item.transform[4], y: item.transform[5] }));
          return groupByLine(positioned)
            .flatMap(splitLineByColumn)
            .map((line) => line.map((item) => item.text).join(""))
            .filter(Boolean);
        }

        function verifyMenuNotation(platingLines) {
          if (mealMenuTerms.length === 0 || platingLines.length === 0) {
            notationStatus.textContent = "";
            return;
          }
          const unmatched = mealMenuTerms.filter((menu) =>
            !platingLines.some((line) => menuMatches(line, menu)),
          );
          notationStatus.textContent = unmatched.length === 0
            ? "料理名の表記確認が自動で完了しました。"
            : `料理名の表記確認が完了しました（未照合 ${unmatched.length}件）。`;
        }
        td.append(...(allergenCheckEnabled ? highlightAllergens(value) : [document.createTextNode(value)]));
      }
      tr.append(td);
    });
    return tr;
  }));
}

function highlightAllergens(value) {
  if (!allergenCheckEnabled) {
    const text = document.createTextNode(value);
    return [text];
  }
  const selectedTerms = getSelectedTerms();
  if (selectedTerms.length === 0) return [document.createTextNode(value)];
  const pattern = new RegExp(`(${selectedTerms.map(escapeRegExp).join("|")})`, "g");
  const fragments = [];
  let lastIndex = 0;
  for (const match of value.matchAll(pattern)) {
    fragments.push(document.createTextNode(value.slice(lastIndex, match.index)));
    const warning = document.createElement("span");
    warning.className = "allergen-warning";
    warning.textContent = match[0];
    fragments.push(warning);
    lastIndex = match.index + match[0].length;
  }
  fragments.push(document.createTextNode(value.slice(lastIndex)));
  return fragments;
}

function getSelectedTerms() {
  return allergenSelect.selectedOptions
    ? [...allergenSelect.selectedOptions].flatMap((option) => allergenTerms[option.value])
    : [];
}

function hasSelectedAllergen(value) {
  const normalizedValue = normalizeForMatch(value);
  return getSelectedTerms().some((term) => normalizedValue.includes(normalizeForMatch(term)));
}

function refreshAllergenHighlights() {
  flaggedMenuTerms = [];
  document.querySelectorAll(".checkable").forEach((element) => {
    const value = element.dataset.value || "";
    element.classList.remove("allergen-warning");
    element.replaceChildren(...(allergenCheckEnabled ? highlightAllergens(value) : [document.createTextNode(value)]));
    if (
      allergenCheckEnabled &&
      element.dataset.kind === "menu" &&
      hasSelectedAllergen(element.dataset.allergenSource || value)
    ) {
      element.classList.add("allergen-warning");
      flaggedMenuTerms.push(normalize(value));
    }
  });
  if (platingFile) processPlatingPdf(platingFile);
}

function drawMenuWarnings(canvas, viewport, items) {
  if (!allergenCheckEnabled || flaggedMenuTerms.length === 0) return;
  const context = canvas.getContext("2d");
  context.strokeStyle = "#c92a2a";
  context.lineWidth = 3;
  const positioned = items
    .filter((item) => item.str.trim())
    .map((item) => ({ text: normalize(item.str), x: item.transform[4], y: item.transform[5], source: item }));
  groupByLine(positioned)
    .flatMap(splitLineByColumn)
    .filter((line) => flaggedMenuTerms.some((menu) => menuMatches(line.map((item) => item.text).join(""), menu)))
    .forEach((line) => {
    const first = line[0].source;
    const last = line.at(-1).source;
    const [x, y] = viewport.convertToViewportPoint(first.transform[4], first.transform[5]);
    const end = viewport.convertToViewportPoint(last.transform[4] + (last.width || 30), last.transform[5]);
    const width = end[0] - x;
    const height = Math.max(...line.map((item) => Math.abs(item.source.transform[3]))) * viewport.scale;
    context.beginPath();
    context.moveTo(x, y - height);
    context.lineTo(x + width, y);
    context.moveTo(x + width, y - height);
    context.lineTo(x, y);
    context.stroke();
  });
}

function splitLineByColumn(line) {
  const chunks = [];
  line.forEach((item) => {
    const current = chunks.at(-1);
    const previous = current?.at(-1);
    if (!current || item.x - previous.x > 45) chunks.push([item]);
    else current.push(item);
  });
  return chunks;
}

function menuMatches(candidate, flaggedMenu) {
  const candidateText = normalizeForMatch(candidate);
  return menuVariants(flaggedMenu).some((variant) =>
    candidateText.includes(variant) || variant.includes(candidateText),
  );
}

function menuVariants(value) {
  const normalized = normalizeForMatch(value).replace(/[（(].*?[）)]/g, "");
  return [...new Set([
    normalized,
    normalized.replaceAll("しょくパン", "食パン"),
    normalized.replaceAll("くろコッペパン", "黒コッペパン"),
    normalized.replaceAll("むぎごはん", "麦ごはん"),
    normalized.replaceAll("もちげんまいごはん", "もち玄米ごはん"),
    normalized.replaceAll("きんしたまご", "錦糸玉子"),
    normalized.replaceAll("しろみそしる", "白みそ汁"),
    normalized.replaceAll("しろみそ", "白みそ"),
    normalized.replaceAll("とうふ", "豆腐"),
    normalized.replaceAll("みそ", "味噌"),
    normalized.replaceAll("しる", "汁"),
    normalized.replaceAll("しょうゆ", "醤油"),
  ])].filter((variant) => variant.length > 1);
}

function normalizeForMatch(value) {
  const aliases = [
    ["むぎごはん", "麦ごはん"],
    ["もちげんまいごはん", "もち玄米ごはん"],
    ["みずな", "水菜"],
    ["こがたコッペパン", "小型コッペパン"],
    ["くろコッペパン", "黒コッペパン"],
    ["しょくパン", "食パン"],
    ["ぶたにく", "豚肉"],
    ["とりにく", "鶏肉"],
    ["おさつにく", "おさつ肉"],
    ["しろみさかな", "白身魚"],
    ["かんこくふうやきにく", "韓国風焼き肉"],
    ["つぶマスタードやき", "粒マスタード焼き"],
    ["あげがらめ", "揚げがらめ"],
    ["きりぼしだいこん", "切り干し大根"],
    ["いために", "炒め煮"],
    ["しろみそしる", "白みそ汁"],
    ["にんじん", "人参"],
    ["たいわんふう", "台湾風"],
    ["からあげ", "から揚げ"],
    ["ちゅうか", "中華"],
    ["はるさめ", "春雨"],
    ["にくだんご", "肉団子"],
    ["くろず", "黒酢"],
    ["あんかけ", "あんかけ"],
    ["さんま", "秋刀魚"],
    ["しおやき", "塩焼き"],
    ["ごまあえ", "ごま和え"],
    ["おつきみしる", "お月見汁"],
    ["いそかあえ", "磯香和え"],
    ["とうがんじる", "冬瓜汁"],
    ["ごはんのぐ", "ごはんの具"],
    ["きんしたまご", "錦糸玉子"],
    ["ぼいるやさい", "ボイル野菜"],
    ["とうふ", "豆腐"],
    ["たつたあげ", "竜田揚げ"],
    ["こまつな", "小松菜"],
    ["いためもの", "炒め物"],
    ["とりにく", "鶏肉"],
    ["ぶたじる", "豚汁"],
    ["にらたま", "にら玉"],
    ["あげどうふ", "揚げ豆腐"],
    ["はんぺんのしょうが", "はんぺんの生姜"],
    ["なし", "梨"],
    ["かぼちゃのそぼろに", "かぼちゃのそぼろ煮"],
    ["なすのみそしる", "なすのみそ汁"],
    ["とろろこんぶじる", "とろろ昆布汁"],
    ["ちんげんさい", "チンゲン菜"],
    ["あつあげ", "厚揚げ"],
    ["さわにわん", "沢煮椀"],
    ["ちくわ", "竹輪"],
    ["おこのみあげ", "お好み揚げ"],
    ["きんときまめ", "金時豆"],
    ["たじっこ", ""],
    ["とうふ", "豆腐"],
    ["みそ", "味噌"],
    ["しょうゆ", "醤油"],
    ["しる", "汁"],
    ["あげ", "揚げ"],
  ];
  return aliases.reduce(
    (result, [hiragana, kanji]) => result.replaceAll(hiragana, kanji),
    normalize(value),
  );
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
