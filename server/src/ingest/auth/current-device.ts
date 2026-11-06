import { createParamDecorator, type ExecutionContext } from '@nestjs/common';
import type { Request } from 'express';

/** The device behind a valid Bearer token, set on the request by DeviceAuthGuard. */
export interface AuthenticatedDevice {
  id: string;
  ownerId: string;
  name: string | null;
  appVersion: string | null;
  os: string | null;
  gameRunning: boolean;
  lastSeenAt: Date | null;
}

export type DeviceRequest = Request & { device?: AuthenticatedDevice };

/** Handler parameter: the authenticated device. Only valid on routes guarded by DeviceAuthGuard. */
export const CurrentDevice = createParamDecorator((_data: unknown, ctx: ExecutionContext): AuthenticatedDevice => {
  const device = ctx.switchToHttp().getRequest<DeviceRequest>().device;
  if (!device) throw new Error('@CurrentDevice() needs DeviceAuthGuard on the route');
  return device;
});
