# Logo

`nightshade-logo.png` is the master image (1024 x 1024): a crescent moon holding a single berry, amber on a dark tile. The crescent is the night, the dot is the nightshade berry, and one dot for one site.

It was generated with Google's Nano Banana image model and is released under the same MIT licence as the rest of the project.

Every other icon is derived from it by `scripts/make-icons.mjs` (run `npm run icons`):

| Output | Use |
| --- | --- |
| `extension/icons/on-*.png` | Toolbar icon when Nightshade is recolouring the page (amber) |
| `extension/icons/native-*.png` | The site's own dark theme is kept, only boosts run (soft blue) |
| `extension/icons/off-*.png` | Nightshade is off or paused on this site (grey) |
| `docs/images/logo.png` | README header |

The script reads the amber mark out of the master, redraws the tile with exact corners, enlarges the mark for the 16, 32 and 48 px sizes, and recolours it per state. To change the logo, replace the master (keep it a flat amber mark on a dark background) and run the script again. To change a state colour, edit `STATES` in the script.
