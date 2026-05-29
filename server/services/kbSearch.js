const chunks = require("../knowledge/chunks.json");

const synonymMap = {
  水肿: ["水肿", "浮肿", "腿肿", "眼睑肿", "脸肿"],
  蛋白尿: ["蛋白尿", "尿蛋白", "泡沫尿", "尿中泡沫"],
  血尿: ["血尿", "尿血", "肉眼血尿", "镜下血尿", "茶色尿"],
  少尿: ["少尿", "尿少", "尿量减少", "无尿"],
  肾病综合征: ["肾病综合征", "大量蛋白尿", "低白蛋白血症", "水肿"],
  急性肾损伤: ["急性肾损伤", "AKI", "肌酐升高", "尿量减少"],
  慢性肾脏病: ["慢性肾脏病", "CKD", "慢性肾衰", "肾功能不全"],
  肾小球肾炎: ["肾小球肾炎", "肾炎", "血尿", "蛋白尿", "高血压"],
  尿路感染: ["尿路感染", "尿频", "尿急", "尿痛", "发热"],
  高血压: ["高血压", "血压升高"],
  糖尿病: ["糖尿病", "血糖升高"],
  检查: ["检查", "辅助检查", "尿常规", "肾功能", "肌酐", "尿素氮"],
  治疗: ["治疗", "处理", "用药", "原则"],
  诊断: ["诊断", "诊断依据", "鉴别诊断"]
};

function normalizeText(text) {
  return String(text || "").toLowerCase();
}

function getQueryTerms(query) {
  const text = normalizeText(query);
  const terms = new Set();

  Object.entries(synonymMap).forEach(([key, values]) => {
    if (text.includes(key.toLowerCase())) {
      values.forEach((v) => terms.add(v.toLowerCase()));
    }

    values.forEach((v) => {
      if (text.includes(v.toLowerCase())) {
        terms.add(key.toLowerCase());
        values.forEach((item) => terms.add(item.toLowerCase()));
      }
    });
  });

  const directParts = text
    .split(/[，,。；;、\s]+/)
    .map((item) => item.trim())
    .filter((item) => item.length >= 2);

  directParts.forEach((item) => terms.add(item));

  for (let i = 0; i < text.length - 1; i++) {
    const pair = text.slice(i, i + 2);
    if (/[\u4e00-\u9fa5]{2}/.test(pair)) {
      terms.add(pair);
    }
  }

  return Array.from(terms).filter(Boolean);
}

function countOccurrences(text, term) {
  if (!term) return 0;

  let count = 0;
  let position = text.indexOf(term);

  while (position !== -1) {
    count += 1;
    position = text.indexOf(term, position + term.length);
  }

  return count;
}

function scoreChunk(chunk, terms) {
  const text = normalizeText(chunk.text);
  const keywords = Array.isArray(chunk.keywords)
    ? chunk.keywords.map((item) => normalizeText(item))
    : [];

  let score = 0;

  terms.forEach((term) => {
    const count = countOccurrences(text, term);

    if (count > 0) {
      score += count * Math.max(2, term.length);
    }

    if (keywords.includes(term)) {
      score += 10;
    }
  });

  return score;
}

function searchKnowledge(query, options = {}) {
  const topK = options.topK || 5;
  const terms = getQueryTerms(query);

  if (!query || terms.length === 0) {
    return [];
  }

  return chunks
    .map((chunk) => {
      const score = scoreChunk(chunk, terms);

      return {
        id: chunk.id,
        source: chunk.source,
        chunkIndex: chunk.chunkIndex,
        text: chunk.text,
        keywords: chunk.keywords || [],
        score
      };
    })
    .filter((item) => item.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, topK);
}

function formatKnowledgeContext(results) {
  return results
    .map((item) => {
      return [
        `[chunk_id: ${item.id}]`,
        `[source: ${item.source}]`,
        `[chunk_index: ${item.chunkIndex}]`,
        item.text
      ].join("\n");
    })
    .join("\n\n---\n\n");
}

module.exports = {
  searchKnowledge,
  formatKnowledgeContext
};
