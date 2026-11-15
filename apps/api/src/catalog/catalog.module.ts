import { Module } from '@nestjs/common';
import { BooksController } from './books.controller.js';
import { CatalogController } from './catalog.controller.js';

@Module({ controllers: [CatalogController, BooksController] })
export class CatalogModule {}
