const generateBtn = document.getElementById("generateBtn");
const sendQuestionBtn = document.getElementById("sendQuestionBtn");
const finishInterviewBtn = document.getElementById("finishInterviewBtn");
const submitScoreBtn = document.getElementById("submitScoreBtn");

let currentCase = null;
let conversationHistory = [];

generateBtn.addEventListener("click", async () => {
  const complaint = document.getElementById("complaint").value;
  const difficulty = document.getElementById("difficulty").value;

  if (!complaint.trim()) {
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

    if (!data.success) {
      alert("生成失败，请稍后重试");
      return;
    }

    currentCase = data.case;
    conversationHistory = [];

    document.getElementById("department").textContent = currentCase.department;
    document.getElementById("caseDifficulty").textContent = currentCase.difficulty;
    document.getElementById("patientInfo").textContent =
      `${currentCase.patientProfile.gender}，${currentCase.patientProfile.age} 岁，${currentCase.patientProfile.occupation}`;
    document.getElementById("chiefComplaint").textContent = currentCase.chiefComplaint;
    document.getElementById("openingStatement").textContent = currentCase.openingStatement;

    document.getElementById("caseResult").style.display = "block";
    document.getElementById("chatSection").style.display = "block";

    const chatBox = document.getElementById("chatBox");
    chatBox.innerHTML = "";
    addMessage("患者", currentCase.openingStatement);

  } catch (error) {
    console.error(error);
    alert("请求失败，请检查服务是否启动");
  } finally {
    generateBtn.disabled = false;
    generateBtn.textContent = "生成病例";
  }
});

sendQuestionBtn.addEventListener("click", sendQuestion);

finishInterviewBtn.addEventListener("click", () => {
  if (!currentCase) {
    alert("请先生成病例");
    return;
  }

  document.getElementById("scoringSection").style.display = "block";
  document.getElementById("scoringSection").scrollIntoView({
    behavior: "smooth"
  });
});

submitScoreBtn.addEventListener("click", submitScore);

document.getElementById("doctorQuestion").addEventListener("keydown", (event) => {
  if (event.key === "Enter") {
    sendQuestion();
  }
});

async function sendQuestion() {
  const input = document.getElementById("doctorQuestion");
  const question = input.value.trim();

  if (!question) {
    alert("请输入问题");
    return;
  }

  if (!currentCase) {
    alert("请先生成病例");
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

    if (!data.success) {
      alert("患者回答失败");
      return;
    }

    addMessage("患者", data.reply);

    conversationHistory.push({
      doctor: question,
      patient: data.reply
    });

  } catch (error) {
    console.error(error);
    alert("请求失败，请检查服务是否启动");
  } finally {
    sendQuestionBtn.disabled = false;
    sendQuestionBtn.textContent = "发送";
  }
}

function addMessage(role, text) {
  const chatBox = document.getElementById("chatBox");

  const message = document.createElement("div");
  message.className = role === "医生" ? "message doctor" : "message patient";

  message.innerHTML = `
    <strong>${role}：</strong>
    <span>${text}</span>
  `;

  chatBox.appendChild(message);
  chatBox.scrollTop = chatBox.scrollHeight;
}

async function submitScore() {
  const studentDiagnosis = document.getElementById("studentDiagnosis").value.trim();

  if (!studentDiagnosis) {
    alert("请先输入你的初步诊断");
    return;
  }

  if (!currentCase) {
    alert("请先生成病例");
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

    if (!data.success) {
      alert("评分失败");
      return;
    }

    const report = data.report;

    document.getElementById("totalScore").textContent = report.totalScore;
    document.getElementById("historyScore").textContent = report.historyScore;
    document.getElementById("diagnosisScore").textContent = report.diagnosisScore;
    document.getElementById("communicationScore").textContent = report.communicationScore;

    renderList("coveredItems", report.coveredItems);
    renderList("missedItems", report.missedItems);

    document.getElementById("diagnosisFeedback").textContent = report.diagnosisFeedback;
    document.getElementById("suggestion").textContent = report.suggestion;

    document.getElementById("scoreResult").style.display = "block";
  } catch (error) {
    console.error(error);
    alert("请求失败，请检查服务是否启动");
  } finally {
    submitScoreBtn.disabled = false;
    submitScoreBtn.textContent = "提交诊断并生成评分";
  }
}

function renderList(elementId, items) {
  const list = document.getElementById(elementId);
  list.innerHTML = "";

  items.forEach(item => {
    const li = document.createElement("li");
    li.textContent = item;
    list.appendChild(li);
  });
}
