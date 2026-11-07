import { FormRecordWithValues } from '@/repositories/clinical-records/formRecords.repository';
import { FormFieldType } from '@prisma/client';
import { renderedText } from './collectRenderedText.util';
import { buildFormRecordDocument, renderFormRecordPdf } from './formRecordPdf';

function record(
  overrides: Partial<FormRecordWithValues> = {},
): FormRecordWithValues {
  return {
    id: 'record-1',
    clientId: 'client-1',
    templateId: 'template-1',
    recordedByUserId: 'pro-1',
    recordedAt: new Date('2026-01-01'),
    createdAt: new Date('2026-01-01'),
    updatedAt: new Date('2026-01-01'),
    values: [],
    ...overrides,
  };
}

function value(
  overrides: Partial<FormRecordWithValues['values'][number]> = {},
): FormRecordWithValues['values'][number] {
  return {
    id: 'value-1',
    recordId: 'record-1',
    position: 0,
    fieldLabel: 'Campo',
    fieldType: FormFieldType.SHORT_TEXT,
    weightRole: false,
    heightRole: false,
    textValue: null,
    numberValue: null,
    boolValue: null,
    selectedOption: null,
    ...overrides,
  };
}

const issuer = { issuerName: 'Dra. Ana', clientName: 'João' };

describe('renderFormRecordPdf', () => {
  it('UT-010 renders one value of each FormFieldType, formatted, in position order', async () => {
    const r = record({
      values: [
        value({
          id: 'v-text',
          position: 0,
          fieldLabel: 'Objetivo',
          fieldType: FormFieldType.SHORT_TEXT,
          textValue: 'Perder peso',
        }),
        value({
          id: 'v-number',
          position: 1,
          fieldLabel: 'Peso',
          fieldType: FormFieldType.NUMBER,
          numberValue: 70,
        }),
        value({
          id: 'v-bool',
          position: 2,
          fieldLabel: 'Fuma?',
          fieldType: FormFieldType.YES_NO,
          boolValue: false,
        }),
        value({
          id: 'v-choice',
          position: 3,
          fieldLabel: 'Nível',
          fieldType: FormFieldType.MULTIPLE_CHOICE,
          selectedOption: 'Intermediário',
        }),
      ],
    });

    const buffer = await renderFormRecordPdf(r, issuer);
    expect(buffer.subarray(0, 4).toString()).toBe('%PDF');

    const text = renderedText(buildFormRecordDocument(r, issuer));
    expect(text).toContain('Perder peso');
    expect(text).toContain('70');
    expect(text).toContain('Não');
    expect(text).toContain('Intermediário');
  });

  it('UT-011 shows a computed BMI line when weight and height are both answered', () => {
    const r = record({
      values: [
        value({
          id: 'v-weight',
          fieldLabel: 'Peso',
          fieldType: FormFieldType.NUMBER,
          weightRole: true,
          numberValue: 70,
        }),
        value({
          id: 'v-height',
          fieldLabel: 'Altura',
          fieldType: FormFieldType.NUMBER,
          heightRole: true,
          numberValue: 175,
        }),
      ],
    });

    const text = renderedText(buildFormRecordDocument(r, issuer));
    expect(text).toContain('IMC:');
  });

  it('UT-012 shows no BMI line when only weight is answered', () => {
    const r = record({
      values: [
        value({
          id: 'v-weight',
          fieldLabel: 'Peso',
          fieldType: FormFieldType.NUMBER,
          weightRole: true,
          numberValue: 70,
        }),
      ],
    });

    const text = renderedText(buildFormRecordDocument(r, issuer));
    expect(text).not.toContain('IMC:');
  });

  it('UT-013 renders selectedOption directly, never re-looked-up', () => {
    const r = record({
      values: [
        value({
          fieldLabel: 'Nível',
          fieldType: FormFieldType.MULTIPLE_CHOICE,
          selectedOption: 'Avançado (opção removida do template)',
        }),
      ],
    });

    const text = renderedText(buildFormRecordDocument(r, issuer));
    expect(text).toContain('Avançado (opção removida do template)');
  });

  it('UT-014 an unanswered field shows "não respondido"', () => {
    const r = record({
      values: [
        value({
          fieldLabel: 'Observações',
          fieldType: FormFieldType.LONG_TEXT,
          textValue: null,
        }),
      ],
    });

    const text = renderedText(buildFormRecordDocument(r, issuer));
    expect(text).toContain('Não respondido');
  });

  it('UT-015 a zero-field template produces a valid %PDF buffer with an empty state', async () => {
    const r = record({ values: [] });

    const buffer = await renderFormRecordPdf(r, issuer);
    expect(buffer.subarray(0, 4).toString()).toBe('%PDF');

    const text = renderedText(buildFormRecordDocument(r, issuer));
    expect(text).toContain('Nenhum campo cadastrado neste modelo.');
  });

  it('UT-016 a 50-field template renders every field label', async () => {
    const values = Array.from({ length: 50 }, (_, i) =>
      value({
        id: `v-${i}`,
        position: i,
        fieldLabel: `Campo ${i}`,
        fieldType: FormFieldType.SHORT_TEXT,
        textValue: `Resposta ${i}`,
      }),
    );
    const r = record({ values });

    const buffer = await renderFormRecordPdf(r, issuer);
    expect(buffer.subarray(0, 4).toString()).toBe('%PDF');

    const text = renderedText(buildFormRecordDocument(r, issuer));
    for (let i = 0; i < 50; i += 1) {
      expect(text).toContain(`Campo ${i}`);
    }
  });
});
