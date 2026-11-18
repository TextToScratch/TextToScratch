// TextToScratch ambient API. Every function here compiles to a Scratch block.
// SpriteName / CostumeName / BackdropName / SoundName come from the generated sprites.d.ts.

type Key =
  | "space" | "up arrow" | "down arrow" | "left arrow" | "right arrow" | "any"
  | "a" | "b" | "c" | "d" | "e" | "f" | "g" | "h" | "i" | "j" | "k" | "l" | "m"
  | "n" | "o" | "p" | "q" | "r" | "s" | "t" | "u" | "v" | "w" | "x" | "y" | "z"
  | "0" | "1" | "2" | "3" | "4" | "5" | "6" | "7" | "8" | "9";
type GraphicEffect = "color" | "fisheye" | "whirl" | "pixelate" | "mosaic" | "brightness" | "ghost";
type SoundEffect = "pitch" | "pan";
type PenParam = "color" | "saturation" | "brightness" | "transparency";
type Value = string | number | boolean;

// ---------- events (top level only) ----------
/** when green flag clicked */
declare function whenFlag(body: () => void): void;
/** when [key] key pressed */
declare function whenKey(key: Key, body: () => void): void;
/** when this sprite (or the stage) clicked */
declare function whenClicked(body: () => void): void;
/** when backdrop switches to [name] */
declare function whenBackdrop(name: BackdropName, body: () => void): void;
/** when [loudness/timer] > value */
declare function whenGreater(sensor: "loudness" | "timer", value: number, body: () => void): void;
/** when I receive [message] */
declare function onMessage(message: string, body: () => void): void;
/** when I start as a clone */
declare function onClone(body: () => void): void;
/** broadcast [message]: every `onMessage(message)` script starts; this script keeps going */
declare function broadcast(message: string): void;
/** broadcast [message] and wait: continues after every `onMessage(message)` script finishes */
declare function broadcastAndWait(message: string): void;

// ---------- motion ----------
/** move (steps) steps in the current direction */
declare function move(steps: number): void;
/** turn right (degrees) degrees */
declare function turnRight(degrees: number): void;
/** turn left (degrees) degrees */
declare function turnLeft(degrees: number): void;
/** go to x: (x) y: (y). The stage is 480x360 with (0, 0) in the middle */
declare function goTo(x: number, y: number): void;
/** go to sprite, "mouse" or "random" */
declare function goToTarget(target: SpriteName | "mouse" | "random"): void;
/** glide (secs) secs to x: (x) y: (y). Waits until the glide ends */
declare function glide(secs: number, x: number, y: number): void;
/** glide (secs) secs to a sprite, "mouse" or "random" position */
declare function glideToTarget(secs: number, target: SpriteName | "mouse" | "random"): void;
/** point in direction (degrees): 90 = right, 0 = up, -90 = left, 180 = down */
declare function pointInDirection(degrees: number): void;
/** point towards a sprite or the mouse pointer */
declare function pointTowards(target: SpriteName | "mouse"): void;
/** if on edge, bounce */
declare function bounceOnEdge(): void;

// ---------- looks ----------
/** say [message] (stays until the next say; `say("")` clears it) */
declare function say(message: Value): void;
/** say [message] for (secs) seconds. Waits */
declare function sayFor(message: Value, secs: number): void;
/** think [message] (thought bubble) */
declare function think(message: Value): void;
/** think [message] for (secs) seconds. Waits */
declare function thinkFor(message: Value, secs: number): void;
/** switch costume to a name (image file name without extension) or 1-based number */
declare function switchCostume(costume: CostumeName | number): void;
/** next costume (wraps around) */
declare function nextCostume(): void;
/** switch backdrop to a name or 1-based number */
declare function switchBackdrop(backdrop: BackdropName | number): void;
/** next backdrop (wraps around) */
declare function nextBackdrop(): void;
/** change [effect] effect by (by) */
declare function changeEffect(effect: GraphicEffect, by: number): void;
/** set [effect] effect to (value). ghost 100 = invisible, brightness -100..100 */
declare function setEffect(effect: GraphicEffect, value: number): void;
/** clear graphic effects */
declare function clearEffects(): void;
/** go to front layer */
declare function goToFront(): void;
/** go to back layer */
declare function goToBack(): void;
/** go forward (layers) layers */
declare function moveForward(layers: number): void;
/** go backward (layers) layers */
declare function moveBackward(layers: number): void;

// ---------- sound ----------
/** start sound (name = file name without extension, or 1-based number); does not wait */
declare function playSound(sound: SoundName | number): void;
/** play sound until done. Waits for the sound to finish */
declare function playSoundUntilDone(sound: SoundName | number): void;
/** stop all sounds */
declare function stopAllSounds(): void;
/** set [pitch/pan] sound effect to (value) */
declare function setSoundEffect(effect: SoundEffect, value: number): void;
/** change [pitch/pan] sound effect by (by) */
declare function changeSoundEffect(effect: SoundEffect, by: number): void;
/** clear sound effects */
declare function clearSoundEffects(): void;

