require("dotenv").config();

const express = require("express");
const cors = require("cors");
const path = require("path");

let caseSeeds = require("./data/caseSeeds.json");

if (!Array.isArray(caseSeeds)) {
  caseSeeds = [];
}

const app = express();
const PORT = process.env.PORT || 3000;

const generatedCases = new Map();

function findCaseById(caseId) {
  return generatedCases.get(caseId) || caseSeeds.find(item => item.caseId === caseId);
}

function selectSeedCase(complaint) {
  if (!caseSeeds || caseSeeds.length === 0) {
    return null;
  }

  let selectedCase = caseSeeds[0];
  const text = complaint ? complaint.toLowerCase() : "";

  if (text.includes("血尿") && caseSeeds[1]) {
    selectedCase = caseSeeds[1];
  } else if (
    (
      text.includes("少尿") ||
      text.includes("尿少") ||
      text.includes("肌酐") ||
      text.includes("急性肾损伤")
    ) &&
    caseSeeds[2]
  ) {
    selectedCase = caseSeeds[2];
  } else if (
    text.includes("水肿") ||
    text.includes("蛋白尿") ||
    text.includes("泡沫尿")
  ) {
    selectedCase = caseSeeds[0];
  }

  return selectedCase;
}

function normalizeCaseShape(rawCase, complaint, difficulty) {
  const fullCase = rawCase || {};

  fullCase.caseId = fullCase.caseId || `ai_${Date.now()}`;
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
  fullCase.hiddenInfo.symptoms = fullCase.hiddenInfo.symptoms || [];
  fullCase.hiddenInfo.history = fullCase.hiddenInfo.history || [];
  fullCase.hiddenInfo.medication = fullCase.hiddenInfo.medication || [];
  fullCase.hiddenInfo.familyHistory = fullCase.hiddenInfo.familyHistory || [];
  fullCase.hiddenInfo.labs = fullCase.hiddenInfo.labs || {};

  fullCase.mustAskItems = fullCase.mustAskItems || [
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
  return {
    caseId: fullCase.caseId,
    department: fullCase.department,
    difficulty: fullCase.difficulty,
    patientProfile: {
      age: fullCase.patientProfile?.age || "",
      gender: fullCase.patientProfile?.gender || "",
      occupation: fullCase.patientProfile?.occupation || ""
    },
    chiefComplaint: fullCase.chiefComplaint,
    openingStatement: fullCase.visibleInfo?.openingStatement || ""
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
      "Authorization": `Bearer ${apiKey}`
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

  const generatedCase = normalizeCaseShape(parseAIJson(content), complaint, difficulty);
  generatedCase.caseId = `ai_${Date.now()}`;

  generatedCases.set(generatedCase.caseId, generatedCase);

  return generatedCase;
}

async function generatePatientReplyWithDeepSeek(currentCase, question, conversationHistory) {
  const historyText = (conversationHistory || [])
    .map(item => `医生：${item.doctor}\n患者：${item.patient}`)
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
  const text = question || "";
  const caseText = JSON.stringify(currentCase);

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

  if (
    text.includes("泡沫尿") ||
    text.includes("泡沫")
  ) {
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
    text.includes("茶水")
  ) {
    if (caseText.includes("血尿") || caseText.includes("茶水")) {
      return "有，这几天尿的颜色有点像茶水一样。";
    }

    return "我没有明显看到尿是红色的。";
  }

  if (
    text.includes("高血压") ||
    text.includes("血压")
  ) {
    if (caseText.includes("高血压") || caseText.includes("bloodPressure")) {
      return "我有血压偏高的情况，之前医生也提醒过。";
    }

    return "我以前没有明确说过高血压。";
  }

  if (
    text.includes("糖尿病") ||
    text.includes("血糖")
  ) {
    if (caseText.includes("无糖尿病")) {
      return "我没有糖尿病。";
    }

    if (caseText.includes("糖尿病")) {
      return "我有糖尿病病史。";
    }

    return "我不太清楚自己有没有血糖问题。";
  }

  if (
    text.includes("腹泻") ||
    text.includes("呕吐") ||
    text.includes("拉肚子")
  ) {
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

    return "最近没有特别明显的感冒发烧。";
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

  if (
    text.includes("家族") ||
    text.includes("遗传") ||
    text.includes("家里人")
  ) {
    const familyHistory = currentCase.hiddenInfo?.familyHistory || [];

    if (familyHistory.length > 0) {
      return familyHistory.join("，") + "。";
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

  if (
    text.includes("谢谢") ||
    text.includes("好的") ||
    text.includes("明白")
  ) {
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
    keywords.push("血尿", "尿血", "红色", "茶色", "茶水");
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

function buildChecklist(currentCase) {
  const items =
    Array.isArray(currentCase.mustAskItems) && currentCase.mustAskItems.length > 0
      ? currentCase.mustAskItems
      : [
          "水肿部位和时间",
          "尿量变化",
          "泡沫尿",
          "血尿",
          "高血压病史",
          "糖尿病史",
          "用药史",
          "家族史",
          "既往肾病史"
        ];

  return items.map(item => ({
    item,
    keywords: getKeywordsForItem(item)
  }));
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

app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, "../client")));

app.get("/api/health", (req, res) => {
  res.json({
    status: "ok",
    message: "Renal SP Agent MVP is running"
  });
});

app.post("/api/cases/generate", async (req, res) => {
  try {
    const { complaint, difficulty } = req.body;

    let selectedCase = null;
    let source = "seed";
    let warning = "";

    if (process.env.DEEPSEEK_API_KEY && complaint) {
      try {
        selectedCase = await generateCaseWithDeepSeek(complaint, difficulty);
        source = "deepseek";
      } catch (error) {
        console.error("AI 生成病例失败，改用本地病例：", error.message);
        warning = "AI 生成病例失败，已自动改用本地病例种子。";
      }
    }

    if (!selectedCase) {
      selectedCase = selectSeedCase(complaint);
    }

    if (!selectedCase) {
      return res.status(500).json({
        success: false,
        message: "没有找到可用病例，请检查 server/data/caseSeeds.json"
      });
    }

    selectedCase = normalizeCaseShape(selectedCase, complaint, difficulty);

    res.json({
      success: true,
      source,
      warning,
      case: toPublicCase(selectedCase)
    });
  } catch (error) {
    console.error(error);

    res.status(500).json({
      success: false,
      message: error.message || "生成病例失败"
    });
  }
});

app.post("/api/patient/reply", async (req, res) => {
  try {
    const { caseId, question, conversationHistory } = req.body;

    if (!question || !question.trim()) {
      return res.status(400).json({
        success: false,
        message: "请先输入医生问题"
      });
    }

    const currentCase = findCaseById(caseId);

    if (!currentCase) {
      return res.status(404).json({
        success: false,
        message: "没有找到对应病例"
      });
    }

    let reply = "";

    if (process.env.DEEPSEEK_API_KEY) {
      try {
        reply = await generatePatientReplyWithDeepSeek(
          currentCase,
          question,
          conversationHistory || []
        );
      } catch (error) {
        console.error("AI 患者回复失败，改用规则回复：", error.message);
        reply = ruleBasedPatientReply(currentCase, question);
      }
    } else {
      reply = ruleBasedPatientReply(currentCase, question);
    }

    res.json({
      success: true,
      reply
    });
  } catch (error) {
    console.error(error);

    res.status(500).json({
      success: false,
      message: error.message || "患者回复失败"
    });
  }
});

app.post("/api/scoring/evaluate", (req, res) => {
  try {
    const { caseId, conversationHistory, studentDiagnosis } = req.body;

    const currentCase = findCaseById(caseId);

    if (!currentCase) {
      return res.status(404).json({
        success: false,
        message: "没有找到对应病例"
      });
    }

    const allQuestions = (conversationHistory || [])
      .map(item => item.doctor || "")
      .join(" ");

    const checklist = buildChecklist(currentCase);

    const coveredItems = [];
    const missedItems = [];

    checklist.forEach(rule => {
      const matched = rule.keywords.some(keyword => allQuestions.includes(keyword));

      if (matched) {
        coveredItems.push(rule.item);
      } else {
        missedItems.push(rule.item);
      }
    });

    const historyScore = Math.round((coveredItems.length / checklist.length) * 50);
    const diagnosisScore = calculateDiagnosisScore(
      studentDiagnosis,
      currentCase.finalDiagnosis
    );

    let communicationScore = 12;

    if (
      allQuestions.includes("请") ||
      allQuestions.includes("谢谢") ||
      allQuestions.includes("别担心") ||
      allQuestions.includes("不用紧张") ||
      allQuestions.includes("我了解") ||
      allQuestions.includes("辛苦")
    ) {
      communicationScore = 20;
    }

    const totalScore = historyScore + diagnosisScore + communicationScore;

    let diagnosisFeedback = "";

    if (diagnosisScore === 30) {
      diagnosisFeedback = `诊断正确，标准诊断为：${currentCase.finalDiagnosis}。`;
    } else if (diagnosisScore === 18) {
      diagnosisFeedback = `诊断方向基本正确，但还不够准确。标准诊断为：${currentCase.finalDiagnosis}。`;
    } else if (diagnosisScore === 0) {
      diagnosisFeedback = `你还没有提交明确诊断。标准诊断为：${currentCase.finalDiagnosis}。`;
    } else {
      diagnosisFeedback = `诊断方向不够明确。标准诊断为：${currentCase.finalDiagnosis}。`;
    }

    res.json({
      success: true,
      report: {
        totalScore,
        historyScore,
        diagnosisScore,
        communicationScore,
        coveredItems,
        missedItems,
        diagnosisFeedback,
        suggestion: "建议下次按照“主诉—现病史—既往史—用药史—家族史—检查建议”的顺序问诊，避免遗漏关键病史。"
      }
    });
  } catch (error) {
    console.error(error);

    res.status(500).json({
      success: false,
      message: error.message || "评分失败"
    });
  }
});

app.get("*", (req, res) => {
  res.sendFile(path.join(__dirname, "../client/index.html"));
});

app.listen(PORT, () => {
  console.log(`Server is running on port ${PORT}`);
});
