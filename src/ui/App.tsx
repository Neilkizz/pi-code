import React, { useCallback, useReducer } from 'react';
import { HeaderBar, type SessionItem } from './HeaderBar';
import { useVsCodeMessaging } from './hooks';
import { MessageItem } from './Message';
import { Toolbar } from './Toolbar';
import { ModesMenu, type PermissionMode, type EffortLevel } from './ModesMenu';
import { ActionsMenu } from './ActionsMenu';
import { WelcomeScreen } from './WelcomeScreen';
import { InputArea } from './InputArea';
import { ConfirmCard } from './ConfirmCard';
import type { HostToWebview } from '../view/WebviewMessenger';
import { AppState, AppAction, appReducer, initialState, type DisplayMessage } from './AppState';

export function App() {
  const [state, dispatch] = useReducer(appReducer, initialState);
  const activeSessionIdRef = React.useRef<string | null>(null);

  const onHostMessage = useCallback((msg: HostToWebview) => {
    const action: AppAction | null = (() => {
      switch (msg.kind) {
        case 'piEvent':
          if (msg.sessionId === activeSessionIdRef.current) {
            return { kind: 'piEvent', sessionId: msg.sessionId, event: msg.event };
          }
          return null;
        case 'stateSnapshot': {
          const isNew = msg.sessionId !== activeSessionIdRef.current;
          if (isNew) {
            activeSessionIdRef.current = msg.sessionId;
          }
          return {
            kind: 'stateSnapshot',
            sessionId: msg.sessionId,
            model: msg.model ? `${msg.model.provider}/${msg.model.id}` : '—',
            thinkingLevel: msg.thinkingLevel,
            isStreaming: msg.isStreaming,
            sessionName: msg.sessionName ?? '',
            messageCount: msg.messageCount ?? 0,
          };
        }
        case 'history':
          if (msg.sessionId === activeSessionIdRef.current) {
            return { kind: 'history', sessionId: msg.sessionId, messages: msg.messages };
          }
          return null;
        case 'fileSuggestions':
          return { kind: 'fileSuggestions', files: msg.files.map((f) => f.path) };
        case 'modelList':
          return { kind: 'modelList', models: msg.models.map((m) => ({ provider: m.provider, id: m.id })) };
        case 'contextUpdate':
          return { kind: 'contextUpdate', items: msg.items.map((i) => ({ label: i.label })) };
        case 'gitStatus':
          return {
            kind: 'gitStatus',
            branch: msg.branch,
            added: msg.added,
            deleted: msg.deleted,
            modified: msg.modified,
          };
        case 'changeSummary':
          return { kind: 'changeSummary', summary: msg.summary };
        case 'commandPreview':
          return {
            kind: 'commandPreview',
            command: msg.command,
            risk: msg.risk,
            reason: msg.reason,
            previewId: msg.previewId,
          };
        default:
          return null;
      }
    })();

    if (action) dispatch(action);
  }, []);

  const post = useVsCodeMessaging(onHostMessage);
  const scrollRef = React.useRef<HTMLDivElement>(null);

  const handleSelectSession = (id: string) => {
    activeSessionIdRef.current = id;
    dispatch({ kind: 'selectSession', sessionId: id });
    post({ kind: 'selectSession', sessionId: id } as any);
  };

  const handleNewSession = () => {
    post({ kind: 'newSession' } as any);
  };

  React.useEffect(() => {
    if (scrollRef.current) scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
  }, [state.messages]);

  const handleSend = (text: string) => {
    if (!text.trim()) return;
    const expandedText = text.replace(
      /@(\S+?)#(?:L)?(\d+)(?:-(\d+))?/g,
      (_m, fp, s, e) => `[${fp}:${s}-${e ?? s}]`,
    );
    const dirRefText = expandedText.replace(/@(\S+?\/)/g, (_m, dp) => `[directory: ${dp}]`);
    const isImage = dirRefText.startsWith('data:image');
    const images = isImage
      ? [
          {
            type: 'image' as const,
            data: dirRefText.replace(/^data:image\/\w+;base64,/, ''),
            mimeType: 'image/png',
          },
        ]
      : undefined;
    post(
      images
        ? { kind: 'prompt', text: "What's in this image?", images }
        : { kind: 'prompt', text: dirRefText },
    );
  };

  const handlePlanAction = (action: 'accept' | 'revise', feedback?: string) => {
    if (action === 'accept') {
      post({ kind: 'prompt', text: 'I accept this plan. Please proceed with the implementation.' });
    } else if (action === 'revise' && feedback) {
      post({ kind: 'prompt', text: `Instead of the proposed plan, please do this: ${feedback}` });
    }
  };

  return (
    <div className="chat-container">
      <HeaderBar
        sessionName={state.sessionName}
        model={state.model}
        gitBranch={state.gitBranch}
        gitChanges={state.gitChanges}
        sessions={state.sessions}
        activeSessionId={state.activeSessionId}
        onSelectSession={handleSelectSession}
        onNewSession={handleNewSession}
      />
      <Toolbar
        model={state.model}
        thinking={state.thinking}
        isStreaming={state.isStreaming}
        onAbort={() => post({ kind: 'abort' })}
        onCycleModel={(dir) => post({ kind: 'cycleModel', direction: dir })}
        onSetThinking={(level) => post({ kind: 'setThinkingLevel', level })}
        gitBranch={state.gitBranch}
        gitChanges={state.gitChanges}
      />
      {state.messages.length === 0 && !state.isStreaming ? (
        <WelcomeScreen onSend={handleSend} />
      ) : (
        <div className="message-list" ref={scrollRef}>
          {state.messages.map((m) => (
            <MessageItem key={m.id} msg={m} onPlanAction={handlePlanAction} />
          ))}
        </div>
      )}
      {state.contextItems.length > 0 && (
        <div className="context-panel">
          <div className="context-header">Context ({state.contextItems.length})</div>
          {state.contextItems.map((item, i) => (
            <div key={i} className="context-item">
              <span>📄 {item}</span>
              <button
                className="remove-btn"
                onClick={() => post({ kind: 'removeContextItem', id: `ctx-${i}` })}
              >
                ×
              </button>
            </div>
          ))}
        </div>
      )}
      {state.changeSummary && (
        <div className="change-summary">
          <div className="change-summary-title">Changes made</div>
          <div className="change-summary-file">{state.changeSummary}</div>
        </div>
      )}
      {state.pendingConfirmation && (
        <ConfirmCard
          command={state.pendingConfirmation.command}
          risk={state.pendingConfirmation.risk}
          reason={state.pendingConfirmation.reason}
          previewId={state.pendingConfirmation.previewId}
          onConfirm={(pid) => {
            post({ kind: 'confirmCommand', previewId: pid } as any);
            dispatch({ kind: 'clearPreview' });
          }}
          onCancel={(pid) => {
            post({ kind: 'cancelCommand', previewId: pid } as any);
            dispatch({ kind: 'clearPreview' });
          }}
        />
      )}
      <InputArea
        onSend={handleSend}
        disabled={state.isStreaming}
        suggestions={state.suggestions}
        model={state.model}
        onCycleModel={(dir) => post({ kind: 'cycleModel', direction: dir })}
        onAbort={() => post({ kind: 'abort' })}
      />
    </div>
  );
}

// Re-export for backward compatibility with tests that import from App.tsx
export { DisplayMessage, reduceMessages, convertAgentMessages, textFromMsg, textFromResult, formatSelectionBadge } from './AppState';