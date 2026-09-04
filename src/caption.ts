export type CaptionRequest = {
  product?: string;
  story?: string;
  audience?: string;
  format?: "reel" | "carousel" | "photo";
  callToAction?: string;
};

const SYSTEM_PROMPT = `
You write Instagram captions for Vivid Novel, a bespoke jewelry brand creating
sentimental, personalized pieces, including custom pet portrait jewelry.

Brand voice:
- refined
- warm
- artistic
- intimate
- premium
- emotionally meaningful
- never overly salesy

The brand should feel like fine jewelry with a deeply personal story.

Do not:
- mention competitors
- copy competitors
- claim that Vivid Novel invented a jewelry category
- make unverifiable claims
- use excessive emojis
- sound like generic AI marketing

Write naturally for Instagram.

Return only the caption text.
Include a soft, natural call to action.
`;

export async function generateCaption(
  input: CaptionRequest
): Promise<string> {
  const apiKey = process.env.OPENAI_API_KEY;

  // Temporary fallback so the service still works
  // even before the OpenAI API key is configured.
  if (!apiKey) {
    return fallbackCaption(input);
  }

  const model = process.env.OPENAI_MODEL || "gpt-5";

  const userPrompt = `
Product:
${input.product || "bespoke jewelry"}

Story/details:
${input.story || "Create an emotional story around a meaningful piece."}

Target audience:
${input.audience || "women who value fine jewelry, personalization and meaningful memories"}

Post format:
${input.format || "photo"}

Preferred call to action:
${
  input.callToAction ||
  "Invite the reader to message Vivid Novel to discuss a custom piece."
}

Write one polished Instagram caption.

Keep it under 180 words.
Make the opening line attention-grabbing.
Make the emotional story feel genuine rather than exaggerated.
End with a clear but soft call to action.
`;

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
          content: userPrompt,
        },
      ],
      max_output_tokens: 300,
    }),
  });

  if (!response.ok) {
    const detail = await response.text();

    throw new Error(
      `OpenAI request failed (${response.status}): ${detail.slice(0, 500)}`
    );
  }

  const data = (await response.json()) as {
    output_text?: string;
  };

  const caption = data.output_text?.trim();

  if (!caption) {
    throw new Error("OpenAI returned no caption text");
  }

  return caption;
}

function fallbackCaption(input: CaptionRequest): string {
  const product = input.product || "a bespoke piece";
  const story = input.story || "a story worth keeping close";
  const callToAction =
    input.callToAction ||
    "Send us a message to begin your own piece.";

  return `${product}, made around ${story}.

At Vivid Novel, we believe the most meaningful jewelry is personal — something made to hold a memory, not simply follow a trend.

${callToAction}`;
}
