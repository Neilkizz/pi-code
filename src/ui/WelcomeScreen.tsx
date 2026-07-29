import React from 'react';

export interface WelcomeScreenProps {
  onSend: (text: string) => void;
}

export function WelcomeScreen({ onSend }: WelcomeScreenProps) {
  const items = [
    {
      text: 'Explain this project',
      prompt: 'Explain the architecture and structure of this project in detail.',
    },
    {
      text: 'Find bugs',
      prompt: 'Review the open files for potential bugs, edge cases, and code quality issues.',
    },
    {
      text: 'Write tests',
      prompt: 'Analyze the code in the current file and write comprehensive unit tests.',
    },
    {
      text: 'Refactor',
      prompt: 'Review the current file and suggest concrete refactoring improvements.',
    },
  ];
  return (
    <div className="welcome">
      <div className="welcome-branding">
        <div className="welcome-logo">π</div>
        <h1 className="welcome-title">Pi Code</h1>
        <p className="welcome-subtitle">Your AI coding partner in VS Code</p>
      </div>
      <div className="welcome-actions">
        {items.map((item) => (
          <button
            key={item.text}
            className="welcome-action-btn"
            onClick={() => onSend(item.prompt)}
          >
            <span className="welcome-action-icon">{item.text[0]}</span>
            <span>{item.text}</span>
          </button>
        ))}
      </div>
      <div className="welcome-shortcuts">
        <div className="shortcut-row">
          <kbd>Cmd+Escape</kbd>
          <span className="desc">Toggle chat focus</span>
        </div>
        <div className="shortcut-row">
          <kbd>Cmd+Shift+Escape</kbd>
          <span className="desc">Open Pi Code</span>
        </div>
        <div className="shortcut-row">
          <kbd>Alt+K</kbd>
          <span className="desc">Insert @-mention</span>
        </div>
        <div className="shortcut-row">
          <kbd>Cmd+N</kbd>
          <span className="desc">New conversation</span>
        </div>
      </div>
    </div>
  );
}