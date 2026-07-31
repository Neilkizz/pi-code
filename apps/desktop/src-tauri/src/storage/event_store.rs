use super::database::Database;
use crate::agent::protocol::DESKTOP_PROTOCOL_VERSION;
use rusqlite::{params, Connection, OptionalExtension, Transaction};
use serde::Serialize;
use serde_json::Value;
use std::path::Path;
use std::time::{SystemTime, UNIX_EPOCH};

#[derive(Debug, Clone, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct PersistedTaskEvent {
    pub event_id: i64,
    pub message_id: String,
    pub protocol_version: i64,
    pub task_id: String,
    pub worker_id: String,
    pub seq: i64,
    pub kind: String,
    pub timestamp: i64,
    pub correlation_id: Option<String>,
    pub message: Value,
    pub persisted_at: i64,
}

#[derive(Debug, Clone, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct PersistedTaskSnapshot {
    pub event_id: i64,
    pub worker_id: String,
    pub seq: i64,
    pub status: Value,
    pub updated_at: i64,
}

#[derive(Debug, Clone, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct TaskEventReplay {
    pub snapshot: Option<PersistedTaskSnapshot>,
    pub events: Vec<PersistedTaskEvent>,
    pub next_cursor: i64,
    pub has_more: bool,
}

#[derive(Debug, Clone, PartialEq)]
pub enum AppendOutcome {
    Stored(PersistedTaskEvent),
    Duplicate(PersistedTaskEvent),
    NotTaskScoped,
}

pub struct EventStore {
    connection: Connection,
}

impl EventStore {
    pub fn open(path: &Path) -> Result<Self, String> {
        let database = Database::open(path.to_path_buf())?;
        Ok(Self {
            connection: database.connection()?,
        })
    }

