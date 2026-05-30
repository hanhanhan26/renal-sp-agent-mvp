let currentCase = null;
let conversationHistory = [];
let selectedCaseTemplate = null;

const caseLibrary = [
  {
    id: "aki_oliguria",
    title: "少尿与乏力",
    desc: "腹泻后少尿，需发现肾前性因素与药物暴露",
    tag: "AKI",
    complaint: "少尿、乏力、肌酐升高",
    difficulty: "基础",
    quickQuestions: [
      "这两天有没有腹泻或呕吐吗？",
      "近期吃过止痛药吗？",
      "尿量大概减少到多少？",
      "有没有胸闷或心慌？",
      "最近喝水少吗？"
    ]
  },
  {
    id: "nephrotic_edema",
    title: "水肿与蛋白尿",
    desc: "大量蛋白尿表现，训练肾病综合征问诊",
    tag: "肾综",
    complaint: "水肿、蛋白尿、泡沫尿",
    difficulty: "中等",
    quickQuestions: [
      "水肿是从哪里开始的？",
      "早上重还是晚上重？",
      "小便泡沫多吗？",
      "尿量有没有减少？",
      "最近有没有感染或服用药物？"
    ]
  },
  {
    id: "gn_hematuria",
    title: "血尿与血压升高",
    desc: "感染后血尿，评估肾小球来源",
    tag: "肾炎",
    complaint: "血尿、高血压、眼睑水肿",
    difficulty: "进阶",
    quickQuestions: [
      "尿液是什么颜色？",
      "血尿前有没有咽痛或发热？",
      "有没有眼睑或下肢水肿？",
      "最近血压高吗？",
      "有没有腰痛或尿痛？"
    ]
  }
];

const structuredClues = {
  chiefComplaint: "未提取",
  fever: "未提取",
  lumbarPain: "未提取",
  urinaryIrritation: "未提取",
  urineChange: "未提取",
  edema: "未提取",
  hematuria: "未提取",
  medication: "未提取",
  infection: "未提取",
  history: "未提取",
  familyHistory: "未提取",
  risk: "未提取"
};

const deepSeekClueKeyMap = {
  chiefComplaint: "chiefComplaint",
  fever: "fever",
  flankPain: "lumbarPain",
  lumbarPain: "lumbarPain",
  urinarySymptoms: "urinaryIrritation",
  urinaryIrritation: "urinaryIrritation",
  urineVolume: "urineChange",
  urineChange: "urineChange",
  edema: "edema",
  hematuria: "hematuria",
  medicationHistory: "medication",
  medication: "medication",
  infectionClue: "infection",
  infection: "infection",
  pastHistory: "history",
  history: "history",
  familyHistory: "familyHistory",
  dangerSigns: "risk",
  risk: "risk"
};

const generateBtn = document.getElementById("generateBtn");
const sendBtn = document.getElementById("sendBtn");
const scoreBtn = document.getElementById("scoreBtn");
const resetBtn = document.getElementById("resetBtn");
const newCaseBtn = document.getElementById("newCaseBtn");

const chatBox = document.getElementById("chatBox");
const complaintInput = document.getElementById("complaint");
const difficultyInput = document.getElementById("difficulty");
const questionInput = document.getElementById("doctorQuestion");
const caseList = document.getElementById("caseList");
const quickQuestionsBox = document.getElementById("quickQuestions");

