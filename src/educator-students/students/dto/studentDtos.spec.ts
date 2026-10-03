import { createValidationPipe } from '@/config/validationPipe';
import { BadRequestException, ArgumentMetadata } from '@nestjs/common';
import { AccountLookupQueryDTO } from './accountLookupQuery.Dto';
import { CreateStudentDTO } from './createStudent.Dto';
import { ListStudentsQueryDTO } from './listStudentsQuery.Dto';
import { UpdateStudentDTO } from './updateStudent.Dto';

const pipe = createValidationPipe();

function run<T>(
  metatype: new () => T,
  value: unknown,
  type: ArgumentMetadata['type'] = 'body',
): Promise<T> {
  return pipe.transform(value, { type, metatype }) as Promise<T>;
}

async function messages(attempt: Promise<unknown>): Promise<string[]> {
  const error = (await attempt.catch((e: unknown) => e)) as BadRequestException;
  expect(error).toBeInstanceOf(BadRequestException);
  const body = error.getResponse() as { message: string[] };
  return body.message;
}

function birthDateYearsAgo(years: number, extraDays = 0): string {
  const date = new Date();
  date.setUTCFullYear(date.getUTCFullYear() - years);
  date.setUTCDate(date.getUTCDate() - extraDays);
  return date.toISOString().slice(0, 10);
}

const valid = {
  name: 'Diego Martins',
  email: 'diego@exemplo.com',
  linkExistingAccount: false,
};

describe('student DTOs (through the app validation pipe)', () => {
  it('UT-038 normalizes the e-mail (case and surrounding spaces)', async () => {
    const dto = await run(CreateStudentDTO, {
      ...valid,
      email: '  Diego@Exemplo.COM ',
    });
    const lookup = await run(
      AccountLookupQueryDTO,
      { email: ' Ana@Exemplo.com ' },
      'query',
    );

    expect(dto.email).toBe('diego@exemplo.com');
    expect(lookup.email).toBe('ana@exemplo.com');
  });

  it.each(['', 'a@', 'x'.repeat(250) + '@exemplo.com'])(
    'UT-039 rejects the lookup e-mail %p',
    async (email) => {
      const result = await messages(
        run(AccountLookupQueryDTO, { email }, 'query'),
      );

      expect(result.join(' ')).toMatch(/email/);
    },
  );

  it.each(['', '   '])('UT-049 rejects a blank name %p', async (name) => {
    const result = await messages(run(CreateStudentDTO, { ...valid, name }));

    expect(result.join(' ')).toMatch(/name/);
  });

  it('UT-050 accepts ages 5 to 120 and rejects tomorrow, 4 and 121', async () => {
    const tomorrow = new Date();
    tomorrow.setUTCDate(tomorrow.getUTCDate() + 1);

    await expect(
      run(CreateStudentDTO, {
        ...valid,
        birthDate: birthDateYearsAgo(5, 1),
      }),
    ).resolves.toBeDefined();
    await expect(
      run(CreateStudentDTO, {
        ...valid,
        birthDate: birthDateYearsAgo(120, 0),
      }),
    ).resolves.toBeDefined();

    for (const birthDate of [
      tomorrow.toISOString().slice(0, 10),
      birthDateYearsAgo(4, 0),
      birthDateYearsAgo(121, 5),
      'not-a-date',
    ]) {
      const result = await messages(
        run(CreateStudentDTO, { ...valid, birthDate }),
      );
      expect(result.join(' ')).toMatch(/birthDate/);
    }
  });

  it.each(['(11) 98888-7777', '11988887777', '(11) 8888-7777'])(
    'UT-051 accepts the phone %p',
    async (phone) => {
      await expect(
        run(CreateStudentDTO, { ...valid, phone }),
      ).resolves.toBeDefined();
    },
  );

  it.each(['abc', '123', '(11) abcde-7777'])(
    'UT-051 rejects the phone %p',
    async (phone) => {
      const result = await messages(run(CreateStudentDTO, { ...valid, phone }));

      expect(result.join(' ')).toMatch(/phone/);
    },
  );

  it('UT-052 accepts a name of 120 characters, rejects 121, and keeps markup as text', async () => {
    await expect(
      run(CreateStudentDTO, { ...valid, name: 'a'.repeat(120) }),
    ).resolves.toBeDefined();
    await messages(run(CreateStudentDTO, { ...valid, name: 'a'.repeat(121) }));

    const dto = await run(CreateStudentDTO, {
      ...valid,
      name: '<b>Ana</b> João 😀',
    });
    expect(dto.name).toBe('<b>Ana</b> João 😀');
  });

  it('requires linkExistingAccount to be a boolean', async () => {
    await messages(
      run(CreateStudentDTO, { name: 'Ana', email: 'ana@exemplo.com' }),
    );
  });

  it('UT-102 rejects fields the DTO does not declare', async () => {
    for (const extra of [
      { professionalId: 'other' },
      { userId: 'some-user' },
      { id: 'x' },
    ]) {
      const result = await messages(
        run(CreateStudentDTO, { ...valid, ...extra }),
      );
      expect(result.join(' ')).toMatch(/should not exist/);
      await messages(run(UpdateStudentDTO, { ...extra }));
    }
  });

  it('parses the list page and rejects a page below 1 or non numeric', async () => {
    const ok = await run(
      ListStudentsQueryDTO,
      { page: '2', search: 'ana' },
      'query',
    );
    expect(ok.page).toBe(2);

    for (const page of ['0', 'abc', '-1', '1.5']) {
      await messages(run(ListStudentsQueryDTO, { page }, 'query'));
    }
  });

  it('accepts an empty update (nothing to change)', async () => {
    await expect(run(UpdateStudentDTO, {})).resolves.toBeDefined();
  });
});
