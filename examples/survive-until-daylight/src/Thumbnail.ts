// Title card: on top of everything until the player clicks or presses space.
import { game } from "./Stage";

let clicked = false;

whenClicked(() => {
  clicked = true;
});

whenFlag(() => {
  clicked = false;
  goTo(0, 0);
  me.visible = true;
  goToFront();
  wait(0.3);
  waitUntil(() => clicked || mouseDown() || keyPressed("space"));
  if (!keyPressed("space")) game.touch = true; // started with a tap/click: touch buttons on (any movement key turns them off)
  playSound("begin");
  waitUntil(() => !mouseDown() && !keyPressed("space"));
  me.visible = false;
  game.titleDone = true;
});
