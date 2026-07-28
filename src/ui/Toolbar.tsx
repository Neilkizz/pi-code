import React from "react";
import type { ThinkingLevel } from "../rpc/types";

interface Props {
  model: string;
  thinking: string;
  isStreaming: boolean;
  onAbort: () => void;
  onCycleModel: (direction: "next" | "prev") => void;
  onSetThinking: (level: ThinkingLevel) => void;
  gitBranch?: string;
  gitChanges?: string;
}

const LEVELS: ThinkingLevel[] = ["off", "minimal", "low", "medium", "high", "xhigh", "max"];

export function Toolbar({ model, thinking, isStreaming, onAbort, onCycleModel, onSetThinking, gitBranch, gitChanges }: Props) {
  return (
    <div className="toolbar">
      <span style={{ fontWeight: 600 }}>Pi</span>

      {gitBranch && (
        <span style={{ color: "var(--git-branch, var(--text-muted))", fontSize: 11, marginLeft: 6 }}>
          {gitBranch} {gitChanges && <span style={{ opacity: 0.7 }}>{gitChanges}</span>}
        </span>
      )}

      <span className="spacer" />

      <label style={{ color: "var(--text-muted)" }}>Model:</label>
      <button onClick={() => onCycleModel("prev")} title="Previous model">◀</button>
      <button onClick={() => onCycleModel("next")} title="Next model" style={{ marginRight: 8 }}>
        {model || "—"}
      </button>

      <label style={{ color: "var(--text-muted)" }}>Thinking:</label>
      <select
        value={thinking}
        onChange={(e) => onSetThinking(e.target.value as ThinkingLevel)}
      >
        {LEVELS.map((l) => (
          <option key={l} value={l}>{l}</option>
        ))}
      </select>

      {isStreaming && (
        <button className="danger" onClick={onAbort} title="Abort current turn">
          Abort
        </button>
      )}
    </div>
  );
}