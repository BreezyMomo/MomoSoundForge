export const DISTRIBUTION_SCHEMA: 'momo.sound-distribution/v1';
export type DistributionDescriptor = { schema: typeof DISTRIBUTION_SCHEMA; mode: 'local' | 'external'; baseUrl: string | null };
export function normalizeLibraryUrl(value?: string): string;
export function distributionDescriptor(baseUrl?: string): DistributionDescriptor;
export function parseDistribution(value: unknown): DistributionDescriptor;
export function createPublishedLibraryFetcher(site: string, fetcher?: (url: string) => Promise<Response>): (url: string) => Promise<Response>;
