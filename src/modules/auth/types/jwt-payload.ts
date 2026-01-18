export type JwtAccessPayload = {
  sub: number;
  email?: string | null;
  typ: 'access';
};

export type JwtRefreshPayload = {
  sub: number;
  jti: string;
  typ: 'refresh';
};

