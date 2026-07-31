use std::{
    fs::{self, OpenOptions},
    io::{Read, Write},
    os::unix::fs::{OpenOptionsExt, PermissionsExt},
    path::{Component, Path, PathBuf},
};
use uuid::Uuid;

const MAX_BROKER_FILE_BYTES: u64 = 16 * 1024 * 1024;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum FileAccess {
    ReadOnly,
    ReadWrite,
}

#[derive(Debug, Clone)]
pub struct FileBroker {
    canonical_root: PathBuf,
    access: FileAccess,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct BrokerFileStat {
    pub exists: bool,
    pub is_directory: bool,
}

impl FileBroker {
    pub fn new(root: &Path, access: FileAccess) -> Result<Self, String> {
        let canonical_root = root
            .canonicalize()
            .map_err(|error| format!("Cannot resolve file capability root: {error}"))?;
        if !canonical_root.is_dir() {
            return Err("File capability root must be a directory".into());
        }
        Ok(Self {
            canonical_root,
            access,
        })
    }

    pub fn root(&self) -> &Path {
        &self.canonical_root
    }

    pub fn read(&self, relative_path: &str, maximum_bytes: u64) -> Result<Vec<u8>, String> {
        let maximum_bytes = maximum_bytes.min(MAX_BROKER_FILE_BYTES);
        if maximum_bytes == 0 {
            return Err("Read size limit must be positive".into());
        }
        let resolved = self.resolve_existing(relative_path)?;
        let metadata = fs::metadata(&resolved)
            .map_err(|error| format!("Inspect broker file {}: {error}", resolved.display()))?;
        if !metadata.is_file() {
            return Err("Broker read target must be a regular file".into());
        }
        if metadata.len() > maximum_bytes {
            return Err(format!(
                "Broker read target exceeds the {} byte limit",
                maximum_bytes
            ));
        }
        let mut bytes = Vec::with_capacity(metadata.len() as usize);
        fs::File::open(&resolved)
            .and_then(|file| file.take(maximum_bytes + 1).read_to_end(&mut bytes))
            .map_err(|error| format!("Read broker file {}: {error}", resolved.display()))?;
        if bytes.len() as u64 > maximum_bytes {
            return Err("Broker read exceeded its bounded size".into());
        }
        Ok(bytes)
    }

    pub fn write_atomic(&self, relative_path: &str, content: &[u8]) -> Result<PathBuf, String> {
        if self.access != FileAccess::ReadWrite {
            return Err("This file capability is read-only".into());
        }
        if content.len() as u64 > MAX_BROKER_FILE_BYTES {
            return Err(format!(
                "Broker write exceeds the {} byte limit",
                MAX_BROKER_FILE_BYTES
            ));
        }
        let (parent, destination) = self.resolve_parent_for_write(relative_path)?;
        let temporary = parent.join(format!(".pi-desktop-{}.tmp", Uuid::new_v4()));
        let write_result = (|| {
            let mut file = OpenOptions::new()
                .create_new(true)
                .write(true)
                .mode(0o600)
                .open(&temporary)
                .map_err(|error| format!("Create broker staging file: {error}"))?;
            file.write_all(content)
                .map_err(|error| format!("Write broker staging file: {error}"))?;
            file.sync_all()
                .map_err(|error| format!("Sync broker staging file: {error}"))?;
            fs::set_permissions(&temporary, fs::Permissions::from_mode(0o600))
                .map_err(|error| format!("Secure broker staging file: {error}"))?;
            if destination.exists() {
                let metadata = fs::symlink_metadata(&destination)
                    .map_err(|error| format!("Inspect broker write target: {error}"))?;
                if metadata.file_type().is_symlink() || !metadata.is_file() {
                    return Err("Broker refuses to replace a symlink or non-regular file".into());
                }
                let canonical_destination = destination
                    .canonicalize()
                    .map_err(|error| format!("Resolve broker write target: {error}"))?;
                self.require_inside_root(&canonical_destination)?;
            }
            fs::rename(&temporary, &destination)
                .map_err(|error| format!("Commit broker file write: {error}"))?;
            sync_directory(&parent)?;
            Ok(destination.clone())
        })();
        if write_result.is_err() {
            let _ = fs::remove_file(&temporary);
        }
        write_result
    }

    pub fn resolve_existing(&self, relative_path: &str) -> Result<PathBuf, String> {
        if relative_path.is_empty() || relative_path == "." {
            return Ok(self.canonical_root.clone());
        }
        let relative = validate_relative_path(relative_path)?;
        let resolved = self
            .canonical_root
            .join(relative)
            .canonicalize()
            .map_err(|error| format!("Cannot resolve broker path: {error}"))?;
        self.require_inside_root(&resolved)?;
        Ok(resolved)
    }