    pub fn append_message(&mut self, message: &Value) -> Result<AppendOutcome, String> {
        let Some(envelope) = EventEnvelope::parse(message)? else {
            return Ok(AppendOutcome::NotTaskScoped);
        };
        let payload_json = serde_json::to_string(message)
            .map_err(|error| format!("serialize task event: {error}"))?;
        let persisted_at = unix_millis()?;
        let transaction = self
            .connection
            .transaction()
            .map_err(|error| format!("begin task event transaction: {error}"))?;

        if let Some(existing) = find_collision(&transaction, &envelope)? {
            if event_matches(&existing, &envelope, &payload_json) {
                transaction
                    .commit()
                    .map_err(|error| format!("finish duplicate event check: {error}"))?;
                return Ok(AppendOutcome::Duplicate(existing));
            }
            return Err(format!(
                "task event identity collision for task {}, worker {}, seq {}",
                envelope.task_id, envelope.worker_id, envelope.seq
            ));
        }

        transaction
            .execute(
                "INSERT INTO task_events(
                    message_id, protocol_version, task_id, worker_id, seq,
                    kind, timestamp, correlation_id, payload_json, persisted_at
                 ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10)",
                params![
                    envelope.message_id,
                    envelope.protocol_version,
                    envelope.task_id,
                    envelope.worker_id,
                    envelope.seq,
                    envelope.kind,
                    envelope.timestamp,
                    envelope.correlation_id,
                    payload_json,
                    persisted_at
                ],
            )
            .map_err(|error| format!("append task event: {error}"))?;
        let event_id = transaction.last_insert_rowid();
        if envelope.kind == "task.status" {
            let status = message
                .get("task")
                .cloned()
                .ok_or_else(|| "task.status event has no task state".to_string())?;
            let status_json = serde_json::to_string(&status)
                .map_err(|error| format!("serialize task snapshot: {error}"))?;
            transaction
                .execute(
                    "INSERT INTO task_snapshots(
                        task_id, event_id, worker_id, seq, status_json, updated_at
                     ) VALUES (?1, ?2, ?3, ?4, ?5, ?6)
                     ON CONFLICT(task_id) DO UPDATE SET
                        event_id = excluded.event_id,
                        worker_id = excluded.worker_id,
                        seq = excluded.seq,
                        status_json = excluded.status_json,
                        updated_at = excluded.updated_at
                     WHERE excluded.event_id > task_snapshots.event_id",
                    params![
                        envelope.task_id,
                        event_id,
                        envelope.worker_id,
                        envelope.seq,
                        status_json,
                        persisted_at
                    ],
                )
                .map_err(|error| format!("update task event snapshot: {error}"))?;
        }
        let stored = PersistedTaskEvent {
            event_id,
            message_id: envelope.message_id.to_string(),
            protocol_version: envelope.protocol_version,
            task_id: envelope.task_id.to_string(),
            worker_id: envelope.worker_id.to_string(),
            seq: envelope.seq,
            kind: envelope.kind.to_string(),
            timestamp: envelope.timestamp,
            correlation_id: envelope.correlation_id.map(str::to_string),
            message: message.clone(),
            persisted_at,
        };
        transaction
            .commit()
            .map_err(|error| format!("commit task event: {error}"))?;
        Ok(AppendOutcome::Stored(stored))
    }

    pub fn replay(
        &self,
        task_id: &str,
        after_event_id: Option<i64>,
        requested_limit: Option<u32>,
    ) -> Result<TaskEventReplay, String> {
        let task_id = task_id.trim();
        if task_id.is_empty() {
            return Err("Task id is required for event replay".into());
        }
        let after_event_id = after_event_id.unwrap_or(0);
        if after_event_id < 0 {
            return Err("Event cursor must be non-negative".into());
        }
        let limit = requested_limit.unwrap_or(250).clamp(1, 1_000) as i64;
        let snapshot = self
            .connection
            .query_row(
                "SELECT event_id, worker_id, seq, status_json, updated_at
                 FROM task_snapshots WHERE task_id = ?1",
                [task_id],
                |row| {
                    let status_json: String = row.get(3)?;
                    Ok((
                        row.get(0)?,
                        row.get(1)?,
                        row.get(2)?,
                        status_json,
                        row.get(4)?,
                    ))
                },
            )
            .optional()
            .map_err(|error| format!("load task snapshot: {error}"))?
            .map(
                |(
                    event_id,
                    worker_id,
                    seq,
                    status_json,
                    updated_at,
                )|
                 -> Result<PersistedTaskSnapshot, String> {
                    Ok(PersistedTaskSnapshot {
                        event_id,
                        worker_id,
                        seq,
                        status: serde_json::from_str(&status_json)
                            .map_err(|error| format!("decode task snapshot: {error}"))?,
                        updated_at,
                    })
                },
            )
            .transpose()?;

        let mut statement = self
            .connection
            .prepare(
                "SELECT id, message_id, protocol_version, task_id, worker_id, seq,
                        kind, timestamp, correlation_id, payload_json, persisted_at
                 FROM task_events
                 WHERE task_id = ?1 AND id > ?2
                 ORDER BY id ASC
                 LIMIT ?3",
            )
            .map_err(|error| format!("prepare task event replay: {error}"))?;
        let rows = statement
            .query_map(params![task_id, after_event_id, limit + 1], map_event_row)
            .map_err(|error| format!("query task event replay: {error}"))?;
        let mut events = Vec::new();
        for row in rows {
            let raw = row.map_err(|error| format!("read task event replay: {error}"))?;
            events.push(raw.decode()?);
        }
        let has_more = events.len() as i64 > limit;
        if has_more {
            events.truncate(limit as usize);
        }
        let next_cursor = events
            .last()
            .map(|event| event.event_id)
            .unwrap_or(after_event_id);
        Ok(TaskEventReplay {
            snapshot,
            events,
            next_cursor,
            has_more,
        })
    }
}

struct EventEnvelope<'a> {
    message_id: &'a str,
    protocol_version: i64,
    task_id: &'a str,
    worker_id: &'a str,
    seq: i64,
    kind: &'a str,
    timestamp: i64,
    correlation_id: Option<&'a str>,
}

