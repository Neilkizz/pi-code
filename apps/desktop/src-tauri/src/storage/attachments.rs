use super::{app_paths::AppPaths, database::Database, task_repository::TaskRepository};
use rusqlite::{params, OptionalExtension};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::{
    fs::{self, OpenOptions},
    io::{Read, Write},
    os::unix::fs::{OpenOptionsExt, PermissionsExt},
    path::{Path, PathBuf},
    time::{SystemTime, UNIX_EPOCH},
};
use uuid::Uuid;

const MAX_ATTACHMENT_BYTES: u64 = 25 * 1024 * 1024;
const MAX_ATTACHMENT_BATCH_BYTES: u64 = 100 * 1024 * 1024;
const MAX_ATTACHMENT_BATCH_FILES: usize = 20;

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct TaskAttachment {
    pub id: String,
    pub task_id: String,
    pub kind: String,
    pub name: String,
    pub path: String,
    pub mime_type: String,
    pub size: u64,
    pub sha256: String,
    pub created_at: u64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct AttachmentMetadata {
    name: String,
    mime_type: String,
    size: u64,
}

pub struct AttachmentStore;

impl AttachmentStore {
    pub fn list(database_path: &Path, task_id: &str) -> Result<Vec<TaskAttachment>, String> {
        require_task(database_path, task_id)?;
        let connection = Database::open(database_path.to_path_buf())?.connection()?;
        let mut statement = connection
            .prepare(
                "SELECT id, task_id, kind, path, hash, metadata_json, created_at
                 FROM attachments WHERE task_id = ?1 ORDER BY created_at, id",
            )
            .map_err(|error| format!("prepare attachment list: {error}"))?;
        let rows = statement
            .query_map([task_id], |row| {
                Ok((
                    row.get::<_, String>(0)?,
                    row.get::<_, String>(1)?,
                    row.get::<_, String>(2)?,
                    row.get::<_, String>(3)?,
                    row.get::<_, String>(4)?,
                    row.get::<_, String>(5)?,
                    row.get::<_, i64>(6)?,
                ))
            })
            .map_err(|error| format!("query attachment list: {error}"))?;
        let mut attachments = Vec::new();
        for row in rows {
            let (id, task_id, kind, path, hash, metadata_json, created_at) =
                row.map_err(|error| format!("read attachment row: {error}"))?;
            attachments.push(decode_record(
                id,
                task_id,
                kind,
                path,
                hash,
                metadata_json,
                created_at,
            )?);
        }
        Ok(attachments)
    }

    pub fn import(
        paths: &AppPaths,
        task_id: &str,
        sources: &[PathBuf],
    ) -> Result<Vec<TaskAttachment>, String> {
        require_task(&paths.database_file, task_id)?;
        if sources.is_empty() {
            return Ok(Vec::new());
        }
        if sources.len() > MAX_ATTACHMENT_BATCH_FILES {
            return Err(format!(
                "A single attachment batch cannot exceed {MAX_ATTACHMENT_BATCH_FILES} files"
            ));
        }

        let mut prepared = Vec::new();
        let mut batch_bytes = 0_u64;
        for source in sources {
            let metadata = fs::symlink_metadata(source).map_err(|error| {
                format!("Cannot inspect attachment {}: {error}", source.display())
            })?;
            if metadata.file_type().is_symlink() || !metadata.is_file() {
                return Err(format!(
                    "Attachment must be a regular non-symlink file: {}",
                    source.display()
                ));
            }
            if metadata.len() > MAX_ATTACHMENT_BYTES {
                return Err(format!(
                    "Attachment {} exceeds the 25 MiB limit",
                    source.display()
                ));
            }
            batch_bytes = batch_bytes.saturating_add(metadata.len());
            if batch_bytes > MAX_ATTACHMENT_BATCH_BYTES {
                return Err("Attachment batch exceeds the 100 MiB limit".into());
            }
            prepared.push((source.clone(), metadata.len()));
        }

        let task_root = paths.attachments.join(task_id);
        create_private_dir(&task_root)?;
        let mut imported = Vec::new();
        let mut created_directories = Vec::new();
        let import_result = (|| {
            for (source, expected_size) in prepared {
                let id = Uuid::new_v4().to_string();
                let name = source
                    .file_name()
                    .and_then(|value| value.to_str())
                    .filter(|value| !value.trim().is_empty())
                    .ok_or_else(|| "Attachment filename is not valid UTF-8".to_string())?
                    .to_string();
                let directory = task_root.join(&id);
                create_private_dir(&directory)?;
                created_directories.push(directory.clone());
                let destination = directory.join(&name);
                let (size, sha256) = copy_and_hash(&source, &destination)?;
                if size != expected_size {
                    return Err(format!(
                        "Attachment changed while it was being imported: {}",
                        source.display()
                    ));
                }
                let (kind, mime_type) = classify(&name);
                imported.push(TaskAttachment {
                    id,
                    task_id: task_id.to_string(),
                    kind: kind.into(),
                    name,
                    path: destination.display().to_string(),
                    mime_type: mime_type.into(),
                    size,
                    sha256,
                    created_at: unix_millis()?,
                });
            }

            let mut connection = Database::open(paths.database_file.clone())?.connection()?;
            let transaction = connection
                .transaction()
                .map_err(|error| format!("begin attachment import: {error}"))?;
            for attachment in &imported {
                let metadata = serde_json::to_string(&AttachmentMetadata {
                    name: attachment.name.clone(),
                    mime_type: attachment.mime_type.clone(),
                    size: attachment.size,
                })
                .map_err(|error| format!("encode attachment metadata: {error}"))?;
                transaction
                    .execute(
                        "INSERT INTO attachments(
                            id, task_id, kind, path, hash, metadata_json, created_at
                         ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)",
                        params![
                            attachment.id,
                            attachment.task_id,
                            attachment.kind,
                            attachment.path,
                            attachment.sha256,
                            metadata,
                            attachment.created_at as i64
                        ],
                    )
                    .map_err(|error| format!("persist attachment: {error}"))?;
            }
            transaction
                .commit()
                .map_err(|error| format!("commit attachment import: {error}"))
        })();

        if let Err(error) = import_result {
            for directory in created_directories {
                let _ = fs::remove_dir_all(directory);
            }
            return Err(error);
        }
        Ok(imported)
    }

    pub fn delete(paths: &AppPaths, task_id: &str, id: &str) -> Result<(), String> {
        require_task(&paths.database_file, task_id)?;
        let connection = Database::open(paths.database_file.clone())?.connection()?;
        let record: Option<(String, String)> = connection
            .query_row(
                "SELECT task_id, path FROM attachments WHERE id = ?1",
                [id],
                |row| Ok((row.get(0)?, row.get(1)?)),
            )
            .optional()
            .map_err(|error| format!("query attachment: {error}"))?;
        let (owner_task_id, stored_path) =
            record.ok_or_else(|| format!("Unknown attachment: {id}"))?;
        if owner_task_id != task_id {
            return Err("Attachment does not belong to the active task".into());
        }
        let task_root = paths
            .attachments
            .join(task_id)
            .canonicalize()
            .map_err(|error| format!("Cannot resolve attachment root: {error}"))?;
        let file = PathBuf::from(stored_path)
            .canonicalize()
            .map_err(|error| format!("Cannot resolve attachment file: {error}"))?;
        if !file.starts_with(&task_root) {
            return Err("Attachment path escapes its task storage root".into());
        }
        let directory = file
            .parent()
            .ok_or_else(|| "Attachment storage directory is missing".to_string())?;
        if directory.parent() != Some(task_root.as_path()) {
            return Err("Attachment storage layout is invalid".into());
        }
        let tombstone = task_root.join(format!(".delete-{}", Uuid::new_v4()));
        fs::rename(directory, &tombstone)
            .map_err(|error| format!("Stage attachment deletion: {error}"))?;
        let delete_result = connection
            .execute(
                "DELETE FROM attachments WHERE id = ?1 AND task_id = ?2",
                params![id, task_id],
            )
            .map_err(|error| format!("delete attachment record: {error}"));
        if let Err(error) = delete_result {
            let _ = fs::rename(&tombstone, directory);
            return Err(error);
        }
        fs::remove_dir_all(&tombstone).map_err(|error| format!("Remove attachment data: {error}"))
    }
}

