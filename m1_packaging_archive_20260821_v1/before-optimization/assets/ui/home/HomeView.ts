import {
    Camera,
    Canvas,
    Color,
    EventTouch,
    Graphics,
    HorizontalTextAlignment,
    Label,
    LabelOutline,
    Layers,
    Node,
    ResolutionPolicy,
    Sprite,
    SpriteFrame,
    UITransform,
    Vec3,
    director,
    view,
} from 'cc';
import { PREVIEW } from 'cc/env';
import type { SaveData } from '../../core/save/SaveManager';
import { BeadVisualRenderer, type BeadVisualRenderStyle } from '../../game/board/BeadVisualRenderer';
import type { CommonConfig } from '../../game/level/LevelTypes';
import { StaminaService } from '../../game/stamina/StaminaService';
import { GameplayUiTheme, type GameplayUiColor } from '../theme/GameplayUiTheme';
import { UiArtResources } from '../art/UiArtResources';
import { HomeLayoutDebugView, type HomeLayoutDebugTarget } from './HomeLayoutDebugView';

export interface HomeLevelPreview {
    readonly grid: ReadonlyArray<ReadonlyArray<number>>;
    readonly colorHex: (colorId: number) => string;
}

export interface HomeViewHandlers {
    /** “开始游戏 / 继续拼豆” pressed — enter the explicitly selected unlocked level. */
    readonly onStart: (levelId: number) => void;
    /** Any button press, used for the BUTTON_CLICK sound cue. Optional. */
    readonly onButtonClick?: () => void;
    /** Settings button pressed. Optional; defaults to a lightweight toast. */
    readonly onSettings?: () => void;
    /** Resolve the display title for a mainline level (map.title). */
    readonly levelTitle: (levelId: number) => string;
    /** Optional real target-grid preview for the current level. */
    readonly levelPreview?: (levelId: number) => HomeLevelPreview;
}

type HomeSideFeature = 'more' | 'skin' | 'collection';

interface BoundButton {
    readonly node: Node;
    readonly onStart: (event: EventTouch) => void;
    readonly onEnd: (event: EventTouch) => void;
    readonly onCancel: (event: EventTouch) => void;
    readonly onMouseUp: () => void;
    readonly onEnter: () => void;
    readonly onLeave: () => void;
}

interface HomeLevelButton {
    readonly levelId: number;
    readonly graphics: Graphics;
    readonly label: Label;
}

const COLLECTION_UNLOCK_LEVEL = 19;
const MAINLINE_LEVEL_COUNT = 30;
const THEME = GameplayUiTheme.colors;
// These are project-authored skins. They are optional so a missing PNG never
// prevents the functional Graphics fallback from rendering the home screen.
const USE_OPTIONAL_HOME_SKINS = true;

const themeColor = (value: GameplayUiColor, alpha: number = value.a): Color =>
    new Color(value.r, value.g, value.b, alpha);

const rgba = (r: number, g: number, b: number, a: number = 255): Color =>
    new Color(r, g, b, a);

const withAlpha = (value: Color, alpha: number): Color =>
    new Color(value.r, value.g, value.b, alpha);

const darken = (value: Color, amount: number, alpha: number = value.a): Color =>
    new Color(
        Math.max(0, Math.round(value.r * (1 - amount))),
        Math.max(0, Math.round(value.g * (1 - amount))),
        Math.max(0, Math.round(value.b * (1 - amount))),
        alpha,
    );

const mixColor = (a: Color, b: Color, amount: number, alpha: number = 255): Color => {
    const t = Math.max(0, Math.min(1, amount));
    return new Color(
        Math.round(a.r + (b.r - a.r) * t),
        Math.round(a.g + (b.g - a.g) * t),
        Math.round(a.b + (b.b - a.b) * t),
        alpha,
    );
};

const formatCount = (value: number): string => {
    const sign = value < 0 ? '-' : '';
    const raw = Math.abs(Math.trunc(value)).toString();
    return `${sign}${raw.replace(/\B(?=(\d{3})+(?!\d))/g, ',')}`;
};

/**
 * Compact portrait home page based on the approved single-focus hierarchy:
 * compact resources -> current level -> album preview -> daily card -> primary CTA.
 *
 * The reference screenshot is never loaded at runtime. The imagegen manifest beside this
 * file records the optional generated skins; until those are available, the same component
 * layers are rendered natively so controls and live targetGrid data remain fully functional.
 */
export class HomeView {
    private canvasRoot: Node | null = null;
    private root: Node | null = null;
    private viewWidth = 750;
    private viewHeight = 1334;

    private coinLabel: Label | null = null;
    private staminaLabel: Label | null = null;
    private staminaStatusLabel: Label | null = null;
    private staminaCostLabel: Label | null = null;
    private levelPillLabel: Label | null = null;
    private levelTitleLabel: Label | null = null;
    private levelProgressLabel: Label | null = null;
    private dailyBadgeLabel: Label | null = null;
    private dailyProgressLabel: Label | null = null;
    private collectionProgressLabel: Label | null = null;
    private previewGraphics: Graphics | null = null;
    private referenceRingPreview = false;
    private referenceHomeLayout = false;
    private previewLevelId = -1;
    private selectedLevelId: number;
    private lastTouchEndAt = -Infinity;

    private levelSelectOverlay: Node | null = null;
    private levelSelectProgressLabel: Label | null = null;
    private levelSelectHintLabel: Label | null = null;
    private readonly levelButtons: HomeLevelButton[] = [];

    private toastNode: Node | null = null;
    private toastLabel: Label | null = null;
    private toastTimer: ReturnType<typeof globalThis.setTimeout> | null = null;

    private tickTimer: ReturnType<typeof globalThis.setInterval> | null = null;
    private readonly boundButtons: BoundButton[] = [];
    private layoutDebugView: HomeLayoutDebugView | null = null;
    private destroyed = false;

    constructor(
        private readonly common: Readonly<CommonConfig>,
        private readonly saveData: SaveData,
        private readonly stamina: StaminaService,
        private readonly handlers: Readonly<HomeViewHandlers>,
    ) {
        this.selectedLevelId = saveData.level;
    }

    public show(): void {
        if (this.destroyed) return;
        if (this.canvasRoot?.isValid) {
            this.refresh();
            return;
        }
        this.buildCanvas();
        this.build();
        this.refresh();
        if (this.tickTimer !== null) globalThis.clearInterval(this.tickTimer);
        this.tickTimer = globalThis.setInterval(() => this.refresh(), 1000);
    }

    /** Host used by full-screen home modals so they share this Canvas and portrait dimensions. */
    public getOverlayHost(): Readonly<{ parent: Node; width: number; height: number }> {
        if (!this.root) throw new Error('[HomeView] Home root is not initialized.');
        return { parent: this.root, width: this.viewWidth, height: this.viewHeight };
    }

    /** Refresh dynamic values after returning from a level or while stamina recovers. */
    public refresh(): void {
        if (this.destroyed) return;
        if (this.coinLabel) this.coinLabel.string = formatCount(this.saveData.coin);

        const highestUnlockedLevel = Math.max(1, Math.min(MAINLINE_LEVEL_COUNT, this.saveData.level));
        if (this.selectedLevelId < 1 || this.selectedLevelId > highestUnlockedLevel) {
            this.selectedLevelId = highestUnlockedLevel;
        }
        const levelId = this.selectedLevelId;
        if (this.levelPillLabel) this.levelPillLabel.string = `第${levelId}关`;
        if (this.levelTitleLabel) {
            try {
                this.levelTitleLabel.string = this.handlers.levelTitle(levelId);
            } catch {
                this.levelTitleLabel.string = '甜甜草莓蛋糕';
            }
        }
        if (this.levelProgressLabel) this.levelProgressLabel.string = `图鉴进度  ${levelId} / 1000`;
        if (this.collectionProgressLabel) this.collectionProgressLabel.string = `${highestUnlockedLevel} / 1000`;

        const dailyUnlocked = highestUnlockedLevel >= this.common.dailyUnlockLevel;
        if (this.dailyBadgeLabel) {
            this.dailyBadgeLabel.string = dailyUnlocked
                ? '今日可挑战'
                : `第${this.common.dailyUnlockLevel}关解锁`;
        }

        if (this.previewLevelId !== levelId) {
            this.previewLevelId = levelId;
            this.drawArtworkPreview(levelId);
        }
        if (this.levelSelectOverlay?.active) this.refreshLevelOptions();
        this.refreshStamina();
    }

    public dispose(): void {
        if (this.destroyed) return;
        this.destroyed = true;
        if (this.tickTimer !== null) globalThis.clearInterval(this.tickTimer);
        this.tickTimer = null;
        if (this.toastTimer !== null) globalThis.clearTimeout(this.toastTimer);
        this.toastTimer = null;
        this.layoutDebugView?.dispose();
        this.layoutDebugView = null;
        for (const binding of this.boundButtons) {
            const { node, onStart, onEnd, onCancel, onMouseUp, onEnter, onLeave } = binding;
            if (!node.isValid) continue;
            node.off(Node.EventType.TOUCH_START, onStart, this);
            node.off(Node.EventType.TOUCH_END, onEnd, this);
            node.off(Node.EventType.TOUCH_CANCEL, onCancel, this);
            node.off(Node.EventType.MOUSE_UP, onMouseUp, this);
            node.off(Node.EventType.MOUSE_ENTER, onEnter, this);
            node.off(Node.EventType.MOUSE_LEAVE, onLeave, this);
        }
        this.boundButtons.length = 0;
        if (this.canvasRoot?.isValid) this.canvasRoot.destroy();
        this.canvasRoot = null;
        this.root = null;
        this.previewGraphics = null;
        this.referenceRingPreview = false;
        this.referenceHomeLayout = false;
        this.levelTitleLabel = null;
        this.levelProgressLabel = null;
        this.dailyProgressLabel = null;
        this.collectionProgressLabel = null;
        this.levelSelectOverlay = null;
        this.levelSelectProgressLabel = null;
        this.levelSelectHintLabel = null;
        this.levelButtons.length = 0;
        this.toastNode = null;
        this.toastLabel = null;
    }

    /** Player-facing feedback that keeps the home page alive. */
    public showNotice(message: string): void {
        if (this.destroyed) return;
        this.showToast(message);
    }

    private refreshStamina(): void {
        if (!this.staminaLabel || !this.staminaStatusLabel || !this.staminaCostLabel) return;
        const now = Date.now();
        const current = this.stamina.getCurrentStamina(this.saveData, now);
        const max = this.stamina.maxStamina;
        const levelCost = this.stamina.getLevelCost(this.selectedLevelId);
        this.staminaLabel.string = `${current}`;
        if (this.referenceHomeLayout) {
            this.staminaCostLabel.string = levelCost === 0
                ? '免费'
                : current >= levelCost ? `消耗 ${levelCost} 点体力` : '体力不足';
        } else {
            this.staminaCostLabel.string = levelCost === 0
                ? '免费'
                : current >= levelCost ? `- ${levelCost}` : '体力不足';
        }
        if (current >= max) {
            this.staminaStatusLabel.string = '已满';
            return;
        }
        const totalSec = Math.max(0, Math.ceil(this.stamina.msUntilNextRecover(this.saveData, now) / 1000));
        const mm = Math.floor(totalSec / 60);
        const ss = totalSec % 60;
        this.staminaStatusLabel.string = `${mm}:${ss < 10 ? `0${ss}` : ss}`;
    }

    private buildCanvas(): void {
        const cfg = this.common.m0;
        view.setDesignResolutionSize(cfg.designWidth, cfg.designHeight, ResolutionPolicy.FIXED_WIDTH);
        const frame = view.getFrameSize();
        this.viewWidth = cfg.designWidth;
        const aspect = PREVIEW || frame.width <= 0 ? cfg.designHeight / cfg.designWidth : frame.height / frame.width;
        this.viewHeight = cfg.designWidth * aspect;

        const scene = director.getScene();
        if (!scene) throw new Error('[HomeView] No active scene.');
        const canvasNode = new Node('HomeCanvas');
        canvasNode.layer = Layers.Enum.UI_2D;
        scene.addChild(canvasNode);
        canvasNode.addComponent(UITransform).setContentSize(this.viewWidth, this.viewHeight);

        const cameraNode = new Node('HomeCamera');
        cameraNode.layer = Layers.Enum.UI_2D;
        canvasNode.addChild(cameraNode);
        cameraNode.setPosition(new Vec3(0, 0, 1000));
        const camera = cameraNode.addComponent(Camera);
        camera.projection = Camera.ProjectionType.ORTHO;
        camera.orthoHeight = this.viewHeight / 2;
        camera.visibility = Layers.Enum.UI_2D;
        camera.clearColor = themeColor(THEME.background);

        const canvas = canvasNode.addComponent(Canvas);
        canvas.cameraComponent = camera;
        this.canvasRoot = canvasNode;

        const root = new Node('HomeRoot');
        root.layer = Layers.Enum.UI_2D;
        canvasNode.addChild(root);
        root.addComponent(UITransform).setContentSize(this.viewWidth, this.viewHeight);
        this.root = root;
    }

    private build(): void {
        if (!this.root) return;
        // The reference layout is kept in its own builder so the older measured
        // builders below remain available to formal tests and downstream scenes.
        this.buildReferenceLayout();
    }

    /**
     * Native Cocos recreation of the supplied portrait home screen. Optional
     * GPT-generated skins can replace individual shells, while live Labels and
     * hit nodes keep the layout interactive at every device aspect ratio. The
     * reference screenshot is never loaded as a runtime texture.
     */
    private buildReferenceLayout(): void {
        if (!this.root) return;
        this.referenceHomeLayout = true;
        this.drawReferenceRoom();
        this.buildReferenceTopHud();
        this.buildReferenceBoard();
        // Keep the plaque above the board if their measured bounds ever touch.
        // This also makes the plaque the intended hit target in the overlap band.
        this.buildReferenceLevelCard();
        this.buildReferenceJar();
        this.buildReferenceDailyCard();
        this.buildReferenceBottomActions();
        this.buildToast();
        this.buildLevelSelectOverlay();
        this.buildPreviewLayoutDebugger();
    }