impl<'a> EventEnvelope<'a> {
    fn parse(message: &'a Value) -> Result<Option<Self>, String> {
        let Some(task_id) = message.get("taskId").and_then(Value::as_str) else {
            return Ok(None);
        };
        if task_id.trim().is_empty() {
            return Err("Task-scoped Host event has an empty taskId".into());
        }
        let protocol_version = required_i64(message, "protocolVersion")?;
        if protocol_version != i64::from(DESKTOP_PROTOCOL_VERSION) {
            return Err(format!(
                "Cannot persist Host protocol version {protocol_version}; expected {DESKTOP_PROTOCOL_VERSION}"
            ));
        }
        let seq = required_i64(message, "seq")?;
        if seq <= 0 {
            return Err("Task event seq must be positive".into());
        }
        let timestamp = required_i64(message, "timestamp")?;
        if timestamp < 0 {
            return Err("Task event timestamp must be non-negative".into());
        }
        Ok(Some(Self {
            message_id: required_str(message, "messageId")?,
            protocol_version,
            task_id,
            worker_id: required_str(message, "workerId")?,
            seq,
            kind: required_str(message, "type")?,
            timestamp,
            correlation_id: message.get("correlationId").and_then(Value::as_str),
        }))
    }
}

fn required_str<'a>(message: &'a Value, field: &str) -> Result<&'a str, String> {
    message
        .get(field)
        .and_then(Value::as_str)
        .filter(|value| !value.trim().is_empty())
        .ok_or_else(|| format!("Task event {field} must be a non-empty string"))
}

fn required_i64(message: &Value, field: &str) -> Result<i64, String> {
    message
        .get(field)
        .and_then(Value::as_i64)
        .ok_or_else(|| format!("Task event {field} must be an integer"))
}

fn find_collision(
    transaction: &Transaction<'_>,
    envelope: &EventEnvelope<'_>,
) -> Result<Option<PersistedTaskEvent>, String> {
    let raw = transaction
        .query_row(
            "SELECT id, message_id, protocol_version, task_id, worker_id, seq,
                    kind, timestamp, correlation_id, payload_json, persisted_at
             FROM task_events
             WHERE message_id = ?1
                OR (worker_id = ?2 AND task_id = ?3 AND seq = ?4)
             ORDER BY CASE WHEN message_id = ?1 THEN 0 ELSE 1 END
             LIMIT 1",
            params![
                envelope.message_id,
                envelope.worker_id,
                envelope.task_id,
                envelope.seq
            ],
            map_event_row,
        )
        .optional()
        .map_err(|error| format!("check task event identity: {error}"))?;
    raw.map(RawTaskEvent::decode).transpose()
}

fn event_matches(
    existing: &PersistedTaskEvent,
    envelope: &EventEnvelope<'_>,
    payload_json: &str,
) -> bool {
    existing.message_id == envelope.message_id
        && existing.protocol_version == envelope.protocol_version
        && existing.task_id == envelope.task_id
        && existing.worker_id == envelope.worker_id
        && existing.seq == envelope.seq
        && existing.kind == envelope.kind
        && existing.timestamp == envelope.timestamp
        && existing.correlation_id.as_deref() == envelope.correlation_id
        && serde_json::to_string(&existing.message).ok().as_deref() == Some(payload_json)
}

struct RawTaskEvent {
    event_id: i64,
    message_id: String,
    protocol_version: i64,
    task_id: String,
    worker_id: String,
    seq: i64,
    kind: String,
    timestamp: i64,
    correlation_id: Option<String>,
    payload_json: String,
    persisted_at: i64,
}

impl RawTaskEvent {
    fn decode(self) -> Result<PersistedTaskEvent, String> {
        Ok(PersistedTaskEvent {
            event_id: self.event_id,
            message_id: self.message_id,
            protocol_version: self.protocol_version,
            task_id: self.task_id,
            worker_id: self.worker_id,
            seq: self.seq,
            kind: self.kind,
            timestamp: self.timestamp,
            correlation_id: self.correlation_id,
            message: serde_json::from_str(&self.payload_json)
                .map_err(|error| format!("decode persisted task event: {error}"))?,
            persisted_at: self.persisted_at,
        })
    }
}

fn map_event_row(row: &rusqlite::Row<'_>) -> rusqlite::Result<RawTaskEvent> {
    Ok(RawTaskEvent {
        event_id: row.get(0)?,
        message_id: row.get(1)?,
        protocol_version: row.get(2)?,
        task_id: row.get(3)?,
        worker_id: row.get(4)?,
        seq: row.get(5)?,
        kind: row.get(6)?,
        timestamp: row.get(7)?,
        correlation_id: row.get(8)?,
        payload_json: row.get(9)?,
        persisted_at: row.get(10)?,
    })
}

