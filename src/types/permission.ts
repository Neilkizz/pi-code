/**
 * Permission mode — single source of truth for all permission-related types.
 *
 * - "readonly": Block all writes. Claude can read files and the workspace but
 *   cannot make any edits or execute commands.
 * - "plan": Read-only exploration. Same as readonly but intended for upfront
 *   architectural planning phases.
 * - "manual": Confirm each sensitive command. Safe commands auto-execute.
 * - "auto": Auto-allow safe and sensitive commands; prompt for dangerous ones.
 *   This is the default mode.
 * - "bypass": Hidden mode that skips all permission checks. Not exposed in the
 *   UI or package.json schema.
 */
export type PermissionMode = 'readonly' | 'plan' | 'manual' | 'auto' | 'bypass';

/** Human-readable labels for each mode (used in UI). */
export const PERMISSION_MODE_LABELS: Record<PermissionMode, string> = {
  readonly: 'Read-only',
  plan: 'Plan',
  manual: 'Manual',
  auto: 'Auto',
  bypass: 'Bypass',
};

/** All valid modes (including hidden bypass) for runtime validation. */
export const ALL_PERMISSION_MODES: readonly PermissionMode[] = [
  'readonly',
  'plan',
  'manual',
  'auto',
  'bypass',
];

/** Modes exposed in the UI (bypass is hidden). */
export const UI_PERMISSION_MODES: readonly PermissionMode[] = [
  'readonly',
  'plan',
  'manual',
  'auto',
];
