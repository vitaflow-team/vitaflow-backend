import { TemplateFieldInput } from '@/repositories/clinical-records/assessmentTemplates.repository';
import { FormFieldType } from '@prisma/client';

const text = (label: string, required = false): TemplateFieldInput => ({
  label,
  fieldType: FormFieldType.LONG_TEXT,
  required,
});

const number = (
  label: string,
  opts: { weightRole?: boolean; heightRole?: boolean; required?: boolean } = {},
): TemplateFieldInput => ({
  label,
  fieldType: FormFieldType.NUMBER,
  required: opts.required ?? false,
  weightRole: opts.weightRole ?? false,
  heightRole: opts.heightRole ?? false,
});

// Market-research-derived defaults (PRD): identification, clinical history,
// dietary history, objectives.
export const NUTRITIONIST_ANAMNESE_FIELDS: TemplateFieldInput[] = [
  text('Nome completo', true),
  text('Histórico clínico (doenças, cirurgias, medicamentos em uso)'),
  text('Histórico alimentar (hábitos, restrições, alergias)'),
  text('Objetivo principal', true),
];

// Weight/height (BMI-tagged) plus the circumferences market research called
// out for a nutritional assessment.
export const NUTRITIONIST_ASSESSMENT_FIELDS: TemplateFieldInput[] = [
  number('Peso (kg)', { weightRole: true, required: true }),
  number('Altura (cm)', { heightRole: true, required: true }),
  number('Circunferência da cintura (cm)'),
  number('Circunferência do quadril (cm)'),
  number('Circunferência do braço (cm)'),
];

// A minimal anamnese for a physical educator / academia context — PRD ADR-004
// does not fix this list beyond "identification and objectives", unlike the
// nutritionist's (market-research-derived) and the measurement template's
// (PhysicalAssessment-mirroring) fields, which are both explicitly specified.
export const EDUCATOR_ANAMNESE_FIELDS: TemplateFieldInput[] = [
  text('Nome completo', true),
  text('Histórico de lesões ou restrições médicas'),
  text('Nível de atividade física atual'),
  text('Objetivo principal', true),
];

// Mirrors PhysicalAssessment's original fields exactly (PRD ADR-003/ADR-004),
// weight/height roles pre-tagged for the BMI convenience.
export const EDUCATOR_ASSESSMENT_FIELDS: TemplateFieldInput[] = [
  number('Peso (kg)', { weightRole: true, required: true }),
  number('Altura (cm)', { heightRole: true, required: true }),
  number('Percentual de gordura corporal (%)'),
  number('Frequência cardíaca de repouso (bpm)'),
  number('Flexibilidade (cm)'),
  number('Braço (cm)'),
  number('Peito (cm)'),
  number('Cintura (cm)'),
  number('Abdômen (cm)'),
  number('Quadril (cm)'),
  number('Coxa (cm)'),
  number('Panturrilha (cm)'),
];

export const STARTER_ANAMNESE_NAME = 'Anamnese padrão';
export const STARTER_ASSESSMENT_NAME = 'Avaliação padrão';
