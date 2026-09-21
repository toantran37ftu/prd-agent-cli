/**
 * L3 Human Gate — §5.6
 * Renders structured issue list + diff + checklist for human review.
 * Terminal UI with accept/reject/comment per issue.
 */

export interface GateIssue {
  id: string;
  severity: "high" | "medium" | "low";
  section: string;
  rule: string;
  message: string;
  quote?: string;
  sourceExcerpt?: string;
}

export interface GateChecklistItem {
  id: string;
  text: string;
  checked: boolean;
}

export interface GateState {
  runId: string;
  docTitle: string;
  issues: GateIssue[];
  humanChecklist: GateChecklistItem[];
  diff?: string;
  decisions: Record<string, "accept" | "reject" | "comment">;
  comments: Record<string, string>;
}

/**
 * Render the gate interface as terminal text (§5.6).
 */
export function renderGate(state: GateState): string {
  const lines: string[] = [];

  lines.push(
    `╭─ GATE: ${state.docTitle} (${state.issues.length} issue cần quyết định) ─────────────╮`,
  );

  // Issues
  for (let i = 0; i < state.issues.length; i++) {
    const issue = state.issues[i];
    const decision = state.decisions[issue.id];

    lines.push(`│`);
    lines.push(`│ [${i + 1}] ${issue.severity.toUpperCase()} · ${issue.section} · ${issue.rule}`);
    lines.push(`│     ${issue.message}`);

    if (issue.quote) {
      lines.push(`│     Câu: "${issue.quote}"`);
    }
    if (issue.sourceExcerpt) {
      lines.push(`│     Trích nguồn: ${issue.sourceExcerpt}`);
    }

    if (decision) {
      lines.push(`│     → DECIDED: ${decision.toUpperCase()}`);
      if (state.comments[issue.id]) {
        lines.push(`│     Comment: ${state.comments[issue.id]}`);
      }
    } else {
      lines.push(`│     → [a]ccept  [r]eject  [c]omment  [o]pen doc`);
    }
  }

  // Human checklist
  if (state.humanChecklist.length > 0) {
    lines.push(`│`);
    lines.push(`│ CHECKLIST CỦA NGƯỜI (agent không kiểm được):`);
    for (const item of state.humanChecklist) {
      const check = item.checked ? "[x]" : "[ ]";
      lines.push(`│   ${check} ${item.text}`);
    }
  }

  // Diff
  if (state.diff) {
    lines.push(`│`);
    lines.push(`│ DIFF:`);
    for (const line of state.diff.split("\n").slice(0, 20)) {
      lines.push(`│ ${line}`);
    }
    if (state.diff.split("\n").length > 20) {
      lines.push(`│ ... (${state.diff.split("\n").length - 20} more lines)`);
    }
  }

  lines.push(`╰──────────────────────────────────────────────────────────────────────────╯`);

  return lines.join("\n");
}

/**
 * Check if gate is fully decided (all issues resolved).
 */
export function isGateComplete(state: GateState): boolean {
  return state.issues.every((issue) => state.decisions[issue.id] !== undefined);
}

/**
 * Count unresolved high-severity issues.
 */
export function countUnresolvedHigh(state: GateState): number {
  return state.issues.filter(
    (issue) =>
      issue.severity === "high" && state.decisions[issue.id] === undefined,
  ).length;
}

/**
 * Create a default gate state from lint report and critic issues.
 */
export function createGateState(
  runId: string,
  docTitle: string,
  issues: GateIssue[],
  humanChecklist: GateChecklistItem[],
  diff?: string,
): GateState {
  return {
    runId,
    docTitle,
    issues,
    humanChecklist,
    diff,
    decisions: {},
    comments: {},
  };
}
