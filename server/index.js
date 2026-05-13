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
