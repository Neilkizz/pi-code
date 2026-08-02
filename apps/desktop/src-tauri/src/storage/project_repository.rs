use super::database::Database;
use rusqlite::Row;
use serde::{Deserialize, Serialize};
use std::path::Path;

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct ProjectSummary {
    pub id: String,
    pub display_name: String,
    pub root: String,
    pub trust: String,
    pub task_count: u64,
    pub last_opened_at: u64,
    pub updated_at: u64,
    pub instructions: String,
}

pub struct ProjectRepository;

impl ProjectRepository {
    /// Projects are created transactionally with their first task. The project
    /// centre only reads this canonical SQLite projection; it never infers
    /// projects from the task list in the WebView.
    pub fn list(database_path: &Path) -> Result<Vec<ProjectSummary>, String> {
        let connection = Database::open(database_path.to_path_buf())?.connection()?;
        let mut statement = connection
            .prepare(
                "SELECT
                    p.id,
                    p.display_name,
                    p.root,
                    p.trust,
                    COUNT(t.id) AS task_count,
                    COALESCE(MAX(t.last_opened_at), 0) AS last_opened_at,
                    p.updated_at,
                    p.defaults_json
                 FROM projects p
                 LEFT JOIN tasks t ON t.project_id = p.id AND t.archived = 0
                 GROUP BY p.id, p.display_name, p.root, p.trust, p.updated_at, p.defaults_json
                 ORDER BY last_opened_at DESC, p.updated_at DESC, p.display_name COLLATE NOCASE ASC",
            )
            .map_err(|error| format!("prepare project list: {error}"))?;
        let rows = statement
            .query_map([], map_project_row)
            .map_err(|error| format!("query project list: {error}"))?;
        rows.map(|row| row.map_err(|error| format!("read project row: {error}")))
            .collect()
    }

    pub fn save_instructions(
        database_path: &Path,
        id: &str,
        instructions: String,
    ) -> Result<ProjectSummary, String> {
        if instructions.len() > 32_768 {
            return Err("Project instructions must be 32 KiB or less".into());
        }
        let connection = Database::open(database_path.to_path_buf())?.connection()?;
        let defaults = serde_json::to_string(&ProjectDefaults { instructions })
            .map_err(|error| format!("serialize project instructions: {error}"))?;
        let updated = connection
            .execute(
                "UPDATE projects SET defaults_json = ?1, updated_at = CAST(strftime('%s', 'now') AS INTEGER) * 1000 WHERE id = ?2",
                [&defaults, id],
            )
            .map_err(|error| format!("save project instructions: {error}"))?;
        if updated == 0 {
            return Err(format!("Unknown project: {id}"));
        }
        Self::list(database_path)?
            .into_iter()
            .find(|project| project.id == id)
            .ok_or_else(|| format!("Project disappeared after update: {id}"))
    }
}

#[derive(Debug, Default, Deserialize, Serialize)]
struct ProjectDefaults {
    #[serde(default)]
    instructions: String,
}

fn map_project_row(row: &Row<'_>) -> rusqlite::Result<ProjectSummary> {
    let task_count: i64 = row.get(4)?;
    let last_opened_at: i64 = row.get(5)?;
    let updated_at: i64 = row.get(6)?;
    let defaults_json: String = row.get(7)?;
    let defaults: ProjectDefaults = serde_json::from_str(&defaults_json).map_err(|error| {
        rusqlite::Error::FromSqlConversionFailure(7, rusqlite::types::Type::Text, error.into())
    })?;
    Ok(ProjectSummary {
        id: row.get(0)?,
        display_name: row.get(1)?,
        root: row.get(2)?,
        trust: row.get(3)?,
        task_count: u64::try_from(task_count).map_err(|_| {
            rusqlite::Error::FromSqlConversionFailure(
                4,
                rusqlite::types::Type::Integer,
                "project task count is negative".into(),
            )
        })?,
        last_opened_at: u64::try_from(last_opened_at).map_err(|_| {
            rusqlite::Error::FromSqlConversionFailure(
                5,
                rusqlite::types::Type::Integer,
                "project timestamp is negative".into(),
            )
        })?,
        updated_at: u64::try_from(updated_at).map_err(|_| {
            rusqlite::Error::FromSqlConversionFailure(
                6,
                rusqlite::types::Type::Integer,
                "project timestamp is negative".into(),
            )
        })?,
        instructions: defaults.instructions,
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::storage::{app_paths::AppPaths, database::Database};
    use rusqlite::params;
    use std::fs;
    use uuid::Uuid;

    fn test_paths() -> AppPaths {
        let root =
            std::env::temp_dir().join(format!("pi-project-repository-test-{}", Uuid::new_v4()));
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
            resources_file: root.join("resources.json"),
            agent_skills: root.join("agent").join("skills"),
            agent_prompts: root.join("agent").join("prompts"),
            tasks_file: root.join("tasks.json"),
            root,
        }
    }

    #[test]
    fn lists_projects_with_active_task_counts_and_recent_first() {
        let paths = test_paths();
        Database::initialize(&paths).unwrap();
        let connection = Database::open(paths.database_file.clone())
            .unwrap()
            .connection()
            .unwrap();
        connection.execute(
            "INSERT INTO projects(id, display_name, root, trust, defaults_json, created_at, updated_at)
             VALUES (?1, ?2, ?3, 'unknown', '{}', 1, ?4)",
            params!["project-a", "Alpha", "/tmp/alpha", 10_i64],
        ).unwrap();
        connection.execute(
            "INSERT INTO projects(id, display_name, root, trust, defaults_json, created_at, updated_at)
             VALUES (?1, ?2, ?3, 'unknown', '{}', 1, ?4)",
            params!["project-b", "Beta", "/tmp/beta", 20_i64],
        ).unwrap();
        connection.execute(
            "INSERT INTO tasks(id, project_id, status, title, profile_json, archived, created_at, updated_at, last_opened_at)
             VALUES (?1, ?2, 'ready', 'Active', '{}', 0, 1, 1, 30)",
            params!["task-active", "project-a"],
        ).unwrap();
        connection.execute(
            "INSERT INTO tasks(id, project_id, status, title, profile_json, archived, created_at, updated_at, last_opened_at)
             VALUES (?1, ?2, 'archived', 'Archived', '{}', 1, 1, 1, 99)",
            params!["task-archived", "project-b"],
        ).unwrap();

        let projects = ProjectRepository::list(&paths.database_file).unwrap();
        assert_eq!(projects.len(), 2);
        assert_eq!(projects[0].id, "project-a");
        assert_eq!(projects[0].task_count, 1);
        assert_eq!(projects[1].id, "project-b");
        assert_eq!(projects[1].task_count, 0);

        let updated = ProjectRepository::save_instructions(
            &paths.database_file,
            "project-a",
            "Always run the relevant tests.".into(),
        )
        .unwrap();
        assert_eq!(updated.instructions, "Always run the relevant tests.");
        assert_eq!(
            ProjectRepository::list(&paths.database_file).unwrap()[0].instructions,
            "Always run the relevant tests."
        );
        fs::remove_dir_all(paths.root).unwrap();
    }
}
