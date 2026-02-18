import type { CategoryScore } from '../models/test-result.model.js';
import Test from '../models/test.model.js';
import TestQuestion from '../models/test-question.model.js';

export interface ComputeScoresResult {
    score: number;
    scoresByCategory: CategoryScore[];
}

/** Objet ayant au minimum testId et responses (document TestResult ou équivalent). */
export interface ResultWithResponses {
    testId: unknown;
    responses?: Array<{ questionId: unknown; score?: number }>;
}

/**
 * Calcule le score global et les sous-scores par catégorie à partir des réponses d'un TestResult.
 * Les questions sans categoryId contribuent au score global uniquement (pas d'entrée dans scoresByCategory).
 */
export async function computeScoresByCategory (result: ResultWithResponses): Promise<ComputeScoresResult> {
    const responses = result.responses || [];
    let score = 0;
    const categoryMap = new Map<string, { score: number; maxScore: number; categoryId: unknown }>();

    const test = await Test.findById(result.testId).lean();
    if (!test) {
        return { score: 0, scoresByCategory: [] };
    }

    for (const res of responses) {
        const questionId = res.questionId?.toString?.() ?? res.questionId;
        if (!questionId) continue;

        const question = await TestQuestion.findById(questionId).lean();
        if (!question) continue;

        const responseScore = typeof res.score === 'number' && !isNaN(res.score) ? res.score : 0;
        const questionMaxScore = typeof question.maxScore === 'number' && !isNaN(question.maxScore) ? question.maxScore : 0;

        score += responseScore;

        const catId = question.categoryId;
        if (catId) {
            const key = (catId as { toString?: () => string }).toString?.() ?? String(catId);
            const existing = categoryMap.get(key);
            if (existing) {
                existing.score += responseScore;
                existing.maxScore += questionMaxScore;
            } else {
                categoryMap.set(key, {
                    categoryId: catId,
                    score: responseScore,
                    maxScore: questionMaxScore
                });
            }
        }
    }

    const scoresByCategory: CategoryScore[] = Array.from(categoryMap.values()).map(({ categoryId, score: catScore, maxScore: catMax }) => ({
        categoryId: categoryId as CategoryScore['categoryId'],
        score: catScore,
        maxScore: catMax
    }));

    return { score, scoresByCategory };
}
