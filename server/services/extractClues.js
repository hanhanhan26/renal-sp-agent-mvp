async function extractCluesFromPatientText(patientText) {
  const prompt = `
你是一个医学问诊训练系统中的“结构化信息提取器”。

你的任务：
从患者说的话中提取临床线索，填入固定字段。

重要规则：
1. 只根据患者原话提取，不要凭空补充。
2. 一句话里可以提取多个线索。
3. 如果没有提到，就写 null。
4. 不要输出解释，不要输出 Markdown，只输出 JSON。
5. “发热”可以同时属于发热线索，也可以提示感染相关线索。
6. “小便又急又痛”应提取为尿急、尿痛。
7. “腰两边疼”应提取为腰痛或肾区疼痛。
8. “最高 39 度多”应提取为高热，也属于危险信号。

固定输出格式如下：

{
  "chiefComplaint": {
    "value": "",
    "evidence": ""
  },
  "fever": {
    "value": "",
    "evidence": ""
  },
  "flankPain": {
    "value": "",
    "evidence": ""
  },
  "urinarySymptoms": {
    "value": "",
    "evidence": ""
  },
  "urineVolume": {
    "value": null,
    "evidence": null
  },
  "edema": {
    "value": null,
    "evidence": null
  },
  "hematuria": {
    "value": null,
    "evidence": null
  },
  "medicationHistory": {
    "value": null,
    "evidence": null
  },
  "infectionClue": {
    "value": "",
    "evidence": ""
  },
  "pastHistory": {
    "value": null,
    "evidence": null
  },
  "familyHistory": {
    "value": null,
    "evidence": null
  },
  "dangerSigns": {
    "value": "",
    "evidence": ""
  }
}

患者原话：
${patientText}
`;

  const response = await fetch("https://api.deepseek.com/chat/completions", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Authorization": `Bearer ${process.env.DEEPSEEK_API_KEY}`
    },
    body: JSON.stringify({
      model: "deepseek-chat",
      messages: [
        {
          role: "system",
          content: "你只负责从患者原话中提取结构化临床线索。"
        },
        {
          role: "user",
          content: prompt
        }
      ],
      temperature: 0.1
    })
  });

  const data = await response.json();
  const content = data.choices[0].message.content;

  try {
    return JSON.parse(content);
  } catch (error) {
    console.error("线索提取 JSON 解析失败：", content);
    return null;
  }
}

module.exports = {
  extractCluesFromPatientText
};
