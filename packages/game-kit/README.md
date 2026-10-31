# @jkamma/game-kit

ゲームの作り方を揃えるための共通部品。作り方そのものは `docs/GAME_DEVELOPMENT.md`。

いちばん大事なのは `purity`。**ゲームの中身が描画を読んでいないこと**を、
文章ではなくテストで守らせる。ここが素のままでないと、中身の検証にブラウザが
要るようになり、ハーネスから直させられなくなる。

```js
import { Rng } from "@jkamma/game-kit/random";       // 決定的な乱数
import { createLoop } from "@jkamma/game-kit/loop";  // 固定刻みの進行
import * as vec from "@jkamma/game-kit/vec";          // 2次元
import { assertCoreIsPure } from "@jkamma/game-kit/purity";
```

素のJS + `.d.ts` で書いてある（`@jkamma/game-characters` と同じ形式）。
Vite+TS のゲームからも、`node --test` のゲームからも同じように使えるようにするため。
