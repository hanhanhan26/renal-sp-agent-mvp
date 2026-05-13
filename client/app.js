const generateBtn = document.getElementById("generateBtn");
const sendQuestionBtn = document.getElementById("sendQuestionBtn");

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
