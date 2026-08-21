import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = process.env.PINDOU_PROJECT_ROOT ?? path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (relative: string): string => fs.readFileSync(path.join(root, relative), 'utf8');
const art = read('assets/ui/art/UiArtResources.ts');
const bootstrap = read('assets/core/GameBootstrap.ts');
const home = read('assets/ui/home/HomeView.ts');
const hud = read('assets/ui/M0TestHud.ts');

const expectedPngs: Readonly<Record<string, readonly [number, number]>> = {
    'assets/resources/ui/home/home_album_shell.png': [1040, 1168],
    'assets/resources/ui/home/home_start_button.png': [1024, 341],
    'assets/resources/ui/home/home_showcase_shell.png': [1161, 1355],
    'assets/resources/ui/home/home_primary_button.png': [2172, 724],
    'assets/resources/ui/home/home_daily_panel_art.png': [2048, 768],
    'assets/resources/ui/home/home_more_badge.png': [1254, 1254],
    'assets/resources/ui/home/home_dress_badge.png': [1254, 1254],
    'assets/resources/ui/home/home_collection_badge.png': [384, 384],
    'assets/resources/ui/home/home_daily_mascot.png': [384, 384],
    'assets/resources/ui/tools/tool_color_magnet.png': [256, 256],
    'assets/resources/ui/tools/tool_tray_brush.png': [256, 256],
    'assets/resources/ui/tools/tool_time_freeze.png': [256, 256],
};
for (const [assetPath, [expectedWidth, expectedHeight]] of Object.entries(expectedPngs)) {
    const absolutePath = path.join(root, assetPath);
    assert.ok(fs.existsSync(absolutePath), `authored UI asset exists: ${assetPath}`);
    const png = fs.readFileSync(absolutePath);
    assert.equal(png.subarray(1, 4).toString('ascii'), 'PNG', `${assetPath} is a PNG`);
    assert.equal(png.readUInt32BE(16), expectedWidth, `${assetPath} width`);
    assert.equal(png.readUInt32BE(20), expectedHeight, `${assetPath} height`);
    assert.equal(png[25], 6, `${assetPath} is RGBA PNG-32 with an alpha channel`);
}

const authorizedHomePngs: Readonly<Record<string, readonly [number, number, 2 | 6]>> = {
    'assets/resources/ui/home/home_room_background.png': [750, 1334, 2],
    'assets/resources/ui/home/home_board_frame.png': [1048, 1042, 6],
    'assets/resources/ui/home/home_level_plaque.png': [782, 408, 6],
    'assets/resources/ui/home/home_bead_jar.png': [290, 512, 6],
    'assets/resources/ui/home/home_more_badge_v2.png': [280, 280, 6],
    'assets/resources/ui/home/home_collection_badge_v2.png': [280, 280, 6],
    'assets/resources/ui/home/home_resource_hud.png': [720, 176, 6],
};
const authorizedAssetUuids = new Set<string>();
for (const [assetPath, [expectedWidth, expectedHeight, expectedColorType]] of Object.entries(authorizedHomePngs)) {
    const absolutePath = path.join(root, assetPath);
    assert.ok(fs.existsSync(absolutePath), `authorized home asset exists: ${assetPath}`);
    const png = fs.readFileSync(absolutePath);
    assert.equal(png.subarray(1, 4).toString('ascii'), 'PNG', `${assetPath} is a PNG`);
    assert.equal(png.readUInt32BE(16), expectedWidth, `${assetPath} width`);
    assert.equal(png.readUInt32BE(20), expectedHeight, `${assetPath} height`);
    assert.equal(png[25], expectedColorType, `${assetPath} PNG color type`);

    const metaPath = `${absolutePath}.meta`;
    assert.ok(fs.existsSync(metaPath), `Cocos metadata exists: ${assetPath}.meta`);
    const meta = JSON.parse(fs.readFileSync(metaPath, 'utf8')) as {
        uuid?: string;
        userData?: { hasAlpha?: boolean; redirect?: string };
    };
    assert.match(meta.uuid ?? '', /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i, `${assetPath} has a valid UUID`);
    assert.ok(!authorizedAssetUuids.has(meta.uuid!), `${assetPath} UUID is unique within the authorized set`);
    authorizedAssetUuids.add(meta.uuid!);
    assert.equal(meta.userData?.hasAlpha, expectedColorType === 6, `${assetPath} metadata alpha flag matches PNG`);
    assert.equal(meta.userData?.redirect, `${meta.uuid}@6c48a`, `${assetPath} redirects to its texture subresource`);
}

