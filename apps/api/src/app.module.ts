import { ApiTags } from '@nestjs/swagger';
import { Controller, Get, Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { ScheduleModule } from '@nestjs/schedule';
import { AuditModule } from './audit/audit.module.js';
import { AuthModule } from './auth/auth.module.js';
import { BillingModule } from './billing/billing.module.js';
import { CatalogModule } from './catalog/catalog.module.js';
import { Public } from './common/auth-user.js';
import { DbModule } from './db/db.module.js';
import { RequestsModule } from './requests/requests.module.js';
import { ApplicationsModule } from './applications/applications.module.js';
import { StaffModule } from './staff/staff.module.js';
import { StatsModule } from './stats/stats.module.js';
import { ExportsModule } from './exports/exports.module.js';
import { ImportModule } from './importing/import.module.js';
import { MailModule } from './mail/mail.module.js';
import { NotificationsModule } from './notifications/notifications.module.js';
import { SettingsModule } from './settings/settings.module.js';
import { LessonsModule } from './lessons/lessons.module.js';
import { StudentsModule } from './students/students.module.js';
import { SubscriptionsModule } from './subscriptions/subscriptions.module.js';
import { TeachersModule } from './teachers/teachers.module.js';

@ApiTags('Health')
@Controller('health')
class HealthController {
  @Public()
  @Get()
  health() {
    return { ok: true };
  }
}

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    ScheduleModule.forRoot(),
    DbModule,
    MailModule,
    NotificationsModule,
    AuditModule,
    AuthModule,
    CatalogModule,
    TeachersModule,
    StudentsModule,
    LessonsModule,
    BillingModule,
    SubscriptionsModule,
    StaffModule,
    RequestsModule,
    ApplicationsModule,
    StatsModule,
    ExportsModule,
    ImportModule,
    SettingsModule,
  ],
  controllers: [HealthController],
})
export class AppModule {}
