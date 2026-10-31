import "server-only";

import { moveList } from "@/lib/mock-data";

type MoveListDirection = Parameters<typeof moveList>[1];
type Lists = ReturnType<typeof moveList>;

export interface MoveListRouteData {
  lists: Lists;
}

export function moveListRouteData(listId: string, direction: MoveListDirection): MoveListRouteData {
  return {
    lists: moveList(listId, direction)
  };
}
