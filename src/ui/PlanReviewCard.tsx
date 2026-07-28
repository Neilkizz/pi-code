import React, { useState } from "react";

export function formatPlanFeedback(feedback: string): string {
	if (!feedback.trim()) return "";
	return `Instead of the proposed plan, please do this: ${feedback.trim()}`;
}

interface PlanReviewCardProps {
	planMarkdown: string;
	onAcceptPlan: () => void;
	onRevisePlan: (feedback: string) => void;
}

export function PlanReviewCard({
	planMarkdown,
	onAcceptPlan,
	onRevisePlan,
}: PlanReviewCardProps) {
	const [feedback, setFeedback] = useState("");
	const [isAccepted, setIsAccepted] = useState(false);

	const handleRevise = () => {
		if (!feedback.trim()) return;
		onRevisePlan(feedback.trim());
		setFeedback("");
	};

	return (
		<div className="plan-review-card">
			<div className="plan-card-header">
				<span className="plan-icon">📑</span>
				<span className="plan-title">Plan Review</span>
				<span className="plan-badge">Action Required</span>
			</div>

			<div className="plan-card-body">
				<div className="plan-markdown-content">{planMarkdown}</div>
			</div>

			{!isAccepted ? (
				<div className="plan-card-footer">
					<button
						type="button"
						className="accept-plan-btn"
						onClick={() => {
							setIsAccepted(true);
							onAcceptPlan();
						}}
					>
						✓ Accept Plan
					</button>

					<div className="revise-plan-row">
						<input
							type="text"
							placeholder="Tell Claude what to do instead..."
							value={feedback}
							onChange={(e) => setFeedback(e.target.value)}
							onKeyDown={(e) => {
								if (e.key === "Enter") handleRevise();
							}}
						/>
						<button
							type="button"
							className="revise-btn"
							onClick={handleRevise}
							disabled={!feedback.trim()}
						>
							Send
						</button>
					</div>
				</div>
			) : (
				<div className="plan-card-accepted">
					<span className="accepted-check">✓</span> Plan accepted. Proceeding with edits...
				</div>
			)}
		</div>
	);
}
