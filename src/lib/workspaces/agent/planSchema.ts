import { z } from "zod";

export const agentPlanSchema = z.object({
  filesToModify: z.array(z.string().min(1)).min(1).max(20),
  intendedResult: z.string().min(1).max(1000),
  risks: z.array(z.string().min(1)).max(10),
  validationCommands: z.array(z.string().min(1)).max(10),
});

export type AgentPlan = z.infer<typeof agentPlanSchema>;

/** Extracts the last fenced ```json block from the model's plan-run answer and validates it. */
export function extractPlanFromText(text: string): AgentPlan | null {
  const matches = [...text.matchAll(/```json\s*([\s\S]*?)```/g)];
  if (matches.length === 0) return null;
  const raw = matches[matches.length - 1][1];
  try {
    const parsed = JSON.parse(raw);
    const result = agentPlanSchema.safeParse(parsed);
    return result.success ? result.data : null;
  } catch {
    return null;
  }
}

export const PLAN_PROMPT_SUFFIX = `

When you have finished reading the relevant files, end your response with a single fenced JSON code block (\`\`\`json ... \`\`\`) matching exactly this shape - no other text after it:
{
  "filesToModify": ["relative/path/one.tsx"],
  "intendedResult": "One or two sentences describing the end state after the change.",
  "risks": ["Any risk or ambiguity worth flagging, or an empty array if none."],
  "validationCommands": ["npm run lint", "npx tsc --noEmit", "npm run build"]
}`;
