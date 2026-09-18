import { describe, expect, it } from "vitest";
import { APPLY_POLICY, PLAN_POLICY } from "@/lib/workspaces/agent/policy";
import { agentPlanSchema, extractPlanFromText } from "@/lib/workspaces/agent/planSchema";

const NEVER_ALLOWED = ["Bash", "WebFetch", "WebSearch", "Task", "NotebookEdit"];
const NATIVE_FILE_TOOLS = ["Read", "Grep", "Glob", "Edit", "Write"];

describe("agent permission policy", () => {
  it("denies Bash, WebFetch, WebSearch, Task, and NotebookEdit in the plan phase", () => {
    for (const tool of NEVER_ALLOWED) {
      expect(PLAN_POLICY.disallowedTools).toContain(tool);
      expect(PLAN_POLICY.allowedTools).not.toContain(tool);
    }
  });

  it("denies Bash, WebFetch, WebSearch, Task, and NotebookEdit in the apply phase", () => {
    for (const tool of NEVER_ALLOWED) {
      expect(APPLY_POLICY.disallowedTools).toContain(tool);
      expect(APPLY_POLICY.allowedTools).not.toContain(tool);
    }
  });

  it("plan phase cannot write files even if plan-mode itself had a gap (defense in depth)", () => {
    expect(PLAN_POLICY.disallowedTools).toContain("Edit");
    expect(PLAN_POLICY.disallowedTools).toContain("Write");
  });

  it("disallows the SDK's native filesystem tools in both phases - all file access goes through Project Files MCP", () => {
    for (const tool of NATIVE_FILE_TOOLS) {
      expect(PLAN_POLICY.disallowedTools).toContain(tool);
      expect(APPLY_POLICY.disallowedTools).toContain(tool);
    }
  });

  it("only allows read-only MCP tools in the plan phase - write_project_file is absent", () => {
    expect((PLAN_POLICY.allowedTools ?? []).every((t) => t !== "mcp__project-files__write_project_file")).toBe(true);
    expect(PLAN_POLICY.disallowedTools).toContain("mcp__project-files__write_project_file");
  });

  it("allows write_project_file only in the apply phase", () => {
    expect(APPLY_POLICY.allowedTools).toContain("mcp__project-files__write_project_file");
  });

  it("caps turns so a run cannot loop forever", () => {
    expect(PLAN_POLICY.maxTurns).toBeGreaterThan(0);
    expect(APPLY_POLICY.maxTurns).toBeGreaterThan(0);
  });
});

describe("extractPlanFromText", () => {
  const validPlan = {
    filesToModify: ["src/app/page.tsx"],
    intendedResult: "Shorten the headline",
    risks: [],
    validationCommands: ["npm run lint"],
  };

  it("extracts and validates a well-formed trailing JSON block", () => {
    const text = `I read the file.\n\n\`\`\`json\n${JSON.stringify(validPlan)}\n\`\`\``;
    expect(extractPlanFromText(text)).toEqual(validPlan);
  });

  it("uses the LAST fenced json block if the model produced more than one", () => {
    const other = { ...validPlan, intendedResult: "wrong" };
    const text = `\`\`\`json\n${JSON.stringify(other)}\n\`\`\`\nActually:\n\`\`\`json\n${JSON.stringify(validPlan)}\n\`\`\``;
    expect(extractPlanFromText(text)?.intendedResult).toBe("Shorten the headline");
  });

  it("returns null when there is no fenced json block", () => {
    expect(extractPlanFromText("I looked at the files but did not produce a plan.")).toBeNull();
  });

  it("returns null when the JSON doesn't match the schema", () => {
    const text = "```json\n{\"foo\": \"bar\"}\n```";
    expect(extractPlanFromText(text)).toBeNull();
  });

  it("returns null on malformed JSON", () => {
    const text = "```json\n{not valid json\n```";
    expect(extractPlanFromText(text)).toBeNull();
  });

  it("schema rejects an empty filesToModify list", () => {
    const result = agentPlanSchema.safeParse({ ...validPlan, filesToModify: [] });
    expect(result.success).toBe(false);
  });
});
