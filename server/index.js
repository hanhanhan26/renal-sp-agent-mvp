try {
  require("dotenv").config();
} catch (error) {
  console.warn("dotenv 未安装或加载失败，已跳过 .env 加载。线上 Render 环境变量不受影响。");
}

const fs = require("fs");
const path = require("path");
const express = require("express");
const cors = require("cors");

function optionalRequire(modulePath, fallbackValue) {
  try {
    return require(modulePath);
  } catch (error) {
    console.warn(`可选模块加载失败：${modulePath}，已使用兜底逻辑。原因：${error.message}`);
    return fallbackValue;
  }
}

const { searchKnowledge } = optionalRequire("./services/kbSearch", {
  searchKnowledge: () => []
});

const {
  generateCaseFromPdfKnowledge,
  generatePatientReply
} = optionalRequire("./services/aiClient", {
  generateCaseFromPdfKnowledge: null,
  generatePatientReply: null
});

const { deepseekScoreInterview } = optionalRequire("./services/deepseekScorer", {
  deepseekScoreInterview: null
});

const { extractCluesFromPatientText } = optionalRequire("./services/extractClues", {
  extractCluesFromPatientText: null
});

const app = express();
const PORT = process.env.PORT || 3000;

const activeCases = new Map();
const generatedCases = new Map();

app.use(cors());
app.use(express.json({ limit: "2mb" }));
app.use(express.static(path.join(__dirname, "../client")));

function cloneJson(value) {
  return JSON.parse(JSON.stringify(value));
}

function getDefaultCaseSeeds() {
  return [
    {
      caseId: "case_001",
      department: "肾内科",
      difficulty: "中等",
      patientProfile: {
        name: "王女士",
        age: 42,
        gender: "女",
        occupation: "教师"
      },
      chiefComplaint: "双下肢水肿 2 周",
      finalDiagnosis: "肾病综合征",
      visibleInfo: {
        openingStatement: "医生，我最近腿肿得厉害，早上起来脸也有点肿。"
      },
      hiddenInfo: {
        symptoms: ["泡沫尿", "尿量减少", "乏力"],
        history: ["高血压 3 年", "无糖尿病史"],
        medication: ["偶尔服用布洛芬"],
        familyHistory: ["无明确肾病家族史"],
        labs: {
          urineProtein: "+++",
          serumAlbumin: "24 g/L",
          creatinine: "92 μmol/L"
        }
      },
      mustAskItems: [
        "水肿部位和时间",
        "尿量变化",
        "泡沫尿",
        "血尿",
        "高血压病史",
        "用药史",
        "感染诱因",
        "既往肾病史"
      ],
      scoringRubric: {
        historyTaking: 50,
        clinicalReasoning: 30,
        communication: 20
      }
    },
    {
      caseId: "case_002",
      department: "肾内科",
      difficulty: "中等",
      patientProfile: {
        name: "李同学",
        age: 17,
        gender: "男",
        occupation: "高中生"
      },
      chiefComplaint: "肉眼血尿 3 天，伴眼睑水肿",
      finalDiagnosis: "急性肾小球肾炎",
      visibleInfo: {
        openingStatement: "医生，我这几天尿的颜色像茶水一样，眼皮也有点肿。"
      },
      hiddenInfo: {
        symptoms: ["咽痛后出现血尿", "轻度头痛", "尿量减少"],
        history: ["2 周前有咽喉痛"],
        medication: ["自行服用感冒药"],
        familyHistory: ["无肾病家族史"],
        labs: {
          urineRBC: "满视野",
          urineProtein: "+",
          creatinine: "110 μmol/L",
          bloodPressure: "150/95 mmHg"
        }
      },
      mustAskItems: [
        "血尿颜色",
        "是否疼痛",
        "近期感染史",
        "尿量变化",
        "水肿情况",
        "血压情况",
        "既往肾病史",
        "用药史"
      ],
      scoringRubric: {
        historyTaking: 50,
        clinicalReasoning: 30,
        communication: 20
      }
    },
    {
      caseId: "case_003",
      department: "肾内科",
      difficulty: "偏难",
      patientProfile: {
        name: "张先生",
        age: 68,
        gender: "男",
        occupation: "退休工人"
      },
      chiefComplaint: "尿量减少 2 天，乏力明显",
      finalDiagnosis: "急性肾损伤",
      visibleInfo: {
        openingStatement: "医生，我这两天尿特别少，人也很没力气。"
      },
      hiddenInfo: {
        symptoms: ["口渴", "乏力", "食欲差"],
        history: ["近期腹泻 3 天", "高血压 10 年"],
        medication: ["长期服用降压药", "近期服用止痛药"],
        familyHistory: ["无明确肾病家族史"],
        labs: {
          creatinine: "265 μmol/L",
          ureaNitrogen: "18 mmol/L",
          potassium: "5.6 mmol/L"
        }
      },
      mustAskItems: [
        "尿量具体变化",
        "近期腹泻或呕吐",
        "饮水情况",
        "用药史",
        "高血压病史",
        "既往肾功能",
        "水肿或气促",
        "危险信号"
      ],
      scoringRubric: {
        historyTaking: 50,
        clinicalReasoning: 30,
        communication: 20
      }
    }
  ];
}