fn unix_millis() -> Result<i64, String> {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|duration| duration.as_millis() as i64)
        .map_err(|error| error.to_string())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::storage::app_paths::AppPaths;
    use crate::storage::database::Database;
    use serde_json::json;
    use std::fs;
    use uuid::Uuid;

    fn test_paths() -> AppPaths {
        let root = std::env::temp_dir().join(format!("pi-events-test-{}", Uuid::new_v4()));
        AppPaths {
            logs: root.join("logs"),
            attachments: root.join("attachments"),
            packages: root.join("packages"),
            extension_packages: root.join("packages/extensions"),
            backups: root.join("backups"),
            worktrees: root.join("worktrees"),
            database_file: root.join("pi-desktop.sqlite3"),
            endpoints_file: root.join("endpoints.json"),
            extensions_file: root.join("extensions.json"),
            tasks_file: root.join("tasks.json"),
            root,
        }
    }

    fn event(seq: i64, kind: &str) -> Value {
        let mut value = json!({
            "protocolVersion": DESKTOP_PROTOCOL_VERSION,
            "messageId": format!("message-{seq}"),
            "taskId": "task-1",
            "workerId": "worker-1",
            "seq": seq,
            "type": kind,
            "timestamp": 1_700_000_000_000_i64
        });
        if kind == "task.status" {
            value["task"] = json!({
                "id": "task-1",
                "cwd": "/tmp/project",
                "status": "running",
                "profile": { "permissionMode": "ask" }
            });
        } else {
            value["event"] = json!({ "type": "agent_start" });
        }
        value
    }

    #[test]
    fn appends_replays_and_deduplicates_task_events() {
        let paths = test_paths();
        Database::initialize(&paths).unwrap();
        let mut store = EventStore::open(&paths.database_file).unwrap();
        assert!(matches!(
            store.append_message(&event(1, "task.status")).unwrap(),
            AppendOutcome::Stored(_)
        ));
        assert!(matches!(
            store.append_message(&event(1, "task.status")).unwrap(),
            AppendOutcome::Duplicate(_)
        ));
        store
            .append_message(&event(2, "task.event"))
            .expect("second event");

        let first_page = store.replay("task-1", None, Some(1)).unwrap();
        assert_eq!(first_page.events.len(), 1);
        assert!(first_page.has_more);
        assert_eq!(first_page.snapshot.unwrap().status["status"], "running");
        let second_page = store
            .replay("task-1", Some(first_page.next_cursor), Some(10))
            .unwrap();
        assert_eq!(second_page.events.len(), 1);
        assert_eq!(second_page.events[0].seq, 2);
        assert!(!second_page.has_more);
        drop(store);
        fs::remove_dir_all(paths.root).unwrap();
    }

    #[test]
    fn rejects_conflicting_payload_for_the_same_worker_sequence() {
        let paths = test_paths();
        Database::initialize(&paths).unwrap();
        let mut store = EventStore::open(&paths.database_file).unwrap();
        store
            .append_message(&event(1, "task.status"))
            .expect("first event");
        let mut conflicting = event(1, "task.status");
        conflicting["messageId"] = Value::from("different-message");
        conflicting["task"]["status"] = Value::from("failed");
        let error = store.append_message(&conflicting).unwrap_err();
        assert!(error.contains("identity collision"));
        drop(store);
        fs::remove_dir_all(paths.root).unwrap();
    }

    #[test]
    fn ignores_host_wide_events_but_rejects_malformed_task_events() {
        let paths = test_paths();
        Database::initialize(&paths).unwrap();
        let mut store = EventStore::open(&paths.database_file).unwrap();
        assert_eq!(
            store
                .append_message(&json!({
                    "protocolVersion": DESKTOP_PROTOCOL_VERSION,
                    "messageId": "host-status",
                    "workerId": "worker-1",
                    "type": "host.status",
                    "timestamp": 1
                }))
                .unwrap(),
            AppendOutcome::NotTaskScoped
        );
        let mut malformed = event(1, "task.event");
        malformed.as_object_mut().unwrap().remove("workerId");
        assert!(store.append_message(&malformed).is_err());
        drop(store);
        fs::remove_dir_all(paths.root).unwrap();
    }
}
