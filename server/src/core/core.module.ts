import { Module } from '@nestjs/common';
import { CharacterService } from './characters/character.service';
import { PlayerAccountService } from './players/player-account.service';
import { PlayerModeService } from './players/player-mode.service';

/** Discord guilds, players, characters, membership (docs/02 « Modules »). */
@Module({
  providers: [CharacterService, PlayerModeService, PlayerAccountService],
  exports: [CharacterService, PlayerModeService, PlayerAccountService],
})
export class CoreModule {}
