import { IsIn, IsObject, IsOptional, IsString, MaxLength, MinLength } from 'class-validator';

export class CreateFeedbackDto {
  @IsIn(['bug', 'idea'])
  kind!: 'bug' | 'idea';

  @IsString()
  @MinLength(3)
  @MaxLength(140)
  title!: string;

  @IsString()
  @MinLength(10)
  @MaxLength(5000)
  message!: string;

  // Auto-collected by the client: url, userAgent, viewport, projectId, build…
  @IsOptional()
  @IsObject()
  context?: Record<string, unknown>;
}
