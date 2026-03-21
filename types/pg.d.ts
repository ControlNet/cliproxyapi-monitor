declare module "pg" {
  export class Pool {
    constructor(config?: {
      connectionString?: string;
      ssl?: {
        ca: string;
        rejectUnauthorized: true;
      };
      max?: number;
      idleTimeoutMillis?: number;
      connectionTimeoutMillis?: number;
      maxUses?: number;
    });
  }
}
