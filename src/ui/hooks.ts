import { useCallback, useEffect, useRef } from 'react';
import type { HostToWebview, WebviewToHost } from '../view/WebviewMessenger';

/**
 * Hook for the VSCode webview postMessage bridge.
 * Provides a `post(msg)` function and receives messages from the extension host.
 */
interface VsCodeApi {
  postMessage(msg: unknown): void;
  getState(): unknown;
  setState(state: unknown): void;
}

export function useVsCodeMessaging(onHostMessage: (msg: HostToWebview) => void) {
  const vscodeApi = useRef<VsCodeApi>();

  useEffect(() => {
    try {
      // @ts-ignore – provided by VS Code webview environment
      vscodeApi.current = acquireVsCodeApi() as VsCodeApi;
    } catch {
      vscodeApi.current = { postMessage: () => {}, getState: () => null, setState: () => {} };
    }
  }, []);

  useEffect(() => {
    const handler = (ev: MessageEvent) => {
      const msg = ev.data as HostToWebview;
      if (msg && typeof msg.kind === 'string') {
        onHostMessage(msg);
      }
    };
    window.addEventListener('message', handler);
    return () => window.removeEventListener('message', handler);
  }, [onHostMessage]);

  const post = useCallback((msg: WebviewToHost) => {
    vscodeApi.current?.postMessage(msg);
  }, []);

  return post;
}
