require("dotenv").config();

const OpenAI = require("openai");
const { formatKnowledgeContext } = require("./kbSearch");

const hasApiKey = Boolean(process.env.DEEPSEEK_API_KEY);

const client = hasApiKey
  ? new OpenAI({
      apiKey: process.env.DEEPSEEK_API_KEY,
      baseURL: process.env.DEEPSEEK_BASE_URL || "https://api.deepseek.com"
    })
  : null;

function stripJsonFence(text) {
  return String(text || "")
    .replace(/^```json\s*/i, "")
    .replace(/^```\s*/i, "")
    .replace(/```$/i, "")
    .trim();
}

async function callAI(messages, options = {}) {
  if (!client) {
    throw new Error("缺少 DEEPSEEK_API_KEY，请检查 .env 文件");
  }

  const response = await client.chat.completions.create({
    model: process.env.DEEPSEEK_MODEL || "deepseek-chat",
    messages,
    temperature: options.temperature ?? 0.2,
    response_format: options.json ? { type: "json_object" } : undefined
  });

  return response.choices[0].message.content;
}

async function generateCaseFromPdfKnowledge({ complaint, difficulty, chunks }) {
  const context = formatKnowledgeContext(chunks);

  const systemPrompt = `
你是一个医学教学病例生成 Agent。

你必须遵守：
1. 只能根据用户提供的【PDF 知识库片段】生成病例。
2. 不得使用片段外医学知识补充诊断、治疗、检查、机制。
3. 可以虚构患者姓名、年龄、职业、说话方式。
4. 医学事实必须能在 PDF 片段中找到依据。
5. 如果 PDF 片段不足，必须写入 uncertainFields。
6. 输出必须是合法 JSON。
7. 本病例仅用于教学，不用于真实诊疗。
`;

  const userPrompt = `
请根据下面 PDF 知识库片段，生成一个肾内科问诊训练用虚拟病例。

用户输入的主诉/训练目标：
${complaint}

难度：
${difficulty || "中等"}

【PDF 知识库片段】
${context}

请严格输出 JSON，格式如下：

{
  "caseId": "",
  "department": "肾内科",
  "difficulty": "",
  "patientProfile": {
    "name": "",
    "age": 0,
    "gender": "",
    "occupation": ""
  },
  "chiefComplaint": "",
  "visibleInfo": {
    "openingStatement": ""
  },
  "hiddenInfo": {
    "symptoms": [],
    "history": [],
    "medication": [],
    "familyHistory": [],
    "labs": {}
  },
  "finalDiagnosis": "",
  "mustAskItems": [],
  "scoringRubric": {
    "historyTaking": 50,
    "clinicalReasoning": 30,
    "communication": 20
  },
  "evidenceChunkIds": [],
  "uncertainFields": []
}

要求：
1. caseId 必须生成，例如 "ai_case_001"。
2. openingStatement 必须像普通患者说话，不要像医生。
3. finalDiagnosis 不允许在 openingStatement 中透露。
4. hiddenInfo 是医生问到才透露的信息。
5. mustAskItems 是本病例必须询问的关键问题。
6. evidenceChunkIds 必须填写本次使用的 chunk_id。
7. 不要输出 JSON 以外的任何文字。
`;

  const content = await callAI(
    [
      { role: "system", content: systemPrompt },
      { role: "user", content: userPrompt }
    ],
    { json: true, temperature: 0.2 }
  );

  const parsed = JSON.parse(stripJsonFence(content));

  parsed.caseId = parsed.caseId || `ai_case_${Date.now()}`;
  parsed.department = parsed.department || "肾内科";
  parsed.difficulty = parsed.difficulty || difficulty || "中等";

  return parsed;
}

async function generatePatientReply({ caseData, question, conversationHistory, chunks }) {
  const context = formatKnowledgeContext(chunks);

  const systemPrompt = `
你现在扮演一个标准化病人，不是医生。

必须遵守：
1. 只能以患者身份回答。
2. 只能根据病例设定和 PDF 片段回答。
3. 不要主动说出最终诊断。
4. 不要主动透露所有隐藏信息。
5. 医生问到什么，你只回答什么。
6. 如果医生问诊断，你回答“这个我不太清楚，想请医生帮我看看。”
7. 如果病例和 PDF 都没有依据，你回答“不太清楚”。
8. 回答要像普通患者，简短自然。
`;

  const userPrompt = `
【当前病例】
${JSON.stringify(caseData, null, 2)}

【相关 PDF 片段】
${context}

【历史对话】
${JSON.stringify(conversationHistory || [], null, 2)}

【医生当前问题】
${question}

请用患者口吻回答。只输出患者说的话，不要解释。
`;

  const reply = await callAI(
    [
      { role: "system", content: systemPrompt },
      { role: "user", content: userPrompt }
    ],
    { json: false, temperature: 0.3 }
  );

  return String(reply || "").trim();
}

module.exports = {
  generateCaseFromPdfKnowledge,
  generatePatientReply
};
