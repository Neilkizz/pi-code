import React, { useState, useRef, useEffect } from 'react';

export interface SessionItem {
  id: string;
  name: string;
  timestamp: number;
}

interface HeaderBarProps {
  sessionName: string;
  model: string;
  gitBranch?: string;
  gitChanges?: string;
  sessions: SessionItem[];
  activeSessionId: string | null;
  onSelectSession: (id: string) => void;
  onNewSession: () => void;
}

export function filterSessions(sessions: SessionItem[], query: string): SessionItem[] {
  if (!query.trim()) return sessions;
  const q = query.toLowerCase();
  return sessions.filter((s) => s.name.toLowerCase().includes(q));
}

export function HeaderBar({
  sessionName,
  model,
  gitBranch,
  gitChanges,
  sessions,
  activeSessionId,
  onSelectSession,
  onNewSession,
}: HeaderBarProps) {
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const drawerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (drawerRef.current && !drawerRef.current.contains(e.target as Node)) {
        setDrawerOpen(false);
      }
    };
    if (drawerOpen) {
      document.addEventListener('mousedown', handleClickOutside);
    }
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [drawerOpen]);

  const filtered = filterSessions(sessions, searchQuery);

  return (
    <div className="claude-header-bar" ref={drawerRef}>
      <div className="header-main-row" onClick={() => setDrawerOpen(!drawerOpen)}>
        <span className="spark-logo">&#10033;</span>
        <span className="session-title">{sessionName || 'New Conversation'}</span>
        <span className="chevron-icon">{drawerOpen ? '▴' : '▾'}</span>

        {gitBranch && (
          <span className="git-branch-badge">
            {gitBranch} {gitChanges && <span className="git-changes">{gitChanges}</span>}
          </span>
        )}

        <span className="header-spacer" />

        <span className="model-chip">{model || 'Claude Code'}</span>
        <button
          type="button"
          className="header-new-btn"
          onClick={(e) => {
            e.stopPropagation();
            onNewSession();
          }}
          title="New Conversation"
        >
          +
        </button>
      </div>

      {drawerOpen && (
        <div className="past-conversations-drawer">
          <div className="drawer-search-bar">
            <input
              type="text"
              placeholder="Search past conversations..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              autoFocus
            />
          </div>

          <div className="drawer-session-list">
            {filtered.length === 0 ? (
              <div className="drawer-empty-state">No conversations found</div>
            ) : (
              filtered.map((s) => (
                <div
                  key={s.id}
                  className={`drawer-session-item ${s.id === activeSessionId ? 'active' : ''}`}
                  onClick={() => {
                    onSelectSession(s.id);
                    setDrawerOpen(false);
                  }}
                >
                  <span className="drawer-item-icon">&#128172;</span>
                  <div className="drawer-item-info">
                    <div className="drawer-item-name">{s.name || 'Untitled session'}</div>
                    <div className="drawer-item-time">
                      {new Date(s.timestamp).toLocaleDateString()}
                    </div>
                  </div>
                </div>
              ))
            )}
          </div>

          <div className="drawer-footer">
            <button
              type="button"
              className="drawer-new-btn"
              onClick={() => {
                onNewSession();
                setDrawerOpen(false);
              }}
            >
              + Start New Conversation
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
