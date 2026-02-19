import OpenAI from 'openai';
import { fileURLToPath } from 'url';
import fs from 'fs';
import path from 'path';

const DEFAULT_MODEL = 'gpt-5-mini';

interface CreateQuestionParams {
  job: string;
  seniority: string;
  questionType: string;
  category: string;
  expertiseLevel: string;
  otherQuestions: string;
}

interface CorrectQuestionParams {
  question: {
    _id: string;
    instruction: string;
    maxScore: number;
    possibleResponses: Array<{
      possibleResponse: string;
      valid: boolean;
    }>;
    questionType: string;
  };
  result: {
    responses: Array<{
      questionId: string;
      response: string;
    }>;
  };
}

interface ContextBuilder {
  createQuestion: (params: CreateQuestionParams) => Promise<Record<string, string>>;
  correctQuestion: (params: CorrectQuestionParams) => Promise<{
    instruction: string;
    response: string;
    maxScore: number;
  }>;
}

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY
});

const contextBuilder: ContextBuilder = {
  async createQuestion({ job, seniority, questionType, category, expertiseLevel, otherQuestions }: CreateQuestionParams) {
    const context = {
      job,
      seniority,
      questionType,
      category,
      expertiseLevel,
      otherQuestions
    };
    return context;
  },

  async correctQuestion({ question, result }: CorrectQuestionParams) {
    let response = '';
    for (let i = 0; i < result.responses.length; i++) {
      if (result.responses[i].questionId === question._id) {
        response = result.responses[i].response;
        break;
      }
    }
    const instruction = question.instruction;
    const maxScore = question.maxScore;
    const questionType = question.questionType;
    const possibleResponses = question.possibleResponses.map((response, index) => `réponse ${index + 1} = "${response.possibleResponse}" (${response.valid ? 'correcte' : 'incorrecte'})`).join('\n');
    const context = {
      instruction,
      response,
      maxScore,
      questionType,
      possibleResponses
    };
    return context;
  }
};

/**
 * Génère une réponse via l'API Responses (gpt-5-mini).
 * Pour forcer le JSON : text.format = { type: 'json_object' }.
 */
export async function generateLiveMessage(
  messageType: keyof ContextBuilder,
  params: CreateQuestionParams | CorrectQuestionParams,
  json?: boolean
): Promise<string> {
  const MAX_RETRY = 2;
  let retryCount = 0;
  const context = await contextBuilder[messageType](params as any);
  const text = fs.readFileSync(
    path.join(__dirname, 'openai', `${messageType}.txt`),
    'utf8'
  );

  const message = text.replace(/\${(.*?)}/g, (_, v) => context[v]);

  while (retryCount <= MAX_RETRY) {
    try {
      const createParams: {
        model: string;
        instructions: string;
        input: string;
        text?: { format: { type: 'json_object' } };
      } = {
        model: DEFAULT_MODEL,
        instructions: message,
        input: json ? 'Réponds en JSON uniquement. Traite la demande.' : 'Traite la demande.'
      };

      if (json) {
        createParams.text = { format: { type: 'json_object' } };
      }

      const result = await openai.responses.create(createParams);
      const content = result.output_text;
      if (!content || typeof content !== 'string') {
        throw new Error('No content in response');
      }
      return removeQuotes(content);
    } catch (error) {
      retryCount++;
      console.log(error);
      if (retryCount > MAX_RETRY) {
        return 'Brain freezed, I cannot generate a live message right now.';
      }
    }
  }
  return 'Brain freezed, I cannot generate a live message right now.';
}

function removeQuotes(str: string): string {
  if (str.startsWith('"') && str.endsWith('"')) {
    return str.substring(1, str.length - 1);
  }
  return str;
}
