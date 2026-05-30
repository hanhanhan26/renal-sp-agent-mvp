require("dotenv").config();

/**
 * Extractor Agent
 * 只负责从“患者原话”中提取结构化线索。
 * 注意：
 * Patient Agent 可以自然表达；
 * Extractor Agent 必须严格 JSON；
 * Scoring Agent 最后再看完整对话。
 */

function createEmptyClues() {
  return {
    symptoms: [],
    history: [],
    medication: [],
    familyHistory: [],
    riskFactors: [],
    negativeFindings: [],
    examClues: [],
    timeCourse: "",
    summary: ""
  };
}

function parseAIJson(content) {
  const text = String(content || "").trim();

  const cleaned = text
    .replace(/^```json\s*/i, "")
    .replace(/^```\s*/i, "")
    .replace(/```$/i, "")
    .trim();

  const start = cleaned.indexOf("{");
  const end = cleaned.lastIndexOf("}");

  if (start !== -1 && end !== -1 && end > start) {
    return JSON.parse(cleaned.slice(start, end + 1));
  }

  return JSON.parse(cleaned);
}

function pushUnique(list, value) {
  if (value && !list.includes(value)) {
    list.push(value);
  }
}

/**
 * 没有 API Key 或 DeepSeek 失败时的备用规则抽取
 */
function ruleBasedExtractClues(patientText) {
  const text = String(patientText || "");
  const clues = createEmptyClues();

  if (text.includes("水肿") || text.includes("肿") || text.includes("眼皮") || text.includes("腿")) {
    pushUnique(clues.symptoms, text);
  }

  if (text.includes("泡沫")) {
    pushUnique(clues.symptoms, "泡沫尿");
  }

  if (text.includes("尿少") || text.includes("尿量") || text.includes("小便少")) {
    pushUnique(clues.symptoms, "尿量减少");
  }

  if (text.includes("血尿") || text.includes("茶水") || text.includes("红色")) {
    pushUnique(clues.symptoms, "尿色异常或血尿");
  }

  if (text.includes("发烧") || text.includes("发热")) {
    pushUnique(clues.symptoms, "发热");
  }

  if (text.includes("腰痛") || text.includes("腰疼")) {
    pushUnique(clues.symptoms, "腰痛");
  }

  if (text.includes("高血压") || text.includes("血压")) {
    pushUnique(clues.history, "高血压相关病史");
    pushUnique(clues.riskFactors, "高血压");
  }

  if (text.includes("糖尿病") || text.includes("血糖")) {
    if (text.includes("没有") || text.includes("无")) {
      pushUnique(clues.negativeFindings, "否认糖尿病");
    } else {
      pushUnique(clues.history, "糖尿病相关病史");
      pushUnique(clues.riskFactors, "糖尿病");
    }
  }

  if (text.includes("布洛芬") || text.includes("止痛药") || text.includes("感冒药") || text.includes("药")) {
    pushUnique(clues.medication, text);
  }

  if (text.includes("家里") || text.includes("家族") || text.includes("遗传")) {
    pushUnique(clues.familyHistory, text);
  }

  if (text.includes("没有") || text.includes("无")) {
    pushUnique(clues.negativeFindings, text);
  }

  clues.summary = text.slice(0, 120);

  return clues;
}

async function extractCluesFromPatientText(patientText, context = {}) {
  const text = String(patientText || "").trim();

  if (!text) {
    return createEmptyClues();
  }

  const apiKey = process.env.DEEPSEEK_API_KEY;

  if (!apiKey) {
    return ruleBasedExtractClues(text);
  }

  const body = {
    model: process.env.DEEPSEEK_MODEL || "deepseek-chat",
    messages: [
      {
        role: "system",
        content: `
你是肾内科标准化病人系统中的 Extractor Agent。
你不是医生，不做诊断，不评分，不补充患者没有说的信息。

你的唯一任务：
从“患者原话”中提取结构化线索。

严格规则：
1. 只能输出合法 JSON。
2. 不要 Markdown。
3. 不要解释。
4. 不要根据医学常识自行推断。
5. 患者明确说了什么，就提取什么。
6. 患者明确否认的信息，放入 negativeFindings。
7. 不确定的信息不要写入。
8. 所有数组元素使用中文短句。

必须严格输出这个 JSON 结构：
{
  "symptoms": [],
  "history": [],
  "medication": [],
  "familyHistory": [],
  "riskFactors": [],
  "negativeFindings": [],
  "examClues": [],
  "timeCourse": "",
  "summary": ""
}
        `
      },
      {
        role: "user",
        content: `
医生问题：
${context.doctorQuestion || "无"}

患者原话：
${text}

请只根据患者原话提取结构化线索。
        `
      }
    ],
    temperature: 0.1,
    max_tokens: 800,
    stream: false,
    response_format: {
      type: "json_object"
    }
  };

  const response = await fetch("https://api.deepseek.com/chat/completions", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Authorization": `Bearer ${apiKey}`
    },
    body: JSON.stringify(body)
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Extractor DeepSeek 调用失败：${response.status} ${errorText}`);
  }

  const data = await response.json();
  const content = data.choices?.[0]?.message?.content || "";

  try {
    return parseAIJson(content);
  } catch (error) {
    console.error("Extractor JSON 解析失败，启用规则抽取：", error.message);
    return ruleBasedExtractClues(text);
  }
}

module.exports = {
  extractCluesFromPatientText
};
