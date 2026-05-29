const fs = require("fs");
const path = require("path");
const { PDFParse } = require("pdf-parse");

const pdfDir = path.join(__dirname, "../server/knowledge/pdfs");
const outputPath = path.join(__dirname, "../server/knowledge/chunks.json");

const CHUNK_SIZE = 900;
const CHUNK_OVERLAP = 150;

function cleanText(text) {
  return text
    .replace(/\r/g, "\n")
    .replace(/[ \t]+/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function splitTextIntoChunks(text, sourceName) {
  const chunks = [];
  let start = 0;
  let index = 0;

  while (start < text.length) {
    const end = Math.min(start + CHUNK_SIZE, text.length);
    const chunkText = text.slice(start, end).trim();

    if (chunkText.length > 80) {
      chunks.push({
        id: `${sourceName}_chunk_${index + 1}`,
        source: sourceName,
        chunkIndex: index + 1,
        text: chunkText
      });
      index++;
    }

    start += CHUNK_SIZE - CHUNK_OVERLAP;
  }

  return chunks;
}

async function main() {
  if (!fs.existsSync(pdfDir)) {
    console.error("没有找到 PDF 文件夹：", pdfDir);
    process.exit(1);
  }

  const files = fs
    .readdirSync(pdfDir)
    .filter(file => file.toLowerCase().endsWith(".pdf"));

  if (files.length === 0) {
    console.error("server/knowledge/pdfs 文件夹里没有 PDF 文件");
    process.exit(1);
  }

  let allChunks = [];

  for (const file of files) {
    const filePath = path.join(pdfDir, file);
    console.log("正在读取 PDF：", file);

    const buffer = fs.readFileSync(filePath);
    const parser = new PDFParse({ data: buffer });
    const data = await parser.getText();
    await parser.destroy();

    const text = cleanText(data.text || "");

    if (!text || text.length < 100) {
      console.warn(`警告：${file} 提取出的文字太少。它可能不是文本型 PDF，而是扫描版 PDF。`);
      continue;
    }

    const chunks = splitTextIntoChunks(text, file);
    allChunks = allChunks.concat(chunks);

    console.log(`${file} 已生成 ${chunks.length} 个知识片段`);
  }

  fs.writeFileSync(outputPath, JSON.stringify(allChunks, null, 2), "utf-8");

  console.log("知识库生成完成：");
  console.log(outputPath);
  console.log("总片段数：", allChunks.length);
}

main().catch(error => {
  console.error("生成知识库失败：", error);
  process.exit(1);
});