    pub fn access(&self, relative_path: &str, write: bool) -> Result<(), String> {
        if write && self.access != FileAccess::ReadWrite {
            return Err("This file capability is read-only".into());
        }
        match self.resolve_existing(relative_path) {
            Ok(path) => {
                let metadata = fs::symlink_metadata(&path)
                    .map_err(|error| format!("Inspect broker access target: {error}"))?;
                if metadata.file_type().is_symlink() {
                    return Err("Broker access target cannot be a symlink".into());
                }
                if write && metadata.permissions().readonly() {
                    return Err("Broker write target is read-only".into());
                }
                Ok(())
            }
            Err(error) if write => self
                .resolve_parent_for_write(relative_path)
                .map(|_| ())
                .map_err(|_| error),
            Err(error) => Err(error),
        }
    }

    pub fn stat(&self, relative_path: &str) -> Result<BrokerFileStat, String> {
        let path = match self.resolve_existing(relative_path) {
            Ok(path) => path,
            Err(error) if is_not_found_error(&error) => {
                return Ok(BrokerFileStat {
                    exists: false,
                    is_directory: false,
                })
            }
            Err(error) => return Err(error),
        };
        let metadata = fs::metadata(path).map_err(|error| error.to_string())?;
        Ok(BrokerFileStat {
            exists: true,
            is_directory: metadata.is_dir(),
        })
    }

    pub fn readdir(&self, relative_path: &str) -> Result<Vec<String>, String> {
        let path = self.resolve_existing(relative_path)?;
        if !path.is_dir() {
            return Err("Broker directory listing target is not a directory".into());
        }
        let mut entries = Vec::new();
        for entry in fs::read_dir(path).map_err(|error| error.to_string())? {
            let entry = entry.map_err(|error| error.to_string())?;
            let name = entry
                .file_name()
                .into_string()
                .map_err(|_| "Broker cannot expose a non-UTF-8 filename".to_string())?;
            entries.push(name);
        }
        entries.sort();
        Ok(entries)
    }

    pub fn create_dir_all(&self, relative_path: &str) -> Result<PathBuf, String> {
        if self.access != FileAccess::ReadWrite {
            return Err("This file capability is read-only".into());
        }
        if relative_path.is_empty() || relative_path == "." {
            return Ok(self.canonical_root.clone());
        }
        let relative = validate_relative_path(relative_path)?;
        let mut current = self.canonical_root.clone();
        for component in relative.components() {
            let Component::Normal(name) = component else {
                return Err("Broker directory path is invalid".into());
            };
            let candidate = current.join(name);
            match fs::symlink_metadata(&candidate) {
                Ok(metadata) => {
                    if metadata.file_type().is_symlink() {
                        let resolved = candidate.canonicalize().map_err(|error| {
                            format!("Resolve broker directory symlink: {error}")
                        })?;
                        self.require_inside_root(&resolved)?;
                        if !resolved.is_dir() {
                            return Err("Broker directory component is not a directory".into());
                        }
                        current = resolved;
                    } else if metadata.is_dir() {
                        current = candidate;
                    } else {
                        return Err("Broker directory component is not a directory".into());
                    }
                }
                Err(error) if error.kind() == std::io::ErrorKind::NotFound => {
                    fs::create_dir(&candidate)
                        .map_err(|error| format!("Create broker directory: {error}"))?;
                    fs::set_permissions(&candidate, fs::Permissions::from_mode(0o700))
                        .map_err(|error| format!("Secure broker directory: {error}"))?;
                    current = candidate;
                }
                Err(error) => return Err(format!("Inspect broker directory: {error}")),
            }
            self.require_inside_root(&current)?;
        }
        sync_directory(&self.canonical_root)?;
        Ok(current)
    }

    fn resolve_parent_for_write(&self, relative_path: &str) -> Result<(PathBuf, PathBuf), String> {
        let relative = validate_relative_path(relative_path)?;
        let filename = relative
            .file_name()
            .ok_or_else(|| "Broker write requires a file name".to_string())?;
        let parent_relative = relative.parent().unwrap_or_else(|| Path::new(""));
        let parent = self
            .canonical_root
            .join(parent_relative)
            .canonicalize()
            .map_err(|error| {
                format!("Broker write parent must already exist and be accessible: {error}")
            })?;
        self.require_inside_root(&parent)?;
        if !parent.is_dir() {
            return Err("Broker write parent must be a directory".into());
        }
        Ok((parent.clone(), parent.join(filename)))
    }

