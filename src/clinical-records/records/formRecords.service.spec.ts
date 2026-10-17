import { AssessmentTemplatesRepository } from '@/repositories/clinical-records/assessmentTemplates.repository';
import { FormRecordsRepository } from '@/repositories/clinical-records/formRecords.repository';
import { ClientsRepository } from '@/repositories/clients/clients.repository';
import { EmploymentRepository } from '@/repositories/academia/employment.repository';
import { ConsentService } from '@/common/consent/consent.service';
import { Client, FormFieldType, TemplatePurpose } from '@prisma/client';
import { FormRecordsService } from './formRecords.service';

function client(overrides: Partial<Client> = {}): Client {
  return {
    id: 'client-1',
    name: 'Paciente',
    email: 'p@x.com',
    phone: '',
    userId: null,
    birthDate: null,
    professionalId: 'pro-1',
    academiaId: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  };
}

function templateWithFields(
  fields: Array<
    Partial<{
      id: string;
      position: number;
      label: string;
      fieldType: FormFieldType;
      options: string[];
      required: boolean;
      weightRole: boolean;
      heightRole: boolean;
    }>
  >,
) {
  return {
    id: 'template-1',
    professionalId: 'pro-1',
    academiaId: null,
    name: 'Anamnese',
    purpose: TemplatePurpose.ANAMNESE,
    active: true,
    createdAt: new Date(),
    updatedAt: new Date(),
    fields: fields.map((f, i) => ({
      id: f.id ?? `f${i}`,
      templateId: 'template-1',
      position: f.position ?? i,
      label: f.label ?? `Campo ${i}`,
      fieldType: f.fieldType ?? FormFieldType.SHORT_TEXT,
      options: f.options ?? [],
      required: f.required ?? false,
      weightRole: f.weightRole ?? false,
      heightRole: f.heightRole ?? false,
    })),
  };
}

function recordRow(values: Array<Record<string, unknown>>) {
  return {
    id: 'record-1',
    clientId: 'client-1',
    templateId: 'template-1',
    recordedByUserId: 'pro-1',
    recordedAt: new Date('2026-09-15T00:00:00.000Z'),
    createdAt: new Date('2026-09-15T00:00:00.000Z'),
    updatedAt: new Date('2026-09-15T00:00:00.000Z'),
    values: values.map((v, i) => ({
      id: `v${i}`,
      recordId: 'record-1',
      position: i,
      fieldLabel: v.fieldLabel ?? `Campo ${i}`,
      fieldType: v.fieldType ?? FormFieldType.SHORT_TEXT,
      weightRole: v.weightRole ?? false,
      heightRole: v.heightRole ?? false,
      textValue: v.textValue ?? null,
      numberValue: v.numberValue ?? null,
      boolValue: v.boolValue ?? null,
      selectedOption: v.selectedOption ?? null,
    })),
  };
}