function escapeHTML(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

function formatList(items = []) {
  if (!Array.isArray(items) || items.length === 0) {
    return "<li>暂无</li>";
  }

  return items
    .map(item => `<li>${escapeHTML(item)}</li>`)
    .join("");
}

function getClueValue(item) {
  if (!item) {
    return "";
  }

  if (typeof item === "string") {
    return item.trim();
  }

  if (typeof item === "object") {
    if (item.value !== undefined && item.value !== null) {
      return String(item.value).trim();
    }

    if (item.text !== undefined && item.text !== null) {
      return String(item.text).trim();
    }

    if (item.result !== undefined && item.result !== null) {
      return String(item.result).trim();
    }
  }

  return "";
}

function shouldUseClueValue(value) {
  if (!value) {
    return false;
  }

  const text = String(value).trim();

  if (!text) {
    return false;
  }

  if (
    text === "未提取" ||
    text === "无" ||
    text === "无明确" ||
    text === "null" ||
    text === "undefined"
  ) {
    return false;
  }

  return true;
}

function valueHasTemperature(value) {
  return /(\d{2}(?:\.\d+)?)\s*(度|℃)/.test(String(value || ""));
}

function getTemperatureNumber(text) {
  const source = String(text || "");
  const match = source.match(/(\d{2}(?:\.\d+)?)\s*(?:度|℃)/);

  if (!match) {
    return null;
  }

  return Number(match[1]);
}

function containsHighFever(text) {
  const temp = getTemperatureNumber(text);

  if (temp !== null && temp >= 39) {
    return true;
  }

  return hasAny(text, ["高热", "高烧"]);
}

function mergeStructuredClue(key, newValue) {
  if (!shouldUseClueValue(newValue)) {
    return;
  }

  const oldValue = structuredClues[key];

  if (!oldValue || oldValue === "未提取") {
    structuredClues[key] = newValue;
    return;
  }

  if (key === "fever" && valueHasTemperature(oldValue) && !valueHasTemperature(newValue)) {
    return;
  }

  if (key === "fever" && valueHasTemperature(newValue) && !valueHasTemperature(oldValue)) {
    structuredClues[key] = newValue;
    return;
  }

  if (String(newValue).length > String(oldValue).length) {
    structuredClues[key] = newValue;
  }
}

function applyDeepSeekExtractedClues(extractedClues) {
  if (!extractedClues || typeof extractedClues !== "object") {
    return;
  }

  Object.entries(extractedClues).forEach(([deepSeekKey, rawValue]) => {
    const localKey = deepSeekClueKeyMap[deepSeekKey];

    if (!localKey) {
      return;
    }

    const value = getClueValue(rawValue);

    if (!shouldUseClueValue(value)) {
      return;
    }

    mergeStructuredClue(localKey, value);
  });

  renderStructuredClues();
}

function renderCaseLibrary(list = caseLibrary) {
  caseList.innerHTML = "";

  list.forEach(item => {
    const button = document.createElement("button");
    button.className = "case-item";
    button.dataset.id = item.id;

    button.innerHTML = `
      <div class="case-name">${escapeHTML(item.title)}</div>
      <div class="case-desc">${escapeHTML(item.desc)}</div>
      <span class="tag">${escapeHTML(item.tag)}</span>
    `;

    button.addEventListener("click", async () => {
      document.querySelectorAll(".case-item").forEach(el => el.classList.remove("active"));
      button.classList.add("active");

      selectedCaseTemplate = item;
      complaintInput.value = item.complaint;
      difficultyInput.value = item.difficulty;
      renderQuickQuestions(item.quickQuestions);

      await generateCase();
    });

    caseList.appendChild(button);
  });
}

function renderQuickQuestions(questions = []) {
  quickQuestionsBox.innerHTML = "";

  questions.forEach(question => {
    const button = document.createElement("button");
    button.className = "quick-btn";
    button.textContent = question;

    button.addEventListener("click", () => {
      questionInput.value = question;
      questionInput.focus();
    });

    quickQuestionsBox.appendChild(button);
  });
}

function addMessage(role, text) {
  const empty = chatBox.querySelector(".chat-empty");
  if (empty) empty.remove();

  const message = document.createElement("div");
  message.className = `message ${role}`;

  const label = role === "doctor" ? "医生：" : "患者：";
  message.innerHTML = `<strong>${label}</strong>${escapeHTML(text)}`;

  chatBox.appendChild(message);
  chatBox.scrollTop = chatBox.scrollHeight;
}

function updatePatientHeader(generatedCase) {
  const profile = generatedCase.patientProfile || {};

  document.getElementById("patientTitle").textContent =
    `${profile.gender || "患者"}，${profile.age || "未知"} 岁｜${generatedCase.chiefComplaint || "待问诊"}`;

  document.getElementById("patientMeta").textContent =
    `${profile.occupation || "未填写职业"}｜科室：${generatedCase.department || "肾内科"}`;

  document.getElementById("difficultyBadge").textContent =
    generatedCase.difficulty || "中等";
}

function resetStructuredClues() {
  Object.keys(structuredClues).forEach(key => {
    structuredClues[key] = "未提取";
  });

  renderStructuredClues();
}

function hasAny(text, keywords) {
  const source = String(text || "");
  return keywords.some(keyword => source.includes(keyword));
}

function containsFeverClue(text) {
  const source = String(text || "");

  return (
    hasAny(source, [
      "发热",
      "发烧",
      "烧到",
      "烧至",
      "高烧",
      "高热",
      "低热",
      "体温",
      "最高",
      "多少度",
      "几度",
      "寒战",
      "怕冷",
      "畏寒"
    ]) ||
    /(\d{2}(?:\.\d+)?)\s*(度|℃)/.test(source)
  );
}

function containsLumbarPainClue(text) {
  const source = String(text || "");

  return (
    hasAny(source, [
      "腰痛",
      "腰疼",
      "腰酸",
      "腰部",
      "腰两边",
      "两边腰",
      "两侧腰",
      "双侧腰",
      "后腰",
      "腰背",
      "腰背部",
      "腰部后面",
      "腰后面",
      "肾区",
      "酸疼",
      "叩击痛"
    ]) ||
    /腰.{0,10}(疼|痛|酸|胀)/.test(source) ||
    /(疼|痛|酸|胀).{0,10}腰/.test(source)
  );
}

function chineseDayToNumber(value) {
  const map = {
    一: 1,
    二: 2,
    两: 2,
    三: 3,
    四: 4,
    五: 5,
    六: 6,
    七: 7
  };

  return map[value] || value;
}

function extractFeverInfo(text) {
  const source = String(text || "");
  const parts = [];

  const dayMatch =
    source.match(/发烧(\d+)天/) ||
    source.match(/发热(\d+)天/) ||
    source.match(/烧了(\d+)天/) ||
    source.match(/这(\d+)天.*烧/) ||
    source.match(/烧.*第(\d+)天/) ||
    source.match(/第([一二两三四五六七\d]+)天/) ||
    source.match(/([一二两三四五六七\d]+)天.*发烧/) ||
    source.match(/([一二两三四五六七\d]+)天.*发热/) ||
    source.match(/([一二两三四五六七\d]+)天.*烧/);

  if (dayMatch) {
    const rawDays = dayMatch[1];
    const days = chineseDayToNumber(rawDays);
    parts.push(`持续${days}天`);
  }

  const tempMatch =
    source.match(/最高(?:烧到|烧至|到|达)?\s*(\d{2}(?:\.\d+)?)\s*(?:度|℃)/) ||
    source.match(/体温(?:最高)?(?:到|达|是)?\s*(\d{2}(?:\.\d+)?)\s*(?:度|℃)/) ||
    source.match(/烧到\s*(\d{2}(?:\.\d+)?)\s*(?:度|℃)/) ||
    source.match(/烧至\s*(\d{2}(?:\.\d+)?)\s*(?:度|℃)/) ||
    source.match(/(\d{2}(?:\.\d+)?)\s*(?:度|℃)/);

  if (tempMatch) {
    parts.push(`最高${tempMatch[1]}度`);
  }

  if (parts.length > 0) {
    return parts.join("、");
  }

  if (containsFeverClue(source)) {
    return "有发热";
  }

  return "";
}

function extractLumbarPainInfo(text) {
  const source = String(text || "");

  if (
    hasAny(source, [
      "腰两边",
      "两边腰",
      "两侧腰",
      "双侧腰",
      "腰部后面",
      "腰后面",
      "后腰",
      "腰背部",
      "肾区"
    ])
  ) {
    return "腰部 / 肾区疼痛";
  }

  if (
    hasAny(source, [
      "腰痛",
      "腰疼",
      "腰酸",
      "腰部疼",
      "腰部痛",
      "肾区疼痛",
      "肾区痛"
    ])
  ) {
    return "腰痛 / 肾区疼痛";
  }

  if (/腰.{0,10}(疼|痛|酸|胀)/.test(source)) {
    return "腰痛 / 肾区疼痛";
  }

  if (/(疼|痛|酸|胀).{0,10}腰/.test(source)) {
    return "腰痛 / 肾区疼痛";
  }

  if (hasAny(source, ["肾区叩击痛", "叩击痛"])) {
    return "肾区叩击痛";
  }

  return "";
}

function extractUrinaryIrritationInfo(text) {
  const source = String(text || "");
  const items = [];

  if (hasAny(source, ["尿频", "小便次数多", "次数多"])) {
    items.push("尿频");
  }

  if (hasAny(source, ["尿急", "急"])) {
    items.push("尿急");
  }

  if (hasAny(source, ["尿痛", "小便疼", "排尿痛", "尿的时候痛", "小便的时候痛", "痛"])) {
    items.push("尿痛");
  }

  if (hasAny(source, ["又急又痛"])) {
    items.push("尿急", "尿痛");
  }

  const uniqueItems = [...new Set(items)];

  if (uniqueItems.length > 0) {
    return `有${uniqueItems.join("、")}`;
  }

  return "";
}

function extractInfectionCauseInfo(text) {
  if (hasAny(text, ["发热", "发烧", "高烧", "高热", "低热"])) {
    return "发热提示感染可能";
  }

  if (hasAny(text, ["感冒", "咽痛", "咳嗽"])) {
    return "上呼吸道感染";
  }

  if (hasAny(text, ["腹泻", "呕吐"])) {
    return "胃肠道感染";
  }

  return "";
}

function analyzeStructuredClues(question, reply, mode = "normal") {
  const text = `${question || ""} ${reply || ""}`;

  if (
    mode === "opening" ||
    hasAny(text, ["哪里不舒服", "主诉", "怎么了", "现病史", "不舒服"])
  ) {
    mergeStructuredClue("chiefComplaint", reply || "已获取患者主诉信息");
  }

  if (containsFeverClue(text)) {
    const feverInfo = extractFeverInfo(text);
    mergeStructuredClue("fever", feverInfo || reply);
  }

  if (containsHighFever(text)) {
    mergeStructuredClue("risk", "高热");
  }

  if (containsLumbarPainClue(text)) {
    const lumbarPainInfo = extractLumbarPainInfo(text);
    mergeStructuredClue("lumbarPain", lumbarPainInfo || reply);
  }

  if (hasAny(text, ["尿频", "尿急", "尿痛", "小便次数", "尿路刺激", "排尿痛", "尿的时候痛", "又急又痛"])) {
    const urinaryInfo = extractUrinaryIrritationInfo(text);
    mergeStructuredClue("urinaryIrritation", urinaryInfo || "有尿路刺激症状");
  }

  if (hasAny(text, ["尿量", "少尿", "尿少", "小便少", "小便多", "小便变化", "次数多"])) {
    mergeStructuredClue("urineChange", reply);
  }

  if (hasAny(text, ["水肿", "肿", "眼皮", "脚踝", "下肢", "浮肿"])) {
    mergeStructuredClue("edema", reply);
  }

  if (hasAny(text, ["血尿", "尿血", "红色", "茶色", "尿液颜色", "颜色"])) {
    mergeStructuredClue("hematuria", reply);
  }

  if (hasAny(text, ["药", "用药", "止痛药", "布洛芬", "中草药", "抗生素", "过敏"])) {
    mergeStructuredClue("medication", reply);
  }

  if (hasAny(text, ["感染", "感冒", "咽痛", "腹泻", "呕吐", "发热", "发烧", "高烧", "高热"])) {
    const infectionInfo = extractInfectionCauseInfo(text);
    mergeStructuredClue("infection", infectionInfo || reply);
  }

  if (hasAny(text, ["高血压", "糖尿病", "以前", "既往", "肾病史", "基础病", "慢性病"])) {
    mergeStructuredClue("history", reply);
  }

  if (hasAny(text, ["家族", "遗传", "家里人", "父母", "兄弟姐妹"])) {
    mergeStructuredClue("familyHistory", reply);
  }

  if (
    hasAny(text, ["胸闷", "心慌", "气促", "高钾", "危险", "休克", "意识", "少尿", "严重", "高热", "高烧"]) ||
    containsHighFever(text)
  ) {
    if (containsHighFever(text)) {
      mergeStructuredClue("risk", "高热");
    } else {
      mergeStructuredClue("risk", reply);
    }
  }

  renderStructuredClues();
}

function renderStructuredClues() {
  const labels = {
    chiefComplaint: "主诉与现病史",
    fever: "发热 / 体温",
    lumbarPain: "腰痛 / 肾区疼痛",
    urinaryIrritation: "尿频 / 尿急 / 尿痛",
    urineChange: "尿量 / 小便变化",
    edema: "水肿信息",
    hematuria: "血尿信息",
    medication: "用药史",
    infection: "感染 / 诱因",
    history: "既往史",
    familyHistory: "家族史",
    risk: "危险信号"
  };

  const extractedItems = Object.entries(structuredClues)
    .filter(([, value]) => shouldUseClueValue(value));

  document.getElementById("clueCount").textContent = `${extractedItems.length} 条`;

  const structuredCluesBox = document.getElementById("structuredClues");

  if (extractedItems.length === 0) {
    structuredCluesBox.innerHTML = `
      <div class="clue-empty">
        暂未提取到线索。开始问诊后，系统会在这里显示已提取到的信息。
      </div>
    `;
    return;
  }

  structuredCluesBox.innerHTML = extractedItems
    .map(([key, value]) => {
      return `
        <div class="clue-row extracted">
          <strong>${escapeHTML(labels[key] || key)}</strong>
          <span>${escapeHTML(value)}</span>
        </div>
      `;
    })
    .join("");
}

function getCheckedExams() {
  return Array.from(document.querySelectorAll("#examList input[type='checkbox']:checked"))
    .map(input => input.value);
}

async function generateCase() {
  const complaint = complaintInput.value.trim();
  const difficulty = difficultyInput.value;

  if (!complaint) {
    alert("请先输入主诉或训练目标");
    return;
  }

  generateBtn.disabled = true;
  generateBtn.textContent = "正在生成病例...";

  try {
    const response = await fetch("/api/cases/generate", {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        complaint,
        difficulty,
        scenarioId: selectedCaseTemplate ? selectedCaseTemplate.id : null,
        scenarioTitle: selectedCaseTemplate ? selectedCaseTemplate.title : null
      })
    });

    const data = await response.json();

    if (!data.success) {
      alert(data.message || "生成病例失败");
      return;
    }

    currentCase = data.case;
    conversationHistory = [];

    resetStructuredClues();

    document.getElementById("reportBox").innerHTML =
      `<p class="report-placeholder">评分反馈会显示在这里。点击顶部“学习反馈”也会跳到这里。</p>`;

    updatePatientHeader(currentCase);

    chatBox.innerHTML = "";

    const openingText =
      currentCase.openingStatement ||
      currentCase.chiefComplaint ||
      "医生您好，我最近身体有些不舒服。";

    addMessage("patient", openingText);

    analyzeStructuredClues("主诉与现病史", openingText, "opening");

    if (data.extractedClues) {
      applyDeepSeekExtractedClues(data.extractedClues);
    }

    document.getElementById("generateBox").style.display = "none";
  } catch (error) {
    console.error(error);
    alert("请求失败，请检查服务是否启动");
  } finally {
    generateBtn.disabled = false;
    generateBtn.textContent = "生成病例并开始问诊";
  }
}

