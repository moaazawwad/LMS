import { Module } from '@nestjs/common';
import { LessonsModule } from '../lessons/lessons.module.js';
import { LevelRatesController } from './level-rates.controller.js';
import { PayoutsController } from './payouts.controller.js';
import { TeacherProfileController } from './teacher-profile.controller.js';
import { TeachersController } from './teachers.controller.js';

@Module({
  imports: [LessonsModule],
  controllers: [
    TeachersController,
    TeacherProfileController,
    PayoutsController,
    LevelRatesController,
  ],
})
export class TeachersModule {}
