import { Module } from '@nestjs/common';
import { AttendanceService } from './attendance.service.js';
import { HomeworkService } from './homework.service.js';
import { LessonsController } from './lessons.controller.js';
import { LessonNotices } from './lesson-notices.js';
import { LessonsService } from './lessons.service.js';
import { RemindersService } from './reminders.service.js';
import { ScheduleCheckService } from './schedule-check.service.js';
import { SchedulingService } from './scheduling.service.js';

@Module({
  controllers: [LessonsController],
  providers: [
    LessonNotices,
    LessonsService,
    SchedulingService,
    AttendanceService,
    ScheduleCheckService,
    RemindersService,
    HomeworkService,
  ],
  exports: [
    LessonNotices,
    LessonsService,
    SchedulingService,
    AttendanceService,
    RemindersService,
  ],
})
export class LessonsModule {}
