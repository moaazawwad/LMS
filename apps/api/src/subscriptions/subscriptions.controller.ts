import { ApiTags } from '@nestjs/swagger';
import {
  Body,
  Controller,
  Get,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import { Type } from 'class-transformer';
import {
  IsArray,
  IsBoolean,
  IsInt,
  IsISO8601,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  Max,
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator';
import {
  Area,
  type AuthUser,
  CurrentUser,
  Roles,
} from '../common/auth-user.js';
import { LessonsService } from '../lessons/lessons.service.js';
import { SubscriptionsService } from './subscriptions.service.js';

class SlotDto {
  /** ISO weekday on the student's clock, 1 = Monday */
  @IsInt() @Min(1) @Max(7) weekday: number;
  /** HH:mm on the student's clock */
  @Matches(/^([01]\d|2[0-3]):[0-5]\d$/) startTime: string;
}

class OverrideDto {
  @IsOptional() @IsBoolean() override?: boolean;
  @IsOptional() @IsString() @MaxLength(500) note?: string;
}

class CreateSubscriptionDto extends OverrideDto {
  @IsUUID() studentId: string;
  @IsUUID() teacherId: string;
  @IsUUID() curriculumId: string;
  /** optional: the plan follows the lessons a week (by hours); when given it must be that plan */
  @IsOptional() @IsUUID() planId?: string;
  /** optional: the number of weekly times given */
  @IsOptional() @IsInt() @Min(1) @Max(7) lessonsPerWeek?: number;
  @IsISO8601({ strict: true }) startDate: string;
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => SlotDto)
  slots: SlotDto[];
}

class UpdateSubscriptionDto extends OverrideDto {
  /** true: move the upcoming lessons to the new times now; otherwise from the next cycle */
  @IsOptional() @IsBoolean() applyNow?: boolean;
  /** optional: when given it must be the plan for the lessons a week */
  @IsOptional() @IsUUID() planId?: string;
  @IsOptional() @IsInt() @Min(1) @Max(7) lessonsPerWeek?: number;
  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => SlotDto)
  slots?: SlotDto[];
}

class TransferDto extends OverrideDto {
  @IsUUID() teacherId: string;
}

class FreeSlotsDto {
  /** the student's local date, YYYY-MM-DD */
  @IsISO8601({ strict: true }) date: string;
}

class NoteDto {
  @IsOptional() @IsString() @MaxLength(500) note?: string;
}

@ApiTags('Subscriptions')
@Controller('subscriptions')
@Roles('ADMIN', 'STAFF')
export class SubscriptionsController {
  constructor(
    private readonly subs: SubscriptionsService,
    private readonly lessons: LessonsService,
  ) {}

  @Post()
  @Area('students')
  create(@CurrentUser() user: AuthUser, @Body() body: CreateSubscriptionDto) {
    return this.subs.create(user, body);
  }

  @Get(':id')
  get(@Param('id', ParseUUIDPipe) id: string) {
    return this.subs.get(id);
  }

  /** Teachers this subscription could move to, and how its upcoming lessons fit each. */
  @Get(':id/transfer-options')
  @Area('students')
  transferOptions(@Param('id', ParseUUIDPipe) id: string) {
    return this.subs.transferOptions(id);
  }

  /** Free times for an extra or makeup lesson with this subscription's teacher. */
  @Get(':id/free-slots')
  freeSlots(@Param('id', ParseUUIDPipe) id: string, @Query() q: FreeSlotsDto) {
    return this.lessons.freeSlotsForSubscription(id, q.date);
  }

  @Patch(':id')
  @Area('students')
  update(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: UpdateSubscriptionDto,
  ) {
    return this.subs.update(user, id, body);
  }

  @Post(':id/transfer')
  @Area('students')
  @HttpCode(200)
  transfer(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: TransferDto,
  ) {
    return this.subs.transfer(user, id, body);
  }

  @Post(':id/pause')
  @Area('students')
  @HttpCode(200)
  pause(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: NoteDto,
  ) {
    return this.subs.pause(user, id, body.note);
  }
}