fn require_task(database_path: &Path, task_id: &str) -> Result<(), String> {
    let task = TaskRepository::get(database_path, task_id)?
        .ok_or_else(|| format!("Unknown task: {task_id}"))?;
    if task.archived {
        return Err(format!("Task is archived: {task_id}"));
    }
    Ok(())
}

fn decode_record(
    id: String,
    task_id: String,
    kind: String,
    path: String,
    hash: String,
    metadata_json: String,
    created_at: i64,
) -> Result<TaskAttachment, String> {
    let metadata: AttachmentMetadata = serde_json::from_str(&metadata_json)
        .map_err(|error| format!("decode attachment metadata: {error}"))?;
    Ok(TaskAttachment {
        id,
        task_id,
        kind,
        name: metadata.name,
        path,
        mime_type: metadata.mime_type,
        size: metadata.size,
        sha256: hash,
        created_at: u64::try_from(created_at)
            .map_err(|_| "Attachment timestamp is negative".to_string())?,
    })
}

fn copy_and_hash(source: &Path, destination: &Path) -> Result<(u64, String), String> {
    let mut input = fs::File::open(source)
        .map_err(|error| format!("Open attachment {}: {error}", source.display()))?;
    let temporary = destination.with_extension(format!(
        "{}.tmp",
        destination
            .extension()
            .and_then(|value| value.to_str())
            .unwrap_or("attachment")
    ));
    let result = (|| {
        let mut output = OpenOptions::new()
            .create_new(true)
            .write(true)
            .mode(0o600)
            .open(&temporary)
            .map_err(|error| format!("Create attachment staging file: {error}"))?;
        let mut digest = Sha256::new();
        let mut size = 0_u64;
        let mut buffer = [0_u8; 64 * 1024];
        loop {
            let read = input
                .read(&mut buffer)
                .map_err(|error| format!("Read attachment source: {error}"))?;
            if read == 0 {
                break;
            }
            size = size.saturating_add(read as u64);
            if size > MAX_ATTACHMENT_BYTES {
                return Err("Attachment grew beyond the 25 MiB limit during import".into());
            }
            digest.update(&buffer[..read]);
            output
                .write_all(&buffer[..read])
                .map_err(|error| format!("Write attachment staging file: {error}"))?;
        }
        output
            .sync_all()
            .map_err(|error| format!("Sync attachment staging file: {error}"))?;
        fs::set_permissions(&temporary, fs::Permissions::from_mode(0o600))
            .map_err(|error| format!("Secure attachment staging file: {error}"))?;
        fs::rename(&temporary, destination)
            .map_err(|error| format!("Commit attachment import: {error}"))?;
        Ok((size, format!("{:x}", digest.finalize())))
    })();
    if result.is_err() {
        let _ = fs::remove_file(temporary);
    }
    result
}