    fn require_inside_root(&self, path: &Path) -> Result<(), String> {
        if path == self.canonical_root || path.starts_with(&self.canonical_root) {
            Ok(())
        } else {
            Err("Broker path escapes its authorized root through a symlink".into())
        }
    }
}

fn is_not_found_error(error: &str) -> bool {
    error.contains("No such file") || error.contains("not found")
}

fn validate_relative_path(value: &str) -> Result<PathBuf, String> {
    if value.is_empty() {
        return Err("Broker path is required".into());
    }
    if value.contains('\0') {
        return Err("Broker path contains a NUL byte".into());
    }
    let path = Path::new(value);
    if path.is_absolute() {
        return Err("Broker path must be relative to its capability root".into());
    }
    let mut normalized = PathBuf::new();
    for component in path.components() {
        match component {
            Component::Normal(value) => normalized.push(value),
            Component::CurDir => {}
            Component::ParentDir | Component::RootDir | Component::Prefix(_) => {
                return Err("Broker path traversal is not allowed".into());
            }
        }
    }
    if normalized.as_os_str().is_empty() {
        return Err("Broker path must name a file".into());
    }
    reject_sensitive_top_level(&normalized)?;
    Ok(normalized)
}

fn reject_sensitive_top_level(path: &Path) -> Result<(), String> {
    let first = path
        .components()
        .next()
        .and_then(|component| match component {
            Component::Normal(value) => value.to_str(),
            _ => None,
        })
        .unwrap_or_default();
    let normalized = first.to_ascii_lowercase();
    if matches!(normalized.as_str(), ".ssh" | ".gnupg" | ".aws") {
        return Err(format!("Broker access to {first} is denied by hard policy"));
    }
    let text = path.to_string_lossy().to_ascii_lowercase();
    if text.starts_with("library/keychains")
        || text.starts_with("library/application support/google/chrome")
        || text.starts_with("library/application support/firefox")
    {
        return Err("Broker access to credential or browser profile data is denied".into());
    }
    Ok(())
}

fn sync_directory(path: &Path) -> Result<(), String> {
    fs::File::open(path)
        .and_then(|file| file.sync_all())
        .map_err(|error| format!("Sync broker directory: {error}"))
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::os::unix::fs::symlink;

    fn roots() -> (PathBuf, PathBuf) {
        let root = std::env::temp_dir().join(format!("pi-file-broker-test-{}", Uuid::new_v4()));
        let outside =
            std::env::temp_dir().join(format!("pi-file-broker-outside-{}", Uuid::new_v4()));
        fs::create_dir_all(root.join("src")).unwrap();
        fs::create_dir_all(&outside).unwrap();
        (root, outside)
    }

    #[test]
    fn reads_and_atomically_writes_only_inside_scope() {
        let (root, outside) = roots();
        fs::write(root.join("src/input.txt"), "hello").unwrap();
        let broker = FileBroker::new(&root, FileAccess::ReadWrite).unwrap();
        assert_eq!(broker.read("src/input.txt", 32).unwrap(), b"hello");
        let output = broker.write_atomic("src/output.txt", b"world").unwrap();
        assert_eq!(fs::read(output).unwrap(), b"world");
        assert!(broker.read("../outside.txt", 32).is_err());
        assert!(broker.write_atomic("/tmp/outside.txt", b"no").is_err());
        assert!(broker.write_atomic(".ssh/config", b"no").is_err());
        fs::remove_dir_all(root).unwrap();
        fs::remove_dir_all(outside).unwrap();
    }

    #[test]
    fn rejects_symlink_escape_and_read_only_writes() {
        let (root, outside) = roots();
        fs::write(outside.join("secret.txt"), "secret").unwrap();
        symlink(&outside, root.join("src/external")).unwrap();
        let read_only = FileBroker::new(&root, FileAccess::ReadOnly).unwrap();
        assert!(read_only.read("src/external/secret.txt", 32).is_err());
        assert!(read_only.write_atomic("src/no.txt", b"no").is_err());
        fs::remove_dir_all(root).unwrap();
        fs::remove_dir_all(outside).unwrap();
    }

    #[test]
    fn refuses_to_replace_symlinks_even_when_they_point_inside_scope() {
        let (root, outside) = roots();
        fs::write(root.join("src/real.txt"), "real").unwrap();
        symlink(root.join("src/real.txt"), root.join("src/link.txt")).unwrap();
        let broker = FileBroker::new(&root, FileAccess::ReadWrite).unwrap();
        assert!(broker.write_atomic("src/link.txt", b"replacement").is_err());
        assert_eq!(
            fs::read_to_string(root.join("src/real.txt")).unwrap(),
            "real"
        );
        fs::remove_dir_all(root).unwrap();
        fs::remove_dir_all(outside).unwrap();
    }
}
