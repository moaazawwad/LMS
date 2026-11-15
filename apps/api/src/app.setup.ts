import { type INestApplication, ValidationPipe } from '@nestjs/common';
import helmet from 'helmet';
import { DbErrorFilter } from './common/db-error.filter.js';
import { requestLog } from './common/request-log.js';
import { helmetOptions } from './common/security.js';

/** Shared by the server and the e2e tests so both behave the same. */
export function configureApp<T extends INestApplication>(app: T): T {
  app.setGlobalPrefix('api');
  app.use(helmet(helmetOptions));
  // One line per request; quiet in tests or with LOG_REQUESTS=0.
  app.use(
    requestLog({
      quiet:
        process.env.NODE_ENV === 'test' || process.env.LOG_REQUESTS === '0',
    }),
  );
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
    }),
  );
  app.useGlobalFilters(new DbErrorFilter());
  app.enableShutdownHooks();
  const origins = process.env.CORS_ORIGINS?.split(',')
    .map((o) => o.trim())
    .filter(Boolean);
  if (origins?.length) app.enableCors({ origin: origins });
  return app;
}
