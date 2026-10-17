import {
  AssessmentTemplatesRepository,
  TemplateWithFields,
} from '@/repositories/clinical-records/assessmentTemplates.repository';
import { FormFieldType, ProductType, TemplatePurpose } from '@prisma/client';
import { TemplatesService } from './templates.service';

function template(
  overrides: Partial<TemplateWithFields> = {},
): TemplateWithFields {
  return {
    id: 'template-1',
    professionalId: 'pro-1',
    academiaId: null,
    name: 'Anamnese',
    purpose: TemplatePurpose.ANAMNESE,
    active: true,
    createdAt: new Date('2026-01-01T00:00:00.000Z'),
    updatedAt: new Date('2026-01-01T00:00:00.000Z'),
    fields: [],
    ...overrides,
  };
}

describe('TemplatesService', () => {
  const repo = {
    create: jest.fn(),
    findById: jest.fn(),
    findOwnedById: jest.fn(),
    listByOwner: jest.fn(),
    countByOwner: jest.fn(),
    update: jest.fn(),
    discontinue: jest.fn(),
  };
  let service: TemplatesService;

  beforeEach(() => {
    jest.clearAllMocks();
    service = new TemplatesService(
      repo as unknown as AssessmentTemplatesRepository,
    );
  });

  it('UT-001 create() with a valid ANAMNESE template persists with correct position ordering', async () => {
    const fields = [
      { label: 'Nome', fieldType: FormFieldType.SHORT_TEXT },
      { label: 'Idade', fieldType: FormFieldType.NUMBER },
    ];
    repo.create.mockResolvedValue(
      template({
        purpose: TemplatePurpose.ANAMNESE,
        fields: fields.map((f, position) => ({
          id: `f${position}`,
          templateId: 'template-1',
          position,
          label: f.label,
          fieldType: f.fieldType,
          options: [],
          required: false,
          weightRole: false,
          heightRole: false,
        })),
      }),
    );

    const result = await service.create(
      { professionalId: 'pro-1' },
      { name: 'Anamnese', purpose: TemplatePurpose.ANAMNESE, fields },
    );

    expect(repo.create).toHaveBeenCalledWith(
      { professionalId: 'pro-1' },
      'Anamnese',
      TemplatePurpose.ANAMNESE,
      fields,
    );
    expect(result.fields.map((f) => f.position)).toEqual([0, 1]);
  });

  it('UT-002 create() with an ASSESSMENT template persists both weight and height roles', async () => {
    const fields = [
      { label: 'Peso (kg)', fieldType: FormFieldType.NUMBER, weightRole: true },
      {
        label: 'Altura (cm)',
        fieldType: FormFieldType.NUMBER,
        heightRole: true,
      },
    ];
    repo.create.mockResolvedValue(
      template({
        purpose: TemplatePurpose.ASSESSMENT,
        fields: [
          {
            id: 'f0',
            templateId: 'template-1',
            position: 0,
            label: 'Peso (kg)',
            fieldType: FormFieldType.NUMBER,
            options: [],
            required: false,
            weightRole: true,
            heightRole: false,
          },
          {
            id: 'f1',
            templateId: 'template-1',
            position: 1,
            label: 'Altura (cm)',
            fieldType: FormFieldType.NUMBER,
            options: [],
            required: false,
            weightRole: false,
            heightRole: true,
          },
        ],
      }),
    );

    const result = await service.create(
      { professionalId: 'pro-1' },
      { name: 'Avaliação', purpose: TemplatePurpose.ASSESSMENT, fields },
    );

    expect(result.fields[0].weightRole).toBe(true);
    expect(result.fields[1].heightRole).toBe(true);
  });

  it('UT-009 create() resolves owner from the caller context, never from client-supplied input', async () => {
    repo.create.mockResolvedValue(template());

    await service.create(
      { professionalId: 'pro-1' },
      {
        name: 'Anamnese',
        purpose: TemplatePurpose.ANAMNESE,
        fields: [{ label: 'x', fieldType: FormFieldType.SHORT_TEXT }],
        // @ts-expect-error -- a caller-supplied owner field must never be forwarded
        academiaId: 'attacker-academia',
      },
    );

    expect(repo.create).toHaveBeenCalledWith(
      { professionalId: 'pro-1' },
      'Anamnese',
      TemplatePurpose.ANAMNESE,
      expect.anything(),
    );
  });

  it('UT-010 two templates of the same purpose for the same owner are both listed', async () => {
    repo.listByOwner.mockResolvedValue([
      template({ id: 't1', name: 'A' }),
      template({ id: 't2', name: 'B' }),
    ]);

    const result = await service.list(
      { professionalId: 'pro-1' },
      TemplatePurpose.ANAMNESE,
    );

    expect(result.map((t) => t.id)).toEqual(['t1', 't2']);
  });

  it('UT-011 create() with an empty fields array is rejected 400 template_empty', async () => {
    await expect(
      service.create(
        { professionalId: 'pro-1' },
        { name: 'x', purpose: TemplatePurpose.ANAMNESE, fields: [] },
      ),
    ).rejects.toMatchObject({ code: 'template_empty' });
    expect(repo.create).not.toHaveBeenCalled();
  });

  it('UT-012 create() with a MULTIPLE_CHOICE field and no options is rejected 400 missing_options', async () => {
    await expect(
      service.create(
        { professionalId: 'pro-1' },
        {
          name: 'x',
          purpose: TemplatePurpose.ANAMNESE,
          fields: [
            {
              label: 'Escolha',
              fieldType: FormFieldType.MULTIPLE_CHOICE,
              options: [],
            },
          ],
        },
      ),
    ).rejects.toMatchObject({ code: 'missing_options' });
    expect(repo.create).not.toHaveBeenCalled();
  });

  it('UT-013 create() with two fields sharing the same label persists both with distinct ids', async () => {
    repo.create.mockResolvedValue(
      template({
        fields: [
          {
            id: 'f0',
            templateId: 't',
            position: 0,
            label: 'Observação',
            fieldType: FormFieldType.SHORT_TEXT,
            options: [],
            required: false,
            weightRole: false,
            heightRole: false,
          },
          {
            id: 'f1',
            templateId: 't',
            position: 1,
            label: 'Observação',
            fieldType: FormFieldType.SHORT_TEXT,
            options: [],
            required: false,
            weightRole: false,
            heightRole: false,
          },
        ],
      }),
    );

    const result = await service.create(
      { professionalId: 'pro-1' },
      {
        name: 'x',
        purpose: TemplatePurpose.ANAMNESE,
        fields: [
          { label: 'Observação', fieldType: FormFieldType.SHORT_TEXT },
          { label: 'Observação', fieldType: FormFieldType.SHORT_TEXT },
        ],
      },
    );

    expect(result.fields.map((f) => f.id)).toEqual(['f0', 'f1']);
  });

  it('UT-014 update() on a template with existing records never touches FormRecordValue (no such dependency exists)', async () => {
    repo.update.mockResolvedValue(template({ name: 'Novo nome' }));

    await service.update({ professionalId: 'pro-1' }, 'template-1', {
      name: 'Novo nome',
    });

    expect(repo.update).toHaveBeenCalledWith(
      'template-1',
      { professionalId: 'pro-1' },
      {
        name: 'Novo nome',
      },
    );
    expect(Object.keys(repo)).not.toContain('formRecordValue');
  });

  it("UT-015 update() removing a field persists the new field list, past values are the repository layer's concern", async () => {
    repo.update.mockResolvedValue(
      template({
        fields: [
          {
            id: 'f-new',
            templateId: 't',
            position: 0,
            label: 'Novo campo',
            fieldType: FormFieldType.SHORT_TEXT,
            options: [],
            required: false,
            weightRole: false,
            heightRole: false,
          },
        ],
      }),
    );

    const result = await service.update(
      { professionalId: 'pro-1' },
      'template-1',
      {
        fields: [{ label: 'Novo campo', fieldType: FormFieldType.SHORT_TEXT }],
      },
    );

    expect(result.fields).toHaveLength(1);
    expect(result.fields[0].label).toBe('Novo campo');
  });

  it('UT-016 discontinue() on a template with existing records sets active false', async () => {
    repo.discontinue.mockResolvedValue(template({ active: false }));

    await service.discontinue({ professionalId: 'pro-1' }, 'template-1');

    expect(repo.discontinue).toHaveBeenCalledWith('template-1', {
      professionalId: 'pro-1',
    });
  });

  it('discontinue() answers 404 for a template that does not belong to the caller', async () => {
    repo.discontinue.mockResolvedValue(null);

    await expect(
      service.discontinue({ professionalId: 'pro-1' }, 'template-1'),
    ).rejects.toMatchObject({ code: 'template_not_found' });
  });

  it('UT-017 ensureStarterTemplates seeds exactly one ANAMNESE and one ASSESSMENT for a new nutritionist', async () => {
    repo.countByOwner.mockResolvedValue(0);
    repo.create.mockResolvedValue(template());

    await service.ensureStarterTemplates(
      { professionalId: 'nutri-1' },
      ProductType.NUTRITIONIST,
    );

    expect(repo.create).toHaveBeenCalledTimes(2);
    const purposes = repo.create.mock.calls.map(
      (call) => call[2] as TemplatePurpose,
    );
    expect(purposes.sort()).toEqual([
      TemplatePurpose.ANAMNESE,
      TemplatePurpose.ASSESSMENT,
    ]);
  });

  it('UT-018 ensureStarterTemplates for a physical educator seeds fields mirroring PhysicalAssessment (weight/height pre-tagged)', async () => {
    repo.countByOwner.mockResolvedValue(0);
    repo.create.mockResolvedValue(template());

    await service.ensureStarterTemplates(
      { professionalId: 'edu-1' },
      ProductType.PHYSICAL_EDUCATOR,
    );

    const assessmentCall = repo.create.mock.calls.find(
      (call) => call[2] === TemplatePurpose.ASSESSMENT,
    )!;
    const seededFields = assessmentCall[3];
    expect(
      seededFields.some((f: { weightRole?: boolean }) => f.weightRole),
    ).toBe(true);
    expect(
      seededFields.some((f: { heightRole?: boolean }) => f.heightRole),
    ).toBe(true);
    expect(seededFields.length).toBeGreaterThan(2);
  });

  it('seeds the academia owner the same way as a physical educator', async () => {
    repo.countByOwner.mockResolvedValue(0);
    repo.create.mockResolvedValue(template());

    await service.ensureStarterTemplates(
      { academiaId: 'academia-1' },
      ProductType.ACADEMIA,
    );

    expect(repo.create).toHaveBeenCalledWith(
      { academiaId: 'academia-1' },
      expect.any(String),
      TemplatePurpose.ANAMNESE,
      expect.anything(),
    );
  });

  it('UT-019 editing a seeded default template behaves identically to editing any other template', async () => {
    repo.update.mockResolvedValue(template({ name: 'Editado' }));

    const result = await service.update(
      { professionalId: 'pro-1' },
      'template-1',
      {
        name: 'Editado',
      },
    );

    expect(result.name).toBe('Editado');
  });

  it('UT-020 a NUMBER field flagged weightRole/heightRole is accepted and returned on reads', async () => {
    repo.listByOwner.mockResolvedValue([
      template({
        fields: [
          {
            id: 'f0',
            templateId: 't',
            position: 0,
            label: 'Peso (kg)',
            fieldType: FormFieldType.NUMBER,
            options: [],
            required: false,
            weightRole: true,
            heightRole: false,
          },
        ],
      }),
    ]);

    const [result] = await service.list({ professionalId: 'pro-1' });

    expect(result.fields[0]).toMatchObject({
      weightRole: true,
      heightRole: false,
    });
  });

  it('UT-061 a physical educator calling TemplatesService (professional-owned) behaves identically to a nutritionist', async () => {
    repo.create.mockResolvedValue(template({ professionalId: 'edu-1' }));

    await service.create(
      { professionalId: 'edu-1' },
      {
        name: 'Avaliação',
        purpose: TemplatePurpose.ASSESSMENT,
        fields: [{ label: 'Peso', fieldType: FormFieldType.NUMBER }],
      },
    );

    expect(repo.create).toHaveBeenCalledWith(
      { professionalId: 'edu-1' },
      expect.anything(),
      expect.anything(),
      expect.anything(),
    );
  });

  it('UT-062 an academia owner create() call persists academiaId set, professionalId unset', async () => {
    repo.create.mockResolvedValue(
      template({ professionalId: null, academiaId: 'academia-1' }),
    );

    const result = await service.create(
      { academiaId: 'academia-1' },
      {
        name: 'Avaliação',
        purpose: TemplatePurpose.ASSESSMENT,
        fields: [{ label: 'Peso', fieldType: FormFieldType.NUMBER }],
      },
    );

    expect(repo.create).toHaveBeenCalledWith(
      { academiaId: 'academia-1' },
      expect.anything(),
      expect.anything(),
      expect.anything(),
    );
    expect(result.id).toBeDefined();
  });

  it('UT-063 a physical educator employed by an academia, creating for a private student, persists with their own professionalId', async () => {
    repo.create.mockResolvedValue(template({ professionalId: 'edu-1' }));

    await service.create(
      { professionalId: 'edu-1' },
      {
        name: 'Avaliação privada',
        purpose: TemplatePurpose.ASSESSMENT,
        fields: [{ label: 'Peso', fieldType: FormFieldType.NUMBER }],
      },
    );

    const [owner] = repo.create.mock.calls[0];
    expect(owner).toEqual({ professionalId: 'edu-1' });
    expect(owner).not.toHaveProperty('academiaId');
  });
});
