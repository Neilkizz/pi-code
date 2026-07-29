declare module '*.css' {
  const content: Record<string, string>;
  export default content;
}

declare const acquireVsCodeApi: () => {
  postMessage(msg: unknown): void;
  getState(): unknown;
  setState(state: unknown): void;
};
