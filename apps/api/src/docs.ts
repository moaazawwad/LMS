import type { INestApplication } from '@nestjs/common';
import {
  DocumentBuilder,
  type OpenAPIObject,
  SwaggerModule,
} from '@nestjs/swagger';

/**
 * The API description (OpenAPI 3). Request bodies come from the validation
 * rules on each route, so the docs can't drift from what the API accepts.
 */
export function buildOpenApi(app: INestApplication): OpenAPIObject {
  const config = new DocumentBuilder()
    .setTitle('Brightverse Academy API')
    .setDescription(
      [
        'Sign in with `POST /api/auth/login`, then send `Authorization: Bearer <accessToken>` on every other call.',
        'A business rule that blocks an action answers **422** with `violations` and `canOverride`;',
        'staff can retry with `override: true` and a `note`.',
        'Times are ISO 8601 instants (UTC); each lesson also carries the student time zone.',
      ].join(' '),
    )
    .setVersion('1')
    .addBearerAuth(
      { type: 'http', scheme: 'bearer', bearerFormat: 'JWT' },
      'bearer',
    )
    .addSecurityRequirements('bearer')
    .build();
  return SwaggerModule.createDocument(app, config, {
    operationIdFactory: (controller, method) =>
      `${controller.replace(/Controller$/, '')}_${method}`,
  });
}

/** Swagger UI at /api/docs and the raw spec at /api/docs/openapi.json. */
export function mountDocs(app: INestApplication) {
  SwaggerModule.setup('api/docs', app, () => buildOpenApi(app), {
    jsonDocumentUrl: 'api/docs/openapi.json',
    customSiteTitle: 'Brightverse Academy API',
    swaggerOptions: {
      persistAuthorization: true,
      tagsSorter: 'alpha',
      operationsSorter: 'alpha',
    },
  });
}
