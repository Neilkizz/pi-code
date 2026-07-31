import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { useI18n } from "../../i18n/I18nProvider";
import {
  clampSideWidth,
  clampTerminalHeight,
  DEFAULT_PANE_LAYOUT,
  type PaneLayoutConfig,
} from "./paneLayoutState";

interface PaneLayoutProps {
  chatPane: ReactNode;
  inspectorPane?: ReactNode;
  terminalPane?: ReactNode;
  config: PaneLayoutConfig;
  hasRecord: boolean;
  onSideWidthChange: (width: number) => void;
  onTerminalHeightChange: (height: number) => void;
  onResetSideWidth?: () => void;
  onResetTerminalHeight?: () => void;
}

type NarrowTab = "chat" | "inspector" | "terminal";

const NARROW_BREAKPOINT = 760;

export function PaneLayout({
  chatPane,
  inspectorPane,
  terminalPane,
  config,
  hasRecord,
  onSideWidthChange,
  onTerminalHeightChange,
  onResetSideWidth,
  onResetTerminalHeight,
}: PaneLayoutProps) {
  const { t } = useI18n();
  const [isNarrow, setIsNarrow] = useState<boolean>(() =>
    typeof window !== "undefined" ? window.innerWidth < NARROW_BREAKPOINT : false,
  );
  const [narrowTab, setNarrowTab] = useState<NarrowTab>("chat");

  const [draggingCol, setDraggingCol] = useState(false);
  const [draggingRow, setDraggingRow] = useState(false);

  const containerRef = useRef<HTMLDivElement>(null);
  const startDragPos = useRef<{ x: number; y: number; width: number; height: number }>({
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
        height: config.terminalHeight,
      };
    },
    [config.sideWidth, config.terminalHeight],
  );

  // Horizontal Resizer (Row drag for Terminal height)
  const handleRowMouseDown = useCallback(
    (event: React.MouseEvent) => {
      event.preventDefault();
      setDraggingRow(true);
      startDragPos.current = {
        x: event.clientX,
        y: event.clientY,
        width: config.sideWidth,
        height: config.terminalHeight,
      };
    },
    [config.sideWidth, config.terminalHeight],
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
        } else if (draggingRow) {
          // Dragging up increases terminal height (since terminal is at the bottom)
          const deltaY = startDragPos.current.y - event.clientY;
          const nextHeight = clampTerminalHeight(startDragPos.current.height + deltaY);
          onTerminalHeightChange(nextHeight);
        }
      });
    }

    function handleMouseUp() {
      setDraggingCol(false);
      setDraggingRow(false);
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
  }, [draggingCol, draggingRow, onSideWidthChange, onTerminalHeightChange]);

  const showInspector = hasRecord && config.inspectorOpen && Boolean(inspectorPane);
  const showTerminal = hasRecord && config.terminalOpen && Boolean(terminalPane);

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
      className={`pane-layout ${draggingCol || draggingRow ? "pane-layout--resizing" : ""}`}
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

      {showTerminal ? (
        <>
          <div
            className={`pane-resizer pane-resizer--row ${draggingRow ? "pane-resizer--active" : ""}`}
            role="separator"
            aria-orientation="horizontal"
            aria-label={t("Resize terminal")}
            aria-valuenow={config.terminalHeight}
            tabIndex={0}
            onMouseDown={handleRowMouseDown}
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
