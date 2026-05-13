const express = require("express");
const cors = require("cors");
const path = require("path");
const caseSeeds = require("./data/caseSeeds.json");

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json());

app.use(express.static(path.join(__dirname, "../client")));

app.get("/api/health", (req, res) => {
  res.json({
    status: "ok",
    message: "Renal SP Agent MVP is running"
  });
});

app.post("/api/cases/generate", (req, res) => {
  const { complaint, difficulty } = req.body;

  let selectedCase = caseSeeds[0];

  if (complaint) {
    const text = complaint.toLowerCase();

    if (text.includes("血尿")) {
      selectedCase = caseSeeds[1];
    } else if (
      text.includes("少尿") ||
      text.includes("尿少") ||
      text.includes("肌酐") ||
      text.includes("急性肾损伤")
    ) {
      selectedCase = caseSeeds[2];
    } else if (
      text.includes("水肿") ||
      text.includes("蛋白尿") ||
      text.includes("泡沫尿")
    ) {
      selectedCase = caseSeeds[0];
    }
  }

app.post("/api/patient/reply", (req, res) => {
  const { caseId, question, conversationHistory } = req.body;

  const currentCase = caseSeeds.find(item => item.caseId === caseId);

  if (!currentCase) {
    return res.status(404).json({
      success: false,
      message: "没有找到对应病例"
    });
  }

  const text = question || "";
  let reply = "这个我不太确定，您能再问得具体一点吗？";

  if (
    text.includes("诊断") ||
    text.includes("肾病综合征") ||
    text.includes("急性肾损伤") ||
    text.includes("什么病")
  ) {
    reply = "这个我不太清楚，还是想请医生帮我看看。";
  } else if (
    text.includes("哪里不舒服") ||
    text.includes("怎么了") ||
    text.includes("不舒服")
  ) {
    reply = currentCase.visibleInfo.openingStatement;
  } else if (
    text.includes("水肿") ||
    text.includes("肿") ||
    text.includes("腿肿") ||
    text.includes("脸肿")
  ) {
    reply = "主要是两条腿肿，早上起来脸也有点肿，已经差不多两周了。";
  } else if (
    text.includes("尿量") ||
    text.includes("尿少") ||
    text.includes("小便少")
  ) {
    reply = "感觉尿量比以前少了一些。";
  } else if (
    text.includes("泡沫尿") ||
    text.includes("泡沫")
  ) {
    reply = "有，最近小便泡沫比以前多，而且不太容易散。";
  } else if (
    text.includes("血尿") ||
    text.includes("尿血") ||
    text.includes("红色")
  ) {
    reply = "我没有明显看到尿是红色的。";
  } else if (
    text.includes("高血压") ||
    text.includes("血压")
  ) {
    reply = "我有高血压，大概 3 年了，平时有时候会吃降压药。";
  } else if (
    text.includes("糖尿病") ||
    text.includes("血糖")
  ) {
    reply = "我没有糖尿病。";
  } else if (
    text.includes("药") ||
    text.includes("用药") ||
    text.includes("止痛药") ||
    text.includes("布洛芬")
  ) {
    reply = "最近偶尔吃过布洛芬，主要是头痛的时候吃。";
  } else if (
    text.includes("家族") ||
    text.includes("遗传")
  ) {
    reply = "家里好像没有人得过明确的肾病。";
  } else if (
    text.includes("化验") ||
    text.includes("检查") ||
    text.includes("肌酐") ||
    text.includes("尿蛋白") ||
    text.includes("白蛋白")
  ) {
    reply = "我还不太清楚具体检查结果，医生说可能需要进一步检查。";
  } else if (
    text.includes("谢谢") ||
    text.includes("好的")
  ) {
    reply = "好的，医生。";
  }

  res.json({
    success: true,
    reply
  });
});

  const publicCase = {
    caseId: selectedCase.caseId,
    department: selectedCase.department,
    difficulty: difficulty || selectedCase.difficulty,
    patientProfile: {
      age: selectedCase.patientProfile.age,
      gender: selectedCase.patientProfile.gender,
      occupation: selectedCase.patientProfile.occupation
    },
    chiefComplaint: selectedCase.chiefComplaint,
    openingStatement: selectedCase.visibleInfo.openingStatement
  };

  res.json({
    success: true,
    case: publicCase
  });
});

app.get("*", (req, res) => {
  res.sendFile(path.join(__dirname, "../client/index.html"));
});

app.listen(PORT, () => {
  console.log(`Server is running on port ${PORT}`);
});
