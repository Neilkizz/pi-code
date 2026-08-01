import { useEffect, useState } from "react";
import { emit, listen } from "@tauri-apps/api/event";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { useI18n } from "../../i18n/I18nProvider";

export function QuickEntry() {
  const { t } = useI18n();
  const [prompt, setPrompt] = useState("");
  const [captureScreenshot, setCaptureScreenshot] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const currentWindow = getCurrentWindow();

  useEffect(() => {
    void currentWindow.setFocus();
    const unlisten = listen("quick-entry-open", () => {
      setPrompt("");
      setCaptureScreenshot(false);
      setSubmitting(false);
      void currentWindow.setFocus();
    });
    return () => {
      void unlisten.then((fn) => fn());
    };
  }, [currentWindow]);

  async function submit(): Promise<void> {
    const text = prompt.trim();
    if (!text || submitting) return;
    setSubmitting(true);
    await emit("quick-entry-submit", {
      prompt: text,
      captureScreenshot,
    });
    await currentWindow.hide();
  }

  return (
    <div className="quick-entry">
      <h1 className="quick-entry__title">{t("Quick Entry")}</h1>
      <textarea
        className="quick-entry__input"
        value={prompt}
        onChange={(event) => setPrompt(event.target.value)}
        placeholder={t("Describe what you want Pi to do…")}
        onKeyDown={(event) => {
          if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing) {
            event.preventDefault();
            void submit();
          } else if (event.key === "Escape") {
            void currentWindow.hide();
          }
        }}
        autoFocus
      />
      <div className="quick-entry__actions">
        <button
          type="button"
          className={`quick-entry__screenshot ${
            captureScreenshot ? "quick-entry__screenshot--active" : ""
          }`}
          onClick={() => setCaptureScreenshot((value) => !value)}
          aria-pressed={captureScreenshot}
          title={t("Screenshot")}
        >
          {t("Screenshot")}
        </button>
        <button
          type="button"
          className="quick-entry__submit"
          onClick={() => void submit()}
          disabled={!prompt.trim() || submitting}
        >
          {t("Submit")}
        </button>
      </div>
    </div>
  );
}
