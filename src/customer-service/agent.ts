import { CUSTOMER_SERVICE_KNOWLEDGE } from "./knowledge";

export type CustomerServiceRequest = {
  message: string;
};

type OpenAIResponse = {
  output?: Array<{
    content?: Array<{
      type?: string;
      text?: string;
    }>;
  }>;
};

const SYSTEM_PROMPT = `
You are Vivid Novel's customer-service concierge for bespoke jewelry inquiries.

Use only the approved knowledge below for factual claims about Vivid Novel. Follow
its conversation guidance and guardrails. Do not guess. When information is not
approved, say that the Vivid Novel team needs to confirm it, then collect the next
one or two useful details. Respond only with the customer-facing reply; do not add
labels, analysis, or notes.

${CUSTOMER_SERVICE_KNOWLEDGE}
`;

export async function generateCustomerServiceReply(
  input: CustomerServiceRequest
): Promise<string> {
  const apiKey = process.env.OPENAI_API_KEY;

  if (!apiKey) {
    throw new Error("OPENAI_API_KEY is not configured");
  }

  const model = process.env.OPENAI_MODEL || "gpt-5";
  const response = await fetch("https://api.openai.com/v1/responses", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model,
      input: [
        {
          role: "system",
          content: SYSTEM_PROMPT,
        },
        {
          role: "user",
          content: input.message,
        },
      ],
      max_output_tokens: 500,
    }),
  });

  if (!response.ok) {
    const detail = await response.text();
    throw new Error(
      `OpenAI request failed (${response.status}): ${detail.slice(0, 500)}`
    );
  }

  const data = (await response.json()) as OpenAIResponse;
  const reply = data.output
    ?.flatMap((item) => item.content ?? [])
    .find((part) => part.type === "output_text")
    ?.text?.trim();

  if (!reply) {
    throw new Error("OpenAI returned no customer-service reply");
  }

  return reply;
}

