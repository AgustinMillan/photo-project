import "@fastify/jwt";

declare module "@fastify/jwt" {
  interface FastifyJWT {
    payload: {
      sub: string;
      sid: string;
      type: "access";
    };
    user: {
      sub: string;
      sid: string;
      type: "access";
    };
  }
}
