# NEXT-U04: Session Rename/Search/Pin/Trash — 设计文档

## Context

Pi Desktop 当前侧边栏 Session 列表仅支持纯前端标题过滤和按时间分组，缺少重命名、置顶、后端搜索、垃圾桶等核心会话管理能力。NEXT-U04 在 P0 路线图中，依赖 SQLite，5 人日，目标：归档恢复、全文索引、30 天 Trash、不物理删除 Worktree。

## Architecture Overview

```
┌─────────────────────────────────────────────────┐
│  SessionSidebar.tsx                              │
│  ┌──────────────┐  ┌──────────────────────────┐ │
│  │ Search Input  │  │ Trash View (新页面)       │ │
│  │ (debounce     │  │ - 恢复 / 永久删除         │ │
│  │  200ms →      │  │ - 显示归档日期            │ │
│  │  task_search) │  └──────────────────────────┘ │
│  └──────────────┘                                │
│  ┌──────────────────────────────────────────────┐│
│  │ Session Items (右键菜单 / ⋮ 按钮)             ││
│  │  📌 Pinned first → 时间倒序                   ││
│  │  · Rename (inline edit)                       ││
│  │  · Pin / Unpin                                ││
│  │  · Archive (→ Trash)                          ││
│  └──────────────────────────────────────────────┘│
│  ┌──────────────┐                                │
│  │ Trash 入口    │ (侧边栏底部)                   │
│  └──────────────┘                                │
└─────────────────┬───────────────────────────────┘
                  │ invoke()
                  ▼
┌─────────────────────────────────────────────────┐
│  Tauri Commands (lib.rs)                         │
│  task_rename(id, title) → TaskRecord             │
│  task_pin(id, pinned) → TaskRecord               │
│  task_search(query) → Vec<TaskRecord>            │
│  task_delete(id) → ()                            │
│  task_list (已有, 排序改为 pinned 优先)           │
└─────────────────┬───────────────────────────────┘
                  │
                  ▼
┌─────────────────────────────────────────────────┐
│  TaskRepository (task_repository.rs)              │
│  rename() / pin() / search() / delete()           │
│  list() → ORDER BY pinned DESC, last_opened_at   │
└─────────────────┬───────────────────────────────┘
                  │
                  ▼
┌─────────────────────────────────────────────────┐
│  SQLite (pi-desktop.sqlite3)                      │
│  Migration 002: ALTER TABLE tasks                │
│    ADD COLUMN pinned INTEGER NOT NULL DEFAULT 0  │
│  CREATE INDEX tasks_pinned_idx ON tasks(pinned)  │
└─────────────────────────────────────────────────┘
```

## 1. DB Migration (002_pinned.sql)

```sql
ALTER TABLE tasks ADD COLUMN pinned INTEGER NOT NULL DEFAULT 0;
CREATE INDEX tasks_pinned_idx ON tasks(pinned, last_opened_at DESC);
```

- `pinned` 为 0/1 布尔列，默认 0
- 索引覆盖 `(pinned, last_opened_at DESC)` 以加速常用排序查询

## 2. Rust 后端

### 2.1 TaskRecord 类型扩展

文件：`apps/desktop/src-tauri/src/storage/tasks.rs`

```rust
pub struct TaskRecord {
    // ... 现有字段保持不变 ...
    pub pinned: bool,  // 新增
}
```

### 2.2 TaskRepository 新增方法

文件：`apps/desktop/src-tauri/src/storage/task_repository.rs`

| 方法 | 说明 |
|---|---|
| `rename(database_path, id, title) → TaskRecord` | UPDATE tasks SET title, updated_at WHERE id=? AND archived=0 |
| `pin(database_path, id, pinned) → TaskRecord` | UPDATE tasks SET pinned WHERE id=? AND archived=0 |
| `search(database_path, query) → Vec<TaskRecord>` | SELECT WHERE (title LIKE ? OR cwd LIKE ?) AND archived=0 ORDER BY pinned DESC |
| `delete(database_path, id) → ()` | DELETE FROM tasks WHERE id=? AND archived=1 (仅允许删除已归档的) |

### 2.3 现有方法修改

- `list()`: ORDER BY 改为 `t.pinned DESC, t.last_opened_at DESC, t.updated_at DESC, t.id ASC`
- `map_task_row` / `RawTask`: 增加 `pinned` 列读取
- `persist_record`: INSERT/UPDATE 包含 `pinned` 列

### 2.4 Tauri 命令注册

文件：`apps/desktop/src-tauri/src/lib.rs`

```rust
#[tauri::command]
fn task_rename(app: AppHandle, id: String, title: String) -> Result<TaskRecord, String>

#[tauri::command]
fn task_pin(app: AppHandle, id: String, pinned: bool) -> Result<TaskRecord, String>

#[tauri::command]
fn task_search(app: AppHandle, query: String) -> Result<Vec<TaskRecord>, String>

#[tauri::command]
fn task_delete(app: AppHandle, terminal: State<TerminalManager>, id: String) -> Result<(), String>
```

## 3. Protocol 类型

文件：`packages/protocol/src/messages.ts`

- `PersistedTask` 接口增加 `pinned: boolean`
- 新增请求/响应类型：
  - `TaskRenameRequest { id: string; title: string }`
  - `TaskPinRequest { id: string; pinned: boolean }`
  - `TaskSearchRequest { query: string }`
  - `TaskDeleteRequest { id: string }`

