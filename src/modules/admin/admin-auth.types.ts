export type AdminJwtPayload = {
  sub: number;   // admin id
  email: string;
  role: 'SUPER_ADMIN';
  typ: 'admin';
};
