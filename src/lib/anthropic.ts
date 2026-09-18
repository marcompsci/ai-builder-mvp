import Anthropic from "@anthropic-ai/sdk";
import { generatedSiteSchema, type GeneratedSite, type Style } from "@/lib/schema";

export class GenerationError extends Error {
  constructor(
    message: string,
    readonly cause?: unknown,
  ) {
    super(message);
    this.name = "GenerationError";
  }
}

const STYLE_GUIDANCE: Record<Style, string> = {
  minimal:
    "Minimal: restrained copy, generous whitespace implied, a neutral/monochrome palette (near-black text, white/off-white background, one muted accent).",
  premium:
    "Premium: confident, polished copy, a dark or deep-toned palette with a gold/champagne or jewel-tone accent, evokes quality and exclusivity.",
  playful:
    "Playful: energetic, friendly copy, a bright and saturated palette with high contrast, feels fun and approachable.",
  bold:
    "Bold: punchy, high-impact copy, a high-contrast palette (strong dark/light or saturated primary colors), feels loud and confident.",
};

// The tool's input_schema constrains the model's response shape at the API
// level. This tool is never executed against anything — it only exists to
// force structured JSON output. The model is given no other tools, so it
// cannot write files, run commands, reach MCPs, or trigger any action.
const EMIT_LANDING_PAGE_TOOL: Anthropic.Tool = {
  name: "emit_landing_page",
  description: "Return the generated landing page content and color palette.",
  input_schema: {
    type: "object",
    properties: {
      headline: { type: "string" },
      subheadline: { type: "string" },
      cta: { type: "string", description: "Call-to-action button label" },
      features: {
        type: "array",
        minItems: 3,
        maxItems: 3,
        items: {
          type: "object",
          properties: {
            title: { type: "string" },
            description: { type: "string" },
          },
          required: ["title", "description"],
        },
      },
      testimonial: {
        type: "object",
        properties: {
          quote: { type: "string" },
          author: { type: "string" },
        },
        required: ["quote", "author"],
      },
      colorPalette: {
        type: "object",
        properties: {
          primary: { type: "string", description: "Hex color, e.g. #1a1a1a" },
          secondary: { type: "string", description: "Hex color" },
          accent: { type: "string", description: "Hex color" },
          background: { type: "string", description: "Hex color" },
          text: { type: "string", description: "Hex color" },
        },
        required: ["primary", "secondary", "accent", "background", "text"],
      },
    },
    required: ["headline", "subheadline", "cta", "features", "testimonial", "colorPalette"],
  },
};

let client: Anthropic | null = null;

function getClient(): Anthropic {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    throw new GenerationError(
      "ANTHROPIC_API_KEY is not set. Add it to .env.local (see .env.example).",
    );
  }
  if (!client) {
    client = new Anthropic({ apiKey });
  }
  return client;
}

export async function generateSite(prompt: string, style: Style): Promise<GeneratedSite> {
  const anthropic = getClient();
  const model = process.env.ANTHROPIC_MODEL || "claude-sonnet-5";

  let response: Anthropic.Message;
  try {
    response = await anthropic.messages.create({
      model,
      max_tokens: 1500,
      system:
        "You write landing page copy and pick a matching color palette for a website builder preview. " +
        "Call the emit_landing_page tool exactly once with your result. Do not include any other text.",
      messages: [
        {
          role: "user",
          content:
            `Website description: ${prompt}\n\n` +
            `Visual style: ${STYLE_GUIDANCE[style]}\n\n` +
            "Write a headline, subheadline, a short call-to-action label, exactly three feature cards, " +
            "one testimonial (quote + author), and a 5-color hex palette (primary, secondary, accent, " +
            "background, text) that fits the requested style.",
        },
      ],
      tools: [EMIT_LANDING_PAGE_TOOL],
      tool_choice: { type: "tool", name: "emit_landing_page" },
    });
  } catch (err) {
    throw new GenerationError("The generation request to the model failed.", err);
  }

  const toolUse = response.content.find(
    (block): block is Anthropic.ToolUseBlock => block.type === "tool_use",
  );
  if (!toolUse) {
    throw new GenerationError("The model did not return structured output.");
  }

  const parsed = generatedSiteSchema.safeParse(toolUse.input);
  if (!parsed.success) {
    throw new GenerationError("The model's output did not match the expected shape.", parsed.error);
  }

  return parsed.data;
}
