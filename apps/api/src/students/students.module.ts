import { Module } from '@nestjs/common';
import { StudentNotesController } from './student-notes.controller.js';
import { StudentsController } from './students.controller.js';

@Module({ controllers: [StudentsController, StudentNotesController] })
export class StudentsModule {}
