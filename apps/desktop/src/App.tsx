import { useEffect, useMemo, useRef, useState } from "react";
import { createDesktopCommand } from "@pi-desktop/protocol";
import type {
  AgentHostLaunch,
  AgentHostLifecycle,
  AgentHostLog,
  DesktopBootstrap,
  DesktopShellSnapshot,
  DesktopTaskState,
  DesktopToHostPayload,
  EndpointProfile,
  HostToDesktopMessage,
  PersistedTask,
  PiSessionEvent,
  ProjectSummary,
  RepositoryInfo,
  TaskAttachment,
  TaskIsolation,
  TaskPermissionMode,
  TaskPermissionRequest,
  TaskRuntimeProfile,
} from "@pi-desktop/protocol";
import {
  archiveTask as archivePersistedTask,
  createTask as createPersistedTask,
  createScratchWorkspace,
  deleteAttachment,
  inspectGitRepository,
  invokeDesktopBootstrap,
  listEndpoints,
  listProjects,
  listTasks,
  listenToAgentHost,
  pickProjectFolder,
  pickAttachments,
  replayTaskEvents,
  runAutomaticUpdates,
  saveProjectInstructions,
  sendAgentHostMessage,
  startAgentHost,
  stopAgentHost,
  touchTask,
} from "./platform/tauri/bridge";
import { AppShell } from "./app/AppShell";
import type { WorkspaceView } from "./app/routes";
import {
  CommandPalette,
  type CommandPaletteAction,
} from "./app/CommandPalette";
import { SessionSidebar } from "./features/sessions/SessionSidebar";
import { SessionWorkspace } from "./features/sessions/SessionWorkspace";
import { ProjectCenter } from "./features/projects/ProjectCenter";
import {
  SettingsCenter,
  type SettingsSection,
} from "./features/settings/SettingsCenter";
import { useI18n } from "./i18n/I18nProvider";
import { compactJson } from "./features/sessions/presentation";
import {
  EMPTY_TASK_VIEW,
  type ActivityItem,
  type TaskViewState,
} from "./features/sessions/types";

const emptySnapshot: DesktopShellSnapshot = {
  status: "booting",
  host: {
    status: "idle",
    runtime: "pi-agent-host",
  },
  tasks: [],
};

const promptDraftStoragePrefix = "pi-desktop.prompt-draft.";
const hostCommandTimeoutMs = 45_000;

interface PendingHostCommand {
  type: DesktopToHostPayload["type"];
  taskId?: string;
  resolve: (delivered: boolean) => void;
  timer: number;
}

