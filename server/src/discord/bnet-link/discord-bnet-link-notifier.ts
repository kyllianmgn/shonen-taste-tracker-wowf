import { Inject, Injectable, Logger } from '@nestjs/common';
import { Routes, type Client } from 'discord.js';
import type { BnetLinkNotifier, DeliveryResult, LinkRecipient } from '../../bnet/oauth/link-notifier';
import type { LinkOutcome, TransferNotice } from '../../bnet/oauth/link-outcome';
import type { AppConfig } from '../../common/config/config';
import { APP_CONFIG } from '../../common/config/config.constants';
import { DISCORD_CLIENT } from '../client/discord-client.service';
import { renderExpiredDm, renderLinkOutcome, renderTransferNotice } from './bnet-link-replies';

/**
 * Discord side of /lier battlenet, over the REST API: the interaction webhook for the ephemeral
 * reply (no bot auth needed), a DM channel as fallback, the logs channels for admin notices.
 * Never throws and never logs the interaction token.
 */
@Injectable()
export class DiscordBnetLinkNotifier implements BnetLinkNotifier {
  private readonly logger = new Logger(DiscordBnetLinkNotifier.name);

  constructor(
    @Inject(DISCORD_CLIENT) private readonly client: Client,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
  ) {}

  async deliver(to: LinkRecipient, outcome: LinkOutcome): Promise<DeliveryResult> {
    if (to.interactionValid) {
      try {
        await this.client.rest.patch(Routes.webhookMessage(this.config.discordClientId, to.interactionToken, '@original'), {
          body: renderLinkOutcome(outcome),
          auth: false,
        });
        return 'edited';
      } catch (error) {
        // Most often the 15 minutes are over (50027 Invalid Webhook Token): fall back to a DM.
        this.logger.warn(`Could not edit the /lier battlenet reply of ${to.userId}: ${describe(error)}`);
      }
    }

    try {
      const channel = (await this.client.rest.post(Routes.userChannels(), { body: { recipient_id: to.userId } })) as { id: string };
      await this.client.rest.post(Routes.channelMessages(channel.id), { body: renderExpiredDm(outcome) });
      return 'direct_message';
    } catch (error) {
      this.logger.warn(`Could not DM the Battle.net link result to ${to.userId}: ${describe(error)}`);
      return 'undelivered';
    }
  }

  async notifyTransfer(logsChannelIds: readonly string[], notice: TransferNotice): Promise<void> {
    const body = { content: renderTransferNotice(notice), allowed_mentions: { parse: [] } };
    for (const channelId of logsChannelIds) {
      try {
        await this.client.rest.post(Routes.channelMessages(channelId), { body });
      } catch (error) {
        this.logger.warn(`Could not post the transfer notice in ${channelId}: ${describe(error)}`);
      }
    }
  }
}

/** Code and message only: discord.js errors can carry the request URL, which holds the token. */
function describe(error: unknown): string {
  if (!(error instanceof Error)) return 'unknown error';
  const code = (error as { code?: unknown }).code;
  return typeof code === 'number' || typeof code === 'string' ? `${code} ${error.message}` : error.message;
}
