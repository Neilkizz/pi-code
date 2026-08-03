import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { useI18n } from "../../i18n/I18nProvider";
import {
  clampPreviewHeight,
  clampSideWidth,
  clampTerminalHeight,
  DEFAULT_PANE_LAYOUT,
  type PaneLayoutConfig,
} from "./paneLayoutState";

interface PaneLayoutProps {
  chatPane: ReactNode;
  inspectorPane?: ReactNode;
  terminalPane?: ReactNode;
  previewPane?: ReactNode;
  config: PaneLayoutConfig;
  hasRecord: boolean;
  onSideWidthChange: (width: number) => void;
  onTerminalHeightChange: (height: number) => void;
  onPreviewHeightChange: (height: number) => void;
  onResetSideWidth?: () => void;
  onResetTerminalHeight?: () => void;
  onResetPreviewHeight?: () => void;
}

type NarrowTab = "chat" | "inspector" | "terminal" | "preview";
type RowTarget = "preview" | "terminal";

const NARROW_BREAKPOINT = 760;

export function PaneLayout({
  chatPane,
  inspectorPane,
  terminalPane,
  previewPane,
  config,
  hasRecord,
  onSideWidthChange,
  onTerminalHeightChange,
  onPreviewHeightChange,
  onResetSideWidth,
  onResetTerminalHeight,
  onResetPreviewHeight,
}: PaneLayoutProps) {
  const { t } = useI18n();
  const [isNarrow, setIsNarrow] = useState<boolean>(() =>
    typeof window !== "undefined" ? window.innerWidth < NARROW_BREAKPOINT : false,
  );
  const [narrowTab, setNarrowTab] = useState<NarrowTab>("chat");

  const [draggingCol, setDraggingCol] = useState(false);
  const [draggingRow, setDraggingRow] = useState<RowTarget | null>(null);

  const containerRef = useRef<HTMLDivElement>(null);
  const startDragPos = useRef<{
    x: number;
    y: number;
    width: number;
    height: number;
  }>({
    x: 0,
    y: 0,
    width: config.sideWidth,
    height: config.terminalHeight,
  });

  useEffect(() => {
    function handleResize() {
      setIsNarrow(window.innerWidth < NARROW_BREAKPOINT);
    }
    window.addEventListener("resize", handleResize);
    return () => window.removeEventListener("resize", handleResize);
  }, []);

  // Vertical Resizer (Column drag for Inspector width)
  const handleColMouseDown = useCallback(
    (event: React.MouseEvent) => {
      event.preventDefault();
      setDraggingCol(true);
      startDragPos.current = {
        x: event.clientX,
        y: event.clientY,
        width: config.sideWidth,
        height: 0,
      };
    },
    [config.sideWidth],
  );

  // Horizontal Resizer (Row drag for Preview / Terminal height)
  const handleRowMouseDown = useCallback(
    (target: RowTarget) => (event: React.MouseEvent) => {
      event.preventDefault();
      setDraggingRow(target);
      startDragPos.current = {
        x: event.clientX,
        y: event.clientY,
        width: 0,
        height:
          target === "terminal" ? config.terminalHeight : config.previewHeight,
      };
    },
    [config.terminalHeight, config.previewHeight],
  );

  useEffect(() => {
    if (!draggingCol && !draggingRow) return;

    let animationFrameId: number | null = null;

    function handleMouseMove(event: MouseEvent) {
      if (animationFrameId !== null) return;
      animationFrameId = requestAnimationFrame(() => {
        animationFrameId = null;
        if (draggingCol) {
          // Dragging left increases inspector width (since inspector is on the right)
          const deltaX = startDragPos.current.x - event.clientX;
          const nextWidth = clampSideWidth(startDragPos.current.width + deltaX);
          onSideWidthChange(nextWidth);
        } else if (draggingRow === "terminal") {
          // Dragging up increases terminal height (since terminal is at the bottom)
          const deltaY = startDragPos.current.y - event.clientY;
          const nextHeight = clampTerminalHeight(
            startDragPos.current.height + deltaY,
          );
          onTerminalHeightChange(nextHeight);
        } else if (draggingRow === "preview") {
          const deltaY = startDragPos.current.y - event.clientY;
          const nextHeight = clampPreviewHeight(
            startDragPos.current.height + deltaY,
          );
          onPreviewHeightChange(nextHeight);
        }
      });
    }

    function handleMouseUp() {
      setDraggingCol(false);
      setDraggingRow(null);
      if (animationFrameId !== null) {
        cancelAnimationFrame(animationFrameId);
        animationFrameId = null;
      }
    }

    window.addEventListener("mousemove", handleMouseMove);
    window.addEventListener("mouseup", handleMouseUp);
    return () => {
      window.removeEventListener("mousemove", handleMouseMove);
      window.removeEventListener("mouseup", handleMouseUp);
      if (animationFrameId !== null) cancelAnimationFrame(animationFrameId);
    };
  }, [
    draggingCol,
    draggingRow,
    onSideWidthChange,
    onTerminalHeightChange,
    onPreviewHeightChange,
  ]);

  const showInspector = hasRecord && config.inspectorOpen && Boolean(inspectorPane);
  const showTerminal = hasRecord && config.terminalOpen && Boolean(terminalPane);
  const showPreview = hasRecord && config.previewOpen && Boolean(previewPane);

  // If narrow viewport, render tab bar and single active pane
  if (isNarrow) {
    return (
      <div className="pane-layout pane-layout--narrow">
        {hasRecord ? (
          <div className="pane-layout__narrow-tabs" role="tablist">
            <button
              type="button"
              className={`pane-layout__tab ${narrowTab === "chat" ? "pane-layout__tab--active" : ""}`}
              onClick={() => setNarrowTab("chat")}
              role="tab"
              aria-selected={narrowTab === "chat"}
            >
              {t("Chat")}
            </button>
            <button
              type="button"
              className={`pane-layout__tab ${narrowTab === "inspector" ? "pane-layout__tab--active" : ""}`}
              onClick={() => setNarrowTab("inspector")}
              role="tab"
              aria-selected={narrowTab === "inspector"}
            >
              {t("Review")}
            </button>
            <button
              type="button"
              className={`pane-layout__tab ${narrowTab === "preview" ? "pane-layout__tab--active" : ""}`}
              onClick={() => setNarrowTab("preview")}
              role="tab"
              aria-selected={narrowTab === "preview"}
            >
              {t("Preview")}
            </button>
            <button
              type="button"
              className={`pane-layout__tab ${narrowTab === "terminal" ? "pane-layout__tab--active" : ""}`}
              onClick={() => setNarrowTab("terminal")}
              role="tab"
              aria-selected={narrowTab === "terminal"}
            >
              {t("Terminal")}
            </button>
          </div>
        ) : null}
        <div className="pane-layout__narrow-content">
          {narrowTab === "chat" || !hasRecord ? (
            chatPane
          ) : narrowTab === "inspector" ? (
            inspectorPane
          ) : narrowTab === "preview" ? (
            previewPane
          ) : (
            terminalPane
          )}
        </div>
      </div>
    );
  }

  return (
    <div
      ref={containerRef}
      className={`pane-layout ${
        draggingCol || draggingRow ? "pane-layout--resizing" : ""
      }`}
    >
      <div className="pane-layout__top-section">
        <div className="pane-layout__chat-pane">{chatPane}</div>

        {showInspector ? (
          <>
            <div
              className={`pane-resizer pane-resizer--col ${draggingCol ? "pane-resizer--active" : ""}`}
              role="separator"
              aria-orientation="vertical"
              aria-label={t("Resize side panel")}
              aria-valuenow={config.sideWidth}
              tabIndex={0}
              onMouseDown={handleColMouseDown}
              onDoubleClick={() => onResetSideWidth?.() ?? onSideWidthChange(DEFAULT_PANE_LAYOUT.sideWidth)}
              onKeyDown={(e) => {
                if (e.key === "ArrowLeft") {
                  onSideWidthChange(clampSideWidth(config.sideWidth + 10));
                } else if (e.key === "ArrowRight") {
                  onSideWidthChange(clampSideWidth(config.sideWidth - 10));
                }
              }}
            />
            <div
              className="pane-layout__side-pane"
              style={{ width: `${config.sideWidth}px` }}
            >
              {inspectorPane}
            </div>
          </>
        ) : null}
      </div>

      {showPreview ? (
        <>
          <div
            className={`pane-resizer pane-resizer--row ${draggingRow === "preview" ? "pane-resizer--active" : ""}`}
            role="separator"
            aria-orientation="horizontal"
            aria-label={t("Resize preview")}
            aria-valuenow={config.previewHeight}
            tabIndex={0}
            onMouseDown={handleRowMouseDown("preview")}
            onDoubleClick={() => onResetPreviewHeight?.() ?? onPreviewHeightChange(DEFAULT_PANE_LAYOUT.previewHeight)}
            onKeyDown={(e) => {
              if (e.key === "ArrowUp") {
                onPreviewHeightChange(clampPreviewHeight(config.previewHeight + 10));
              } else if (e.key === "ArrowDown") {
                onPreviewHeightChange(clampPreviewHeight(config.previewHeight - 10));
              }
            }}
          />
          <div
            className="pane-layout__bottom-pane"
            style={{ height: `${config.previewHeight}px` }}
          >
            {previewPane}
          </div>
        </>
      ) : null}

      {showTerminal ? (
        <>
          <div
            className={`pane-resizer pane-resizer--row ${draggingRow === "terminal" ? "pane-resizer--active" : ""}`}
            role="separator"
            aria-orientation="horizontal"
            aria-label={t("Resize terminal")}
            aria-valuenow={config.terminalHeight}
            tabIndex={0}
            onMouseDown={handleRowMouseDown("terminal")}
            onDoubleClick={() => onResetTerminalHeight?.() ?? onTerminalHeightChange(DEFAULT_PANE_LAYOUT.terminalHeight)}
            onKeyDown={(e) => {
              if (e.key === "ArrowUp") {
                onTerminalHeightChange(clampTerminalHeight(config.terminalHeight + 10));
              } else if (e.key === "ArrowDown") {
                onTerminalHeightChange(clampTerminalHeight(config.terminalHeight - 10));
              }
            }}
          />
          <div
            className="pane-layout__bottom-pane"
            style={{ height: `${config.terminalHeight}px` }}
          >
            {terminalPane}
          </div>
        </>
      ) : null}
    </div>
  );
}
