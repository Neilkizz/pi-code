import * as path from 'path';

/**
 * Security validation helpers for path safety and sensitive-file detection.
 *
 * These are applied at the extension layer — the pi CLI also has its own
 * path controls, but defense-in-depth requires the extension to validate
 * before forwarding any file path it received from the subprocess.
 */

/** Normalize a file path and verify it stays within the workspace root. */
export function resolveSafePath(filePath: string, workspaceRoot?: string): string | null {
  // Guard against empty or non-string input.
  if (!filePath || typeof filePath !== 'string') return null;
  const normalized = path.normalize(filePath);
  // If no workspace root is set, allow any properly normalized path.
  if (!workspaceRoot) return normalized;
  const resolved = path.resolve(workspaceRoot, normalized);
  // Normalize the root for comparison.
  const root = path.resolve(workspaceRoot);
  if (!resolved.startsWith(root + path.sep) && resolved !== root) {
    return null; // path traversal outside workspace
  }
  return resolved;
}

/** Patterns that match files containing secrets or credentials. */
const SENSITIVE_PATTERNS = [
  /\.env(\..*)?$/i,
  /\.pem$/i,
  /\.key$/i,
  /\.pfx$/i,
  /\.p12$/i,
  /credentials/i,
  /\.ssh\//i,
  /\/\.git\/config$/,
  /secret/i,
  /token/i,
  /\.npmrc$/i,
  /\.dockercfg$/i,
  /\.docker\/config\.json$/i,
  /\.aws\/credentials$/i,
  /\.gcloud\/.*\.json$/i,
];

/** Return true if the file path matches a known sensitive-file pattern. */
export function isSensitiveFile(filePath: string): boolean {
  return SENSITIVE_PATTERNS.some((pattern) => pattern.test(filePath));
}

/**
 * Get a set of workspace roots for multi-root validation.
 * Returns an empty array if no workspace is open.
 */
export function getWorkspaceRoots(): string[] {
  // vscode not available at module level — callers must pass roots.
  return [];
}

/** Sensitive patterns for log sanitization. */
const LOG_SENSITIVE_PATTERNS = [
  // API key / token patterns
  /(?:api[-_]?key|apikey|token|secret|password|credential)s?\s*[=:]\s*['"]?[^\s'"]{8,}/gi,
  // OpenAI-style keys
  /sk-[A-Za-z0-9]{32,}/g,
  // Anthropic-style keys
  /sk-ant-[A-Za-z0-9]{32,}/g,
  // Authorization headers
  /authorization\s*:\s*bearer\s+[A-Za-z0-9._-]+/gi,
  // Cookie/Set-Cookie headers
  /cookie\s*:\s*[^\n]+/gi,
];

/**
 * Sanitize a log message by redacting sensitive patterns.
 * Returns the sanitized message with sensitive values replaced by ***.
 */
export function sanitizeLogMessage(msg: string): string {
  let sanitized = msg;
  for (const pattern of LOG_SENSITIVE_PATTERNS) {
    sanitized = sanitized.replace(pattern, (match) => {
      const eqIdx = Math.max(match.indexOf('='), match.indexOf(':'), match.indexOf(' '));
      if (eqIdx >= 0) {
        return match.slice(0, eqIdx + 1) + '***';
      }
      return match.slice(0, Math.min(12, match.length)) + '***';
    });
  }
  return sanitized;
}