    /**
     * Home UI is intentionally runtime-authored, so it has no editable nodes in
     * M0.scene. Creator Preview gets a small in-game layout inspector instead;
     * release builds never create it and therefore keep the normal touch surface.
     */
    private buildPreviewLayoutDebugger(): void {
        if (!PREVIEW || !this.root) return;

        const find = (name: string): Node | null => this.root?.getChildByName(name) ?? null;
        const findMany = (...names: string[]): Node[] => names
            .map((name) => find(name))
            .filter((node): node is Node => Boolean(node));
        const targets: HomeLayoutDebugTarget[] = [
            {
                id: 'top-hud',
                label: '顶部资源栏',
                nodes: findMany(
                    'HomeResourceHudSkin',
                    'HomeSettingsButton',
                    'HomeProfileBadge',
                    'HomeCoinResource',
                    'HomeStaminaResource',
                ),
            },
            { id: 'level-card', label: '关卡卡片', nodes: findMany('HomeLevelPill') },
            { id: 'board', label: '画板', nodes: findMany('CurrentArtworkCard') },
            { id: 'jar', label: '收纳罐', nodes: findMany('HomeBeadJar', 'HomeBeadJarBubble') },
            { id: 'daily', label: '每日挑战', nodes: findMany('HomeDailyPanelSkin', 'HomeDailyPanel') },
            { id: 'start', label: '开始按钮', nodes: findMany('ContinueLevelCard') },
            { id: 'more', label: '更多玩法', nodes: findMany('HomeSideFeature_more') },
            { id: 'collection', label: '我的图鉴', nodes: findMany('HomeSideFeature_collection') },
        ].filter((target) => target.nodes.length > 0);

        this.layoutDebugView = new HomeLayoutDebugView(
            this.root,
            this.viewWidth,
            this.viewHeight,
            targets,
        );
        this.layoutDebugView.show();
    }

    private drawReferenceRoom(): void {
        if (!this.root) return;
        const node = new Node('HomeReferenceRoom');
        node.layer = Layers.Enum.UI_2D;
        this.root.addChild(node);
        node.addComponent(UITransform).setContentSize(this.viewWidth, this.viewHeight);
        const authoredBackground = USE_OPTIONAL_HOME_SKINS
            ? UiArtResources.getHomeRoomBackground()
            : null;
        if (authoredBackground) {
            this.addSpriteSkin(node, 'HomeRoomBackgroundSkin', authoredBackground, this.viewWidth, this.viewHeight);
            return;
        }
        const g = node.addComponent(Graphics);
        const halfW = this.viewWidth / 2;
        const halfH = this.viewHeight / 2;

        // Soft lavender wall with a warm desk band.  The overlap of broad planes
        // gives the hand-painted room depth while keeping the center uncluttered.
        g.fillColor = rgba(147, 119, 194);
        g.rect(-halfW, -halfH, this.viewWidth, this.viewHeight);
        g.fill();
        g.fillColor = rgba(190, 151, 214, 72);
        g.rect(-halfW, 90, this.viewWidth, halfH - 90);
        g.fill();
        // The reference switches to a pink tabletop just below the showcase;
        // keep the band high enough that the daily card and CTA sit on the same
        // warm surface instead of floating over the wall colour.
        g.fillColor = rgba(245, 185, 201, 150);
        g.rect(-halfW, -halfH, this.viewWidth, 500);
        g.fill();
        g.fillColor = rgba(249, 211, 204, 220);
        g.rect(-halfW, -halfH, this.viewWidth, 178);
        g.fill();
        g.fillColor = rgba(255, 232, 220, 155);
        g.rect(-halfW, -halfH + 178, this.viewWidth, 28);
        g.fill();
        g.fillColor = rgba(255, 193, 210, 92);
        g.rect(-halfW, -halfH + 208, this.viewWidth, 22);
        g.fill();

        // Right curtain and window, deliberately abstracted so no reference pixels
        // are copied while the same cozy-room silhouette remains recognizable.
        g.fillColor = rgba(255, 203, 218, 168);
        g.moveTo(150, halfH);
        g.bezierCurveTo(284, 438, 270, 170, 210, -40);
        g.bezierCurveTo(180, -180, 226, -360, 330, -halfH);
        g.lineTo(halfW, -halfH);
        g.lineTo(halfW, halfH);
        g.close();
        g.fill();
        g.fillColor = rgba(255, 224, 231, 128);
        g.moveTo(216, halfH);
        g.bezierCurveTo(314, 360, 290, 152, 254, -12);
        g.bezierCurveTo(230, -130, 274, -310, 354, -halfH);
        g.lineTo(halfW, -halfH);
        g.lineTo(halfW, halfH);
        g.close();
        g.fill();

        g.fillColor = rgba(255, 245, 233, 100);
        g.roundRect(258, -154, 161, 438, 9);
        g.fill();
        g.fillColor = rgba(223, 181, 207, 110);
        g.roundRect(268, -144, 141, 418, 6);
        g.fill();
        g.fillColor = rgba(251, 231, 222, 184);
        g.rect(277, -134, 123, 398);
        g.fill();
        g.fillColor = rgba(218, 171, 208, 165);
        g.rect(334, -134, 7, 398);
        g.fill();
        g.rect(277, 58, 123, 7);
        g.fill();
        g.fillColor = rgba(255, 249, 223, 210);
        g.circle(377, 164, 14);
        g.fill();
        g.circle(377, 164, 5);
        g.fillColor = rgba(250, 213, 104, 200);
        g.circle(315, 270, 10);
        g.fill();

        // Left shelf, framed art and lamp are low-contrast background cues.
        g.fillColor = rgba(109, 83, 153, 98);
        g.roundRect(-halfW - 6, 286, 126, 126, 10);
        g.fill();
        g.fillColor = rgba(250, 218, 225, 170);
        g.roundRect(-halfW + 5, 299, 105, 98, 7);
        g.fill();
        g.fillColor = rgba(196, 143, 199, 160);
        g.rect(-halfW + 18, 310, 80, 72);
        g.fill();
        for (const [x, y, color] of [
            [-326, 322, rgba(248, 182, 114, 205)],
            [-301, 347, rgba(141, 215, 172, 205)],
            [-273, 329, rgba(248, 146, 184, 205)],
            [-290, 369, rgba(255, 226, 111, 205)],
        ] as const) {
            g.fillColor = color;
            g.circle(x, y, 10);
            g.fill();
        }
        g.fillColor = rgba(255, 234, 207, 140);
        g.roundRect(-halfW + 26, -14, 112, 80, 7);
        g.fill();
        g.fillColor = rgba(219, 151, 186, 120);
        g.roundRect(-halfW + 37, -4, 90, 60, 4);
        g.fill();
        g.fillColor = rgba(247, 194, 217, 150);
        g.circle(-291, 26, 17);
        g.fill();
        g.fillColor = rgba(117, 82, 168, 140);
        g.rect(-halfW + 31, -86, 102, 7);
        g.fill();

        // Decorative bead dots and stars keep the negative space lively.
        for (const [x, y, radius, color] of [
            [-335, 410, 6, rgba(255, 223, 141, 155)],
            [-304, 454, 4, rgba(255, 244, 212, 165)],
            [280, 428, 5, rgba(255, 241, 191, 170)],
            [326, 474, 4, rgba(255, 223, 141, 155)],
            [-352, -407, 7, rgba(255, 211, 199, 135)],
            [330, -402, 6, rgba(255, 226, 162, 150)],
        ] as const) {
            g.fillColor = color;
            g.circle(x, y, radius);
            g.fill();
        }
        g.fillColor = rgba(255, 248, 203, 175);
        this.fillPolygon(g, [[-305, 380], [-300, 392], [-288, 397], [-300, 402], [-305, 416], [-310, 402], [-322, 397], [-310, 392]], g.fillColor);
        this.fillPolygon(g, [[328, 300], [333, 313], [346, 318], [333, 323], [328, 337], [323, 323], [310, 318], [323, 313]], g.fillColor);
    }

    private buildReferenceTopHud(): void {
        if (!this.root) return;
        const topY = this.viewHeight / 2 - 78;
        const authoredHud = USE_OPTIONAL_HOME_SKINS
            ? UiArtResources.getHomeResourceHud()
            : null;
        if (authoredHud) {
            const hudSkin = this.addSpriteSkin(this.root, 'HomeResourceHudSkin', authoredHud, 720, 176);
            hudSkin.setPosition(new Vec3(0, topY, 0));
        }
        const drawHudShells = !authoredHud;
        const settings = this.createPlasticPanel(
            'HomeSettingsButton', this.root, -316, topY, 82, 82,
            rgba(255, 245, 244, 245), rgba(91, 57, 139, 100), 22, 6,
            rgba(255, 255, 255, 230), rgba(255, 255, 255, 160),
            drawHudShells,
        );
        if (drawHudShells) this.drawReferenceGear(settings);
        this.bindButton(settings, () => {
            this.handlers.onButtonClick?.();
            if (this.handlers.onSettings) this.handlers.onSettings();
            else this.showToast('设置功能正在开发中');
        });

        const profile = this.createPlasticPanel(
            'HomeProfileBadge', this.root, -149, topY, 222, 88,
            rgba(255, 247, 236, 248), rgba(91, 57, 139, 88), 38, 6,
            rgba(255, 255, 255, 225), rgba(255, 255, 255, 150),
            drawHudShells,
        );
        const profileGraphics = profile.getComponent(Graphics)!;
        const authoredAvatar = USE_OPTIONAL_HOME_SKINS
            ? UiArtResources.getHomeProfileAvatar()
            : null;
        if (authoredAvatar) {
            this.addSpriteSkin(profile, 'HomeProfileAvatarSkin', authoredAvatar, 82, 82)
                .setPosition(new Vec3(-64, 3, 0));
        } else {
            this.drawReferenceAvatar(profileGraphics, -64, 3, 1.12);
        }
        const levelText = this.addLabel(profile, `LV.${Math.max(1, this.saveData.level)}`, 26, 42, 12, 128, rgba(104, 69, 85), Label.HorizontalAlign.LEFT);
        this.addLabelOutline(levelText, rgba(255, 255, 255, 125), 2);
        const rankText = this.addLabel(profile, '拼豆达人', 25, 42, -21, 136, rgba(142, 75, 72), Label.HorizontalAlign.LEFT);
        this.addLabelOutline(rankText, rgba(255, 255, 255, 120), 2);
        this.bindButton(profile, () => {
            this.handlers.onButtonClick?.();
            this.showToast('个人资料');
        });

        const coin = this.createPlasticPanel(
            'HomeCoinResource', this.root, 73, topY, 199, 54,
            rgba(255, 248, 236, 248), rgba(91, 57, 139, 82), 27, 5,
            rgba(255, 255, 255, 230), rgba(255, 255, 255, 152),
            drawHudShells,
        );
        this.drawCoinIcon(coin, -70, 1);
        this.coinLabel = this.addLabel(coin, '0', 24, 20, 1, 120, rgba(112, 74, 76), Label.HorizontalAlign.CENTER);
        this.drawPlusBadge(coin, 82, 1, rgba(246, 119, 158));
        this.bindButton(coin, () => {
            this.handlers.onButtonClick?.();
            this.showToast('金币可用于购买道具和装饰');
        });

        const stamina = this.createPlasticPanel(
            'HomeStaminaResource', this.root, 273, topY, 178, 57,
            rgba(255, 248, 236, 248), rgba(91, 57, 139, 82), 27, 5,
            rgba(255, 255, 255, 230), rgba(255, 255, 255, 152),
            drawHudShells,
        );
        this.drawHeartIcon(stamina, -64, 2, rgba(247, 102, 137), 0.92);
        this.staminaLabel = this.addLabel(stamina, '10', 25, -19, 1, 52, rgba(112, 74, 76), Label.HorizontalAlign.CENTER);
        this.staminaStatusLabel = this.addLabel(stamina, '已满', 22, 28, 1, 58, rgba(112, 74, 76), Label.HorizontalAlign.CENTER);
        this.drawPlusBadge(stamina, 75, 1, rgba(246, 119, 158));
        this.bindButton(stamina, () => {
            this.handlers.onButtonClick?.();
            this.showToast(`每${Math.round(this.common.staminaRecoverSec / 60)}分钟恢复1点体力`);
        });
    }

    private buildReferenceLevelCard(): void {
        if (!this.root) return;
        const plaque = new Node('HomeLevelPill');
        plaque.layer = Layers.Enum.UI_2D;
        this.root.addChild(plaque);
        plaque.setPosition(new Vec3(0, this.viewHeight / 2 - 260, 0));
        plaque.addComponent(UITransform).setContentSize(391, 204);
        const g = plaque.addComponent(Graphics);
        const authoredPlaque = USE_OPTIONAL_HOME_SKINS
            ? UiArtResources.getHomeLevelPlaque()
            : null;
        if (authoredPlaque) {
            this.addSpriteSkin(plaque, 'HomeLevelPlaqueSkin', authoredPlaque, 391, 204);
        } else {
            this.drawReferencePlaque(g, 391, 204);
        }
        this.levelPillLabel = this.addLabel(plaque, '第1关', 40, 0, 58, 300, rgba(210, 77, 103), Label.HorizontalAlign.CENTER);
        this.addLabelOutline(this.levelPillLabel, rgba(255, 249, 226, 230), 3);
        this.levelTitleLabel = this.addLabel(plaque, '甜甜草莓蛋糕', 36, 0, -4, 350, rgba(164, 88, 40), Label.HorizontalAlign.CENTER);
        this.addLabelOutline(this.levelTitleLabel, rgba(255, 247, 220, 190), 3);
        this.levelProgressLabel = this.addLabel(plaque, '图鉴进度  19 / 1000', 25, 0, -53, 350, rgba(178, 101, 61), Label.HorizontalAlign.CENTER);
        this.addLabelOutline(this.levelProgressLabel, rgba(255, 248, 228, 195), 2);
        if (!authoredPlaque) {
            this.drawReferenceStrawberry(g, -145, 4, 0.58);
            this.drawReferenceStrawberry(g, 145, 4, 0.58);
            this.drawHeartIcon(plaque, -150, 58, rgba(247, 125, 150), 0.46);
            this.drawHeartIcon(plaque, 150, 58, rgba(247, 125, 150), 0.46);
        }
        this.bindButton(plaque, () => {
            this.handlers.onButtonClick?.();
            this.openLevelSelect();
        });
    }

