import type { INestApplication } from '@nestjs/common';
import { METHOD_METADATA, PATH_METADATA } from '@nestjs/common/constants';
import { ModulesContainer } from '@nestjs/core';
import { API_PREFIX } from '../../src/app.setup';
import { AUTHENTICATED_KEY } from '../../src/common/decorators/authenticated.decorator';
import { IS_PUBLIC_KEY } from '../../src/common/decorators/public.decorator';
import { REQUIRED_PERMISSION_KEY } from '../../src/common/decorators/require-permission.decorator';

const METHODS = ['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'ALL', 'OPTIONS', 'HEAD'];

export interface RouteInfo {
  method: string;
  /** Full path with the API prefix and `:param` placeholders */
  path: string;
  isPublic: boolean;
  authenticatedOnly: boolean;
  permission?: string;
}

/** Every HTTP route of every controller, with the access metadata its decorators declare. */
export function listRoutes(app: INestApplication): RouteInfo[] {
  const routes: RouteInfo[] = [];
  for (const module of app.get(ModulesContainer).values()) {
    for (const wrapper of module.controllers.values()) {
      const controller = wrapper.metatype as (new () => object) | null;
      if (!controller) continue;
      const base = (Reflect.getMetadata(PATH_METADATA, controller) as string | undefined) ?? '';
      for (const name of Object.getOwnPropertyNames(controller.prototype)) {
        const handler = (controller.prototype as Record<string, unknown>)[name];
        if (typeof handler !== 'function') continue;
        const methodIndex = Reflect.getMetadata(METHOD_METADATA, handler) as number | undefined;
        if (methodIndex === undefined) continue;
        const sub = (Reflect.getMetadata(PATH_METADATA, handler) as string | undefined) ?? '';
        const read = <T>(key: string): T | undefined =>
          (Reflect.getMetadata(key, handler) as T | undefined) ??
          (Reflect.getMetadata(key, controller) as T | undefined);
        const path = `/${[API_PREFIX, base, sub].join('/')}`
          .replace(/\/+/g, '/')
          .replace(/\/$/, '');
        routes.push({
          method: METHODS[methodIndex] as string,
          path,
          isPublic: read<boolean>(IS_PUBLIC_KEY) === true,
          authenticatedOnly: read<boolean>(AUTHENTICATED_KEY) === true,
          permission: read<string>(REQUIRED_PERMISSION_KEY),
        });
      }
    }
  }
  return routes;
}
