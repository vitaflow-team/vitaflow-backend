import { AppError } from './app.erro';

describe('AppError Test', () => {
  it('Should boot with the message and status code provided', () => {
    const message = 'Message and status code provided';
    const statusCode = 404;

    const error = new AppError(message, statusCode);

    expect(error.message).toBe(message);
    expect(error.statusCode).toBe(statusCode);
  });

  it('Must boot with default status code (400) if not provided', () => {
    const message = 'Default status code (400)';

    const error = new AppError(message);

    expect(error.message).toBe(message);
    expect(error.statusCode).toBe(400);
  });
});