    private buildReferenceBoard(): void {
        if (!this.root) return;
        const board = new Node('CurrentArtworkCard');
        board.layer = Layers.Enum.UI_2D;
        this.root.addChild(board);
        board.setPosition(new Vec3(0, 70, 0));
        board.addComponent(UITransform).setContentSize(524, 521);
        const g = board.addComponent(Graphics);
        const authoredBoard = USE_OPTIONAL_HOME_SKINS
            ? UiArtResources.getHomeBoardFrame()
            : null;
        if (authoredBoard) {
            this.addSpriteSkin(board, 'HomeBoardFrameSkin', authoredBoard, 524, 521);
        } else {
            this.drawReferenceBoardShell(g, 524, 521);
        }

        const page = new Node('CurrentArtworkPreview');
        page.layer = Layers.Enum.UI_2D;
        board.addChild(page);
        page.setPosition(new Vec3(0, -7, 0));
        page.addComponent(UITransform).setContentSize(270, 300);
        page.setScale(new Vec3(1.28, 1.28, 1));
        this.previewGraphics = page.addComponent(Graphics);
        this.referenceRingPreview = true;
        this.bindButton(board, () => {
            this.handlers.onButtonClick?.();
            this.openLevelSelect();
        });

        const slider = new Node('HomeBoardSlider');
        slider.layer = Layers.Enum.UI_2D;
        board.addChild(slider);
        slider.setPosition(new Vec3(-222, -4, 0));
        slider.addComponent(UITransform).setContentSize(40, 152);
        const sliderGraphics = slider.addComponent(Graphics);
        sliderGraphics.fillColor = rgba(125, 62, 99, 54);
        sliderGraphics.roundRect(-18, -76, 36, 152, 18);
        sliderGraphics.fill();
        sliderGraphics.fillColor = rgba(252, 130, 158, 220);
        sliderGraphics.roundRect(-16, -70, 32, 140, 16);
        sliderGraphics.fill();
        sliderGraphics.fillColor = rgba(255, 213, 226, 230);
        sliderGraphics.roundRect(-8, -55, 10, 92, 5);
        sliderGraphics.fill();
        if (authoredBoard) {
            const boardDecor = new Node('HomeBoardDecorations');
            boardDecor.layer = Layers.Enum.UI_2D;
            board.addChild(boardDecor);
            boardDecor.addComponent(UITransform).setContentSize(524, 521);
            boardDecor.addComponent(Graphics);
            this.drawHeartIcon(boardDecor, 229, 225, rgba(246, 123, 145), 0.68);
            this.drawHeartIcon(boardDecor, -225, -222, rgba(246, 123, 145), 0.56);
        } else {
            this.drawHeartIcon(board, 229, 225, rgba(246, 123, 145), 0.68);
            this.drawHeartIcon(board, -225, -222, rgba(246, 123, 145), 0.56);
        }
    }

    private buildReferenceJar(): void {
        if (!this.root) return;
        const jar = new Node('HomeBeadJar');
        jar.layer = Layers.Enum.UI_2D;
        this.root.addChild(jar);
        jar.setPosition(new Vec3(241, -52, 0));
        jar.addComponent(UITransform).setContentSize(145, 256);
        const g = jar.addComponent(Graphics);
        const authoredJar = USE_OPTIONAL_HOME_SKINS
            ? UiArtResources.getHomeBeadJar()
            : null;
        if (authoredJar) {
            this.addSpriteSkin(jar, 'HomeBeadJarSkin', authoredJar, 145, 256);
        } else {
            this.drawReferenceJar(g);
        }
        this.bindButton(jar, () => {
            this.handlers.onButtonClick?.();
            this.showToast('彩色拼豆收纳罐');
        });

        const bubble = new Node('HomeBeadJarBubble');
        bubble.layer = Layers.Enum.UI_2D;
        this.root.addChild(bubble);
        bubble.setPosition(new Vec3(305, 35, 0));
        bubble.addComponent(UITransform).setContentSize(131, 88);
        const bubbleGraphics = bubble.addComponent(Graphics);
        bubbleGraphics.fillColor = rgba(102, 57, 133, 65);
        bubbleGraphics.roundRect(-65, -40, 130, 76, 24);
        bubbleGraphics.fill();
        bubbleGraphics.fillColor = rgba(255, 249, 229, 247);
        bubbleGraphics.roundRect(-65, -35, 130, 76, 24);
        bubbleGraphics.fill();
        bubbleGraphics.strokeColor = rgba(235, 133, 133, 200);
        bubbleGraphics.lineWidth = 2;
        bubbleGraphics.roundRect(-61, -31, 122, 64, 20);
        bubbleGraphics.stroke();
        this.addLabel(bubble, '拼出美好', 19, 0, 12, 114, rgba(170, 85, 62), Label.HorizontalAlign.CENTER);
        this.addLabel(bubble, '每一天～♥', 18, 0, -15, 114, rgba(196, 92, 111), Label.HorizontalAlign.CENTER);
        this.bindButton(bubble, () => {
            this.handlers.onButtonClick?.();
            this.showToast('把喜欢的颜色放进画板吧');
        });
    }

    private buildReferenceDailyCard(): void {
        if (!this.root) return;
        const dailyY = -this.viewHeight / 2 + 364;
        const authoredDaily = USE_OPTIONAL_HOME_SKINS
            ? UiArtResources.getHomeDailyPanel()
            : null;
        if (authoredDaily) {
            const skin = this.addSpriteSkin(this.root, 'HomeDailyPanelSkin', authoredDaily, 575, 166);
            skin.setPosition(new Vec3(0, dailyY, 0));
        }
        const daily = new Node('HomeDailyPanel');
        daily.layer = Layers.Enum.UI_2D;
        this.root.addChild(daily);
        daily.setPosition(new Vec3(0, dailyY, 0));
        daily.addComponent(UITransform).setContentSize(575, 166);
        const g = daily.addComponent(Graphics);
        if (!authoredDaily) {
        g.fillColor = rgba(92, 49, 143, 102);
        g.roundRect(-287.5, -83 - 8, 575, 166, 28);
        g.fill();
        g.fillColor = rgba(173, 120, 221, 245);
        g.roundRect(-287.5, -83, 575, 166, 28);
        g.fill();
        g.strokeColor = rgba(255, 226, 255, 230);
        g.lineWidth = 3;
        g.roundRect(-281.5, -77, 563, 154, 23);
        g.stroke();
        g.fillColor = rgba(255, 249, 230, 245);
        g.roundRect(-261, -61, 522, 106, 18);
        g.fill();
        g.strokeColor = rgba(245, 171, 203, 230);
        g.lineWidth = 2;
        g.roundRect(-254, -54, 508, 92, 15);
        g.stroke();
        g.fillColor = rgba(164, 107, 216, 255);
        g.roundRect(-94, 53, 188, 40, 18);
        g.fill();
        g.strokeColor = rgba(255, 236, 255, 240);
        g.lineWidth = 2;
        g.roundRect(-88, 57, 176, 32, 15);
        g.stroke();
        }
        const title = this.addLabel(daily, '今日挑战', 29, 0, 65, 180, rgba(255, 251, 239), Label.HorizontalAlign.CENTER);
        this.addLabelOutline(title, rgba(115, 64, 161), 3);
        this.drawReferenceSparkle(g, -145, 65, 0.62, rgba(255, 203, 84, 230));
        this.drawReferenceSparkle(g, 145, 65, 0.62, rgba(255, 203, 84, 230));
        this.drawReferenceSparkle(g, 250, 60, 0.44, rgba(255, 186, 225, 220));
        this.drawReferenceGiftRing(g, 220, -7, 0.86);
        this.drawReferenceGift(g, -220, -7, 0.72, rgba(247, 93, 110), rgba(255, 188, 52));
        this.drawReferenceGift(g, 220, -6, 0.72, rgba(239, 97, 171), rgba(255, 209, 69));
        this.drawReferenceQuestionBadge(g, -176, -15, 0.82);
        this.addLabel(daily, '连续签到 7 天，领取奖励', 25, 16, 22, 410, rgba(132, 74, 54), Label.HorizontalAlign.CENTER);
        const progressText = this.addLabel(daily, '3 / 7 天', 22, 121, -35, 96, rgba(226, 82, 141), Label.HorizontalAlign.CENTER);
        this.dailyProgressLabel = progressText;
        g.fillColor = rgba(250, 133, 178, 238);
        g.roundRect(78, -53, 86, 36, 18);
        g.fill();
        g.strokeColor = rgba(255, 232, 244, 240);
        g.lineWidth = 2;
        g.roundRect(80, -51, 82, 32, 16);
        g.stroke();
        g.strokeColor = rgba(242, 157, 194, 210);
        g.lineWidth = 8;
        g.lineCap = Graphics.LineCap.ROUND;
        g.moveTo(-68, -33);
        g.lineTo(68, -33);
        g.stroke();
        g.strokeColor = rgba(244, 99, 153, 235);
        g.lineWidth = 8;
        g.moveTo(-68, -33);
        g.lineTo(8, -33);
        g.stroke();
        for (let index = 0; index < 4; index += 1) {
            g.fillColor = index < 3 ? rgba(245, 119, 166, 245) : rgba(255, 232, 196, 245);
            g.circle(-68 + index * 45, -33, 10);
            g.fill();
            g.strokeColor = rgba(255, 255, 255, 220);
            g.lineWidth = 2;
            g.circle(-68 + index * 45, -33, 10);
            g.stroke();
        }
        this.bindButton(daily, () => {
            this.handlers.onButtonClick?.();
            if (this.saveData.level < this.common.dailyUnlockLevel) this.showToast(`第${this.common.dailyUnlockLevel}关解锁每日挑战`);
            else this.showToast('每日挑战功能正在开发中');
        });
    }

    private buildReferenceBottomActions(): void {
        if (!this.root) return;
        const halfH = this.viewHeight / 2;
        const startY = -halfH + 197;
        const start = new Node('ContinueLevelCard');
        start.layer = Layers.Enum.UI_2D;
        this.root.addChild(start);
        start.setPosition(new Vec3(7, startY, 0));
        start.addComponent(UITransform).setContentSize(376, 150);
        const authoredPrimaryFrame = USE_OPTIONAL_HOME_SKINS ? UiArtResources.getHomePrimaryButton() : null;
        if (authoredPrimaryFrame) {
            const skin = new Node('HomeStartButtonSkin');
            skin.layer = Layers.Enum.UI_2D;
            start.addChild(skin);
            // The PNG contains transparent production margins.  Render it a bit
            // larger than the hit target so its visible alpha bounds land at the
            // measured 376x150 reference face.
            skin.addComponent(UITransform).setContentSize(397, 182);
            const sprite = skin.addComponent(Sprite);
            sprite.sizeMode = Sprite.SizeMode.CUSTOM;
            sprite.spriteFrame = authoredPrimaryFrame;
        } else {
            const startGraphics = start.addComponent(Graphics);
            this.drawStartButton(startGraphics, 376, 150);
        }
        const startTitle = this.addLabel(start, '开始拼豆', 45, 0, 21, 340, rgba(255, 253, 226), Label.HorizontalAlign.CENTER);
        this.addLabelOutline(startTitle, rgba(213, 106, 35), 5);
        const overlay = new Node('HomeStartButtonOverlay');
        overlay.layer = Layers.Enum.UI_2D;
        start.addChild(overlay);
        overlay.addComponent(UITransform).setContentSize(376, 150);
        overlay.addComponent(Graphics);
        this.drawHeartIcon(overlay, -76, -106, rgba(239, 75, 72), 0.66);
        this.staminaCostLabel = this.addLabel(start, '消耗 1 点体力', 24, 18, -111, 220, rgba(255, 250, 235), Label.HorizontalAlign.CENTER);
        this.addLabelOutline(this.staminaCostLabel, rgba(176, 92, 102), 3);
        this.bindButton(start, () => {
            this.handlers.onButtonClick?.();
            this.handlers.onStart(this.selectedLevelId);
        });

        const more = this.createReferenceSideButton('HomeSideFeature_more', -285, -halfH + 120, '更多玩法', 'more');
        this.bindButton(more, () => {
            this.handlers.onButtonClick?.();
            this.showToast('更多玩法会随主线进度逐步开放');
        });
        const collection = this.createReferenceSideButton('HomeSideFeature_collection', 289, -halfH + 126, '我的图鉴', 'collection');
        this.bindButton(collection, () => {
            this.handlers.onButtonClick?.();
            if (this.saveData.level < COLLECTION_UNLOCK_LEVEL) this.showToast(`第${COLLECTION_UNLOCK_LEVEL}关解锁图鉴`);
            else this.showToast('图鉴功能正在开发中');
        });
    }

    private createReferenceSideButton(name: string, x: number, y: number, label: string, key: HomeSideFeature): Node {
        const node = new Node(name);
        node.layer = Layers.Enum.UI_2D;
        this.root!.addChild(node);
        node.setPosition(new Vec3(x, y, 0));
        const featureWidth = key === 'collection' ? 151 : 148;
        const featureHeight = key === 'collection' ? 200 : 166;
        node.addComponent(UITransform).setContentSize(featureWidth, featureHeight);
        const isCollection = key === 'collection';
        const authoredBadge = USE_OPTIONAL_HOME_SKINS
            ? key === 'more'
                ? UiArtResources.getHomeMoreBadge()
                : key === 'collection'
                    ? UiArtResources.getHomeCollectionBadge()
                    : null
            : null;
        if (authoredBadge) {
            const skinName = isCollection ? 'HomeCollectionBadgeSkin' : 'HomeMoreBadgeSkin';
            const skin = this.addSpriteSkin(node, skinName, authoredBadge, 132, 132);
            skin.setPosition(new Vec3(0, isCollection ? 25 : 17, 0));
        } else {
            const g = node.addComponent(Graphics);
            const shellShadow = isCollection ? rgba(139, 60, 107, 120) : rgba(83, 46, 142, 110);
            const shellFill = isCollection ? rgba(237, 126, 174, 248) : rgba(164, 105, 218, 245);
            const shellStroke = isCollection ? rgba(255, 218, 231, 240) : rgba(238, 213, 255, 240);
            g.fillColor = shellShadow;
            const halfWidth = featureWidth / 2;
            const halfHeight = featureHeight / 2;
            g.roundRect(-halfWidth, -halfHeight - 7, featureWidth, featureHeight, 26);
            g.fill();
            g.fillColor = shellFill;
            g.roundRect(-halfWidth, -halfHeight, featureWidth, featureHeight, 26);
            g.fill();
            g.strokeColor = shellStroke;
            g.lineWidth = 3;
            g.roundRect(-halfWidth + 6, -halfHeight + 6, featureWidth - 12, featureHeight - 12, 20);
            g.stroke();
            g.fillColor = rgba(255, 247, 231, 245);
            g.roundRect(-48, isCollection ? -55 : -40, 96, 73, 18);
            g.fill();
            g.strokeColor = rgba(245, 183, 221, 230);
            g.lineWidth = 2;
            g.roundRect(-42, isCollection ? -49 : -34, 84, 61, 14);
            g.stroke();
            this.drawSideFeatureIcon(
                g,
                key,
                key === 'more' ? rgba(255, 208, 67) : rgba(242, 108, 166),
                0,
                isCollection ? 5 : -2,
                key === 'more' ? 1.28 : 1.24,
            );
        }
        const text = this.addLabel(node, label, 24, 0, isCollection ? -55 : -62, 144, rgba(255, 251, 241), Label.HorizontalAlign.CENTER);
        this.addLabelOutline(text, rgba(91, 46, 152), 3);
        if (key === 'collection') {
            const progress = this.addLabel(node, `${Math.min(19, this.saveData.level)} / 1000`, 20, 0, -82, 128, rgba(255, 238, 253), Label.HorizontalAlign.CENTER);
            this.collectionProgressLabel = progress;
            this.addLabelOutline(progress, rgba(91, 46, 152), 2);
        }
        return node;
    }

