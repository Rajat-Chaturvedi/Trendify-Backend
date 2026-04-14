export interface AuthTokenPair {
  accessToken: string;
  refreshToken: string;
}

export interface JwtPayload {
  sub: string; // userId
  email: string;
  iat: number;
  exp: number;
}
