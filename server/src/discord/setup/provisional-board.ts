import {
  COMPONENT_TYPE_CONTAINER,
  COMPONENT_TYPE_TEXT_DISPLAY,
  IS_COMPONENTS_V2,
  type BoardMessagePayload,
} from '../render/board';

/** Placeholder posted by /setup; the board publisher (S-12) edits it into the real board. */
export function provisionalBoard(): BoardMessagePayload {
  return {
    flags: IS_COMPONENTS_V2,
    components: [
      {
        type: COMPONENT_TYPE_CONTAINER,
        components: [
          {
            type: COMPONENT_TYPE_TEXT_DISPLAY,
            content: [
              '## WoW: Forever',
              'Tableau en préparation.',
              'Les joueurs apparaîtront ici dès qu’ils utiliseront `/perso ajouter` ou `/lier`.',
            ].join('\n'),
          },
        ],
      },
    ],
    allowed_mentions: { parse: [] },
  };
}
