import {
  EducatorAiWorkoutAnswers,
  EducatorAiWorkoutField,
  EducatorAiWorkoutConversationState,
} from './educatorAiWorkoutConversation.types';

// No 'restrictions' and no 'sex' — the student's restrictions are read
// automatically (ADR-003); the rule engine has no sex input at all.
export const EDUCATOR_AI_WORKOUT_FIELD_ORDER: EducatorAiWorkoutField[] = [
  'goal',
  'daysPerWeek',
  'equipment',
  'experienceLevel',
  'muscleFocus',
];

export const EDUCATOR_AI_WORKOUT_CONVERSATION_SYSTEM_PROMPT =
  'Você conduz uma entrevista curta em português com um educador físico para montar ' +
  'um treino para um aluno dele. Pergunte um campo por vez, na ordem goal, daysPerWeek, ' +
  'equipment, experienceLevel, muscleFocus. ' +
  'Se "pendingRawAnswer" estiver presente, tente interpretá-lo como resposta ao campo ' +
  '"pendingField" e preencha "answers" com o valor entendido; se não conseguir interpretar ' +
  'com confiança, marque "reprompt": true e repita a mesma pergunta. ' +
  'Nunca pergunte sobre restrições do aluno — elas já são conhecidas pelo sistema. ' +
  'Para "muscleFocus", se o educador disser que não há preferência, use o valor "NONE" ' +
  '(nunca null, que significa "ainda não perguntado"). ' +
  'Quando todos os campos estiverem preenchidos, defina "done": true, "field": null e ' +
  '"question": "".';

export function buildEducatorAiWorkoutConversationPrompt(
  state: EducatorAiWorkoutConversationState,
): string {
  return JSON.stringify({
    fieldOrder: EDUCATOR_AI_WORKOUT_FIELD_ORDER,
    answers: state.answers,
    pendingField: state.pendingField ?? null,
    pendingRawAnswer: state.pendingRawAnswer ?? null,
  });
}

export const EDUCATOR_AI_WORKOUT_EXPLANATION_SYSTEM_PROMPT =
  'Você escreve, em português, uma explicação curta para um educador físico sobre um ' +
  'treino já decidido por um mecanismo de regras — você nunca escolhe ou troca exercícios, ' +
  'apenas descreve o plano recebido e por que ele faz sentido para o objetivo informado. ' +
  'Esta explicação é vista apenas pelo educador, nunca pelo aluno.';

export function buildEducatorAiWorkoutExplanationPrompt(
  daysPerWeek: number,
  exercisesPerDay: number[],
  scaled: boolean,
  answers: EducatorAiWorkoutAnswers,
): string {
  return JSON.stringify({
    goal: answers.goal,
    equipment: answers.equipment,
    experienceLevel: answers.experienceLevel,
    muscleFocus: answers.muscleFocus,
    daysPerWeek,
    scaled,
    exercisesPerDay,
  });
}
