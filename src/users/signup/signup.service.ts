import { MailService } from '@/mail/mail.service';
import { ClientsRepository } from '@/repositories/clients/clients.repository';
import { UserRepository } from '@/repositories/users/user.repository';
import { UserTokenRepository } from '@/repositories/users/userToken.repository';
import { AppError } from '@/utils/app.erro';
import { PasswordHash } from '@/utils/password.hash';
import { Injectable } from '@nestjs/common';
import { differenceInHours } from 'date-fns';
import { ActiveDTO } from './activate.Dto';
import { SignUpDTO } from './signup.Dto';

@Injectable()
export class SignUpService {
  constructor(
    private user: UserRepository,

    private client: ClientsRepository,

    private hash: PasswordHash,

    private userToken: UserTokenRepository,

    private mailService: MailService,
  ) {}

  async postNewUser({ email, name, password, checkPassword }: SignUpDTO) {
    if (checkPassword !== password) {
      throw new AppError(
        'A confirmação da senha não corresponde à senha.',
        400,
      );
    }

    const userExists = await this.user.findByEmail({ email });
    if (userExists) {
      throw new AppError(
        'Este e-mail já está sendo usado por outro usuário.',
        400,
      );
    }

    const hasPassword = await this.hash.generateHash(password);

    const userCreated = await this.user.create({
      name,
      email,
      password: hasPassword,
      active: false,
    });

    const userTokenCreated = await this.userToken.create({
      user: { connect: userCreated },
    });

    const activationLink = `${process.env.APP_URL}/signin/activate?token=${userTokenCreated.id}`;

    await this.mailService.sendEmailPassword(
      name,
      email,
      'Ative sua conta',
      './activation',
      activationLink,
    );

    await this.client.setAllClientUser(userCreated.id, email);

    return {
      ...userCreated,
      password: undefined,
    };
  }

  async activateNewUser({ token }: ActiveDTO) {
    const userToken = await this.userToken.findById({ id: token });
    if (userToken) {
      if (differenceInHours(Date.now(), userToken.createdAt) > 2) {
        throw new AppError('Token expirado.', 400);
      }

      await this.userToken.deleteAll({
        userID: userToken.userID,
      });

      const user = await this.user.activateUser(userToken.userID);

      return { ...user, password: undefined };
    }

    return null;
  }
}