// ---------- control ----------
/** wait (secs) seconds */
declare function wait(secs: number): void;
/** wait until <condition> is true */
declare function waitUntil(condition: () => boolean): void;
/** repeat (times): runs body that many times (one frame per loop) */
declare function repeat(times: number, body: () => void): void;
/** forever: runs body every frame until the script is stopped */
declare function forever(body: () => void): void;
/** stop all: stops every script of every sprite */
declare function stopAll(): void;
/** stop this script */
declare function stopThis(): void;
/** stop other scripts in this sprite */
declare function stopOthers(): void;
/** create clone of a sprite (default "myself"). The clone runs its `onClone` scripts */
declare function createClone(target?: SpriteName | "myself"): void;
/** delete this clone (does nothing on the original sprite) */
declare function deleteClone(): void;

// ---------- sensing ----------
/** touching a sprite, "edge" or "mouse"? */
declare function touching(target: SpriteName | "edge" | "mouse"): boolean;
/** touching color? Color as "#rrggbb" */
declare function touchingColor(color: string): boolean;
/** distance to a sprite or the mouse pointer */
declare function distanceTo(target: SpriteName | "mouse"): number;
/** ask [question] and wait: shows a text box; read the reply with `answer()` */
declare function askAndWait(question: Value): void;
/** the reply to the last `askAndWait` */
declare function answer(): string;
/** key [key] pressed? */
declare function keyPressed(key: Key): boolean;
/** mouse down? */
declare function mouseDown(): boolean;
/** mouse x (-240..240) */
declare function mouseX(): number;
/** mouse y (-180..180) */
declare function mouseY(): number;
/** microphone loudness (0..100) */
declare function loudness(): number;
/** seconds since the green flag or the last `resetTimer()` */
declare function timer(): number;
/** reset timer to 0 */
declare function resetTimer(): void;
/** days since 2000 (fractional) */
declare function daysSince2000(): number;
/** the Scratch username of the player ("" when not logged in) */
declare function username(): string;
/** current [year/month/date/dayofweek/hour/minute/second] */
declare function current(unit: "year" | "month" | "date" | "dayofweek" | "hour" | "minute" | "second"): number;
/** [property] of [sprite]; property may also be a sprite-local variable name */
declare function valueOf(
  target: SpriteName | "_stage_",
  property: "x position" | "y position" | "direction" | "costume #" | "costume name" | "size" | "volume" | "backdrop #" | "backdrop name" | (string & {})
): Value;

// ---------- operators ----------
/** pick random from..to (integers unless a decimal is passed) */
declare function random(from: number, to: number): number;
/** sin of an angle in degrees */
declare function sin(degrees: number): number;
/** cos of an angle in degrees */
declare function cos(degrees: number): number;
/** tan of an angle in degrees */
declare function tan(degrees: number): number;
/** asin, result in degrees */
declare function asin(x: number): number;
/** acos, result in degrees */
declare function acos(x: number): number;
/** atan, result in degrees */
declare function atan(x: number): number;

// ---------- variables / lists ----------
/** show variable / list monitor on the stage, e.g. `showVariable(game.score)` */
declare function showVariable(variable: Value | Value[], monitor?: { x?: number; y?: number; sliderMin?: number; sliderMax?: number; visible?: boolean; slider?: boolean }): void;
/** hide variable / list monitor */
declare function hideVariable(variable: Value | Value[]): void;
interface Array<T> {
  /** insert at 0-based index */
  insert(index: number, item: T): void;
  /** delete at 0-based index */
  remove(index: number): void;
  /** item is in the list */
  includes(item: T): boolean;
}
interface String {
  includes(text: string): boolean;
}

// ---------- pen ----------
/** pen down: the sprite draws a line as it moves */
declare function penDown(): void;
/** pen up */
declare function penUp(): void;
/** erase all pen drawings and stamps */
declare function penClear(): void;
/** stamp the sprite onto the pen layer */
declare function stamp(): void;
/** set pen color to "#rrggbb" */
declare function setPenColor(color: string): void;
/** set pen size to (size) */
declare function setPenSize(size: number): void;
/** change pen size by (by) */
declare function changePenSize(by: number): void;
/** set pen [color/saturation/brightness/transparency] to (value), 0..100 */
declare function setPenParam(param: PenParam, value: number): void;
/** change pen [color/saturation/brightness/transparency] by (by) */
declare function changePenParam(param: PenParam, by: number): void;

// ---------- this sprite ----------
/** This sprite (or the stage): position, direction, size, visibility. Assigning compiles to the matching block. */
declare const me: {
  x: number;
  y: number;
  direction: number;
  size: number;
  volume: number;
  visible: boolean;
  draggable: boolean;
  rotationStyle: "all around" | "left-right" | "don't rotate";
  readonly costumeNumber: number;
  readonly costumeName: string;
  readonly backdropNumber: number;
  readonly backdropName: string;
};
