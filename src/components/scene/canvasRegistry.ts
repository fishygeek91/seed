/**
 * A module-scope handle on the R3F canvas element, registered by SeedScene
 * at mount, so the film recorder can captureStream() from it without
 * threading refs through the component tree.
 */

export const CANVAS_REGISTRY: { el: HTMLCanvasElement | null } = { el: null };
