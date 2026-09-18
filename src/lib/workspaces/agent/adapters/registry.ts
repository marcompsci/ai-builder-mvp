import { claudeCodeAdapter } from "./claudeCodeAdapter";
import { codexAdapter } from "./codexAdapter";
import type { CodingAgent, Provider } from "../types";

const adapters: Record<Provider, CodingAgent> = {
  "claude-code": claudeCodeAdapter,
  codex: codexAdapter,
};

export function getAdapter(provider: Provider): CodingAgent {
  return adapters[provider];
}
