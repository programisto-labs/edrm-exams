/**
 * Tests de la lib openai (API Responses, gpt-5-mini, text.format JSON).
 * Pour exécuter les tests d'intégration (appel réel OpenAI + affichage du retour) :
 *   npm run test:openai
 * (charge le .env et attend les réponses API)
 */
import { fileURLToPath } from 'url';
import path from 'path';
import { createRequire } from 'module';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);

const realApiKey = process.env.OPENAI_API_KEY;
const hasRealApiKey = realApiKey && realApiKey.length > 0 && realApiKey !== 'test';

describe('openai lib', () => {
  let generateLiveMessage;

  before(async function () {
    process.env.OPENAI_API_KEY = process.env.OPENAI_API_KEY || 'test';
    const libPath = path.join(__dirname, '..', 'dist', 'modules', 'edrm-exams', 'lib', 'openai.js');
    try {
      const mod = await import(libPath);
      generateLiveMessage = mod.generateLiveMessage;
    } catch (e) {
      if (e.code === 'ERR_MODULE_NOT_FOUND' || e.message?.includes('Cannot find module')) {
        generateLiveMessage = null;
        return;
      }
      throw e;
    } finally {
      if (realApiKey !== undefined) process.env.OPENAI_API_KEY = realApiKey;
    }
  });

  describe('generateLiveMessage (Responses API, gpt-5-mini)', () => {
    const correctQuestionParams = {
      question: {
        _id: 'q1',
        instruction: 'Quelle est la capitale de la France ?',
        maxScore: 2,
        possibleResponses: [
          { possibleResponse: 'Paris', valid: true },
          { possibleResponse: 'Londres', valid: false }
        ],
        questionType: 'MCQ'
      },
      result: {
        responses: [{ questionId: 'q1', response: 'Paris' }]
      }
    };

    it('exporte une fonction generateLiveMessage', function () {
      if (!generateLiveMessage) this.skip();
      require('assert').strictEqual(typeof generateLiveMessage, 'function');
    });

    it('correctQuestion : retourne un JSON score/comment (si OPENAI_API_KEY réelle)', async function () {
      this.timeout(30000);
      if (!generateLiveMessage || !hasRealApiKey) this.skip();
      const result = await generateLiveMessage('correctQuestion', correctQuestionParams, true);
      require('assert').strictEqual(typeof result, 'string');
      require('assert').ok(result.length > 0, 'réponse non vide');
      const parsed = JSON.parse(result);
      require('assert').ok(
        'score' in parsed || 'comment' in parsed || 'commentaire' in parsed,
        'JSON attendu avec au moins score ou comment/commentaire'
      );
      console.log('\n[OpenAI correctQuestion] Retour:', JSON.stringify(parsed, null, 2));
    });
  });

  describe('createQuestion (génération de questions)', () => {
    const createQuestionParams = {
      job: 'Développeur fullstack',
      seniority: 'intermediate',
      questionType: 'MCQ',
      category: 'JavaScript',
      expertiseLevel: 'intermediate',
      otherQuestions: 'Aucune question pour l\'instant.'
    };

    it('createQuestion : retourne un JSON de question valide (si OPENAI_API_KEY réelle)', async function () {
      this.timeout(60000);
      if (!generateLiveMessage || !hasRealApiKey) this.skip();
      const result = await generateLiveMessage('createQuestion', createQuestionParams, true);
      require('assert').strictEqual(typeof result, 'string');
      require('assert').ok(result.length > 0, 'réponse non vide');
      const parsed = JSON.parse(result);
      require('assert').ok(parsed.instruction, 'instruction attendue');
      require('assert').ok(['MCQ', 'free question', 'exercice'].includes(parsed.questionType), 'questionType attendu');
      require('assert').ok(typeof parsed.maxScore === 'number', 'maxScore attendu');
      require('assert').ok(typeof parsed.time === 'number', 'time attendu');
      console.log('\n[OpenAI createQuestion] Retour:', JSON.stringify(parsed, null, 2));
    });
  });
});
