import { ApiTags } from '@nestjs/swagger';
import {
  Body,
  Controller,
  Get,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
} from '@nestjs/common';
import { Type } from 'class-transformer';
import {
  IsBoolean,
  IsDate,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  Max,
  MaxLength,
  Min,
  MinLength,
} from 'class-validator';
import {
  Area,
  type AuthUser,
  CurrentUser,
  Roles,
} from '../common/auth-user.js';
import { RequestsService } from './requests.service.js';

class CreateRequestDto {
  @IsUUID() lessonId: string;
  @IsIn(['CANCEL', 'RESCHEDULE']) kind: 'CANCEL' | 'RESCHEDULE';
  @IsString() @MinLength(1) @MaxLength(500) message: string;
  @IsOptional() @IsString() @MaxLength(200) preferredTimes?: string;
}

class ListRequestsDto {
  @IsOptional() @IsIn(['OPEN', 'CLOSED']) status?: 'OPEN' | 'CLOSED';
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(200) limit?: number;
}

class ApproveRequestDto {
  @IsOptional() @IsString() @MaxLength(500) note?: string;
  @IsOptional() @Type(() => Date) @IsDate() startsAt?: Date;
  @IsOptional() @IsBoolean() credit?: boolean;
  @IsOptional() @IsIn(['MAKEUP', 'CREDIT']) teacherRemedy?: 'MAKEUP' | 'CREDIT';
  @IsOptional() @IsBoolean() override?: boolean;
}

class DeclineRequestDto {
  @IsString() @MinLength(1) @MaxLength(500) note: string;
}

/**
 * Students and teachers ask; staff approve (the change happens in the same step) or decline.
 */
@ApiTags('Requests')
@Controller('requests')
export class RequestsController {
  constructor(private readonly requests: RequestsService) {}

  @Post()
  @Roles('STUDENT', 'TEACHER')
  create(@CurrentUser() user: AuthUser, @Body() body: CreateRequestDto) {
    return this.requests.create(user, body);
  }

  @Get()
  list(@CurrentUser() user: AuthUser, @Query() q: ListRequestsDto) {
    return this.requests.list(user, q);
  }

  @Get('summary')
  summary(@CurrentUser() user: AuthUser) {
    return this.requests.openCount(user);
  }

  @Post(':id/approve')
  @HttpCode(200)
  @Roles('ADMIN', 'STAFF')
  @Area('lessons')
  approve(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: ApproveRequestDto,
  ) {
    return this.requests.approve(user, id, body);
  }

  @Post(':id/decline')
  @HttpCode(200)
  @Roles('ADMIN', 'STAFF')
  @Area('lessons')
  decline(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: DeclineRequestDto,
  ) {
    return this.requests.decline(user, id, body.note);
  }

  @Post(':id/withdraw')
  @HttpCode(200)
  @Roles('STUDENT', 'TEACHER')
  withdraw(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.requests.withdraw(user, id);
  }
}
