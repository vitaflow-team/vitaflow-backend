import { FitnessProfile } from '@prisma/client';
import { GeneratedPlan } from './ruleEngine.types';
import { ConversationField, ConversationState } from './llmExplanation.types';

// Fixed order the conversation walks through; `goal` is never skipped even
// when `FitnessProfile.goal` is already known (ADR-003 always re-confirms
// it, since a user's training goal can change between generations).
export const CONVERSATION_FIELD_ORDER: ConversationField[] = [
  'sex',
  'goal',
  'daysPerWeek',
  'equipment',
  'restrictions',
];

export const CONVERSATION_SYSTEM_PROMPT =
  'Você conduz uma entrevista curta em português para montar um plano de treino. ' +
  'Pergunte um campo por vez, na ordem sex, goal, daysPerWeek, equipment, restrictions. ' +
  'Se "pendingRawAnswer" estiver presente, tente interpretá-lo como resposta ao campo ' +
  '"pendingField" e preencha "answers" com o valor entendido; se não conseguir interpretar ' +
  'com confiança, marque "reprompt": true e repita a mesma pergunta. ' +
  'Nunca pule o campo "goal", mesmo que já tenha um valor prévio. ' +
  'Quando todos os campos estiverem preenchidos, defina "done": true, "field": null e ' +
  '"question": "".';

export function buildConversationPrompt(state: ConversationState): string {
  return JSON.stringify({
    fieldOrder: CONVERSATION_FIELD_ORDER,
    answers: state.answers,
    pendingField: state.pendingField ?? null,
    pendingRawAnswer: state.pendingRawAnswer ?? null,
  });
}

export const EXPLANATION_SYSTEM_PROMPT =
  'Você escreve, em português, uma explicação curta e motivadora de um plano de treino ' +
  'já decidido por um mecanismo de regras — você nunca escolhe ou troca exercícios, apenas ' +
  'descreve o plano recebido e por que ele faz sentido para o objetivo do usuário.';

export function buildExplanationPrompt(
  plan: GeneratedPlan,
  profile: FitnessProfile,
): string {
  return JSON.stringify({
    goal: profile.goal,
    equipment: profile.equipment,
    restrictions: profile.restrictions,
    daysPerWeek: plan.days.length,
    scaled: plan.scaled,
    exercisesPerDay: plan.days.map((day) => day.exercises.length),
  });
}
