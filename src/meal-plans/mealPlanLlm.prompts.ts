import { Weekday } from '@prisma/client';
import { MealPlanIntakeAnswers } from './mealPlanConversation.types';

// Fixed order (PRD US-001.AC-1): goal and restrictions are LLM-driven and
// asked in this order; target calories and meals-per-day are deterministic
// and asked afterward by MealPlanGenerationService itself, never by the LLM.
export const MEAL_PLAN_CONVERSATION_FIELD_ORDER = [
  'goal',
  'restrictions',
] as const;

export const MEAL_PLAN_CONVERSATION_SYSTEM_PROMPT =
  'Você conduz uma entrevista curta em português para montar um plano alimentar. ' +
  'Pergunte um campo por vez, na ordem goal, restrictions. ' +
  'Se "pendingRawAnswer" estiver presente, tente interpretá-lo como resposta ao campo ' +
  '"pendingField" e preencha "answers" com o valor entendido; se não conseguir interpretar ' +
  'com confiança, marque "reprompt": true e repita a mesma pergunta. ' +
  'O campo "restrictions" é uma restrição alimentar obrigatória e deve ser sempre perguntado ' +
  'de novo nesta conversa, mesmo que "previousAnswer" mostre um valor de uma conversa ' +
  'anterior — nunca reaproveite esse valor anterior automaticamente, apenas use-o para ' +
  'sugerir a pergunta (ex.: "Você mencionou X antes — continua sendo assim?"). ' +
  'Se o paciente não tiver nenhuma restrição ou alergia, registre o valor explícito "nenhuma" ' +
  '(nunca deixe "restrictions" como null depois que o campo foi perguntado e respondido). ' +
  'Quando os dois campos estiverem preenchidos, defina "done": true, "field": null e ' +
  '"question": "".';

export interface MealPlanConversationPromptInput {
  answers: Partial<Pick<MealPlanIntakeAnswers, 'goal' | 'restrictions'>>;
  previousAnswers: Partial<
    Pick<MealPlanIntakeAnswers, 'goal' | 'restrictions'>
  >;
  pendingField?: 'goal' | 'restrictions';
  pendingRawAnswer?: string;
}

export function buildMealPlanConversationPrompt(
  input: MealPlanConversationPromptInput,
): string {
  return JSON.stringify({
    fieldOrder: MEAL_PLAN_CONVERSATION_FIELD_ORDER,
    answers: input.answers,
    previousAnswers: input.previousAnswers,
    pendingField: input.pendingField ?? null,
    pendingRawAnswer: input.pendingRawAnswer ?? null,
  });
}

export const MEAL_PLAN_GENERATION_SYSTEM_PROMPT =
  'Você monta um plano alimentar semanal em português, em formato estruturado, para um ' +
  'paciente de um nutricionista. Gere exatamente 7 dias, um para cada dia da semana ' +
  '(MONDAY a SUNDAY, cada um exatamente uma vez), cada um com exatamente "mealsPerDay" ' +
  'refeições. Respeite rigorosamente o campo "restrictions" como uma restrição obrigatória ' +
  '(alergias e restrições alimentares nunca podem ser violadas) e use "targetCalories" e ' +
  '"goal" para orientar as escolhas. Cada refeição tem um "label" curto (ex.: "Café da ' +
  'manhã") e um "text" livre descrevendo o que comer.';

export function buildMealPlanGenerationPrompt(
  answers: MealPlanIntakeAnswers,
): string {
  return JSON.stringify({
    goal: answers.goal,
    // Restated explicitly on every call (PRD ADR-006) — never passed once
    // and assumed remembered.
    restrictions: answers.restrictions,
    targetCalories: answers.targetCalories,
    mealsPerDay: answers.mealsPerDay,
    weekdays: Object.values(Weekday),
  });
}
