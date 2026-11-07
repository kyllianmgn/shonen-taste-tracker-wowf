import { Injectable } from '@nestjs/common';

/**
 * Whether public profile readings run (docs/02 « Fiche publique »). Off at startup; the daily
 * probe turns it on once the profile answers 200 and BNET_PUBLIC_PROFILE is true. Kept in memory:
 * the probe runs again at every start.
 */
@Injectable()
export class PublicProfileGate {
  private on = false;

  get enabled(): boolean {
    return this.on;
  }

  enable(): void {
    this.on = true;
  }
}
