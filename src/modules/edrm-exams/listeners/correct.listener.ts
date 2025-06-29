import { enduranceListener, enduranceEventTypes } from '@programisto/endurance-core';
import TestQuestion from '../models/test-question.model.js';
import { generateLiveMessage } from '../lib/openai.js';
import TestResult, { TestState } from '../models/test-result.model.js';

interface CorrectionResult {
  score: number;
  commentaire: string;
  comment?: string;
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

async function correctTest(options: CorrectTestOptions): Promise<void> {
  console.log('Correcting test', { options });
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

    // Pour chaque réponse enregistrée en base, on cherche la correction correspondante
    for (const dbResponse of result.responses) {
      const correction = options.responses.find(r => r.questionId.toString() === dbResponse.questionId.toString());
      if (!correction) continue;

      const question = await TestQuestion.findById(dbResponse.questionId);
      if (!question) {
        console.error('Question not found', { questionId: dbResponse.questionId });
        continue;
      }

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
      finalscore += parsedResult.score;
      dbResponse.score = parsedResult.score;
      dbResponse.comment = parsedResult.comment || '';
    }

    // Mettre à jour le score final et l'état
    result.score = finalscore;
    result.state = TestState.Finish;

    // Forcer la sauvegarde des sous-documents responses
    result.markModified('responses');

    // Sauvegarder les modifications avec findByIdAndUpdate pour éviter les conflits de version
    await TestResult.findByIdAndUpdate(result._id, {
      $set: {
        responses: result.responses,
        score: result.score,
        state: result.state
      }
    });

    console.log('Test correction completed and saved', { finalScore: finalscore });
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
