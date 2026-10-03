// Quick chat (Scratch allows no free text): keys Z X C V B N send Net.QUICK_CHAT phrases, received ones pop up here.
import * as Net from "tts/net";
import * as Input from "tts/input";
import { game } from "./Stage";

let showUntil = 0;

/** @warp */
function trySend(key: Key, phrase: number) {
  const hit = Input.pressedOnce(key);
  if (hit) {
    Net.sendMessage(phrase);
    say(`You: ${Net.QUICK_CHAT[phrase]}`);
    showUntil = timer() + 2.5;
  }
}

whenFlag(() => {
  goTo(-150, 150);
  me.visible = true;
  say("");
  showUntil = 0;
  forever(() => {
    if (game.started && Net.session.slot > 0) {
      if (game.chatSend > 0) {
        // phrase picked on the touch chat menu
        Net.sendMessage(game.chatSend - 1);
        say(`You: ${Net.QUICK_CHAT[game.chatSend - 1]}`);
        showUntil = timer() + 2.5;
        game.chatSend = 0;
      }
      trySend("z", 0);
      trySend("x", 1);
      trySend("c", 2);
      trySend("v", 3);
      trySend("b", 4);
      trySend("n", 5);
      const got = Net.pollMessage();
      if (got) {
        say(`P${Net.messageFrom}: ${Net.message}`);
        showUntil = timer() + 3;
      }
    }
    if (showUntil > 0 && timer() > showUntil) {
      showUntil = 0;
      say("");
    }
  });
});
