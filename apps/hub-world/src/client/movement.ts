/** Camera alpha points from the target to the camera in the XZ plane. */
export function movement(alpha: number, forward: number, side: number, distance: number) {
  const length = Math.hypot(forward, side);
  if (!length) return { x: 0, z: 0 };
  return {
    x: (-Math.cos(alpha) * forward - Math.sin(alpha) * side) / length * distance,
    z: (-Math.sin(alpha) * forward + Math.cos(alpha) * side) / length * distance
  };
}
