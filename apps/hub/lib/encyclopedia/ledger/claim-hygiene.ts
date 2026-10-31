/*
 * Claim text hygiene (docs/hubpedia-ledger.md section 2, "主張文の衛生"). A claim sentence is stored on its own and shown
 * without the paragraph it came from, so it must stand alone. The statement is repaired or rejected here; the verbatim
 * quote that backs it is never touched.
 *
 *  - Leading connectives that only join to the previous sentence (また、 さらに、 なお、 ...) are stripped.
 *  - Leading back-references (この間, このことは, それは, これは, ...) cannot be repaired without the missing antecedent:
 *    rejected.
 *  - A doubled or comma-led full stop (、。 。。) is repaired.
 *  - A sentence that ends on a bare case particle before the full stop (…で。 …が。) was cut mid-clause: rejected.
 */

/** Words that refer to something said before. A claim starting with one has no subject of its own. */
const DANGLING_START = /^(?:この間|そのため|このため|そのとき|その後|このことは|このことが|このことを|このことから|そのことは|それは|それが|それを|それらは|これは|これが|これを|これらは|これらが|あれは|同様に|同じく|こうして|こうした|そうした|その結果|この結果|その一方|この一方)/u;

/** Connectives that can simply be dropped; what follows is a complete sentence. */
const STRIPPABLE_START = /^(?:また|さらに|なお|ただし|そして|しかし|一方|加えて|ちなみに)[、,]\s*/u;

/** A case or binding particle right before the full stop: the clause was cut. */
const CUT_ENDING = /[がをにはでとへやも]。$/u;

export type HygieneVerdict =
  | { ok: true; statement: string; repaired: boolean }
  | { ok: false; reason: "dangling-start" | "cut-ending" | "empty" };

export function checkClaimStatement(raw: string): HygieneVerdict {
  let statement = raw.normalize("NFC").trim();
  let repaired = false;
  const strip = STRIPPABLE_START.exec(statement);
  if (strip) { statement = statement.slice(strip[0].length).trim(); repaired = true; }
  if (DANGLING_START.test(statement)) return { ok: false, reason: "dangling-start" };
  const tidy = statement.replace(/、。/gu, "。").replace(/。{2,}/gu, "。");
  if (tidy !== statement) { statement = tidy; repaired = true; }
  if (!statement) return { ok: false, reason: "empty" };
  if (CUT_ENDING.test(statement)) return { ok: false, reason: "cut-ending" };
  return { ok: true, statement, repaired };
}
