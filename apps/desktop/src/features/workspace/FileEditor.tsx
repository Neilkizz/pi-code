import { useEffect, useState } from "react";
import type { WorkspaceFileContent } from "@pi-desktop/protocol";
import { writeWorkspaceFile } from "../../platform/tauri/bridge";
import { useI18n } from "../../i18n/I18nProvider";

interface FileEditorProps {
  file: WorkspaceFileContent;
  taskId: string;
  onSaved: () => void;
  onError: (message: string) => void;
}

/** Light in-app text editor. Save goes through the user-actor write path
 *  (`workspace_file_write`); the parent re-reads the file afterwards so the
 *  preview carries the fresh content hash. */
export function FileEditor({ file, taskId, onSaved, onError }: FileEditorProps) {
  const { t } = useI18n();
  const [draft, setDraft] = useState(file.content);
  const [saving, setSaving] = useState(false);
  const dirty = draft !== file.content;

  useEffect(() => {
    setDraft(file.content);
  }, [file.content, file.hash]);

  async function save(): Promise<void> {
    if (saving || !dirty) return;
    setSaving(true);
    try {
      await writeWorkspaceFile(taskId, file.path, draft, file.hash);
      onSaved();
    } catch (cause: unknown) {
      onError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="file-editor">
      <textarea
        value={draft}
        onChange={(event) => setDraft(event.target.value)}
        onKeyDown={(event) => {
          if ((event.metaKey || event.ctrlKey) && event.key === "s") {
            event.preventDefault();
            void save();
          }
        }}
        spellCheck={false}
        aria-label={t("Edit file")}
      />
      <footer className="file-editor__bar">
        <span>{dirty ? t("Unsaved changes") : t("Saved")}</span>
        <button
          type="button"
          onClick={() => void save()}
          disabled={saving || !dirty}
        >
          {saving ? t("Saving…") : t("Save")}
        </button>
      </footer>
    </div>
  );
}
