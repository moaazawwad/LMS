import { ApiTags } from '@nestjs/swagger';
import { Controller, Get, Query } from '@nestjs/common';
import { Transform, Type } from 'class-transformer';
import {
  IsArray,
  IsDate,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  Max,
  MaxLength,
  Min,
} from 'class-validator';
import { Area, Roles } from '../common/auth-user.js';
import { actorKindEnum, type ActorKind } from '../db/schema.js';
import { AuditService } from './audit.service.js';

class AuditQueryDto {
  @IsOptional() @IsIn(actorKindEnum.enumValues) actorKind?: ActorKind;
  @IsOptional() @IsString() action?: string;
  @IsOptional() @IsString() entityType?: string;
  @IsOptional() @IsString() entityId?: string;
  @IsOptional() @Type(() => Date) @IsDate() from?: Date;
  @IsOptional() @Type(() => Date) @IsDate() to?: Date;
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(200) limit?: number;
  @IsOptional() @IsString() @MaxLength(100) q?: string;
  /** comma list: "lesson.,homework." (prefixes end with a dot) or exact actions */
  @IsOptional()
  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string'
      ? value
          .split(',')
          .map((a) => a.trim())
          .filter(Boolean)
      : value,
  )
  @IsArray()
  @Matches(/^[a-z_.]{1,40}$/, { each: true })
  actions?: string[];
  @IsOptional() @IsUUID() studentId?: string;
  @IsOptional() @IsUUID() teacherId?: string;
}

@ApiTags('Activity log')
@Controller('audit-logs')
@Roles('ADMIN', 'STAFF')
@Area('logs')
export class AuditController {
  constructor(private readonly audit: AuditService) {}

  @Get()
  list(@Query() q: AuditQueryDto) {
    return this.audit.list(q);
  }
}
