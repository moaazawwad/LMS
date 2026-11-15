import { Module } from '@nestjs/common';
import { AcademySettingsController } from './academy-settings.js';

@Module({ controllers: [AcademySettingsController] })
export class SettingsModule {}
