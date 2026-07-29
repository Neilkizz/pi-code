import React, { useState } from 'react';

interface Props {
  command: string;
  risk: 'safe' | 'sensitive' | 'dangerous';
  reason?: string;
  previewId: string;
  onConfirm: (previewId: string) => void;
  onCancel: (previewId: string) => void;
}

export function ConfirmCard({ command, risk, reason, previewId, onConfirm, onCancel }: Props) {
  const [dismissed, setDismissed] = useState(false);

  if (dismissed) return null;

  return (
    <div className="confirm-card">
      <div className={`confirm-header ${risk}`}>
        <span className="confirm-icon">🛡️</span>
        <span className="confirm-risk-title">
          {risk === 'dangerous' ? 'DANGEROUS COMMAND REQUESTED' : 'SENSITIVE COMMAND REQUESTED'}
        </span>
      </div>
      <div className="confirm-body">
        <div className="confirm-command-container">
          <code>{command}</code>
        </div>
        {reason && (
          <div className="confirm-reason">
            <strong>Reason:</strong> {reason}
          </div>
        )}
      </div>
      <div className="confirm-footer">
        <button
          className="confirm-btn cancel"
          onClick={() => {
            onCancel(previewId);
            setDismissed(true);
          }}
        >
          Cancel
        </button>
        <button
          className={`confirm-btn execute ${risk}`}
          onClick={() => {
            onConfirm(previewId);
            setDismissed(true);
          }}
        >
          Execute
        </button>
      </div>
    </div>
  );
}
