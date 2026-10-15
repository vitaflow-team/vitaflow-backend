import { AuthModule } from '@/auth/auth.module';
import { PrismaService } from '@/database/prisma.service';
import { MailModule } from '@/mail/mail.module';
import { NotificationsModule } from '@/notifications/notifications.module';
import { ReceptionistAuthGuard } from '@/common/guards/receptionistAuth.guard';
import { AcademiaAccessPlanRepository } from '@/repositories/academia/academiaAccessPlan.repository';
import { AcademiaInvitationRepository } from '@/repositories/academia/academiaInvitation.repository';
import { AcademiaStaffMemberRepository } from '@/repositories/academia/academiaStaffMember.repository';
import { AcademiaStaffMemberTokenRepository } from '@/repositories/academia/academiaStaffMemberToken.repository';
import { EmploymentRepository } from '@/repositories/academia/employment.repository';
import { ClientsRepository } from '@/repositories/clients/clients.repository';
import { NotificationsRepository } from '@/repositories/notifications/notifications.repository';
import { UserRepository } from '@/repositories/users/user.repository';
import { PasswordHash } from '@/utils/password.hash';
import { Module } from '@nestjs/common';
import { AcademiaAccessPlanController } from './accessPlans/academiaAccessPlan.controller';
import { AcademiaAccessPlanService } from './accessPlans/academiaAccessPlan.service';
import { AcademiaActivityService } from './activity/academiaActivity.service';
import { AcademiaProvisioningService } from './academia.service';
import { AcademiaEmploymentController } from './invitations/academiaEmployment.controller';
import { AcademiaInvitationService } from './invitations/academiaInvitation.service';
import { AcademiaStaffInvitationController } from './invitations/academiaStaffInvitation.controller';
import { EducatorEmploymentController } from './invitations/educatorEmployment.controller';
import { EmploymentService } from './invitations/employment.service';
import { PainelController } from './painel/painel.controller';
import { PainelService } from './painel/painel.service';
import { ProfessoresController } from './professores/professores.controller';
import { ProfessoresService } from './professores/professores.service';
import { ProfessoresRepository } from '@/repositories/academia/professores.repository';
import {
  AcademiaStaffActivationController,
  AcademiaStaffController,
} from './staff/academiaStaff.controller';
import { AcademiaStaffAuthService } from './staff/academiaStaffAuth.service';
import { AcademiaStudentsController } from './students/academiaStudents.controller';
import { AcademiaStudentsService } from './students/academiaStudents.service';

@Module({
  imports: [AuthModule, MailModule, NotificationsModule],
  controllers: [
    AcademiaEmploymentController,
    EducatorEmploymentController,
    AcademiaStaffInvitationController,
    AcademiaStaffController,
    AcademiaStaffActivationController,
    AcademiaStudentsController,
    AcademiaAccessPlanController,
    PainelController,
    ProfessoresController,
  ],
  providers: [
    PrismaService,
    UserRepository,
    ClientsRepository,
    NotificationsRepository,
    PasswordHash,
    AcademiaProvisioningService,
    AcademiaInvitationRepository,
    EmploymentRepository,
    AcademiaStaffMemberRepository,
    AcademiaStaffMemberTokenRepository,
    AcademiaStaffAuthService,
    AcademiaActivityService,
    AcademiaInvitationService,
    EmploymentService,
    AcademiaStudentsService,
    AcademiaAccessPlanRepository,
    AcademiaAccessPlanService,
    PainelService,
    ProfessoresRepository,
    ProfessoresService,
    ReceptionistAuthGuard,
  ],
  exports: [
    AcademiaProvisioningService,
    ReceptionistAuthGuard,
    AcademiaStaffAuthService,
  ],
})
export class AcademiaModule {}
