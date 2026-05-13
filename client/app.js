const generateBtn = document.getElementById("generateBtn");

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

    const generatedCase = data.case;

    document.getElementById("department").textContent = generatedCase.department;
    document.getElementById("caseDifficulty").textContent = generatedCase.difficulty;
    document.getElementById("patientInfo").textContent =
      `${generatedCase.patientProfile.gender}，${generatedCase.patientProfile.age} 岁，${generatedCase.patientProfile.occupation}`;
    document.getElementById("chiefComplaint").textContent = generatedCase.chiefComplaint;
    document.getElementById("openingStatement").textContent = generatedCase.openingStatement;

    document.getElementById("caseResult").style.display = "block";
  } catch (error) {
    console.error(error);
    alert("请求失败，请检查服务是否启动");
  } finally {
    generateBtn.disabled = false;
    generateBtn.textContent = "生成病例";
  }
});
