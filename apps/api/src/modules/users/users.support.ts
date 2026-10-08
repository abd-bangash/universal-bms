import { AppException, ValidationFailedException } from '../../common/errors/app.exception';

/** The workspace must always keep at least one active Owner (Requirement 3.6). */
export const lastOwnerError = (field: string): ValidationFailedException =>
  new ValidationFailedException({ [field]: ['the workspace must keep at least one active Owner'] });

export const ownerOnly = (): AppException =>
  new AppException('PERMISSION_DENIED', 403, 'Only an Owner can do this');

export const elevatedRequired = (permission: string): AppException =>
  new AppException('PERMISSION_DENIED', 403, `This change needs the ${permission} permission`);
