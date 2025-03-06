import { z } from 'zod'
import { zodToJsonSchema } from 'zod-to-json-schema'

import { languagePrompt } from './prompt'
import { streamTextFromServer } from '~/composables/useAiProxy'
import { useMem0Client } from './mem0'

type PartialFeedback = DeepPartial<z.infer<typeof feedbackTypeSchema>>

export const feedbackTypeSchema = z.object({
  questions: z.array(z.string()),
})

export async function* generateFeedback({
  query,
  language,
  numQuestions = 3,
}: {
  query: string
  language: string
  numQuestions?: number
}) {
  // Fetch memories from Mem0
  let memories: string[] = []
  try {
    const mem0Client = useMem0Client();
    let memoryResults = await mem0Client?.getCurrentMemories()  
    memories = (memoryResults ?? []).filter(m => m.memory !== undefined).map(m => m.memory as string)
  } catch (error) {
    console.error('Error fetching memories:', error)
  }

  const schema = z.object({
    questions: z
      .array(z.string())
      .describe(`Follow up questions to clarify the research direction`),
  })
  const jsonSchema = JSON.stringify(zodToJsonSchema(schema))
  const prompt = [
    `Given the following query from the user, ask ${numQuestions} follow up questions to clarify the research direction.`,
    memories
      ? `Here are some user preferences, and what we already know about the user, don't need to query these: ${memories.join(
          '\n',
        )}`
      : '', 

    `Return a maximum of ${numQuestions} questions, but feel free to return less if the original query is clear: <query>${query}</query>`,
    `You MUST respond in JSON matching this JSON schema: ${jsonSchema}`,
    languagePrompt(language),
  ].join('\n\n')

  const stream = await streamTextFromServer({
    prompt: prompt,
    modelName: useConfigStore().config.ai.model
  });

  const parser = parseStreamingJson(
    stream,
    feedbackTypeSchema,
    (value: PartialFeedback) => !!value.questions && value.questions.length > 0,
  );

  for await (const chunk of parser) {
    yield chunk;
  }
}
