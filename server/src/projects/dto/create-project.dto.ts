import { IsString, MinLength, IsOptional, IsObject } from 'class-validator';

export class CreateProjectDto {
  @IsString()
  @MinLength(1)
  name!: string;

  @IsOptional()
  @IsObject()
  graph?: Record<string, unknown>;
}
