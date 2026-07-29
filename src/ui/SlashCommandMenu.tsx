import React, { useCallback } from 'react';

/** Hard-coded Pi slash commands from pi.dev/docs/latest/usage */
const COMMANDS: { cmd: string; desc: string }[] = [
  { cmd: '/login', desc: 'Manage provider credentials' },
  { cmd: '/logout', desc: 'Log out provider' },
  { cmd: '/model', desc: 'Switch models' },
  { cmd: '/scoped-models', desc: 'Enable/disable models for Ctrl+P cycling' },
  { cmd: '/settings', desc: 'Thinking level, theme, message delivery, transport' },
  { cmd: '/resume', desc: 'Pick from previous sessions' },
  { cmd: '/new', desc: 'Start a new session' },
  { cmd: '/name', desc: 'Set session display name' },
  { cmd: '/session', desc: 'Show session info' },
  { cmd: '/tree', desc: 'Jump to any point in the session' },
  { cmd: '/trust', desc: 'Save project trust decision' },
  { cmd: '/fork', desc: 'Create a new session from a previous user message' },
  { cmd: '/clone', desc: 'Duplicate current session into a new session' },
  { cmd: '/compact', desc: 'Manually compact context' },
  { cmd: '/copy', desc: 'Copy last assistant message to clipboard' },
  { cmd: '/export', desc: 'Export session to HTML or JSONL' },
  { cmd: '/import', desc: 'Import and resume a session from JSONL' },
  { cmd: '/share', desc: 'Upload as private GitHub gist' },
  { cmd: '/reload', desc: 'Reload keybindings, extensions, skills, prompts, themes' },
  { cmd: '/hotkeys', desc: 'Show all keyboard shortcuts' },
  { cmd: '/changelog', desc: 'Display version history' },
  { cmd: '/quit', desc: 'Quit pi' },
];

interface Props {
  /** Text typed after the `/` — used to filter commands. */
  filter: string;
  /** Called when user picks a slash command. The command text (e.g. "/login") is returned. */
  onPick: (cmd: string) => void;
  onClose: () => void;
}

export function SlashCommandMenu({ filter, onPick, onClose }: Props) {
  const filtered = COMMANDS.filter(
    (c) =>
      c.cmd.includes(filter.toLowerCase()) || c.desc.toLowerCase().includes(filter.toLowerCase()),
  );

  const handleKey = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === 'Escape') {
        onClose();
      } else if (e.key === 'Enter' && filtered.length > 0) {
        onPick(filtered[0].cmd);
      }
    },
    [filtered, onPick, onClose],
  );

  return (
    <div className="autocomplete-popup" onKeyDown={handleKey}>
      {filtered.slice(0, 10).map((c) => (
        <div
          key={c.cmd}
          className="autocomplete-item"
          onClick={() => onPick(c.cmd)}
          style={{ display: 'flex', justifyContent: 'space-between' }}
        >
          <span style={{ fontWeight: 600, fontFamily: 'var(--mono)' }}>{c.cmd}</span>
          <span style={{ color: 'var(--text-muted)', marginLeft: 12 }}>{c.desc}</span>
        </div>
      ))}
      {filtered.length === 0 && (
        <div className="autocomplete-item" style={{ color: 'var(--text-muted)' }}>
          No matching commands
        </div>
      )}
    </div>
  );
}
