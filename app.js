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

input.addEventListener("change", () => input.files[0] && processPdf(input.files[0]));
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
document.querySelector("#clear-button").addEventListener("click", () => {
  input.value = "";
  resultSection.hidden = true;
  results.replaceChildren();
  status.textContent = "PDFを選択してください。";
  progress.hidden = true;
});

async function processPdf(file) {
  if (file.type !== "application/pdf" || file.size > 20 * 1024 * 1024) {
    status.textContent = "20MB以下のPDFファイルを選択してください。";
    return;
  }

  progress.hidden = false;
  progress.value = 5;
  status.textContent = "PDFを解析しています…";
  try {
    const pdf = await pdfjsLib.getDocument({ data: await file.arrayBuffer() }).promise;
    const pages = [];
    for (let pageNumber = 1; pageNumber <= pdf.numPages; pageNumber += 1) {
      const page = await pdf.getPage(pageNumber);
      const content = await page.getTextContent();
      pages.push(content.items);
      progress.value = 5 + (pageNumber / pdf.numPages) * 70;
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
    status.textContent = "PDFの解析に失敗しました。別のPDFで試してください。";
  }
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
    const menu = lines
      .filter((line) => !line.some((item) => /\d/.test(item.text)))
      .map((line) => line.map((item) => item.text).join(""))
      .filter((text) =>
        text &&
        !text.startsWith("※") &&
        text.length > 1 &&
        !/エネルギー|塩分|中学校|献立|材料/.test(text),
      );
    const ingredients = lines
      .filter((line) => line.some((item) => /\d/.test(item.text)))
      .map((line) => line.map((item) => item.text).join(" "))
      .filter((text) => !/エネルギー|塩分/.test(text))
      .join("、");
    return {
      date: `${date.match[1]}月${date.match[2]}日`,
      menu,
      ingredients: ingredients || "（材料を取得できませんでした）",
    };
  });
  return rows.sort(compareDates);
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
  resultNote.textContent = `${rows.length}件の給食データを表示しています。`;
  results.replaceChildren(...rows.map((row) => {
    const tr = document.createElement("tr");
    [row.date, row.menu.join("、"), row.ingredients].forEach((value) => {
      const td = document.createElement("td");
      td.textContent = value;
      tr.append(td);
    });
    return tr;
  }));
}
