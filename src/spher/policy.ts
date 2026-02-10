export type ActionIntent = "read_only" | "mutating";

const MUTATION_PATTERNS: RegExp[] = [
  /\bgit\s+(add|commit|push|merge|rebase|checkout|switch|tag)\b/i,
  /\b(pip|python\s+-m\s+pip)\s+(install|uninstall)\b/i,
  /\bcargo\s+(add|update|fix|fmt)\b/i,
  /\bcargo\s+clippy\s+--fix\b/i,
  /\b(npm\s+(install|update)|pnpm\s+add|yarn\s+add)\b/i,
  /\bruff\s+check\s+--fix\b/i,
  /\bblack\b/i,
  /\b(rm|del|rmdir|mv|cp|move|copy)\b/i,
  /\bsed\s+-i\b/i
];

export function classifyIntent(actionText: string): ActionIntent {
  const text = actionText.trim();
  if (!text) {
    return "read_only";
  }
  for (const pattern of MUTATION_PATTERNS) {
    if (pattern.test(text)) {
      return "mutating";
    }
  }
  return "read_only";
}

export function shouldFailClosed(strictMode: boolean, uncertain: boolean): boolean {
  return strictMode && uncertain;
}
