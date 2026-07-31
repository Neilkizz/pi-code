use keyring::v1::{Entry, Error as KeyringError};
use reqwest::blocking::Client;
use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::{
    collections::BTreeSet,
    fs::{self, OpenOptions},
    io::{Read, Write},
    os::unix::fs::{OpenOptionsExt, PermissionsExt},
    path::Path,
    time::{Duration, Instant, SystemTime, UNIX_EPOCH},
};
use url::Url;
use uuid::Uuid;

const STORE_VERSION: u32 = 1;
const KEYCHAIN_SERVICE: &str = "com.pi-desktop.app.endpoint";
const MAX_ENDPOINT_RESPONSE_BYTES: u64 = 2 * 1024 * 1024;

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "kebab-case")]
pub enum EndpointKind {
    OpenaiCompatible,
    AnthropicCompatible,
    Ollama,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct EndpointProfile {
    pub id: String,
    pub provider_id: String,
    pub name: String,
    pub kind: EndpointKind,
    pub base_url: String,
    pub default_model: Option<String>,
    pub models: Vec<String>,
    pub enabled: bool,
    pub is_default: bool,
    pub credential_ref: Option<String>,
    pub created_at: u64,
    pub updated_at: u64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct EndpointProfileView {
    #[serde(flatten)]
    pub profile: EndpointProfile,
    pub has_api_key: bool,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct EndpointDraft {
    pub id: Option<String>,
    pub name: String,
    pub kind: EndpointKind,
    pub base_url: String,
    pub default_model: Option<String>,
    #[serde(default)]
    pub models: Vec<String>,
    #[serde(default = "default_true")]
    pub enabled: bool,
    #[serde(default)]
    pub is_default: bool,
    pub api_key: Option<String>,
    #[serde(default)]
    pub clear_api_key: bool,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct EndpointDiscoveryDraft {
    pub id: Option<String>,
    pub kind: EndpointKind,
    pub base_url: String,
    pub api_key: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct EndpointRuntimeConfig {
    pub id: String,
    pub name: String,
    pub kind: EndpointKind,
    pub base_url: String,
    pub api_key: Option<String>,
    pub models: Vec<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct EndpointTestResult {
    pub reachable: bool,
    pub authenticated: bool,
    pub status_code: u16,
    pub latency_ms: u128,
    pub models: Vec<String>,
    pub message: String,
}

#[derive(Debug, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct EndpointStoreFile {
    version: u32,
    endpoints: Vec<EndpointProfile>,
}

pub struct EndpointStore;

impl EndpointStore {
    pub fn list(path: &Path) -> Result<Vec<EndpointProfileView>, String> {
        Ok(load(path)?.endpoints.into_iter().map(to_view).collect())
    }

    pub fn save(path: &Path, draft: EndpointDraft) -> Result<EndpointProfileView, String> {
        let mut store = load(path)?;
        let now = unix_millis()?;
        let base_url = normalize_url(&draft.base_url)?;
        let name = required(&draft.name, "Endpoint name")?;
        let id = draft
            .id
            .filter(|value| !value.trim().is_empty())
            .unwrap_or_else(|| Uuid::new_v4().to_string());
        let existing = store
            .endpoints
            .iter()
            .find(|endpoint| endpoint.id == id)
            .cloned();
        let credential_ref = existing
            .as_ref()
            .and_then(|endpoint| endpoint.credential_ref.clone());
        let credential_ref = update_credential(
            &id,
            credential_ref,
            draft.api_key.as_deref(),
            draft.clear_api_key,
        )?;
        let models = normalized_models(draft.models, draft.default_model.as_deref());
        let default_model = draft
            .default_model
            .map(|model| model.trim().to_string())
            .filter(|model| !model.is_empty())
            .or_else(|| models.first().cloned());
        let is_first = store.endpoints.is_empty();
        let is_default = draft.is_default || is_first;

        if is_default {
            for endpoint in &mut store.endpoints {
                endpoint.is_default = false;
            }
        }

        let profile = EndpointProfile {
            provider_id: existing
                .as_ref()
                .map(|endpoint| endpoint.provider_id.clone())
                .unwrap_or_else(|| format!("desktop-{}", id.replace('-', ""))),
            id: id.clone(),
            name,
            kind: draft.kind,
            base_url,
            default_model,
            models,
            enabled: draft.enabled,
            is_default,
            credential_ref,
            created_at: existing
                .as_ref()
                .map(|endpoint| endpoint.created_at)
                .unwrap_or(now),
            updated_at: now,
        };

        if let Some(index) = store
            .endpoints
            .iter()
            .position(|endpoint| endpoint.id == id)
        {
            store.endpoints[index] = profile.clone();
        } else {
            store.endpoints.push(profile.clone());
        }
        store.version = STORE_VERSION;
        persist(path, &store)?;
        Ok(to_view(profile))
    }

    pub fn delete(path: &Path, id: &str) -> Result<(), String> {
        let mut store = load(path)?;
        let index = store
            .endpoints
            .iter()
            .position(|endpoint| endpoint.id == id)
            .ok_or_else(|| format!("Unknown endpoint: {id}"))?;
        let removed = store.endpoints.remove(index);

        if let Some(reference) = removed.credential_ref {
            delete_secret(&reference)?;
        }
        if removed.is_default {
            if let Some(next) = store.endpoints.iter_mut().find(|endpoint| endpoint.enabled) {
                next.is_default = true;
            }
        }
        persist(path, &store)
    }

    pub fn runtime_configs(path: &Path) -> Result<Vec<EndpointRuntimeConfig>, String> {
        load(path)?
            .endpoints
            .into_iter()
            .filter(|endpoint| endpoint.enabled)
            .map(|endpoint| {
                let api_key = endpoint
                    .credential_ref
                    .as_deref()
                    .map(read_secret)
                    .transpose()?;
                Ok(EndpointRuntimeConfig {
                    id: endpoint.provider_id,
                    name: endpoint.name,
                    kind: endpoint.kind,
                    base_url: endpoint.base_url,
                    api_key,
                    models: endpoint.models,
                })
            })
            .collect()
    }

    pub fn test(path: &Path, id: &str) -> Result<EndpointTestResult, String> {
        let endpoint = load(path)?
            .endpoints
            .into_iter()
            .find(|endpoint| endpoint.id == id)
            .ok_or_else(|| format!("Unknown endpoint: {id}"))?;
        let api_key = endpoint
            .credential_ref
            .as_deref()
            .map(read_secret)
            .transpose()?;
        test_endpoint(&endpoint, api_key.as_deref())
    }

    pub fn discover(
        path: &Path,
        draft: EndpointDiscoveryDraft,
    ) -> Result<EndpointTestResult, String> {
        let existing = draft.id.as_deref().and_then(|id| {
            load(path)
                .ok()?
                .endpoints
                .into_iter()
                .find(|endpoint| endpoint.id == id)
        });
        let supplied_key = draft
            .api_key
            .as_deref()
            .map(str::trim)
            .filter(|key| !key.is_empty())
            .map(str::to_string);
        let api_key = if supplied_key.is_some() {
            supplied_key
        } else {
            existing
                .as_ref()
                .and_then(|endpoint| endpoint.credential_ref.as_deref())
                .map(read_secret)
                .transpose()?
        };
        let endpoint = EndpointProfile {
            id: existing
                .as_ref()
                .map(|endpoint| endpoint.id.clone())
                .unwrap_or_else(|| "unsaved".into()),
            provider_id: existing
                .as_ref()
                .map(|endpoint| endpoint.provider_id.clone())
                .unwrap_or_else(|| "desktop-discovery".into()),
            name: existing
                .as_ref()
                .map(|endpoint| endpoint.name.clone())
                .unwrap_or_else(|| "Endpoint discovery".into()),
            kind: draft.kind,
            base_url: normalize_url(&draft.base_url)?,
            default_model: None,
            models: Vec::new(),
            enabled: true,
            is_default: false,
            credential_ref: None,
            created_at: 0,
            updated_at: 0,
        };
        test_endpoint(&endpoint, api_key.as_deref())
    }
}

fn load(path: &Path) -> Result<EndpointStoreFile, String> {
    if !path.exists() {
        return Ok(EndpointStoreFile {
            version: STORE_VERSION,
            endpoints: Vec::new(),
        });
    }
    let content = fs::read_to_string(path).map_err(|error| error.to_string())?;
    if content.trim().is_empty() {
        return Ok(EndpointStoreFile {
            version: STORE_VERSION,
            endpoints: Vec::new(),
        });
    }
    let store: EndpointStoreFile = serde_json::from_str(&content)
        .map_err(|error| format!("invalid endpoints.json: {error}"))?;
    if store.version > STORE_VERSION {
        return Err(format!(
            "endpoints.json version {} is newer than supported version {STORE_VERSION}",
            store.version
        ));
    }
    Ok(store)
}

fn persist(path: &Path, store: &EndpointStoreFile) -> Result<(), String> {
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent).map_err(|error| error.to_string())?;
    }
    let temporary = path.with_extension("json.tmp");
    let encoded =
        serde_json::to_vec_pretty(store).map_err(|error| format!("serialize endpoint: {error}"))?;
    let mut file = OpenOptions::new()
        .create(true)
        .truncate(true)
        .write(true)
        .mode(0o600)
        .open(&temporary)
        .map_err(|error| error.to_string())?;
    file.write_all(&encoded)
        .map_err(|error| error.to_string())?;
    file.sync_all().map_err(|error| error.to_string())?;
    fs::set_permissions(&temporary, fs::Permissions::from_mode(0o600))
        .map_err(|error| error.to_string())?;
    fs::rename(temporary, path).map_err(|error| error.to_string())
}

fn update_credential(
    endpoint_id: &str,
    existing_ref: Option<String>,
    api_key: Option<&str>,
    clear: bool,
) -> Result<Option<String>, String> {
    if clear {
        if let Some(reference) = existing_ref.as_deref() {
            delete_secret(reference)?;
        }
        return Ok(None);
    }

    if let Some(api_key) = api_key {
        if !api_key.is_empty() {
            let reference =
                existing_ref.unwrap_or_else(|| format!("endpoint/{endpoint_id}/api-key"));
            keychain_entry(&reference)?
                .set_password(api_key)
                .map_err(|error| format!("Keychain write failed: {error}"))?;
            return Ok(Some(reference));
        }
    }

    Ok(existing_ref)
}

fn read_secret(reference: &str) -> Result<String, String> {
    keychain_entry(reference)?
        .get_password()
        .map_err(|error| format!("Keychain read failed for {reference}: {error}"))
}

fn delete_secret(reference: &str) -> Result<(), String> {
    match keychain_entry(reference)?.delete_credential() {
        Ok(()) | Err(KeyringError::NoEntry) => Ok(()),
        Err(error) => Err(format!("Keychain delete failed for {reference}: {error}")),
    }
}

fn keychain_entry(reference: &str) -> Result<Entry, String> {
    Entry::new(KEYCHAIN_SERVICE, reference)
        .map_err(|error| format!("Keychain entry failed: {error}"))
}

fn test_endpoint(
    endpoint: &EndpointProfile,
    api_key: Option<&str>,
) -> Result<EndpointTestResult, String> {
    let url = format!("{}/models", endpoint.base_url.trim_end_matches('/'));
    let client = Client::builder()
        .timeout(Duration::from_secs(15))
        .build()
        .map_err(|error| error.to_string())?;
    let mut request = client.get(url);

    match endpoint.kind {
        EndpointKind::AnthropicCompatible => {
            request = request.header("anthropic-version", "2023-06-01");
            if let Some(key) = api_key {
                request = request.header("x-api-key", key);
            }
        }
        EndpointKind::OpenaiCompatible => {
            if let Some(key) = api_key {
                request = request.bearer_auth(key);
            }
        }
        EndpointKind::Ollama => {}
    }

    let started = Instant::now();
    let response = request.send().map_err(|error| error.to_string())?;
    let latency_ms = started.elapsed().as_millis();
    let status = response.status();
    let status_code = status.as_u16();
    let authenticated = status_code != 401 && status_code != 403;
    let mut body_bytes = Vec::new();
    response
        .take(MAX_ENDPOINT_RESPONSE_BYTES + 1)
        .read_to_end(&mut body_bytes)
        .map_err(|error| format!("Failed to read endpoint response: {error}"))?;
    let body = if body_bytes.len() as u64 > MAX_ENDPOINT_RESPONSE_BYTES {
        Value::Null
    } else {
        serde_json::from_slice(&body_bytes).unwrap_or(Value::Null)
    };
    let models = extract_models(&body);
    let reachable = status_code < 500;

    Ok(EndpointTestResult {
        reachable,
        authenticated,
        status_code,
        latency_ms,
        models,
        message: if status.is_success() {
            "Connection successful".into()
        } else if !authenticated {
            "Endpoint reached, but authentication was rejected".into()
        } else {
            format!("Endpoint returned HTTP {status_code}")
        },
    })
}

fn extract_models(value: &Value) -> Vec<String> {
    let candidates = value
        .get("data")
        .and_then(Value::as_array)
        .or_else(|| value.get("models").and_then(Value::as_array));
    let mut models = BTreeSet::new();
    for item in candidates.into_iter().flatten() {
        if let Some(id) = item
            .get("id")
            .or_else(|| item.get("name"))
            .or_else(|| item.get("model"))
            .and_then(Value::as_str)
        {
            models.insert(id.to_string());
        }
    }
    models.into_iter().collect()
}

fn normalize_url(input: &str) -> Result<String, String> {
    let trimmed = required(input, "Base URL")?;
    let url = Url::parse(&trimmed).map_err(|error| format!("Invalid Base URL: {error}"))?;
    if !matches!(url.scheme(), "http" | "https") {
        return Err("Base URL must use http or https".into());
    }
    if !url.username().is_empty() || url.password().is_some() {
        return Err("Base URL must not contain embedded credentials".into());
    }
    if url.host_str().is_none() {
        return Err("Base URL must include a host".into());
    }
    Ok(trimmed.trim_end_matches('/').to_string())
}

fn normalized_models(models: Vec<String>, default_model: Option<&str>) -> Vec<String> {
    let mut result = BTreeSet::new();
    for model in models {
        let model = model.trim();
        if !model.is_empty() {
            result.insert(model.to_string());
        }
    }
    if let Some(model) = default_model
        .map(str::trim)
        .filter(|model| !model.is_empty())
    {
        result.insert(model.to_string());
    }
    result.into_iter().collect()
}

fn required(value: &str, field: &str) -> Result<String, String> {
    let value = value.trim();
    if value.is_empty() {
        Err(format!("{field} is required"))
    } else {
        Ok(value.to_string())
    }
}

fn unix_millis() -> Result<u64, String> {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|duration| duration.as_millis() as u64)
        .map_err(|error| error.to_string())
}

fn to_view(profile: EndpointProfile) -> EndpointProfileView {
    EndpointProfileView {
        has_api_key: profile.credential_ref.is_some(),
        profile,
    }
}

fn default_true() -> bool {
    true
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::os::unix::fs::PermissionsExt;

    #[test]
    fn rejects_credentials_embedded_in_base_url() {
        assert!(normalize_url("https://user:secret@example.com/v1").is_err());
    }

    #[test]
    fn normalizes_models_without_duplicates() {
        assert_eq!(
            normalized_models(
                vec!["model-b".into(), "model-a".into(), "model-a".into()],
                Some("model-c")
            ),
            vec!["model-a", "model-b", "model-c"]
        );
    }

    #[test]
    fn extracts_openai_and_ollama_model_shapes() {
        assert_eq!(
            extract_models(&serde_json::json!({"data": [{"id": "gpt-test"}]})),
            vec!["gpt-test"]
        );
        assert_eq!(
            extract_models(&serde_json::json!({"models": [{"name": "qwen:test"}]})),
            vec!["qwen:test"]
        );
    }

    #[test]
    fn persists_endpoint_without_serializing_api_key_fields() {
        let directory = std::env::temp_dir().join(format!("pi-endpoint-test-{}", Uuid::new_v4()));
        let path = directory.join("endpoints.json");
        let saved = EndpointStore::save(
            &path,
            EndpointDraft {
                id: None,
                name: "Local Test".into(),
                kind: EndpointKind::Ollama,
                base_url: "http://localhost:11434/v1/".into(),
                default_model: Some("qwen:test".into()),
                models: vec!["qwen:test".into()],
                enabled: true,
                is_default: false,
                api_key: None,
                clear_api_key: false,
            },
        )
        .expect("endpoint should save");

        let content = fs::read_to_string(&path).expect("endpoint file should exist");
        assert!(!content.contains("apiKey"));
        assert!(!content.contains("clearApiKey"));
        assert_eq!(saved.profile.base_url, "http://localhost:11434/v1");
        assert_eq!(
            fs::metadata(&path).expect("metadata").permissions().mode() & 0o777,
            0o600
        );
        assert_eq!(EndpointStore::list(&path).expect("list").len(), 1);

        fs::remove_dir_all(directory).expect("temporary endpoint directory cleanup");
    }
}
