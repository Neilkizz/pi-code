use std::{fs, io, os::unix::fs::PermissionsExt, path::PathBuf};
use tauri::Manager;

#[derive(Debug, Clone)]
pub struct AppPaths {
    pub root: PathBuf,
    pub logs: PathBuf,
    pub attachments: PathBuf,
    pub packages: PathBuf,
    pub extension_packages: PathBuf,
    pub backups: PathBuf,
    pub worktrees: PathBuf,
    pub database_file: PathBuf,
    pub endpoints_file: PathBuf,
    pub extensions_file: PathBuf,
    pub resources_file: PathBuf,
    pub agent_skills: PathBuf,
    pub agent_prompts: PathBuf,
    pub tasks_file: PathBuf,
}

impl AppPaths {
    pub fn resolve(app: &tauri::AppHandle) -> Result<Self, tauri::Error> {
        let root = app.path().app_data_dir()?;
        Ok(Self {
            logs: root.join("logs"),
            attachments: root.join("attachments"),
            packages: root.join("packages"),
            extension_packages: root.join("packages").join("extensions"),
            backups: root.join("backups"),
            worktrees: root.join("worktrees"),
            database_file: root.join("pi-desktop.sqlite3"),
            endpoints_file: root.join("endpoints.json"),
            extensions_file: root.join("extensions.json"),
            resources_file: root.join("resources.json"),
            agent_skills: root.join("agent").join("skills"),
            agent_prompts: root.join("agent").join("prompts"),
            tasks_file: root.join("tasks.json"),
            root,
        })
    }

    pub fn ensure(&self) -> io::Result<()> {
        for path in [
            &self.root,
            &self.logs,
            &self.attachments,
            &self.packages,
            &self.extension_packages,
            &self.backups,
            &self.worktrees,
            &self.agent_skills,
            &self.agent_prompts,
        ] {
            fs::create_dir_all(path)?;
            fs::set_permissions(path, fs::Permissions::from_mode(0o700))?;
        }
        Ok(())
    }
}
