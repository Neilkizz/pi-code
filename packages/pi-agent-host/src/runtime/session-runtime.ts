import type {
  AgentSession,
  SessionManager,
} from "@earendil-works/pi-coding-agent";
import type { TaskRuntimeProfile } from "@pi-desktop/protocol";
import type { PermissionGate } from "./permission-gate.js";
import type { BrokerClient } from "./broker-client.js";
import type { TaskRunController } from "./task-run-controller.js";
import type { ManagedExtensionWorker } from "./managed-extension-worker.js";

export interface DesktopSessionRuntime {
  taskId: string;
  cwd: string;
  profile: TaskRuntimeProfile;
  session: AgentSession;
  sessionManager: SessionManager;
  permissionGate: PermissionGate;
  brokerClient: BrokerClient;
  extensionWorkers: ManagedExtensionWorker[];
  warnings: string[];
  runController: TaskRunController;
  unsubscribe: () => void;
}
