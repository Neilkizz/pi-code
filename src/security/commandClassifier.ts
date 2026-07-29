/**
 * Command classifier — classifies terminal commands by risk level.
 *
 * Token-based pattern matching. Trivially bypassed by compound commands,
 * base64-encoded payloads, or scripts. **This is a best-effort UX guardrail,
 * not a security boundary.**
 *
 * Applied in ChatProvider.dispatch() before forwarding commands to the pi CLI.
 * The classification feeds into PermissionMode enforcement:
 * - dangerous → always warn (except bypass mode)
 * - sensitive → only warn in manual mode
 * - safe → allow unconditionally
 */

export type CommandRisk = 'safe' | 'sensitive' | 'dangerous';

export interface Classification {
  risk: CommandRisk;
  reason?: string;
}

// ---------------------------------------------------------------------------
// Dangerous patterns — always warn regardless of mode (except bypass)
// ---------------------------------------------------------------------------

const DANGEROUS_PATTERNS: { regex: RegExp; reason: string }[] = [
  { regex: /rm\s+(-[rf]+\s+)?\/$|rm\s+-rf\s+\/\s*$/i, reason: 'Recursive root delete' },
  { regex: /^sudo\s+/, reason: 'Sudo command' },
  { regex: /chmod\s+777/i, reason: 'World-writable permissions' },
  { regex: /^dd\s+/, reason: 'Raw disk write' },
  { regex: /^mkfs/, reason: 'Filesystem creation' },
  { regex: /git\s+push\s+--force/, reason: 'Force push' },
  { regex: /(\|)\s*(curl|wget)\s+.*(\||\s*sh\s*)/i, reason: 'Pipe fetch to shell' },
];

// ---------------------------------------------------------------------------
// Sensitive patterns — warn only in manual mode
// ---------------------------------------------------------------------------

const SENSITIVE_PATTERNS: { regex: RegExp; reason: string }[] = [
  { regex: /^rm\s+/, reason: 'File deletion' },
  { regex: /^mv\s+/, reason: 'File move' },
  { regex: /^chmod|^chown/, reason: 'Permission change' },
  { regex: /docker\s+rm\s+|docker\s+stop\s+/, reason: 'Container management' },
  { regex: /git\s+reset\s+|git\s+rebase\s+/, reason: 'Git history rewrite' },
  { regex: /npm\s+publish|pip\s+install/, reason: 'Package management' },
];

// ---------------------------------------------------------------------------
// Classifier
// ---------------------------------------------------------------------------

/**
 * Classify a command string by risk level.
 * Returns the highest applicable risk level with an explanatory reason.
 */
export function classifyCommand(cmd: string): Classification {
  const trimmed = cmd.trim();
  for (const p of DANGEROUS_PATTERNS) {
    if (p.regex.test(trimmed)) return { risk: 'dangerous', reason: p.reason };
  }
  for (const p of SENSITIVE_PATTERNS) {
    if (p.regex.test(trimmed)) return { risk: 'sensitive', reason: p.reason };
  }
  return { risk: 'safe' };
}