async function sendQuestion() {
  if (!currentCase) {
    alert("请先生成病例");
    return;
  }

  const question = questionInput.value.trim();

  if (!question) {
    alert("请输入医生的问题");
    return;
  }

  addMessage("doctor", question);
  questionInput.value = "";

  sendBtn.disabled = true;
  sendBtn.textContent = "等待";

  try {
    const response = await fetch("/api/patient/reply", {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        caseId: currentCase.caseId,
        question,
        conversationHistory
      })
    });

    const data = await response.json();

    if (!data.success) {
      alert(data.message || "患者回复失败");
      return;
    }

    const reply = data.reply || "这个我不太确定。";

    addMessage("patient", reply);

    conversationHistory.push({
      doctor: question,
      patient: reply
    });

    analyzeStructuredClues(question, reply);

    if (data.extractedClues) {
      applyDeepSeekExtractedClues(data.extractedClues);
    }
  } catch (error) {
    console.error(error);
    alert("请求失败，请检查服务是否启动");
  } finally {
    sendBtn.disabled = false;
    sendBtn.textContent = "发送";
  }
}

function normalizeConversationForDeepSeek(history = []) {
  const normalized = [];

  history.forEach(item => {
    if (item.doctor) {
      normalized.push({
        role: "doctor",
        content: item.doctor
      });
    }

    if (item.patient) {
      normalized.push({
        role: "patient",
        content: item.patient
      });
    }
  });

  return normalized;
}

