function normalizeConversation(conversationHistory = []) {
  return conversationHistory
    .map((item, index) => {
      const role = item.role || item.sender || item.type || "unknown";
      const content = item.content || item.text || item.message || "";
      return `${index + 1}. ${role}: ${content}`;
    })
    .join("\n");
}

function safeJsonParse(text) {
  try {
    return JSON.parse(text);
  } catch (error) {
    const cleaned = text
      .replace(/```json/g, "")
      .replace(/```/g, "")
      .trim();

    return JSON.parse(cleaned);
  }
}

async function deepseekScoreInterview({
  currentCase,
  conversationHistory,
  studentDiagnosis,
  ruleResult
}) {
  const apiKey = process.env.DEEPSEEK_API_KEY;

  if (!apiKey) {
    throw new Error("缺少 DEEPSEEK_API_KEY，请检查 .env 或 Render 环境变量");
  }

  const model = process.env.DEEPSEEK_MODEL || "deepseek-v4-flash";

  const compactCase = {
    caseId: currentCase.caseId,
    department: currentCase.department,
    difficulty: currentCase.difficulty,
    patientProfile: currentCase.patientProfile,
    chiefComplaint: currentCase.chiefComplaint,
    finalDiagnosis: currentCase.finalDiagnosis,
    hiddenInfo: currentCase.hiddenInfo,
    mustAskItems: currentCase.mustAskItems,
    scoringRubric: currentCase.scoringRubric
  };

  const conversationText = normalizeConversation(conversationHistory);

  const systemPrompt = `
你是肾内科问诊训练的评分教师。
你的任务是根据病例标准答案、问诊对话、学生诊断和规则评分结果，对学生表现进行评分和反馈。

重要要求：
1. 必须输出严格 JSON，不要输出 Markdown，不要输出解释性废话。
2. 不要编造病例中不存在的信息。
3. 规则评分是客观基础，DeepSeek 评分主要用于补充诊断思路、人文沟通、遗漏原因分析。
4. 如果你调整总分，调整幅度通常不要超过 10 分，除非对话中有明显严重问题。
5. 评分应适合医学教学场景，语气清楚、具体、可改进。
6. 必须使用中文。
`;

  const userPrompt = `
请根据下面信息进行问诊评分，并输出 json。

【病例标准信息】
${JSON.stringify(compactCase, null, 2)}

【问诊对话】
${conversationText || "暂无对话"}

【学生提交的诊断】
${studentDiagnosis || "未提交"}

【规则版评分结果】
${JSON.stringify(ruleResult || {}, null, 2)}

请输出如下 JSON 格式：

{
  "totalScore": 85,
  "scoreLevel": "良好",
  "ruleScoreComment": "规则评分显示学生覆盖了主要问诊点，但仍有部分遗漏。",
  "dimensions": {
    "historyTaking": {
      "score": 40,
      "maxScore": 50,
      "comment": "对主要症状追问较充分，但诱因和用药史不足。"
    },
    "clinicalReasoning": {
      "score": 24,
      "maxScore": 30,
      "comment": "诊断方向基本正确，但鉴别诊断不够完整。"
    },
    "communication": {
      "score": 16,
      "maxScore": 20,
      "comment": "沟通较自然，但缺少总结和安抚。"
    }
  },
  "coveredItems": ["已询问水肿", "已询问尿量变化"],
  "missedItems": ["未询问用药史", "未询问感染诱因"],
  "diagnosisFeedback": "学生诊断方向基本正确。",
  "mainProblems": ["问诊顺序略跳跃", "危险因素追问不足"],
  "teacherComment": "整体表现良好，建议下次按照现病史、既往史、用药史、家族史的顺序进行。",
  "nextPracticeAdvice": "下次重点练习药物史、诱因、危险信号和鉴别诊断。"
}
`;

  const response = await fetch("https://api.deepseek.com/chat/completions", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Authorization": `Bearer ${apiKey}`
    },
    body: JSON.stringify({
      model,
      messages: [
        {
          role: "system",
          content: systemPrompt
        },
        {
          role: "user",
          content: userPrompt
        }
      ],
      response_format: {
        type: "json_object"
      },
      temperature: 0.2,
      max_tokens: 1800,
      stream: false
    })
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`DeepSeek API 请求失败：${response.status} ${errorText}`);
  }

  const data = await response.json();
  const content = data.choices?.[0]?.message?.content;

  if (!content) {
    throw new Error("DeepSeek 没有返回评分内容");
  }

  return safeJsonParse(content);
}

module.exports = {
  deepseekScoreInterview
};
