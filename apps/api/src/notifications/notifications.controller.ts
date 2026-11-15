import { Body, Controller, Get, HttpCode, Post } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { ArrayMaxSize, IsArray, IsOptional, IsUUID } from 'class-validator';
import { type AuthUser, CurrentUser } from '../common/auth-user.js';
import { NotificationsService } from './notifications.service.js';

class ReadDto {
  /** the notices to mark read; leave out for all of them */
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(100)
  @IsUUID(undefined, { each: true })
  ids?: string[];
}

/** The bell: everyone sees their own notices only. */
@ApiTags('Notifications')
@Controller('notifications')
export class NotificationsController {
  constructor(private readonly notices: NotificationsService) {}

  @Get()
  list(@CurrentUser() user: AuthUser) {
    return this.notices.list(user.userId);
  }

  @Get('unread')
  async unread(@CurrentUser() user: AuthUser) {
    return { unread: await this.notices.unread(user.userId) };
  }

  @Post('read')
  @HttpCode(200)
  async read(@CurrentUser() user: AuthUser, @Body() body: ReadDto) {
    return { read: await this.notices.markRead(user.userId, body.ids) };
  }
}