describe('FormRecordsService', () => {
  const records = {
    create: jest.fn(),
    findOwned: jest.fn(),
    updateValues: jest.fn(),
    findHistory: jest.fn(),
    findLatestByClient: jest.fn(),
  };
  const templates = { findById: jest.fn(), listByOwner: jest.fn() };
  const clients = { getClientById: jest.fn() };
  const employments = { findActive: jest.fn() };
  const consent = { hasConsented: jest.fn(), giveConsent: jest.fn() };
  let service: FormRecordsService;

  beforeEach(() => {
    jest.clearAllMocks();
    clients.getClientById.mockResolvedValue(client());
    consent.hasConsented.mockResolvedValue(true);
    service = new FormRecordsService(
      records as unknown as FormRecordsRepository,
      templates as unknown as AssessmentTemplatesRepository,
      clients as unknown as ClientsRepository,
      employments as unknown as EmploymentRepository,
      consent as unknown as ConsentService,
    );
  });

  it('UT-023 create() persists one FormRecordValue per answered field, snapshotting the template shape', async () => {
    templates.findById.mockResolvedValue(
      templateWithFields([
        { label: 'Objetivo', fieldType: FormFieldType.SHORT_TEXT },
      ]),
    );
    records.create.mockResolvedValue(
      recordRow([{ fieldLabel: 'Objetivo', textValue: 'x' }]),
    );

    await service.create('pro-1', undefined, 'client-1', {
      templateId: 'template-1',
      values: [{ templateFieldId: 'f0', value: 'x' }],
    });

    expect(records.create).toHaveBeenCalledWith(
      'client-1',
      'template-1',
      'pro-1',
      expect.any(Date),
      [
        expect.objectContaining({
          fieldLabel: 'Objetivo',
          fieldType: FormFieldType.SHORT_TEXT,
          position: 0,
          textValue: 'x',
        }),
      ],
    );
  });

  it('UT-024 create() with an optional field left unanswered persists with a null value', async () => {
    templates.findById.mockResolvedValue(
      templateWithFields([
        { label: 'Opcional', fieldType: FormFieldType.SHORT_TEXT },
      ]),
    );
    records.create.mockResolvedValue(recordRow([{ fieldLabel: 'Opcional' }]));

    await service.create('pro-1', undefined, 'client-1', {
      templateId: 'template-1',
      values: [],
    });

    const savedValue = records.create.mock.calls[0][4][0];
    expect(savedValue.fieldLabel).toBe('Opcional');
    expect(savedValue.textValue).toBeUndefined();
  });

  it('UT-078 create() leaving a required field unanswered is rejected 400 required_field_missing', async () => {
    templates.findById.mockResolvedValue(
      templateWithFields([
        {
          label: 'Obrigatório',
          fieldType: FormFieldType.SHORT_TEXT,
          required: true,
        },
      ]),
    );

    await expect(
      service.create('pro-1', undefined, 'client-1', {
        templateId: 'template-1',
        values: [],
      }),
    ).rejects.toMatchObject({ code: 'required_field_missing' });
    expect(records.create).not.toHaveBeenCalled();
  });

  it('UT-026 update() on an existing FormRecord overwrites the same record in place', async () => {
    records.findOwned.mockResolvedValue(
      recordRow([{ fieldLabel: 'Objetivo' }]),
    );
    templates.findById.mockResolvedValue(
      templateWithFields([
        { label: 'Objetivo', fieldType: FormFieldType.SHORT_TEXT },
      ]),
    );
    records.updateValues.mockResolvedValue(
      recordRow([{ fieldLabel: 'Objetivo', textValue: 'novo' }]),
    );

    const result = await service.update(
      'pro-1',
      undefined,
      'client-1',
      'record-1',
      {
        values: [{ templateFieldId: 'f0', value: 'novo' }],
      },
    );

    expect(records.updateValues).toHaveBeenCalledWith(
      'record-1',
      expect.anything(),
    );
    expect(result.id).toBe('record-1');
  });

  it('UT-030 create() with a negative numberValue is rejected 400 implausible_value, nothing saved', async () => {
    templates.findById.mockResolvedValue(
      templateWithFields([
        { label: 'Peso (kg)', fieldType: FormFieldType.NUMBER },
      ]),
    );

    await expect(
      service.create('pro-1', undefined, 'client-1', {
        templateId: 'template-1',
        values: [{ templateFieldId: 'f0', value: -5 }],
      }),
    ).rejects.toMatchObject({ code: 'implausible_value' });
    expect(records.create).not.toHaveBeenCalled();
  });

  it('UT-031 an optional NUMBER field left blank succeeds; the same field required and blank is rejected', async () => {
    templates.findById.mockResolvedValue(
      templateWithFields([
        { label: 'Opcional', fieldType: FormFieldType.NUMBER },
      ]),
    );
    records.create.mockResolvedValue(recordRow([{ fieldLabel: 'Opcional' }]));

    await expect(
      service.create('pro-1', undefined, 'client-1', {
        templateId: 'template-1',
        values: [],
      }),
    ).resolves.toBeDefined();

    templates.findById.mockResolvedValue(
      templateWithFields([
        {
          label: 'Obrigatório',
          fieldType: FormFieldType.NUMBER,
          required: true,
        },
      ]),
    );
    await expect(
      service.create('pro-1', undefined, 'client-1', {
        templateId: 'template-1',
        values: [],
      }),
    ).rejects.toMatchObject({ code: 'required_field_missing' });
  });

  it('UT-032 a record with weightRole=70 and heightRole=175 derives BMI ~22.9, peso normal', async () => {
    templates.findById.mockResolvedValue(
      templateWithFields([
        {
          label: 'Peso (kg)',
          fieldType: FormFieldType.NUMBER,
          weightRole: true,
        },
        {
          label: 'Altura (cm)',
          fieldType: FormFieldType.NUMBER,
          heightRole: true,
        },
      ]),
    );
    records.create.mockResolvedValue(
      recordRow([
        { fieldLabel: 'Peso (kg)', weightRole: true, numberValue: 70 },
        { fieldLabel: 'Altura (cm)', heightRole: true, numberValue: 175 },
      ]),
    );

    const result = await service.create('pro-1', undefined, 'client-1', {
      templateId: 'template-1',
      values: [
        { templateFieldId: 'f0', value: 70 },
        { templateFieldId: 'f1', value: 175 },
      ],
    });

    expect(result.bmi).toEqual({ value: 22.9, classification: 'PESO_NORMAL' });
  });

  it('UT-033 a record missing the height-tagged value has a null derived BMI, no error', async () => {
    templates.findById.mockResolvedValue(
      templateWithFields([
        {
          label: 'Peso (kg)',
          fieldType: FormFieldType.NUMBER,
          weightRole: true,
        },
      ]),
    );
    records.create.mockResolvedValue(
      recordRow([
        { fieldLabel: 'Peso (kg)', weightRole: true, numberValue: 70 },
      ]),
    );

    const result = await service.create('pro-1', undefined, 'client-1', {
      templateId: 'template-1',
      values: [{ templateFieldId: 'f0', value: 70 }],
    });

    expect(result.bmi).toBeNull();
  });

  it('UT-021 a weightRole value of exactly zero yields a null BMI without rejecting the write', async () => {
    templates.findById.mockResolvedValue(
      templateWithFields([
        {
          label: 'Peso (kg)',
          fieldType: FormFieldType.NUMBER,
          weightRole: true,
        },
        {
          label: 'Altura (cm)',
          fieldType: FormFieldType.NUMBER,
          heightRole: true,
        },
      ]),
    );
    records.create.mockResolvedValue(
      recordRow([
        { fieldLabel: 'Peso (kg)', weightRole: true, numberValue: 0 },
        { fieldLabel: 'Altura (cm)', heightRole: true, numberValue: 175 },
      ]),
    );

    const result = await service.create('pro-1', undefined, 'client-1', {
      templateId: 'template-1',
      values: [
        { templateFieldId: 'f0', value: 0 },
        { templateFieldId: 'f1', value: 175 },
      ],
    });

    expect(result.bmi).toBeNull();
  });

  it('UT-022 two fields both marked weightRole use only the first by position for BMI', async () => {
    templates.findById.mockResolvedValue(
      templateWithFields([
        { label: 'Peso A', fieldType: FormFieldType.NUMBER, weightRole: true },
        { label: 'Peso B', fieldType: FormFieldType.NUMBER, weightRole: true },
        { label: 'Altura', fieldType: FormFieldType.NUMBER, heightRole: true },
      ]),
    );
    records.create.mockResolvedValue(
      recordRow([
        { fieldLabel: 'Peso A', weightRole: true, numberValue: 70 },
        { fieldLabel: 'Peso B', weightRole: true, numberValue: 90 },
        { fieldLabel: 'Altura', heightRole: true, numberValue: 175 },
      ]),
    );

    const result = await service.create('pro-1', undefined, 'client-1', {
      templateId: 'template-1',
      values: [
        { templateFieldId: 'f0', value: 70 },
        { templateFieldId: 'f1', value: 90 },
        { templateFieldId: 'f2', value: 175 },
      ],
    });

    expect(result.bmi).toEqual({ value: 22.9, classification: 'PESO_NORMAL' });
  });

  it('UT-034 findHistory returns chronological records with their own snapshotted fields', async () => {
    records.findHistory.mockResolvedValue([
      recordRow([{ fieldLabel: 'Peso (kg)', numberValue: 78 }]),
    ]);

    const result = await service.findHistory(
      'pro-1',
      undefined,
      'client-1',
      TemplatePurpose.ASSESSMENT,
    );

    expect(records.findHistory).toHaveBeenCalledWith(
      'client-1',
      TemplatePurpose.ASSESSMENT,
    );
    expect(result).toHaveLength(1);
  });

  it('UT-035 history with exactly one record is returned normally', async () => {
    records.findHistory.mockResolvedValue([recordRow([])]);

    const result = await service.findHistory(
      'pro-1',
      undefined,
      'client-1',
      TemplatePurpose.ASSESSMENT,
    );

    expect(result).toHaveLength(1);
  });

  it('UT-036 history with zero records returns an empty list, not an error', async () => {
    records.findHistory.mockResolvedValue([]);

    const result = await service.findHistory(
      'pro-1',
      undefined,
      'client-1',
      TemplatePurpose.ASSESSMENT,
    );

    expect(result).toEqual([]);
  });

  it('UT-076 the first FormRecord creation for an unaccepted declaration is blocked until acceptDeclaration is sent', async () => {
    consent.hasConsented.mockResolvedValue(false);
    templates.findById.mockResolvedValue(
      templateWithFields([
        { label: 'Objetivo', fieldType: FormFieldType.SHORT_TEXT },
      ]),
    );

    await expect(
      service.create('pro-1', undefined, 'client-1', {
        templateId: 'template-1',
        values: [{ templateFieldId: 'f0', value: 'x' }],
      }),
    ).rejects.toMatchObject({ code: 'declaration_required' });
    expect(records.create).not.toHaveBeenCalled();

    consent.hasConsented.mockResolvedValue(false);
    records.create.mockResolvedValue(
      recordRow([{ fieldLabel: 'Objetivo', textValue: 'x' }]),
    );
    const accepted = await service.create('pro-1', undefined, 'client-1', {
      templateId: 'template-1',
      values: [{ templateFieldId: 'f0', value: 'x' }],
      acceptDeclaration: true,
    });
    expect(consent.giveConsent).toHaveBeenCalledWith(
      'pro-1',
      'HEALTH_RECORD_FILLING',
    );
    expect(accepted.id).toBe('record-1');
  });

  it('UT-077 a second FormRecord creation proceeds without re-prompting once consent is on record', async () => {
    consent.hasConsented.mockResolvedValue(true);
    templates.findById.mockResolvedValue(
      templateWithFields([
        { label: 'Objetivo', fieldType: FormFieldType.SHORT_TEXT },
      ]),
    );
    records.create.mockResolvedValue(
      recordRow([{ fieldLabel: 'Objetivo', textValue: 'y' }]),
    );

    await service.create('pro-1', undefined, 'client-1', {
      templateId: 'template-1',
      values: [{ templateFieldId: 'f0', value: 'y' }],
    });

    expect(consent.giveConsent).not.toHaveBeenCalled();
    expect(records.create).toHaveBeenCalled();
  });

  it('create() answers 404 when the client does not exist', async () => {
    clients.getClientById.mockResolvedValue(null);

    await expect(
      service.create('pro-1', undefined, 'client-1', {
        templateId: 'template-1',
        values: [],
      }),
    ).rejects.toMatchObject({ code: 'client_not_found' });
  });

  it('create() answers 404 when the template does not exist', async () => {
    templates.findById.mockResolvedValue(null);

    await expect(
      service.create('pro-1', undefined, 'client-1', {
        templateId: 'missing',
        values: [],
      }),
    ).rejects.toMatchObject({ code: 'template_not_found' });
  });

  it('rejects a MULTIPLE_CHOICE value that is not one of the template field options', async () => {
    templates.findById.mockResolvedValue(
      templateWithFields([
        {
          label: 'Objetivo',
          fieldType: FormFieldType.MULTIPLE_CHOICE,
          options: ['A', 'B'],
        },
      ]),
    );

    await expect(
      service.create('pro-1', undefined, 'client-1', {
        templateId: 'template-1',
        values: [{ templateFieldId: 'f0', value: 'C' }],
      }),
    ).rejects.toMatchObject({ code: 'invalid_option' });
  });

  it('UT-025 create() against a non-existent or wrong template id is rejected with a clear, specific error', async () => {
    templates.findById.mockResolvedValue(null);

    await expect(
      service.create('pro-1', undefined, 'client-1', {
        templateId: 'no-such-template',
        values: [],
      }),
    ).rejects.toMatchObject({ code: 'template_not_found' });
    expect(records.create).not.toHaveBeenCalled();
  });

  it('UT-027 two concurrent update() calls on the same FormRecord both resolve, the last write wins', async () => {
    records.findOwned.mockResolvedValue(
      recordRow([{ fieldLabel: 'Objetivo' }]),
    );
    templates.findById.mockResolvedValue(
      templateWithFields([
        { label: 'Objetivo', fieldType: FormFieldType.SHORT_TEXT },
      ]),
    );
    records.updateValues
      .mockResolvedValueOnce(
        recordRow([{ fieldLabel: 'Objetivo', textValue: 'first' }]),
      )
      .mockResolvedValueOnce(
        recordRow([{ fieldLabel: 'Objetivo', textValue: 'second' }]),
      );

    const [first, second] = await Promise.all([
      service.update('pro-1', undefined, 'client-1', 'record-1', {
        values: [{ templateFieldId: 'f0', value: 'first' }],
      }),
      service.update('pro-1', undefined, 'client-1', 'record-1', {
        values: [{ templateFieldId: 'f0', value: 'second' }],
      }),
    ]);

    expect(records.updateValues).toHaveBeenCalledTimes(2);
    expect(first.values[0].value).toBe('first');
    expect(second.values[0].value).toBe('second');
  });

  it('UT-028 create() of ASSESSMENT purpose twice against the same client persists two separate records', async () => {
    templates.findById.mockResolvedValue(
      templateWithFields([
        {
          label: 'Peso (kg)',
          fieldType: FormFieldType.NUMBER,
          weightRole: true,
        },
      ]),
    );
    records.create
      .mockResolvedValueOnce({
        ...recordRow([{ fieldLabel: 'Peso (kg)', numberValue: 80 }]),
        id: 'r1',
      })
      .mockResolvedValueOnce({
        ...recordRow([{ fieldLabel: 'Peso (kg)', numberValue: 79 }]),
        id: 'r2',
      });

    const first = await service.create('pro-1', undefined, 'client-1', {
      templateId: 'template-1',
      values: [{ templateFieldId: 'f0', value: 80 }],
    });
    const second = await service.create('pro-1', undefined, 'client-1', {
      templateId: 'template-1',
      values: [{ templateFieldId: 'f0', value: 79 }],
    });

    expect(records.create).toHaveBeenCalledTimes(2);
    expect(first.id).not.toBe(second.id);
  });

  it('UT-029 two ASSESSMENT records created the same calendar day are both independently retrievable in history', async () => {
    records.findHistory.mockResolvedValue([
      {
        ...recordRow([{ fieldLabel: 'Peso (kg)', numberValue: 79 }]),
        id: 'r2',
      },
      {
        ...recordRow([{ fieldLabel: 'Peso (kg)', numberValue: 80 }]),
        id: 'r1',
      },
    ]);

    const result = await service.findHistory(
      'pro-1',
      undefined,
      'client-1',
      TemplatePurpose.ASSESSMENT,
    );

    expect(result.map((r) => r.id)).toEqual(['r2', 'r1']);
  });
});
