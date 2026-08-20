import { deterministicChecks, splitTextStructure } from "../authorPipeline";
import type { CandidateGuardReport, GuardIssue, QualityCandidate, QualityGateRequest } from "./types";

const MIN_LENGTH_RATIO = 0.65;
const MAX_LENGTH_RATIO = 1.5;

function blocking(code: string, message: string): GuardIssue {
  return { code, severity: "blocking", message };
}

function warning(code: string, message: string): GuardIssue {
  return { code, severity: "warning", message };
}

export function evaluateCandidateGuards(
  request: QualityGateRequest,
  candidate: QualityCandidate,
): CandidateGuardReport {
  const issues: GuardIssue[] = [];
  const source = request.sourceText;
  const revised = candidate.text;
  const deterministic = deterministicChecks(source, revised, request.protectedTerms);

  for (const term of deterministic.missingTerms) {
    issues.push(blocking("MISSING_PROTECTED_TERM", `Потерян защищённый термин: ${term}`));
  }
  for (const number of deterministic.missingNumbers) {
    issues.push(blocking("MISSING_NUMBER", `После правки исчезло число: ${number}`));
  }
  for (const number of deterministic.addedNumbers) {
    issues.push(blocking("ADDED_NUMBER", `После правки появилось новое число: ${number}`));
  }

  let structureChanged = false;
  try {
    structureChanged = splitTextStructure(source).blocks.length !== splitTextStructure(revised).blocks.length;
  } catch {
    structureChanged = true;
  }
  if (structureChanged) {
    issues.push(blocking("STRUCTURE_CHANGED", "Правка изменила количество текстовых блоков."));
  }

  const sourceLength = Math.max(1, source.trim().length);
  const ratio = revised.trim().length / sourceLength;
  const editScopeExceeded = ratio < MIN_LENGTH_RATIO || ratio > MAX_LENGTH_RATIO;
  if (editScopeExceeded) {
    issues.push(warning(
      "EDIT_SCOPE_EXCEEDED",
      `Объём правки вышел за безопасный диапазон (${Math.round(ratio * 100)}% от исходника).`,
    ));
  }

  if (!revised.trim()) {
    issues.push(blocking("EMPTY_CANDIDATE", "Кандидат не содержит текста."));
  }
  if (revised.trim() === source.trim()) {
    issues.push(warning("IDENTICAL_CANDIDATE", "Кандидат содержательно не отличается от исходника."));
  }

  const audit = request.existingAudit;
  if (audit) {
    for (const issue of audit.factIssues) {
      if (issue.severity === "blocking") {
        issues.push(blocking("AUDIT_FACT_ISSUE", issue.problem));
      }
    }
    for (const issue of audit.protectedTermIssues) {
      issues.push(blocking("AUDIT_PROTECTED_TERM_ISSUE", issue));
    }
    if (!audit.passed && !issues.some((issue) => issue.severity === "blocking")) {
      issues.push(blocking("AUDIT_REJECTED", "Существующий финальный аудит не подтвердил правку."));
    }
  }

  return {
    candidateId: candidate.id,
    passed: !issues.some((issue) => issue.severity === "blocking"),
    issues,
    deterministic: {
      ...deterministic,
      structureChanged,
      editScopeExceeded,
    },
  };
}
