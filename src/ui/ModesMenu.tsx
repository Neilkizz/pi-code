import React from "react";

export type PermissionMode = "manual" | "edit" | "plan" | "auto" | "bypass";
export type EffortLevel = "off" | "low" | "medium" | "high" | "max";

interface Props {
	currentMode: PermissionMode;
	currentEffort: EffortLevel;
	onSelectMode: (mode: PermissionMode) => void;
	onSelectEffort: (effort: EffortLevel) => void;
	onClose: () => void;
}

const MODES: { id: PermissionMode; icon: string; title: string; desc: string }[] = [
	{
		id: "manual",
		icon: "✋",
		title: "Manual",
		desc: "Claude will ask for approval before making each edit",
	},
	{
		id: "edit",
		icon: "</>",
		title: "Edit automatically",
		desc: "Claude will edit your selected text or the whole file",
	},
	{
		id: "plan",
		icon: "📑",
		title: "Plan",
		desc: "Claude will explore the code and present a plan before editing",
	},
	{
		id: "auto",
		icon: "⚡",
		title: "Auto",
		desc: "Claude will approve actions that pass a safety check and pause for anything risky",
	},
	{
		id: "bypass",
		icon: "⇄",
		title: "Bypass permissions",
		desc: "Claude will not ask for approval before running potentially dangerous commands",
	},
];

const EFFORTS: { id: EffortLevel; label: string }[] = [
	{ id: "off", label: "Off" },
	{ id: "low", label: "Low" },
	{ id: "medium", label: "Med" },
	{ id: "high", label: "High" },
	{ id: "max", label: "Max" },
];

export function ModesMenu({
	currentMode,
	currentEffort,
	onSelectMode,
	onSelectEffort,
	onClose,
}: Props) {
	const menuRef = React.useRef<HTMLDivElement>(null);

	React.useEffect(() => {
		const handleClickOutside = (e: MouseEvent) => {
			if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
				onClose();
			}
		};
		const handleKeyDown = (e: KeyboardEvent) => {
			if (e.key === "Escape") onClose();
		};
		document.addEventListener("mousedown", handleClickOutside);
		document.addEventListener("keydown", handleKeyDown);
		return () => {
			document.removeEventListener("mousedown", handleClickOutside);
			document.removeEventListener("keydown", handleKeyDown);
		};
	}, [onClose]);

	return (
		<div className="claude-popup modes-menu-popup" ref={menuRef}>
			<div className="popup-header">
				<span className="popup-title">Modes</span>
				<div className="shortcut-chip">
					<kbd>⇧</kbd> + <kbd>tab</kbd> <span className="chip-text">to switch</span>
				</div>
			</div>

			<div className="modes-list">
				{MODES.map((mode) => {
					const isSelected = currentMode === mode.id;
					return (
						<div
							key={mode.id}
							className={`mode-item ${isSelected ? "selected" : ""}`}
							onClick={() => {
								onSelectMode(mode.id);
								onClose();
							}}
						>
							<div className="mode-icon-col">
								{mode.id === "manual" && (
									<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
										<path d="M18 11V6a2 2 0 0 0-4 0v5" />
										<path d="M14 10V4a2 2 0 0 0-4 0v6" />
										<path d="M10 10.5V6a2 2 0 0 0-4 0v8" />
										<path d="M18 8a2 2 0 0 1 4 0v6a8 8 0 0 1-8 8h-2c-2.8 0-4.5-.8-6-2.4L2 14" />
									</svg>
								)}
								{mode.id === "edit" && (
									<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
										<polyline points="16 18 22 12 16 6" />
										<polyline points="8 6 2 12 8 18" />
										<line x1="14" y1="4" x2="10" y2="20" />
									</svg>
								)}
								{mode.id === "plan" && (
									<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
										<path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
										<polyline points="14 2 14 8 20 8" />
										<line x1="16" y1="13" x2="8" y2="13" />
										<line x1="16" y1="17" x2="8" y2="17" />
										<polyline points="10 9 9 9 8 9" />
									</svg>
								)}
								{mode.id === "auto" && (
									<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
										<polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2" />
									</svg>
								)}
								{mode.id === "bypass" && (
									<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
										<polyline points="17 1 21 5 17 9" />
										<path d="M3 11V9a4 4 0 0 1 4-4h14" />
										<polyline points="7 23 3 19 7 15" />
										<path d="M21 13v2a4 4 0 0 1-4 4H3" />
									</svg>
								)}
							</div>

							<div className="mode-details">
								<div className="mode-title">{mode.title}</div>
								<div className="mode-desc">{mode.desc}</div>
							</div>

							{isSelected && (
								<div className="mode-checkmark">
									<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
										<polyline points="20 6 9 17 4 12" />
									</svg>
								</div>
							)}
						</div>
					);
				})}
			</div>

			<div className="popup-divider" />

			<div className="effort-row">
				<div className="effort-label">
					<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
						<line x1="4" y1="21" x2="4" y2="14" />
						<line x1="4" y1="10" x2="4" y2="3" />
						<line x1="12" y1="21" x2="12" y2="12" />
						<line x1="12" y1="8" x2="12" y2="3" />
						<line x1="20" y1="21" x2="20" y2="16" />
						<line x1="20" y1="12" x2="20" y2="3" />
						<line x1="1" y1="14" x2="7" y2="14" />
						<line x1="9" y1="8" x2="15" y2="8" />
						<line x1="17" y1="16" x2="23" y2="16" />
					</svg>
					<span>Effort ({currentEffort === "max" ? "Max" : currentEffort})</span>
				</div>

				<div className="effort-slider-track">
					{EFFORTS.map((eff, index) => {
						const activeIndex = EFFORTS.findIndex((e) => e.id === currentEffort);
						const isFilled = index <= activeIndex;
						const isMaxDot = index === 4;
						return (
							<div
								key={eff.id}
								className={`effort-slider-dot ${isFilled ? "filled" : ""} ${
									currentEffort === eff.id ? "current" : ""
								} ${isMaxDot ? "purple-dot" : ""}`}
								title={eff.label}
								onClick={() => onSelectEffort(eff.id)}
							/>
						);
					})}
				</div>
			</div>
		</div>
	);
}