export function App() {
  const { t } = useI18n();
  const [bootstrap, setBootstrap] = useState<DesktopBootstrap | null>(null);
  const [snapshot, setSnapshot] = useState<DesktopShellSnapshot>(emptySnapshot);
  const [hostLaunch, setHostLaunch] = useState<AgentHostLaunch | null>(null);
  const [tasks, setTasks] = useState<PersistedTask[]>([]);
  const [projects, setProjects] = useState<ProjectSummary[]>([]);
  const [activeTaskId, setActiveTaskId] = useState<string | null>(null);
  const [cwd, setCwd] = useState("");
  const [prompt, setPrompt] = useState(() => readPromptDraft(null));
  const [isolation, setIsolation] = useState<TaskIsolation>("worktree");
  const [repositoryInfo, setRepositoryInfo] = useState<RepositoryInfo | null>(
    null,
  );
  const [projectCheck, setProjectCheck] = useState<
    "idle" | "checking" | "git" | "notGit"
  >("idle");
  const [projectCheckMessage, setProjectCheckMessage] = useState("");
  const [taskViews, setTaskViews] = useState<Record<string, TaskViewState>>({});
  const [endpoints, setEndpoints] = useState<EndpointProfile[]>([]);
  const [taskProfile, setTaskProfile] = useState<TaskRuntimeProfile>({
    permissionMode: "ask",
  });
  const [permissionRequests, setPermissionRequests] = useState<
    TaskPermissionRequest[]
  >([]);
  const [error, setError] = useState<string | null>(null);
  const [activeView, setActiveView] = useState<WorkspaceView>("tasks");
  const [settingsSection, setSettingsSection] =
    useState<SettingsSection>("general");
  const [archiveConfirm, setArchiveConfirm] = useState(false);
  const [pendingAttachments, setPendingAttachments] = useState<
    Record<string, TaskAttachment[]>
  >({});
  const [commandPaletteOpen, setCommandPaletteOpen] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const loadingTasks = useRef(new Set<string>());
  const replayingTasks = useRef(new Set<string>());
  const consumedHostMessages = useRef(new Set<string>());
  const reportedTaskWarnings = useRef(new Set<string>());
  const activeTaskIdRef = useRef<string | null>(activeTaskId);
  activeTaskIdRef.current = activeTaskId;
  const [hydratedTaskIds, setHydratedTaskIds] = useState<Set<string>>(
    () => new Set(),
  );
  const pendingCommands = useRef(new Map<string, PendingHostCommand>());
  const submissionInFlight = useRef(false);

  const activeRecord = useMemo(
    () => tasks.find((task) => task.id === activeTaskId),
    [activeTaskId, tasks],
  );
  const activeTask = useMemo(
    () => snapshot.tasks.find((task) => task.id === activeTaskId),
    [activeTaskId, snapshot.tasks],
  );
  const activeTaskView =
    (activeTaskId ? taskViews[activeTaskId] : undefined) ?? EMPTY_TASK_VIEW;
  const activePermissions = permissionRequests.filter(
    (request) => request.taskId === activeTaskId,
  );
  const activeAttachments = activeTaskId
    ? pendingAttachments[activeTaskId] ?? []
    : [];
  const hostReady = snapshot.host.status === "ready" && Boolean(hostLaunch);
  const taskConnected = Boolean(activeTask);
  const taskRunning =
    activeTask?.status === "running" || activeTask?.status === "waiting";
  const enabledEndpoints = useMemo(
    () =>
      endpoints.filter(
        (endpoint) => endpoint.enabled && endpoint.models.length > 0,
      ),
    [endpoints],
  );
  const selectedEndpoint = enabledEndpoints.find(
    (endpoint) => endpoint.providerId === taskProfile.providerId,
  );

  useEffect(() => {
    persistPromptDraft(activeTaskId, prompt);
  }, [activeTaskId, prompt]);

  const commandActions = useMemo<CommandPaletteAction[]>(
    () => [
      {
        id: "new-task",
        label: t("New local task"),
        detail: t("Choose a project and start an isolated Pi session"),
        shortcut: "⌘N",
        keywords: ["session", "project", "worktree"],
        run: beginNewTask,
      },
      {
        id: "open-sessions",
        label: t("Open sessions"),
        detail: t("Return to the active agent conversation"),
        keywords: ["chat", "task"],
        run: () => setActiveView("tasks"),
      },
      {
        id: "open-endpoints",
        label: t("Manage API endpoints"),
        detail: t("Add, test, and select custom model providers"),
        shortcut: "⌘⇧E",
        keywords: ["provider", "model", "api", "key"],
        run: () => openSettings("endpoints"),
      },
      {
        id: "open-resources",
        label: t("Manage Pi resources"),
        detail: t("Browse, review, update, and approve Pi extensions"),
        shortcut: "⌘⇧X",
        keywords: ["extension", "plugin", "skill"],
        run: () => openSettings("extensions"),
      },
      {
        id: "open-settings",
        label: t("Open settings"),
        detail: t(
          "Manage models, extensions, runtime, language, and appearance",
        ),
        shortcut: "⌘,",
        keywords: ["settings", "preferences", "language", "theme"],
        run: () => openSettings("general"),
      },
      {
        id: "choose-project",
        label: t("Choose a project folder"),
        detail: activeRecord
          ? t("Create a new task first to choose another project")
          : t("Open the native macOS folder picker"),
        keywords: ["browse", "folder", "cwd"],
        disabled: Boolean(activeRecord),
        run: () => void chooseProjectFolder(),
      },
      {
        id: "restart-runtime",
        label: t("Restart Pi runtime"),
        detail: t("Restart the coordinator and safely reconnect tasks"),
        keywords: ["host", "worker", "recover"],
        disabled: !bootstrap,
        run: () => void restartHost(),
      },
    ],
    [activeRecord, bootstrap, t],
  );

  useEffect(() => {
    let cancelled = false;
    let unlisten: (() => void) | undefined;

    void (async () => {
      unlisten = await listenToAgentHost({
        onMessage: handleHostMessage,
        onLifecycle: handleHostLifecycle,
        onLog: handleHostLog,
      });

      const [payload, savedTasks, savedProjects] = await Promise.all([
        invokeDesktopBootstrap(),
        listTasks(false),
        listProjects(),
      ]);
      if (cancelled) {
        return;
      }

      setBootstrap(payload);
      setSnapshot(payload.snapshot);
      setTasks(savedTasks);
      setProjects(savedProjects);
      if (savedTasks[0]) {
        activateRecord(savedTasks[0], true);
      }
      const launch = await startAgentHost();
      if (cancelled) {
        return;
      }
      setHostLaunch(launch);
      void runAutomaticUpdates()
        .catch((cause: unknown) => ({
          extensionsUpdated: [],
          errors: [errorMessage(cause)],
        }))
        .then((updateReport) => {
          if (!cancelled && updateReport.errors.length > 0) {
            setError(
              `${t("Automatic update completed with warnings")}: ${updateReport.errors.join(
                " · ",
              )}`,
            );
          }
        });
    })().catch((cause: unknown) => {
      if (cancelled) {
        return;
      }
      const message = errorMessage(cause);
      setError(message);
      setSnapshot((current) => ({
        ...current,
        status: "error",
        host: { ...current.host, status: "error", error: message },
      }));
    });

    return () => {
      cancelled = true;
      unlisten?.();
      cancelPendingCommands();
    };
  }, []);

  useEffect(() => {
    function handleShortcut(event: KeyboardEvent): void {
      if (!event.metaKey || event.altKey) return;
      const key = event.key.toLocaleLowerCase();
      if (key === "k") {
        event.preventDefault();
        setCommandPaletteOpen(true);
      } else if (key === "n" && !event.shiftKey) {
        event.preventDefault();
        beginNewTask();
      } else if (key === "e" && event.shiftKey) {
        event.preventDefault();
        setSettingsSection("endpoints");
        setActiveView("settings");
      } else if (key === "x" && event.shiftKey) {
        event.preventDefault();
        setSettingsSection("extensions");
        setActiveView("settings");
      } else if (event.key === ",") {
        event.preventDefault();
        setSettingsSection("general");
        setActiveView("settings");
      }
    }
    window.addEventListener("keydown", handleShortcut);
    return () => window.removeEventListener("keydown", handleShortcut);
  }, []);

  useEffect(() => {
    void listEndpoints().then(setEndpoints).catch(showError);
  }, []);

  useEffect(() => {
    if (activeRecord) {
      return;
    }
    setTaskProfile((current) => {
      const currentEndpoint = enabledEndpoints.find(
        (endpoint) => endpoint.providerId === current.providerId,
      );
      if (
        currentEndpoint &&
        current.modelId &&
        currentEndpoint.models.includes(current.modelId)
      ) {
        return current;
      }
      const preferred =
        enabledEndpoints.find((endpoint) => endpoint.isDefault) ??
        enabledEndpoints[0];
      return {
        permissionMode: current.permissionMode,
        providerId: preferred?.providerId,
        modelId: preferred
          ? preferred.defaultModel ?? preferred.models[0]
          : undefined,
      };
    });
  }, [activeRecord, enabledEndpoints]);

  useEffect(() => {
    if (activeRecord || !cwd.trim()) {
      setRepositoryInfo(null);
      setProjectCheck("idle");
      setProjectCheckMessage("");
      return;
    }
    let cancelled = false;
    setProjectCheck("checking");
    const timer = window.setTimeout(() => {
      void inspectGitRepository(cwd.trim())
        .then((repository) => {
          if (cancelled) {
            return;
          }
          setRepositoryInfo(repository);
          setProjectCheck("git");
          setProjectCheckMessage(
            repository.currentBranch
              ? `Git · ${repository.currentBranch}`
              : "Git · detached HEAD",
          );
          setIsolation((current) =>
            current === "readOnly" ? current : "worktree",
          );
        })
        .catch((cause: unknown) => {
          if (cancelled) {
            return;
          }
          setRepositoryInfo(null);
          setProjectCheck("notGit");
          setProjectCheckMessage(errorMessage(cause));
          setIsolation((current) =>
            current === "worktree" ? "currentCheckout" : current,
          );
        });
    }, 350);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [activeRecord, cwd]);

  useEffect(() => {
    if (
      !activeRecord ||
      hydratedTaskIds.has(activeRecord.id) ||
      replayingTasks.current.has(activeRecord.id)
    ) {
      return;
    }
    replayingTasks.current.add(activeRecord.id);
    void hydrateTaskFromEventStore(activeRecord.id);
  }, [activeRecord, hydratedTaskIds]);

  useEffect(() => {
    if (
      !hostReady ||
      !activeRecord ||
      !hydratedTaskIds.has(activeRecord.id) ||
      activeTask ||
      loadingTasks.current.has(activeRecord.id)
    ) {
      return;
    }
    loadingTasks.current.add(activeRecord.id);
    void send({
      type: "task.create",
      taskId: activeRecord.id,
      cwd: activeRecord.cwd,
      isolation: activeRecord.isolation,
      profile: activeRecord.profile,
      projectInstructions: projectInstructionsFor(activeRecord.projectRoot),
      resume: true,
    });
  }, [activeRecord, activeTask, hostReady, hydratedTaskIds, projects]);

  function handleHostMessage(
    message: HostToDesktopMessage,
    source: "live" | "replay" = "live",
  ): void {
    if (consumedHostMessages.current.has(message.messageId)) {
      return;
    }
    consumedHostMessages.current.add(message.messageId);
    if (consumedHostMessages.current.size > 20_000) {
      const oldest = consumedHostMessages.current.values().next().value;
      if (typeof oldest === "string") {
        consumedHostMessages.current.delete(oldest);
      }
    }

    if (message.type === "host.hello") {
      setSnapshot((current) => ({
        ...current,
        host: {
          ...current.host,
          version: message.hello.hostVersion,
        },
      }));
      return;
    }

    if (message.type === "host.status") {
      setSnapshot((current) => ({
        ...current,
        status: message.state.status === "error" ? "error" : "ready",
        host: message.state,
      }));
      return;
    }

    if (message.type === "task.status") {
      // Event Store replay reconstructs the transcript and activity timeline, but
      // it must never make an old task look connected to the newly launched host.
      // A live task.status will arrive after the resume command recreates its
      // per-task worker.
      if (source === "replay") {
        return;
      }
      loadingTasks.current.delete(message.task.id);
      setSnapshot((current) => ({
        ...current,
        tasks: upsertTask(current.tasks, message.task),
      }));
      const newWarnings = (message.task.warnings ?? []).filter((warning) => {
        const key = `${message.task.id}:${warning}`;
        if (reportedTaskWarnings.current.has(key)) {
          return false;
        }
        reportedTaskWarnings.current.add(key);
        return true;
      });
      for (const warning of newWarnings) {
        pushActivity(
          message.task.id,
          "error",
          t("Extension disabled"),
          warning,
        );
      }
      if (newWarnings.length > 0) {
        setError(
          `${t("Some extensions were disabled for this task")}: ${newWarnings.join(
            " · ",
          )}`,
        );
      }
      if (message.task.status === "failed" && message.task.error) {
        setError(message.task.error);
      }
      if (
        message.task.status === "idle" ||
        message.task.status === "completed" ||
        message.task.status === "failed"
      ) {
        setPermissionRequests((current) =>
          current.filter((request) => request.taskId !== message.task.id),
        );
      }
      return;
    }

    if (message.type === "task.permission.request") {
      if (source === "replay") {
        pushActivity(
          message.request.taskId,
          "system",
          `${t("Interrupted approval")} · ${message.request.toolName}`,
          t("A previous approval expired when its worker stopped."),
        );
        return;
      }
      setPermissionRequests((current) => [
        ...current.filter((request) => request.id !== message.request.id),
        message.request,
      ]);
      pushActivity(
        message.request.taskId,
        "tool",
        `${t("Approval required")} · ${message.request.toolName}`,
        compactJson(message.request.input),
      );
      return;
    }

    if (message.type === "task.event") {
      consumePiEvent(message.taskId, message.event);
      return;
    }

    if (message.type === "task.history") {
      updateTaskView(message.taskId, (current) => ({
        ...current,
        messages:
          current.messages.length === 0 || current.restored
            ? message.messages
            : current.messages,
      }));
      return;
    }

    if (message.type === "task.broker.request") {
      return;
    }

    if (source === "replay") {
      return;
    }

    const correlationId = message.correlationId;
    const pending = correlationId
      ? pendingCommands.current.get(correlationId)
      : undefined;
    if (correlationId) {
      pendingCommands.current.delete(correlationId);
    }
    if (pending) {
      window.clearTimeout(pending.timer);
      pending.resolve(message.ok);
    }
    if (message.ok && pending?.type === "task.close" && pending.taskId) {
      setSnapshot((current) => ({
        ...current,
        tasks: current.tasks.filter((task) => task.id !== pending.taskId),
      }));
      return;
    }
    if (!message.ok) {
      if (pending?.taskId) {
        loadingTasks.current.delete(pending.taskId);
        pushActivity(
          pending.taskId,
          "error",
          message.error.code,
          message.error.message,
        );
      }
      setError(message.error.message);
    }
  }

  async function hydrateTaskFromEventStore(taskId: string): Promise<void> {
    let cursor = 0;
    let replayed = 0;
    const maximumReplayEvents = 5_000;
    try {
      while (replayed < maximumReplayEvents) {
        const page = await replayTaskEvents(taskId, cursor, 500);
        for (const event of page.events) {
          handleHostMessage(event.message, "replay");
        }
        replayed += page.events.length;
        cursor = page.nextCursor;
        if (!page.hasMore || page.events.length === 0) {
          break;
        }
      }
      if (replayed >= maximumReplayEvents) {
        pushActivity(
          taskId,
          "system",
          t("Recent activity restored"),
          t("Older Event Store records remain on disk and are loaded on demand."),
        );
      }
    } catch (cause: unknown) {
      showError(
        `${t("Could not restore task events")}: ${errorMessage(cause)}`,
      );
    } finally {
      replayingTasks.current.delete(taskId);
      setHydratedTaskIds((current) => {
        const next = new Set(current);
        next.add(taskId);
        return next;
      });
    }
  }

  function handleHostLifecycle(lifecycle: AgentHostLifecycle): void {
    if (lifecycle.status === "spawned") {
      setSnapshot((current) => ({
        ...current,
        host: { ...current.host, status: "starting" },
      }));
      return;
    }

    loadingTasks.current.clear();
    cancelPendingCommands();
    setHostLaunch(null);
    setSnapshot((current) => ({
      ...current,
      host: { ...current.host, status: "stopped" },
      tasks: current.tasks.map((task) => ({
        ...task,
        status: "failed",
        error: t("Pi Host exited; restart to reconnect this session."),
      })),
    }));
    setPermissionRequests([]);
    if (typeof lifecycle.code === "number" && lifecycle.code !== 0) {
      setError(
        t("Pi Host exited with code {code}.", { code: lifecycle.code }),
      );
    }
  }

  function handleHostLog(log: AgentHostLog): void {
    if (log.stream === "stderr" && log.line.trim()) {
      setError(log.line);
    }
  }

  function consumePiEvent(taskId: string, event: PiSessionEvent): void {
    const assistantEvent = isRecord(event.assistantMessageEvent)
      ? event.assistantMessageEvent
      : undefined;
    if (
      event.type === "message_update" &&
      assistantEvent?.type === "text_delta" &&
      typeof assistantEvent.delta === "string"
    ) {
      const delta = assistantEvent.delta;
      updateTaskView(taskId, (current) => {
        const streamingId =
          current.streamingAssistantId ?? `assistant-${messageId()}`;
        const existing = current.messages.some(
          (message) => message.id === streamingId,
        );
        return {
          ...current,
          streamingAssistantId: streamingId,
          messages: existing
            ? current.messages.map((message) =>
                message.id === streamingId
                  ? { ...message, text: message.text + delta }
                  : message,
              )
            : [
                ...current.messages,
                {
                  id: streamingId,
                  role: "assistant",
                  text: delta,
                  createdAt: Date.now(),
                },
              ],
        };
      });
      return;
    }

    if (event.type === "tool_execution_start") {
      const toolName = String(event.toolName ?? t("unknown"));
      pushActivity(
        taskId,
        "tool",
        `${t("Tool")} · ${toolName}`,
        undefined,
        {
          id: `tool-${String(event.toolCallId ?? messageId())}`,
          input: compactJson(event.args),
          toolCallId:
            typeof event.toolCallId === "string" ? event.toolCallId : undefined,
          status: "running",
        },
      );
      return;
    }

    if (event.type === "tool_execution_end") {
      completeToolActivity(taskId, {
        toolCallId:
          typeof event.toolCallId === "string" ? event.toolCallId : undefined,
        toolName: String(event.toolName ?? t("unknown")),
        failed: Boolean(event.isError),
        output: compactJson(event.result),
      });
      return;
    }

    if (event.type === "agent_start") {
      pushActivity(taskId, "system", t("Agent turn started"));
    } else if (event.type === "agent_settled" || event.type === "agent_end") {
      updateTaskView(taskId, (current) => ({
        ...current,
        streamingAssistantId: undefined,
      }));
      pushActivity(taskId, "system", t("Agent turn settled"));
    }
  }

  function updateTaskView(
    taskId: string,
    update: (current: TaskViewState) => TaskViewState,
  ): void {
    setTaskViews((current) => ({
      ...current,
      [taskId]: update(current[taskId] ?? EMPTY_TASK_VIEW),
    }));
  }

  function pushActivity(
    taskId: string,
    kind: ActivityItem["kind"],
    title: string,
    detail?: string,
    options: Partial<
      Pick<ActivityItem, "id" | "input" | "output" | "toolCallId" | "status">
    > = {},
  ): void {
    updateTaskView(taskId, (current) => ({
      ...current,
      activities: [
        {
          id: options.id ?? messageId(),
          kind,
          title,
          detail,
          input: options.input,
          output: options.output,
          toolCallId: options.toolCallId,
          status: options.status,
          createdAt: Date.now(),
        },
        ...current.activities,
      ].slice(0, 24),
    }));
  }

  function completeToolActivity(
    taskId: string,
    event: {
      toolCallId?: string;
      toolName: string;
      failed: boolean;
      output?: string;
    },
  ): void {
    const completedAt = Date.now();
    updateTaskView(taskId, (current) => {
      const index = event.toolCallId
        ? current.activities.findIndex(
            (activity) => activity.toolCallId === event.toolCallId,
          )
        : -1;
      if (index === -1) {
        const fallback: ActivityItem = {
          id: `tool-${event.toolCallId ?? messageId()}`,
          kind: event.failed ? "error" : "tool",
          title: `${t(event.failed ? "Tool failed" : "Tool completed")} · ${event.toolName}`,
          output: event.output,
          toolCallId: event.toolCallId,
          status: event.failed ? "failed" : "completed",
          createdAt: completedAt,
          completedAt,
        };
        return {
          ...current,
          activities: [fallback, ...current.activities].slice(0, 24),
        };
      }
      return {
        ...current,
        activities: current.activities.map((activity, activityIndex) =>
          activityIndex === index
            ? {
                ...activity,
                kind: event.failed ? "error" : "tool",
                title: `${t(event.failed ? "Tool failed" : "Tool completed")} · ${event.toolName}`,
                output: event.output ?? activity.output,
                status: event.failed ? "failed" : "completed",
                completedAt,
              }
            : activity,
        ),
      };
    });
  }

  function openSettings(section: SettingsSection): void {
    setSettingsSection(section);
    setActiveView("settings");
    setCommandPaletteOpen(false);
  }

  function activateRecord(record: PersistedTask, restored: boolean): void {
    setActiveView("tasks");
    setActiveTaskId(record.id);
    setCwd(record.cwd);
    setIsolation(record.isolation);
    setTaskProfile(record.profile);
    setPrompt(readPromptDraft(record.id));
    setArchiveConfirm(false);
    setTaskViews((current) => ({
      ...current,
      [record.id]: current[record.id] ?? {
        ...EMPTY_TASK_VIEW,
        restored,
      },
    }));
  }

  async function selectTask(record: PersistedTask): Promise<void> {
    activateRecord(record, true);
    try {
      const touched = await touchTask(record.id);
      setTasks((current) => sortTasks(replaceTask(current, touched)));
    } catch (cause: unknown) {
      showError(cause);
    }
  }

  function beginNewTask(): void {
    setActiveView("tasks");
    setActiveTaskId(null);
    setCwd("");
    setIsolation("worktree");
    setRepositoryInfo(null);
    setProjectCheck("idle");
    setProjectCheckMessage("");
    setPrompt(readPromptDraft(null));
    setArchiveConfirm(false);
    setPermissionRequests([]);
  }

  async function createTask(submitInitialPrompt = false): Promise<void> {
    const normalizedCwd = cwd.trim();
    const initialPrompt = prompt.trim();
    if (!normalizedCwd) {
      setError(t("Select a project folder before sending"));
      return;
    }
    if (submitInitialPrompt && !initialPrompt) {
      setError(t("Enter a prompt before sending"));
      return;
    }

    await runExclusiveSubmission(async () => {
      setError(null);
      if (isolation === "worktree" && projectCheck !== "git") {
        setError(t("A Git repository is required for an isolated worktree"));
        return;
      }
      const saved = await createPersistedTask({
        projectPath: normalizedCwd,
        isolation,
        profile: taskProfile,
      });
      loadingTasks.current.add(saved.id);
      setTasks((current) => sortTasks([saved, ...current]));
      void listProjects().then(setProjects).catch(showError);
      activateRecord(saved, false);
      const created = await send({
        type: "task.create",
        taskId: saved.id,
        cwd: saved.cwd,
        isolation: saved.isolation,
        profile: saved.profile,
        projectInstructions: projectInstructionsFor(saved.projectRoot),
        resume: false,
      });
      clearPromptDraft(null);
      if (!created) {
        if (submitInitialPrompt) {
          setPrompt(initialPrompt);
          persistPromptDraft(saved.id, initialPrompt);
        }
        return;
      }
      if (submitInitialPrompt) {
        await submitPromptForTask(saved.id, initialPrompt, []);
      }
    });
  }

  async function chooseProjectFolder(): Promise<void> {
    try {
      const path = await pickProjectFolder();
      if (path) {
        setCwd(path);
        setError(null);
      }
    } catch (cause: unknown) {
      showError(cause);
    }
  }

  async function chooseProjectForNewTask(): Promise<void> {
    beginNewTask();
    try {
      const path = await pickProjectFolder();
      if (path) {
        setCwd(path);
        setError(null);
      }
    } catch (cause: unknown) {
      showError(cause);
    }
  }

  async function useScratchWorkspace(): Promise<void> {
    try {
      const scratch = await createScratchWorkspace();
      setCwd(scratch);
      setIsolation("currentCheckout");
      setError(null);
    } catch (cause: unknown) {
      showError(cause);
    }
  }

  function beginNewTaskForProject(project: ProjectSummary): void {
    beginNewTask();
    setCwd(project.root);
  }

  async function updateProjectInstructions(
    project: ProjectSummary,
    instructions: string,
  ): Promise<void> {
    const saved = await saveProjectInstructions(project.id, instructions);
    setProjects((current) =>
      current.map((candidate) => (candidate.id === saved.id ? saved : candidate)),
    );
  }

  function projectInstructionsFor(projectRoot: string): string | undefined {
    const instructions = projects.find(
      (project) => project.root === projectRoot,
    )?.instructions.trim();
    return instructions || undefined;
  }

  function selectEndpoint(providerId: string): void {
    const endpoint = enabledEndpoints.find(
      (candidate) => candidate.providerId === providerId,
    );
    setTaskProfile((current) => ({
      permissionMode: current.permissionMode,
      providerId: endpoint?.providerId,
      modelId: endpoint
        ? endpoint.defaultModel ?? endpoint.models[0]
        : undefined,
    }));
  }

  function setPermissionMode(permissionMode: TaskPermissionMode): void {
    setTaskProfile((current) => ({ ...current, permissionMode }));
  }

  function selectIsolation(nextIsolation: TaskIsolation): void {
    if (nextIsolation === "worktree" && !repositoryInfo) {
      setError(t("A Git repository is required for an isolated worktree"));
      return;
    }
    setIsolation(nextIsolation);
    if (nextIsolation === "readOnly") {
      setTaskProfile((current) => ({ ...current, permissionMode: "plan" }));
    }
    setError(null);
  }

  async function submitPrompt(): Promise<void> {
    const typedText = prompt.trim();
    if (
      (!typedText && activeAttachments.length === 0) ||
      !activeTaskId ||
      !taskConnected
    ) {
      return;
    }
    const text =
      typedText ||
      t(
        "Analyze these attachments and explain the key findings, risks, and recommended next steps.",
      );

    await runExclusiveSubmission(() =>
      submitPromptForTask(activeTaskId, text, activeAttachments),
    );
  }

  async function runExclusiveSubmission(
    work: () => Promise<void>,
  ): Promise<void> {
    if (submissionInFlight.current) return;
    submissionInFlight.current = true;
    setIsSubmitting(true);
    try {
      await work();
    } catch (cause: unknown) {
      showError(cause);
    } finally {
      submissionInFlight.current = false;
      setIsSubmitting(false);
    }
  }

  async function submitPromptForTask(
    taskId: string,
    text: string,
    attachments: TaskAttachment[],
  ): Promise<void> {
    setError(null);
    const userMessageId = `user-${messageId()}`;
    const assistantMessageId = `assistant-${messageId()}`;
    updateTaskView(taskId, (current) => ({
      ...current,
      messages: [
        ...current.messages,
        {
          id: userMessageId,
          role: "user",
          text:
            attachments.length > 0
              ? `${text}\n\n${t("Attachments:")} ${attachments
                  .map((attachment) => attachment.name)
                  .join(t("list separator"))}`
              : text,
          createdAt: Date.now(),
        },
        {
          id: assistantMessageId,
          role: "assistant",
          text: "",
          createdAt: Date.now(),
        },
      ],
      streamingAssistantId: assistantMessageId,
      restored: false,
    }));
    setPrompt("");
    clearPromptDraft(taskId);
    const delivered = await send({
      type: "task.prompt",
      taskId,
      prompt: text,
      attachments: attachments.map(
        ({ id, kind, name, path, mimeType, size, sha256 }) => ({
          id,
          kind,
          name,
          path,
          mimeType,
          size,
          sha256,
        }),
      ),
    });
    if (!delivered) {
      updateTaskView(taskId, (current) => ({
        ...current,
        messages: current.messages.filter(
          (message) =>
            message.id !== userMessageId && message.id !== assistantMessageId,
        ),
        streamingAssistantId:
          current.streamingAssistantId === assistantMessageId
            ? undefined
            : current.streamingAssistantId,
      }));
      persistPromptDraft(taskId, text);
      if (activeTaskIdRef.current === taskId) {
        setPrompt((current) => current || text);
      }
      pushActivity(taskId, "error", t("Prompt was not delivered"), text);
      return;
    }
    pushActivity(taskId, "system", t("Prompt submitted"), text);
    void touchTask(taskId)
      .then((touched) => {
        setTasks((current) => sortTasks(replaceTask(current, touched)));
      })
      .catch(showError);
    setPendingAttachments((current) => ({
      ...current,
      [taskId]: [],
    }));
  }

  async function attachFiles(): Promise<void> {
    if (!activeTaskId || taskRunning) {
      return;
    }
    try {
      const imported = await pickAttachments(activeTaskId);
      if (imported.length === 0) {
        return;
      }
      setPendingAttachments((current) => ({
        ...current,
        [activeTaskId]: [
          ...(current[activeTaskId] ?? []),
          ...imported.filter(
            (attachment) =>
              !(current[activeTaskId] ?? []).some(
                (existing) => existing.id === attachment.id,
              ),
          ),
        ],
      }));
    } catch (cause: unknown) {
      showError(cause);
    }
  }

  async function removePendingAttachment(
    attachment: TaskAttachment,
  ): Promise<void> {
    try {
      await deleteAttachment(attachment.taskId, attachment.id);
      setPendingAttachments((current) => ({
        ...current,
        [attachment.taskId]: (current[attachment.taskId] ?? []).filter(
          (candidate) => candidate.id !== attachment.id,
        ),
      }));
    } catch (cause: unknown) {
      showError(cause);
    }
  }

  async function abortTask(): Promise<void> {
    if (!activeTaskId) {
      return;
    }
    setPermissionRequests((current) =>
      current.filter((request) => request.taskId !== activeTaskId),
    );
    await send({
      type: "task.abort",
      taskId: activeTaskId,
    });
  }

  async function respondToPermission(
    request: TaskPermissionRequest,
    approved: boolean,
  ): Promise<void> {
    setPermissionRequests((current) =>
      current.filter((candidate) => candidate.id !== request.id),
    );
    pushActivity(
      request.taskId,
      approved ? "tool" : "error",
      `${t(approved ? "Allowed once" : "Denied")} · ${request.toolName}`,
      compactJson(request.input),
    );
    await send({
      type: "task.permission.respond",
      taskId: request.taskId,
      requestId: request.id,
      approved,
    });
  }

  async function archiveActiveTask(): Promise<void> {
    if (!activeRecord) {
      return;
    }
    if (!archiveConfirm) {
      setArchiveConfirm(true);
      return;
    }

    try {
      setError(null);
      if (activeTask) {
        await send({
          type: "task.close",
          taskId: activeRecord.id,
        });
      }
      await archivePersistedTask(activeRecord.id, true);
      clearPromptDraft(activeRecord.id);
      loadingTasks.current.delete(activeRecord.id);
      setPermissionRequests((current) =>
        current.filter((request) => request.taskId !== activeRecord.id),
      );
      setSnapshot((current) => ({
        ...current,
        tasks: current.tasks.filter((task) => task.id !== activeRecord.id),
      }));
      const remaining = tasks.filter((task) => task.id !== activeRecord.id);
      setTasks(remaining);
      if (remaining[0]) {
        activateRecord(remaining[0], true);
      } else {
        beginNewTask();
      }
    } catch (cause: unknown) {
      showError(cause);
    }
  }

  async function restartHost(): Promise<void> {
    if (!bootstrap) {
      return;
    }

    try {
      setError(null);
      setArchiveConfirm(false);
      setPermissionRequests([]);
      loadingTasks.current.clear();
      cancelPendingCommands();
      setHostLaunch(null);
      await stopAgentHost();
      setSnapshot((current) => ({
        ...current,
        tasks: [],
        host: { ...current.host, status: "starting", error: undefined },
      }));
      const launch = await startAgentHost();
      setHostLaunch(launch);
    } catch (cause: unknown) {
      showError(cause);
    }
  }

  async function send(payload: DesktopToHostPayload): Promise<boolean> {
    const message = createDesktopCommand(payload);
    return new Promise<boolean>((resolve) => {
      const pending: PendingHostCommand = {
        type: payload.type,
        taskId: "taskId" in payload ? payload.taskId : undefined,
        resolve,
        timer: window.setTimeout(() => {
          if (pendingCommands.current.get(message.messageId) !== pending) {
            return;
          }
          pendingCommands.current.delete(message.messageId);
          if (pending.taskId) {
            loadingTasks.current.delete(pending.taskId);
          }
          setError(
            t("Pi did not acknowledge {command}.", {
              command: payload.type,
            }),
          );
          resolve(false);
        }, hostCommandTimeoutMs),
      };
      pendingCommands.current.set(message.messageId, pending);
      void sendAgentHostMessage(message).catch((cause: unknown) => {
        if (pendingCommands.current.get(message.messageId) !== pending) {
          return;
        }
        pendingCommands.current.delete(message.messageId);
        window.clearTimeout(pending.timer);
        if (pending.taskId) {
          loadingTasks.current.delete(pending.taskId);
        }
        showError(cause);
        resolve(false);
      });
    });
  }

  function cancelPendingCommands(): void {
    for (const pending of pendingCommands.current.values()) {
      window.clearTimeout(pending.timer);
      pending.resolve(false);
    }
    pendingCommands.current.clear();
  }

  function showError(cause: unknown): void {
    setError(errorMessage(cause));
  }

  return (
    <AppShell
      activeView={activeView}
      error={error}
      onDismissError={() => setError(null)}
      commandPalette={
        <CommandPalette
          open={commandPaletteOpen}
          actions={commandActions}
          onClose={() => setCommandPaletteOpen(false)}
        />
      }
      sidebar={
        <SessionSidebar
          activeView={activeView}
          activeTaskId={activeTaskId}
          tasks={tasks}
          runtimeTasks={snapshot.tasks}
          host={snapshot.host}
          hostLaunch={hostLaunch}
          onViewChange={(view) => {
            setActiveView(view);
            if (view === "settings") {
              setSettingsSection("general");
            }
          }}
          onNewTask={beginNewTask}
          onSelectTask={(task) => void selectTask(task)}
          onRestartHost={() => void restartHost()}
          onOpenCommandPalette={() => setCommandPaletteOpen(true)}
        />
      }
    >
      {activeView === "settings" ? (
        <SettingsCenter
          section={settingsSection}
          bootstrap={bootstrap}
          host={snapshot.host}
          hostLaunch={hostLaunch}
          onSectionChange={setSettingsSection}
          onProfilesChanged={setEndpoints}
          onRestartHost={() => void restartHost()}
          onClose={() => setActiveView("tasks")}
        />
      ) : activeView === "projects" ? (
        <ProjectCenter
          projects={projects}
          tasks={tasks}
          onOpenFolder={() => void chooseProjectForNewTask()}
          onNewTask={beginNewTaskForProject}
          onOpenTask={(task) => void selectTask(task)}
          onSaveInstructions={updateProjectInstructions}
        />
      ) : (
        <SessionWorkspace
          record={activeRecord}
          runtimeTask={activeTask}
          hostStatus={snapshot.host.status}
          taskView={activeTaskView}
          permissions={activePermissions}
          profile={taskProfile}
          isolation={isolation}
          repositoryInfo={repositoryInfo}
          projectCheck={projectCheck}
          projectCheckMessage={projectCheckMessage}
          endpoints={enabledEndpoints}
          selectedEndpoint={selectedEndpoint}
          cwd={cwd}
          prompt={prompt}
          attachments={activeAttachments}
          hostReady={hostReady}
          taskConnected={taskConnected}
          taskRunning={taskRunning}
          isSubmitting={isSubmitting}
          taskLoading={Boolean(
            activeRecord && loadingTasks.current.has(activeRecord.id),
          )}
          archiveConfirm={archiveConfirm}
          onArchive={() => void archiveActiveTask()}
          onArchiveBlur={() => setArchiveConfirm(false)}
          onPermission={(request, approved) =>
            void respondToPermission(request, approved)
          }
          onCwdChange={setCwd}
          onPromptChange={setPrompt}
          onAttach={() => void attachFiles()}
          onRemoveAttachment={(attachment) =>
            void removePendingAttachment(attachment)
          }
          onChooseProject={() => void chooseProjectFolder()}
          onUseScratchWorkspace={() => void useScratchWorkspace()}
          onSelectEndpoint={selectEndpoint}
          onSelectModel={(modelId) =>
            setTaskProfile((current) => ({ ...current, modelId }))
          }
          onPermissionMode={setPermissionMode}
          onIsolation={selectIsolation}
          onSubmit={() =>
            void (activeRecord ? submitPrompt() : createTask(true))
          }
          onAbort={() => void abortTask()}
          onError={setError}
        />
      )}
    </AppShell>
  );
}

function upsertTask(
  tasks: DesktopTaskState[],
  next: DesktopTaskState,
): DesktopTaskState[] {
  const existing = tasks.findIndex((task) => task.id === next.id);
  if (existing === -1) {
    return [...tasks, next];
  }
  return tasks.map((task, index) => (index === existing ? next : task));
}

function replaceTask(
  tasks: PersistedTask[],
  next: PersistedTask,
): PersistedTask[] {
  const existing = tasks.some((task) => task.id === next.id);
  return existing
    ? tasks.map((task) => (task.id === next.id ? next : task))
    : [...tasks, next];
}

function sortTasks(tasks: PersistedTask[]): PersistedTask[] {
  return [...new Map(tasks.map((task) => [task.id, task])).values()].sort(
    (left, right) =>
      right.lastOpenedAt - left.lastOpenedAt ||
      right.updatedAt - left.updatedAt ||
      left.id.localeCompare(right.id),
  );
}

function messageId(): string {
  return crypto.randomUUID();
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function errorMessage(cause: unknown): string {
  return cause instanceof Error ? cause.message : String(cause);
}

function promptDraftKey(taskId: string | null): string {
  return `${promptDraftStoragePrefix}${taskId ?? "new"}`;
}

function readPromptDraft(taskId: string | null): string {
  try {
    return window.localStorage.getItem(promptDraftKey(taskId)) ?? "";
  } catch {
    return "";
  }
}

function persistPromptDraft(taskId: string | null, prompt: string): void {
  try {
    const key = promptDraftKey(taskId);
    if (prompt) {
      window.localStorage.setItem(key, prompt);
    } else {
      window.localStorage.removeItem(key);
    }
  } catch {
    // Draft persistence is best-effort and must never block the composer.
  }
}

function clearPromptDraft(taskId: string | null): void {
  try {
    window.localStorage.removeItem(promptDraftKey(taskId));
  } catch {
    // Draft persistence is best-effort and must never block task lifecycle.
  }
}
