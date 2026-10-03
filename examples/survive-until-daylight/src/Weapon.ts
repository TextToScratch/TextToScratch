// The killer's weapon in first person (bottom right). Swings when View sets game.swingAt; sags while carrying.
import { game } from "./Stage";

let bob = 0;

whenFlag(() => {
  me.visible = false;
  me.size = 100;
  goToFront();
  forever(() => {
    if (game.weapon >= 0) {
      const swing = timer() - game.swingAt < 0.28;
      switchCostume(game.weapon * 2 + 1 + (swing ? 1 : 0));
      bob = bob * 0.8 + (keyPressed("w") || keyPressed("s") || keyPressed("up arrow") ? sin(timer() * 500) * 5 : 0) * 0.2;
      goTo(150, -100 + bob - (game.carrying ? 40 : 0));
      me.visible = true;
      goToFront();
    } else {
      me.visible = false;
    }
  });
});
