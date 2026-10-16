import { AuthModule } from '@/auth/auth.module';
import { PrismaService } from '@/database/prisma.service';
import { MailModule } from '@/mail/mail.module';
import { NotificationsModule } from '@/notifications/notifications.module';
import { ReceptionistAuthGuard } from '@/common/guards/receptionistAuth.guard';
import { EducatorStudentsModule } from '@/educator-students/educatorStudents.module';
import { MailModule } from '@/mail/mail.module';
import { NotificationsModule } from '@/notifications/notifications.module';
import { Clock } from '@/scheduling/clock.service';
import { FixedTimesModule } from '@/scheduling/fixed-times/fixedTimes.module';
import { ReceptionistAuthGuard } from '@/common/guards/receptionistAuth.guard';
import { GymStudentGuard } from '@/common/guards/gymStudent.guard';
import { AcademiaAccessPlanRepository } from '@/repositories/academia/academiaAccessPlan.repository';
import { AcademiaInvitationRepository } from '@/repositories/academia/academiaInvitation.repository';
import { AcademiaStaffMemberRepository } from '@/repositories/academia/academiaStaffMember.repository';
import { AcademiaStaffMemberTokenRepository } from '@/repositories/academia/academiaStaffMemberToken.repository';
import { EmploymentRepository } from '@/repositories/academia/employment.repository';
import { CheckInRepository } from '@/repositories/academia/checkIn.repository';
import { StudentAccessPlanRepository } from '@/repositories/academia/studentAccessPlan.repository';
import { TurmasRepository } from '@/repositories/academia/turmas.repository';
import { TurmaEnrollmentRepository } from '@/repositories/academia/turmaEnrollment.repository';
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
import { CheckInController } from './checkin/checkin.controller';
import { CheckInService } from './checkin/checkin.service';
import { ReceptionistCheckInController } from './checkin/receptionistCheckin.controller';
import { StudentAccessPlanController } from './checkin/studentAccessPlan.controller';
import { StudentAccessPlanService } from './checkin/studentAccessPlan.service';
import { EngajamentoController } from './engajamento/engajamento.controller';
import { EngajamentoService } from './engajamento/engajamento.service';
import { StudentTurmasController } from './turmas/studentTurmas.controller';
import { TurmaEnrollmentService } from './turmas/turmaEnrollment.service';
import { TurmaSessionsRenewalService } from './turmas/turmaSessionsRenewal.service';
import { TurmasController } from './turmas/turmas.controller';
import { TurmasService } from './turmas/turmas.service';

@Module({
  imports: [
    AuthModule,
    MailModule,
    NotificationsModule,
    EducatorStudentsModule,
    FixedTimesModule,
  ],
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
    CheckInController,
    ReceptionistCheckInController,
    StudentAccessPlanController,
    EngajamentoController,
    TurmasController,
    StudentTurmasController,
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
    ReceptionistAuthGuard,
    ProfessoresRepository,
    ProfessoresService,
    ReceptionistAuthGuard,
    GymStudentGuard,
    Clock,
    CheckInRepository,
    StudentAccessPlanRepository,
    CheckInService,
    StudentAccessPlanService,
    EngajamentoService,
    TurmasRepository,
    TurmaEnrollmentRepository,
    TurmasService,
    TurmaEnrollmentService,
    TurmaSessionsRenewalService,
  ],
  exports: [
    AcademiaProvisioningService,
    ReceptionistAuthGuard,
    AcademiaStaffAuthService,
  ],
})
export class AcademiaModule {}
