// Survive Until Daylight: a 3D asymmetric horror game (one killer, four survivors) in the style of Dead by Daylight.
// The View sprite runs everything (game rules, bots, networking) and draws the 3D view with a raycaster that stamps
// wall slices and billboards onto the pen layer; Weapon draws the killer's weapon on top; Chat shows quick-chat lines.

/** Host -> clients world packet (tts/net already uses 7 of Scratch's 10 cloud variables). */
/** @cloud */
export const wcloud = { w: 0 };

export const game = {
  titleDone: false,
  started: false, // online session joined (quick chat on)
  chatSend: 0,
  weapon: -1, // killer weapon to show in first person (-1 none)
  swingAt: -9,
  carrying: false,
  touch: false, // on-screen touch controls
};

whenFlag(() => {
  switchBackdrop("menu");
  game.titleDone = false;
  game.started = false;
  game.chatSend = 0;
  game.weapon = -1;
  game.swingAt = -9;
  game.carrying = false;
  game.touch = false;
  forever(() => {
    playSoundUntilDone("ambience");
  });
});
