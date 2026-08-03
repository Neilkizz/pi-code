import type { AgentToolResult, InlineExtension } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import { BrokerClient } from "./broker-client.js";
import { McpConnector } from "./connector-client.js";
import { PermissionGate } from "./permission-gate.js";

/** Host-side connector runtime config (mirrors the protocol type). */
export interface ConnectorRuntimeConfigHost {
  id: string;
  name: string;
  command: string;
  args: string[];
  env: Record<string, string>;
  contentHash: string;
}

interface ConnectedConnector {
  config: ConnectorRuntimeConfigHost;
  connector: McpConnector;
}

export function createConnectorToolsExtension(options: {
  connectors: ConnectedConnector[];
  gate: PermissionGate;
  client: BrokerClient;
}): InlineExtension {
  return {
    name: "desktop-connector-proxies",
    hidden: true,
    factory: async (pi) => {
      for (const { config, connector } of options.connectors) {
        let tools: Awaited<ReturnType<typeof connector.listTools>>;
        try {
          tools = await connector.listTools();
        } catch {
          // A connector that fails to start is skipped for this task; a warning
          // is surfaced through the caller rather than failing session creation.
          continue;
        }
        for (const tool of tools) {
          const identity = `connector:${config.id}:${tool.name}`;
          options.gate.registerManagedTool(identity);
          const parameters =
            isRecord(tool.inputSchema) &&
            (typeof tool.inputSchema.properties === "object" ||
              typeof tool.inputSchema.type === "string")
              ? Type.Unsafe(tool.inputSchema as Record<string, unknown>)
              : Type.Object({});
          pi.registerTool({
            name: identity,
            label: `MCP: ${tool.name}`,
            description: tool.description ?? `MCP tool from ${config.name}`,
            parameters,
            execute: async (toolCallId, input, signal) => {
              const toolInput = input as Record<string, unknown>;
              const approvalId = await options.gate.authorize(
                identity,
                toolInput,
                signal,
              );
              return options.client.withToolContext(
                { toolName: identity, toolInput, approvalId },
                async () => {
                  await options.client.request(
                    "connector.invoke",
                    {
                      connectorId: config.id,
                      contentHash: config.contentHash,
                      toolName: tool.name,
                    },
                    signal,
                  );
                  const content = await connector.callTool(tool.name, toolInput);
                  return {
                    content: serializeMcpContent(content),
                    details: {},
                  } as AgentToolResult<unknown>;
                },
              );
            },
          });
        }
      }
    },
  };
}

function serializeMcpContent(content: unknown): AgentToolResult<unknown>["content"] {
  if (!Array.isArray(content)) {
    return [{ type: "text", text: String(content) }];
  }
  return content.flatMap((block): AgentToolResult<unknown>["content"] => {
    if (!isRecord(block)) {
      return [{ type: "text", text: String(block) }];
    }
    if (block.type === "text" && typeof block.text === "string") {
      return [{ type: "text", text: block.text }];
    }
    if (block.type === "image") {
      return [
        {
          type: "image",
          data: String(block.data ?? ""),
          mimeType: String(block.mimeType ?? "image/png"),
        },
      ];
    }
    if (block.type === "resource") {
      return [
        { type: "text", text: `[MCP resource] ${JSON.stringify(block.resource)}` },
      ];
    }
    return [{ type: "text", text: JSON.stringify(block) }];
  });
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
