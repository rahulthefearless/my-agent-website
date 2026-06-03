const GEMINI_URL =
  "https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent";

export async function askAgent(userMessage, memory, geminiKey) {
  const { profile, scenarios, convTraining } = memory;

  const scenarioBank = (scenarios || [])
    .slice(-15)
    .map(
      (s) =>
        `SITUATION: ${s.situation}\nMY DECISION: ${s.decision}\nMY REASONING: ${s.reasoning || "N/A"}`
    )
    .join("\n\n---\n\n");

  const convBank = (convTraining || [])
    .slice(-10)
    .map((c) => {
      const turns = c.turns
        .map(
          (t) =>
            `  ${t.speaker === "me" ? "ME" : t.speaker.toUpperCase()}: ${t.message}${t.myTone ? ` [tone: ${t.myTone}]` : ""}${t.myReaction ? ` [inner reaction: ${t.myReaction}]` : ""}`
        )
        .join("\n");
      return `CONTEXT: ${c.context}\nCONVERSATION:\n${turns}\nOUTCOME: ${c.outcome || "N/A"}`;
    })
    .join("\n\n===\n\n");

  const prompt = `You are a personal AI agent built to think, speak, and react exactly like ${profile.name || "the user"}.

YOUR PERSONALITY:
${profile.style || "Direct, decisive, real."}

YOUR CORE TRAITS:
${(profile.traits || []).join(", ") || "Still learning — infer from examples."}

REAL DECISION EXAMPLES (how I handle situations):
${scenarioBank || "No scenarios yet — be honest you are still learning."}

REAL CONVERSATION EXAMPLES (how I actually talk and react):
${convBank || "No conversation training yet."}

RULES:
- Respond AS the user in first person ("I would...", "My reaction would be...")
- Mirror their EXACT tone, vocabulary, and emotional patterns from examples
- For social/emotional situations draw from conversation training
- Be specific and real — not generic advice
- End with the actual words they'd say or the action they'd take

USER QUESTION: ${userMessage}`;

  const response = await fetch(`${GEMINI_URL}?key=${geminiKey}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      contents: [{ parts: [{ text: prompt }] }],
      generationConfig: { maxOutputTokens: 1000, temperature: 0.8 },
    }),
  });

  const data = await response.json();
  if (data.error) throw new Error(data.error.message);
  return data.candidates?.[0]?.content?.parts?.[0]?.text || "No response generated.";
}