async function getDeepSeekScore({
  caseId,
  conversationHistory,
  studentDiagnosis,
  ruleResult
}) {
  const response = await fetch("/api/score/deepseek", {
    method: "POST",
    headers: {
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      caseId,
      conversationHistory,
      studentDiagnosis,
      ruleResult
    })
  });

  const data = await response.json();

  if (!data.success) {
    throw new Error(data.error || data.message || "DeepSeek 评分失败");
  }

  return data.scoring;
}

function renderScoreReport(ruleReport, aiReport = null, aiError = "") {
  const reportBox = document.getElementById("reportBox");

  if (aiReport) {
    reportBox.innerHTML = `
      <div class="score-card">
        <div>AI 教师评分</div>
        <div class="score-number">${escapeHTML(aiReport.totalScore ?? ruleReport.totalScore ?? 0)}/100</div>

        <p><strong>等级：</strong>${escapeHTML(aiReport.scoreLevel || "暂无")}</p>

        <p><strong>规则评分说明：</strong>${escapeHTML(aiReport.ruleScoreComment || "暂无")}</p>

        <hr />

        <p><strong>病史采集：</strong>${escapeHTML(aiReport.dimensions?.historyTaking?.score ?? ruleReport.historyScore ?? 0)} 分</p>
        <p>${escapeHTML(aiReport.dimensions?.historyTaking?.comment || "暂无反馈")}</p>

        <p><strong>诊断判断：</strong>${escapeHTML(aiReport.dimensions?.clinicalReasoning?.score ?? ruleReport.diagnosisScore ?? 0)} 分</p>
        <p>${escapeHTML(aiReport.dimensions?.clinicalReasoning?.comment || aiReport.diagnosisFeedback || "暂无反馈")}</p>

        <p><strong>沟通表现：</strong>${escapeHTML(aiReport.dimensions?.communication?.score ?? ruleReport.communicationScore ?? 0)} 分</p>
        <p>${escapeHTML(aiReport.dimensions?.communication?.comment || "暂无反馈")}</p>

        <hr />

        <p><strong>诊断反馈：</strong>${escapeHTML(aiReport.diagnosisFeedback || ruleReport.diagnosisFeedback || "暂无反馈")}</p>

        <p><strong>已覆盖要点：</strong></p>
        <ul>${formatList(aiReport.coveredItems || ruleReport.coveredItems)}</ul>

        <p><strong>遗漏要点：</strong></p>
        <ul>${formatList(aiReport.missedItems || ruleReport.missedItems)}</ul>

        <p><strong>主要问题：</strong></p>
        <ul>${formatList(aiReport.mainProblems || [])}</ul>

        <p><strong>教师点评：</strong>${escapeHTML(aiReport.teacherComment || "暂无")}</p>

        <p><strong>下次练习建议：</strong>${escapeHTML(aiReport.nextPracticeAdvice || ruleReport.suggestion || "建议继续完善问诊顺序和临床判断。")}</p>
      </div>

      <div class="score-card">
        <div>规则评分参考</div>
        <p><strong>规则总分：</strong>${escapeHTML(ruleReport.totalScore || 0)}/100</p>
        <p><strong>病史采集：</strong>${escapeHTML(ruleReport.historyScore || 0)} 分</p>
        <p><strong>诊断判断：</strong>${escapeHTML(ruleReport.diagnosisScore || 0)} 分</p>
        <p><strong>风险识别：</strong>${escapeHTML(ruleReport.riskScore || 0)} 分</p>
        <p><strong>检查选择：</strong>${escapeHTML(ruleReport.examScore || 0)} 分</p>
        <p><strong>沟通表现：</strong>${escapeHTML(ruleReport.communicationScore || 0)} 分</p>
      </div>
    `;

    return;
  }

  reportBox.innerHTML = `
    <div class="score-card">
      <div>规则评分</div>
      <div class="score-number">${escapeHTML(ruleReport.totalScore || 0)}/100</div>

      ${aiError ? `<p class="warning"><strong>AI 教师评分未完成：</strong>${escapeHTML(aiError)}</p>` : ""}

      <p><strong>病史采集：</strong>${escapeHTML(ruleReport.historyScore || 0)} 分</p>
      <p><strong>诊断判断：</strong>${escapeHTML(ruleReport.diagnosisScore || 0)} 分</p>
      <p><strong>风险识别：</strong>${escapeHTML(ruleReport.riskScore || 0)} 分</p>
      <p><strong>检查选择：</strong>${escapeHTML(ruleReport.examScore || 0)} 分</p>
      <p><strong>沟通表现：</strong>${escapeHTML(ruleReport.communicationScore || 0)} 分</p>

      <p><strong>诊断反馈：</strong>${escapeHTML(ruleReport.diagnosisFeedback || "暂无反馈")}</p>
      <p><strong>风险反馈：</strong>${escapeHTML(ruleReport.riskFeedback || "暂无反馈")}</p>
      <p><strong>检查反馈：</strong>${escapeHTML(ruleReport.examFeedback || "暂无反馈")}</p>

      <p><strong>已覆盖要点：</strong></p>
      <ul>${formatList(ruleReport.coveredItems)}</ul>

      <p><strong>遗漏要点：</strong></p>
      <ul>${formatList(ruleReport.missedItems)}</ul>

      <p><strong>改进建议：</strong>${escapeHTML(ruleReport.suggestion || "建议继续完善问诊顺序和临床判断。")}</p>
    </div>
  `;
}

