use crate::policy::engine::CapabilityRequest;
use serde::Serialize;
use sha2::{Digest, Sha256};
use std::{
    collections::HashMap,
    sync::Mutex,
    time::{SystemTime, UNIX_EPOCH},
};
use uuid::Uuid;

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct CapabilityToken {
    pub id: String,
    pub task_id: String,
    pub expires_at: u64,
}

#[derive(Debug, Clone)]
struct TokenGrant {
    task_id: String,
    request_hash: String,
    expires_at: u64,
}

#[derive(Debug, Default)]
pub struct CapabilityTokenStore {
    grants: Mutex<HashMap<String, TokenGrant>>,
}

impl CapabilityTokenStore {
    pub fn issue(
        &self,
        request: &CapabilityRequest,
        ttl_millis: u64,
    ) -> Result<CapabilityToken, String> {
        if ttl_millis > 5 * 60 * 1_000 {
            return Err("Capability token lifetime cannot exceed five minutes".into());
        }
        let now = unix_millis()?;
        let id = format!("cap-{}", Uuid::new_v4());
        let grant = TokenGrant {
            task_id: request.task_id.clone(),
            request_hash: request_hash(request)?,
            expires_at: now.saturating_add(ttl_millis),
        };
        self.grants
            .lock()
            .map_err(|_| "Capability token store lock is poisoned".to_string())?
            .insert(id.clone(), grant.clone());
        Ok(CapabilityToken {
            id,
            task_id: grant.task_id,
            expires_at: grant.expires_at,
        })
    }

    pub fn consume(&self, token_id: &str, request: &CapabilityRequest) -> Result<(), String> {
        let grant = self
            .grants
            .lock()
            .map_err(|_| "Capability token store lock is poisoned".to_string())?
            .remove(token_id)
            .ok_or_else(|| {
                "Capability token is unknown, expired, revoked, or already used".to_string()
            })?;
        if unix_millis()? >= grant.expires_at {
            return Err("Capability token has expired".into());
        }
        if grant.task_id != request.task_id || grant.request_hash != request_hash(request)? {
            return Err("Capability token does not match this exact tool request".into());
        }
        Ok(())
    }

    pub fn revoke_task(&self, task_id: &str) -> Result<usize, String> {
        let mut grants = self
            .grants
            .lock()
            .map_err(|_| "Capability token store lock is poisoned".to_string())?;
        let initial = grants.len();
        grants.retain(|_, grant| grant.task_id != task_id);
        Ok(initial - grants.len())
    }
}

fn request_hash(request: &CapabilityRequest) -> Result<String, String> {
    let encoded = serde_json::to_vec(request)
        .map_err(|error| format!("serialize capability request: {error}"))?;
    Ok(format!("{:x}", Sha256::digest(encoded)))
}

fn unix_millis() -> Result<u64, String> {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|duration| duration.as_millis() as u64)
        .map_err(|error| error.to_string())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::policy::engine::{CapabilityAction, CapabilityScope};
    use serde_json::json;

    fn request(id: &str) -> CapabilityRequest {
        CapabilityRequest {
            task_id: "task-1".into(),
            request_id: id.into(),
            action: CapabilityAction::FsWrite,
            scope: CapabilityScope::Worktree,
            target: "src/main.rs".into(),
            arguments: json!({ "bytes": 12 }),
        }
    }

    #[test]
    fn token_is_single_use_and_bound_to_exact_request() {
        let store = CapabilityTokenStore::default();
        let original = request("request-1");
        let token = store.issue(&original, 10_000).unwrap();
        let mut changed = original.clone();
        changed.target = "Cargo.toml".into();
        assert!(store.consume(&token.id, &changed).is_err());
        assert!(store.consume(&token.id, &original).is_err());

        let token = store.issue(&original, 10_000).unwrap();
        store.consume(&token.id, &original).unwrap();
        assert!(store.consume(&token.id, &original).is_err());
    }

    #[test]
    fn task_revocation_and_expiry_fail_closed() {
        let store = CapabilityTokenStore::default();
        let original = request("request-1");
        let token = store.issue(&original, 10_000).unwrap();
        assert_eq!(store.revoke_task("task-1").unwrap(), 1);
        assert!(store.consume(&token.id, &original).is_err());

        let expired = store.issue(&original, 0).unwrap();
        assert!(store.consume(&expired.id, &original).is_err());
    }
}
