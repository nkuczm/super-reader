export function startFixtures(port?: number): Promise<{ close: () => void }>;
export function startNoFeedSite(port?: number): Promise<{ close: () => void }>;
export function startSectionSite(
  port?: number,
  options?: { sectionHasFeed?: boolean },
): Promise<{ close: () => void }>;
export function startFakeX(port?: number): Promise<{
  calls: string[];
  close: () => void;
}>;
export function startBlockedHomepageSite(port?: number): Promise<{ close: () => void }>;
export function startAnchorFeedSite(port?: number): Promise<{ close: () => void }>;
export function startGuardedSite(port?: number): Promise<{ close: () => void }>;
export function startCommentSite(port?: number): Promise<{ close: () => void }>;
