import { Type } from "typebox";

export default function register(pi) {
  pi.registerTool({
    name: "managed_echo",
    label: "Managed echo",
    description: "Returns a value from an isolated extension worker.",
    parameters: Type.Object({ value: Type.String() }),
    async execute(_toolCallId, params, _signal, onUpdate, context) {
      onUpdate?.({
        content: [{ type: "text", text: "working" }],
        details: { phase: "echo" },
      });
      return {
        content: [
          {
            type: "text",
            text: `${params.value}:${context.mode}:${context.hasUI}`,
          },
        ],
        details: { isolated: true },
      };
    },
  });
}