fn create_private_dir(path: &Path) -> Result<(), String> {
    fs::create_dir_all(path).map_err(|error| format!("Create attachment directory: {error}"))?;
    fs::set_permissions(path, fs::Permissions::from_mode(0o700))
        .map_err(|error| format!("Secure attachment directory: {error}"))
}

fn classify(name: &str) -> (&'static str, &'static str) {
    match Path::new(name)
        .extension()
        .and_then(|value| value.to_str())
        .unwrap_or("")
        .to_ascii_lowercase()
        .as_str()
    {
        "png" => ("image", "image/png"),
        "jpg" | "jpeg" => ("image", "image/jpeg"),
        "gif" => ("image", "image/gif"),
        "webp" => ("image", "image/webp"),
        "pdf" => ("pdf", "application/pdf"),
        "md" | "mdx" => ("file", "text/markdown"),
        "json" => ("file", "application/json"),
        "yaml" | "yml" => ("file", "application/yaml"),
        "csv" => ("file", "text/csv"),
        "txt" | "log" => ("file", "text/plain"),
        "ts" | "tsx" | "js" | "jsx" | "rs" | "py" | "go" | "java" | "swift" | "kt" | "sh"
        | "zsh" | "css" | "html" | "toml" | "xml" | "sql" => ("file", "text/plain"),
        _ => ("file", "application/octet-stream"),
    }
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
    use crate::{
        agent::protocol::TaskRuntimeProfile,
        storage::tasks::{TaskDraft, TaskIsolation},
    };

    fn fixture() -> (AppPaths, String, PathBuf) {
        let root = std::env::temp_dir().join(format!("pi-attachment-test-{}", Uuid::new_v4()));
        let paths = AppPaths {
            logs: root.join("data/logs"),
            attachments: root.join("data/attachments"),
            packages: root.join("data/packages"),
            extension_packages: root.join("data/packages/extensions"),
            backups: root.join("data/backups"),
            worktrees: root.join("data/worktrees"),
            database_file: root.join("data/pi-desktop.sqlite3"),
            endpoints_file: root.join("data/endpoints.json"),
            extensions_file: root.join("data/extensions.json"),
            resources_file: root.join("resources.json"),
            agent_skills: root.join("agent").join("skills"),
            agent_prompts: root.join("agent").join("prompts"),
            connectors_file: root.join("connectors.json"),
            connector_runtime: root.join("connector-runtime"),
            tasks_file: root.join("data/tasks.json"),
            root: root.join("data"),
        };
        Database::initialize(&paths).unwrap();
        let project = root.join("project");
        fs::create_dir_all(&project).unwrap();
        let task = TaskRepository::save(
            &paths.database_file,
            TaskDraft {
                id: None,
                title: Some("Attachments".into()),
                cwd: project.display().to_string(),
                project_root: None,
                isolation: Some(TaskIsolation::CurrentCheckout),
                worktree: None,
                profile: TaskRuntimeProfile {
                    provider_id: None,
                    model_id: None,
                    permission_mode: "ask".into(),
                },
            },
        )
        .unwrap();
        (paths, task.id, project)
    }

    #[test]
    fn imports_hashes_lists_and_deletes_private_copy() {
        let (paths, task_id, project) = fixture();
        let source = project.join("notes.txt");
        fs::write(&source, "attachment content").unwrap();
        let imported =
            AttachmentStore::import(&paths, &task_id, std::slice::from_ref(&source)).unwrap();
        assert_eq!(imported.len(), 1);
        assert_eq!(imported[0].sha256.len(), 64);
        assert_eq!(
            fs::metadata(&imported[0].path)
                .unwrap()
                .permissions()
                .mode()
                & 0o777,
            0o600
        );
        assert_eq!(
            AttachmentStore::list(&paths.database_file, &task_id)
                .unwrap()
                .len(),
            1
        );
        AttachmentStore::delete(&paths, &task_id, &imported[0].id).unwrap();
        assert!(AttachmentStore::list(&paths.database_file, &task_id)
            .unwrap()
            .is_empty());
        fs::remove_dir_all(project.parent().unwrap()).unwrap();
    }
}