function loadCaseSeeds() {
  const filePath = path.join(__dirname, "data", "caseSeeds.json");

  try {
    if (!fs.existsSync(filePath)) {
      console.warn("没有找到 server/data/caseSeeds.json，已使用内置病例种子。");
      return getDefaultCaseSeeds();
    }

    const rawText = fs.readFileSync(filePath, "utf8").trim();

    if (!rawText) {
      console.warn("caseSeeds.json 是空文件，已使用内置病例种子。");
      return getDefaultCaseSeeds();
    }

    const parsed = JSON.parse(rawText);

    if (!Array.isArray(parsed) || parsed.length === 0) {
      console.warn("caseSeeds.json 不是非空数组，已使用内置病例种子。");
      return getDefaultCaseSeeds();
    }

    return parsed
      .filter(item => item && typeof item === "object")
      .map((item, index) => normalizeCaseShape(item, item.chiefComplaint, item.difficulty, `case_seed_${index + 1}`));
  } catch (error) {
    console.error("caseSeeds.json 读取或解析失败，已使用内置病例种子。错误：", error.message);
    return getDefaultCaseSeeds();
  }
}

let caseSeeds = loadCaseSeeds();

if (!Array.isArray(caseSeeds) || caseSeeds.length === 0) {
  caseSeeds = getDefaultCaseSeeds();
}

function safeSearchKnowledge(query, options = {}) {
  try {
    const results = searchKnowledge ? searchKnowledge(query || "", options) : [];
    return Array.isArray(results) ? results : [];
  } catch (error) {
    console.error("知识库检索失败：", error.message);
    return [];
  }
}

function findCaseById(caseId) {
  if (!caseId) {
    return null;
  }

  const id = String(caseId);

  return (
    activeCases.get(id) ||
    generatedCases.get(id) ||
    caseSeeds.find(item => item && String(item.caseId) === id) ||
    null
  );
}

function saveCase(fullCase) {
  if (!fullCase || !fullCase.caseId) {
    return;
  }

  const id = String(fullCase.caseId);
  activeCases.set(id, fullCase);
  generatedCases.set(id, fullCase);
}

