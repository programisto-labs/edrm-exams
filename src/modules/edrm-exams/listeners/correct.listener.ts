import { enduranceListener, enduranceEventTypes, enduranceEmitter } from '@programisto/endurance';
import TestQuestion from '../models/test-question.model.js';
import { generateLiveMessage } from '../lib/openai.js';
import { computeScoresByCategory } from '../lib/score-utils.js';
import TestResult, { TestState } from '../models/test-result.model.js';
import CandidateModel from '../models/candidate.model.js';
import ContactModel from '../models/contact.model.js';
import TestModel from '../models/test.model.js';

interface CorrectionResult {
  score: number;
  commentaire: string;
  comment?: string;
}

const QUESTION_TYPE_MCQ = 'MCQ';

interface McqQuestionLike {
  questionType: string;
  possibleResponses?: Array<{ possibleResponse?: string; valid?: boolean }>;
  maxScore: number;
}

/**
 * Pour un QCM avec bonne réponse enregistrée (possibleResponses avec valid: true),
 * retourne { score, comment } sans appeler OpenAI.
 * Retourne null si la question n'est pas un QCM corrigeable automatiquement.
 */
function correctMcqIfPossible (
  question: McqQuestionLike,
  candidateResponse: string
): { score: number; comment: string } | null {
  if (question.questionType !== QUESTION_TYPE_MCQ) return null;
  const possibleResponses = question.possibleResponses;
  if (!Array.isArray(possibleResponses) || possibleResponses.length === 0) return null;
  const validIndex = possibleResponses.findIndex((r: { valid?: boolean }) => r.valid === true);
  if (validIndex === -1) return null;

  const normalizedCandidate = String(candidateResponse ?? '').trim();
  const validChoice = possibleResponses[validIndex];
  const validText = (validChoice?.possibleResponse ?? '').trim();

  const isCorrect =
    normalizedCandidate === validText ||
    normalizedCandidate === String(validIndex);

  return {
    score: isCorrect ? question.maxScore : 0,
    comment: ''
  };
}

interface CorrectTestOptions {
  _id: string;
  testId: string;
  responses: Array<{
    questionId: string;
    response: string;
    score?: number;
    comment?: string;
  }>;
  state: string;
}

async function sendDiscordNotification(message: string): Promise<void> {
  const discordWebhook = process.env.TEST_CORRECTION_DISCORD_WEBHOOKS;

  if (discordWebhook) {
    try {
      await fetch(discordWebhook, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          content: message
        })
      });
    } catch (error) {
      console.error('Error sending Discord notification:', error);
    }
  }
}