    private drawReferenceGear(parent: Node): void {
        // The existing radial helper is intentionally reused so the settings glyph
        // keeps the same crisp geometry in both the old and reference layouts.
        this.drawSettingsIcon(parent, 0, 3);
    }

    private drawReferenceAvatar(g: Graphics, x: number, y: number, scale: number): void {
        const s = Math.max(0.5, scale);
        g.fillColor = rgba(118, 64, 125, 80);
        g.circle(x, y - 6 * s, 43 * s);
        g.fill();
        g.fillColor = rgba(255, 224, 207, 255);
        g.circle(x, y, 42 * s);
        g.fill();
        g.strokeColor = rgba(255, 255, 255, 230);
        g.lineWidth = 3 * s;
        g.circle(x, y, 40 * s);
        g.stroke();
        // Hair cap and side locks.
        g.fillColor = rgba(157, 86, 47, 255);
        g.circle(x, y + 12 * s, 31 * s);
        g.fill();
        g.roundRect(x - 31 * s, y - 10 * s, 62 * s, 38 * s, 18 * s);
        g.fill();
        g.circle(x - 29 * s, y - 8 * s, 14 * s);
        g.fill();
        g.circle(x + 29 * s, y - 8 * s, 14 * s);
        g.fill();
        // Face, fringe and bow.
        g.fillColor = rgba(255, 224, 204, 255);
        g.circle(x, y - 1 * s, 24 * s);
        g.fill();
        g.fillColor = rgba(171, 95, 53, 255);
        g.moveTo(x - 24 * s, y + 11 * s);
        g.bezierCurveTo(x - 16 * s, y + 31 * s, x + 6 * s, y + 29 * s, x + 22 * s, y + 13 * s);
        g.lineTo(x + 19 * s, y + 22 * s);
        g.bezierCurveTo(x + 4 * s, y + 35 * s, x - 15 * s, y + 34 * s, x - 24 * s, y + 20 * s);
        g.close();
        g.fill();
        g.fillColor = rgba(72, 51, 48, 255);
        g.circle(x - 9 * s, y - 2 * s, 4.5 * s);
        g.fill();
        g.circle(x + 9 * s, y - 2 * s, 4.5 * s);
        g.fill();
        g.fillColor = rgba(255, 255, 255, 225);
        g.circle(x - 10 * s, y, 1.7 * s);
        g.fill();
        g.circle(x + 8 * s, y, 1.7 * s);
        g.fill();
        g.fillColor = rgba(246, 132, 145, 180);
        g.circle(x - 17 * s, y - 10 * s, 5 * s);
        g.fill();
        g.circle(x + 17 * s, y - 10 * s, 5 * s);
        g.fill();
        g.strokeColor = rgba(166, 79, 87, 230);
        g.lineWidth = 2 * s;
        g.arc(x, y - 9 * s, 9 * s, Math.PI * 0.15, Math.PI * 0.85, false);
        g.stroke();
        g.fillColor = rgba(246, 122, 156, 255);
        g.circle(x + 31 * s, y - 27 * s, 9 * s);
        g.fill();
        g.circle(x + 44 * s, y - 27 * s, 9 * s);
        g.fill();
        g.fillColor = rgba(255, 176, 190, 255);
        g.circle(x + 37 * s, y - 25 * s, 7 * s);
        g.fill();
    }

    private drawReferenceStrawberry(g: Graphics, x: number, y: number, scale: number): void {
        const s = Math.max(0.35, scale);
        g.fillColor = rgba(70, 166, 74, 240);
        g.moveTo(x, y + 21 * s);
        g.lineTo(x - 17 * s, y + 31 * s);
        g.lineTo(x - 5 * s, y + 15 * s);
        g.lineTo(x + 9 * s, y + 31 * s);
        g.lineTo(x + 6 * s, y + 13 * s);
        g.close();
        g.fill();
        g.fillColor = rgba(241, 89, 102, 255);
        g.moveTo(x, y + 15 * s);
        g.bezierCurveTo(x - 20 * s, y + 5 * s, x - 22 * s, y - 15 * s, x, y - 25 * s);
        g.bezierCurveTo(x + 22 * s, y - 15 * s, x + 20 * s, y + 5 * s, x, y + 15 * s);
        g.close();
        g.fill();
        g.fillColor = rgba(255, 221, 164, 235);
        for (const [dx, dy] of [[-8, -4], [2, -12], [10, -1], [-4, 7]] as const) {
            g.ellipse(x + dx * s, y + dy * s, 2.2 * s, 4 * s);
            g.fill();
        }
    }

    private drawReferencePlaque(g: Graphics, width: number, height: number): void {
        g.fillColor = rgba(101, 56, 93, 92);
        g.roundRect(-width / 2, -height / 2 - 9, width, height, 34);
        g.fill();
        g.fillColor = rgba(255, 242, 213, 255);
        g.roundRect(-width / 2, -height / 2, width, height, 34);
        g.fill();
        g.strokeColor = rgba(232, 142, 126, 240);
        g.lineWidth = 3;
        g.roundRect(-width / 2 + 5, -height / 2 + 5, width - 10, height - 10, 29);
        g.stroke();
        g.strokeColor = rgba(255, 255, 255, 175);
        g.lineWidth = 2;
        g.roundRect(-width / 2 + 13, -height / 2 + 13, width - 26, height - 26, 23);
        g.stroke();
        g.fillColor = rgba(245, 167, 169, 92);
        g.roundRect(-width / 2 + 27, -height / 2 + 83, width - 54, 2, 1);
        g.fill();
        g.fillColor = rgba(245, 167, 169, 92);
        g.roundRect(-width / 2 + 27, -height / 2 + 48, width - 54, 2, 1);
        g.fill();
    }

    private drawReferenceBoardShell(g: Graphics, width: number, height: number): void {
        const x = -width / 2;
        const y = -height / 2;
        g.fillColor = rgba(92, 51, 98, 90);
        g.roundRect(x + 3, y - 12, width - 6, height, 54);
        g.fill();
        g.fillColor = rgba(252, 189, 122, 255);
        g.roundRect(x, y, width, height, 54);
        g.fill();
        g.strokeColor = rgba(255, 225, 177, 245);
        g.lineWidth = 5;
        g.roundRect(x + 5, y + 5, width - 10, height - 10, 49);
        g.stroke();
        g.fillColor = rgba(255, 231, 192, 255);
        g.roundRect(x + 22, y + 18, width - 44, height - 36, 43);
        g.fill();
        g.strokeColor = rgba(224, 150, 107, 200);
        g.lineWidth = 3;
        g.roundRect(x + 25, y + 21, width - 50, height - 42, 39);
        g.stroke();
        g.fillColor = rgba(255, 247, 225, 255);
        g.roundRect(x + 47, y + 42, width - 94, height - 84, 34);
        g.fill();
        g.strokeColor = rgba(246, 199, 168, 220);
        g.lineWidth = 2;
        g.roundRect(x + 55, y + 50, width - 110, height - 100, 28);
        g.stroke();
        // Stitch marks around the page create a tactile fabric-board cue.
        g.strokeColor = rgba(237, 170, 151, 148);
        g.lineWidth = 2;
        for (let offset = -190; offset <= 190; offset += 24) {
            g.moveTo(offset, y + 67);
            g.lineTo(offset + 9, y + 67);
            g.moveTo(offset, -y - 67);
            g.lineTo(offset + 9, -y - 67);
        }
        g.stroke();
        g.fillColor = rgba(255, 255, 255, 100);
        g.roundRect(x + 52, y + height - 38, width - 104, 9, 4);
        g.fill();
    }

    private drawReferenceJar(g: Graphics): void {
        g.fillColor = rgba(74, 43, 91, 90);
        g.ellipse(3, -102, 76, 30);
        g.fill();
        g.fillColor = rgba(238, 186, 192, 150);
        g.roundRect(-70, -108, 140, 188, 42);
        g.fill();
        g.fillColor = rgba(255, 244, 233, 110);
        g.roundRect(-62, -98, 124, 166, 35);
        g.fill();
        g.strokeColor = rgba(220, 155, 178, 220);
        g.lineWidth = 3;
        g.roundRect(-62, -98, 124, 166, 35);
        g.stroke();
        g.fillColor = rgba(255, 182, 190, 255);
        g.roundRect(-72, 61, 144, 33, 15);
        g.fill();
        g.fillColor = rgba(247, 132, 151, 255);
        g.roundRect(-66, 67, 132, 25, 12);
        g.fill();
        g.fillColor = rgba(255, 207, 213, 255);
        g.ellipse(0, 94, 70, 17);
        g.fill();
        g.strokeColor = rgba(216, 115, 144, 190);
        g.lineWidth = 2;
        g.ellipse(0, 94, 70, 17);
        g.stroke();
        g.fillColor = rgba(255, 255, 255, 125);
        g.roundRect(-47, -70, 11, 98, 5);
        g.fill();
        // Cute face.
        g.fillColor = rgba(68, 48, 54, 255);
        g.circle(-23, 6, 8);
        g.fill();
        g.circle(23, 6, 8);
        g.fill();
        g.fillColor = rgba(255, 255, 255, 225);
        g.circle(-25, 9, 3);
        g.fill();
        g.circle(21, 9, 3);
        g.fill();
        g.fillColor = rgba(245, 135, 151, 170);
        g.circle(-39, -12, 8);
        g.fill();
        g.circle(39, -12, 8);
        g.fill();
        g.strokeColor = rgba(83, 53, 59, 240);
        g.lineWidth = 3;
        g.arc(0, -5, 17, Math.PI * 0.16, Math.PI * 0.84, false);
        g.stroke();
        // Loose beads inside the transparent lower half.
        for (const [x, y, radius, color] of [
            [-35, -59, 11, rgba(242, 103, 148, 245)],
            [-13, -70, 10, rgba(255, 195, 52, 245)],
            [10, -61, 11, rgba(123, 193, 222, 245)],
            [32, -71, 10, rgba(171, 112, 219, 245)],
            [-24, -83, 9, rgba(119, 204, 146, 245)],
            [3, -86, 10, rgba(248, 144, 84, 245)],
            [27, -92, 8, rgba(247, 116, 185, 245)],
        ] as const) {
            g.fillColor = color;
            g.circle(x, y, radius);
            g.fill();
            g.fillColor = rgba(255, 255, 255, 115);
            g.circle(x - radius * 0.28, y + radius * 0.28, Math.max(2, radius * 0.22));
            g.fill();
        }
        g.fillColor = rgba(245, 121, 150, 255);
        g.circle(0, 108, 18);
        g.fill();
        g.circle(21, 108, 18);
        g.fill();
        g.fillColor = rgba(255, 179, 190, 255);
        g.circle(10, 110, 14);
        g.fill();
    }

    private drawReferenceGift(g: Graphics, x: number, y: number, scale: number, boxColor: Color, ribbonColor: Color): void {
        const s = Math.max(0.45, scale);
        g.fillColor = rgba(116, 63, 136, 70);
        g.roundRect(x - 30 * s, y - 27 * s, 60 * s, 52 * s, 8 * s);
        g.fill();
        g.fillColor = boxColor;
        g.roundRect(x - 29 * s, y - 22 * s, 58 * s, 50 * s, 7 * s);
        g.fill();
        g.fillColor = ribbonColor;
        g.rect(x - 6 * s, y - 22 * s, 12 * s, 50 * s);
        g.fill();
        g.rect(x - 31 * s, y - 4 * s, 62 * s, 10 * s);
        g.fill();
        g.fillColor = rgba(255, 240, 159, 255);
        g.circle(x - 9 * s, y + 35 * s, 13 * s);
        g.fill();
        g.circle(x + 9 * s, y + 35 * s, 13 * s);
        g.fill();
        g.fillColor = ribbonColor;
        g.circle(x, y + 31 * s, 7 * s);
        g.fill();
    }

    private drawReferenceQuestionBadge(g: Graphics, x: number, y: number, scale: number): void {
        const s = Math.max(0.45, scale);
        g.fillColor = rgba(112, 65, 115, 90);
        g.circle(x + 2 * s, y - 3 * s, 24 * s);
        g.fill();
        g.fillColor = rgba(255, 247, 232, 255);
        g.circle(x, y, 23 * s);
        g.fill();
        g.strokeColor = rgba(243, 175, 126, 240);
        g.lineWidth = 2 * s;
        g.circle(x, y, 21 * s);
        g.stroke();
        g.fillColor = rgba(242, 146, 80, 255);
        g.circle(x, y + 7 * s, 6 * s);
        g.fill();
        g.roundRect(x - 5 * s, y - 8 * s, 10 * s, 14 * s, 5 * s);
        g.fill();
        g.circle(x, y - 12 * s, 3 * s);
        g.fill();
    }

    private drawReferenceGiftRing(g: Graphics, x: number, y: number, scale: number): void {
        const s = Math.max(0.45, scale);
        g.fillColor = rgba(255, 244, 221, 245);
        g.circle(x, y, 45 * s);
        g.fill();
        g.strokeColor = rgba(246, 206, 164, 230);
        g.lineWidth = 3 * s;
        g.circle(x, y, 42 * s);
        g.stroke();
        for (let index = 0; index < 12; index += 1) {
            const angle = index * Math.PI * 2 / 12;
            const px = x + Math.cos(angle) * 37 * s;
            const py = y + Math.sin(angle) * 37 * s;
            g.fillColor = index % 2 === 0 ? rgba(255, 228, 210, 245) : rgba(255, 201, 211, 235);
            g.circle(px, py, 5 * s);
            g.fill();
        }
    }

