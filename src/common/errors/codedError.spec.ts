import { CodedError } from './codedError';

describe('CodedError', () => {
  it('carries status, message and code in the response body', () => {
    const error = new CodedError(
      'Aluno não encontrado.',
      404,
      'student_not_found',
    );

    expect(error.getStatus()).toBe(404);
    expect(error.getResponse()).toEqual({
      statusCode: 404,
      message: 'Aluno não encontrado.',
      code: 'student_not_found',
    });
    expect(error.code).toBe('student_not_found');
  });
});
