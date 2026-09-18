// Best-effort, heuristic redaction applied to search-result snippets before
// they're returned to the model. This is defense in depth, NOT a guarantee
// - the primary defense against secret exposure is that .env/keys/etc. are
// never in the readable extension/filename allowlist in the first place
// (see SENSITIVE_FILENAME_PATTERNS). This catches the separate case of a
// secret-shaped value accidentally present in an otherwise-allowed file.

const SECRET_VALUE_PATTERNS: RegExp[] = [
  /sk-[a-zA-Z0-9_-]{10,}/g, // OpenAI/Anthropic-style API keys
  /gh[pousr]_[a-zA-Z0-9]{20,}/g, // GitHub tokens (ghp_, gho_, ghu_, ghs_, ghr_)
  /AKIA[0-9A-Z]{12,}/g, // AWS access key id
  /-----BEGIN [A-Z ]*PRIVATE KEY-----/g,
  /(api[_-]?key|secret|token|password)\s*[:=]\s*["']?[a-zA-Z0-9_\-/+=]{12,}["']?/gi,
];

export function redactSecrets(text: string): string {
  let out = text;
  for (const pattern of SECRET_VALUE_PATTERNS) {
    out = out.replace(pattern, "[redacted]");
  }
  return out;
}