    private drawReferenceSparkle(g: Graphics, x: number, y: number, scale: number, color: Color): void {
        const s = Math.max(0.35, scale);
        g.fillColor = color;
        this.fillPolygon(g, [
            [x, y + 15 * s], [x + 4 * s, y + 4 * s], [x + 15 * s, y],
            [x + 4 * s, y - 4 * s], [x, y - 15 * s], [x - 4 * s, y - 4 * s],
            [x - 15 * s, y], [x - 4 * s, y + 4 * s],
        ], color);
    }

    private drawBackground(): void {
        if (!this.root) return;
        const node = new Node('HomeBackground');
        node.layer = Layers.Enum.UI_2D;
        this.root.addChild(node);
        node.addComponent(UITransform).setContentSize(this.viewWidth, this.viewHeight);
        const g = node.addComponent(Graphics);
        const halfW = this.viewWidth / 2;
        const halfH = this.viewHeight / 2;

        // The reference's strongest transferable quality is the uninterrupted
        // periwinkle field. The facets below are authored locally instead of
        // using a screenshot or an extracted background texture.
        g.fillColor = rgba(151, 166, 252);
        g.rect(-halfW, -halfH, this.viewWidth, this.viewHeight);
        g.fill();

        const facets: ReadonlyArray<readonly [ReadonlyArray<readonly [number, number]>, Color]> = [
            [[[-halfW, halfH], [-160, halfH], [-36, 470], [-halfW, 390]], rgba(177, 187, 255, 38)],
            [[[-160, halfH], [92, halfH], [18, 510], [-36, 470]], rgba(104, 118, 224, 24)],
            [[[92, halfH], [halfW, halfH], [halfW, 438], [196, 506]], rgba(174, 186, 255, 44)],
            [[[-halfW, 390], [-36, 470], [-122, 188], [-halfW, 264]], rgba(178, 188, 255, 35)],
            [[[-36, 470], [18, 510], [196, 506], [118, 236], [-122, 188]], rgba(188, 196, 255, 27)],
            [[[196, 506], [halfW, 438], [halfW, 156], [252, 214], [118, 236]], rgba(176, 187, 255, 35)],
            [[[-halfW, 264], [-122, 188], [-194, -54], [-halfW, 20]], rgba(172, 182, 253, 25)],
            [[[-122, 188], [118, 236], [62, -42], [-194, -54]], rgba(105, 119, 225, 18)],
            [[[118, 236], [252, 214], [halfW, 156], [halfW, -118], [62, -42]], rgba(177, 187, 255, 22)],
            [[[-halfW, 20], [-194, -54], [-118, -348], [-halfW, -300]], rgba(91, 105, 214, 20)],
            [[[-194, -54], [62, -42], [18, -352], [-118, -348]], rgba(225, 230, 255, 62)],
            [[[62, -42], [halfW, -118], [halfW, -330], [70, -272], [18, -352]], rgba(192, 202, 255, 48)],
            [[[70, -272], [halfW, -330], [halfW, -halfH], [-16, -halfH], [18, -352]], rgba(91, 106, 210, 44)],
            [[[-halfW, -300], [-118, -348], [-16, -halfH], [-halfW, -halfH]], rgba(72, 85, 184, 38)],
        ];
        for (const [points, color] of facets) this.fillPolygon(g, points, color);

        // A deeper lower band anchors the CTA without creating a second page.
        this.fillPolygon(g, [
            [-halfW, -halfH], [halfW, -halfH], [halfW, -510], [220, -474],
            [-72, -492], [-halfW, -448],
        ], rgba(78, 93, 192, 20));
        g.strokeColor = rgba(219, 225, 255, 28);
        g.lineWidth = 2;
        for (const offset of [-300, -96, 120, 336]) {
            g.moveTo(-halfW, offset - 250);
            g.lineTo(halfW, offset + 120);
        }
        g.stroke();
    }

    private buildTopHud(): void {
        if (!this.root) return;
        const topY = this.viewHeight / 2 - 78;

        const settings = this.createPlasticPanel(
            'HomeSettingsButton', this.root, -310, topY, 82, 82,
            themeColor(THEME.hudPanel), rgba(75, 69, 142, 108), 20, 5,
            rgba(255, 255, 255, 208), rgba(255, 255, 255, 150),
        );
        this.drawSettingsIcon(settings, 0, 3);
        this.bindButton(settings, () => {
            this.handlers.onButtonClick?.();
            if (this.handlers.onSettings) this.handlers.onSettings();
            else this.showToast('设置功能正在开发中，敬请期待');
        });

        const coin = this.createPlasticPanel(
            'HomeCoinResource', this.root, -151, topY, 164, 49,
            themeColor(THEME.hudPanel), rgba(75, 69, 142, 88), 24, 4,
            rgba(255, 255, 255, 210), rgba(255, 255, 255, 138),
        );
        this.drawCoinIcon(coin, -57, 2);
        this.coinLabel = this.addLabel(
            coin, '0', 23, 18, 1, 94,
            rgba(94, 80, 135), Label.HorizontalAlign.CENTER,
        );
        this.bindButton(coin, () => {
            this.handlers.onButtonClick?.();
            this.showToast('金币可用于购买道具和装饰');
        });

        const stamina = this.createPlasticPanel(
            'HomeStaminaResource', this.root, 51, topY, 186, 49,
            themeColor(THEME.hudPanel), rgba(75, 69, 142, 88), 24, 4,
            rgba(255, 255, 255, 210), rgba(255, 255, 255, 138),
        );
        this.drawHeartIcon(stamina, -63, 3, rgba(239, 75, 72));
        this.staminaLabel = this.addLabel(
            stamina, '10', 20, -63, 2, 52,
            themeColor(THEME.white), Label.HorizontalAlign.CENTER,
        );
        this.staminaStatusLabel = this.addLabel(
            stamina, '已满', 20, 7, 1, 98,
            rgba(103, 89, 137), Label.HorizontalAlign.CENTER,
        );
        this.drawPlusBadge(stamina, 71, 1, rgba(88, 206, 83));
        this.bindButton(stamina, () => {
            this.handlers.onButtonClick?.();
            this.showToast(`每 ${Math.round(this.common.staminaRecoverSec / 60)} 分钟恢复 1 点体力`);
        });
    }

    private buildCurrentLevel(): void {
        if (!this.root) return;
        const halfH = this.viewHeight / 2;

        const levelPill = this.createPlasticPanel(
            'HomeLevelPill', this.root, 3, halfH - 216, 200, 52,
            rgba(88, 86, 169, 190), rgba(56, 55, 128, 125), 28, 5,
            rgba(255, 255, 255, 58), rgba(255, 255, 255, 85),
        );
        this.levelPillLabel = this.addLabel(
            levelPill, '第1关', 34, 0, 1, 184,
            themeColor(THEME.white), Label.HorizontalAlign.CENTER,
        );
        this.bindButton(levelPill, () => {
            this.handlers.onButtonClick?.();
            this.openLevelSelect();
        });
        const albumY = halfH - 597;
        const album = new Node('CurrentArtworkCard');
        album.layer = Layers.Enum.UI_2D;
        this.root.addChild(album);
        album.setPosition(new Vec3(12, albumY, 0));
        album.addComponent(UITransform).setContentSize(502, 594);
        const albumGraphics = album.addComponent(Graphics);
        this.drawAlbumShell(albumGraphics);

        const preview = new Node('CurrentArtworkPreview');
        preview.layer = Layers.Enum.UI_2D;
        album.addChild(preview);
        preview.setPosition(new Vec3(47, -24, 0));
        preview.addComponent(UITransform).setContentSize(259, 299);
        this.previewGraphics = preview.addComponent(Graphics);
        this.bindButton(album, () => {
            this.handlers.onButtonClick?.();
            this.openLevelSelect();
        });
    }

    private buildSideFeatures(): void {
        if (!this.root) return;
        const halfH = this.viewHeight / 2;
        const dock = new Node('HomeFeatureDock');
        dock.layer = Layers.Enum.UI_2D;
        this.root.addChild(dock);
        dock.addComponent(UITransform).setContentSize(this.viewWidth, this.viewHeight);

        // The side rail is intentionally asymmetric: two small utility badges on the
        // left, one collection badge on the right, leaving the daily card centered.
        this.buildSideFeature(
            dock, 'more', '更多玩法', -314, -halfH + 394,
            true, 0, rgba(255, 211, 84),
        );
        const dailyY = -halfH + 296;
        this.buildSideFeature(
            dock, 'skin', '侧边栏', -314, dailyY - 44,
            this.saveData.level >= this.common.skinUnlockLevel,
            this.common.skinUnlockLevel,
            rgba(245, 131, 116),
        );
        this.buildSideFeature(
            dock, 'collection', '图鉴', 314, dailyY - 44,
            this.saveData.level >= COLLECTION_UNLOCK_LEVEL,
            COLLECTION_UNLOCK_LEVEL,
            rgba(178, 112, 220),
        );
    }

    private buildSideFeature(
        parent: Node,
        key: HomeSideFeature,
        label: string,
        x: number,
        y: number,
        unlocked: boolean,
        unlockLevel: number,
        accent: Color,
    ): void {
        const node = new Node(`HomeSideFeature_${key}`);
        node.layer = Layers.Enum.UI_2D;
        parent.addChild(node);
        node.setPosition(new Vec3(x, y, 0));
        node.addComponent(UITransform).setContentSize(128, 144);
        const g = node.addComponent(Graphics);
        const mutedAccent = unlocked ? accent : rgba(178, 166, 180);

        // Keep the benchmark silhouettes readable at phone scale: a single glossy
        // molded badge around one large command symbol. The previous illustration
        // skins contained several miniature craft objects and read as a different
        // UI set after downscaling.
        g.fillColor = rgba(62, 51, 120, 70);
        g.circle(0, 17, 56);
        g.fill();
        g.fillColor = rgba(255, 252, 243);
        g.circle(0, 22, 55);
        g.fill();
        g.strokeColor = unlocked ? rgba(119, 92, 220) : rgba(151, 143, 170);
        g.lineWidth = 5;
        g.circle(0, 22, 51);
        g.stroke();
        g.fillColor = unlocked
            ? rgba(255, 250, 239)
            : rgba(226, 224, 226);
        g.circle(0, 22, 45);
        g.fill();
        g.strokeColor = rgba(255, 255, 255, 195);
        g.lineWidth = 3;
        g.arc(-5, 27, 46, Math.PI * 0.2, Math.PI * 0.76, false);
        g.stroke();
        const iconScale = key === 'more' ? 1.55 : key === 'skin' ? 1.95 : 1.8;
        this.drawSideFeatureIcon(g, key, mutedAccent, 0, 22, iconScale);
        if (!unlocked) this.drawMiniLock(g, 29, 49, 0.82);

        const sideLabel = this.addShadowedLabel(
            node, label, 28, 0, key === 'more' ? -14 : key === 'skin' ? -28 : -33, 136,
            themeColor(THEME.white), rgba(69, 57, 128, 210),
            Label.HorizontalAlign.CENTER, 4,
        );
        this.addLabelOutline(sideLabel, rgba(92, 72, 157), 3);

        this.bindButton(node, () => {
            this.handlers.onButtonClick?.();
            if (!unlocked) {
                this.showToast(`第 ${unlockLevel} 关解锁${label}`);
                return;
            }
            if (key === 'more') this.showToast('更多玩法会随主线进度逐步开放');
            else this.showToast(`${label}功能正在开发中，敬请期待`);
        });
    }

    private buildBottomActions(): void {
        if (!this.root) return;
        const halfH = this.viewHeight / 2;

        const dailyY = -halfH + 289;
        const daily = this.createPlasticPanel(
            'HomeDailyPanel', this.root, 0, dailyY, 340, 112,
            rgba(153, 154, 157, 252), rgba(101, 102, 108, 230), 28, 8,
            rgba(202, 203, 207, 235), rgba(255, 255, 255, 170),
        );
        const dailyGraphics = daily.getComponent(Graphics)!;
        this.drawDailyMascot(dailyGraphics, -112, 4);

        const dailyTitle = this.addLabel(
            daily, '每日一关', 50, 45, -1, 218,
            themeColor(THEME.white), Label.HorizontalAlign.CENTER,
        );
        this.addLabelOutline(dailyTitle, rgba(83, 84, 89), 4);

        this.addPill(
            daily, 5, 55, 161, 47,
            rgba(88, 211, 98), rgba(48, 154, 76),
        );
        this.dailyBadgeLabel = this.addLabel(
            daily, '', 22, 5, 56, 151,
            themeColor(THEME.white), Label.HorizontalAlign.CENTER,
        );
        this.bindButton(daily, () => {
            this.handlers.onButtonClick?.();
            if (this.saveData.level < this.common.dailyUnlockLevel) {
                this.showToast(`第 ${this.common.dailyUnlockLevel} 关解锁每日一关`);
            } else {
                this.showToast('每日一关功能正在开发中，敬请期待');
            }
        });

        const startY = -halfH + 127;
        const start = new Node('ContinueLevelCard');
        start.layer = Layers.Enum.UI_2D;
        this.root.addChild(start);
        start.setPosition(new Vec3(4, startY, 0));
        start.addComponent(UITransform).setContentSize(388, 132);
        const authoredStartFrame = UiArtResources.getHomeStartButton();
        const authoredPrimaryFrame = UiArtResources.getHomePrimaryButton();
        const startFrame = USE_OPTIONAL_HOME_SKINS
            ? authoredStartFrame ?? authoredPrimaryFrame
            : null;
        if (startFrame) {
            const usesPrimaryButtonFrame = authoredPrimaryFrame !== null
                && startFrame === authoredPrimaryFrame;
            const skin = new Node('HomeStartButtonSkin');
            skin.layer = Layers.Enum.UI_2D;
            start.addChild(skin);
            // The primary PNG has transparent production padding; this exposes a
            // measured 380x132 face while the real touch target remains 388x132.
            skin.addComponent(UITransform).setContentSize(
                usesPrimaryButtonFrame ? 400 : 388,
                usesPrimaryButtonFrame ? 159 : 168,
            );
            const sprite = skin.addComponent(Sprite);
            sprite.sizeMode = Sprite.SizeMode.CUSTOM;
            sprite.spriteFrame = startFrame;
        } else {
            const startGraphics = start.addComponent(Graphics);
            this.drawStartButton(startGraphics, 388, 132);
        }
        // Keep live iconography separate from the optional Sprite skin. The skin
        // replaces only the button shell and must not remove the Graphics surface
        // used by the stamina-cost heart.
        const startOverlay = new Node('HomeStartButtonOverlay');
        startOverlay.layer = Layers.Enum.UI_2D;
        start.addChild(startOverlay);
        startOverlay.addComponent(UITransform).setContentSize(388, 132);
        startOverlay.addComponent(Graphics);

        const startTitle = this.addLabel(
            start, '开始游戏', 48, 0, 18, 350,
            rgba(255, 250, 231), Label.HorizontalAlign.CENTER,
        );
        startTitle.node.setScale(new Vec3(0.88, 1.08, 1));
        this.addLabelOutline(startTitle, rgba(205, 100, 40), 5);
        this.drawHeartIcon(startOverlay, -30, -28, rgba(239, 75, 72), 0.66);
        this.staminaCostLabel = this.addLabel(
            start, '- 1', 21, 29, -28, 100,
            rgba(50, 154, 71), Label.HorizontalAlign.LEFT,
        );
        this.bindButton(start, () => {
            this.handlers.onButtonClick?.();
            this.handlers.onStart(this.selectedLevelId);
        });
    }

