import { FakeBackend } from '../services/fakeBackend';
import { AuthSession } from './auth';
import { ApiClient, type RoundApi } from './client';
import { ServerClock } from './clock';
import { env } from './env';
import { browserStorage } from './storage';
import { StreamClient, type StreamLike } from './stream';

export const serverClock = new ServerClock();

export const apiClient: ApiClient = new ApiClient({ baseUrl: env.apiUrl, getToken: (): string | null => authSession.token() });

export const authSession: AuthSession = new AuthSession({ api: apiClient, storage: browserStorage() });

let fakeBackend: FakeBackend | null = null;
let streamInstance: StreamLike | null = null;

export const isFakeMode = (): boolean => env.roundSource === 'fake';

export function getFakeBackend(): FakeBackend {
  fakeBackend ??= new FakeBackend({ scenario: env.fakeScenario, clock: serverClock });
  return fakeBackend;
}

export function getStream(): StreamLike {
  streamInstance ??= isFakeMode() ? getFakeBackend().stream : new StreamClient({ baseUrl: env.apiUrl, clock: serverClock });
  return streamInstance;
}

export function getRoundApi(): RoundApi {
  return isFakeMode() ? getFakeBackend().api : apiClient;
}

export const isBackendAvailable = (): boolean => isFakeMode() || apiClient.isEnabled();

export const serverNow = (): number => getStream().serverNow();

export const serverNowSec = (): number => Math.floor(serverNow() / 1000);