async function submitScore() {
  if (!currentCase) {
    alert("请先生成病例");
    return;
  }

  const studentDiagnosis = document.getElementById("studentDiagnosis").value.trim();
  const riskInput = document.getElementById("riskInput").value.trim();
  const checkedExams = getCheckedExams();

  if (!studentDiagnosis) {
    alert("请先填写初步诊断");
    return;
  }

  scoreBtn.disabled = true;
  scoreBtn.textContent = "正在评分...";

  try {
    const ruleResponse = await fetch("/api/scoring/evaluate", {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        caseId: currentCase.caseId,
        conversationHistory,
        studentDiagnosis,
        riskInput,
        checkedExams,
        structuredClues
      })
    });

    const ruleData = await ruleResponse.json();

    if (!ruleData.success) {
      alert(ruleData.message || "规则评分失败");
      return;
    }

    const ruleReport = ruleData.report;

    let aiReport = null;
    let aiError = "";

    try {
      scoreBtn.textContent = "正在生成 AI 教师点评...";

      aiReport = await getDeepSeekScore({
        caseId: currentCase.caseId,
        conversationHistory: normalizeConversationForDeepSeek(conversationHistory),
        studentDiagnosis,
        ruleResult: ruleReport
      });
    } catch (error) {
      console.error("DeepSeek 评分失败：", error);
      aiError = error.message || "DeepSeek 评分失败，已保留规则评分结果。";
    }

    renderScoreReport(ruleReport, aiReport, aiError);

    document.getElementById("feedbackPanel").scrollIntoView({
      behavior: "smooth",
      block: "start"
    });
  } catch (error) {
    console.error(error);
    alert("请求失败，请检查服务是否启动");
  } finally {
    scoreBtn.disabled = false;
    scoreBtn.textContent = "提交判断并评分";
  }
}

