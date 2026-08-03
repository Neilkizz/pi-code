use serde::{Deserialize, Serialize};
use serde_json::Value;

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum CapabilityAction {
    FsRead,
    FsWrite,
    FsDelete,
    ProcessInspect,
    ProcessExec,
    NetworkConnect,
    SecretRead,
    GitWrite,
    ExtensionInvoke,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum CapabilityScope {
    Project,
    Worktree,
    AppData,
    Endpoint,
    External,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct CapabilityRequest {
    pub task_id: String,
    pub request_id: String,
    pub action: CapabilityAction,
    pub scope: CapabilityScope,
    pub target: String,
    pub arguments: Value,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum PermissionMode {
    Ask,
    AcceptEdits,
    Plan,
    Auto,
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(tag = "decision", rename_all = "camelCase")]
pub enum PolicyDecision {
    Allow { reason: String },
    NeedsApproval { reason: String },
    Deny { reason: String },
}

#[derive(Debug, Clone, Default)]
pub struct PolicyEngine {
    strong_isolation_available: bool,
}

impl PolicyEngine {
    pub fn evaluate(&self, request: &CapabilityRequest, mode: PermissionMode) -> PolicyDecision {
        if request.task_id.trim().is_empty() || request.request_id.trim().is_empty() {
            return PolicyDecision::Deny {
                reason: "Capability request is missing task or request identity".into(),
            };
        }
        if request.target.contains('\0') {
            return PolicyDecision::Deny {
                reason: "Capability target contains invalid data".into(),
            };
        }
        if matches!(request.action, CapabilityAction::SecretRead)
            && !matches!(request.scope, CapabilityScope::Endpoint)
        {
            return PolicyDecision::Deny {
                reason: "Secrets may only be requested through an Endpoint scope".into(),
            };
        }
        if matches!(request.scope, CapabilityScope::External)
            && matches!(
                request.action,
                CapabilityAction::FsWrite | CapabilityAction::FsDelete | CapabilityAction::GitWrite
            )
        {
            return PolicyDecision::Deny {
                reason: "Writes outside the authorized Project or Worktree are denied".into(),
            };
        }

        match mode {
            PermissionMode::Plan => self.evaluate_plan(request),
            PermissionMode::Ask => self.evaluate_ask(request),
            PermissionMode::AcceptEdits => self.evaluate_accept_edits(request),
            PermissionMode::Auto => self.evaluate_auto(request),
        }
    }

    fn evaluate_plan(&self, request: &CapabilityRequest) -> PolicyDecision {
        match request.action {
            CapabilityAction::FsRead | CapabilityAction::ProcessInspect => PolicyDecision::Allow {
                reason: "Plan mode permits bounded read-only inspection".into(),
            },
            _ => PolicyDecision::Deny {
                reason: "Plan mode blocks mutating, network, secret, and extension capabilities"
                    .into(),
            },
        }
    }

    fn evaluate_ask(&self, request: &CapabilityRequest) -> PolicyDecision {
        match request.action {
            CapabilityAction::FsRead
                if matches!(
                    request.scope,
                    CapabilityScope::Project | CapabilityScope::Worktree
                ) =>
            {
                PolicyDecision::Allow {
                    reason: "Bounded reads inside the active project are allowed".into(),
                }
            }
            _ => PolicyDecision::NeedsApproval {
                reason: "Ask mode requires a user decision for this capability".into(),
            },
        }
    }

    fn evaluate_accept_edits(&self, request: &CapabilityRequest) -> PolicyDecision {
        match request.action {
            CapabilityAction::FsRead | CapabilityAction::FsWrite
                if matches!(request.scope, CapabilityScope::Worktree) =>
            {
                PolicyDecision::Allow {
                    reason: "Accept Edits permits brokered file access inside the task worktree"
                        .into(),
                }
            }
            CapabilityAction::FsRead if matches!(request.scope, CapabilityScope::Project) => {
                PolicyDecision::Allow {
                    reason: "Accept Edits permits project reads".into(),
                }
            }
            CapabilityAction::FsDelete => PolicyDecision::NeedsApproval {
                reason: "Deletes remain explicit even in Accept Edits mode".into(),
            },
            _ => PolicyDecision::NeedsApproval {
                reason: "Shell, network, secret, Git, and extension actions require approval"
                    .into(),
            },
        }
    }

    fn evaluate_auto(&self, request: &CapabilityRequest) -> PolicyDecision {
        if !self.strong_isolation_available {
            return PolicyDecision::Deny {
                reason:
                    "Auto mode is disabled because no verified strong isolation backend is active"
                        .into(),
            };
        }
        if !matches!(request.scope, CapabilityScope::Worktree) {
            return PolicyDecision::Deny {
                reason: "Auto mode capabilities must stay inside the isolated worktree".into(),
            };
        }
        match request.action {
            CapabilityAction::FsRead
            | CapabilityAction::FsWrite
            | CapabilityAction::ProcessInspect => PolicyDecision::Allow {
                reason: "Strong isolation permits this scoped Auto capability".into(),
            },
            _ => PolicyDecision::NeedsApproval {
                reason: "This capability exceeds the default Auto allowlist".into(),
            },
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    fn request(action: CapabilityAction, scope: CapabilityScope) -> CapabilityRequest {
        CapabilityRequest {
            task_id: "task-1".into(),
            request_id: "request-1".into(),
            action,
            scope,
            target: "src/main.rs".into(),
            arguments: json!({}),
        }
    }

    #[test]
    fn plan_is_read_only_and_auto_fails_closed_without_isolation() {
        let engine = PolicyEngine::default();
        assert!(matches!(
            engine.evaluate(
                &request(CapabilityAction::FsRead, CapabilityScope::Project),
                PermissionMode::Plan
            ),
            PolicyDecision::Allow { .. }
        ));
        assert!(matches!(
            engine.evaluate(
                &request(CapabilityAction::FsWrite, CapabilityScope::Worktree),
                PermissionMode::Plan
            ),
            PolicyDecision::Deny { .. }
        ));
        assert!(matches!(
            engine.evaluate(
                &request(CapabilityAction::FsWrite, CapabilityScope::Worktree),
                PermissionMode::Auto
            ),
            PolicyDecision::Deny { .. }
        ));
    }

    #[test]
    fn accept_edits_allows_only_brokered_worktree_edits() {
        let engine = PolicyEngine::default();
        assert!(matches!(
            engine.evaluate(
                &request(CapabilityAction::FsWrite, CapabilityScope::Worktree),
                PermissionMode::AcceptEdits
            ),
            PolicyDecision::Allow { .. }
        ));
        assert!(matches!(
            engine.evaluate(
                &request(CapabilityAction::FsWrite, CapabilityScope::Project),
                PermissionMode::AcceptEdits
            ),
            PolicyDecision::NeedsApproval { .. }
        ));
        assert!(matches!(
            engine.evaluate(
                &request(CapabilityAction::FsDelete, CapabilityScope::Worktree),
                PermissionMode::AcceptEdits
            ),
            PolicyDecision::NeedsApproval { .. }
        ));
    }

    #[test]
    fn hard_policy_denies_external_writes_and_mis_scoped_secrets() {
        let engine = PolicyEngine {
            strong_isolation_available: true,
        };
        assert!(matches!(
            engine.evaluate(
                &request(CapabilityAction::FsWrite, CapabilityScope::External),
                PermissionMode::Ask
            ),
            PolicyDecision::Deny { .. }
        ));
        assert!(matches!(
            engine.evaluate(
                &request(CapabilityAction::SecretRead, CapabilityScope::Project),
                PermissionMode::Ask
            ),
            PolicyDecision::Deny { .. }
        ));
    }
}
