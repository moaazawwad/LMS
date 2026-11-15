import { ApiTags } from '@nestjs/swagger';
import { Body, Controller, Get, HttpCode, Inject, Post } from '@nestjs/common';
import { IsEmail, MaxLength } from 'class-validator';
import { desc, eq } from 'drizzle-orm';
import { type AuthUser, CurrentUser, Roles } from '../common/auth-user.js';
import { DB, type Db } from '../db/db.module.js';
import { emailOutbox } from '../db/schema.js';
import { MailService } from './mail.service.js';
import { testEmail } from './templates.js';

class TestEmailDto {
  @IsEmail() @MaxLength(200) to: string;
}

/** Admins see whether email is on and what went out, and can send a test. */
@ApiTags('Email')
@Controller('mail')
@Roles('ADMIN')
export class MailController {
  constructor(
    private readonly mail: MailService,
    @Inject(DB) private readonly db: Db,
  ) {}

  @Get()
  status() {
    return this.mail.status();
  }

  @Post('test')
  @HttpCode(200)
  async test(@CurrentUser() _user: AuthUser, @Body() body: TestEmailDto) {
    await this.mail.enqueue(
      this.db,
      body.to.trim().toLowerCase(),
      'test',
      testEmail(),
    );
    await this.mail.flush();
    const [last] = await this.db
      .select({ status: emailOutbox.status, error: emailOutbox.error })
      .from(emailOutbox)
      .where(eq(emailOutbox.kind, 'test'))
      .orderBy(desc(emailOutbox.createdAt))
      .limit(1);
    return last;
  }
}
