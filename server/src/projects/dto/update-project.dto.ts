import { IsString, MinLength, IsOptional, IsObject } from 'class-validator';

export class UpdateProjectDto {
  @IsOptional()
  @IsString()
  @MinLength(1)
  name?: string;

  @IsOptional()
  @IsObject()
  graph?: Record<string, unknown>;
}
