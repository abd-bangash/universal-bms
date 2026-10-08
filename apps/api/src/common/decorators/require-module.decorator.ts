import { SetMetadata } from '@nestjs/common';
import type { ModuleKey } from '@bms/types';

export const REQUIRED_MODULE_KEY = 'requiredModule';

/** The route only works while the workspace has this module switched on; otherwise 403 MODULE_DISABLED. */
export const RequireModule = (module: ModuleKey): MethodDecorator & ClassDecorator =>
  SetMetadata(REQUIRED_MODULE_KEY, module);
