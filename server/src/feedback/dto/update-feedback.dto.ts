import { IsIn } from 'class-validator';

export class UpdateFeedbackDto {
  @IsIn(['new', 'done'])
  status!: 'new' | 'done';
}
