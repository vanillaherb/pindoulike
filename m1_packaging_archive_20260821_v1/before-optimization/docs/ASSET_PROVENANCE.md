# Asset Provenance

This project uses a clean-room presentation pipeline. Gameplay behavior may be compared with genre conventions, but no bitmap, atlas frame, crop, trace, native bundle file, or runtime resource from the recovered application may ship with this project.

## Generated Original UI Assets

The following transparent PNG assets were generated specifically for this project through the OpenAI image-generation workflow. Their prompt summaries and integration status are recorded in `assets/ui/home/imagegen-manifest.json`.

| Runtime asset | Classification | Runtime role |
| --- | --- | --- |
| `assets/resources/ui/home/home_album_shell.png` | generated-original | Decorative shell around the live level preview |
| `assets/resources/ui/home/home_start_button.png` | generated-original | Blank visual skin below live button labels and input |
| `assets/resources/ui/tools/tool_color_magnet.png` | generated-original | Color-magnet tool icon |
| `assets/resources/ui/tools/tool_tray_brush.png` | generated-original | Tray-brush tool icon |
| `assets/resources/ui/tools/tool_time_freeze.png` | generated-original | Time-freeze tool icon |

These files are not crops from a screenshot and do not require a reference image or external bundle at runtime. Cocos nodes, labels, hit targets, save state, stamina values and gameplay callbacks remain live code.

## User-Supplied Authorized Home Skins

On 2026-08-21 the user confirmed that the source images supplied in `F:\desktop\gamedevelop\pindou素材` are owned by them or authorized for this project. The source folder is an authoring input only and is not read at runtime. `tools/prepare-user-home-art.py` produces the normalized files below, and `tools/stage-home-art.mjs` validates and copies them into the Cocos resource tree.

| Runtime asset | Authorized source file | Derivation | Runtime role |
| --- | --- | --- | --- |
| `assets/resources/ui/home/home_room_background.png` | `8d6c5161-9708-48dd-9f70-f61b2023d05a.png` | Full-image Lanczos resize to 750×1334 RGB | Decorative room background below all live UI |
| `assets/resources/ui/home/home_board_frame.png` | `889b7590-486b-47f9-a7cb-2457c34ad8a6.png` | Full-image Lanczos resize to 1048×1042 RGBA | Board frame below the live artwork preview and input |
| `assets/resources/ui/home/home_level_plaque.png` | `6c20167a-db5b-4624-a994-015789726dd3.png` | Full-image Lanczos resize to 782×408 RGBA | Plaque below live level, title and progress labels |
| `assets/resources/ui/home/home_bead_jar.png` | `f15f3502-4817-46fa-868a-3d59381c8394.png` | Full-image Lanczos resize to 290×512 RGBA | Jar skin; bubble text and interaction remain live |
| `assets/resources/ui/home/home_more_badge_v2.png` | `4921cbb6-2d97-4d85-a511-1f3a459e5bec.png` | Full-image Lanczos resize to 280×280 RGBA | Decorative Sprite on the real “more” touch node |
| `assets/resources/ui/home/home_collection_badge_v2.png` | `203e6eea-f961-4870-8fd9-ee01ce0e7591.png` | Full-image Lanczos resize to 280×280 RGBA | Decorative Sprite with live label, progress and touch node |
| `assets/resources/ui/home/home_resource_hud.png` | `50576edc-484a-40a5-bd47-2afbcdef5a9d.png` | Four alpha-separated components cropped with padding, fitted and recomposed to 720×176 RGBA | Skin behind live settings, profile, stamina and coin nodes |

The exact source SHA-256 values, Cocos UUIDs and per-file normalization details are recorded in `assets/ui/home/imagegen-manifest.json`. None of these skins replaces gameplay state, text, progress, input targets or callbacks; every slot retains a code-authored Graphics fallback.

## Procedural Original Art

The Board plate, target recesses, movable and matched beads, selection feedback, flying beads, Tray slots and match burst are rendered from project-owned Cocos `Graphics` code and configured gameplay colors. They do not load bitmap atlases or extracted sprite frames.

The six color ids in `ColorPalette.json` are a gameplay readability contract. Material highlights, shadows and depth colors are derived locally rather than sampled from an external atlas.

## Forbidden Binary Fingerprints

The following legacy binary fingerprints are denied in `assets`, `build` and `library`, regardless of filename or extension:

| SHA-256 | Legacy content | Byte size |
| --- | --- | ---: |
| `3563e484352559b9f3341311372719ca46728bb2e8a595df1d83f087070d4c49` | extracted bead atlas | 112019 |
| `ff926f9f85fe9cb32a1cd64220510888744e5544aa017ce89923d1d099438b1c` | extracted UI-effects atlas | 157460 |
| `df3b1b667ab714456095229f8b8220d604cbc985f6b2aac4e84e8f41accd0ba8` | extracted match-sparkle atlas | 7087 |

The same gate rejects exact copies of every JavaScript file outside the recovered package's explicitly separated `cocos-js` engine runtime and web loader allowlist, even if a file is renamed or moved:

| SHA-256 | Denied package content | Byte size |
| --- | --- | ---: |
| `b132aa79de0ba89cec02f0ef6e038e3577c26d1008ded6c5fb1df0a80e16ae5b` | game-script bundle | 271306 |
| `951c55753aebbb1136b29c284c6211dfb5181b8f84f9510f3c587a1db81ab208` | main-scene bundle | 13512 |
| `85b2b51f9358906113a4609dd05b9644d0f689f6f3b61ce3e744ec30ece15a45` | support-library bundle | 83215 |
| `68bdd884590457f9f06e7b1537d9928ed55a8a54e572b6777c1c771600b6f3dc` | packaged SDK bundle | 82213 |
| `bf3178ff2152c2084599bc2b4b5f77d701a2fb040e2dae3a95710df028066310` | bridge bundle | 43443 |
| `3100ec8aa55608492a85c8d1adcb702b1b30d19bae579dc6e45eb06888d4928b` | internal support bundle | 41280 |
| `088c09ed34c70323e1cf25ae1e2d7ea69a4dbeb67abe5c3e5cf0328fce6c4bbe` | application bootstrap | 3308 |
| `36b53e5418c8247ad54d98217dba6395722df01d193443a423ba6ca27a462a61` | component bundle entry | 587 |
| `c65bf38fb07583580ed708d03d1729f8ea7b9c1234d2ebbc17c7572184b27e90` | game bundle entry | 590 |
| `6b8c8d345bb3bd80c059ec939e3dd33b0ce3d13bb5d7351a1d48975c675feeb1` | home bundle entry | 590 |
| `0ffb4838a1a76384eb89f71ea45479e573411270f91c48ce6c0843c8603c13d0` | i18n bundle entry | 590 |
| `25c35b01b341e1c4ab6edf6c1aca88e6c885277d664f410b0e8e11c7e8795e04` | package entry | 824 |
| `7e8d47d69e346b41e14faba426cd534446f610d29a04e74bbd9be271a4434cc8` | local adapter | 2031 |
| `6a7f00c8b09148f908e0faf30143f369de8d3c7b847da532a0cf0e239621a671` | chunk bundle | 12671 |

The eight matching bundle manifests are also denied:

| SHA-256 | Denied bundle manifest | Byte size |
| --- | --- | ---: |
| `d55ed4c85bbb015424d5744f1ea345d35501bd409c029c0e414218bcaa4bc3e2` | bridge | 2154 |
| `1442c9fcaa3ea30abb70c990792a83b2e8ec08b703448d1bf839d4d54bc7db53` | component | 6595 |
| `dcfded3a24cff4e835f5631f8a215dd31df748e7b4e3da88ed74dda419822ea5` | game | 74623 |
| `e06334a033672f1172e7f35e59b1095affbfd828bd1aad1f026875fadf873838` | home | 39664 |
| `7a63ccdc72d642d69250365bc76390bb3a7bc24b60b6f3b841197dcbf0ffed08` | i18n | 327 |
| `0838eddd930f25adfa7e49a05d17a9a8dd4c31631d5a63358de213eece1965d5` | support library | 261 |
| `6c0843577a5c7c1927e02c332a0850bb8631149a6a3a7dd2654b13ccbc7bb32a` | main | 841 |
| `59730cd6cd90d2b6fb7c6ae35e73458223c2ea4acc53452a026ab9fb423e44fe` | game scripts | 264 |

`tests/asset-originality.spec.ts` and `tools/validate-m1-9b.mjs` enforce these fingerprints and reject legacy resource paths, atlas classes and external recovered-site dependencies. A release build must be regenerated after any asset removal so stale native files cannot survive in the output directory.

## Engine Vendor Allowlist

A full non-empty-file comparison was performed on 2026-08-17 after rebuilding this project with the locally installed Cocos Creator 3.8.8. Nine generated project files share bytes with the comparison package. They fall into only five engine-owned or schema-only fingerprints:

| SHA-256 | Count | Classification | Evidence |
| --- | ---: | --- | --- |
| `f1e4ced3322168d6b9915e782e4c1cf1055d75f66f2b38e7fcd60f48cf89082b` | 1 | Cocos web polyfills | Locally rebuilt `build/web-mobile/src/polyfills.bundle.js`; contains no project gameplay code |
| `90f192f3b04f7fcb5bba9c15745cdd1a798d9b855f752c5ee7e48bb526dd543d` | 1 | SystemJS loader | Locally rebuilt `build/web-mobile/src/system.bundle.js`; contains no project gameplay code |
| `60928632edcd22b5694a8c22de01de0d2cbb6f374103242a99a4394cc767f44d` | 5 | Cocos import metadata | The generic 72-byte `cc.ImageAsset` descriptor generated for this project's five original UI PNGs; it contains no pixel payload |
| `cbca4eb7ae6158b9d65fc6495828b6c3a540085f8c704b1780f0690f0f0eba71` | 1 | Cocos editor default UI | Creator 3.8.8 `default_ui/atom.png`, UUID `24c419ea-63a8-4ea1-a9d0-7fc469489bbc`, generated into `library` |
| `83c9b8ce1937570a40bcedde29457a4ab7865ca1db23a46d2d68e6b1949f3c28` | 1 | Cocos editor default UI | Creator 3.8.8 `default_ui/default_sprite_splash.png`, UUID `7d8f9b89-4fd1-4c9f-a3ab-38ec7cded7ca`, generated into `library` |

This allowlist is limited to the exact fingerprints and roles above. It does not permit any game script, scene logic, bitmap atlas, animation data, or other business asset from the comparison package. The comparison directory is an audit input only; it is not read by runtime code, build scripts or tests.

Engine or toolchain provenance does not make these files public domain. Distribution must retain and follow the applicable Cocos Creator/Cocos Engine, SystemJS, core-js and other bundled third-party license notices.

## Review Rule

Every new shipped bitmap must record its origin, generation or authoring method, runtime purpose, and whether it was cropped or derived from a third-party reference. Assets without adequate provenance stay out of release builds until reviewed.