function resetTraining() {
  currentCase = null;
  conversationHistory = [];
  selectedCaseTemplate = null;

  document.getElementById("patientTitle").textContent = "请先选择或生成病例";
  document.getElementById("patientMeta").textContent = "点击左侧案例库，或手动输入主诉生成标准化病人。";
  document.getElementById("difficultyBadge").textContent = "未开始";

  chatBox.innerHTML = `<div class="chat-empty">选择左侧案例或生成病例后，患者开场白会显示在这里。</div>`;

  document.getElementById("generateBox").style.display = "block";
  document.getElementById("studentDiagnosis").value = "";
  document.getElementById("riskInput").value = "";

  document.querySelectorAll("#examList input[type='checkbox']").forEach(input => {
    input.checked = false;
  });

  resetStructuredClues();

  document.getElementById("reportBox").innerHTML =
    `<p class="report-placeholder">评分反馈会显示在这里。点击顶部“学习反馈”也会跳到这里。</p>`;

  document.querySelectorAll(".case-item").forEach(el => el.classList.remove("active"));
}

function openFeedbackPanel() {
  document.getElementById("trainingTab").classList.remove("active");
  document.getElementById("feedbackTab").classList.add("active");

  const feedbackPanel = document.getElementById("feedbackPanel");

  feedbackPanel.scrollIntoView({
    behavior: "smooth",
    block: "start"
  });

  feedbackPanel.classList.add("feedback-highlight");

  setTimeout(() => {
    feedbackPanel.classList.remove("feedback-highlight");
  }, 1200);
}

