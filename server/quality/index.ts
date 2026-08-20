import { buildQualityRubric } from "./rubric";
import { evaluateCandidateGuards } from "./guards";
import { evaluateCandidateQuality } from "./critic";
import { runOrderInvertedDuel } from "./pairwise";
import { CRITIC_PROMPT_VERSION, PAIRWISE_PROMPT_VERSION } from "./prompts";
import type {
  PairwiseVote,
  QualityCandidateResult,
  QualityDecision,
  QualityGateOptions,
  QualityGateRequest,
  QualityGateResponse,
} from "./types";

const KEEP_CONFIDENCE = 0.7;

export function decideDuel(
  guardsPassed: boolean,
  criticHasBlockingIssues: boolean,
  votes: PairwiseVote[],
): QualityDecision {
  if (!guardsPassed || criticHasBlockingIssues) return "DISCARD";
  if (votes.length !== 2) return "NEEDS_AUTHOR_REVIEW";

  const candidateWins = votes.every(
    (vote) => vote.winner === "CANDIDATE" && vote.confidence >= KEEP_CONFIDENCE,
  );
  if (candidateWins) return "KEEP_RECOMMENDED";

  const sourceWins = votes.every((vote) => vote.winner === "SOURCE");
  if (sourceWins) return "DISCARD";

  return "NEEDS_AUTHOR_REVIEW";
}

function metadata(request: QualityGateRequest): QualityGateResponse["metadata"] {
  return {
    criticModel: request.criticModel,
    judgeModel: request.judgeModel,
    criticPromptVersion: CRITIC_PROMPT_VERSION,
    judgePromptVersion: PAIRWISE_PROMPT_VERSION,
    modelSeparation: request.criticModel === request.judgeModel ? "same_model" : "different_models",
  };
}

function makeResponse(
  request: QualityGateRequest,
  rubric: QualityGateResponse["rubric"],
  decision: QualityDecision,
  candidates: QualityCandidateResult[],
  summary: string,
  recommendedCandidateId?: string,
): QualityGateResponse {
  return {
    runId: request.requestId,
    decision,
    ...(recommendedCandidateId ? { recommendedCandidateId } : {}),
    rubric,
    candidates,
    summary,
    nextAction: decision === "KEEP_RECOMMENDED"
      ? "AUTHOR_CONFIRM"
      : decision === "DISCARD"
        ? "KEEP_SOURCE"
        : "MANUAL_COMPARE",
    metadata: metadata(request),
  };
}

export async function runQualityGate(
  request: QualityGateRequest,
  options: QualityGateOptions,
): Promise<QualityGateResponse> {
  const rubric = buildQualityRubric(request.rubricPreset);
  const results: QualityCandidateResult[] = [];
  let criticFailure = false;

  for (const candidate of request.candidates) {
    const guards = evaluateCandidateGuards(request, candidate);
    const result: QualityCandidateResult = { id: candidate.id, guards };
    if (guards.passed) {
      try {
        result.critic = await evaluateCandidateQuality(request, candidate, rubric, options.generate);
      } catch {
        criticFailure = true;
      }
    }
    results.push(result);
  }

  const eligible = results
    .filter((result) => result.guards.passed && result.critic && result.critic.blockingIssues.length === 0)
    .sort((left, right) => (right.critic?.totalScore ?? 0) - (left.critic?.totalScore ?? 0));

  if (!eligible.length) {
    if (criticFailure) {
      return makeResponse(
        request,
        rubric,
        "NEEDS_AUTHOR_REVIEW",
        results,
        "Содержательная оценка не завершилась надёжно; исходник сохранён без изменений.",
      );
    }
    return makeResponse(
      request,
      rubric,
      "DISCARD",
      results,
      "Ни один кандидат не прошёл обязательные проверки качества и целостности.",
    );
  }

  const finalist = eligible[0];
  const candidate = request.candidates.find((item) => item.id === finalist.id);
  if (!candidate || !finalist.critic) {
    return makeResponse(
      request,
      rubric,
      "NEEDS_AUTHOR_REVIEW",
      results,
      "Не удалось сопоставить кандидата с результатом оценки; исходник сохранён без изменений.",
    );
  }

  try {
    finalist.pairwise = await runOrderInvertedDuel(request, rubric, candidate.text, options.generate);
  } catch {
    return makeResponse(
      request,
      rubric,
      "NEEDS_AUTHOR_REVIEW",
      results,
      "Парное сравнение не завершилось надёжно; автору доступно ручное сопоставление версий.",
    );
  }

  const decision = decideDuel(
    finalist.guards.passed,
    finalist.critic.blockingIssues.length > 0,
    finalist.pairwise,
  );

  if (decision === "KEEP_RECOMMENDED") {
    return makeResponse(
      request,
      rubric,
      decision,
      results,
      "Кандидат уверенно победил исходник в обоих порядках сравнения. Версия рекомендована, но не применена автоматически.",
      finalist.id,
    );
  }
  if (decision === "DISCARD") {
    return makeResponse(
      request,
      rubric,
      decision,
      results,
      "Исходник удержал преимущество в обоих попарных сравнениях.",
    );
  }
  return makeResponse(
    request,
    rubric,
    decision,
    results,
    "ИИ не получил устойчивого преимущества для кандидата; требуется выбор автора.",
  );
}

export * from "./types";
export { buildQualityRubric } from "./rubric";
export { evaluateCandidateGuards } from "./guards";
