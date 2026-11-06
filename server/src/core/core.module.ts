import { Module } from '@nestjs/common';
import { CharacterService } from './characters/character.service';

/** Discord guilds, players, characters, membership (docs/02 « Modules »). */
@Module({
  providers: [CharacterService],
  exports: [CharacterService],
})
export class CoreModule {}
