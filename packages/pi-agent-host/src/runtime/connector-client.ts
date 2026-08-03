import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

export interface McpConnectorConfig {
  id: string;
  name: string;
  command: string;
  args: string[];
  env: Record<string, string>;
  cwd: string;
}

export interface McpDiscoveredTool {
  name: string;
  description?: string;
  inputSchema?: unknown;
}

/**
 * A host-side MCP stdio client. The host process (not a restricted managed
 * extension worker) spawns the MCP server process and proxies its tools.
 */
export class McpConnector {
  private client: Client | undefined;
  private transport: StdioClientTransport | undefined;

  constructor(private readonly config: McpConnectorConfig) {}

  async connect(): Promise<void> {
    if (this.client) {
      return;
    }
    const transport = new StdioClientTransport({
      command: this.config.command,
      args: this.config.args,
      env: { ...this.config.env },
      cwd: this.config.cwd,
      stderr: "pipe",
    });
    const client = new Client(
      { name: "pi-desktop-connector", version: "0.1.0" },
      { capabilities: {} },
    );
    await client.connect(transport);
    this.transport = transport;
    this.client = client;
  }

  async listTools(): Promise<McpDiscoveredTool[]> {
    await this.connect();
    const result = await this.client!.listTools();
    return result.tools.map((tool) => ({
      name: tool.name,
      description: tool.description,
      inputSchema: tool.inputSchema,
    }));
  }

  async callTool(name: string, args: Record<string, unknown>): Promise<unknown> {
    await this.connect();
    const result = await this.client!.callTool({ name, arguments: args });
    return result.content;
  }

  async close(): Promise<void> {
    const client = this.client;
    this.client = undefined;
    this.transport = undefined;
    if (client) {
      try {
        await client.close();
      } catch {
        // ignore transport teardown errors
      }
    }
  }
}
