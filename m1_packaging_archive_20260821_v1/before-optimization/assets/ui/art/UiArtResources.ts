import { SpriteFrame, Texture2D, resources } from 'cc';

export type UiArtKey =
    | 'homeStartButton'
    | 'homePrimaryButton'
    | 'homeRoomBackground'
    | 'homeBoardFrame'
    | 'homeLevelPlaque'
    | 'homeBeadJar'
    | 'homeDailyPanel'
    | 'homeMoreBadge'
    | 'homeCollectionBadge'
    | 'homeProfileAvatar'
    | 'homeResourceHud'
    | 'toolColorMagnet'
    | 'toolTrayBrush'
    | 'toolTimeFreeze';

const TEXTURE_PATHS: Readonly<Record<UiArtKey, string>> = Object.freeze({
    homeStartButton: 'ui/home/home_start_button/texture',
    homePrimaryButton: 'ui/home/home_primary_button/texture',
    homeRoomBackground: 'ui/home/home_room_background/texture',
    homeBoardFrame: 'ui/home/home_board_frame/texture',
    homeLevelPlaque: 'ui/home/home_level_plaque/texture',
    homeBeadJar: 'ui/home/home_bead_jar/texture',
    homeDailyPanel: 'ui/home/home_daily_panel/texture',
    homeMoreBadge: 'ui/home/home_more_badge_v2/texture',
    homeCollectionBadge: 'ui/home/home_collection_badge_v2/texture',
    homeProfileAvatar: 'ui/home/home_profile_avatar/texture',
    homeResourceHud: 'ui/home/home_resource_hud/texture',
    toolColorMagnet: 'ui/tools/tool_color_magnet/texture',
    toolTrayBrush: 'ui/tools/tool_tray_brush/texture',
    toolTimeFreeze: 'ui/tools/tool_time_freeze/texture',
});

/**
 * Optional authored UI art used on top of the code-driven layout.
 *
 * These files are decorative rather than a gameplay dependency. A missing or
 * malformed PNG must therefore preserve the
 * existing Graphics implementation instead of failing the entire game boot.
 */
export class UiArtResources {
    private static readonly frames = new Map<UiArtKey, SpriteFrame>();
    private static loading: Promise<void> | null = null;
    private static loaded = false;

    public static preload(): Promise<void> {
        if (this.loaded) return Promise.resolve();
        if (this.loading) return this.loading;

        const requests = (Object.keys(TEXTURE_PATHS) as UiArtKey[]).map(async (key) => {
            const path = TEXTURE_PATHS[key];
            try {
                const texture = await this.loadTexture(path);
                const frame = new SpriteFrame();
                frame.name = `ui_art_${key}`;
                frame.texture = texture;
                frame.packable = false;
                this.frames.set(key, frame);
            } catch (error) {
                console.warn(`[UiArtResources] Optional texture unavailable: ${path}. Graphics fallback will be used.`, error);
            }
        });

        this.loading = Promise.all(requests).then(() => {
            this.loaded = true;
            this.loading = null;
        });
        return this.loading;
    }

    public static getHomeStartButton(): SpriteFrame | null {
        return this.frames.get('homeStartButton') ?? null;
    }

    public static getHomePrimaryButton(): SpriteFrame | null {
        return this.frames.get('homePrimaryButton') ?? null;
    }

    public static getHomeRoomBackground(): SpriteFrame | null {
        return this.frames.get('homeRoomBackground') ?? null;
    }

    public static getHomeBoardFrame(): SpriteFrame | null {
        return this.frames.get('homeBoardFrame') ?? null;
    }

    public static getHomeLevelPlaque(): SpriteFrame | null {
        return this.frames.get('homeLevelPlaque') ?? null;
    }

    public static getHomeBeadJar(): SpriteFrame | null {
        return this.frames.get('homeBeadJar') ?? null;
    }

    public static getHomeDailyPanel(): SpriteFrame | null {
        return this.frames.get('homeDailyPanel') ?? null;
    }

    public static getHomeMoreBadge(): SpriteFrame | null {
        return this.frames.get('homeMoreBadge') ?? null;
    }

    public static getHomeCollectionBadge(): SpriteFrame | null {
        return this.frames.get('homeCollectionBadge') ?? null;
    }

    public static getHomeProfileAvatar(): SpriteFrame | null {
        return this.frames.get('homeProfileAvatar') ?? null;
    }

    public static getHomeResourceHud(): SpriteFrame | null {
        return this.frames.get('homeResourceHud') ?? null;
    }

    public static getToolColorMagnet(): SpriteFrame | null {
        return this.frames.get('toolColorMagnet') ?? null;
    }

    public static getToolTrayBrush(): SpriteFrame | null {
        return this.frames.get('toolTrayBrush') ?? null;
    }

    public static getToolTimeFreeze(): SpriteFrame | null {
        return this.frames.get('toolTimeFreeze') ?? null;
    }

    private static loadTexture(path: string): Promise<Texture2D> {
        return new Promise((resolve, reject) => {
            resources.load(path, Texture2D, (error, texture) => {
                if (error || !texture) {
                    reject(error ?? new Error(`[UiArtResources] Missing texture ${path}.`));
                    return;
                }
                resolve(texture);
            });
        });
    }
}
