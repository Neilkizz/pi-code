import {
  createBashToolDefinition,
  createEditToolDefinition,
  createLsToolDefinition,
  createReadToolDefinition,
  createWriteToolDefinition,
  type InlineExtension,
} from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import type { BrokerClient } from "./broker-client.js";
import type { PermissionGate } from "./permission-gate.js";

interface EncodedBytes {
  dataBase64: string;
}

interface BrokerStat {
  exists: boolean;
  isDirectory: boolean;
}

interface BrokerDirectory {
  entries: string[];
}

interface BrokerProcessResult {
  stdoutBase64: string;
  stderrBase64: string;
  exitCode: number | null;
  timedOut: boolean;
}

interface BrokerSearchResult {
  output: string;
}

export function createBrokerToolsExtension(options: {
  cwd: string;
  gate: PermissionGate;
  client: BrokerClient;
}): InlineExtension {
  const { cwd, gate, client } = options;
  return {
    name: "desktop-capability-broker-tools",
    hidden: true,
    factory: (pi) => {
      const read = createReadToolDefinition(cwd, {
        autoResizeImages: false,
        operations: {
          async readFile(path) {
            const result = await client.request<EncodedBytes>("fs.read", {
              path,
              maximumBytes: 16 * 1024 * 1024,
            });
            return Buffer.from(result.dataBase64, "base64");
          },
          async access(path) {
            await client.request("fs.access", { path, write: false });
          },
          async detectImageMimeType() {
            return null;
          },
        },
      });
      const readExecute = read.execute.bind(read);
      pi.registerTool({
        ...read,
        execute(toolCallId, params, signal, onUpdate, context) {
          return authorized(gate, client, "read", params, signal, () =>
            readExecute(toolCallId, params, signal, onUpdate, context),
          );
        },
      });

      const write = createWriteToolDefinition(cwd, {
        operations: {
          async writeFile(path, content) {
            await client.request("fs.write", {
              path,
              contentBase64: Buffer.from(content).toString("base64"),
            });
          },
          async mkdir(path) {
            await client.request("fs.mkdir", { path });
          },
        },
      });
      const writeExecute = write.execute.bind(write);
      pi.registerTool({
        ...write,
        execute(toolCallId, params, signal, onUpdate, context) {
          return authorized(gate, client, "write", params, signal, () =>
            writeExecute(toolCallId, params, signal, onUpdate, context),
          );
        },
      });

      const edit = createEditToolDefinition(cwd, {
        operations: {
          async readFile(path) {
            const result = await client.request<EncodedBytes>("fs.read", {
              path,
              maximumBytes: 16 * 1024 * 1024,
            });
            return Buffer.from(result.dataBase64, "base64");
          },
          async writeFile(path, content) {
            await client.request("fs.write", {
              path,
              contentBase64: Buffer.from(content).toString("base64"),
            });
          },
          async access(path) {
            await client.request("fs.access", { path, write: true });
          },
        },
      });
      const editExecute = edit.execute.bind(edit);
      pi.registerTool({
        ...edit,
        execute(toolCallId, params, signal, onUpdate, context) {
          return authorized(gate, client, "edit", params, signal, () =>
            editExecute(toolCallId, params, signal, onUpdate, context),
          );
        },
      });

      const list = createLsToolDefinition(cwd, {
        operations: {
          async exists(path) {
            const result = await client.request<BrokerStat>("fs.stat", {
              path,
            });
            return result.exists;
          },
          async stat(path) {
            const result = await client.request<BrokerStat>("fs.stat", {
              path,
            });
            if (!result.exists) {
              throw new Error(`Path not found: ${path}`);
            }
            return { isDirectory: () => result.isDirectory };
          },
          async readdir(path) {
            const result = await client.request<BrokerDirectory>("fs.readdir", {
              path,
            });
            return result.entries;
          },
        },
      });
      const listExecute = list.execute.bind(list);
      pi.registerTool({
        ...list,
        execute(toolCallId, params, signal, onUpdate, context) {
          return authorized(gate, client, "ls", params, signal, () =>
            listExecute(toolCallId, params, signal, onUpdate, context),
          );
        },
      });

      const bash = createBashToolDefinition(cwd, {
        exposeSessionEnvironment: false,
        operations: {
          async exec(command, requestedCwd, execution) {
            const result = await client.request<BrokerProcessResult>(
              "process.shell",
              {
                command,
                cwd: requestedCwd,
                timeoutSeconds: execution.timeout,
              },
              execution.signal,
            );
            const stdout = Buffer.from(result.stdoutBase64, "base64");
            const stderr = Buffer.from(result.stderrBase64, "base64");
            if (stdout.length > 0) {
              execution.onData(stdout);
            }
            if (stderr.length > 0) {
              execution.onData(stderr);
            }
            if (result.timedOut) {
              execution.onData(Buffer.from("\nCommand timed out\n"));
            }
            return { exitCode: result.exitCode };
          },
        },
      });
      const bashExecute = bash.execute.bind(bash);
      pi.registerTool({
        ...bash,
        execute(toolCallId, params, signal, onUpdate, context) {
          return authorized(gate, client, "bash", params, signal, () =>
            bashExecute(toolCallId, params, signal, onUpdate, context),
          );
        },
      });

      const grepParameters = Type.Object({
        pattern: Type.String(),
        path: Type.Optional(Type.String()),
        glob: Type.Optional(Type.String()),
        ignoreCase: Type.Optional(Type.Boolean()),
        literal: Type.Optional(Type.Boolean()),
        context: Type.Optional(Type.Number()),
        limit: Type.Optional(Type.Number()),
      });
      pi.registerTool({
        name: "grep",
        label: "grep",
        description:
          "Search file contents inside the authorized task workspace. Output is bounded.",
        promptSnippet: "Search file contents for patterns",
        parameters: grepParameters,
        execute(_toolCallId, params, signal) {
          return authorized(gate, client, "grep", params, signal, async () => {
            const result = await client.request<BrokerSearchResult>(
              "search.grep",
              { ...params },
              signal,
            );
            return {
              content: [{ type: "text" as const, text: result.output }],
              details: undefined,
            };
          });
        },
      });

      const findParameters = Type.Object({
        pattern: Type.String(),
        path: Type.Optional(Type.String()),
        limit: Type.Optional(Type.Number()),
      });
      pi.registerTool({
        name: "find",
        label: "find",
        description:
          "Find files by glob inside the authorized task workspace. Output is bounded.",
        promptSnippet: "Find files by glob pattern",
        parameters: findParameters,
        execute(_toolCallId, params, signal) {
          return authorized(gate, client, "find", params, signal, async () => {
            const result = await client.request<BrokerSearchResult>(
              "search.find",
              { ...params },
              signal,
            );
            return {
              content: [{ type: "text" as const, text: result.output }],
              details: undefined,
            };
          });
        },
      });
    },
  };
}

async function authorized<T>(
  gate: PermissionGate,
  client: BrokerClient,
  toolName: string,
  input: Record<string, unknown>,
  signal: AbortSignal | undefined,
  execute: () => Promise<T>,
): Promise<T> {
  const approvalId = await gate.authorize(toolName, input, signal);
  return client.withToolContext(
    {
      toolName,
      toolInput: serializableInput(input),
      approvalId,
    },
    execute,
  );
}

function serializableInput(
  input: Record<string, unknown>,
): Record<string, unknown> {
  return JSON.parse(JSON.stringify(input)) as Record<string, unknown>;
}