    private buildToast(): void {
        if (!this.root) return;
        const node = new Node('HomeToast');
        node.layer = Layers.Enum.UI_2D;
        this.root.addChild(node);
        // Use the deliberate gap between album and bottom actions; a toast should not
        // cover the enlarged primary CTA or its stamina cost.
        node.setPosition(new Vec3(0, -this.viewHeight / 2 + 399, 0));
        const width = 540;
        const height = 62;
        node.addComponent(UITransform).setContentSize(width, height);
        const g = node.addComponent(Graphics);
        g.fillColor = themeColor(THEME.purpleDeep, 225);
        g.roundRect(-width / 2, -height / 2 - 5, width, height, 28);
        g.fill();
        g.fillColor = themeColor(THEME.accent, 245);
        g.roundRect(-width / 2, -height / 2, width, height, 28);
        g.fill();
        g.strokeColor = themeColor(THEME.panelStroke, 150);
        g.lineWidth = 2;
        g.roundRect(-width / 2, -height / 2, width, height, 28);
        g.stroke();
        this.toastLabel = this.addLabel(
            node, '', 20, 0, 0, width - 34,
            themeColor(THEME.white), Label.HorizontalAlign.CENTER,
        );
        node.active = false;
        this.toastNode = node;
    }

    /** Full-screen modal keeps the home hierarchy compact while making level choice explicit. */
    private buildLevelSelectOverlay(): void {
        if (!this.root) return;

        const overlay = new Node('HomeLevelSelectOverlay');
        overlay.layer = Layers.Enum.UI_2D;
        this.root.addChild(overlay);
        overlay.addComponent(UITransform).setContentSize(this.viewWidth, this.viewHeight);

        const backdrop = new Node('HomeLevelSelectBackdrop');
        backdrop.layer = Layers.Enum.UI_2D;
        overlay.addChild(backdrop);
        backdrop.addComponent(UITransform).setContentSize(this.viewWidth, this.viewHeight);
        const backdropGraphics = backdrop.addComponent(Graphics);
        backdropGraphics.fillColor = themeColor(THEME.scrim, 205);
        backdropGraphics.rect(-this.viewWidth / 2, -this.viewHeight / 2, this.viewWidth, this.viewHeight);
        backdropGraphics.fill();
        this.bindButton(backdrop, () => {
            this.handlers.onButtonClick?.();
            this.closeLevelSelect();
        }, false);

        const panel = this.createPlasticPanel(
            'HomeLevelSelectPanel', overlay, 0, 0, 620, 930,
            themeColor(THEME.hudPanel), themeColor(THEME.purpleDeep, 76), 40, 7,
            themeColor(THEME.panelStroke), rgba(255, 255, 255, 122),
        );
        // Consume empty panel taps so they never reach the backdrop or home controls.
        this.bindButton(panel, () => {}, false);
        const panelGraphics = panel.getComponent(Graphics)!;
        panelGraphics.fillColor = themeColor(THEME.lavender, 58);
        panelGraphics.roundRect(-282, 320, 564, 94, 26);
        panelGraphics.fill();
        panelGraphics.fillColor = themeColor(THEME.backgroundBottom, 156);
        panelGraphics.roundRect(-282, -443, 564, 98, 26);
        panelGraphics.fill();

        this.addShadowedLabel(
            panel, '选择关卡', 40, 0, 390, 310,
            themeColor(THEME.hudTextPrimary), rgba(255, 255, 255, 150),
            Label.HorizontalAlign.CENTER, 3,
        );
        this.addLabel(
            panel, '点击已解锁关卡即可切换图册', 19, 0, 346, 390,
            themeColor(THEME.hudTextSecondary), Label.HorizontalAlign.CENTER,
        );

        const close = this.createPlasticPanel(
            'HomeLevelSelectClose', panel, 252, 397, 66, 66,
            themeColor(THEME.cream), themeColor(THEME.purpleDeep, 74), 20, 4,
        );
        const closeGraphics = close.getComponent(Graphics)!;
        closeGraphics.strokeColor = themeColor(THEME.accent);
        closeGraphics.lineWidth = 6;
        closeGraphics.moveTo(-12, -12);
        closeGraphics.lineTo(12, 12);
        closeGraphics.moveTo(-12, 12);
        closeGraphics.lineTo(12, -12);
        closeGraphics.stroke();
        this.bindButton(close, () => {
            this.handlers.onButtonClick?.();
            this.closeLevelSelect();
        });

        const columns = 5;
        const columnGap = 108;
        const rowGap = 102;
        const trail = new Node('HomeLevelTrail');
        trail.layer = Layers.Enum.UI_2D;
        panel.addChild(trail);
        const trailGraphics = trail.addComponent(Graphics);
        // Six chapter shelves make the 30 levels read as one organized collection,
        // instead of a loose string of unrelated circular buttons.
        for (let row = 0; row < 6; row += 1) {
            const centerY = 263 - row * rowGap;
            trailGraphics.fillColor = row % 2 === 0
                ? themeColor(THEME.lavender, 42)
                : themeColor(THEME.backgroundBottom, 82);
            trailGraphics.roundRect(-282, centerY - 44, 564, 88, 20);
            trailGraphics.fill();
            trailGraphics.fillColor = themeColor(
                [THEME.coral, THEME.yellow, THEME.mint, THEME.blue, THEME.purple, THEME.pink][row],
                92,
            );
            trailGraphics.roundRect(-282, centerY - 44, 7, 88, 4);
            trailGraphics.fill();
        }
        for (let levelId = 1; levelId <= MAINLINE_LEVEL_COUNT; levelId += 1) {
            const index = levelId - 1;
            const row = Math.floor(index / columns);
            const forwardColumn = index % columns;
            const column = row % 2 === 0 ? forwardColumn : columns - 1 - forwardColumn;
            const button = new Node(`HomeLevelOption_${levelId}`);
            button.layer = Layers.Enum.UI_2D;
            panel.addChild(button);
            button.setPosition(new Vec3((column - 2) * columnGap, 263 - row * rowGap, 0));
            button.addComponent(UITransform).setContentSize(90, 90);
            const graphics = button.addComponent(Graphics);
            const label = this.addLabel(
                button, `${levelId}`, 24, 20, 0, 48,
                themeColor(THEME.hudTextPrimary), Label.HorizontalAlign.CENTER,
            );
            this.levelButtons.push({ levelId, graphics, label });
            this.bindButton(button, () => this.selectLevel(levelId));
        }

        this.levelSelectProgressLabel = this.addLabel(
            panel, '', 22, 0, -379, 340,
            themeColor(THEME.hudTextPrimary), Label.HorizontalAlign.CENTER,
        );
        this.levelSelectHintLabel = this.addLabel(
            panel, '', 17, 0, -421, 490,
            themeColor(THEME.hudTextSecondary), Label.HorizontalAlign.CENTER,
        );

        overlay.active = false;
        this.levelSelectOverlay = overlay;
        this.refreshLevelOptions();
    }

    private openLevelSelect(): void {
        if (!this.levelSelectOverlay) return;
        this.refreshLevelOptions();
        this.levelSelectOverlay.active = true;
        this.layoutDebugView?.setSuspended(true);
    }

    private closeLevelSelect(): void {
        if (this.levelSelectOverlay) this.levelSelectOverlay.active = false;
        this.layoutDebugView?.setSuspended(false);
    }

    private selectLevel(levelId: number): void {
        this.handlers.onButtonClick?.();
        if (levelId > this.saveData.level) {
            if (this.levelSelectHintLabel) {
                this.levelSelectHintLabel.string = `第 ${levelId} 关尚未解锁，请先完成第 ${this.saveData.level} 关`;
                this.levelSelectHintLabel.color = rgba(216, 92, 105);
            }
            return;
        }

        this.selectedLevelId = levelId;
        this.refresh();
        this.closeLevelSelect();
        this.showToast(`已选择第 ${levelId} 关`);
    }

    private refreshLevelOptions(): void {
        const unlocked = Math.max(1, Math.min(MAINLINE_LEVEL_COUNT, this.saveData.level));
        if (this.levelSelectProgressLabel) {
            this.levelSelectProgressLabel.string = `已解锁 ${unlocked} / ${MAINLINE_LEVEL_COUNT}`;
        }
        if (this.levelSelectHintLabel) {
            this.levelSelectHintLabel.string = '紫色为当前选择 · 绿点表示最新进度';
            this.levelSelectHintLabel.color = themeColor(THEME.hudTextSecondary);
        }
        for (const button of this.levelButtons) this.drawLevelOption(button);
    }

    private drawLevelOption(button: HomeLevelButton): void {
        const { levelId, graphics: g, label } = button;
        const unlocked = levelId <= this.saveData.level;
        const selected = levelId === this.selectedLevelId;
        const newest = levelId === this.saveData.level;
        g.clear();

        const width = 92;
        const height = 70;
        const radius = 17;
        if (selected) {
            g.fillColor = themeColor(THEME.yellow, 148);
            g.roundRect(-width / 2 - 4, -height / 2 - 4, width + 8, height + 8, radius + 4);
            g.fill();
        }
        g.fillColor = selected ? themeColor(THEME.purpleDeep, 118) : themeColor(THEME.panelShadow, 36);
        g.roundRect(-width / 2, -height / 2 - 5, width, height, radius);
        g.fill();
        g.fillColor = unlocked
            ? (selected ? themeColor(THEME.purple) : themeColor(THEME.hudPanel))
            : themeColor(THEME.lavender, 108);
        g.roundRect(-width / 2, -height / 2, width, height, radius);
        g.fill();
        g.strokeColor = selected
            ? themeColor(THEME.white, 216)
            : (unlocked ? themeColor(THEME.lavender, 178) : themeColor(THEME.lavender, 112));
        g.lineWidth = selected ? 3 : 2;
        g.roundRect(-width / 2 + 2, -height / 2 + 2, width - 4, height - 4, radius - 2);
        g.stroke();

        if (!unlocked) {
            this.drawMiniLock(g, -23, 2, 0.72);
            label.string = `${levelId}`;
            label.fontSize = 20;
            label.lineHeight = 26;
            label.node.setPosition(new Vec3(20, 0, 0));
            label.color = rgba(142, 132, 143);
            return;
        }

        const swatches = [THEME.coral, THEME.yellow, THEME.mint, THEME.blue, THEME.pink] as const;
        for (let bead = 0; bead < 3; bead += 1) {
            const beadX = -31 + (bead % 2) * 15;
            const beadY = bead === 2 ? -10 : 8;
            g.fillColor = themeColor(swatches[(levelId + bead) % swatches.length], selected ? 238 : 214);
            g.roundRect(beadX - 5, beadY - 5, 10, 10, 3);
            g.fill();
        }
        label.string = `${levelId}`;
        label.fontSize = 24;
        label.lineHeight = 30;
        label.node.setPosition(new Vec3(20, 0, 0));
        label.color = selected ? themeColor(THEME.white) : themeColor(THEME.hudTextPrimary);
        if (newest) {
            g.fillColor = themeColor(THEME.mintDeep);
            g.circle(36, 27, 7);
            g.fill();
            g.strokeColor = themeColor(THEME.white);
            g.lineWidth = 2;
            g.circle(36, 27, 5);
            g.stroke();
        }
    }

    private showToast(message: string): void {
        if (!this.toastNode || !this.toastLabel) return;
        this.toastLabel.string = message;
        this.toastNode.active = true;
        this.toastNode.setSiblingIndex(this.root?.children.length ? this.root.children.length - 1 : 0);
        if (this.toastTimer !== null) globalThis.clearTimeout(this.toastTimer);
        this.toastTimer = globalThis.setTimeout(() => {
            if (this.toastNode?.isValid) this.toastNode.active = false;
            this.toastTimer = null;
        }, 1700);
    }

    private drawAlbumShell(g: Graphics): void {
        // Three molded layers reproduce the thick display-book silhouette without
        // the extra concentric rails that made the previous version look ornate.
        g.fillColor = rgba(63, 60, 90, 48);
        g.roundRect(-250, -306, 502, 592, 68);
        g.fill();

        g.fillColor = rgba(186, 178, 153);
        g.roundRect(-250, -296, 502, 592, 68);
        g.fill();
        g.strokeColor = rgba(142, 137, 123, 190);
        g.lineWidth = 3;
        g.roundRect(-250, -296, 502, 592, 68);
        g.stroke();

        g.fillColor = rgba(225, 219, 201);
        g.roundRect(-229, -293, 475, 553, 58);
        g.fill();
        g.strokeColor = rgba(255, 255, 255, 150);
        g.lineWidth = 4;
        g.roundRect(-225, -288, 467, 544, 55);
        g.stroke();

        g.fillColor = rgba(244, 240, 230);
        g.roundRect(-203, -293, 450, 526, 58);
        g.fill();
        g.strokeColor = rgba(216, 210, 194, 225);
        g.lineWidth = 3;
        g.roundRect(-203, -293, 450, 526, 58);
        g.stroke();
        g.strokeColor = rgba(255, 255, 255, 185);
        g.lineWidth = 5;
        g.moveTo(-174, 207);
        g.bezierCurveTo(-78, 242, 116, 246, 205, 207);
        g.stroke();

        // One restrained page-depth seam is enough to explain the left spine.
        g.strokeColor = rgba(145, 139, 123, 105);
        g.lineWidth = 2;
        g.moveTo(-222, -216);
        g.lineTo(-222, 214);
        g.stroke();

        g.fillColor = rgba(92, 102, 137, 75);
        g.roundRect(-174, -87, 43, 137, 20);
        g.fill();
        g.fillColor = rgba(132, 157, 198);
        g.roundRect(-172, -81, 39, 133, 19);
        g.fill();
        g.fillColor = rgba(169, 193, 226);
        g.roundRect(-168, -75, 28, 121, 14);
        g.fill();
        g.fillColor = rgba(255, 255, 255, 108);
        g.roundRect(-164, -66, 6, 99, 3);
        g.fill();
    }

