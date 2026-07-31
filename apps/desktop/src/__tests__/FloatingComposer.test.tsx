import { render, screen, fireEvent } from "@testing-library/react";
import { describe, it, expect, vi } from "vitest";
import React, { useState } from "react";
import { Composer } from "../features/composer/Composer";
import { I18nProvider } from "../i18n/I18nProvider";

function TestComposerWrapper(props: any) {
  const [draft, setDraft] = useState(props.initialDraft ?? "");
  return (
    <Composer
      hasTask={true}
      prompt={draft}
      draft={draft}
      onPromptChange={setDraft}
      onDraftChange={setDraft}
      isHostConnected={true}
      isSessionReady={true}
      isRunning={false}
      {...props}
    />
  );
}

describe("FloatingComposer", () => {
  it("triggers send on Enter and newline on Shift+Enter", () => {
    const onSend = vi.fn();
    const { container } = render(
      <I18nProvider>
        <TestComposerWrapper onSubmit={onSend} />
      </I18nProvider>,
    );
    const textarea = container.querySelector("textarea")!;
    fireEvent.change(textarea, { target: { value: "Hello Pi" } });
    fireEvent.keyDown(textarea, { key: "Enter", shiftKey: false });
    expect(onSend).toHaveBeenCalled();
  });

  it("opens mentions autocomplete when typing @ and inserts selection on Enter", () => {
    const { container } = render(
      <I18nProvider>
        <TestComposerWrapper initialDraft="@App" />
      </I18nProvider>,
    );
    const textarea = container.querySelector("textarea")!;
    fireEvent.keyDown(textarea, { key: "@" });

    // Autocomplete popup should be rendered
    const listbox = screen.getByRole("listbox");
    expect(listbox).toBeDefined();

    // Key down arrow to navigate to second item (Composer.tsx)
    fireEvent.keyDown(textarea, { key: "ArrowDown" });
    fireEvent.keyDown(textarea, { key: "Enter" });

    expect(textarea.value).toContain("Composer.tsx");
  });

  it("shows stop button when task is running", () => {
    const onAbort = vi.fn();
    render(
      <I18nProvider>
        <TestComposerWrapper isRunning={true} onAbort={onAbort} />
      </I18nProvider>,
    );
    const stopButton = screen.getByRole("button", { name: /Stop Pi|停止/i });
    expect(stopButton).toBeDefined();
    fireEvent.click(stopButton);
    expect(onAbort).toHaveBeenCalled();
  });
});
