import { Inject, Injectable, Logger } from '@nestjs/common';
import type { AppConfig } from '../../common/config/config';
import { APP_CONFIG } from '../../common/config/config.constants';
import { BnetClient } from '../client';
import { PUBLIC_POLL_STORE, type PublicPollStore } from './public-poll.store';
import { PublicProfileGate } from './public-profile-gate';

export type ProbeOutcome = 'open' | 'closed' | 'no_candidate' | 'error';

/**
 * Daily test of the public profile (docs/02 « Fiche publique »): GET the profile of a verified
 * character of level 10+ and log the answer. A 200 enables the public readings when
 * BNET_PUBLIC_PROFILE is true. The gate is never turned off again: a character whose profile is
 * gone simply answers 404 to its own readings.
 */
@Injectable()
export class PublicProfileProbe {
  private readonly logger = new Logger(PublicProfileProbe.name);

  constructor(
    @Inject(PUBLIC_POLL_STORE) private readonly store: PublicPollStore,
    private readonly bnet: BnetClient,
    private readonly gate: PublicProfileGate,
    @Inject(APP_CONFIG) private readonly config: Pick<AppConfig, 'bnetPublicProfile'>,
  ) {}

  async run(): Promise<ProbeOutcome> {
    const candidate = await this.store.probeCandidate();
    if (!candidate) {
      this.logger.log('Public profile test skipped: no Battle.net-verified character of level 10+');
      return 'no_candidate';
    }

    let status: number;
    try {
      // No If-Modified-Since: a 304 would not tell whether the route is open.
      status = (await this.bnet.getPublicCharacter(candidate.region, candidate.firstName, candidate.surname)).status;
    } catch (error) {
      this.logger.warn(`Public profile test failed (${candidate.region}): ${error instanceof Error ? error.message : String(error)}`);
      return 'error';
    }

    if (status !== 200) {
      this.logger.log(`Public profile test (${candidate.region}): HTTP ${status}, the public profile is still closed`);
      return 'closed';
    }
    if (!this.config.bnetPublicProfile) {
      this.logger.log(`Public profile test (${candidate.region}): HTTP 200, set BNET_PUBLIC_PROFILE=true to enable the readings`);
    } else if (!this.gate.enabled) {
      this.gate.enable();
      this.logger.log(`Public profile test (${candidate.region}): HTTP 200, public readings enabled`);
    } else {
      this.logger.log(`Public profile test (${candidate.region}): HTTP 200`);
    }
    return 'open';
  }
}
