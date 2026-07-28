import React from "react";
import type { EffortLevel } from "./ModesMenu";

interface Props {
	currentModel: string;
	currentEffort: EffortLevel;
	thinkingEnabled: boolean;
	flaggedModelSwitch: boolean;
	onSelectAction: (action: string) => void;
	onToggleThinking: () => void;
	onToggleFlaggedSwitch: () => void;
	onSelectEffort: (effort: EffortLevel) => void;
	onClose: () => void;
}

const EFFORTS: { id: EffortLevel; label: string }[] = [
	{ id: "off", label: "Off" },
	{ id: "low", label: "Low" },
	{ id: "medium", label: "Med" },
	{ id: "high", label: "High" },
	{ id: "max", label: "Max" },
];

export function ActionsMenu({
	currentModel,
	currentEffort,
	thinkingEnabled,
	flaggedModelSwitch,
	onSelectAction,
	onToggleThinking,
	onToggleFlaggedSwitch,
	onSelectEffort,
	onClose,
}: Props) {
	const [filter, setFilter] = React.useState("");
	const menuRef = React.useRef<HTMLDivElement>(null);
	const inputRef = React.useRef<HTMLInputElement>(null);

	React.useEffect(() => {
		inputRef.current?.focus();
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

	const matchesFilter = (text: string) =>
		!filter || text.toLowerCase().includes(filter.toLowerCase());

	return (
		<div className="claude-popup actions-menu-popup" ref={menuRef}>
			<div className="actions-filter-header">
				<input
					ref={inputRef}
					type="text"
					className="actions-filter-input"
					placeholder="Filter actions..."
					value={filter}
					onChange={(e) => setFilter(e.target.value)}
				/>
			</div>

			<div className="actions-scroll-area">
				{/* Context Section */}
				{(matchesFilter("context") ||
					matchesFilter("attach file") ||
					matchesFilter("mention file") ||
					matchesFilter("clear conversation") ||
					matchesFilter("rewind")) && (
					<div className="actions-group">
						<div className="actions-group-title">Context</div>

						{matchesFilter("attach file") && (
							<div
								className="action-row"
								onClick={() => {
									onSelectAction("attach");
									onClose();
								}}
							>
								<span>Attach file...</span>
							</div>
						)}

						{matchesFilter("mention file") && (
							<div
								className="action-row"
								onClick={() => {
									onSelectAction("mention");
									onClose();
								}}
							>
								<span>Mention file from this project...</span>
							</div>
						)}

						{matchesFilter("clear conversation") && (
							<div
								className="action-row"
								onClick={() => {
									onSelectAction("clear");
									onClose();
								}}
							>
								<span>Clear conversation</span>
							</div>
						)}

						{matchesFilter("rewind") && (
							<div
								className="action-row highlighted"
								onClick={() => {
									onSelectAction("rewind");
									onClose();
								}}
							>
								<span>Rewind</span>
							</div>
						)}
					</div>
				)}

				{/* Model Section */}
				{(matchesFilter("model") ||
					matchesFilter("switch model") ||
					matchesFilter("effort") ||
					matchesFilter("thinking") ||
					matchesFilter("account")) && (
					<div className="actions-group">
						<div className="actions-group-title">Model</div>

						{matchesFilter("switch model") && (
							<div
								className="action-row space-between"
								onClick={() => {
									onSelectAction("switchModel");
									onClose();
								}}
							>
								<span>Switch model...</span>
								<span className="action-value-label">
									{currentModel ? currentModel : "Default (recommended)"}
								</span>
							</div>
						)}

						{matchesFilter("effort") && (
							<div className="action-row space-between no-hover">
								<span>Effort ({currentEffort === "max" ? "Max" : currentEffort})</span>
								<div className="effort-slider-track mini">
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
												onClick={(e) => {
													e.stopPropagation();
													onSelectEffort(eff.id);
												}}
											/>
										);
									})}
								</div>
							</div>
						)}

						{matchesFilter("thinking") && (
							<div className="action-row space-between" onClick={onToggleThinking}>
								<span>Thinking</span>
								<div className={`claude-toggle-pill ${thinkingEnabled ? "active" : ""}`}>
									<div className="toggle-thumb" />
								</div>
							</div>
						)}

						{matchesFilter("switch models when a message is flagged") && (
							<div className="action-row space-between" onClick={onToggleFlaggedSwitch}>
								<span>Switch models when a message is flagged</span>
								<div className={`claude-toggle-pill ${flaggedModelSwitch ? "active" : ""}`}>
									<div className="toggle-thumb" />
								</div>
							</div>
						)}

						{matchesFilter("account") && (
							<div
								className="action-row"
								onClick={() => {
									onSelectAction("account");
									onClose();
								}}
							>
								<span>Account & usage...</span>
							</div>
						)}
					</div>
				)}
			</div>
		</div>
	);
}