function openTrainingPanel() {
  document.getElementById("feedbackTab").classList.remove("active");
  document.getElementById("trainingTab").classList.add("active");

  document.querySelector(".center-panel").scrollIntoView({
    behavior: "smooth",
    block: "start"
  });
}

generateBtn.addEventListener("click", generateCase);
sendBtn.addEventListener("click", sendQuestion);
scoreBtn.addEventListener("click", submitScore);
resetBtn.addEventListener("click", resetTraining);
newCaseBtn.addEventListener("click", resetTraining);

document.getElementById("feedbackTab").addEventListener("click", openFeedbackPanel);
document.getElementById("trainingTab").addEventListener("click", openTrainingPanel);

document.getElementById("knowledgeBtn")?.addEventListener("click", () => {
  document.getElementById("knowledgeMenu").classList.toggle("show");
});

document.addEventListener("click", event => {
  const dropdown = document.querySelector(".dropdown");
  const menu = document.getElementById("knowledgeMenu");

  if (dropdown && menu && !dropdown.contains(event.target)) {
    menu.classList.remove("show");
  }
});

questionInput.addEventListener("keydown", event => {
  if (event.key === "Enter") {
    sendQuestion();
  }
});

document.getElementById("caseSearchInput").addEventListener("input", event => {
  const keyword = event.target.value.trim();

  const filtered = caseLibrary.filter(item => {
    return (
      item.title.includes(keyword) ||
      item.desc.includes(keyword) ||
      item.tag.includes(keyword) ||
      item.complaint.includes(keyword)
    );
  });

  renderCaseLibrary(filtered);
});

renderCaseLibrary();
renderQuickQuestions(caseLibrary[0].quickQuestions);
renderStructuredClues();