    private drawArtworkPreview(levelId: number): void {
        const g = this.previewGraphics;
        if (!g) return;
        g.clear();

        const width = 259;
        const height = 299;
        const radius = 4;
        g.fillColor = themeColor(THEME.panelShadow, 42);
        g.roundRect(-width / 2, -height / 2 - 5, width, height, radius);
        g.fill();
        g.fillColor = rgba(255, 244, 227, 255);
        g.roundRect(-width / 2, -height / 2, width, height, radius);
        g.fill();
        g.strokeColor = rgba(239, 184, 153, 205);
        g.lineWidth = 2;
        g.roundRect(-width / 2 + 1, -height / 2 + 1, width - 2, height - 2, radius - 1);
        g.stroke();

        if (this.referenceRingPreview) this.drawReferencePegField(g, width, height);

        let preview: HomeLevelPreview | null = null;
        try {
            preview = this.handlers.levelPreview?.(levelId) ?? null;
        } catch {
            preview = null;
        }

        if (preview?.grid.length && preview.grid.some((row) => row.length > 0)) {
            this.drawPreviewGrid(g, preview.grid, (colorId) => this.parseHexColor(preview!.colorHex(colorId)));
            return;
        }

        const fallback = [
            [0, 1, 1, 0, 1, 1, 0],
            [1, 1, 1, 1, 1, 1, 1],
            [1, 1, 1, 1, 1, 1, 1],
            [0, 1, 1, 1, 1, 1, 0],
            [0, 0, 1, 1, 1, 0, 0],
            [0, 0, 0, 1, 0, 0, 0],
        ];
        this.drawPreviewGrid(g, fallback, () => themeColor(THEME.pink));
    }

    private drawReferencePegField(g: Graphics, width: number, height: number): void {
        const spacing = 18;
        const radius = 2.6;
        const left = -width / 2 + 22;
        const right = width / 2 - 22;
        const bottom = -height / 2 + 22;
        const top = height / 2 - 22;
        for (let y = bottom; y <= top; y += spacing) {
            for (let x = left; x <= right; x += spacing) {
                g.fillColor = rgba(238, 168, 163, 92);
                g.circle(x, y, radius);
                g.fill();
                g.fillColor = rgba(255, 255, 255, 110);
                g.circle(x - 0.7, y + 0.8, Math.max(0.7, radius * 0.32));
                g.fill();
            }
        }
    }

    private drawPreviewGrid(
        g: Graphics,
        grid: ReadonlyArray<ReadonlyArray<number>>,
        colorFor: (colorId: number) => Color,
    ): void {
        // MapConfig grids frequently contain transparent padding. Fit the occupied
        // bounds, not the raw array, so a narrow/tall design remains legible on Home.
        let minRow = Number.POSITIVE_INFINITY;
        let maxRow = Number.NEGATIVE_INFINITY;
        let minCol = Number.POSITIVE_INFINITY;
        let maxCol = Number.NEGATIVE_INFINITY;
        for (let row = 0; row < grid.length; row += 1) {
            for (let col = 0; col < (grid[row]?.length ?? 0); col += 1) {
                if ((grid[row]?.[col] ?? 0) <= 0) continue;
                minRow = Math.min(minRow, row);
                maxRow = Math.max(maxRow, row);
                minCol = Math.min(minCol, col);
                maxCol = Math.max(maxCol, col);
            }
        }
        if (!Number.isFinite(minRow) || !Number.isFinite(minCol)) return;

        const occupiedRows = maxRow - minRow + 1;
        const occupiedCols = maxCol - minCol + 1;
        const cell = Math.min(56, 246 / occupiedCols, 278 / occupiedRows);
        const theme = this.common.m1.boardVisual;
        const beadSize = Math.max(6, cell * theme.beadSizeRatio);
        const beadStyle: Readonly<BeadVisualRenderStyle> = {
            beadSize,
            beadCornerRadius: beadSize * theme.beadCornerRadiusRatio,
            sideThicknessRatio: theme.sideThicknessRatio,
            sideDarken: theme.sideDarken,
            topFaceInsetRatio: theme.topFaceInsetRatio,
            topFaceBrightness: theme.topFaceBrightness,
            highlightAlpha: theme.highlightAlpha,
            highlightSizeRatio: theme.highlightSizeRatio,
            shadowOffsetX: cell * theme.shadowOffsetXRatio,
            shadowOffsetY: cell * theme.shadowOffsetYRatio,
            shadowAlpha: theme.shadowAlpha,
            shadowScaleRatio: theme.shadowScaleRatio,
            edgeAlpha: theme.edgeAlpha,
            matchedShadowFactor: theme.matchedShadowFactor,
            selectedScale: theme.selectedScale,
            selectedGlowWidth: theme.selectedGlowWidth,
            selectedGlowColor: withAlpha(this.parseHexColor(theme.selectedGlowHex), theme.selectedGlowAlpha),
        };
        const startX = -(occupiedCols - 1) * cell / 2;
        const startY = (occupiedRows - 1) * cell / 2;

        for (let row = minRow; row <= maxRow; row += 1) {
            for (let col = minCol; col <= maxCol; col += 1) {
                const colorId = grid[row]?.[col] ?? 0;
                if (colorId <= 0) continue;
                const x = startX + (col - minCol) * cell;
                const y = startY - (row - minRow) * cell;
                let beadColor: Color;
                try {
                    beadColor = colorFor(colorId);
                } catch {
                    beadColor = themeColor(THEME.pink);
                }
                if (this.referenceRingPreview) {
                    this.drawReferenceRingBead(g, beadColor, x, y, beadSize);
                } else {
                    BeadVisualRenderer.draw(g, beadColor, beadStyle, { matched: false, selected: false }, x, y);
                }
            }
        }
    }

    /**
     * The home showcase uses the hollow, low-profile bead silhouette from the
     * supplied reference. Gameplay boards continue to use BeadVisualRenderer;
     * this painter is intentionally scoped to the decorative home preview.
     */
    private drawReferenceRingBead(g: Graphics, color: Readonly<Color>, x: number, y: number, size: number): void {
        const outer = Math.max(4, size * 0.47);
        const shadow = Math.max(1, outer * 0.18);
        const source = new Color(color.r, color.g, color.b, color.a);
        g.fillColor = rgba(111, 70, 89, 92);
        g.ellipse(x + shadow * 0.35, y - shadow, outer + shadow, outer * 0.82);
        g.fill();

        g.fillColor = darken(source, 0.24, 255);
        g.circle(x, y, outer);
        g.fill();
        g.fillColor = source;
        g.circle(x, y + outer * 0.06, outer * 0.84);
        g.fill();
        g.fillColor = rgba(255, 245, 229, 245);
        g.circle(x, y + outer * 0.08, outer * 0.34);
        g.fill();
        g.fillColor = rgba(182, 111, 119, 135);
        g.circle(x, y + outer * 0.08, outer * 0.18);
        g.fill();
        g.fillColor = rgba(255, 255, 255, 160);
        g.circle(x - outer * 0.28, y + outer * 0.36, Math.max(1, outer * 0.12));
        g.fill();
    }

    private drawStartButton(g: Graphics, width: number, height: number): void {
        const x = -width / 2;
        const buttonHeight = Math.max(72, height - 6);
        const y = -buttonHeight / 2;
        const radius = 34;
        g.fillColor = themeColor(THEME.coral, 115);
        g.roundRect(x + 4, y - 10, width - 8, buttonHeight, radius);
        g.fill();
        g.fillColor = themeColor(THEME.gold);
        g.roundRect(x, y - 4, width, buttonHeight, radius);
        g.fill();
        g.fillColor = themeColor(THEME.yellow);
        g.roundRect(x, y, width, buttonHeight, radius);
        g.fill();
        g.strokeColor = rgba(255, 252, 225, 230);
        g.lineWidth = 2;
        g.roundRect(x + 3, y + 3, width - 6, buttonHeight - 6, radius - 3);
        g.stroke();
        g.fillColor = rgba(255, 255, 255, 130);
        g.roundRect(x + 34, y + buttonHeight - 25, width - 68, 7, 4);
        g.fill();
    }

    /**
     * Adds an optional authored skin without taking ownership of the parent
     * node's labels, hit target, or gameplay state.  Generated files are
     * deliberately rendered at their measured face size; they are never used
     * as a screenshot overlay or a crop of the reference image.
     */
    private addSpriteSkin(
        parent: Node,
        name: string,
        frame: SpriteFrame,
        width: number,
        height: number,
    ): Node {
        const skin = new Node(name);
        skin.layer = Layers.Enum.UI_2D;
        parent.addChild(skin);
        skin.addComponent(UITransform).setContentSize(width, height);
        const sprite = skin.addComponent(Sprite);
        sprite.sizeMode = Sprite.SizeMode.CUSTOM;
        sprite.spriteFrame = frame;
        return skin;
    }

    private createPlasticPanel(
        name: string,
        parent: Node,
        x: number,
        y: number,
        width: number,
        height: number,
        fill: Color,
        shadow: Color,
        radius: number,
        depth: number,
        stroke: Color = rgba(226, 229, 249),
        highlight: Color = rgba(255, 255, 255, 120),
        drawShell: boolean = true,
    ): Node {
        const node = new Node(name);
        node.layer = Layers.Enum.UI_2D;
        parent.addChild(node);
        node.setPosition(new Vec3(x, y, 0));
        node.addComponent(UITransform).setContentSize(width, height);
        const g = node.addComponent(Graphics);
        if (drawShell) {
            g.fillColor = shadow;
            g.roundRect(-width / 2, -height / 2 - depth, width, height, radius);
            g.fill();
            g.fillColor = fill;
            g.roundRect(-width / 2, -height / 2, width, height, radius);
            g.fill();
            g.strokeColor = stroke;
            g.lineWidth = 3;
            g.roundRect(-width / 2 + 2, -height / 2 + 2, width - 4, height - 4, Math.max(1, radius - 2));
            g.stroke();
            g.strokeColor = highlight;
            g.lineWidth = 1;
            g.moveTo(-width / 2 + radius, height / 2 - 8);
            g.bezierCurveTo(-width / 5, height / 2 + 1, width / 5, height / 2 + 1, width / 2 - radius, height / 2 - 8);
            g.stroke();
        }
        return node;
    }

    private addPill(
        parent: Node,
        x: number,
        y: number,
        width: number,
        height: number,
        fill: Color,
        shadow: Color,
    ): void {
        const g = parent.getComponent(Graphics);
        if (!g) return;
        g.fillColor = shadow;
        g.roundRect(x - width / 2, y - height / 2 - 4, width, height, height / 2);
        g.fill();
        g.fillColor = fill;
        g.roundRect(x - width / 2, y - height / 2, width, height, height / 2);
        g.fill();
        g.strokeColor = rgba(255, 255, 255, 185);
        g.lineWidth = 2;
        g.roundRect(x - width / 2 + 2, y - height / 2 + 2, width - 4, height - 4, height / 2 - 2);
        g.stroke();
    }

    private drawCoinIcon(parent: Node, x: number, y: number): void {
        const g = parent.getComponent(Graphics)!;
        g.fillColor = rgba(214, 137, 12);
        g.circle(x, y - 4, 24);
        g.fill();
        g.fillColor = rgba(255, 190, 22);
        g.circle(x, y + 1, 24);
        g.fill();
        g.strokeColor = rgba(255, 230, 112);
        g.lineWidth = 4;
        g.circle(x, y + 1, 17);
        g.stroke();
        g.fillColor = rgba(255, 247, 195, 175);
        g.circle(x - 7, y + 9, 5);
        g.fill();
        g.fillColor = rgba(255, 225, 83);
        this.drawRadialShape(g, x, y + 1, 10, 4.6, 5, -Math.PI / 2);
        g.strokeColor = rgba(213, 139, 14);
        g.lineWidth = 2;
        this.strokeRadialShape(g, x, y + 1, 10, 4.6, 5, -Math.PI / 2);
    }

    private drawHeartIcon(parent: Node, x: number, y: number, color: Color, scale: number = 1): void {
        const g = parent.getComponent(Graphics)!;
        g.fillColor = darken(color, 0.25);
        this.fillHeart(g, x, y - 4 * scale, scale);
        g.fillColor = color;
        this.fillHeart(g, x, y, scale);
        g.fillColor = rgba(255, 255, 255, 125);
        g.circle(x - 8 * scale, y + 9 * scale, Math.max(2, 4 * scale));
        g.fill();
    }

    private fillHeart(g: Graphics, x: number, y: number, scale: number): void {
        const radius = 12 * scale;
        g.circle(x - 10 * scale, y + 7 * scale, radius);
        g.fill();
        g.circle(x + 10 * scale, y + 7 * scale, radius);
        g.fill();
        g.moveTo(x - 21 * scale, y + 6 * scale);
        g.lineTo(x + 21 * scale, y + 6 * scale);
        g.lineTo(x, y - 22 * scale);
        g.close();
        g.fill();
    }

    private drawPlusBadge(parent: Node, x: number, y: number, color: Color): void {
        const g = parent.getComponent(Graphics)!;
        g.fillColor = darken(color, 0.22);
        g.circle(x, y - 3, 19);
        g.fill();
        g.fillColor = color;
        g.circle(x, y, 19);
        g.fill();
        g.strokeColor = rgba(255, 255, 255, 230);
        g.lineWidth = 4;
        g.moveTo(x - 8, y);
        g.lineTo(x + 8, y);
        g.moveTo(x, y - 8);
        g.lineTo(x, y + 8);
        g.stroke();
    }

    private drawSettingsIcon(parent: Node, x: number, y: number): void {
        const g = parent.getComponent(Graphics)!;
        g.fillColor = themeColor(THEME.accent, 205);
        this.drawRadialShape(g, x, y, 29, 22, 10, -Math.PI / 2);
        g.fillColor = themeColor(THEME.hudPanel);
        g.circle(x, y, 12);
        g.fill();
        g.fillColor = themeColor(THEME.accent, 205);
        g.circle(x, y, 7);
        g.fill();
        g.fillColor = rgba(255, 255, 255, 115);
        g.circle(x - 3, y + 4, 2.5);
        g.fill();
    }

