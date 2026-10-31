export const HUB_AD_FIRST_ITEM_MIN = 1;
export const HUB_AD_FIRST_ITEM_MAX = 8;
export const HUB_AD_REPEAT_INTERVAL = 8;

export function randomFirstAdAfterItem(random: () => number = Math.random): number {
  const value = random();
  const bounded = Number.isFinite(value) ? Math.min(Math.max(value, 0), 0.9999999999999999) : 0;
  return HUB_AD_FIRST_ITEM_MIN + Math.floor(bounded * HUB_AD_FIRST_ITEM_MAX);
}

export function firstAdAfterItemFromSeed(seed:string|undefined,random:()=>number=Math.random):number{
  if(!seed)return randomFirstAdAfterItem(random);let hash=2166136261;
  for(let index=0;index<seed.length;index+=1){hash^=seed.charCodeAt(index);hash=Math.imul(hash,16777619);}
  return HUB_AD_FIRST_ITEM_MIN+((hash>>>0)%HUB_AD_FIRST_ITEM_MAX);
}

export function shouldInsertRecurringAd(
  zeroBasedItemIndex: number,
  firstAfterItem: number,
  repeatEveryItems = HUB_AD_REPEAT_INTERVAL,
): boolean {
  const organicItemPosition = zeroBasedItemIndex + 1;
  return organicItemPosition >= firstAfterItem
    && (organicItemPosition - firstAfterItem) % repeatEveryItems === 0;
}
