import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import React from "react";
import type { WorkspaceFileContent } from "@pi-desktop/protocol";
import { I18nProvider } from "../../i18n/I18nProvider";
import { FileEditor } from "./FileEditor";

const { writeWorkspaceFile } = vi.hoisted(() => ({
  writeWorkspaceFile: vi.fn(),
}));

vi.mock("../../platform/tauri/bridge", () => ({ writeWorkspaceFile }));

const file: WorkspaceFileContent = {
  path: "a.txt",
  content: "one\ntwo\n",
  language: "plain text",
  size: 8,
  binary: false,
  truncated: false,
  hash: "h1",
};

function renderEditor(onSaved = vi.fn(), onError = vi.fn()) {
  render(
    <I18nProvider>
      <FileEditor file={file} taskId="t1" onSaved={onSaved} onError={onError} />
    </I18nProvider>,
  );
}

describe("FileEditor", () => {
  beforeEach(() => {
    writeWorkspaceFile.mockReset();
  });

  it("renders the file content in an editable textarea", () => {
    renderEditor();
    const textarea = screen.getByRole("textbox", { name: "Edit file" });
    expect((textarea as HTMLTextAreaElement).value).toBe("one\ntwo\n");
  });

  it("saves edited content with the base hash, then notifies the parent", async () => {
    writeWorkspaceFile.mockResolvedValue({
      ok: true,
      path: "a.txt",
      bytesWritten: 7,
      hash: "h2",
    });
    const onSaved = vi.fn();
    const onError = vi.fn();
    renderEditor(onSaved, onError);

    const textarea = screen.getByRole("textbox", { name: "Edit file" });
    fireEvent.change(textarea, { target: { value: "edited\n" } });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));

    await waitFor(() =>
      expect(writeWorkspaceFile).toHaveBeenCalledWith(
        "t1",
        "a.txt",
        "edited\n",
        "h1",
      ),
    );
    await waitFor(() => expect(onSaved).toHaveBeenCalled());
    expect(onError).not.toHaveBeenCalled();
  });

  it("surfaces a stale-change error via onError", async () => {
    writeWorkspaceFile.mockRejectedValue(
      new Error("File changed on disk — refresh to edit the current version"),
    );
    const onSaved = vi.fn();
    const onError = vi.fn();
    renderEditor(onSaved, onError);

    const textarea = screen.getByRole("textbox", { name: "Edit file" });
    fireEvent.change(textarea, { target: { value: "edited\n" } });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));

    await waitFor(() =>
      expect(onError).toHaveBeenCalledWith(
        "File changed on disk — refresh to edit the current version",
      ),
    );
    expect(onSaved).not.toHaveBeenCalled();
  });

  it("keeps Save disabled until the content is dirty", () => {
    renderEditor();
    expect(
      (screen.getByRole("button", { name: "Save" }) as HTMLButtonElement)
        .disabled,
    ).toBe(true);
  });
});
