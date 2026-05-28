const generateBtn = document.getElementById("generateBtn");
const sendQuestionBtn = document.getElementById("sendQuestionBtn");
const finishInterviewBtn = document.getElementById("finishInterviewBtn");
const submitScoreBtn = document.getElementById("submitScoreBtn");

let currentCase = null;
let conversationHistory = [];

generateBtn.addEventListener("click", generateCase);
sendQuestionBtn.addEventListener("click", sendQuestion);
finishInterviewBtn.addEventListener("click", showScoringSection);
submitScoreBtn.addEventListener("click", submitScore);

document.getElementById("doctorQuestion").addEventListener("keydown", (event) => {
  if (event.key === "Enter") {
    sendQuestion();
  }
});

async function generateCase() {
  const complaint = document.getElementById("complaint").value.trim();
  const difficulty = document.getElementById("difficulty").value;

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
        difficulty
      })
    });

    const data = await response.json();

    if (!response.ok || !data.success) {
      alert(data.message || "生成失败，请稍后重试");
      return;
    }

    if (data.warning) {
      console.warn(data.warning);
    }

    currentCase = data.case;
    conversationHistory = [];

    document.getElementById("department").textContent = currentCase.department || "";
    document.getElementById("caseDifficulty").textContent = currentCase.difficulty || "";
    document.getElementById("patientInfo").textContent =
      `${currentCase.patientProfile.gender || ""}，${currentCase.patientProfile.age || ""} 岁，${currentCase.patientProfile.occupation || ""}`;
    document.getElementById("chiefComplaint").textContent = currentCase.chiefComplaint || "";
    document.getElementById("openingStatement").textContent = currentCase.openingStatement || "";

    document.getElementById("caseResult").style.display = "block";
    document.getElementById("chatSection").style.display = "block";

    document.getElementById("scoringSection").style.display = "none";
    document.getElementById("scoreResult").style.display = "none";
    document.getElementById("studentDiagnosis").value = "";

    const chatBox = document.getElementById("chatBox");
    chatBox.innerHTML = "";

    addMessage("患者", currentCase.openingStatement || "医生，我最近身体不太舒服，想来看看。");

  } catch (error) {
    console.error(error);
    alert("请求失败，请检查服务是否启动");
  } finally {
    generateBtn.disabled = false;
    generateBtn.textContent = "生成病例";
  }
}

async function sendQuestion() {
  const input = document.getElementById("doctorQuestion");
  const question = input.value.trim();

  if (!currentCase) {
    alert("请先生成病例");
    return;
  }

  if (!question) {
    alert("请输入问题");
    return;
  }

  addMessage("医生", question);
  input.value = "";

  sendQuestionBtn.disabled = true;
  sendQuestionBtn.textContent = "等待患者回答...";

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

    if (!response.ok || !data.success) {
      alert(data.message || "患者回答失败");
      return;
    }

    const reply = data.reply || "这个我不太确定，您能再问得具体一点吗？";

    addMessage("患者", reply);

    conversationHistory.push({
      doctor: question,
      patient: reply
    });

  } catch (error) {
    console.error(error);
    alert("请求失败，请检查服务是否启动");
  } finally {
    sendQuestionBtn.disabled = false;
    sendQuestionBtn.textContent = "发送";
  }
}

function showScoringSection() {
  if (!currentCase) {
    alert("请先生成病例");
    return;
  }

  document.getElementById("scoringSection").style.display = "block";
  document.getElementById("scoringSection").scrollIntoView({
    behavior: "smooth"
  });
}

async function submitScore() {
  const studentDiagnosis = document.getElementById("studentDiagnosis").value.trim();

  if (!currentCase) {
    alert("请先生成病例");
    return;
  }

  if (!studentDiagnosis) {
    alert("请先输入你的初步诊断");
    return;
  }

  submitScoreBtn.disabled = true;
  submitScoreBtn.textContent = "正在生成评分...";

  try {
    const response = await fetch("/api/scoring/evaluate", {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        caseId: currentCase.caseId,
        conversationHistory,
        studentDiagnosis
      })
    });

    const data = await response.json();

    if (!response.ok || !data.success) {
      alert(data.message || "评分失败");
      return;
    }

    const report = data.report;

    document.getElementById("totalScore").textContent = report.totalScore ?? 0;
    document.getElementById("historyScore").textContent = report.historyScore ?? 0;
    document.getElementById("diagnosisScore").textContent = report.diagnosisScore ?? 0;
    document.getElementById("communicationScore").textContent = report.communicationScore ?? 0;

    renderList("coveredItems", report.coveredItems);
    renderList("missedItems", report.missedItems);

    document.getElementById("diagnosisFeedback").textContent = report.diagnosisFeedback || "";
    document.getElementById("suggestion").textContent = report.suggestion || "";

    document.getElementById("scoreResult").style.display = "block";
  } catch (error) {
    console.error(error);
    alert("请求失败，请检查服务是否启动");
  } finally {
    submitScoreBtn.disabled = false;
    submitScoreBtn.textContent = "提交诊断并生成评分";
  }
}

function addMessage(role, text) {
  const chatBox = document.getElementById("chatBox");

  const message = document.createElement("div");
  message.className = role === "医生" ? "message doctor" : "message patient";

  const strong = document.createElement("strong");
  strong.textContent = `${role}：`;

  const span = document.createElement("span");
  span.textContent = text || "";

  message.appendChild(strong);
  message.appendChild(span);

  chatBox.appendChild(message);
  chatBox.scrollTop = chatBox.scrollHeight;
}

function renderList(elementId, items) {
  const list = document.getElementById(elementId);
  list.innerHTML = "";

  const safeItems = Array.isArray(items) ? items : [];

  if (safeItems.length === 0) {
    const li = document.createElement("li");
    li.textContent = "暂无";
    list.appendChild(li);
    return;
  }

  safeItems.forEach(item => {
    const li = document.createElement("li");
    li.textContent = item;
    list.appendChild(li);
  });
}
