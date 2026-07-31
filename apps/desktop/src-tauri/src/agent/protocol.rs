use serde::{Deserialize, Serialize};
use serde_json::{Map, Value};
use std::time::{SystemTime, UNIX_EPOCH};
use uuid::Uuid;

pub const DESKTOP_PROTOCOL_VERSION: u32 = 2;

pub fn command_envelope(kind: &str, payload: Value) -> Result<Value, String> {
    let mut message = match payload {
        Value::Object(value) => value,
        _ => Map::new(),
    };
    let message_id = format!("command-{}", Uuid::new_v4());
    message.insert(
        "protocolVersion".into(),
        Value::from(DESKTOP_PROTOCOL_VERSION),
    );
    message.insert("messageId".into(), Value::from(message_id.clone()));
    message.insert("idempotencyKey".into(), Value::from(message_id));
    message.insert("timestamp".into(), Value::from(unix_millis()?));
    message.insert("type".into(), Value::from(kind));
    Ok(Value::Object(message))
}

fn unix_millis() -> Result<u64, String> {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|duration| duration.as_millis() as u64)
        .map_err(|error| error.to_string())
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DesktopBootstrap {
    pub app_data_dir: String,
    pub storage: DesktopStorageState,
    pub snapshot: DesktopShellSnapshot,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DesktopStorageState {
    pub schema_version: i64,
    pub imported_sources: usize,
    pub imported_records: usize,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DesktopShellSnapshot {
    pub status: String,
    pub host: DesktopHostState,
    pub tasks: Vec<DesktopTaskState>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DesktopHostState {
    pub status: String,
    pub runtime: String,
    pub version: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DesktopTaskState {
    pub id: String,
    pub cwd: String,
    pub status: String,
    pub profile: TaskRuntimeProfile,
    pub error: Option<String>,
    #[serde(default)]
    pub warnings: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct TaskRuntimeProfile {
    pub provider_id: Option<String>,
    pub model_id: Option<String>,
    pub permission_mode: String,
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn creates_versioned_command_envelope() {
        let value = command_envelope("host.bootstrap", json!({ "appDataDir": "/tmp/pi" }))
            .expect("envelope");
        assert_eq!(
            value["protocolVersion"],
            Value::from(DESKTOP_PROTOCOL_VERSION)
        );
        assert_eq!(value["type"], "host.bootstrap");
        assert_eq!(value["appDataDir"], "/tmp/pi");
        assert!(value["messageId"].as_str().is_some());
        assert_eq!(value["messageId"], value["idempotencyKey"]);
        assert!(value["timestamp"].as_u64().is_some());
    }
}