    private drawRadialShape(
        g: Graphics,
        x: number,
        y: number,
        outerRadius: number,
        innerRadius: number,
        points: number,
        rotation: number,
    ): void {
        for (let index = 0; index < points * 2; index += 1) {
            const radius = index % 2 === 0 ? outerRadius : innerRadius;
            const angle = rotation + index * Math.PI / points;
            const px = x + Math.cos(angle) * radius;
            const py = y + Math.sin(angle) * radius;
            if (index === 0) g.moveTo(px, py);
            else g.lineTo(px, py);
        }
        g.close();
        g.fill();
    }

    private strokeRadialShape(
        g: Graphics,
        x: number,
        y: number,
        outerRadius: number,
        innerRadius: number,
        points: number,
        rotation: number,
    ): void {
        for (let index = 0; index < points * 2; index += 1) {
            const radius = index % 2 === 0 ? outerRadius : innerRadius;
            const angle = rotation + index * Math.PI / points;
            const px = x + Math.cos(angle) * radius;
            const py = y + Math.sin(angle) * radius;
            if (index === 0) g.moveTo(px, py);
            else g.lineTo(px, py);
        }
        g.close();
        g.stroke();
    }

    private drawSideFeatureIcon(
        g: Graphics,
        key: HomeSideFeature,
        accent: Color,
        x: number,
        y: number,
        scale: number = 1,
    ): void {
        const s = Math.max(0.5, scale);
        if (key === 'more') {
            g.fillColor = rgba(190, 116, 27, 210);
            g.roundRect(x - 29 * s, y - 17 * s, 58 * s, 32 * s, 14 * s);
            g.fill();
            g.fillColor = rgba(255, 223, 75);
            g.roundRect(x - 29 * s, y - 14 * s, 58 * s, 30 * s, 14 * s);
            g.fill();
            g.fillColor = rgba(255, 249, 224);
            g.roundRect(x - 24 * s, y - 10 * s, 48 * s, 23 * s, 10 * s);
            g.fill();
            g.strokeColor = rgba(235, 167, 30);
            g.lineWidth = 2.5 * s;
            g.roundRect(x - 24 * s, y - 10 * s, 48 * s, 23 * s, 10 * s);
            g.stroke();
            g.fillColor = rgba(247, 177, 25);
            g.roundRect(x - 17 * s, y - 4 * s, 14 * s, 5 * s, 2 * s);
            g.fill();
            g.roundRect(x - 12.5 * s, y - 8.5 * s, 5 * s, 14 * s, 2 * s);
            g.fill();
            g.fillColor = rgba(239, 82, 83);
            g.circle(x + 9 * s, y + 3 * s, 4.5 * s);
            g.fill();
            g.fillColor = rgba(242, 103, 154);
            g.circle(x + 19 * s, y - 3 * s, 4.5 * s);
            g.fill();
            g.fillColor = rgba(89, 171, 235);
            g.circle(x + 16 * s, y + 9 * s, 2.5 * s);
            g.fill();
            return;
        }
        if (key === 'skin') {
            g.fillColor = rgba(108, 70, 176, 120);
            g.roundRect(x - 27 * s, y - 20 * s, 54 * s, 39 * s, 8 * s);
            g.fill();
            g.fillColor = rgba(231, 87, 146);
            g.roundRect(x - 26 * s, y - 17 * s, 52 * s, 36 * s, 8 * s);
            g.fill();
            g.fillColor = rgba(245, 118, 159);
            g.roundRect(x - 29 * s, y + 5 * s, 58 * s, 13 * s, 6 * s);
            g.fill();
            g.fillColor = rgba(255, 197, 39);
            g.rect(x - 4.5 * s, y - 17 * s, 9 * s, 36 * s);
            g.fill();
            g.fillColor = rgba(255, 221, 65);
            g.circle(x - 11 * s, y + 19 * s, 11 * s);
            g.fill();
            g.circle(x + 11 * s, y + 19 * s, 11 * s);
            g.fill();
            g.fillColor = rgba(255, 174, 26);
            g.circle(x, y + 16 * s, 6 * s);
            g.fill();
            g.fillColor = rgba(255, 255, 255, 115);
            g.roundRect(x - 21 * s, y + 9 * s, 15 * s, 3 * s, 1.5 * s);
            g.fill();
            return;
        }
        const coverPoints: ReadonlyArray<readonly [number, number]> = [
            [x - 25 * s, y - 22 * s],
            [x + 21 * s, y - 27 * s],
            [x + 27 * s, y + 21 * s],
            [x - 19 * s, y + 26 * s],
        ];
        const shadowPoints: ReadonlyArray<readonly [number, number]> = coverPoints
            .map(([px, py]) => [px, py - 3 * s] as const);
        g.fillColor = rgba(91, 51, 162, 160);
        this.fillPolygon(g, shadowPoints, g.fillColor);
        g.fillColor = rgba(168, 91, 220);
        this.fillPolygon(g, coverPoints, g.fillColor);
        g.strokeColor = rgba(255, 224, 250);
        g.lineWidth = 3 * s;
        g.moveTo(coverPoints[0][0], coverPoints[0][1]);
        for (let index = 1; index < coverPoints.length; index += 1) {
            g.lineTo(coverPoints[index][0], coverPoints[index][1]);
        }
        g.close();
        g.stroke();
        g.fillColor = rgba(242, 187, 236);
        g.roundRect(x - 12 * s, y - 12 * s, 25 * s, 27 * s, 4 * s);
        g.fill();
        g.strokeColor = rgba(255, 245, 253);
        g.lineWidth = 2 * s;
        g.roundRect(x - 12 * s, y - 12 * s, 25 * s, 27 * s, 4 * s);
        g.stroke();
        g.fillColor = rgba(173, 83, 200);
        this.fillHeart(g, x + 1 * s, y + 1 * s, 0.34 * s);
        g.fillColor = rgba(255, 255, 255, 155);
        g.roundRect(x - 14 * s, y + 18 * s, 25 * s, 3 * s, 1.5 * s);
        g.fill();
    }

    private drawMiniLock(g: Graphics, x: number, y: number, scale: number = 1): void {
        const s = Math.max(0.5, scale);
        g.fillColor = themeColor(THEME.purpleDeep, 175);
        g.circle(x, y, 16 * s);
        g.fill();
        g.strokeColor = themeColor(THEME.white);
        g.lineWidth = 2 * s;
        g.arc(x, y + 4 * s, 6 * s, 0, Math.PI, true);
        g.stroke();
        g.fillColor = themeColor(THEME.white);
        g.roundRect(x - 7 * s, y - 8 * s, 14 * s, 11 * s, 3 * s);
        g.fill();
    }

    private drawDailyRosette(g: Graphics, x: number, y: number): void {
        const petals = [THEME.coral, THEME.yellow, THEME.mint, THEME.blue, THEME.pink] as const;
        for (let index = 0; index < 5; index += 1) {
            const angle = -Math.PI / 2 + index * Math.PI * 2 / 5;
            const px = x + Math.cos(angle) * 19;
            const py = y + Math.sin(angle) * 19;
            g.fillColor = themeColor(petals[index], 232);
            g.circle(px, py, 9);
            g.fill();
            g.fillColor = themeColor(THEME.white, 112);
            g.circle(px - 2, py + 2, 2);
            g.fill();
        }
        g.fillColor = themeColor(THEME.purpleDeep, 198);
        g.circle(x, y, 11);
        g.fill();
        g.fillColor = themeColor(THEME.cream);
        g.circle(x - 3, y + 3, 3);
        g.fill();
    }

    private drawDailyMascot(g: Graphics, x: number, y: number): void {
        g.fillColor = rgba(77, 78, 84, 115);
        g.circle(x, y - 4, 45);
        g.fill();
        g.fillColor = rgba(246, 246, 240);
        g.circle(x, y, 43);
        g.fill();
        g.strokeColor = rgba(188, 189, 188);
        g.lineWidth = 3;
        g.circle(x, y, 40);
        g.stroke();

        g.fillColor = rgba(117, 119, 122);
        g.circle(x - 22, y + 18, 12);
        g.fill();
        g.circle(x + 22, y + 18, 12);
        g.fill();
        g.fillColor = rgba(198, 200, 199);
        g.circle(x, y - 14, 24);
        g.fill();
        g.circle(x, y + 10, 28);
        g.fill();
        for (const [dx, dy, radius] of [[-13, 31, 9], [0, 35, 10], [14, 30, 8]] as const) {
            g.circle(x + dx, y + dy, radius);
            g.fill();
        }
        g.fillColor = rgba(233, 233, 228);
        g.circle(x + 5, y + 7, 21);
        g.fill();
        g.fillColor = rgba(72, 74, 76);
        g.circle(x - 9, y + 14, 4.5);
        g.fill();
        g.circle(x + 10, y + 14, 4.5);
        g.fill();
        g.fillColor = rgba(255, 255, 255, 220);
        g.circle(x - 10, y + 16, 1.5);
        g.fill();
        g.circle(x + 9, y + 16, 1.5);
        g.fill();
        g.fillColor = rgba(70, 70, 72);
        g.circle(x + 1, y + 4, 5);
        g.fill();
        g.strokeColor = rgba(77, 77, 79);
        g.lineWidth = 2;
        g.arc(x + 1, y - 2, 9, Math.PI * 0.13, Math.PI * 0.87, true);
        g.stroke();
        g.fillColor = rgba(236, 237, 232);
        g.circle(x - 16, y - 22, 8);
        g.fill();
        g.circle(x + 17, y - 22, 8);
        g.fill();
        g.strokeColor = rgba(255, 255, 255, 175);
        g.lineWidth = 3;
        g.arc(x - 5, y + 5, 31, Math.PI * 0.16, Math.PI * 0.68, false);
        g.stroke();
    }

    private drawBeadMascot(g: Graphics, x: number, y: number): void {
        g.fillColor = themeColor(THEME.purpleDeep, 150);
        g.circle(x, y, 27);
        g.fill();
        g.fillColor = themeColor(THEME.lavender);
        g.circle(x, y + 3, 23);
        g.fill();
        g.fillColor = themeColor(THEME.cream);
        g.circle(x - 8, y + 10, 7);
        g.fill();
        g.circle(x + 8, y + 10, 7);
        g.fill();
        g.fillColor = themeColor(THEME.purpleDeep);
        g.circle(x - 7, y + 10, 3);
        g.fill();
        g.circle(x + 7, y + 10, 3);
        g.fill();
        g.strokeColor = themeColor(THEME.purpleDeep);
        g.lineWidth = 2;
        g.arc(x, y - 2, 11, Math.PI * 0.12, Math.PI * 0.88, false);
        g.stroke();
    }

    private fillPolygon(g: Graphics, points: ReadonlyArray<readonly [number, number]>, color: Color): void {
        if (points.length < 3) return;
        g.fillColor = color;
        g.moveTo(points[0][0], points[0][1]);
        for (let index = 1; index < points.length; index += 1) {
            g.lineTo(points[index][0], points[index][1]);
        }
        g.close();
        g.fill();
    }

    private bindButton(node: Node, handler: () => void, scaleFeedback: boolean = true): void {
        const onStart = (event: EventTouch): void => {
            event.propagationStopped = true;
            if (scaleFeedback) node.setScale(new Vec3(0.97, 0.97, 1));
        };
        const onCancel = (event: EventTouch): void => {
            event.propagationStopped = true;
            if (scaleFeedback) node.setScale(Vec3.ONE);
        };
        const onEnd = (event: EventTouch): void => {
            event.propagationStopped = true;
            if (scaleFeedback) node.setScale(Vec3.ONE);
            this.lastTouchEndAt = Date.now();
            handler();
        };
        // Creator Preview and desktop Web builds deliver mouse input rather than
        // touch input. The synthetic mouse release can land on a control inside a
        // modal opened by TOUCH_END, so this guard is shared by every Home button.
        const onMouseUp = (): void => {
            if (Date.now() - this.lastTouchEndAt < 250) return;
            if (scaleFeedback) node.setScale(Vec3.ONE);
            handler();
        };
        const onEnter = (): void => {
            if (scaleFeedback) node.setScale(new Vec3(1.03, 1.03, 1));
        };
        const onLeave = (): void => {
            if (scaleFeedback) node.setScale(Vec3.ONE);
        };
        node.on(Node.EventType.TOUCH_START, onStart, this);
        node.on(Node.EventType.TOUCH_END, onEnd, this);
        node.on(Node.EventType.TOUCH_CANCEL, onCancel, this);
        node.on(Node.EventType.MOUSE_UP, onMouseUp, this);
        node.on(Node.EventType.MOUSE_ENTER, onEnter, this);
        node.on(Node.EventType.MOUSE_LEAVE, onLeave, this);
        this.boundButtons.push({ node, onStart, onEnd, onCancel, onMouseUp, onEnter, onLeave });
    }

    private parseHexColor(hex: string): Color {
        const normalized = hex.trim().replace(/^#/, '');
        if (!/^[0-9a-fA-F]{6}$/.test(normalized)) return themeColor(THEME.pink);
        return new Color(
            Number.parseInt(normalized.slice(0, 2), 16),
            Number.parseInt(normalized.slice(2, 4), 16),
            Number.parseInt(normalized.slice(4, 6), 16),
            255,
        );
    }

    private addShadowedLabel(
        parent: Node,
        text: string,
        fontSize: number,
        x: number,
        y: number,
        width: number,
        color: Color,
        shadow: Color,
        align: HorizontalTextAlignment,
        shadowOffset: number,
    ): Label {
        this.addLabel(parent, text, fontSize, x, y - shadowOffset, width, shadow, align);
        return this.addLabel(parent, text, fontSize, x, y, width, color, align);
    }

    private addLabelOutline(label: Label, color: Color, width: number): void {
        const outline = label.node.addComponent(LabelOutline);
        outline.color = color;
        outline.width = width;
    }

    private addLabel(
        parent: Node,
        text: string,
        fontSize: number,
        x: number,
        y: number,
        width: number,
        color: Color,
        align: HorizontalTextAlignment,
    ): Label {
        const node = new Node('HomeLabel');
        node.layer = Layers.Enum.UI_2D;
        parent.addChild(node);
        node.setPosition(new Vec3(x, y, 0));
        node.addComponent(UITransform).setContentSize(width, Math.max(38, fontSize * 1.55));
        const label = node.addComponent(Label);
        label.string = text;
        label.fontSize = fontSize;
        label.lineHeight = Math.ceil(fontSize * 1.24);
        label.overflow = Label.Overflow.SHRINK;
        label.enableWrapText = false;
        label.horizontalAlign = align;
        label.verticalAlign = Label.VerticalAlign.CENTER;
        label.color = color;
        return label;
    }
}
