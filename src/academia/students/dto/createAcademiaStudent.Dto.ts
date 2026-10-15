import { CreateStudentDTO } from '@/educator-students/students/dto/createStudent.Dto';
import { ApiProperty } from '@nestjs/swagger';
import { IsOptional, IsString } from 'class-validator';

export class CreateAcademiaStudentDTO extends CreateStudentDTO {
  @ApiProperty({
    required: false,
    description:
      'Educator currently employed by this academia to assign immediately, or omitted to register the student unassigned ("sem educador") (gym-students ADR-002/ADR-004).',
    example: 'educator-uuid-string',
  })
  @IsOptional()
  @IsString()
  professionalId?: string;
}
