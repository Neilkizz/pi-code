import React from 'react';
import { MentionsAutocomplete } from './MentionsAutocomplete';
import { SlashCommandMenu } from './SlashCommandMenu';
import { ModesMenu, type PermissionMode, type EffortLevel } from './ModesMenu';
import { ActionsMenu } from './ActionsMenu';
import { HeaderBar, type SessionItem } from './HeaderBar';

interface AttachedFile {
  name: string;
  isImage: boolean;
  size?: string;
}

interface InputAreaProps {
  onSend: (text: string) => void;
  disabled: boolean;
  suggestions: string[];
  model: string;
  onCycleModel: (dir: 'next' | 'prev') => void;
  onAbort: () => void;
}

export function InputArea({
  onSend,
  disabled,
  suggestions,
  model,
  onCycleModel,
  onAbort,
}: InputAreaProps) {
  const [text, setText] = React.useState('');
  const [showMentions, setShowMentions] = React.useState(false);
  const [mentionFilter, setMentionFilter] = React.useState('');
  const [showSlash, setShowSlash] = React.useState(false);
  const [slashFilter, setSlashFilter] = React.useState('');

  // Claude Code UI states
  const [mode, setMode] = React.useState<PermissionMode>('auto');
  const [effort, setEffort] = React.useState<EffortLevel>('max');
  const [thinkingEnabled, setThinkingEnabled] = React.useState(true);
  const [flaggedSwitch, setFlaggedSwitch] = React.useState(true);
  const [showModesMenu, setShowModesMenu] = React.useState(false);
  const [showActionsMenu, setShowActionsMenu] = React.useState(false);
  const [attachedFiles, setAttachedFiles] = React.useState<AttachedFile[]>([]);
  const [selectedLineCount, setSelectedLineCount] = React.useState(0);
  const [selectionVisible, setSelectionVisible] = React.useState(true);

  const inputRef = React.useRef<HTMLTextAreaElement>(null);

  const handleChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    const val = e.target.value;
    setText(val);
    const cursor = e.target.selectionStart;
    const beforeCursor = val.slice(0, cursor);
    const slashMatch = beforeCursor.match(/(?:^|\s)\/(\S*)$/);
    if (slashMatch) {
      setSlashFilter(slashMatch[1]);
      setShowSlash(true);
      setShowMentions(false);
      return;
    }
    setShowSlash(false);
    const atMatch = beforeCursor.match(/@(\S*)$/);
    if (atMatch) {
      setMentionFilter(atMatch[1]);
      setShowMentions(true);
    } else setShowMentions(false);
  };

  const handleSend = () => {
    if ((text.trim() || attachedFiles.length > 0) && !disabled) {
      onSend(text);
      setText('');
      setShowMentions(false);
      setShowSlash(false);
      setAttachedFiles([]);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (
      e.key === 'Enter' &&
      !e.shiftKey &&
      !showMentions &&
      !showSlash &&
      !showModesMenu &&
      !showActionsMenu
    ) {
      e.preventDefault();
      handleSend();
    }
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    const files = Array.from(e.dataTransfer.files);
    if (files.length > 0) {
      const file = files[0];
      const isImg = file.type.startsWith('image/') || /\.(png|jpe?g|gif|webp)$/i.test(file.name);
      setAttachedFiles((prev) => [
        ...prev,
        {
          name: file.name,
          isImage: isImg,
          size: isImg ? '872×1512' : `${Math.round(file.size / 1024)}KB`,
        },
      ]);
    } else if (e.dataTransfer.types.includes('text/uri-list')) {
      const uri = e.dataTransfer.getData('text/uri-list');
      if (uri) {
        const name = uri.split('/').pop() || uri;
        setAttachedFiles((prev) => [...prev, { name, isImage: false }]);
      }
    }
    inputRef.current?.focus();
  };

  const removeFile = (idx: number) => {
    setAttachedFiles((prev) => prev.filter((_, i) => i !== idx));
  };

  const insertMention = (value: string) => {
    const cursor = inputRef.current?.selectionStart ?? text.length;
    const atIdx = text.slice(0, cursor).lastIndexOf('@');
    setText(text.slice(0, atIdx) + `@${value} ` + text.slice(cursor));
    setShowMentions(false);
    inputRef.current?.focus();
  };

  const insertSlash = (cmd: string) => {
    const cursor = inputRef.current?.selectionStart ?? text.length;
    const slashIdx = text.slice(0, cursor).lastIndexOf('/');
    setText(text.slice(0, slashIdx) + `${cmd} ` + text.slice(cursor));
    setShowSlash(false);
    if (['/login', '/logout', '/quit', '/compact', '/reload'].includes(cmd)) onSend(cmd);
    else inputRef.current?.focus();
  };

  const handleAction = (action: string) => {
    if (action === 'attach' || action === 'mention') {
      const cursor = inputRef.current?.selectionStart ?? text.length;
      setText(text.slice(0, cursor) + '@' + text.slice(cursor));
      inputRef.current?.focus();
    } else if (action === 'clear') {
      onSend('/compact');
    } else if (action === 'rewind') {
      onSend('/tree');
    } else if (action === 'switchModel') {
      onCycleModel('next');
    }
  };

  const getModeIcon = (m: PermissionMode) => {
    switch (m) {
      case 'manual':
        return '✋';
      case 'readonly':
        return '🛡️';
      case 'plan':
        return '📑';
      case 'auto':
        return '⚡';
      case 'bypass':
        return '⇄';
    }
  };

  const getModeLabel = (m: PermissionMode) => {
    switch (m) {
      case 'manual':
        return 'Manual';
      case 'readonly':
        return 'Read-only';
      case 'plan':
        return 'Plan';
      case 'auto':
        return 'Auto';
      case 'bypass':
        return 'Bypass';
    }
  };

  return (
    <div
      className="input-area"
      onDragOver={(e) => {
        e.preventDefault();
        e.dataTransfer.dropEffect = 'copy';
      }}
      onDrop={handleDrop}
    >
      {showMentions && (
        <MentionsAutocomplete
          filter={mentionFilter}
          suggestions={suggestions}
          onPick={insertMention}
          onClose={() => setShowMentions(false)}
        />
      )}
      {showSlash && (
        <SlashCommandMenu
          filter={slashFilter}
          onPick={insertSlash}
          onClose={() => setShowSlash(false)}
        />
      )}

      {/* Claude Code Rounded Prompt Card */}
      <div className={`claude-input-card ${disabled ? 'disabled' : ''}`}>
        {/* Modes Menu Popup */}
        {showModesMenu && (
          <ModesMenu
            currentMode={mode}
            currentEffort={effort}
            onSelectMode={setMode}
            onSelectEffort={setEffort}
            onClose={() => setShowModesMenu(false)}
          />
        )}

        {/* Actions Menu Popup */}
        {showActionsMenu && (
          <ActionsMenu
            currentModel={model}
            currentEffort={effort}
            thinkingEnabled={thinkingEnabled}
            flaggedModelSwitch={flaggedSwitch}
            onSelectAction={handleAction}
            onToggleThinking={() => setThinkingEnabled(!thinkingEnabled)}
            onToggleFlaggedSwitch={() => setFlaggedSwitch(!flaggedSwitch)}
            onSelectEffort={setEffort}
            onClose={() => setShowActionsMenu(false)}
          />
        )}

        {/* Attached Files Badges & Selection Badge */}
        {(attachedFiles.length > 0 || (selectedLineCount > 0 && selectionVisible)) && (
          <div className="attached-files-row">
            {attachedFiles.map((file, i) => (
              <div key={i} className="attached-file-badge">
                <span className="file-icon">{file.isImage ? '📷' : '📄'}</span>
                <span className="file-name">{file.name}</span>
                {file.size && <span className="file-size">{file.size}</span>}
                <button className="remove-badge-btn" onClick={() => removeFile(i)}>
                  ×
                </button>
              </div>
            ))}
            {selectedLineCount > 0 && selectionVisible && (
              <div className="attached-file-badge selection-badge">
                <span className="file-icon">📄</span>
                <span className="file-name">
                  {selectedLineCount} {selectedLineCount === 1 ? 'line' : 'lines'} selected
                </span>
                <button
                  type="button"
                  className="remove-badge-btn"
                  onClick={() => setSelectionVisible(false)}
                  title="Hide selection context"
                >
                  👁
                </button>
              </div>
            )}
          </div>
        )}

        {/* Textarea */}
        <textarea
          ref={inputRef}
          value={text}
          onChange={handleChange}
          onKeyDown={handleKeyDown}
          placeholder={
            disabled ? 'Claude is thinking…' : 'Ask Claude a question or type / for commands...'
          }
          rows={2}
          disabled={disabled}
        />

        {/* Bottom Toolbar Row inside card */}
        <div className="card-toolbar-row">
          <div className="card-toolbar-left">
            <button
              type="button"
              className="card-icon-btn"
              title="Add context & actions"
              onClick={() => {
                setShowActionsMenu(!showActionsMenu);
                setShowModesMenu(false);
              }}
            >
              +
            </button>
            <button
              type="button"
              className="card-icon-btn"
              title="Mention file or prompt template"
              onClick={() => {
                const cursor = inputRef.current?.selectionStart ?? text.length;
                setText(text.slice(0, cursor) + '@' + text.slice(cursor));
                inputRef.current?.focus();
              }}
            >
              <svg
                width="14"
                height="14"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
              >
                <rect x="3" y="3" width="18" height="18" rx="2" ry="2" />
                <line x1="9" y1="3" x2="9" y2="21" />
              </svg>
            </button>
          </div>

          <div className="card-toolbar-right">
            {/* Mode Selector Pill */}
            <button
              type="button"
              className="mode-pill-btn"
              onClick={() => {
                setShowModesMenu(!showModesMenu);
                setShowActionsMenu(false);
              }}
            >
              <span className="mode-pill-icon">{getModeIcon(mode)}</span>
              <span className="mode-pill-label">{getModeLabel(mode)}</span>
            </button>

            {/* Terracotta Up-Arrow Submit Button */}
            {disabled ? (
              <button
                type="button"
                className="submit-square-btn stop"
                onClick={onAbort}
                title="Stop response"
              >
                ■
              </button>
            ) : (
              <button
                type="button"
                className={`submit-square-btn ${!text.trim() && attachedFiles.length === 0 ? 'inactive' : ''}`}
                onClick={handleSend}
                disabled={!text.trim() && attachedFiles.length === 0}
                title="Send prompt"
              >
                ↑
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