## 4. 前端

### 4.1 SessionSidebar.tsx 修改

- **搜索**：`onChange` 200ms 防抖后调用 `task_search`，返回结果替换 `taskGroups`
- **排序**：pinned 条目自动排在分组顶部（后端已排序，前端渲染即可）
- **⋮ 按钮**：每个 session 条目 hover 时显示，点击弹出上下文菜单
- **上下文菜单**：Rename / Pin / Unpin / Archive
- **内联重命名**：Rename 点击后 title 变为 `<input>`，Enter 确认，Escape 取消
- **垃圾桶入口**：侧边栏底部 "Trash" 链接

### 4.2 TrashView 组件（新文件）

文件：`apps/desktop/src/features/sessions/TrashView.tsx`

- 调用 `task_list(include_archived: true)` 过滤 `archived = true`
- 每个条目显示：标题、项目路径、归档日期
- 操作按钮：Restore（→ `task_archive(id, false)`）、Delete Permanently（→ `task_delete(id)`）
- 永久删除前弹出确认对话框
- **30 天自动清理**：本版本不做自动清理。垃圾永久删除为用户手动操作。30 天 Trash 自动清理留待后续迭代。

### 4.3 Bridge 封装

文件：`apps/desktop/src/app/bridge.ts`（如存在）或直接 `invoke()` 调用

新增函数：
```ts
renameTask(id: string, title: string): Promise<PersistedTask>
pinTask(id: string, pinned: boolean): Promise<PersistedTask>
searchTasks(query: string): Promise<PersistedTask[]>
deleteTask(id: string): Promise<void>
```

### 4.4 i18n

文件：`apps/desktop/src/i18n/I18nProvider.tsx`

新增 zh-CN 键：
- `"Rename"` → `"重命名"`
- `"Pin"` → `"置顶"`
- `"Unpin"` → `"取消置顶"`
- `"Archive"` → `"归档"`
- `"Trash"` → `"垃圾桶"`
- `"Restore"` → `"恢复"`
- `"Delete permanently"` → `"永久删除"`
- `"Are you sure you want to permanently delete this session?"` → `"确定要永久删除此会话吗？"`
- `"No archived sessions"` → `"没有已归档的会话"`
- `"Archived"` → `"已归档"`

### 4.5 CSS

文件：`apps/desktop/src/styles.css`

新增样式：
- `.session-link__pin` — 置顶图标
- `.session-link__menu` — ⋮ 按钮（hover 显示）
- `.context-menu` — 右键/弹出菜单容器
- `.context-menu__item` — 菜单项
- `.session-rename-input` — 内联重命名输入框
- `.trash-view` / `.trash-item` — 垃圾桶视图

## 5. 测试

### 5.1 Rust 测试

文件：`apps/desktop/src-tauri/src/storage/task_repository.rs`

- `rename_updates_title_and_timestamp` — 重命名成功并更新 updated_at
- `rename_archived_task_fails` — 归档任务不可重命名
- `pin_toggles_pinned_flag` — 置顶/取消置顶切换
- `pin_archived_task_fails` — 归档任务不可置顶
- `search_matches_title_and_path` — 搜索匹配标题和路径
- `search_excludes_archived` — 搜索结果不包含归档任务
- `delete_removes_archived_task` — 永久删除已归档任务
- `delete_active_task_fails` — 不可删除未归档任务
- `list_sorts_pinned_first` — 列表排序 pinned 优先

### 5.2 前端测试

文件：`apps/desktop/src/features/sessions/TrashView.test.tsx`（新）
- 渲染归档列表、恢复/删除操作

文件：`apps/desktop/src/features/sessions/SessionSidebar.test.tsx`（修改）
- 右键菜单渲染、重命名输入框、搜索防抖

## 6. 文件清单

| 操作 | 文件 |
|---|---|
| 新增 | `apps/desktop/src-tauri/src/storage/migrations/002_pinned.sql` |
| 修改 | `apps/desktop/src-tauri/src/storage/tasks.rs` |
| 修改 | `apps/desktop/src-tauri/src/storage/task_repository.rs` |
| 修改 | `apps/desktop/src-tauri/src/lib.rs` |
| 修改 | `packages/protocol/src/messages.ts` |
| 修改 | `packages/protocol/src/index.ts` |
| 修改 | `apps/desktop/src/features/sessions/SessionSidebar.tsx` |
| 新增 | `apps/desktop/src/features/sessions/TrashView.tsx` |
| 修改 | `apps/desktop/src/i18n/I18nProvider.tsx` |
| 修改 | `apps/desktop/src/styles.css` |
| 修改 | `apps/desktop/src/app/bridge.ts`（如存在） |
| 新增 | `apps/desktop/src/features/sessions/TrashView.test.tsx` |
| 修改 | `apps/desktop/src/features/sessions/SessionSidebar.test.tsx`（如存在） |

## 7. 验证

1. `cargo test` — 所有 Rust 测试通过（含新增 9 个）
2. `npm --prefix apps/desktop run test:unit` — 所有前端测试通过
3. `npm run typecheck` — 零类型错误
4. `cargo fmt --check` — 格式检查通过
5. `npm --prefix apps/desktop run build` — 构建成功
6. GUI 冒烟：启动 .app → 右键会话 → 重命名/置顶/归档 → 垃圾桶恢复 → 搜索