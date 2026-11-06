import { Module } from '@nestjs/common';
import { CharacterService } from './characters/character.service';
import { PlayerModeService } from './players/player-mode.service';

/** Discord guilds, players, characters, membership (docs/02 « Modules »). */
@Module({
  providers: [CharacterService, PlayerModeService],
  exports: [CharacterService, PlayerModeService],
})
export class CoreModule {}
