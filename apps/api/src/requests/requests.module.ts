import { Module } from '@nestjs/common';
import { LessonsModule } from '../lessons/lessons.module.js';
import { RequestsController } from './requests.controller.js';
import { RequestsService } from './requests.service.js';

@Module({
  imports: [LessonsModule],
  controllers: [RequestsController],
  providers: [RequestsService],
})
export class RequestsModule {}