async function correctTest(options: CorrectTestOptions): Promise<void> {
  if (!options.testId) throw new Error('TestId is required');
  if (!options.responses) throw new Error('Responses are required');
  if (!options.state) throw new Error('State is required');

  try {
    // Récupérer le résultat de test
    const result = await TestResult.findById(options._id);
    if (!result) {
      throw new Error('Test result not found');
    }

    let finalscore = 0;

    let maxScore = 0;

    // Pour chaque réponse enregistrée en base, on cherche la correction correspondante
    for (const dbResponse of result.responses) {
      const correction = options.responses.find(r => r.questionId.toString() === dbResponse.questionId.toString());
      if (!correction) continue;

      const question = await TestQuestion.findById(dbResponse.questionId);
      if (!question) {
        console.error('Question not found', { questionId: dbResponse.questionId });
        continue;
      }

      maxScore += question.maxScore;

      const mcqResult = correctMcqIfPossible(question, dbResponse.response ?? '');
      let validScore: number;
      let comment: string;

      if (mcqResult !== null) {
        validScore = mcqResult.score;
        comment = mcqResult.comment;
      } else {
        const scoreResponse = await generateLiveMessage(
          'correctQuestion',
          {
            question: {
              _id: question._id.toString(),
              instruction: question.instruction,
              possibleResponses: question.possibleResponses,
              questionType: question.questionType,
              maxScore: question.maxScore
            },
            result: {
              responses: [{
                questionId: dbResponse.questionId.toString(),
                response: dbResponse.response
              }]
            }
          },
          true
        );

        console.log('Correction result:', { scoreResponse });
        const parsedResult: CorrectionResult = JSON.parse(scoreResponse);

        validScore = 0;
        if (parsedResult.score !== undefined && parsedResult.score !== null) {
          const score = parseFloat(parsedResult.score.toString());
          if (!isNaN(score) && isFinite(score) && score >= 0) {
            validScore = score;
          } else {
            console.warn('Invalid score returned by AI:', parsedResult.score);
          }
        }
        comment = parsedResult.comment || '';
      }

      finalscore += validScore;
      dbResponse.score = validScore;
      dbResponse.comment = comment;
    }

    // S'assurer que finalscore est un nombre valide
    if (isNaN(finalscore) || !isFinite(finalscore)) {
      console.warn('Invalid finalscore calculated, setting to 0:', finalscore);
      finalscore = 0;
    }

    // S'assurer que maxScore est un nombre valide
    if (isNaN(maxScore) || !isFinite(maxScore)) {
      console.warn('Invalid maxScore calculated, setting to 0:', maxScore);
      maxScore = 0;
    }

    // Mettre à jour le score final et l'état
    result.score = finalscore;
    result.state = TestState.Finish;
    // Forcer la sauvegarde des sous-documents responses
    result.markModified('responses');

    // Calculer les sous-scores par catégorie
    const { scoresByCategory } = await computeScoresByCategory(result);
    result.scoresByCategory = scoresByCategory;

    // Calculer le pourcentage de score en évitant la division par zéro
    let scorePercentage = 0;
    if (maxScore > 0) {
      scorePercentage = Math.ceil((finalscore / maxScore) * 100);
    } else if (finalscore > 0) {
      // Si maxScore est 0 mais qu'il y a un score, on met 100%
      scorePercentage = 100;
    }

    // S'assurer que le score est un nombre valide
    if (isNaN(scorePercentage) || !isFinite(scorePercentage)) {
      scorePercentage = 0;
    }

    // Sauvegarder les modifications avec findByIdAndUpdate pour éviter les conflits de version
    await TestResult.findByIdAndUpdate(result._id, {
      $set: {
        responses: result.responses,
        score: finalscore,
        scoresByCategory: result.scoresByCategory,
        state: result.state
      }
    });

    const test = await TestModel.findById(result.testId);

    const candidate = await CandidateModel.findById(result.candidateId);

    if (candidate) {
      const contact = await ContactModel.findById(candidate.contact);
      if (contact) {
        const testLink = (process.env.TEST_INVITATION_LINK || '') + contact.email;
        enduranceEmitter.emit(enduranceEventTypes.SEND_EMAIL, {
          template: 'test-result',
          to: contact.email,
          data: {
            firstname: contact.firstname,
            lastname: contact.lastname,
            score: scorePercentage,
            testName: test?.title || '',
            testLink
          }
        });

        // Envoyer une notification Discord
        const discordMessage = '📊 **Nouveau résultat de test**\n' +
          `**Candidat:** ${contact.firstname} ${contact.lastname}\n` +
          `**Test:** ${test?.title || 'Test inconnu'}\n` +
          `**Score:** ${scorePercentage}%\n` +
          `**Score brut:** ${finalscore}/${maxScore}`;

        await sendDiscordNotification(discordMessage);
      }
    }
  } catch (err) {
    if (err instanceof Error) {
      console.error(`Error correcting test: ${err.message}`, { err });
    } else {
      console.error('Unknown error occurred during test correction', { err });
    }
    throw err; // Propager l'erreur pour la gestion en amont
  }
}

enduranceListener.createListener(enduranceEventTypes.CORRECT_TEST, (args: unknown) => {
  if (typeof args === 'object' && args !== null) {
    const options = args as CorrectTestOptions;
    correctTest(options);
  } else {
    console.error('Invalid data type received in correct listener', { args });
  }
});

export default enduranceListener;