for (const texturePath of [
    'ui/home/home_start_button/texture',
    'ui/home/home_primary_button/texture',
    'ui/home/home_room_background/texture',
    'ui/home/home_board_frame/texture',
    'ui/home/home_level_plaque/texture',
    'ui/home/home_bead_jar/texture',
    'ui/home/home_more_badge_v2/texture',
    'ui/home/home_collection_badge_v2/texture',
    'ui/home/home_resource_hud/texture',
    'ui/tools/tool_color_magnet/texture',
    'ui/tools/tool_tray_brush/texture',
    'ui/tools/tool_time_freeze/texture',
]) {
    assert.ok(art.includes(texturePath), `UI art loader includes ${texturePath}`);
}
for (const unusedShellPath of [
    'ui/home/home_album_shell/texture',
    'ui/home/home_showcase_shell/texture',
    'ui/home/home_daily_panel_art/texture',
    'ui/home/home_more_badge/texture',
    'ui/home/home_dress_badge/texture',
    'ui/home/home_collection_badge/texture',
    'ui/home/home_daily_mascot/texture',
]) {
    assert.ok(!art.includes(unusedShellPath), `superseded shell is not decoded at runtime: ${unusedShellPath}`);
}

assert.match(art, /console\.warn\([\s\S]*Graphics fallback will be used/, 'optional art reports a warning and keeps the fallback path');
assert.doesNotMatch(art, /throw error/, 'optional UI art preload does not propagate a missing-asset failure');

const bootStart = bootstrap.indexOf('private async bootM1_8B(): Promise<void>');
const bootEnd = bootstrap.indexOf('private createRuntimeFactory(', bootStart);
const boot = bootStart >= 0 && bootEnd > bootStart ? bootstrap.slice(bootStart, bootEnd) : '';
const uiPreload = boot.indexOf('await UiArtResources.preload()');
assert.ok(uiPreload >= 0, 'original UI art is preloaded during application boot');
assert.doesNotMatch(boot, /ReferenceBeadAtlas|textures\/reference-/, 'UI preload has no copied bead-bundle dependency');
for (const construction of ['this.createRuntimeFactory(', 'this.bootExplicitDevLevel(', 'this.showHome()']) {
    assert.ok(boot.indexOf(construction) > uiPreload, `${construction} runs after optional UI art preload settles`);
}

assert.match(home, /setContentSize\(502, 594\)[\s\S]*drawAlbumShell\(albumGraphics\)/, 'home uses a code-authored album silhouette instead of the mismatched suitcase skin');
assert.match(home, /preview\.setPosition\(new Vec3\(47, -24, 0\)\)[\s\S]*setContentSize\(259, 299\)/, 'live artwork page matches the measured reference geometry');
assert.match(home, /const width = 259;[\s\S]*const height = 299;[\s\S]*const radius = 4;/, 'artwork page keeps the benchmark square-paper silhouette');
assert.doesNotMatch(home, /height \/ 2 - 48|height \/ 2 - 40/, 'artwork page omits the non-reference header rail');
assert.match(home, /getHomeStartButton\(\)[\s\S]*HomeStartButtonSkin[\s\S]*Sprite\.SizeMode\.CUSTOM/, 'home CTA uses the authored blank button skin');
assert.match(home, /usesPrimaryButtonFrame \? 400 : 388,[\s\S]*usesPrimaryButtonFrame \? 159 : 168,/, 'primary CTA compensates for transparent padding to expose the reference-sized visible face');
assert.match(home, /else \{[\s\S]*drawStartButton\(startGraphics/, 'home CTA retains the Graphics fallback');
assert.match(home, /HomeStartButtonOverlay[\s\S]*addComponent\(Graphics\)[\s\S]*drawHeartIcon\(startOverlay/, 'live stamina icon stays on a Graphics overlay above either button shell');
for (const getter of [
    'getHomeRoomBackground',
    'getHomeBoardFrame',
    'getHomeLevelPlaque',
    'getHomeBeadJar',
    'getHomeResourceHud',
]) {
    assert.ok(home.includes(`${getter}()`), `home consumes ${getter}`);
}
const topHudStart = home.indexOf('private buildReferenceTopHud(');
const topHudEnd = home.indexOf('private buildReferenceLevelCard(', topHudStart);
const topHud = topHudStart >= 0 && topHudEnd > topHudStart
    ? home.slice(topHudStart, topHudEnd)
    : '';
assert.match(topHud, /HomeResourceHudSkin[\s\S]*const drawHudShells = !authoredHud;/, 'authorized HUD skin replaces the old opaque panel shells');
assert.equal((topHud.match(/drawHudShells,/g) ?? []).length, 4, 'all four live HUD nodes suppress only their shell when the authored HUD is present');
assert.match(topHud, /if \(drawHudShells\) this\.drawReferenceGear\(settings\)/, 'the authored settings glyph is not double-painted');
assert.match(home, /drawShell: boolean = true[\s\S]*if \(drawShell\) \{[\s\S]*g\.roundRect/, 'plastic panels retain their complete Graphics fallback');
const referenceSideStart = home.indexOf('private createReferenceSideButton(');
const referenceSideEnd = home.indexOf('private drawReferenceGear(', referenceSideStart);
const referenceSide = referenceSideStart >= 0 && referenceSideEnd > referenceSideStart
    ? home.slice(referenceSideStart, referenceSideEnd)
    : '';
assert.match(referenceSide, /getHomeMoreBadge\(\)[\s\S]*getHomeCollectionBadge\(\)/, 'reference side buttons select both authorized badge skins');
assert.match(referenceSide, /HomeCollectionBadgeSkin[\s\S]*HomeMoreBadgeSkin[\s\S]*addSpriteSkin\(node/, 'authorized badge art is rendered as a child of the real touch node');
assert.match(referenceSide, /if \(authoredBadge\)[\s\S]*else \{[\s\S]*drawSideFeatureIcon\(/, 'reference side buttons retain their Graphics fallback when art is unavailable');
assert.match(referenceSide, /this\.addLabel\(node[\s\S]*collectionProgressLabel/, 'live side labels and collection progress remain outside the decorative skin');
assert.match(referenceSide, /this\.addLabel\(node, label, 24, 0, isCollection \? -55 : -62, 144,[\s\S]*`\$\{Math\.min\(19, this\.saveData\.level\)\} \/ 1000`, 20, 0, -82, 128,/, 'side labels use the enlarged phone-readable type scale and keep collection progress clear of the bottom edge');
assert.match(home, /const iconScale = key === 'more' \? 1\.55 : key === 'skin' \? 1\.95 : 1\.8;[\s\S]*drawSideFeatureIcon\(g, key, mutedAccent, 0, 22, iconScale\)/, 'side entries use benchmark-readable symbol-specific scale');
assert.match(home, /g\.circle\(0, 22, 55\)[\s\S]*g\.circle\(0, 22, 51\)/, 'side-entry molded ring has a stable phone-scale silhouette');
assert.match(home, /getHomeDailyPanel\(\)[\s\S]*HomeDailyPanelSkin[\s\S]*if \(!authoredDaily\)[\s\S]*g\.roundRect\(-287\.5, -83 - 8, 575, 166, 28\)/, 'daily card uses an optional no-text generated skin behind the live Graphics fallback');
assert.match(home, /`LV\.\$\{Math\.max\(1, this\.saveData\.level\)\}`, 26, 42, 12, 128,[\s\S]*'拼豆达人', 25, 42, -21, 136,/, 'profile identity uses a readable two-line hierarchy without crowding the avatar');
assert.match(home, /'第1关', 40, 0, 58, 300,[\s\S]*'甜甜草莓蛋糕', 36, 0, -4, 350,[\s\S]*'图鉴进度  19 \/ 1000', 25, 0, -53, 350,/, 'level plaque exposes a clear title-name-progress hierarchy');
assert.match(home, /'今日挑战', 29, 0, 65, 180,[\s\S]*'连续签到 7 天，领取奖励', 25, 16, 22, 410,[\s\S]*'3 \/ 7 天', 22, 121, -35, 96,/, 'daily card uses readable typography and natural Chinese spacing');
assert.match(home, /drawHeartIcon\(overlay, -76, -106,[\s\S]*'消耗 1 点体力', 24, 18, -111, 220,/, 'primary CTA supporting copy states the stamina unit clearly without colliding with its heart marker');
assert.match(home, /`图鉴进度  \$\{levelId\} \/ 1000`[\s\S]*`\$\{highestUnlockedLevel\} \/ 1000`[\s\S]*`消耗 \$\{levelCost\} 点体力`/, 'dynamic refresh paths preserve the polished copy after state changes');
assert.match(home, /drawDailyMascot\(dailyGraphics, -112, 4\)/, 'the daily card uses a neutral gray pet silhouette matching the benchmark hierarchy');
assert.match(home, /daily, 5, 55, 161, 47,[\s\S]*rgba\(88, 211, 98\), rgba\(48, 154, 76\)/, 'daily unlock information uses the measured green reference pill');

for (const getter of ['getToolColorMagnet', 'getToolTrayBrush', 'getToolTimeFreeze']) {
    assert.ok(hud.includes(`${getter}()`), `tool area uses ${getter}`);
}
assert.match(hud, /setContentSize\(60, 60\)[\s\S]*Sprite\.SizeMode\.CUSTOM/, 'tool art fills the redesigned 62px icon well without exceeding it');
assert.match(hud, /else \{[\s\S]*this\.drawToolIcon\(g, toolId/, 'tool icons keep the line-art fallback');

console.log('Optional UI art resource tests passed (preload, authored sprites and safe Graphics fallbacks).');
