export type TokenRequest = {
  identity: string;
  roomName: string;
};

export type TokenResponse = {
  token: string;
  wsUrl: string;
};

export type SessionConfig = {
  serverUrl: string;
  roomName: string;
  identity: string;
  e2eeKey?: string;
  transcriptionEnabled: boolean;
};