function createEmptyStructuredClues() {
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

function toTextArray(value) {
  if (!value) {
    return [];
  }

  if (Array.isArray(value)) {
    return value
      .map(item => {
        if (typeof item === "string") {
          return item.trim();
        }

        if (item && typeof item === "object") {
          return JSON.stringify(item);
        }

        return String(item || "").trim();
      })
      .filter(Boolean);
  }

  if (typeof value === "string") {
    return value.trim() ? [value.trim()] : [];
  }

  return [String(value)].filter(Boolean);
}

function pickClueValue(clues, keys) {
  for (const key of keys) {
    if (clues && clues[key] !== undefined) {
      return clues[key];
    }
  }

  return undefined;
}

function normalizeExtractedClues(clues) {
  const raw = clues && typeof clues === "object" ? clues : {};

  return {
    symptoms: toTextArray(pickClueValue(raw, ["symptoms", "症状"])),
    history: toTextArray(pickClueValue(raw, ["history", "病史", "既往史", "现病史"])),
    medication: toTextArray(pickClueValue(raw, ["medication", "用药", "用药史", "药物史"])),
    familyHistory: toTextArray(pickClueValue(raw, ["familyHistory", "家族史"])),
    riskFactors: toTextArray(pickClueValue(raw, ["riskFactors", "危险因素", "风险因素"])),
    negativeFindings: toTextArray(pickClueValue(raw, ["negativeFindings", "阴性线索", "否认"])),
    examClues: toTextArray(pickClueValue(raw, ["examClues", "检查线索", "检查结果", "labs"])),
    timeCourse: String(pickClueValue(raw, ["timeCourse", "病程", "时间线"]) || ""),
    summary: String(pickClueValue(raw, ["summary", "摘要", "总结"]) || "")
  };
}

function mergeUnique(oldList, newList) {
  return [...new Set([...(oldList || []), ...(newList || [])].filter(Boolean))];
}

function mergeClues(baseClues, newClues) {
  const base = normalizeExtractedClues(baseClues);
  const incoming = normalizeExtractedClues(newClues);

  return {
    symptoms: mergeUnique(base.symptoms, incoming.symptoms),
    history: mergeUnique(base.history, incoming.history),
    medication: mergeUnique(base.medication, incoming.medication),
    familyHistory: mergeUnique(base.familyHistory, incoming.familyHistory),
    riskFactors: mergeUnique(base.riskFactors, incoming.riskFactors),
    negativeFindings: mergeUnique(base.negativeFindings, incoming.negativeFindings),
    examClues: mergeUnique(base.examClues, incoming.examClues),
    timeCourse: incoming.timeCourse || base.timeCourse,
    summary: incoming.summary || base.summary
  };
}

function ensureCaseRuntimeState(fullCase) {
  if (!fullCase || typeof fullCase !== "object") {
    return fullCase;
  }

  if (!fullCase.structuredClues) {
    fullCase.structuredClues = createEmptyStructuredClues();
  }

  if (!Array.isArray(fullCase.interviewRounds)) {
    fullCase.interviewRounds = [];
  }

  return fullCase;
}

function recordInterviewRound(fullCase, roundData) {
  ensureCaseRuntimeState(fullCase);

  const normalizedClues = normalizeExtractedClues(roundData.extractedClues);

  fullCase.structuredClues = mergeClues(
    fullCase.structuredClues,
    normalizedClues
  );

  const round = {
    roundNo: fullCase.interviewRounds.length + 1,
    source: roundData.source || "patient_reply",
    doctor: String(roundData.doctor || ""),
    patient: String(roundData.patient || ""),
    extractedClues: normalizedClues,
    createdAt: new Date().toISOString()
  };

  fullCase.interviewRounds.push(round);
  saveCase(fullCase);

  return round;
}

function selectSeedCase(complaint) {
  const seeds = Array.isArray(caseSeeds) && caseSeeds.length > 0 ? caseSeeds : getDefaultCaseSeeds();
  const text = complaint ? String(complaint).toLowerCase() : "";

  let selectedCase = seeds[0];

  if (text.includes("血尿") && seeds[1]) {
    selectedCase = seeds[1];
  } else if (
    (
      text.includes("少尿") ||
      text.includes("尿少") ||
      text.includes("肌酐") ||
      text.includes("急性肾损伤") ||
      text.includes("aki")
    ) &&
    seeds[2]
  ) {
    selectedCase = seeds[2];
  } else if (
    text.includes("水肿") ||
    text.includes("蛋白尿") ||
    text.includes("泡沫尿")
  ) {
    selectedCase = seeds[0];
  }

  return selectedCase ? cloneJson(selectedCase) : null;
}

function normalizeCaseShape(rawCase, complaint, difficulty, fallbackCaseId = null) {
  const fullCase = rawCase && typeof rawCase === "object" ? rawCase : {};

  fullCase.caseId = fullCase.caseId || fallbackCaseId || `ai_${Date.now()}`;
  fullCase.department = fullCase.department || "肾内科";
  fullCase.difficulty = difficulty || fullCase.difficulty || "中等";
  fullCase.chiefComplaint = fullCase.chiefComplaint || complaint || "肾内科相关不适";
  fullCase.finalDiagnosis = fullCase.finalDiagnosis || "待定";

  fullCase.patientProfile = fullCase.patientProfile || {};
  fullCase.patientProfile.name = fullCase.patientProfile.name || "患者";
  fullCase.patientProfile.age = fullCase.patientProfile.age || 45;
  fullCase.patientProfile.gender = fullCase.patientProfile.gender || "未说明";
  fullCase.patientProfile.occupation = fullCase.patientProfile.occupation || "未说明";

  fullCase.visibleInfo = fullCase.visibleInfo || {};
  fullCase.visibleInfo.openingStatement =
    fullCase.visibleInfo.openingStatement ||
    `医生，我主要是${fullCase.chiefComplaint}，想来看看。`;

  fullCase.hiddenInfo = fullCase.hiddenInfo || {};
  fullCase.hiddenInfo.symptoms = Array.isArray(fullCase.hiddenInfo.symptoms)
    ? fullCase.hiddenInfo.symptoms
    : [];
  fullCase.hiddenInfo.history = Array.isArray(fullCase.hiddenInfo.history)
    ? fullCase.hiddenInfo.history
    : [];
  fullCase.hiddenInfo.medication = Array.isArray(fullCase.hiddenInfo.medication)
    ? fullCase.hiddenInfo.medication
    : [];
  fullCase.hiddenInfo.familyHistory = Array.isArray(fullCase.hiddenInfo.familyHistory)
    ? fullCase.hiddenInfo.familyHistory
    : [];
  fullCase.hiddenInfo.labs = fullCase.hiddenInfo.labs || {};

  fullCase.mustAskItems =
    Array.isArray(fullCase.mustAskItems) && fullCase.mustAskItems.length > 0
      ? fullCase.mustAskItems
      : [
          "主诉持续时间",
          "伴随症状",
          "尿量变化",
          "尿色变化",
          "泡沫尿",
          "既往病史",
          "用药史",
          "家族史"
        ];

  fullCase.scoringRubric = fullCase.scoringRubric || {
    historyTaking: 50,
    clinicalReasoning: 30,
    communication: 20
  };

  return fullCase;
}

function toPublicCase(fullCase) {
  const safeCase = normalizeCaseShape(fullCase || {}, "肾内科相关不适", "中等");

  return {
    caseId: safeCase.caseId,
    department: safeCase.department,
    difficulty: safeCase.difficulty,
    patientProfile: {
      age: safeCase.patientProfile?.age || "",
      gender: safeCase.patientProfile?.gender || "",
      occupation: safeCase.patientProfile?.occupation || ""
    },
    chiefComplaint: safeCase.chiefComplaint,
    openingStatement: safeCase.visibleInfo?.openingStatement || ""
  };
}

async function safeExtractClues(patientText, context = {}) {
  try {
    if (!patientText || !String(patientText).trim()) {
      return createEmptyStructuredClues();
    }

    if (!extractCluesFromPatientText) {
      return createEmptyStructuredClues();
    }

    const clues = await extractCluesFromPatientText(patientText, context);
    return normalizeExtractedClues(clues);
  } catch (error) {
    console.error("结构化线索提取失败：", error.message);
    return createEmptyStructuredClues();
  }
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

async function callDeepSeek(messages, options = {}) {
  const apiKey = process.env.DEEPSEEK_API_KEY;

  if (!apiKey) {
    throw new Error("缺少 DEEPSEEK_API_KEY，请检查 .env 或 Render 环境变量");
  }

  const body = {
    model: process.env.DEEPSEEK_MODEL || "deepseek-chat",
    messages,
    temperature: options.temperature ?? 0.7,
    max_tokens: options.max_tokens ?? 2000,
    stream: false
  };

  if (options.json) {
    body.response_format = { type: "json_object" };
  }

  const response = await fetch("https://api.deepseek.com/chat/completions", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`
    },
    body: JSON.stringify(body)
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`DeepSeek 调用失败：${response.status} ${errorText}`);
  }

  const data = await response.json();
  return data.choices?.[0]?.message?.content || "";
}

async function generateCaseWithDeepSeek(complaint, difficulty) {
  const content = await callDeepSeek(
    [
      {
        role: "system",
        content: `
你是一个肾内科医学教学病例生成助手。
你的任务是根据用户输入的主诉，生成一个用于标准化病人问诊训练的病例 JSON。

要求：
1. 只能输出合法 JSON，不要 Markdown，不要解释。
2. 病例必须符合肾内科常见临床逻辑。
3. hiddenInfo 是患者不会主动说出的隐藏信息。
4. finalDiagnosis 不要出现在 visibleInfo.openingStatement 里。
5. mustAskItems 用于后续评分。
6. 内容用于教学模拟，不作为真实诊疗建议。

JSON 格式必须严格如下：
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
  "finalDiagnosis": "",
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
  "mustAskItems": [],
  "scoringRubric": {
    "historyTaking": 50,
    "clinicalReasoning": 30,
    "communication": 20
  }
}
        `
      },
      {
        role: "user",
        content: `请生成一个肾内科标准化病人病例。主诉或训练目标：${complaint}。难度：${difficulty}。`
      }
    ],
    {
      json: true,
      temperature: 0.5,
      max_tokens: 2500
    }
  );

  const generatedCase = normalizeCaseShape(parseAIJson(content), complaint, difficulty, `ai_${Date.now()}`);
  generatedCase.caseId = generatedCase.caseId || `ai_${Date.now()}`;
  saveCase(generatedCase);

  return generatedCase;
}

async function generatePatientReplyWithDeepSeek(currentCase, question, conversationHistory) {
  const historyText = (conversationHistory || [])
    .map(item => `医生：${item.doctor || ""}\n患者：${item.patient || ""}`)
    .join("\n");

  const reply = await callDeepSeek(
    [
      {
        role: "system",
        content: `
你现在扮演一个肾内科标准化病人，不是医生。

规则：
1. 只能以患者身份回答。
2. 不能主动说出最终诊断。
3. 不能主动暴露所有隐藏信息。
4. 医生问到什么，你才回答什么。
5. 如果医生问诊断、病名、治疗方案，你要说“不太清楚，想请医生帮我看看”。
6. 不要使用太专业的医学术语，要像普通患者说话。
7. 不要编造病例中不存在的信息。
8. 每次回答控制在 1 到 3 句话。

病例资料如下：
${JSON.stringify(currentCase, null, 2)}
        `
      },
      {
        role: "user",
        content: `
既往对话：
${historyText || "暂无"}

医生刚刚问：
${question}

请以患者身份回答。
        `
      }
    ],
    {
      json: false,
      temperature: 0.6,
      max_tokens: 500
    }
  );

  return reply.trim();
}

function ruleBasedPatientReply(currentCase, question) {
  const text = String(question || "");
  const caseText = JSON.stringify(currentCase || {});

  if (
    text.includes("诊断") ||
    text.includes("什么病") ||
    text.includes("肾病综合征") ||
    text.includes("急性肾损伤") ||
    text.includes("急性肾小球肾炎") ||
    text.includes("治疗方案")
  ) {
    return "这个我不太清楚，还是想请医生帮我看看。";
  }

  if (
    text.includes("哪里不舒服") ||
    text.includes("怎么了") ||
    text.includes("不舒服") ||
    text.includes("为什么来")
  ) {
    return currentCase.visibleInfo?.openingStatement || "医生，我最近身体不太舒服，想来看看。";
  }

  if (
    text.includes("水肿") ||
    text.includes("肿") ||
    text.includes("腿肿") ||
    text.includes("脸肿") ||
    text.includes("眼皮") ||
    text.includes("眼睑")
  ) {
    if (caseText.includes("眼睑") || caseText.includes("眼皮")) {
      return "主要是眼皮有点肿，早上起来更明显一些。";
    }

    if (caseText.includes("双下肢") || caseText.includes("腿肿") || caseText.includes("水肿")) {
      return "主要是两条腿肿，早上起来脸也有点肿。";
    }

    return "我没有明显感觉哪里肿。";
  }

  if (
    text.includes("发烧") ||
    text.includes("发热") ||
    text.includes("体温") ||
    text.includes("多少度") ||
    text.includes("几度")
  ) {
    if (caseText.includes("发热") || caseText.includes("发烧") || caseText.includes("体温")) {
      return "这两天一直发烧，最高烧到 39 度多。";
    }

    return "最近没有明显发烧。";
  }

  if (
    text.includes("腰痛") ||
    text.includes("腰疼") ||
    text.includes("腰两边") ||
    text.includes("肾区")
  ) {
    if (caseText.includes("腰痛") || caseText.includes("腰疼") || caseText.includes("肾区")) {
      return "腰两边都挺疼的，尤其不舒服的时候更明显。";
    }

    return "没有明显腰痛。";
  }

  if (
    text.includes("尿急") ||
    text.includes("尿痛") ||
    text.includes("尿频") ||
    text.includes("小便疼") ||
    text.includes("排尿痛")
  ) {
    if (
      caseText.includes("尿急") ||
      caseText.includes("尿痛") ||
      caseText.includes("尿频") ||
      caseText.includes("尿路刺激")
    ) {
      return "小便的时候又急又痛，次数也比平时多一些。";
    }

    return "小便时没有明显尿急尿痛。";
  }

  if (
    text.includes("尿量") ||
    text.includes("尿少") ||
    text.includes("小便少") ||
    text.includes("少尿")
  ) {
    if (caseText.includes("尿量减少") || caseText.includes("少尿") || caseText.includes("尿特别少")) {
      return "感觉尿量比以前少了一些，最近更明显。";
    }

    return "尿量好像没有特别明显的变化。";
  }

  if (text.includes("泡沫尿") || text.includes("泡沫")) {
    if (caseText.includes("泡沫尿") || caseText.includes("泡沫")) {
      return "有，最近小便泡沫比以前多，而且不太容易散。";
    }

    return "这个我没有太注意，好像不是很明显。";
  }

  if (
    text.includes("血尿") ||
    text.includes("尿血") ||
    text.includes("红色") ||
    text.includes("茶色") ||
    text.includes("茶水") ||
    text.includes("尿色") ||
    text.includes("颜色")
  ) {
    if (caseText.includes("血尿") || caseText.includes("茶水")) {
      return "有，这几天尿的颜色有点像茶水一样。";
    }

    return "我没有明显看到尿是红色的。";
  }

  if (text.includes("高血压") || text.includes("血压")) {
    if (caseText.includes("高血压") || caseText.includes("bloodPressure")) {
      return "我有血压偏高的情况，之前医生也提醒过。";
    }

    return "我以前没有明确说过高血压。";
  }

  if (text.includes("糖尿病") || text.includes("血糖")) {
    if (caseText.includes("无糖尿病")) {
      return "我没有糖尿病。";
    }

    if (caseText.includes("糖尿病")) {
      return "我有糖尿病病史。";
    }

    return "我不太清楚自己有没有血糖问题。";
  }

  if (text.includes("腹泻") || text.includes("呕吐") || text.includes("拉肚子")) {
    if (caseText.includes("腹泻")) {
      return "前几天有过腹泻，吃东西也不太好。";
    }

    return "最近没有明显腹泻或呕吐。";
  }

  if (
    text.includes("感染") ||
    text.includes("感冒") ||
    text.includes("咽痛") ||
    text.includes("嗓子")
  ) {
    if (caseText.includes("咽喉痛") || caseText.includes("咽痛") || caseText.includes("感冒")) {
      return "大概两周前嗓子疼过，像是感冒了。";
    }

    if (caseText.includes("发热") || caseText.includes("发烧")) {
      return "这两天有发烧，所以我也担心是不是感染了。";
    }

    return "最近没有特别明显的感冒。";
  }

  if (
    text.includes("药") ||
    text.includes("用药") ||
    text.includes("止痛药") ||
    text.includes("布洛芬") ||
    text.includes("感冒药")
  ) {
    const medication = currentCase.hiddenInfo?.medication || [];

    if (medication.length > 0) {
      return `最近用过一些药，比如${medication.join("、")}。`;
    }

    return "最近没有特别固定吃什么药。";
  }

  if (text.includes("家族") || text.includes("遗传") || text.includes("家里人")) {
    const familyHistory = currentCase.hiddenInfo?.familyHistory || [];

    if (familyHistory.length > 0) {
      return `${familyHistory.join("，")}。`;
    }

    return "家里好像没有人得过明确的肾病。";
  }

  if (
    text.includes("化验") ||
    text.includes("检查") ||
    text.includes("肌酐") ||
    text.includes("尿蛋白") ||
    text.includes("白蛋白") ||
    text.includes("结果")
  ) {
    return "具体检查结果我还不太清楚，医生说可能还需要进一步检查。";
  }

  if (text.includes("谢谢") || text.includes("好的") || text.includes("明白")) {
    return "好的，医生。";
  }

  return "这个我不太确定，您能再问得具体一点吗？";
}

function getKeywordsForItem(item) {
  const text = item || "";
  let keywords = [];

  if (text.includes("水肿") || text.includes("肿")) {
    keywords.push("水肿", "肿", "腿肿", "脸肿", "眼皮", "眼睑");
  }

  if (text.includes("尿量") || text.includes("少尿")) {
    keywords.push("尿量", "尿少", "小便少", "少尿");
  }

  if (text.includes("泡沫")) {
    keywords.push("泡沫", "泡沫尿");
  }

  if (text.includes("血尿") || text.includes("尿色")) {
    keywords.push("血尿", "尿血", "红色", "茶色", "茶水", "颜色", "尿色");
  }

  if (text.includes("高血压") || text.includes("血压")) {
    keywords.push("高血压", "血压");
  }

  if (text.includes("糖尿病") || text.includes("血糖")) {
    keywords.push("糖尿病", "血糖");
  }

  if (text.includes("用药") || text.includes("药")) {
    keywords.push("药", "用药", "止痛药", "布洛芬", "感冒药");
  }

  if (text.includes("家族") || text.includes("遗传")) {
    keywords.push("家族", "遗传", "家里人");
  }

  if (text.includes("感染") || text.includes("咽痛") || text.includes("感冒")) {
    keywords.push("感染", "咽痛", "嗓子", "感冒", "发烧");
  }

  if (text.includes("既往") || text.includes("肾病") || text.includes("肾功能")) {
    keywords.push("既往", "以前", "肾病", "肾功能");
  }

  if (text.includes("腹泻") || text.includes("呕吐")) {
    keywords.push("腹泻", "呕吐", "拉肚子");
  }

  if (keywords.length === 0) {
    keywords = text
      .split(/[、，,；;和及或\s]+/)
      .filter(word => word.length >= 2);
  }

  return [...new Set(keywords)];
}

function calculateDiagnosisScore(studentDiagnosis, finalDiagnosis) {
  const diagnosis = studentDiagnosis || "";
  const gold = finalDiagnosis || "";

  if (!diagnosis.trim()) {
    return 0;
  }

  if (gold && diagnosis.includes(gold)) {
    return 30;
  }

  if (
    gold.includes("急性肾损伤") &&
    (
      diagnosis.includes("急性肾损伤") ||
      diagnosis.toLowerCase().includes("aki") ||
      diagnosis.includes("肾损伤")
    )
  ) {
    return 30;
  }

  if (
    gold.includes("肾病综合征") &&
    (
      diagnosis.includes("肾病综合征") ||
      diagnosis.includes("肾病")
    )
  ) {
    return 30;
  }

  if (
    gold.includes("肾小球肾炎") &&
    (
      diagnosis.includes("肾小球肾炎") ||
      diagnosis.includes("肾炎")
    )
  ) {
    return 30;
  }

  if (
    diagnosis.includes("肾病") ||
    diagnosis.includes("肾炎") ||
    diagnosis.includes("肾损伤") ||
    diagnosis.includes("肾功能") ||
    diagnosis.toLowerCase().includes("aki") ||
    diagnosis.toLowerCase().includes("ckd")
  ) {
    return 18;
  }

  return 8;
}

app.get("/api/health", (req, res) => {
  res.json({
    status: "ok",
    message: "Renal SP Agent MVP is running",
    seedCount: caseSeeds.length
  });
});

app.get("/api/knowledge/search", (req, res) => {
  const q = req.query.q || "";
  const results = safeSearchKnowledge(q, { topK: 5 });

  res.json({
    success: true,
    query: q,
    count: results.length,
    results: results.map(item => ({
      id: item.id,
      source: item.source,
      chunkIndex: item.chunkIndex,
      score: item.score,
      keywords: item.keywords,
      preview: String(item.text || "").slice(0, 300)
    }))
  });
});

app.post("/api/cases/generate", async (req, res) => {
  try {
    const { complaint = "", difficulty = "中等" } = req.body || {};

    if (!String(complaint).trim()) {
      return res.status(400).json({
        success: false,
        message: "请先输入主诉或训练目标"
      });
    }

    const relatedChunks = safeSearchKnowledge(complaint, { topK: 6 });
    let selectedCase = null;

    if (process.env.DEEPSEEK_API_KEY && generateCaseFromPdfKnowledge && relatedChunks.length > 0) {
      try {
        selectedCase = await generateCaseFromPdfKnowledge({
          complaint,
          difficulty,
          chunks: relatedChunks
        });
      } catch (error) {
        console.error("基于知识库生成病例失败，准备使用备用生成逻辑：", error.message);
      }
    }

    if (!selectedCase && process.env.DEEPSEEK_API_KEY) {
      try {
        selectedCase = await generateCaseWithDeepSeek(complaint, difficulty);
      } catch (error) {
        console.error("DeepSeek 备用病例生成失败，准备使用病例种子：", error.message);
      }
    }

    if (!selectedCase) {
      selectedCase = selectSeedCase(complaint);
    }

    if (!selectedCase) {
      return res.status(500).json({
        success: false,
        message: "病例生成失败，没有可用病例。请检查 server/data/caseSeeds.json"
      });
    }

    selectedCase = normalizeCaseShape(selectedCase, complaint, difficulty, `case_${Date.now()}`);
    ensureCaseRuntimeState(selectedCase);
    saveCase(selectedCase);

    const publicCase = toPublicCase(selectedCase);

    const extractedClues = await safeExtractClues(
      publicCase.openingStatement,
      {
        source: "opening_statement",
        caseId: selectedCase.caseId,
        chiefComplaint: selectedCase.chiefComplaint
      }
    );

    const round = recordInterviewRound(selectedCase, {
      source: "opening_statement",
      doctor: "",
      patient: publicCase.openingStatement,
      extractedClues
    });

    res.json({
      success: true,
      case: publicCase,
      extractedClues,
      structuredClues: selectedCase.structuredClues,
      round,
      evidence: relatedChunks.map(item => ({
        id: item.id,
        source: item.source,
        chunkIndex: item.chunkIndex,
        score: item.score
      }))
    });
  } catch (error) {
    console.error("病例生成失败：", error);

    res.status(500).json({
      success: false,
      message: "病例生成失败，请检查 PDF 知识库、API Key 或病例生成逻辑",
      error: error.message
    });
  }
});

app.post("/api/patient/reply", async (req, res) => {
  try {
    const { caseId, question = "", conversationHistory = [] } = req.body || {};

    if (!caseId) {
      return res.status(400).json({
        success: false,
        message: "缺少 caseId。请先生成病例，再开始问诊。"
      });
    }

    if (!String(question).trim()) {
      return res.status(400).json({
        success: false,
        message: "请先输入医生问题"
      });
    }

    const currentCase = findCaseById(caseId);

    if (!currentCase) {
      return res.status(404).json({
        success: false,
        message: `没有找到对应病例：${caseId}。请重新生成病例。`
      });
    }

    normalizeCaseShape(currentCase, currentCase.chiefComplaint, currentCase.difficulty, String(caseId));
    ensureCaseRuntimeState(currentCase);

    const relatedChunks = safeSearchKnowledge(
      `${currentCase.chiefComplaint || ""} ${question || ""}`,
      { topK: 4 }
    );

    let reply = "";

    if (process.env.DEEPSEEK_API_KEY && generatePatientReply) {
      try {
        reply = await generatePatientReply({
          caseData: currentCase,
          question,
          conversationHistory,
          chunks: relatedChunks
        });
      } catch (error) {
        console.error("服务版 Patient Agent 失败，准备使用备用回答：", error.message);
      }
    }

    if (!reply && process.env.DEEPSEEK_API_KEY) {
      try {
        reply = await generatePatientReplyWithDeepSeek(currentCase, question, conversationHistory);
      } catch (error) {
        console.error("DeepSeek 患者回答失败，准备使用规则版回答：", error.message);
      }
    }

    if (!reply) {
      reply = ruleBasedPatientReply(currentCase, question);
    }

    reply = String(reply || "").trim() || "这个我不太确定，您能再问得具体一点吗？";

    const extractedClues = await safeExtractClues(reply, {
      source: "patient_reply",
      caseId,
      doctorQuestion: question,
      chiefComplaint: currentCase.chiefComplaint
    });

    const round = recordInterviewRound(currentCase, {
      source: "patient_reply",
      doctor: question,
      patient: reply,
      extractedClues
    });

    res.json({
      success: true,
      reply,
      extractedClues,
      structuredClues: currentCase.structuredClues,
      round,
      evidence: relatedChunks.map(item => ({
        id: item.id,
        source: item.source,
        chunkIndex: item.chunkIndex,
        score: item.score
      }))
    });
  } catch (error) {
    console.error("患者回答失败：", error);

    res.status(500).json({
      success: false,
      message: "患者回答失败",
      error: error.message
    });
  }
});

app.post("/api/scoring/evaluate", (req, res) => {
  const {
    caseId,
    conversationHistory = [],
    studentDiagnosis = "",
    riskInput = "",
    checkedExams = [],
    structuredClues = {}
  } = req.body || {};

  const currentCase = findCaseById(caseId);

  if (!currentCase) {
    return res.status(404).json({
      success: false,
      message: `没有找到对应病例：${caseId || "caseId 为空"}`
    });
  }

  normalizeCaseShape(currentCase, currentCase.chiefComplaint, currentCase.difficulty, String(caseId));

  const safeHistory = Array.isArray(conversationHistory) ? conversationHistory : [];
  const safeExams = Array.isArray(checkedExams) ? checkedExams : [];

  const allQuestions = safeHistory
    .map(item => item.doctor || "")
    .join(" ");

  const mustAskItems =
    Array.isArray(currentCase.mustAskItems) && currentCase.mustAskItems.length > 0
      ? currentCase.mustAskItems
      : [
          "主诉",
          "现病史",
          "尿量变化",
          "泡沫尿",
          "血尿",
          "水肿",
          "既往史",
          "用药史",
          "家族史"
        ];

  const coveredItems = [];
  const missedItems = [];

  function hasAny(text, keywords) {
    return keywords.some(keyword => String(text || "").includes(keyword));
  }

  function isItemMatched(itemText, questionText, dialogText) {
    const item = String(itemText || "");
    const keywords = getKeywordsForItem(item);

    if (questionText.includes(item)) {
      return true;
    }

    if (keywords.length > 0 && keywords.some(keyword => questionText.includes(keyword))) {
      return true;
    }

    if (hasAny(item, ["主诉", "现病史"]) && dialogText.length > 0) {
      return true;
    }

    if (
      hasAny(item, ["发热", "发烧", "体温", "最高体温", "寒战", "畏寒"]) &&
      hasAny(questionText, ["发热", "发烧", "体温", "多少度", "几度", "最高", "持续", "多久", "寒战", "怕冷", "畏寒"])
    ) {
      return true;
    }

    if (
      hasAny(item, ["腰痛", "腰疼", "腰部", "肾区", "疼痛部位", "具体部位"]) &&
      hasAny(questionText, ["腰痛", "腰疼", "腰酸", "腰部", "哪边", "左边", "右边", "部位", "具体部位", "酸疼", "持续", "多久"])
    ) {
      return true;
    }

    if (
      hasAny(item, ["尿频", "尿急", "尿痛", "尿路刺激", "排尿"]) &&
      hasAny(questionText, ["尿频", "尿急", "尿痛", "小便次数", "次数", "排尿", "疼", "痛"])
    ) {
      return true;
    }

    if (
      hasAny(item, ["尿量", "少尿", "尿少", "小便变化"]) &&
      hasAny(questionText, ["尿量", "少尿", "尿少", "小便", "次数", "减少", "增多", "多少"])
    ) {
      return true;
    }

    if (
      hasAny(item, ["水肿", "浮肿", "眼睑", "眼皮", "下肢", "脚踝"]) &&
      hasAny(questionText, ["水肿", "肿", "眼皮", "眼睑", "脚踝", "下肢", "早上", "晚上"])
    ) {
      return true;
    }

    if (
      hasAny(item, ["泡沫", "蛋白尿"]) &&
      hasAny(questionText, ["泡沫", "蛋白尿", "尿蛋白"])
    ) {
      return true;
    }

    if (
      hasAny(item, ["血尿", "尿色", "尿液颜色"]) &&
      hasAny(questionText, ["血尿", "尿血", "颜色", "红色", "茶色", "尿色"])
    ) {
      return true;
    }

    if (
      hasAny(item, ["感染", "诱因", "咽痛", "发热", "腹泻", "呕吐"]) &&
      hasAny(questionText, ["感染", "发热", "发烧", "感冒", "咽痛", "腹泻", "呕吐", "近期"])
    ) {
      return true;
    }

    if (
      hasAny(item, ["用药", "药物", "止痛药", "抗生素", "中草药", "过敏"]) &&
      hasAny(questionText, ["药", "用药", "止痛药", "抗生素", "布洛芬", "中草药", "过敏"])
    ) {
      return true;
    }

    if (
      hasAny(item, ["既往", "高血压", "糖尿病", "肾病史", "基础病"]) &&
      hasAny(questionText, ["既往", "以前", "高血压", "糖尿病", "肾病", "基础病", "慢性病"])
    ) {
      return true;
    }

    if (
      hasAny(item, ["家族", "遗传"]) &&
      hasAny(questionText, ["家族", "遗传", "家里人", "父母", "兄弟姐妹"])
    ) {
      return true;
    }

    return false;
  }

  const dialogText = [
    currentCase.visibleInfo?.openingStatement || "",
    ...safeHistory.map(item => `${item.doctor || ""} ${item.patient || ""}`)
  ].join(" ");

  mustAskItems.forEach(item => {
    const matched = isItemMatched(String(item), allQuestions, dialogText);

    if (matched) {
      coveredItems.push(item);
    } else {
      missedItems.push(item);
    }
  });

  const historyScore = Math.round((coveredItems.length / mustAskItems.length) * 45);

  const finalDiagnosis = currentCase.finalDiagnosis || "";
  let diagnosisScore = calculateDiagnosisScore(studentDiagnosis, finalDiagnosis);

  if (diagnosisScore > 25) {
    diagnosisScore = 25;
  }

  let riskScore = 0;
  let riskFeedback = "未填写或风险识别不足。";
  const riskText = riskInput || "";

  if (
    riskText.includes("高钾") ||
    riskText.includes("容量不足") ||
    riskText.includes("感染") ||
    riskText.includes("血栓") ||
    riskText.includes("急性肾损伤") ||
    riskText.includes("肾衰") ||
    riskText.includes("高血压") ||
    riskText.includes("高热") ||
    riskText.includes("脓毒症")
  ) {
    riskScore = 10;
    riskFeedback = "能够识别与肾内科病例相关的关键风险。";
  } else if (riskText.trim()) {
    riskScore = 5;
    riskFeedback = "填写了风险判断，但还需要更贴近本病例的危险因素。";
  }

  let examScore = 0;
  const expectedExamKeywords = ["Scr / eGFR", "电解质", "尿常规", "尿 ACR / PCR", "泌尿系超声"];

  expectedExamKeywords.forEach(keyword => {
    if (safeExams.includes(keyword)) {
      examScore += 2;
    }
  });

  if (examScore > 10) {
    examScore = 10;
  }

  let examFeedback = "";

  if (examScore >= 8) {
    examFeedback = "检查选择较完整，覆盖了肾功能、电解质、尿液评估和影像学判断。";
  } else if (examScore >= 4) {
    examFeedback = "检查选择有一定合理性，但还需要补充肾功能、电解质、尿液定量或超声等关键检查。";
  } else {
    examFeedback = "检查选择不足，建议至少包括 Scr/eGFR、电解质、尿常规和尿蛋白定量。";
  }

  let communicationScore = 5;

  if (
    allQuestions.includes("请") ||
    allQuestions.includes("谢谢") ||
    allQuestions.includes("别担心") ||
    allQuestions.includes("不用紧张") ||
    allQuestions.includes("我了解")
  ) {
    communicationScore = 10;
  }

  const totalScore =
    historyScore +
    diagnosisScore +
    riskScore +
    examScore +
    communicationScore;

  let diagnosisFeedback = "";

  if (diagnosisScore >= 25) {
    diagnosisFeedback = `诊断正确，标准诊断为：${finalDiagnosis}。`;
  } else if (diagnosisScore >= 16) {
    diagnosisFeedback = `诊断方向基本正确，但还不够准确。标准诊断为：${finalDiagnosis}。`;
  } else {
    diagnosisFeedback = `诊断方向不够明确。标准诊断为：${finalDiagnosis}。`;
  }

  res.json({
    success: true,
    report: {
      totalScore,
      historyScore,
      diagnosisScore,
      riskScore,
      examScore,
      communicationScore,
      coveredItems,
      missedItems,
      diagnosisFeedback,
      riskFeedback,
      examFeedback,
      structuredClues: structuredClues || {},
      checkedExams: safeExams,
      suggestion: "建议下次按照“主诉—现病史—既往史—用药史—家族史—风险识别—检查计划”的顺序问诊，并把风险判断和检查选择纳入临床推理。"
    }
  });
});

app.post("/api/score/deepseek", async (req, res) => {
  try {
    if (!deepseekScoreInterview) {
      return res.status(501).json({
        success: false,
        message: "DeepSeek 评分模块未加载，请检查 server/services/deepseekScorer.js"
      });
    }

    const {
      caseId,
      conversationHistory = [],
      studentDiagnosis = "",
      ruleResult = null
    } = req.body || {};

    const currentCase = findCaseById(caseId);

    if (!currentCase) {
      return res.status(404).json({
        success: false,
        message: "没有找到对应病例"
      });
    }

    const aiScore = await deepseekScoreInterview({
      currentCase,
      conversationHistory,
      studentDiagnosis,
      ruleResult
    });

    res.json({
      success: true,
      scoring: aiScore
    });
  } catch (error) {
    console.error("DeepSeek scoring error:", error);

    res.status(500).json({
      success: false,
      message: "DeepSeek 评分失败",
      error: error.message
    });
  }
});

app.get(/.*/, (req, res) => {
  res.sendFile(path.join(__dirname, "../client/index.html"));
});

app.listen(PORT, () => {
  console.log(`Server is running on port ${PORT}`);
});