import OpenAI from 'openai';
import { fileURLToPath } from 'url';
import fs from 'fs';
import path from 'path';
import { ChatCompletionMessageParam, ChatCompletionCreateParamsNonStreaming } from 'openai/resources/chat/completions';

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

interface OpenAIParams extends Omit<ChatCompletionCreateParamsNonStreaming, 'response_format'> {
  response_format?: {
    type: 'json_object';
  };
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
      const openAIParams: OpenAIParams = {
        model: 'gpt-4-1106-preview',
        temperature: 0.7,
        messages: [{ role: 'system', content: message }] as ChatCompletionMessageParam[]
      };

      if (json) {
        openAIParams.response_format = { type: 'json_object' };
      }

      const result = await openai.chat.completions.create(openAIParams);
      const content = result.choices[0].message.content;
      if (!content) {
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

export async function generateLiveMessageAssistant(
  assistantId: string,
  messageType: keyof ContextBuilder,
  params: CreateQuestionParams | CorrectQuestionParams,
  json?: boolean
): Promise<string> {
  const MAX_RETRY = 2;
  let retryCount = 0;

  // Construire le contexte pour le message
  const context = await contextBuilder[messageType](params as any);
  const text = fs.readFileSync(
    path.join(__dirname, 'openai', `${messageType}.txt`),
    'utf8'
  );

  const message = text.replace(/\${(.*?)}/g, (_, v) => context[v]);

  while (retryCount <= MAX_RETRY) {
    try {
      // Créer un thread avec l'assistant
      const thread = await openai.beta.threads.create();

      // Ajouter le message avec le contexte
      await openai.beta.threads.messages.create(thread.id, {
        role: 'user',
        content: message
      });

      // Exécuter l'assistant
      const run = await openai.beta.threads.runs.create(thread.id, {
        assistant_id: assistantId
      });

      // Attendre que l'exécution soit terminée
      let runStatus = await openai.beta.threads.runs.retrieve(thread.id, run.id);
      while (runStatus.status === 'in_progress' || runStatus.status === 'queued') {
        await new Promise(resolve => setTimeout(resolve, 1000));
        runStatus = await openai.beta.threads.runs.retrieve(thread.id, run.id);
      }

      if (runStatus.status === 'failed') {
        throw new Error('Assistant execution failed');
      }

      // Récupérer les messages de réponse
      const messages = await openai.beta.threads.messages.list(thread.id);
      const lastMessage = messages.data[0]; // Le premier message est le plus récent

      if (!lastMessage || !lastMessage.content || lastMessage.content.length === 0) {
        throw new Error('No content in response');
      }

      const content = lastMessage.content[0];
      if (content.type === 'text') {
        return removeQuotes(content.text.value);
      } else {
        throw new Error('Unexpected content type');
      }
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
